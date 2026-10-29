#!/bin/bash
# Уборка диска: рабочие папки (worktree) и кэши сборки не должны забивать диск.
# Раз в день в 13:00 (com.igor.disk-cleanup); если Мак спал — launchd докрутит при пробуждении.
#
# Случай 12.10.2026: за день появилось с десяток worktree по 0,5-1 ГБ (node_modules и .next в
# каждом), свободное место дошло до нуля, и все инструменты встали (ENOSPC).
#
# ЧТО ДЕЛАЕТ:
#   1. worktree, чья ветка уже целиком в origin/main (git cherry пуст) и где нет изменений,
#      удаляет вместе с веткой (git worktree remove без --force, git branch -d);
#   2. в остальных worktree, где больше 3 дней ничего не менялось, удаляет node_modules,
#      .next, .next-admin* — они пересобираются (npm ci, npm run build);
#   3. npm cache verify; логи раннеров старше 30 дней;
#   4. пишет итог в ops-log; если свободно меньше 15 ГБ — сообщение тренеру в Telegram с цифрой
#      и самыми крупными папками.
# ЧЕГО НЕ ДЕЛАЕТ: в основной папке ($REPO) удаляет только .next/cache — .next-admin там живая
# сборка локальной админки; незакоммиченное не трогает нигде; detached-worktree не удаляет;
# ~/Library/Caches/ms-playwright не трогает никогда — это браузер шлюза чтения страниц
# (races-manual.ts read) и раннеров TrainingPeaks: без него понедельничная разведка календаря
# слепнет (29.10.2026 кэш оказался стёрт не этим раннером, но защита — здесь, см. remove_dir).
#
#   run-disk-cleanup.sh            — уборка
#   run-disk-cleanup.sh --dry-run  — только показать, что было бы удалено
RUNNER_TIMEOUT_SECONDS=1800
source "$(dirname "$0")/lib/runner-prelude.sh"

set -uo pipefail

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
TOOLS="$REPO/tools/trainingpeaks-export"
OPSLOG_DIR="$HOME/ops-log/igor-tp-reports-bot"
MIN_FREE_GB="${DISK_MIN_FREE_GB:-15}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

free_kb() { df -k /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}'; }
human() { awk -v k="$1" 'BEGIN { if (k >= 1048576) printf "%.1f ГБ", k/1048576; else printf "%d МБ", k/1024 }'; }

# Удалить папку, только если она внутри $HOME, не сам $HOME и не основная папка целиком.
remove_dir() {
  local d="$1"
  case "$d" in
    "$HOME"/?*) ;;
    *) echo "  пропуск (вне домашней папки): $d"; return ;;
  esac
  [ "$d" = "$REPO" ] && { echo "  пропуск (основная папка): $d"; return; }
  case "$d" in
    "$HOME/Library/Caches/ms-playwright"|"$HOME/Library/Caches/ms-playwright/"*) echo "  пропуск (браузер Playwright): $d"; return ;;
  esac
  [ -e "$d" ] || return
  local size
  size="$(du -sk "$d" 2>/dev/null | cut -f1)"
  if [ "$DRY" = 1 ]; then
    echo "  [dry-run] удалил бы $d ($(human "${size:-0}"))"
  else
    rm -rf -- "$d" && echo "  удалено $d ($(human "${size:-0}"))"
  fi
}

BEFORE="$(free_kb)"
echo "уборка диска: свободно $(human "$BEFORE")$( [ "$DRY" = 1 ] && echo ', ХОЛОСТОЙ ПРОГОН')"

cd "$REPO" || { echo "нет $REPO"; exit 1; }
git fetch origin -q || echo "git fetch не прошёл — сверка влитости по последнему известному origin/main"

REMOVED=()
CLEANED=()
KEPT=()

# --- 1. влитые worktree ---------------------------------------------------------------------
WT_PATH=""
WT_BRANCH=""
flush_worktree() {
  local path="$WT_PATH" branch="$WT_BRANCH"
  WT_PATH=""; WT_BRANCH=""
  [ -z "$path" ] && return
  [ "$path" = "$REPO" ] && return
  [ -d "$path" ] || return
  if [ -z "$branch" ]; then
    KEPT+=("$path (detached)")
    return
  fi
  local dirty unmerged
  dirty="$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  unmerged="$(git cherry origin/main "$branch" 2>/dev/null | grep -c '^+')"
  if [ "$dirty" = 0 ] && [ "$unmerged" = 0 ] && git rev-parse -q --verify "refs/heads/$branch" >/dev/null; then
    if [ "$DRY" = 1 ]; then
      echo "  [dry-run] удалил бы worktree $path и ветку $branch (влита, изменений нет)"
      REMOVED+=("$path [$branch]")
    elif git worktree remove "$path"; then
      if git branch -d "$branch" >/dev/null 2>&1; then
        REMOVED+=("$path [$branch]")
      else
        REMOVED+=("$path [ветка $branch оставлена: git branch -d отказал]")
      fi
      echo "  удалён worktree $path ($branch)"
    else
      KEPT+=("$path [$branch]: git worktree remove отказал")
    fi
  else
    KEPT+=("$path [$branch]: не влито $unmerged, изменений $dirty")
  fi
}

