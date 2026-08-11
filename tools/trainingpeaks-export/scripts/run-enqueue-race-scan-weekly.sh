#!/bin/bash

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/igor/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
LOG_FILE="${LOG_DIR}/enqueue-race-scan-weekly.log"

mkdir -p "${LOG_DIR}"

{
  printf '[%s] Enqueue weekly race scan\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  cd "${WORK_DIR}"
  npm run enqueue-race-scan-weekly
} >> "${LOG_FILE}" 2>&1
npm --prefix "${WORK_DIR}" run --silent tp-heartbeat -- --job=race_scan --status=sent || true
