#!/bin/bash

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/igor/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
LOG_FILE="${LOG_DIR}/custom-metrics-profile-sync-weekly.log"

DAYS="${PROFILE_SYNC_DAYS:-30}"

mkdir -p "${LOG_DIR}"

{
  printf '[%s] Starting custom-metrics profile sync --all-active --days=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${DAYS}"
  cd "${WORK_DIR}"
  npm run tp-custom-metrics-profile-sync -- --all-active --days="${DAYS}" --headless
  printf '[%s] Finished custom-metrics profile sync\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
} >> "${LOG_FILE}" 2>&1
