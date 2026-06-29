#!/bin/bash

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/igor/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
LOG_FILE="${LOG_DIR}/workout-cache-scan-yesterday.log"

# Back edge of the scan window. Was yesterday, but a day >=2 days old never got
# re-scanned, so a late upload (athlete syncs a run with a delay) was missed forever.
# Widen to today-7 so the past week is re-scanned each run; upsert by workout_id is
# idempotent, so this only backfills late completions and costs nothing extra
# (1 GET per athlete covers the whole range; request count = number of students).
PAST_START="$(TZ=Europe/Belgrade date -v-7d +%F)"
FUTURE_END="$(TZ=Europe/Belgrade date -v+7d +%F)"

mkdir -p "${LOG_DIR}"

{
  printf '[%s] Starting workout cache scan for range=%s..%s (past 7 days + next 7 days)\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${PAST_START}" "${FUTURE_END}"
  cd "${WORK_DIR}"
  npm run tp-workouts-cache-scan -- --all-active --from="${PAST_START}" --to="${FUTURE_END}"
  printf '[%s] Finished workout cache scan for range=%s..%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${PAST_START}" "${FUTURE_END}"
} >> "${LOG_FILE}" 2>&1
