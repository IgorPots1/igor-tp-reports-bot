#!/bin/bash
# Feedback safety-net + recall monitor — ОДИН РАЗ В ДЕНЬ. Показывает беговые за 3 дня, про
# которые ученик что-то писал, но черновика нет (отчёт, который метка не поймала), — чтобы
# пропущенный отчёт не исчезал молча. Плюс два числа (распознано/пропущено) = мониторинг
# полноты: растёт доля пропущенного → метка деградирует.
#
# READ-ONLY (в БД не пишет, ученикам не шлёт, генерации нет). Шлёт ОДНУ строку тренеру в Telegram.
# Рабочая папка REPO=$HOME/igor-tp-reports-bot (код из main, не worktree), как у остальных служб.
set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="tools/trainingpeaks-export"

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] feedback safety-net digest"
npm --prefix "$TOOLS" run --silent tp-feedback-safety-net || true
