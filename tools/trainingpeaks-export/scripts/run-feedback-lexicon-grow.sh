#!/bin/bash
# Живой рост словаря голоса (Блок 2+3) — РАЗ В НЕДЕЛЮ. Читает НОВЫЕ sent_text и правки тренера
# (edit_diff) и дополняет локальные артефакты словаря:
#   grow      → living-lexicon.json  (стемы из новых sent_text, порог >=2, каждый с датой)
#   blacklist → blacklist.json candidates (слова, что тренер систематически вырезает)
#
# READ-ONLY по БД (только SELECT). Пишет ТОЛЬКО локальные JSON в репозитории.
# ВАЖНО: словарь бандлится в сборку, поэтому рост применится в прод ТОЛЬКО после commit+deploy
# этих JSON. Раннер лишь копит и подсказывает, что накопилось; пуш/деплой — рука Игоря.
set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] feedback lexicon: grow (7д) + blacklist"
npx --yes tsx scripts/build-feedback-lexicon.ts grow 7 || true
npx --yes tsx scripts/build-feedback-lexicon.ts blacklist || true

# Подсказка: изменились ли словарные файлы (значит есть что закоммитить+задеплоить).
LEX="src/features/trainingpeaks/feedback/lexicon"
if ! git diff --quiet -- "$LEX/living-lexicon.json" "$LEX/blacklist.json" 2>/dev/null; then
  echo "[$(date '+%F %T')] СЛОВАРЬ ВЫРОС — закоммить и задеплой, чтобы применилось:"
  echo "    git add $LEX/living-lexicon.json $LEX/blacklist.json && git commit -m 'chore(lexicon): weekly grow' && git push origin main"
else
  echo "[$(date '+%F %T')] новых слов нет, файлы не изменились"
fi
