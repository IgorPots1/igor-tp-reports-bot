#!/bin/bash
# Сторож молчания раннеров.
#
# ЗАЧЕМ ОТДЕЛЬНЫМ СКРИПТОМ НА BASH, А НЕ ЕЩЁ ОДНИМ tsx-СКРИПТОМ.
# 11.08.2026 боевые раннеры пролежали 3 часа, и НИКТО не узнал. Причина: коммит завёл
# tools/trainingpeaks-export/tsconfig.json без блока paths, tsx перестал разворачивать алиас @/,
# и каждый раннер умирал на импорте repository.ts — ДО первой строчки работы. Вместе с раннерами
# умерли и tp-heartbeat.ts, и tp-pipeline-heartbeat-monitor.ts: они импортируют ровно тот же
# repository.ts. То есть сама система оповещения легла тем же гвоздём, что и то, за чем она следит,
# и в trainingpeaks_cron_run_logs не появилось даже строки status=failed — таблица просто перестала
# расти. Молчание читалось как «событий нет».
#
# Отсюда правило: СТОРОЖ НЕ ДЕЛИТ РАНТАЙМ С ОХРАНЯЕМЫМ. Здесь только bash + curl + date.
# Ни node, ни tsx, ни tsconfig, ни единого импорта из src/. Что бы ни сломалось в TypeScript-части
# репозитория, этот скрипт продолжит работать и продолжит писать в Telegram.
#
# Что делает: смотрит в trainingpeaks_cron_run_logs время ПОСЛЕДНЕГО хартбита каждой критичной
# работы. Молчит дольше порога — шлёт тренеру в Telegram. Читает только SELECT, ничего не пишет в БД.
#
# Использование:
#   ./run-runner-silence-watchdog.sh              # боевой прогон
#   ./run-runner-silence-watchdog.sh --dry-run    # показать вердикт, НИЧЕГО не отправлять

set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
ENV_FILE="$REPO/.env.local"
STATE_DIR="$HOME/Library/Application Support/igor-tp-runner-watchdog"
INTERVAL_MINUTES="${WATCHDOG_INTERVAL_MINUTES:-15}"
ALERT_COOLDOWN_SECONDS="${WATCHDOG_ALERT_COOLDOWN_SECONDS:-10800}" # 3 часа, чтобы не долбить

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# работа:порог_молчания_в_минутах. Порог ~3 пропущенных цикла — тревога значит «правда встало»,
# а не «один прогон разъехался». Каденции: cache/fit/reconcile раз в 30 мин, execute раз в 5 мин.
JOBS="workout_cache_scan:100 fit_ingest_scan:100 club_reconcile_tp:100 club_execute_approved:60"

log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$STATE_DIR" || { log "FATAL: не создать $STATE_DIR"; exit 1; }

if [ ! -f "$ENV_FILE" ]; then
  log "FATAL: нет $ENV_FILE"
  exit 1
fi

# Достаём ТОЛЬКО нужные ключи. Значения живут в переменных и никогда не печатаются.
read_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

SUPABASE_URL="$(read_env SUPABASE_URL)"
SUPABASE_KEY="$(read_env SUPABASE_SERVICE_ROLE_KEY)"
TG_TOKEN="$(read_env TELEGRAM_BOT_TOKEN)"
TG_CHATS="$(read_env TELEGRAM_COACH_CHAT_IDS)"

for pair in "SUPABASE_URL:$SUPABASE_URL" "SUPABASE_SERVICE_ROLE_KEY:$SUPABASE_KEY" "TELEGRAM_BOT_TOKEN:$TG_TOKEN"; do
  if [ -z "${pair#*:}" ]; then
    log "FATAL: в .env.local нет ${pair%%:*}"
    exit 1
  fi
done

# --- защита от сна мака -------------------------------------------------------
# Если мак спал, раннеры законно не работали — но и сторож не работал. Первый прогон после
# пробуждения увидел бы дыру и заорал ложно. Поэтому: если САМ сторож пропустил свои циклы,
# этот раз он только перевзводится и молчит. Через 15 минут он судит уже по свежим данным.
LAST_RUN_FILE="$STATE_DIR/last-run.epoch"
NOW="$(date +%s)"
SKIP_BECAUSE_GAP=false
if [ -f "$LAST_RUN_FILE" ]; then
  LAST_RUN="$(cat "$LAST_RUN_FILE" 2>/dev/null || echo 0)"
  case "$LAST_RUN" in ''|*[!0-9]*) LAST_RUN=0 ;; esac
  if [ "$LAST_RUN" -gt 0 ]; then
    GAP=$(( NOW - LAST_RUN ))
    if [ "$GAP" -gt $(( INTERVAL_MINUTES * 60 * 3 )) ]; then
      SKIP_BECAUSE_GAP=true
      log "сторож сам не работал $(( GAP / 60 )) мин (сон/выключение) — этот цикл только перевзвод, тревог нет"
    fi
  fi
