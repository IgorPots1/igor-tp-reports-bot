#!/bin/bash

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/igor/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
LOG_FILE="${LOG_DIR}/workout-cache-scan-yesterday.log"

YESTERDAY="$(TZ=Europe/Belgrade date -v-1d +%F)"

mkdir -p "${LOG_DIR}"

{
  printf '[%s] Starting workout cache scan for date=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${YESTERDAY}"
  cd "${WORK_DIR}"
  npm run tp-workouts-cache-scan -- --all-active --date="${YESTERDAY}"
  printf '[%s] Finished workout cache scan for date=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${YESTERDAY}"
} >> "${LOG_FILE}" 2>&1
