# igor-tp-reports-bot

TrainingPeaks weekly reports bot for Telegram.

## Setup

```bash
npm install
npm run dev
```

## Environment

Required variables:

```text
ADMIN_ACCESS_TOKEN=change-me
TELEGRAM_BOT_TOKEN=...
TELEGRAM_COACH_CHAT_IDS=507447935
TELEGRAM_BUSINESS_CONNECTION_ID=...
TELEGRAM_WEBHOOK_SECRET=...
CRON_SECRET=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`ADMIN_ACCESS_TOKEN` protects `/admin`. Set it locally in `.env.local` before using Web Admin, and set the same variable in Vercel production before exposing any `/admin` route publicly. If `ADMIN_ACCESS_TOKEN` is missing in production, `/admin` stays closed and redirects to the login/setup screen.

`TELEGRAM_WEBHOOK_SECRET` is required in production. Production webhook requests are rejected unless Telegram sends the same value in the `x-telegram-bot-api-secret-token` header. Development keeps the current bypass when the variable is unset and logs a warning once.

## TrainingPeaks Morning Attention Digest

Endpoint path:

```text
/api/cron/trainingpeaks-attention-digest
```

Required production variables:

```text
CRON_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_COACH_CHAT_IDS
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Vercel reminder: `CRON_SECRET` must be added to the `igor-tp-reports-bot` Vercel project, not the Second Brain project.

Vercel cron uses UTC. The configured schedule is `0 6 * * *`, which matches 08:00 Europe/Belgrade during summer time. If exact local 08:00 matters year-round, adjust this seasonally.

Vercel Cron invokes this endpoint with `GET` (same Bearer auth). Manual test examples:

```bash
curl -i -X POST "https://<production-domain>/api/cron/trainingpeaks-attention-digest" \
  -H "Authorization: Bearer <CRON_SECRET>"

curl -i "https://<production-domain>/api/cron/trainingpeaks-attention-digest" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Telegram Webhook

Webhook endpoint path:

```text
/api/telegram/webhook
```

In production, the webhook rejects all POST requests when `TELEGRAM_WEBHOOK_SECRET` is missing.

When you configure the webhook in Telegram, `setWebhook secret_token` must exactly match `TELEGRAM_WEBHOOK_SECRET`.

For Telegram Business smoke testing:

- In BotFather, enable Chat Access Mode / Business Mode for the bot.
- In Telegram Business, connect the bot only to the specific chats you want to test with.
- After the first `business_connection` webhook arrives, copy its `connectionId` from the app logs into `TELEGRAM_BUSINESS_CONNECTION_ID`.

Example Telegram webhook setup command:

```bash
export TELEGRAM_BOT_TOKEN="<your_bot_token>"
export TELEGRAM_WEBHOOK_SECRET="<your_webhook_secret>"

curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://igor-tp-reports-bot.vercel.app/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query","business_connection","business_message","edited_business_message","deleted_business_messages"]'
```

Admin smoke-test command:

```text
/tp_business_test <chat_id>
```

This command is intentionally admin-only and is not added to the public bot menus. It sends:

```text
Тестовое сообщение от Игоря через TrainingPeaks Reports Bot ✅
```

Use it from a coach/admin chat after:

1. Connecting the bot in Telegram Business.
2. Confirming `business_connection` webhook logs appeared.
3. Saving that `connectionId` into `TELEGRAM_BUSINESS_CONNECTION_ID`.

For normal student linking, the student should first send any message to the connected Telegram Business account. After that, the coach can open `👥 Ученики` -> choose a student -> `🔗 Привязать Telegram` and pick the student from the latest Telegram Business chats.

Break-glass fallback for Telegram linking (normally not needed):

```text
/tp_set_telegram <student_id> <chat_id>
```

Optional username form:

```text
/tp_set_telegram <student_id> <chat_id> <username>
```

This stores Telegram delivery metadata on the student row and enables coach-approved student delivery for weekly reports. The manual command remains available as a fallback, but is intentionally not shown in the primary bot menu/help.

## TrainingPeaks Job Flow

Architecture rules for MVP:

- Telegram only creates and reads `trainingpeaks_jobs` in Supabase.
- Local Mac executes TrainingPeaks export, parsing, and AI report generation.
- Vercel does not run Playwright, export, parser, or AI generation.
- Existing `/tp_report` reads synced report drafts from Supabase.

Example flow:

```text
Web Admin:
create/update students and Telegram links

