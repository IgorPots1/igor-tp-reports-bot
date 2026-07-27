#!/bin/bash
# Club Phase 4 — GPS-track backfill over the last 60 days (manual, run by Igor).
#
# The regular fit-ingest runs a 5-day window; new workouts get a track automatically
# once CLUB_TRACKS_ENABLED=true. This one-off widens the window to 60 days so recently
# ingested workouts that predate the flag also get a route. Re-ingest is IDEMPOTENT
# (track upsert on workout_cache_id), so re-running is safe.
#
# NOT run automatically and NOT scheduled. Run manually AFTER applying the migration
# 20260803000000_trainingpeaks_workout_tracks.sql:
#
#   CLUB_TRACKS_ENABLED=true PAST_DAYS=60 \
#     ~/igor-tp-reports-bot/tools/trainingpeaks-export/scripts/run-fit-tracks-backfill-60d.sh
#
# It re-downloads/parses FIT for the window (same cost as a normal ingest over 60 days)
# and writes only the track rows differ; laps/derived are re-upserted identically.
set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
PAST_DAYS="${PAST_DAYS:-60}"
export CLUB_TRACKS_ENABLED="${CLUB_TRACKS_ENABLED:-true}"

FROM="$(TZ=Europe/Belgrade date -v-"${PAST_DAYS}"d +%F)"
TO="$(TZ=Europe/Belgrade date +%F)"

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] tracks backfill: tp-fit-ingest-scan --from=${FROM} --to=${TO} CLUB_TRACKS_ENABLED=${CLUB_TRACKS_ENABLED}"
npm run --silent tp-fit-ingest-scan -- --from="${FROM}" --to="${TO}"
echo "[$(date '+%F %T')] tracks backfill done (см. строки '[fit-ingest] … GPS-треков записано N')"
