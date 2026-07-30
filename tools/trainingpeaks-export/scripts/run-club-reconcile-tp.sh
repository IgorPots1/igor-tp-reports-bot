#!/bin/bash
# Reconcile club starts with TrainingPeaks: direction "deleted in TP -> reflected in the app".
# READ-ONLY against TP (GET-by-id per applied Event). When TP returns 404 the start's link is
# cleared and it is set to a terminal rejected state (marked "СВЕРКА:"), so the app never keeps
# claiming a manually-deleted start is still "в TP". --apply writes the DB reset; without it the
# script is a harmless dry-run. Runs daily via the launchd plist next to this file. Independent of
# CLUB_TP_EXECUTION_ENABLED (it never mutates TP).
set -euo pipefail
cd "$HOME/igor-tp-reports-bot"
echo "[$(date '+%F %T')] club-reconcile-tp"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/club-reconcile-tp-once.ts --apply || true
