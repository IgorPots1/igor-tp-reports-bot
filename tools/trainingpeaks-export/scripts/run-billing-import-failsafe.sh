#!/bin/bash
# Подстраховка импорта платежей: раз в сутки проверяет, был ли успешный прогон за 26 часов,
# и если не было — дёргает production-маршрут сам. Vercel остаётся основным.
# Задвоить платежи нельзя: повторы отсекаются по external_hash на уровне вложений.
RUNNER_TIMEOUT_SECONDS=900
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail
REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="tools/trainingpeaks-export"
cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] billing import failsafe"
npm --prefix "$TOOLS" run --silent tp-billing-import-failsafe || true

npm --prefix "$TOOLS" run --silent tp-heartbeat -- --job=billing_import_failsafe --status=sent || true
