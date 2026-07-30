#!/bin/bash
# Auto-drain approved club_calendar_entries into TrainingPeaks. Runs the batch runner with --apply;
# the runner still writes ONLY when CLUB_TP_EXECUTION_ENABLED=true (master switch, from the login
# shell / env). Flag off → it is a harmless dry-run. Idempotent: applied entries are skipped, so
# repeated 30-min runs never duplicate in TP. Install via the launchd plist next to this file.
set -euo pipefail
cd "$HOME/igor-tp-reports-bot"
echo "[$(date '+%F %T')] club-execute-approved (CLUB_TP_EXECUTION_ENABLED=${CLUB_TP_EXECUTION_ENABLED:-unset})"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/club-execute-approved-once.ts --apply || true
