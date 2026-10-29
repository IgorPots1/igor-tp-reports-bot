#!/bin/bash
# Еженедельное обновление ручных стартов /races. Понедельник 09:10, после ночного
# сбора edge-функции race-calendar-sync.
#
# ДВА СЛОЯ, И ЭТО ГЛАВНОЕ:
#   1. Агент (claude -p) сверяет ручные старты в браузере и ищет новые. Доступа к
#      базе у него нет: MCP выключен, из Bash разрешён только шлюз
#      scripts/races-manual.ts в режимах list/read/dup/sources. Итог агент кладёт
#      файлом proposal.json в рабочую папку.
#   2. Шлюз (этот скрипт после агента) применяет proposal.json. Правила записи в
#      коде шлюза: только race_events, только source='manual', без удалений,
#      проверка дубля, предохранитель на число правок. Он же снимает дубли с
#      основным потоком, ведёт реестр источников и пишет итог в ops-log.
#
# Раннер меняет только данные в базе: ничего не коммитит, не пушит, не деплоит.
# Агент работает в своей папке ~/races-weekly-work/<дата>, не в репозитории.
RUNNER_TIMEOUT_SECONDS=10800
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
TODAY="$(TZ=Europe/Belgrade date +%F)"
WORK="${RACES_WORK_DIR:-$HOME/races-weekly-work}/$TODAY"
GATE=(npx --prefix "$REPO" tsx "$REPO/scripts/races-manual.ts")

mkdir -p "$WORK" || { echo "нет рабочей папки $WORK"; exit 1; }
cd "$REPO" || { echo "нет папки $REPO"; exit 1; }
echo "races weekly: старт, рабочая папка $WORK"

# Входы агента: ручные старты и реестр.
if ! "${GATE[@]}" list > "$WORK/manual.json"; then
  echo "не прочитал ручные старты, прогон остановлен"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-heartbeat -- --job=races_weekly --status=failed || true
  exit 1
fi
"${GATE[@]}" sources > "$WORK/sources.json" || echo "[]" > "$WORK/sources.json"
# Заявки с сайта (разбираются первыми) и точки обхода недели.
"${GATE[@]}" suggestions > "$WORK/suggestions.json" || echo "[]" > "$WORK/suggestions.json"
"${GATE[@]}" cities > "$WORK/cities.json" || echo "[]" > "$WORK/cities.json"
# Старты «под вопросом» (race_overrides.status = questionable), у которых подошла перепроверка.
"${GATE[@]}" recheck > "$WORK/recheck.json" || echo "[]" > "$WORK/recheck.json"
# Старты в ближайшие 21 день без трека (race_details track = «нет данных»): поискать трек заново.
"${GATE[@]}" tracks-due > "$WORK/tracks-due.json" || echo "[]" > "$WORK/tracks-due.json"
# Выжимка у стартов на ближайшие 60 дней: регистрация, время старта, номера, лимиты — перепроверить.
"${GATE[@]}" details-due > "$WORK/details-due.json" || echo "[]" > "$WORK/details-due.json"
# Поиск во ВКонтакте только при сервисном ключе в .env.local основной папки.
if grep -q '^VK_SERVICE_TOKEN=.' "$REPO/.env.local" 2>/dev/null; then VK_MODE="есть"; else VK_MODE="нет"; fi
# ВК — по ВСЕМ точкам каждую неделю (1664 поиска), детерминированно, до агента: шлюз сам ищет,
# отбрасывает людей и закрытые группы и кладёт кандидатов в файл; агент их только проверяет.
# Лимит ВК (6/29): обход останавливается, состояние в ~/ops-log/races/vk-sweep.json, следующий
# запуск (com.igor.races.vk-resume на следующий день или этот раннер) продолжит с той же точки.
echo "[]" > "$WORK/vk-candidates.json"
if [ "$VK_MODE" = "есть" ]; then
  "${GATE[@]}" vk-sweep "$WORK/vk-candidates.json"
  case $? in
    0) echo "ВК: обход по всем точкам закончен" ;;
    4) echo "ВК: лимит, остановился; продолжу на следующий день (кандидаты пока частичные)" ;;
    *) echo "ВК: обход упал, агент идёт без кандидатов из ВК" ;;
  esac
  # Незаконченный прошлый круг пишет в свой файл: агенту отдаём файл текущего круга.
  VK_OUT="$(python3 -c "import json,os;p=os.path.expanduser('~/ops-log/races/vk-sweep.json');print(json.load(open(p)).get('out',''))" 2>/dev/null)"
  if [ -n "$VK_OUT" ] && [ -f "$VK_OUT" ] && [ "$VK_OUT" != "$WORK/vk-candidates.json" ]; then cp "$VK_OUT" "$WORK/vk-candidates.json"; fi
fi
rm -f "$WORK/proposal.json"

