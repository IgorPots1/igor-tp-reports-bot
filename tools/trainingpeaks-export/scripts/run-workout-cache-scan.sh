#!/bin/bash
# TrainingPeaks workout-cache scan — параметризованное окно (замена -7/+7 хардкода).
# Использование:
#   PAST_DAYS=10 FUTURE_DAYS=10 ./run-workout-cache-scan.sh          # быстрый скан
#   PAST_DAYS=60 FUTURE_DAYS=14 ./run-workout-cache-scan.sh          # глубокий бэкфилл
set -euo pipefail

# Не спать С ПЕРВОЙ СЕКУНДЫ прогона, а не только пока идёт npm (2026-10-02). Мак будится по
# расписанию (pmset schedule wake, см. schedule-scan-wakes.sh), а сон на батарее — через 1 минуту
# простоя: без этого он засыпал бы ещё в прологе, пока ждёт Wi-Fi. -w $$ — держим, пока жива обёртка.
caffeinate -i -w $$ &

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
# Итог прогона пишет сам скан (SCAN_OUTCOME_FILE): exit 0 у --all-active бывает и тогда, когда
# часть учеников упала. Вердикт решает скан (evaluateScanRunHealth), обёртка только переводит:
#   ok      → sent;
#   partial → partial: дошёл до конца, часть упала (403 / fetch failed раздельно в counts);
#   alarm   → failed: ok < 80% сканируемых или 403 выросло больше чем на 3 к прошлому прогону —
#             partial такое скрыл бы (протухшая сессия даёт 403 всем);
#   нет файла / exit != 0 → failed.
OUTCOME_FILE="$(mktemp -t tp-scan-outcome)"
SCAN_OUTCOME_FILE="$OUTCOME_FILE" npm run tp-workouts-cache-scan -- --all-active --from="${FROM}" --to="${TO}"
CODE=$?
set -e
HB_STATUS=failed
HB_NOTE=""
OUTCOME="$(cat "$OUTCOME_FILE" 2>/dev/null || true)"
if [ "$CODE" -eq 0 ] && [ -n "$OUTCOME" ]; then
  VERDICT="$(printf '%s' "$OUTCOME" | sed -nE 's/.*"verdict":"([a-z]+)".*/\1/p')"
  ACCESS_LOST="$(printf '%s' "$OUTCOME" | sed -nE 's/.*"accessLost":([0-9]+).*/\1/p')"
  FETCH_FAILED="$(printf '%s' "$OUTCOME" | sed -nE 's/.*"fetchFailed":([0-9]+).*/\1/p')"
  OTHER_FAILED="$(printf '%s' "$OUTCOME" | sed -nE 's/.*"otherFailed":([0-9]+).*/\1/p')"
  INCOMPLETE_DAYS="$(printf '%s' "$OUTCOME" | sed -nE 's/.*"incompleteDays":([0-9]+).*/\1/p')"
  HB_NOTE="access_lost_403=${ACCESS_LOST:-0} fetch_failed=${FETCH_FAILED:-0} other_failed=${OTHER_FAILED:-0} incomplete_days=${INCOMPLETE_DAYS:-0}"
  case "$VERDICT" in
    ok) HB_STATUS=sent ;;
    partial) HB_STATUS=partial ;;
    *) HB_STATUS=failed; HB_NOTE="ALARM ${HB_NOTE}" ;;
  esac
fi
rm -f "$OUTCOME_FILE"
npm --prefix "$TOOLS" run --silent tp-heartbeat -- --job=workout_cache_scan --status="$HB_STATUS" --note="$HB_NOTE" --counts="$OUTCOME" || true

# Пересчёт материализованных клубных рекордов по затронутым ученикам (инкрементально).
# За флагом (ВЫКЛ по умолчанию): включить в rollout ПОСЛЕ применения миграции
# club_record_snapshots. || true — пересчёт никогда не валит скан.
if [ "${CLUB_MATERIALIZE_ENABLED:-false}" = "true" ]; then
  echo "[$(date '+%F %T')] materialize club records (touched students)"
  npm run --silent materialize-club-records -- --since-hours=6 || true
fi

exit "$CODE"
