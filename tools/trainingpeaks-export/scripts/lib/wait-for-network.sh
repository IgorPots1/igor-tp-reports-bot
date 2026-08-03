#!/bin/bash
# Ждёт, пока поднимется сеть до Supabase, и только тогда пускает раннер к работе.
#
# ЗАЧЕМ. Мак спит. При пробуждении launchd запускает пропущенные джобы НЕМЕДЛЕННО, до того как
# поднимется Wi-Fi, и раннер падает на «TypeError: fetch failed» — не потому что что-то сломано,
# а потому что стартовал на три секунды раньше сети. В логах это неотличимо от настоящей аварии.
#
# Пробуем именно тот хост, к которому пойдёт работа ($SUPABASE_URL), а не ping и не DNS: DNS может
# резолвиться, когда TLS ещё не проходит.
#
# КОД ВОЗВРАТА. Не дождались — 0, а не 1. У StartInterval-раннеров следующий тик придёт сам через
# 10-30 минут, а красный код в launchctl только замаскирует настоящие поломки. Для
# StartCalendarInterval-раннеров пропуск означает пропуск до завтра — это осознанный размен:
# лучше честный пропуск в логе, чем прогон, который гарантированно упадёт и запишет мусор.
#
# Использование — первой строкой в обёртке:
#   "$(dirname "$0")/lib/wait-for-network.sh" || exit 0
set -uo pipefail

ATTEMPTS=6
BACKOFF=(5 10 20 40 60 60)
PROBE_TIMEOUT=5

# .env.local нужен только ради SUPABASE_URL; значение не печатаем никуда.
if [ -z "${SUPABASE_URL:-}" ] && [ -f "$HOME/igor-tp-reports-bot/.env.local" ]; then
  SUPABASE_URL="$(grep -m1 '^SUPABASE_URL=' "$HOME/igor-tp-reports-bot/.env.local" | cut -d= -f2- | tr -d '"'"'"' ')"
fi

if [ -z "${SUPABASE_URL:-}" ]; then
  echo "[wait-for-network] SUPABASE_URL не найден — пробу пропускаю, пускаю прогон как есть"
  exit 0
fi

for i in $(seq 1 "${ATTEMPTS}"); do
  if curl -sS -o /dev/null --max-time "${PROBE_TIMEOUT}" --head "${SUPABASE_URL}/rest/v1/" 2>/dev/null; then
    [ "$i" -gt 1 ] && echo "[wait-for-network] сеть поднялась с попытки ${i}"
    exit 0
  fi
  WAIT="${BACKOFF[$((i-1))]}"
  if [ "$i" -lt "${ATTEMPTS}" ]; then
    echo "[wait-for-network] попытка ${i}/${ATTEMPTS}: сети нет, жду ${WAIT} с"
    sleep "${WAIT}"
  fi
done

echo "[wait-for-network] сеть не поднялась за ${ATTEMPTS} попыток, пропускаю прогон"
exit 1
