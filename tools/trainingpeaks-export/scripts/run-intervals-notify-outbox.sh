#!/bin/bash
# Очередь уведомлений ученицам Intervals (intervals_notify_outbox): раз в 5 минут.
#
# Тренер ставит строку в базе — раннер шлёт её теми же функциями, что кнопки
# админки. ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ: без INTERVALS_NOTIFY_OUTBOX_ENABLED=true очередь
# не трогается, строки лежат pending. Остальные заслоны — у функций отправки:
# INTERVALS_COACH_SEND_ENABLED, telegram_delivery_enabled, пауза.

RUNNER_TIMEOUT_SECONDS=240
source "$(dirname "$0")/lib/runner-prelude.sh"
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="${REPO:-$HOME/igor-tp-reports-bot}"
LOG_DIR="${REPO}/tools/trainingpeaks-export/logs"
mkdir -p "${LOG_DIR}"
cd "${REPO}" || exit 1

# node --env-file, а НЕ npx tsx: tsx не читает .env.local (см. run-intervals-reminders.sh).
OUT="$(node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local "${REPO}/scripts/intervals-notify-outbox.ts" 2>&1)"
printf '%s\n' "----- $(date '+%Y-%m-%d %H:%M') -----" "$OUT" >> "${LOG_DIR}/intervals-notify-outbox.log"
printf '%s\n' "$OUT"
