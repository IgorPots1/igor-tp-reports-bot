#!/bin/bash
# Проверка: могут ли боевые раннеры вообще загрузиться.
#
# ЗАЧЕМ. 11.08.2026 прод лежал 3 часа. Коммит завёл tools/trainingpeaks-export/tsconfig.json без
# блока paths — tsx перестал разворачивать алиас @/, и раннеры стали умирать на импорте
# repository.ts, ДО первой строчки работы. Ни один существующий чек этого не ловил: lint зелёный,
# tsc зелёный, build зелёный — потому что все они проверяют ТИПЫ, а сломалось РАЗРЕШЕНИЕ МОДУЛЕЙ
# в рантайме. Поймать это можно только одним способом: реально попробовать загрузиться.
#
# Мало того, авария была невидимой: tp-heartbeat.ts импортирует тот же repository.ts и лёг вместе
# с раннерами, поэтому в БД не появилось даже строки failed. Отсюда два вывода, и этот чек — первый:
#   1) поломку ловим ДО коммита (этот скрипт);
#   2) если всё же уехало — узнаём из Telegram (run-runner-silence-watchdog.sh).
#
# ДВА МЕХАНИЗМА, ОБА ОБЯЗАТЕЛЬНЫ. В репозитории уживаются два разных способа разрешать @/, и в ту
# аварию сломался ровно один из них — поэтому часть раннеров умерла целиком, а часть продолжала
# работать и только не отчитывалась. Проверяем оба:
#   - tsx, cwd = tools/trainingpeaks-export  (workout-cache-scan, fit-ingest-scan, health-metrics-scan)
#   - node + scripts/_alias-loader.mjs, cwd = корень репозитория  (club-reconcile-tp, club-execute-approved)
# Загрузчик берёт src из process.cwd(), а tsx — tsconfig по расположению файла, поэтому и каталог
# запуска, и место пробы здесь не случайны: они повторяют боевые условия.
#
# Использование: npm run check:runner-import-health

set -uo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PROBE_REL="tools/trainingpeaks-export/scripts/lib/runner-import-probe.mts"
FAILED=0

if [ ! -f "$REPO/$PROBE_REL" ]; then
  echo "FAIL: нет файла пробы $PROBE_REL"
  exit 1
fi

run_case() {
  local title="$1" out code
  shift
  out="$("$@" 2>&1)"
  code=$?
  if [ "$code" -eq 0 ] && printf '%s' "$out" | grep -q "PROBE OK"; then
    echo "ok   $title -- $(printf '%s' "$out" | grep -o 'PROBE OK.*')"
    return 0
  fi
  FAILED=1
  echo "FAIL $title (код $code)"
  printf '%s\n' "$out" | grep -vE "ExperimentalWarning|trace-warnings|^--import|^\(Use " | head -8 | sed 's/^/       /'
  if printf '%s' "$out" | grep -q "Cannot find package '@/"; then
    echo "       ДИАГНОЗ: алиас @/ не разворачивается. Для tsx смотри paths в"
    echo "       tools/trainingpeaks-export/tsconfig.json; для загрузчика — scripts/_alias-loader.mjs."
    echo "       Именно это положило прод 11.08. НЕ игнорировать: раннеры молча умрут на импорте."
  fi
  return 1
}

echo "== разрешение модулей у боевых раннеров =="

run_case "tsx (cwd=tools/trainingpeaks-export)" \
  env -C "$REPO/tools/trainingpeaks-export" npx --no-install tsx "scripts/lib/runner-import-probe.mts"

run_case "node + _alias-loader (cwd=корень)" \
  env -C "$REPO" node --experimental-strip-types --loader ./scripts/_alias-loader.mjs "$PROBE_REL"

if [ "$FAILED" -ne 0 ]; then
  echo
  echo "ИТОГ: раннеры НЕ загрузятся. Это не про типы — это про рантайм, и в бою выглядит как тишина."
  exit 1
fi

echo "ИТОГ: оба механизма разрешения живые."
