#!/bin/bash
# TrainingPeaks workout-cache scan — параметризованное окно (замена -7/+7 хардкода).
# Использование:
#   PAST_DAYS=10 FUTURE_DAYS=10 ./run-workout-cache-scan.sh          # быстрый скан
#   PAST_DAYS=60 FUTURE_DAYS=14 ./run-workout-cache-scan.sh          # глубокий бэкфилл
set -euo pipefail

RUNNER_TIMEOUT_SECONDS=3600
source "$(dirname "$0")/lib/runner-prelude.sh"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
PAST_DAYS="${PAST_DAYS:-10}"
FUTURE_DAYS="${FUTURE_DAYS:-10}"

FROM="$(TZ=Europe/Belgrade date -v-"${PAST_DAYS}"d +%F)"
TO="$(TZ=Europe/Belgrade date -v+"${FUTURE_DAYS}"d +%F)"

cd "$REPO"
TOOLS="tools/trainingpeaks-export"
echo "[$(date '+%F %T')] tp-workouts-cache-scan --all-active --from=${FROM} --to=${TO}"
# Capture the scan's exit code (no more `exec`, so the heartbeat runs after) and record a SUCCESS
# heartbeat only when it actually succeeded — the pipeline monitor uses this to spot silent stalls.
set +e
# caffeinate -i: не давать маку уйти в idle-sleep ПОКА скан идёт (защита от засыпания посреди
# прогона на батарее). Спанье МЕЖДУ прогонами лечит `sudo pmset -c sleep 0` (на AC), не это.
caffeinate -i npm run tp-workouts-cache-scan -- --all-active --from="${FROM}" --to="${TO}"
CODE=$?
set -e
npm --prefix "$TOOLS" run --silent tp-heartbeat -- --job=workout_cache_scan --status="$([ "$CODE" -eq 0 ] && echo sent || echo failed)" || true

# Пересчёт материализованных клубных рекордов по затронутым ученикам (инкрементально).
# За флагом (ВЫКЛ по умолчанию): включить в rollout ПОСЛЕ применения миграции
# club_record_snapshots. || true — пересчёт никогда не валит скан.
if [ "${CLUB_MATERIALIZE_ENABLED:-false}" = "true" ]; then
  echo "[$(date '+%F %T')] materialize club records (touched students)"
  npm run --silent materialize-club-records -- --since-hours=6 || true
fi

exit "$CODE"
