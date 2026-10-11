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

# Округа по кругу: за четыре недели все восемь.
DISTRICTS=("Центральный и Северо-Западный" "Южный и Северо-Кавказский" "Приволжский и Уральский" "Сибирский и Дальневосточный")
WEEK=$((10#$(date +%V)))
WEEK_DISTRICTS="${DISTRICTS[$((WEEK % 4))]} федеральные округа"

# Входы агента: ручные старты и реестр.
if ! "${GATE[@]}" list > "$WORK/manual.json"; then
  echo "не прочитал ручные старты, прогон остановлен"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-heartbeat -- --job=races_weekly --status=failed || true
  exit 1
fi
"${GATE[@]}" sources > "$WORK/sources.json" || echo "[]" > "$WORK/sources.json"
rm -f "$WORK/proposal.json"

PROMPT="$(sed -e "s|{{TODAY}}|$TODAY|g" -e "s|{{REPO}}|$REPO|g" -e "s|{{DISTRICTS}}|$WEEK_DISTRICTS|g" "$REPO/scripts/races-weekly-prompt.md")"

# Права агента: читать и писать только в своей папке, сеть, и только безопасные режимы шлюза.
# apply и dedupe с --apply агенту НЕ разрешены: их зовёт эта обёртка после него.
echo "агент: старт ($WEEK_DISTRICTS)"
( cd "$WORK" && "$CLAUDE_BIN" -p "$PROMPT" \
    --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
    --no-session-persistence \
    --allowedTools "Read(./**)" "Write(./**)" "Edit(./**)" "WebFetch" "WebSearch" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts read:*)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts dup:*)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts list)" \
      "Bash(npx tsx $REPO/scripts/races-manual.ts sources:*)" \
    > "$WORK/agent.out.log" 2> "$WORK/agent.err.log" )
AGENT_CODE=$?
echo "агент: код выхода $AGENT_CODE, лог $WORK/agent.out.log"

# Нет валидного предложения: шлюз всё равно снимает дубли и пишет итог с пометкой.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$WORK/proposal.json" 2>/dev/null; then
  echo "агент не оставил валидного proposal.json"
  printf '{"agent_failed": "код выхода %s, см. %s"}\n' "$AGENT_CODE" "$WORK/agent.err.log" > "$WORK/proposal.json"
  STATUS=failed
else
  STATUS=sent
fi

if "${GATE[@]}" apply "$WORK/proposal.json" --apply; then
  echo "шлюз: применено"
else
  echo "шлюз: ОШИБКА применения"
  STATUS=failed
fi

npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-heartbeat -- --job=races_weekly --status="$STATUS" || true
echo "races weekly: готово ($STATUS)"
