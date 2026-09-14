#!/bin/bash
# Регулярный приём тренировок из Intervals.icu по действующим источникам учеников.
#
# Раз в 30 минут забирает последние 10 дней по каждому боевому источнику
# (kind='student'). Идемпотентно: upsert по activity_id провайдера, повторный
# прогон по тому же окну ничего не дублирует.
#
# ПОЧЕМУ ОПРОС, А НЕ ВЕБХУК: вебхуки Intervals живут в OAuth-приложении, которое
# ещё не зарегистрировано. Когда зарегистрируют — этот раннер станет страховкой
# на пропущенное событие, а не основным путём.
#
# НАРУЖУ НИЧЕГО НЕ ШЛЁТ: ни ученику, ни тренеру. Только приносит данные в базу.
RUNNER_TIMEOUT_SECONDS=900
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
LOG_DIR="${REPO}/tools/trainingpeaks-export/logs"
mkdir -p "${LOG_DIR}"
cd "${REPO}" || exit 1

OUT="$(npx tsx "${REPO}/scripts/intervals-sync-active.ts" --window=10 2>&1)"
printf '%s\n' "----- $(date '+%Y-%m-%d %H:%M') -----" "$OUT" >> "${LOG_DIR}/intervals-sync.log"
printf '%s\n' "$OUT"
