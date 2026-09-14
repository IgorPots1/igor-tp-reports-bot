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

# ИМЕННО node --env-file, а НЕ npx tsx: tsx окружение из .env.local не читает,
# и скрипт умирает на "Missing required environment variable: SUPABASE_URL",
# а фильтр-штамп из пролога держит пайп открытым, и прогон выглядит зависшим.
# Поймано попыткой запустить раннер руками, а не вычитано.
OUT="$(node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
  --env-file=.env.local "${REPO}/scripts/intervals-sync-active.ts" --window=10 2>&1)"
printf '%s\n' "----- $(date '+%Y-%m-%d %H:%M') -----" "$OUT" >> "${LOG_DIR}/intervals-sync.log"
printf '%s\n' "$OUT"

# ОТОЗВАННЫЙ ДОСТУП — единственное, из-за чего этот раннер будит тренера.
# Токены Intervals не протухают, поэтому 401/403 означает, что человек отозвал
# доступ или переавторизовал приложение: само это не пройдёт, и пока не
# переподключатся, данных не будет вовсе. Пустой календарь тренер прочитает как
# «не бегает», и это худшая из возможных ошибок.
#
# ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ: автоматических сообщений наружу без явного включения
# этот контур не делает. Включить: INTERVALS_SYNC_NOTIFY=true в .env.local.
if [ "${INTERVALS_SYNC_NOTIFY:-}" = "true" ] && printf '%s' "$OUT" | grep -q "⟦NOTIFY⟧"; then
  MSG="$(printf '%s' "$OUT" | grep "⟦NOTIFY⟧" | sed 's/⟦NOTIFY⟧ //')"
  npm --prefix "${REPO}/tools/trainingpeaks-export" run --silent tp-ops-notify -- "$MSG" >/dev/null 2>&1 || true
fi