fi
echo "$NOW" > "$LAST_RUN_FILE"

# --- ISO8601 из PostgREST в epoch --------------------------------------------
# Приходит вида 2026-08-11T14:10:18.11685+00:00. Отрезаем дробь и смещение, читаем как UTC.
iso_to_epoch() {
  local iso="${1%%.*}"
  iso="${iso%%+*}"
  iso="${iso%%Z*}"
  date -j -u -f "%Y-%m-%dT%H:%M:%S" "$iso" +%s 2>/dev/null
}

last_heartbeat_epoch() {
  local job="$1" body iso
  body="$(curl -s --max-time 25 --config - <<CURLCFG
url = "$SUPABASE_URL/rest/v1/trainingpeaks_cron_run_logs?select=created_at&job_name=eq.$job&order=created_at.desc&limit=1"
header = "apikey: $SUPABASE_KEY"
header = "Authorization: Bearer $SUPABASE_KEY"
CURLCFG
)"
  [ -z "$body" ] && return 1
  iso="$(printf '%s' "$body" | sed -n 's/.*"created_at":"\([^"]*\)".*/\1/p')"
  [ -z "$iso" ] && return 1
  iso_to_epoch "$iso"
}

send_telegram() {
  local text="$1" chat
  for chat in ${TG_CHATS//,/ }; do
    [ -z "$chat" ] && continue
    curl -s --max-time 25 -o /dev/null \
      --data-urlencode "chat_id=$chat" \
      --data-urlencode "text=$text" \
      "https://api.telegram.org/bot$TG_TOKEN/sendMessage" || true
  done
}

SILENT_REPORT=""
CHECKED=0

for entry in $JOBS; do
  job="${entry%%:*}"
  limit_min="${entry##*:}"
  CHECKED=$(( CHECKED + 1 ))

  hb="$(last_heartbeat_epoch "$job")"
  if [ -z "$hb" ]; then
    log "$job: не смог прочитать хартбит (сеть/БД) — пропускаю, это не повод для тревоги"
    continue
  fi

  age_min=$(( ( NOW - hb ) / 60 ))
  if [ "$age_min" -le "$limit_min" ]; then
    log "$job: ок, молчит $age_min мин (порог $limit_min)"
    continue
  fi

  log "$job: МОЛЧИТ $age_min мин (порог $limit_min)"

  # антидубль: одна тревога на работу раз в ALERT_COOLDOWN_SECONDS
  alert_file="$STATE_DIR/alerted-$job.epoch"
  last_alert=0
  [ -f "$alert_file" ] && last_alert="$(cat "$alert_file" 2>/dev/null || echo 0)"
  case "$last_alert" in ''|*[!0-9]*) last_alert=0 ;; esac
  if [ $(( NOW - last_alert )) -lt "$ALERT_COOLDOWN_SECONDS" ]; then
    log "$job: тревога уже отправлена $(( (NOW - last_alert) / 60 )) мин назад — молчу до конца паузы"
    continue
  fi

  SILENT_REPORT="${SILENT_REPORT}• $job: молчит $age_min мин (порог $limit_min)
"
  $DRY_RUN || echo "$NOW" > "$alert_file"
done

if [ "$CHECKED" -eq 0 ]; then
  log "нечего проверять — список работ пуст"
  exit 0
fi

if [ -z "$SILENT_REPORT" ]; then
  log "все работы живые"
  exit 0
fi

if [ "$SKIP_BECAUSE_GAP" = true ]; then
  log "молчание есть, но сторож сам спал — тревогу не шлю, проверю в следующий цикл"
  exit 0
fi

MESSAGE="Раннеры молчат дольше нормы:

${SILENT_REPORT}
Смотреть: tools/trainingpeaks-export/logs/*.log — если там ERR_MODULE_NOT_FOUND или трассировка на импорте, значит раннер умирает ДО работы и в БД не пишет даже failed."

if $DRY_RUN; then
  log "DRY-RUN, отправки не было. Текст сообщения:"
  echo "---"
  echo "$MESSAGE"
  echo "---"
  exit 0
fi

send_telegram "$MESSAGE"
log "тревога отправлена тренеру"
