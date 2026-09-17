#!/bin/bash
# Пересобирает локальную админку (com.igor.coachos.localadmin) в отдельный
# distDir (.next-admin) и атомарно подменяет живую сборку, с health-check и
# откатом при неудаче. НЕ трогает .next (обычный `npm run dev` / Vercel),
# НЕ делает никаких git-команд кроме чтения статуса.
set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR" || exit 1

LOG="$HOME/ops-log/igor-tp-reports-bot/localadmin-rebuild.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "=== localadmin-rebuild $(date) ==="

LABEL="com.igor.coachos.localadmin"
LOCKDIR="/tmp/localadmin-rebuild.lock"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  OLD_PID=$(cat "$LOCKDIR/pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "СТОП: другой rebuild уже идёт (PID $OLD_PID). Выход."
    exit 1
  fi
  echo "Протухший lock найден (PID $OLD_PID не жив) — забираю его."
  rm -r -f "$LOCKDIR"
  mkdir "$LOCKDIR"
fi
echo $$ > "$LOCKDIR/pid"
trap 'rm -r -f "$LOCKDIR"' EXIT

COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
SUBJECT=$(git log -1 --format=%s 2>/dev/null)
echo "Каталог: $REPO_DIR"
echo "Собираю с коммита: $COMMIT ($SUBJECT)"

DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "В $REPO_DIR есть незакоммиченные изменения — сборка включит их в себя:"
  echo "$DIRTY"
  read -r -p "Продолжить сборку с незакоммиченными правками? [y/N] " ANSWER
  case "$ANSWER" in
    y|Y) echo "Продолжаю с текущим рабочим деревом (незакоммиченное войдёт в сборку)." ;;
    *) echo "Отменено. Закоммить или отложи правки и запусти снова."; exit 1 ;;
  esac
fi

rm -r -f .next-admin-new
mkdir -p .next-admin-new
if [ -d .next-admin/cache ]; then
  echo "Переношу webpack-кэш из предыдущей сборки (ускоряет компиляцию)."
  cp -R .next-admin/cache .next-admin-new/cache
fi

echo "Сборка: NEXT_DIST_DIR=.next-admin-new next build ..."
if ! NEXT_DIST_DIR=.next-admin-new npx next build; then
  echo "FAIL: сборка упала. .next-admin и работающая админка НЕ тронуты."
  rm -r -f .next-admin-new
  exit 1
fi
echo "Сборка ОК."

HAD_OLD=false
if [ -d .next-admin ]; then
  rm -r -f .next-admin-old
  mv .next-admin .next-admin-old
  HAD_OLD=true
fi
mv .next-admin-new .next-admin

echo "Перезапускаю сервис: launchctl kickstart -k gui/$(id -u)/$LABEL"
KICKSTART_TS=$(date +%s)
launchctl kickstart -k "gui/$(id -u)/$LABEL"

HEALTHY=false
PID_AT_200=""
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3005" 2>/dev/null)
  if [ "$CODE" = "200" ]; then
    PID_AT_200=$(launchctl list | awk -v l="$LABEL" '$3==l{print $1}')
    HEALTHY=true
    echo "200 на http://127.0.0.1:3005 через $i с (PID $PID_AT_200)."
    break
  fi
  sleep 1
done

if ! $HEALTHY; then
  echo "FAIL: за 60с не дождался 200 на http://127.0.0.1:3005."
fi

if $HEALTHY; then
  ELAPSED=$(( $(date +%s) - KICKSTART_TS ))
  if [ "$ELAPSED" -lt 20 ]; then
    sleep $((20 - ELAPSED))
  fi
  PID_AT_20S=$(launchctl list | awk -v l="$LABEL" '$3==l{print $1}')
  if [ -z "$PID_AT_20S" ] || [ "$PID_AT_20S" = "-" ] || [ "$PID_AT_20S" != "$PID_AT_200" ]; then
    HEALTHY=false
    echo "FAIL: процесс не пережил 20с стабильно (PID был $PID_AT_200, сейчас $PID_AT_20S)."
    echo "Похоже на цикл падений KeepAlive — считаю сборку нездоровой."
  else
    echo "PID стабилен ($PID_AT_20S) спустя 20с после kickstart."
  fi
fi

if $HEALTHY; then
  echo "OK: сборка $COMMIT работает и прошла health-check."
  if $HAD_OLD; then
    rm -r -f .next-admin-old
    echo "Старая сборка (.next-admin-old) удалена."
  fi
  echo "Кэш .next-admin/cache сохранён для следующей пересборки."
  echo "=== localadmin-rebuild: УСПЕХ ($COMMIT) ==="
else
  echo "Откатываю на предыдущую сборку..."
  rm -r -f .next-admin
  if $HAD_OLD; then
    mv .next-admin-old .next-admin
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "Откат выполнен, предыдущая сборка восстановлена и перезапущена."
  else
    echo "ВНИМАНИЕ: предыдущей сборки не было (это был первый запуск) — откатывать не на что."
    echo "Админка сейчас, вероятно, не отвечает. Нужно вмешательство вручную."
  fi
  echo "=== localadmin-rebuild: ПРОВАЛ ($COMMIT) ==="
  exit 1
fi
