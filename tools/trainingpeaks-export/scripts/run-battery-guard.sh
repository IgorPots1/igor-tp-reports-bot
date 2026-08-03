#!/bin/bash
# Батарейный сторож. Пайплайн живёт на маке (launchd); если мак на батарее сядет и уснёт —
# службы молча встают (кэш/метрики/очередь/здоровье), как в ночь 27→28.07. Этот сторож шлёт
# Игорю Telegram-алерт ЗАРАНЕЕ (пока мак ещё бодр), чтобы он воткнул зарядку до отвала.
#
# Запускается плистом каждые ~10 мин. Алерт — один раз за «эпизод разряда»:
#   - на батарее и заряд <= WARN (20%)  → предупреждение (маркер .alerted-warn)
#   - на батарее и заряд <= CRIT (10%)  → критично (маркер .alerted-crit)
#   - воткнули зарядку (AC)             → маркеры сбрасываются, следующий разряд снова алертнёт
# ВАЖНО: это не мешает маку спать (это `sudo pmset -c sleep 0` на AC) — только предупреждает.
# Если мак УЖЕ в глубоком сне на батарее, launchd не запустит и сторожа — потому и шлём заранее.
RUNNER_TIMEOUT_SECONDS=120
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="${REPO}/tools/trainingpeaks-export"
LOG_DIR="${TOOLS}/logs"
mkdir -p "${LOG_DIR}"
WARN_MARK="${LOG_DIR}/battery-guard.alerted-warn"
CRIT_MARK="${LOG_DIR}/battery-guard.alerted-crit"

WARN_PCT="${BATTERY_WARN_PCT:-20}"
CRIT_PCT="${BATTERY_CRIT_PCT:-10}"

BATT="$(pmset -g batt 2>/dev/null)"
# источник питания: строка "Now drawing from 'AC Power'" | "'Battery Power'"
SOURCE="$(printf '%s\n' "$BATT" | sed -n "s/.*Now drawing from '\([^']*\)'.*/\1/p" | head -1)"
PCT="$(printf '%s\n' "$BATT" | grep -Eo '[0-9]+%' | head -1 | tr -d '%')"
REMAIN="$(printf '%s\n' "$BATT" | grep -Eo '[0-9]+:[0-9]+ remaining' | head -1)"

# На зарядке (или не смогли прочитать источник) — сбрасываем эпизод и выходим тихо.
case "$SOURCE" in
  *AC*|"") rm -f "$WARN_MARK" "$CRIT_MARK"; exit 0 ;;
esac
[ -z "${PCT:-}" ] && exit 0  # заряд не распарсился — не шумим

notify() { npm --prefix "$TOOLS" run --silent tp-ops-notify -- "$1" >/dev/null 2>&1 || true; }

if [ "$PCT" -le "$CRIT_PCT" ] && [ ! -f "$CRIT_MARK" ]; then
  notify "🔴 Мак на батарее, заряд ${PCT}% (${REMAIN:-?}). КРИТИЧНО — скоро уснёт и пайплайн встанет. Воткни зарядку."
  touch "$CRIT_MARK" "$WARN_MARK"
elif [ "$PCT" -le "$WARN_PCT" ] && [ ! -f "$WARN_MARK" ]; then
  notify "🟡 Мак на батарее, заряд ${PCT}% (${REMAIN:-?}). Скоро уснёт → отчёты/метрики встанут. Воткни зарядку."
  touch "$WARN_MARK"
fi
exit 0
