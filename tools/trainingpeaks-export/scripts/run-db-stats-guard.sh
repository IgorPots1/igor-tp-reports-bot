#!/bin/bash
# Сторож статистики планировщика: раз в сутки проверяет, не слетела ли статистика после
# перезапуска инстанса, и прогоняет ANALYZE по непроанализированным непустым таблицам.
# Read-only относительно данных — ANALYZE только пересобирает статистику.
#
# Требует применённой миграции 20260905000000_analyze_stale_tables_rpc.sql (RPC
# analyze_stale_tables / count_stale_stat_tables). Без неё скрипт доложит об этом тренеру
# в Telegram и выйдет с кодом 1 — молча не проглотит.
#
# Проверить руками, ничего не трогая:
#   tools/trainingpeaks-export/scripts/run-db-stats-guard.sh --dry-run
set -euo pipefail
RUNNER_TIMEOUT_SECONDS=1800
source "$(dirname "$0")/lib/runner-prelude.sh"

cd "$HOME/igor-tp-reports-bot"
echo "[$(date '+%F %T')] db-stats-guard старт"
node --experimental-strip-types \
  tools/trainingpeaks-export/scripts/tp-db-stats-guard.ts "$@"
CODE=$?
echo "[$(date '+%F %T')] db-stats-guard готов, код ${CODE}"
# Хартбит: отметка «прогон состоялся» в trainingpeaks_cron_run_logs, чтобы монитор
# отличал живой поток от тихо вставшего. `|| true` — отметка не важнее самой работы;
# сбой записи виден в логе (tp-heartbeat печатает причину и не глотает её).
npm --prefix "$HOME/igor-tp-reports-bot/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=db_stats_guard --status=sent || true

exit "${CODE}"
