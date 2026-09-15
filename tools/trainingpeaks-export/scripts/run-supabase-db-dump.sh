#!/bin/bash
# Daily prod DB dump — Free-tier Supabase has NO automatic backups (naряд telegram-context-and-voice,
# 2026-09-15: a migration was applied earlier that day with no backup in front of it — this closes
# that gap going forward). Auth via SUPABASE_ACCESS_TOKEN (a personal access token, read automatically
# by the Supabase CLI for non-interactive use — never the raw Postgres password, per Igor's choice).
#
# `supabase db dump` is read-only against the project (a pg_dump under the hood) — it never applies
# anything. deny-guard.sh carries a point exception for exactly this subcommand; `db push`/`db reset`
# stay blocked.
#
# TWO CALLS, ON PURPOSE: `supabase db dump` with no flags dumps SCHEMA ONLY — Supabase's own docs say
# so explicitly ("The default dump does not contain any data or custom roles"), and the first live
# run here (2026-09-15) confirmed it empirically: 464K, zero `COPY` statements. A schema-only backup
# is useless for the actual purpose (rolling back a bad backfill needs the DATA), so this runs a
# second pass with --data-only --use-copy and concatenates schema+data into one file.
set -uo pipefail
RUNNER_TIMEOUT_SECONDS=600
source "$(dirname "$0")/lib/runner-prelude.sh"

REPO="${REPO:-$HOME/igor-tp-reports-bot}"
PROJECT_REF="wlbswdnpqrcdaqwlfnoo"
DUMP_DIR="$HOME/ops-log/igor-tp-reports-bot/db-dumps"
KEEP_DAYS=7

mkdir -p "$DUMP_DIR"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "[$(date '+%F %T')] SUPABASE_ACCESS_TOKEN не задан — дамп пропущен"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-ops-notify -- \
    "🔴 Дамп прод-БД пропущен: SUPABASE_ACCESS_TOKEN не задан в .env.local" >/dev/null 2>&1 || true
  exit 1
fi

DUMP_FILE="$DUMP_DIR/dump-$(date '+%Y-%m-%d').sql"
SCHEMA_TMP="$DUMP_FILE.schema.tmp"
DATA_TMP="$DUMP_FILE.data.tmp"

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] supabase db dump --linked (схема) -> $SCHEMA_TMP"
if ! npx --yes supabase db dump --linked --project-ref "$PROJECT_REF" -f "$SCHEMA_TMP"; then
  echo "[$(date '+%F %T')] supabase db dump (схема) упал"
  rm -f "$SCHEMA_TMP" "$DATA_TMP"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-ops-notify -- \
    "🔴 Дамп прод-БД упал (схема) — проверь run-supabase-db-dump.sh вручную" >/dev/null 2>&1 || true
  exit 1
fi

echo "[$(date '+%F %T')] supabase db dump --linked --data-only (данные) -> $DATA_TMP"
if ! npx --yes supabase db dump --linked --project-ref "$PROJECT_REF" --data-only --use-copy -f "$DATA_TMP"; then
  echo "[$(date '+%F %T')] supabase db dump (данные) упал"
  rm -f "$SCHEMA_TMP" "$DATA_TMP"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-ops-notify -- \
    "🔴 Дамп прод-БД упал (данные) — проверь run-supabase-db-dump.sh вручную" >/dev/null 2>&1 || true
  exit 1
fi

cat "$SCHEMA_TMP" "$DATA_TMP" > "$DUMP_FILE"
rm -f "$SCHEMA_TMP" "$DATA_TMP"

COPY_COUNT="$(grep -c '^COPY ' "$DUMP_FILE" || true)"
if [ "${COPY_COUNT:-0}" -eq 0 ]; then
  echo "[$(date '+%F %T')] дамп собран, но 0 COPY-секций — данные не попали, файл ненадёжен"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-ops-notify -- \
    "🔴 Дамп прод-БД без данных (0 COPY) — проверь run-supabase-db-dump.sh вручную" >/dev/null 2>&1 || true
  exit 1
fi

SIZE="$(du -h "$DUMP_FILE" 2>/dev/null | cut -f1)"
echo "[$(date '+%F %T')] дамп готов: $DUMP_FILE ($SIZE, $COPY_COUNT COPY-секций)"

# Ротация: старше KEEP_DAYS дней — удалить.
find "$DUMP_DIR" -maxdepth 1 -name 'dump-*.sql' -mtime "+${KEEP_DAYS}" -delete

npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=supabase_db_dump --status=sent || true
