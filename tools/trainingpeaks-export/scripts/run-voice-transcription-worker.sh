#!/bin/bash
# Voice-transcription worker: claims pending rows in voice_transcription_jobs, downloads the
# Telegram file, runs ffmpeg -> whisper.cpp, writes the transcript back, edits the bot's ack
# message. One pass per invocation — the plist next to this file ticks it every 15-20s via
# StartInterval, not a persistent daemon. See src/features/voice-transcription/ for the code
# this runs (repository.ts / transcribe.ts / the worker script itself lives at repo-root
# scripts/voice-transcription-worker.ts, alongside the other node+_alias-loader scripts).
#
# ffmpeg/whisper-cli come from Homebrew, which launchd's minimal PATH does not see by default —
# export it explicitly, same as run-battery-guard.sh does for pmset/pmset-adjacent tools.
set -uo pipefail
RUNNER_TIMEOUT_SECONDS=600
source "$(dirname "$0")/lib/runner-prelude.sh"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$HOME/igor-tp-reports-bot" || { echo "[$(date '+%F %T')] нет папки $HOME/igor-tp-reports-bot"; exit 1; }

echo "[$(date '+%F %T')] voice-transcription-worker tick"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/voice-transcription-worker.ts
