#!/bin/bash
# TrainingPeaks FIT-ingest scan + feedback-enqueue — ОДНА служба, весь хвост трубы.
# ИДЁТ СЛЕДОМ за workout-cache-scan: cache-scan скачивает тренировки в кэш → этот скрипт
# считает из них derived_metrics → и СРАЗУ САМ дёргает enqueue (кладёт новые тренировки
# в «Новые»). Ноль кронов на Vercel. Генерация остаётся кнопкой Игоря (Вариант Б).
#
# ЧАСТИЧНЫЕ СБОИ — НОРМА. При ~110 учениках всегда есть per-athlete-провалы (403 закрытого
# экспорта, TP вернул HTML вместо JSON, транзиентный fetch). fit-ingest выходит кодом 1,
# ЕСЛИ ХОТЬ ОДИН упал — но это НЕ значит «всё сломалось»: успешные метрики посчитаны.
# Поэтому:
#   * enqueue бежит ВСЕГДА (идемпотентно) — успешные тренировки должны попасть в список;
#   * алерт «TP-сессия умерла» — ТОЛЬКО когда НИКТО не прошёл (0 ok) И ошибки авторизац.
#     (мёртвый bearer/cookie/401), а не per-athlete 403. Иначе был бы ложный алерт каждый раз.
#   * мониторинг: ученик, падающий N прогонов ПОДРЯД → отдельный алерт списком.
#
# Окно последних дней (по умолчанию 5). Использование:
#   PAST_DAYS=5 ./run-fit-ingest-scan.sh          # обычный прогон (плист)
#   PAST_DAYS=14 ./run-fit-ingest-scan.sh         # добор после простоя
#
# ГРАБЛИ (учтены): рабочая папка REPO=$HOME/igor-tp-reports-bot (код из main, не worktree);
# окружение службы (плист bash -lc); токен TP протух → алерт «перелогинься» (npm run tp-login).
set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
PAST_DAYS="${PAST_DAYS:-5}"
TOOLS="tools/trainingpeaks-export"

FROM="$(TZ=Europe/Belgrade date -v-"${PAST_DAYS}"d +%F)"
TO="$(TZ=Europe/Belgrade date +%F)"

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

# 1) FIT-ingest — считаем метрики. Ловим вывод (для детекта сессии + мониторинга).
echo "[$(date '+%F %T')] tp-fit-ingest-scan --from=${FROM} --to=${TO} (все активные)"
FIT_LOG="$(mktemp -t fit-ingest-out)"
npm run --silent tp-fit-ingest-scan -- --from="${FROM}" --to="${TO}" >"$FIT_LOG" 2>&1
FIT_CODE=$?
cat "$FIT_LOG"

OK_COUNT="$(grep -c 'status=ok' "$FIT_LOG" || true)"
FAILED_COUNT="$(grep -c 'status=failed' "$FIT_LOG" || true)"
echo "[$(date '+%F %T')] fit-ingest: ok=${OK_COUNT} failed=${FAILED_COUNT} exit=${FIT_CODE}"

# Heartbeat for the pipeline monitor: a SUCCESS means metrics were actually computed for someone
# (ok>0). Per-athlete 403s are normal, but 0 successes = a real stall (dead session), so mark failed.
npm --prefix "$TOOLS" run --silent tp-heartbeat -- --job=fit_ingest_scan --status="$([ "${OK_COUNT:-0}" -gt 0 ] && echo sent || echo failed)" || true

# 2) Алерт «сессия умерла» — ТОЛЬКО если НИКТО не прошёл И это похоже на авторизацию
#    (мёртвый bearer/cookie/401), НЕ на per-athlete 403.
if [ "${OK_COUNT:-0}" -eq 0 ] && [ "$FIT_CODE" -ne 0 ]; then
  if grep -qiE '401|unauthor|bearer|token|session|cookie|re-?login|not logged|snapshot' "$FIT_LOG"; then
    echo "[$(date '+%F %T')] 0 успехов + авторизац. ошибка → алерт о смерти сессии"
    npm --prefix "$TOOLS" run --silent tp-ops-notify -- \
      "⚠️ TP-сессия, похоже, умерла: fit-ingest не посчитал НИ ОДНОЙ тренировки. Перелогинься: cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npm run tp-login" || true
  fi
fi

# 3) Мониторинг: ученики, стабильно НЕ качающиеся (N прогонов подряд) → алерт списком.
npm --prefix "$TOOLS" run --silent tp-export-failure-monitor -- --log="$FIT_LOG" || true

# 4) enqueue ВСЕГДА (частичные сбои — норма; успешные метрики должны попасть в список).
echo "[$(date '+%F %T')] enqueue (кладём новые тренировки в список)"
npm --prefix "$TOOLS" run --silent tp-feedback-enqueue-run || true

rm -f "$FIT_LOG"
