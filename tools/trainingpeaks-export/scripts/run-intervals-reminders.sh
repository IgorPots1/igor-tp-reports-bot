#!/bin/bash
# Напоминания ученикам Intervals: что сегодня по плану и отметиться после.
#
# Ходит раз в 30 минут и почти всегда молчит: решение принимается по местному
# времени каждого ученика, и окон всего два — утреннее и вечернее. От повторов
# защищает уникальный ключ в базе (источник, вид, местная дата), а не
# аккуратность расписания.
#
# ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ. Без INTERVALS_REMINDERS_ENABLED=true скрипт считает и
# пишет след со статусом skipped, но наружу не отправляет ничего. Второй,
# независимый заслон — telegram_delivery_enabled у карточки ученика.
RUNNER_TIMEOUT_SECONDS=600
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
LOG_DIR="${REPO}/tools/trainingpeaks-export/logs"
mkdir -p "${LOG_DIR}"
cd "${REPO}" || exit 1

# node --env-file, а НЕ npx tsx: tsx не читает .env.local, и раннер умирает на
# отсутствии SUPABASE_URL. Урок уже оплачен раннером синхронизации.
OUT="$(node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local "${REPO}/scripts/intervals-reminders.ts" 2>&1)"
printf '%s\n' "----- $(date '+%Y-%m-%d %H:%M') -----" "$OUT" >> "${LOG_DIR}/intervals-reminders.log"
printf '%s\n' "$OUT"
