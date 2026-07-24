#!/bin/bash
# TrainingPeaks FIT-ingest scan + feedback-enqueue — ОДНА служба, весь хвост трубы.
# ИДЁТ СЛЕДОМ за workout-cache-scan: cache-scan скачивает тренировки в кэш → этот скрипт
# считает из них derived_metrics → и СРАЗУ САМ дёргает enqueue (кладёт новые тренировки
# в «Новые»). Ноль кронов на Vercel: enqueue едет на маке, не по расписанию Vercel.
# Генерация остаётся кнопкой Игоря (Вариант Б) — здесь её нет.
#
# Скользящее окно последних дней (по умолчанию 5): fit нужен только на ПРОШЕДШИЕ
# тренировки. Окно с запасом ловит поздно долитые файлы.
# Использование:
#   PAST_DAYS=5  ./run-fit-ingest-scan.sh          # обычный прогон (плист)
#   PAST_DAYS=14 ./run-fit-ingest-scan.sh          # добор после простоя
#
# ГРАБЛИ (учтены):
#   * Рабочая папка/ветка: REPO=$HOME/igor-tp-reports-bot — служба читает код ИЗ main-папки,
#     а не из feature-worktree. cd "$REPO" ниже фиксирует это.
#   * Окружение службы ≠ терминала: плист запускает через `bash -lc` (login-shell), так
#     что PATH/node/npm подхватываются из профиля, как у cache-scan.
#   * Протухание токена TP: если fit-ingest упал с ошибкой авторизации — шлём Игорю
#     Telegram-алерт «перелогинься» (tp-ops-notify), чтобы не узнавать через день по
#     пустому списку. Автологин НЕ делаем — он требует браузера/человека.
set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
PAST_DAYS="${PAST_DAYS:-5}"
TOOLS="tools/trainingpeaks-export"

FROM="$(TZ=Europe/Belgrade date -v-"${PAST_DAYS}"d +%F)"
TO="$(TZ=Europe/Belgrade date +%F)"

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

# 1) FIT-ingest — считаем метрики. Ловим и код выхода, и вывод (для детекта авторизации).
echo "[$(date '+%F %T')] tp-fit-ingest-scan --from=${FROM} --to=${TO} (все активные)"
FIT_OUT="$(npm run --silent tp-fit-ingest-scan -- --from="${FROM}" --to="${TO}" 2>&1)"
FIT_CODE=$?
printf '%s\n' "$FIT_OUT"

if [ "$FIT_CODE" -ne 0 ]; then
  # Похоже на смерть TP-сессии? → Telegram-алерт «перелогинься».
  if printf '%s' "$FIT_OUT" | grep -qiE '401|403|unauthor|forbidden|bearer|session|cookie|re-?login|not logged'; then
    echo "[$(date '+%F %T')] FIT-ingest: похоже на мёртвую TP-сессию — шлю алерт"
    npm --prefix "$TOOLS" run --silent tp-ops-notify -- \
      "⚠️ TP-сессия, похоже, умерла: fit-ingest не смог посчитать метрики, список не обновляется. Перелогинься: cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npm run tp-login" || true
  fi
  echo "[$(date '+%F %T')] FIT-ingest упал (код ${FIT_CODE}) — enqueue пропускаю"
  exit "$FIT_CODE"
fi

# 2) Метрики посчитаны → тем же прогоном кладём новые тренировки в «Новые».
echo "[$(date '+%F %T')] enqueue (кладём новые тренировки в список)"
npm --prefix "$TOOLS" run --silent tp-feedback-enqueue-run