while IFS= read -r line; do
  case "$line" in
    "worktree "*) flush_worktree; WT_PATH="${line#worktree }" ;;
    "branch refs/heads/"*) WT_BRANCH="${line#branch refs/heads/}" ;;
    "") flush_worktree ;;
  esac
done < <(git worktree list --porcelain; echo)
flush_worktree
[ "$DRY" = 1 ] || git worktree prune

# --- 2. кэши в давно не менявшихся worktree ---------------------------------------------------
while IFS= read -r line; do
  case "$line" in "worktree "*) ;; *) continue ;; esac
  path="${line#worktree }"
  [ "$path" = "$REPO" ] && continue
  [ -d "$path" ] || continue
  # Свежий файл (кроме кэшей) за 3 дня — папка в работе, кэши оставляем.
  recent="$(find "$path" \( -name node_modules -o -name '.next*' -o -name graphify-out -o -name .git \) -prune -o -type f -mtime -3 -print -quit 2>/dev/null)"
  [ -n "$recent" ] && continue
  had=0
  for c in node_modules .next .next-admin .next-admin-new .next-admin-old tools/trainingpeaks-export/node_modules; do
    if [ -e "$path/$c" ]; then had=1; remove_dir "$path/$c"; fi
  done
  [ "$had" = 1 ] && CLEANED+=("$path")
done < <(git worktree list --porcelain)

# --- 3. основная папка: только кэш сборки; npm; старые логи ------------------------------------
remove_dir "$REPO/.next/cache"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] npm cache verify; логи старше 30 дней: $(find "$TOOLS/logs" -type f -mtime +30 2>/dev/null | wc -l | tr -d ' ') файлов"
else
  npm cache verify >/dev/null 2>&1 && echo "  npm cache verify: ok"
  OLD_LOGS="$(find "$TOOLS/logs" -type f -mtime +30 -print -delete 2>/dev/null | wc -l | tr -d ' ')"
  echo "  логов старше 30 дней удалено: $OLD_LOGS"
fi

AFTER="$(free_kb)"
FREED=$(( AFTER - BEFORE ))
[ "$FREED" -lt 0 ] && FREED=0
echo "уборка диска: было $(human "$BEFORE"), стало $(human "$AFTER"), освобождено $(human "$FREED")"

# --- 4. ops-log и предупреждение -----------------------------------------------------------------
if [ "$DRY" = 0 ]; then
  mkdir -p "$OPSLOG_DIR"
  STAMP="$(date '+%Y-%m-%d-%H%M')"
  F="$OPSLOG_DIR/$STAMP-disk-cleanup.md"
  [ -e "$F" ] && F="$OPSLOG_DIR/$STAMP-disk-cleanup-2.md"
  {
    echo "Дата: $(date '+%Y-%m-%d %H:%M')"
    echo "Задача: автоуборка диска (run-disk-cleanup.sh)"
    echo "Изменения: свободно было $(human "$BEFORE"), стало $(human "$AFTER"), освобождено $(human "$FREED")"
    echo "Решения: удалено worktree ${#REMOVED[@]}: ${REMOVED[*]:-нет}; кэши почищены в ${#CLEANED[@]}: ${CLEANED[*]:-нет}"
    echo "Открыто: оставлены ${#KEPT[@]}: ${KEPT[*]:-нет}"
    echo "Ветка: нет (раннер)"
  } > "$F"
  echo "ops-log: $F"
fi

LIMIT_KB=$(( MIN_FREE_GB * 1048576 ))
if [ "$AFTER" -lt "$LIMIT_KB" ]; then
  TOP="$(du -sk "$HOME"/* 2>/dev/null | sort -rn | head -6 | awk '{ printf "%s %s\n", ($1>=1048576 ? sprintf("%.1f ГБ", $1/1048576) : sprintf("%d МБ", $1/1024)), $2 }' | sed "s|$HOME|~|")"
  MSG="⚠️ Мало места на диске: свободно $(human "$AFTER") (порог $MIN_FREE_GB ГБ) после уборки.
Крупные папки:
$TOP"
  echo "$MSG"
  if [ "$DRY" = 0 ]; then
    npm --prefix "$TOOLS" run --silent tp-ops-notify -- "$MSG" >/dev/null 2>&1 || echo "  Telegram: не отправилось"
  fi
fi

exit 0
