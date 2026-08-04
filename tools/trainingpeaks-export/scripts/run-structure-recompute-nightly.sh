#!/bin/bash
# Непрерывный пересчёт структур (Режим A — READ-ONLY к TrainingPeaks). Ночью проверяет плановые
# тренировки на дрейф (порог/описание разошлись со stored %-таргетами), пишет находки в
# tp_structure_recompute_run/_log и шлёт Игорю утреннюю сводку с командой применения.
# В TP САМ НЕ ПИШЕТ — тренер применяет вручную по команде из сводки (tp-threshold-restore).
# Парсер — из общего lib/tp-recompute.ts (не своя копия). Санити-ретрай перечисления внутри джоба.
RUNNER_TIMEOUT_SECONDS=3600
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="${REPO}/tools/trainingpeaks-export"
LOG_DIR="${TOOLS}/logs"
mkdir -p "${LOG_DIR}"
cd "${REPO}" || exit 1

OUT="$(npx tsx "${TOOLS}/scripts/tp-structure-recompute-nightly.ts" 2>&1)"
printf '%s\n' "----- $(date '+%Y-%m-%d %H:%M') -----" "$OUT" >> "${LOG_DIR}/structure-recompute-nightly.log"

# Утренняя сводка в Telegram — только если есть что применить/посмотреть (drift / defer / аномалия).
if printf '%s' "$OUT" | grep -qE "ПЕРЕПРИМЕНИТЬ|РУЧНОЕ|АНОМАЛИЯ"; then
  MSG="$(printf '%s' "$OUT" | sed -n '/═══/,$p')"
  npm --prefix "$TOOLS" run --silent tp-ops-notify -- "$MSG" >/dev/null 2>&1 || true
fi
exit 0
