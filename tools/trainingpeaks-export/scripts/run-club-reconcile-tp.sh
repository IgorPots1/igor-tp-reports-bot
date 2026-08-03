#!/bin/bash
# Reconcile club starts with TrainingPeaks: direction "deleted in TP -> reflected in the app".
# READ-ONLY against TP (GET-by-id per applied Event). When TP returns 404 the start's link is
# cleared and it is set to a terminal rejected state (marked "СВЕРКА:"), so the app never keeps
# claiming a manually-deleted start is still "в TP". --apply writes the DB reset; without it the
# script is a harmless dry-run. Runs every 30 minutes via the launchd plist next to this file
# (requests are cheap; a TP deletion reflects in the app within ~30 min). Independent of
# CLUB_TP_EXECUTION_ENABLED (it never mutates TP).
set -euo pipefail
RUNNER_TIMEOUT_SECONDS=600
source "$(dirname "$0")/lib/runner-prelude.sh"

cd "$HOME/igor-tp-reports-bot"
echo "[$(date '+%F %T')] club-reconcile-tp"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/club-reconcile-tp-once.ts --apply || true

# Хартбит: отметка «прогон состоялся» в trainingpeaks_cron_run_logs, чтобы монитор
# отличал живой поток от тихо вставшего. `|| true` — отметка не важнее самой работы;
# сбой записи виден в логе (tp-heartbeat печатает причину и не глотает её).
npm --prefix "$HOME/igor-tp-reports-bot/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=club_reconcile_tp --status=sent || true
