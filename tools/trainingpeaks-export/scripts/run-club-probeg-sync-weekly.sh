#!/bin/bash
# Weekly probeg protocol sync. Races appear every 1-2 weeks, so weekly (not daily) is enough.
# The matcher: auto-links the SAFE categories (strict name / shortened-name+exact-surname /
# distance-doubtful / confirmed spelling), queues the uncertain ones into club_protocol_pending
# (the coach sees the count in the club admin nav and reviews on /admin/club/protocols), and writes
# every official result into the club_official_results journal. POLITE (disk cache, sequential, delay
# before each live fetch) and IDEMPOTENT (skips confirmed/rejected/already-linked), so a weekly run
# never duplicates and never hammers probeg. Runs against club students that have a past race.
set -euo pipefail
RUNNER_TIMEOUT_SECONDS=3600
source "$(dirname "$0")/lib/runner-prelude.sh"

cd "$HOME/igor-tp-reports-bot"
echo "[$(date '+%F %T')] club-probeg-sync --write --commit"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/probeg-people-probe.ts --write --commit || true

# Правило: подтверждённый протокол (official_protocol/coach_confirmed) перекрывает дистанцию
# race_event. Гонит СРАЗУ после probeg-синка, чтобы новые протоколы автоматически чинили кривые
# дистанции скана (TP-поле Distance врёт: Пушкин 30 хранился как 21.1, ЗаБег 5 как 10). Идемпотентно.
echo "[$(date '+%F %T')] reconcile race-event distances from protocol"
node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local scripts/reconcile-race-distances-from-protocol.ts --commit || true

# Хартбит: отметка «прогон состоялся» в trainingpeaks_cron_run_logs, чтобы монитор
# отличал живой поток от тихо вставшего. `|| true` — отметка не важнее самой работы;
# сбой записи виден в логе (tp-heartbeat печатает причину и не глотает её).
npm --prefix "$HOME/igor-tp-reports-bot/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=club_probeg_sync --status=sent || true
