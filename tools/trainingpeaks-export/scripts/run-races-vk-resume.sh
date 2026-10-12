#!/bin/bash
# Продолжение обхода ВК после лимита (ошибка 6 или 29). Раз в день; если круг закончен —
# ничего не делает. Кандидатов дописывает в файл того же круга (~/ops-log/races/vk-sweep.json → out),
# их проверит агент еженедельного раннера. В базу ничего не пишет.
RUNNER_TIMEOUT_SECONDS=3600
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
STATE="$HOME/ops-log/races/vk-sweep.json"

if [ ! -f "$STATE" ] || python3 -c "import json,sys; sys.exit(0 if json.load(open('$STATE')).get('done_at') else 1)"; then
  echo "vk-resume: незаконченного круга нет"
  exit 0
fi
cd "$REPO" || exit 1
npx --prefix "$REPO" tsx "$REPO/scripts/races-manual.ts" vk-sweep
CODE=$?
[ "$CODE" -eq 4 ] && echo "vk-resume: снова лимит ВК, продолжу завтра" && exit 0
exit "$CODE"
