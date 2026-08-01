#!/bin/bash
# Auto-drain approved club_calendar_entries into TrainingPeaks. Runs the batch runner with --apply;
# the runner still writes ONLY when CLUB_TP_EXECUTION_ENABLED=true (master switch, from the login
# shell / env). Flag off → it is a harmless dry-run. Idempotent: applied entries are skipped, so
# repeated 30-min runs never duplicate in TP. Install via the launchd plist next to this file.
set -euo pipefail
cd "$HOME/igor-tp-reports-bot"

# Entity-type mapping is now FIXED policy: Event for races, Availability for day_offs, Note for notes.
# Force it here so the run is deterministic regardless of how it was launched. The bug it fixes: the
# launchd `bash -lc` reads ~/.bash_profile (where these live), but a manual `bash <script>` — or the
# `node --env-file=.env.local` picking up a shell that never sourced .bash_profile (a zsh terminal) —
# would leave CLUB_RACE_AS_EVENT unset, and a race silently fell back to a TP *Workout* instead of an
# Event. These three only pick the ENTITY TYPE; they are not the execution gate. The MASTER switch
# CLUB_TP_EXECUTION_ENABLED is deliberately NOT forced — it stays under the coach's control via the env.
export CLUB_RACE_AS_EVENT=true
export CLUB_DAYOFF_AS_AVAILABILITY=true
export CLUB_NOTES_AS_NOTE=true

echo "[$(date '+%F %T')] club-execute-approved (CLUB_TP_EXECUTION_ENABLED=${CLUB_TP_EXECUTION_ENABLED:-unset} RACE_AS_EVENT=${CLUB_RACE_AS_EVENT} DAYOFF_AS_AVAILABILITY=${CLUB_DAYOFF_AS_AVAILABILITY} NOTES_AS_NOTE=${CLUB_NOTES_AS_NOTE})"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/club-execute-approved-once.ts --apply || true

# Reverse direction: drain cancelled starts — delete the TP entity we created, then remove the row.
# Same master switch (flag off → harmless dry-run). Idempotent: only rows with a pending rollback
# intent AND a TP id are touched; a successful removal deletes the row so it is never retried.
echo "[$(date '+%F %T')] club-rollback-requested (CLUB_TP_EXECUTION_ENABLED=${CLUB_TP_EXECUTION_ENABLED:-unset})"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/club-rollback-requested-once.ts --apply || true
