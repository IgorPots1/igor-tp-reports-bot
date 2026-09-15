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
# NOT YET LIVE-TESTED: deny-guard.sh blocked even `--help` while drafting this (2026-09-15) — the
# guard update needs Igor's sign-off first (diff was shown, not yet applied at commit time). Run this
# by hand once after the guard is updated and SUPABASE_ACCESS_TOKEN is in .env.local, before trusting
# the launchd schedule.
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

cd "$REPO" || { echo "[$(date '+%F %T')] нет папки $REPO"; exit 1; }

echo "[$(date '+%F %T')] supabase db dump --linked -> $DUMP_FILE"
if npx --yes supabase db dump --linked --project-ref "$PROJECT_REF" -f "$DUMP_FILE"; then
  SIZE="$(du -h "$DUMP_FILE" 2>/dev/null | cut -f1)"
  echo "[$(date '+%F %T')] дамп готов: $DUMP_FILE ($SIZE)"
else
  echo "[$(date '+%F %T')] supabase db dump упал"
  npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-ops-notify -- \
    "🔴 Дамп прод-БД упал — проверь run-supabase-db-dump.sh вручную" >/dev/null 2>&1 || true
  exit 1
fi

# Ротация: старше KEEP_DAYS дней — удалить.
find "$DUMP_DIR" -maxdepth 1 -name 'dump-*.sql' -mtime "+${KEEP_DAYS}" -delete

npm --prefix "$REPO/tools/trainingpeaks-export" run --silent tp-heartbeat -- \
  --job=supabase_db_dump --status=sent || true
