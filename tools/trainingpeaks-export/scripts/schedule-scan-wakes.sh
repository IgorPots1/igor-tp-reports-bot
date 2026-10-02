#!/bin/bash
# Плановая побудка Мака под скан кэша тренировок TP (наряд 2026-10-02).
#
# ЗАЧЕМ. Скан стоит в launchd каждые 30 минут, но launchd НЕ будит спящий Мак: 30.09 прошло 4
# прогона из 48, ночью и утром кэш не обновлялся часами, и десктоп показывал вчерашний день по
# устаревшим данным. Нужна побудка в заданные часы — после неё launchd сам запускает пропущенный
# прогон, а обёртка скана держит caffeinate до конца.
#
# ПОЧЕМУ НЕ `pmset repeat`. Он хранит ровно ОДНУ пару повторяющихся событий (одно включение,
# одно выключение) — три побудки в сутки им не задать (man pmset: "you may only have one pair of
# repeating events scheduled"). Поэтому — разовые `pmset schedule wake` на DAYS_AHEAD дней вперёд,
# которые этот скрипт продлевает при каждом запуске. Уже стоящие побудки не дублирует.
#
# Запускается ОТ ROOT (pmset schedule требует root) из LaunchDaemon
# com.igor.trainingpeaks.scan-wakes. Ставится копией в /usr/local/libexec, а не из репозитория:
# root-скрипт, который может править обычный пользователь, — это повышение прав.
#
# Ничего не пишет в базу и в TP, только расписание питания этого Мака.
set -euo pipefail

WAKE_TIMES_UTC="${WAKE_TIMES_UTC:-05:00 11:00 17:00}"
DAYS_AHEAD="${DAYS_AHEAD:-3}"
OWNER="com.igor.trainingpeaks.scan-wake"

if [ "$(id -u)" -ne 0 ]; then
  echo "schedule-scan-wakes: нужен root (pmset schedule)" >&2
  exit 1
fi

NOW_EPOCH="$(date +%s)"
EXISTING="$(pmset -g sched || true)"
ADDED=0
KEPT=0

for DAY in $(seq 0 "$DAYS_AHEAD"); do
  DAY_UTC="$(date -u -v+"${DAY}"d +%Y-%m-%d)"
  for TIME_UTC in $WAKE_TIMES_UTC; do
    EPOCH="$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${DAY_UTC} ${TIME_UTC}:00" +%s)"
    # Прошедшие и ближайшие 2 минуты не ставим: pmset отвергает время в прошлом.
    if [ "$EPOCH" -le $((NOW_EPOCH + 120)) ]; then
      continue
    fi
    # pmset принимает и печатает МЕСТНОЕ время: schedule — "MM/dd/yy HH:mm:ss",
    # pmset -g sched — "MM/dd/yyyy HH:mm:ss". Перевод из UTC — через epoch, так что смена
    # летнего/зимнего времени ничего не ломает.
    LOCAL_SET="$(date -j -r "$EPOCH" "+%m/%d/%y %H:%M:%S")"
    LOCAL_SHOWN="$(date -j -r "$EPOCH" "+%m/%d/%Y %H:%M:%S")"
    if printf '%s\n' "$EXISTING" | grep -F "wake at ${LOCAL_SHOWN}" | grep -qF "$OWNER"; then
      KEPT=$((KEPT + 1))
      continue
    fi
    pmset schedule wake "$LOCAL_SET" "$OWNER"
    ADDED=$((ADDED + 1))
  done
done

echo "[$(date '+%F %T')] schedule-scan-wakes: добавлено ${ADDED}, уже стояло ${KEPT} (UTC: ${WAKE_TIMES_UTC}, дней вперёд: ${DAYS_AHEAD})"
