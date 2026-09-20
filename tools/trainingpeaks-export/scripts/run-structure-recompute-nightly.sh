#!/bin/bash
# Непрерывный пересчёт структур (РЕЖИМ B — авто-применение при чистом sanity). Ночью проверяет
# плановые тренировки на дрейф (порог/описание разошлись со stored %-таргетами), пишет находки в
# tp_structure_recompute_run/_log и при чистом sanity САМ применяет будущий дрейф через
# tp-threshold-restore (его гейты целы). Стоп-условия (не применяю, зову Игоря): доля дрейфа >50%,
# сдвиг >60с, verify_fail, недобор перечисления. Вооружение реальных записей — env TP_STRUCTURE_AUTO_APPLY=1
# (иначе превью). Утренняя сводка — что применил; при нуле молчит. Парсер — из общего lib/tp-recompute.ts.
RUNNER_TIMEOUT_SECONDS=3600
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="${REPO}/tools/trainingpeaks-export"
LOG_DIR="${TOOLS}/logs"
mkdir -p "${LOG_DIR}"
cd "${REPO}" || exit 1

# РЕЖИМ B: --auto-apply включает логику авто-применения. РЕАЛЬНЫЕ записи идут только когда в окружении
# (обычно .env.local) выставлено TP_STRUCTURE_AUTO_APPLY=1 — это рычаг вооружения/kill-switch Игоря.
# Без него джоб печатает «БЫ ПРИМЕНИЛ» (превью) и в TP ничего не пишет. Само применение — через
# проверенный tp-threshold-restore (свои гейты). Джоб в TP напрямую не пишет.
OUT="$(npx tsx "${TOOLS}/scripts/tp-structure-recompute-nightly.ts" --auto-apply 2>&1)"
printf '%s\n' "----- $(date '+%Y-%m-%d %H:%M') -----" "$OUT" >> "${LOG_DIR}/structure-recompute-nightly.log"

# Утренняя сводка в Telegram — джоб сам решает, будить ли тренера, и печатает маркер ⟦NOTIFY⟧
# (что-то применил / стоп-условие / verify_fail / недобор). При нуле маркера нет → молчим.
if printf '%s' "$OUT" | grep -q "⟦NOTIFY⟧"; then
  MSG="$(printf '%s' "$OUT" | sed -n '/═══/,$p' | grep -v '⟦NOTIFY⟧')"
  npm --prefix "$TOOLS" run --silent tp-ops-notify -- "$MSG" >/dev/null 2>&1 || true
fi
exit 0
