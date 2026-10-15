#!/bin/bash
# Ротация логов launchd-раннеров (наряд 15.10.2026): логи растут без ограничений, на 16 ГБ Air место
# уходит и без того. Раз в сутки (com.igor.runner-log-rotation, 04:15): файл больше порога →
# <файл>.1.gz, старые архивы сдвигаются (.1 → .2 → .3), хранится не больше KEEP архивов.
#
# КАКИЕ ФАЙЛЫ: только те, что пишут launchd-раннеры — StandardOutPath/StandardErrorPath из
# ~/Library/LaunchAgents/*.plist, и только в ~/Library/Logs и tools/trainingpeaks-export/logs.
# Список читается при каждом запуске: новый раннер попадает в ротацию сам.
#
# РАННЕРЫ НЕ ПЕРЕЗАПУСКАЮТСЯ (copytruncate): launchd открывает лог на дозапись (O_APPEND), поэтому
# файл можно обнулить на месте, раннер продолжит писать в его начало. Записи не теряются: копия
# снимается до размера s1, затем ОДИН процесс (perl) дочитывает хвост, дописанный за время копирования,
# и тут же обнуляет файл. Окно потери — между последним read и truncate внутри perl, микросекунды.
# Было (первый вариант 15.10.2026): хвост догонялся через tail | head, обнуление — отдельной командой;
# на пробе с писателем 50 строк/мс терялось ~10 мс записи (474 строки из 30 000) — запуск процессов.
#
#   rotate-runner-logs.sh [--dry-run] [--threshold-mb 20] [--keep 3] [--file <путь> …]
#     --dry-run   только показать, что было бы сделано
#     --file      ротировать указанные файлы вместо списка из plist (пробный прогон на копии)

set -u
THRESHOLD_MB=20
KEEP=3
DRY=0
FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --threshold-mb) THRESHOLD_MB="$2"; shift ;;
    --keep) KEEP="$2"; shift ;;
    --file) FILES+=("$2"); shift ;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
  shift
done

LOG_DIRS=("$HOME/Library/Logs" "$HOME/igor-tp-reports-bot/tools/trainingpeaks-export/logs")
LIMIT=$((THRESHOLD_MB * 1024 * 1024))
ts() { date "+%Y-%m-%d %H:%M:%S"; }
size() { stat -f%z "$1" 2>/dev/null || echo 0; }

if [ ${#FILES[@]} -eq 0 ]; then
  while IFS= read -r p; do
    for d in "${LOG_DIRS[@]}"; do
      case "$p" in "$d"/*) FILES+=("$p") ;; esac
    done
  done < <(for pl in "$HOME"/Library/LaunchAgents/*.plist; do
    for k in StandardOutPath StandardErrorPath; do /usr/libexec/PlistBuddy -c "Print :$k" "$pl" 2>/dev/null; done
  done | sort -u)
fi

rotated=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  s1=$(size "$f")
  [ "$s1" -gt "$LIMIT" ] || continue
  if [ "$DRY" = 1 ]; then
    echo "[$(ts)] (пробно) $f: $((s1 / 1048576)) МБ → $f.1.gz"
    continue
  fi
  # сдвиг архивов: .KEEP удаляется, .(n) → .(n+1)
  rm -f "$f.$KEEP.gz"
  for ((n = KEEP - 1; n >= 1; n--)); do
    [ -f "$f.$n.gz" ] && mv -f "$f.$n.gz" "$f.$((n + 1)).gz"
  done
  # copytruncate с догонкой хвоста
  head -c "$s1" "$f" > "$f.1" || { echo "[$(ts)] ОШИБКА копии $f" >&2; continue; }
  perl -e '
    my ($f, $out, $s1) = @ARGV;
    open(my $in, "<", $f) or die "чтение $f: $!";
    open(my $o, ">>", $out) or die "запись $out: $!";
    binmode $in; binmode $o;
    seek($in, $s1, 0);
    my $buf;
    while (read($in, $buf, 1 << 20)) { print $o $buf; }
    truncate($f, 0) or die "обнуление $f: $!";
    close $o;
  ' "$f" "$f.1" "$s1" || { echo "[$(ts)] ОШИБКА догонки/обнуления $f (лог не тронут, копия $f.1)" >&2; continue; }
  s2=$(size "$f.1")
  gzip -6 "$f.1" && gzip -t "$f.1.gz" || { echo "[$(ts)] ОШИБКА gzip $f.1" >&2; continue; }
  echo "[$(ts)] $f: $((s2 / 1048576)) МБ → $f.1.gz ($(( $(size "$f.1.gz") / 1048576 )) МБ), архивов не больше $KEEP"
  rotated=$((rotated + 1))
done
echo "[$(ts)] ротация: файлов в списке ${#FILES[@]}, ротировано $rotated (порог $THRESHOLD_MB МБ)"
