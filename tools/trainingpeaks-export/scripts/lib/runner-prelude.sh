#!/bin/bash
# Общий пролог для обёрток раннеров. Подключается одной строкой сразу после `set -euo pipefail`:
#
#   source "$(dirname "$0")/lib/runner-prelude.sh"
#
# Делает три вещи, каждая — ответ на конкретный случай 2026-08-03:
#
#  1. ШТАМП ВРЕМЕНИ на stdout и stderr. В логах раннеров не было отметок времени вообще, и по
#     логу нельзя было сказать, когда именно случился сбой. Штампуем один раз здесь, а не в
#     тринадцати местах. Обёртки, где штамп уже есть (run-club-reconcile-tp.sh,
#     run-custom-metrics-profile-sync-weekly.sh), просто не подключают пролог.
#
#  2. ОЖИДАНИЕ СЕТИ. Мак спит; при пробуждении launchd стартует пропущенное до поднятия Wi-Fi.
#     Не дождались — выходим 0 (см. wait-for-network.sh про выбор кода).
#
#  2б. РАЗВОДКА ПОСЛЕ ПРОБУЖДЕНИЯ (аудит 2026-10-11): старт в первые 2 мин после пробуждения ждёт
#     случайные 0…RUNNER_WAKE_JITTER_MAX_SECONDS, чтобы пропущенные во сне прогоны не шли пачкой.
#
#  3. ТАЙМАУТ ПРОГОНА. 03.08 в 14:20 health-metrics-scan запустился и не закончился: строки
#     Finished в логе нет, кода выхода нет, хартбита нет — зависший процесс невидим и держит
#     слот до бесконечности. RUNNER_TIMEOUT_SECONDS (по умолчанию 1800) убивает такой прогон и
#     пишет в лог явную причину. Раннер задаёт свой лимит ДО подключения пролога:
#       RUNNER_TIMEOUT_SECONDS=3600
#       source ".../lib/runner-prelude.sh"

# --- 1. штамп времени -------------------------------------------------------------------------
# Оба потока проходят через один фильтр, поэтому порядок строк сохраняется.
# Строки, которые УЖЕ начинаются с отметки вида [2026-08-03 ...], пропускаем как есть: половина
# обёрток печатает собственные Starting/Finished со своей датой, и второй штамп поверх был бы
# просто мусором.
if [ -z "${RUNNER_PRELUDE_STAMPED:-}" ]; then
  export RUNNER_PRELUDE_STAMPED=1
  exec > >(while IFS= read -r line; do
      if [[ "$line" == \[2???-* ]]; then
        printf '%s\n' "$line"
      else
        printf '[%s] %s\n' "$(date '+%F %T')" "$line"
      fi
    done) 2>&1
fi

# --- 2. сеть ----------------------------------------------------------------------------------
RUNNER_PRELUDE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! "${RUNNER_PRELUDE_DIR}/wait-for-network.sh"; then
  echo "[runner] сеть не поднялась, прогон пропущен"
  exit 0
fi

# --- 2б. разводка после пробуждения -----------------------------------------------------------
# Аудит 11.10: при пробуждении launchd докручивает все пропущенные во сне прогоны РАЗОМ (в 11:04:42
# скан кэша стартовал в ту же секунду, voice-worker через 12 с, fit-ingest через 19 с), и они
# вместе бьют в базу. Если прогон стартует в первые 2 минуты после пробуждения — ждём случайные
# 0…RUNNER_WAKE_JITTER_MAX_SECONDS (по умолчанию 300). Обычные прогоны по расписанию не ждут.
# На время ожидания и прогона держим Мак бодрым (caffeinate -i до выхода этого процесса):
# техническое пробуждение длится секунды, и без этого Мак уснул бы посреди ожидания.
# Частые лёгкие раннеры (voice-worker, battery-guard, club-execute-approved) ставят 0 до пролога.
RUNNER_WAKE_JITTER_MAX_SECONDS="${RUNNER_WAKE_JITTER_MAX_SECONDS:-300}"
if [ "${RUNNER_WAKE_JITTER_MAX_SECONDS}" -gt 0 ] 2>/dev/null; then
  RUNNER_WAKE_AT="$(sysctl -n kern.waketime 2>/dev/null | sed -nE 's/.*[{ ]sec = ([0-9]+),.*/\1/p')"
  RUNNER_NOW="$(date +%s)"
  if [ -n "${RUNNER_WAKE_AT}" ] && [ $((RUNNER_NOW - RUNNER_WAKE_AT)) -ge 0 ] && [ $((RUNNER_NOW - RUNNER_WAKE_AT)) -lt 120 ]; then
    RUNNER_WAKE_DELAY=$((RANDOM % (RUNNER_WAKE_JITTER_MAX_SECONDS + 1)))
    caffeinate -i -w "$$" >/dev/null 2>&1 &
    echo "[runner] старт через $((RUNNER_NOW - RUNNER_WAKE_AT)) с после пробуждения: задержка ${RUNNER_WAKE_DELAY} с, чтобы не идти пачкой"
    sleep "${RUNNER_WAKE_DELAY}"
  fi
fi

# --- 3. таймаут прогона -----------------------------------------------------------------------
# Сторож живёт в фоне: спит отведённое время и, если основной процесс ещё жив, валит всю группу.
# Сначала TERM (дать шанс закрыть браузер и дописать лог), через 20 с — KILL.
RUNNER_TIMEOUT_SECONDS="${RUNNER_TIMEOUT_SECONDS:-1800}"
if [ "${RUNNER_TIMEOUT_SECONDS}" -gt 0 ] 2>/dev/null; then
  (
    sleep "${RUNNER_TIMEOUT_SECONDS}"
    if kill -0 "$$" 2>/dev/null; then
      echo "[runner] ТАЙМАУТ: прогон идёт дольше ${RUNNER_TIMEOUT_SECONDS} с, убиваю (SIGTERM)"
      # Дать фильтру штампа дописать строку выше: он живёт в той же группе и умрёт вместе с ней,
      # а причина смерти прогона обязана остаться в логе — иначе зависший прогон снова станет
      # невидимым, ровно как 03.08 в 14:20.
      sleep 1
      kill -TERM -"$$" 2>/dev/null || kill -TERM "$$" 2>/dev/null
      sleep 20
      if kill -0 "$$" 2>/dev/null; then
        echo "[runner] ТАЙМАУТ: не завершился по SIGTERM, добиваю (SIGKILL)"
        kill -KILL -"$$" 2>/dev/null || kill -KILL "$$" 2>/dev/null
      fi
    fi
  ) &
  RUNNER_TIMEOUT_WATCHDOG_PID=$!
  # Сторож не должен пережить нормально завершившийся прогон.
  trap 'kill "${RUNNER_TIMEOUT_WATCHDOG_PID}" 2>/dev/null || true' EXIT
fi
