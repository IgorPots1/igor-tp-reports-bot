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

# Reverse direction: drain cancelled starts — delete the TP entity we created, then remove the row.
# Same master switch (flag off → harmless dry-run). Idempotent: only rows with a pending rollback
# intent AND a TP id are touched; a successful removal deletes the row so it is never retried.
echo "[$(date '+%F %T')] club-rollback-requested (CLUB_TP_EXECUTION_ENABLED=${CLUB_TP_EXECUTION_ENABLED:-unset})"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/club-rollback-requested-once.ts --apply || true
