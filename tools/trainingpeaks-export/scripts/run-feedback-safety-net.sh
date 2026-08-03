#!/bin/bash
# Feedback safety-net + recall monitor — ОДИН РАЗ В ДЕНЬ. Показывает беговые за 3 дня, про
# которые ученик что-то писал, но черновика нет (отчёт, который метка не поймала), — чтобы
# пропущенный отчёт не исчезал молча. Плюс два числа (распознано/пропущено) = мониторинг
# полноты: растёт доля пропущенного → метка деградирует.
#
# READ-ONLY (в БД не пишет, ученикам не шлёт, генерации нет). Шлёт ОДНУ строку тренеру в Telegram.
# Рабочая папка REPO=$HOME/igor-tp-reports-bot (код из main, не worktree), как у остальных служб.
RUNNER_TIMEOUT_SECONDS=1800
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="tools/trainingpeaks-export"

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] feedback safety-net digest"
npm --prefix "$TOOLS" run --silent tp-feedback-safety-net || true

# Pipeline staleness monitor: last-success age per data flow → Telegram alert if a flow is silent.
echo "[$(date '+%F %T')] pipeline heartbeat monitor"
npm --prefix "$TOOLS" run --silent tp-pipeline-heartbeat-monitor || true

# Хартбит: отметка «прогон состоялся» в trainingpeaks_cron_run_logs, чтобы монитор
# отличал живой поток от тихо вставшего. `|| true` — отметка не важнее самой работы;
# сбой записи виден в логе (tp-heartbeat печатает причину и не глотает её).
npm --prefix "$HOME/igor-tp-reports-bot/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=feedback_safety_net --status=sent || true
