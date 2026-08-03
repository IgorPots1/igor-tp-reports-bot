#!/bin/bash
# Суточный ПОЛНЫЙ пересчёт клубных снапшотов/агрегатов (materialize --all).
#
# ЗАЧЕМ: инкрементальный пересчёт (в скан-скриптах, --since-hours) идёт по updated_at
# затронутых учеников. Тренировка, УДАЛЁННАЯ из TrainingPeaks, не бьёт updated_at
# (строки больше нет) → её вклад может «застрять» в снапшотах/агрегатах до полного
# пересчёта. Полный --all раз в сутки затирает всех учеников заново и закрывает пробел
# (а также ловит любые расхождения, накопившиеся из-за пропущенных сканов).
#
# За флагом CLUB_MATERIALIZE_ENABLED (как и инкрементальный) — не запускается, пока клуб
# не раскатан. || true — пересчёт никогда не валит ничего.
set -euo pipefail

RUNNER_TIMEOUT_SECONDS=3600
source "$(dirname "$0")/lib/runner-prelude.sh"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
cd "$REPO"

if [ "${CLUB_MATERIALIZE_ENABLED:-false}" != "true" ]; then
  echo "[$(date '+%F %T')] club full materialize: CLUB_MATERIALIZE_ENABLED != true — пропуск"
  exit 0
fi

echo "[$(date '+%F %T')] club full materialize --all (суточный, закрывает пробел с удалёнными из TP)"
npm run --silent materialize-club-records -- --all || true
echo "[$(date '+%F %T')] club full materialize --all done"

# Хартбит: отметка «прогон состоялся» в trainingpeaks_cron_run_logs, чтобы монитор
# отличал живой поток от тихо вставшего. `|| true` — отметка не важнее самой работы;
# сбой записи виден в логе (tp-heartbeat печатает причину и не глотает её).
npm --prefix "$HOME/igor-tp-reports-bot/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=club_materialize_full --status=sent || true
