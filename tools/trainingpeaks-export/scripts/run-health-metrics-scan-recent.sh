#!/bin/bash

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/igor/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
LOG_FILE="${LOG_DIR}/health-metrics-scan-recent.log"

TO_DATE="$(TZ=Europe/Belgrade date -v-1d +%F)"
FROM_DATE="$(TZ=Europe/Belgrade date -v-3d +%F)"

mkdir -p "${LOG_DIR}"

CODE=1
{
  printf '[%s] Starting health metrics scan from=%s to=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${FROM_DATE}" "${TO_DATE}"
  cd "${WORK_DIR}"
  set +e
  npm run tp-health-metrics-scan -- --from="${FROM_DATE}" --to="${TO_DATE}" --eligible-only
  CODE=$?
  set -e
  printf '[%s] Finished health metrics scan (exit %s) from=%s to=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${CODE}" "${FROM_DATE}" "${TO_DATE}"
} >> "${LOG_FILE}" 2>&1

# Heartbeat for the pipeline monitor — success only when the scan actually succeeded.
npm --prefix "${WORK_DIR}" run --silent tp-heartbeat -- --job=health_metrics_scan --status="$([ "${CODE}" -eq 0 ] && echo sent || echo failed)" || true
exit "${CODE}"