Telegram:
/tp_week
/tp_run_week last

Mac:
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once

Telegram:
/tp_jobs
/tp_report Olga 2026-04-27 2026-05-03
```

## TrainingPeaks Report Sync

TrainingPeaks exports, parsed summaries, raw ZIP files, browser profile data, and local student config stay local in `tools/trainingpeaks-export/`. To publish only safe shared metadata and weekly report draft text for later Telegram bot reads, run:

```bash
npm run tp-sync-reports -- --from=YYYY-MM-DD --to=YYYY-MM-DD
```

This sync writes sanitized weekly metadata plus `report-draft.md` content into Supabase. It does not auto-send anything to athletes.

For MVP, the student registry in Supabase lives in `trainingpeaks_students` and is the source of truth. The local export pipeline still reads `tools/trainingpeaks-export/config/students.json`, but that file is refreshed from Supabase by the local runner.

Normal weekly flow:

```text
Web Admin:
1. Add/update students in `trainingpeaks_students`
2. Link Telegram from the student card when needed

Telegram:
/tp_week
/tp_run_week last

Mac:
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once

Telegram:
coach receives a compact weekly summary with a link to `/admin/reports`
```

To execute one queued weekly job from Supabase on the local Mac runner:

```bash
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once
```

`tp-agent-once` claims one queued `trainingpeaks_jobs` row, syncs active weekly-enabled students from Supabase into the local `config/students.json`, then runs the existing `tp-weekly-all` and `tp-sync-reports` pipeline for the requested week. After sync, it reads the generated weekly report drafts from Supabase, computes a compact batch summary, and sends only that notification back to the Telegram requester chat with a direct link to `Web Admin`. If the student sync fails, the export does not continue. Before overwriting `config/students.json`, the sync creates a timestamped `students.backup-YYYYMMDD-HHMMSS.json` file when a previous local config exists.

Manual editing of `tools/trainingpeaks-export/config/students.json` is no longer needed for the normal Telegram -> local Mac weekly flow.

Vercel still does not run Playwright, export, parser, or AI generation.

Telegram is now notification-first for weekly jobs. Review, manual edits, and student delivery happen from `Web Admin`.

Coach-approved student delivery requirements:

- `TELEGRAM_BUSINESS_CONNECTION_ID` must be set in production.
- The student row must have `telegram_chat_id` and `telegram_delivery_enabled=true`.
- Preferred flow: student sends any Telegram message first, then coach links from the student card with `🔗 Привязать Telegram`.
- Break-glass fallback only: `/tp_set_telegram <student_id> <chat_id>`. If an older username-based flow was already used, `/tp_bind <student_name_or_id> <@username>` still works as a secondary fallback.
- `APP_BASE_URL` is recommended for direct admin links in Telegram summary notifications. `NEXT_PUBLIC_APP_URL` and `VERCEL_URL` are supported fallbacks.
- Sending from `Web Admin` delivers the final report to the student's Telegram chat through Telegram Business.

## Telegram Commands

Available commands:

- `/help`
- `/tp_status`
- `/tp_status <from> <to>`
- `/tp_students`
- `/tp_week`
- `/tp_run_week last`
- `/tp_run_week current`
- `/tp_run_week previous`
- `/tp_run_week <from> <to>`
- `/tp_jobs`
- `/tp_report <student> [from to]`
- `/tp_weekly`
- `/tp_business_test <chat_id>` (admin smoke test)

Legacy fallback commands are intentionally not shown in the primary bot menu/help:

- `/tp_set_telegram <student_id> <chat_id>` (break-glass Telegram metadata link)
- `/tp_bind <student_name_or_id> <@username>` (fallback only if that path was already used)
- `/tp_add_student <name> | <trainingpeaks_url>` (deprecated; student creation now happens in Web Admin)
