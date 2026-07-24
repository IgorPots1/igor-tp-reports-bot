#!/bin/bash
# TrainingPeaks FIT-ingest scan — считает derived_metrics из скачанных FIT.
# ИДЁТ СЛЕДОМ за workout-cache-scan: сначала cache-scan скачивает тренировки в кэш,
# потом этот скрипт разбирает их FIT-файлы и считает метрики. Без него enqueue-крон
# видит "scanned:0" (метрики не пересчитаны) — ровно то, что случилось после простоя.
#
# Скользящее окно последних дней (по умолчанию 5): fit нужен только на ПРОШЕДШИЕ
# тренировки, будущих FIT нет. Окно с запасом ловит поздно долитые файлы.
# Использование:
#   PAST_DAYS=5  ./run-fit-ingest-scan.sh          # обычный прогон (плист)
#   PAST_DAYS=14 ./run-fit-ingest-scan.sh          # добор после простоя
#
# ГРАБЛИ (учтены):
#   * Рабочая папка/ветка: REPO=$HOME/igor-tp-reports-bot — служба читает код ИЗ main-папки,
#     а не из feature-worktree. cd "$REPO" ниже фиксирует это.
#   * Окружение службы ≠ терминала: плист запускает через `bash -lc` (login-shell), так
#     что PATH/node/npm подхватываются из профиля, как у cache-scan.
#   * Протухание токена TP: скрипт ходит в TP HTTP API по session-snapshot (bearer
#     авто-рефрешится из cookie). Если cookie мёртв — прогон упадёт с ошибкой авторизации
#     в лог (ниже StandardErrorPath). Лечится вручную: `npm run tp-login` (интерактивно).
#     Автологин здесь НЕ делаем — он требует браузера/человека.
set -euo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
PAST_DAYS="${PAST_DAYS:-5}"

FROM="$(TZ=Europe/Belgrade date -v-"${PAST_DAYS}"d +%F)"
TO="$(TZ=Europe/Belgrade date +%F)"

cd "$REPO"
echo "[$(date '+%F %T')] tp-fit-ingest-scan --from=${FROM} --to=${TO} (все активные)"
exec npm run tp-fit-ingest-scan -- --from="${FROM}" --to="${TO}"
