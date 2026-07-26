#!/bin/bash
# TrainingPeaks workout-cache scan — параметризованное окно (замена -7/+7 хардкода).
# Использование:
#   PAST_DAYS=10 FUTURE_DAYS=10 ./run-workout-cache-scan.sh          # быстрый скан
#   PAST_DAYS=60 FUTURE_DAYS=14 ./run-workout-cache-scan.sh          # глубокий бэкфилл
set -euo pipefail

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
npm run tp-workouts-cache-scan -- --all-active --from="${FROM}" --to="${TO}"
CODE=$?
set -e
npm --prefix "$TOOLS" run --silent tp-heartbeat -- --job=workout_cache_scan --status="$([ "$CODE" -eq 0 ] && echo sent || echo failed)" || true
exit "$CODE"