# Шлюз чтения страниц жив? (29.10.2026: кэш браузера Playwright оказался стёрт, и `read` падал на
# каждом адресе — разведка шла бы вслепую.) Не жив — агента не запускаем: итог недели первой строкой
# «ШЛЮЗ НЕ РАБОТАЛ…», а шлюз сам пишет тренеру в Telegram (только тренеру, TELEGRAM_COACH_CHAT_IDS).
GATEWAY_DOWN=""
if ! "${GATE[@]}" gateway-check > "$WORK/gateway-check.log" 2>&1; then
  GATEWAY_DOWN="$(grep -m1 'ШЛЮЗ НЕ РАБОТАЕТ' "$WORK/gateway-check.log" | sed 's/^ШЛЮЗ НЕ РАБОТАЕТ: //' | cut -c1-300)"
  [ -n "$GATEWAY_DOWN" ] || GATEWAY_DOWN="проверка упала, см. $WORK/gateway-check.log"
  echo "шлюз чтения страниц не работает: $GATEWAY_DOWN"
fi

PROMPT="$(sed -e "s|{{TODAY}}|$TODAY|g" -e "s|{{REPO}}|$REPO|g" -e "s|{{VK}}|$VK_MODE|g" "$REPO/scripts/races-weekly-prompt.md")"

# Права агента: читать и писать только в своей папке, сеть, и только безопасные режимы шлюза.
# apply и dedupe с --apply агенту НЕ разрешены: их зовёт эта обёртка после него.
echo "агент: старт (заявок $(python3 -c "import json;print(len(json.load(open('$WORK/suggestions.json'))))"), точек $(python3 -c "import json;print(len(json.load(open('$WORK/cities.json'))))"), ВК: $VK_MODE)"
if [ -n "$GATEWAY_DOWN" ]; then
  AGENT_CODE=99
  echo "агент: не запускался — шлюз не работает"
else
( cd "$WORK" && "$CLAUDE_BIN" -p "$PROMPT" \
    --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
    --no-session-persistence \
    --allowedTools "Read(./**)" "Write(./**)" "Edit(./**)" "WebFetch" "WebSearch" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts read:*)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts dup:*)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts list)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts sources:*)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts suggestions)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts vk:*)" \
    > "$WORK/agent.out.log" 2> "$WORK/agent.err.log" )
AGENT_CODE=$?
echo "агент: код выхода $AGENT_CODE, лог $WORK/agent.out.log"
fi

# Шлюз не работал: в предложении обе пометки — итог начнётся строкой «ШЛЮЗ НЕ РАБОТАЛ».
if [ -n "$GATEWAY_DOWN" ]; then
  GATEWAY_DOWN="$GATEWAY_DOWN" python3 -c 'import json,os,sys; r=os.environ["GATEWAY_DOWN"]; json.dump({"agent_failed": "агент не запускался: шлюз чтения страниц не работал", "gateway_down": r}, open(sys.argv[1], "w"), ensure_ascii=False)' "$WORK/proposal.json"
fi

# Нет валидного предложения: шлюз всё равно снимает дубли и пишет итог с пометкой.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$WORK/proposal.json" 2>/dev/null; then
  echo "агент не оставил валидного proposal.json"
  printf '{"agent_failed": "код выхода %s, см. %s"}\n' "$AGENT_CODE" "$WORK/agent.err.log" > "$WORK/proposal.json"
  STATUS=failed
else
  STATUS=sent
fi
# Шлюз не работал — неделя провалена, даже если пометочное предложение валидно (heartbeat failed).
[ -n "$GATEWAY_DOWN" ] && STATUS=failed

if "${GATE[@]}" apply "$WORK/proposal.json" --apply; then
  echo "шлюз: применено"
else
  echo "шлюз: ОШИБКА применения"
  STATUS=failed
fi

# Сводка бота «Забеги России» в ops-log теми же цифрами, что /stats. Сбой сводки не роняет прогон.
npx --prefix "$REPO" tsx "$REPO/scripts/races-bot-stats.ts" --ops-log || echo "сводка бота: не получилась"

# Защита календаря (наряд 20.10.2026): поиск копий наших формулировок и итог по отказам.
# Поиск — отдельный короткий агент: только WebSearch и запись ./copies.json в своей папке, без
# базы и без отправок. Итог (отказы из race_guard_log + «Возможная копия: …») — новым файлом в
# ops-log. Блокировок здесь нет: только предложение Игорю. Сбой не роняет прогон.
COPIES="$WORK/copies"
mkdir -p "$COPIES" && cp "$REPO/src/features/race-guard/copy-phrases.json" "$COPIES/copy-phrases.json" && rm -f "$COPIES/copies.json"
COPIES_PROMPT="$(sed -e "s|{{TODAY}}|$TODAY|g" "$REPO/scripts/races-copies-prompt.md")"
( cd "$COPIES" && "$CLAUDE_BIN" -p "$COPIES_PROMPT" \
    --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
    --no-session-persistence \
    --allowedTools "Read(./**)" "Write(./copies.json)" "WebSearch" \
    > "$COPIES/agent.out.log" 2> "$COPIES/agent.err.log" ) || echo "поиск копий: агент упал, см. $COPIES/agent.err.log"
npx --prefix "$REPO" tsx "$REPO/scripts/races-protect-weekly.ts" --copies "$COPIES/copies.json" --ops-log || echo "итог защиты: не получился"

npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-heartbeat -- --job=races_weekly --status="$STATUS" || true
echo "races weekly: готово ($STATUS)"
