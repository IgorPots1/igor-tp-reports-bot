#!/bin/bash

set -euo pipefail

RUNNER_TIMEOUT_SECONDS=0
source "$(dirname "$0")/lib/runner-prelude.sh"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/igor/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
LOG_FILE="${LOG_DIR}/weekly-agent-loop.log"

mkdir -p "${LOG_DIR}"

{
  printf '[%s] Starting weekly agent loop\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  cd "${WORK_DIR}"
  npm run tp-agent-loop -- --headless --interval-seconds=60
  printf '[%s] Weekly agent loop exited\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
} >> "${LOG_FILE}" 2>&1
