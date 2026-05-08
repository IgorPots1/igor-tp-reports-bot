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
TELEGRAM_BOT_TOKEN=...
TELEGRAM_COACH_CHAT_IDS=507447935
TELEGRAM_BUSINESS_CONNECTION_ID=...
TELEGRAM_WEBHOOK_SECRET=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`TELEGRAM_WEBHOOK_SECRET` is optional but recommended for production. When it is set, the webhook endpoint requires Telegram to send the same value in the `x-telegram-bot-api-secret-token` header and rejects other requests with `401`.

## Telegram Webhook

Webhook endpoint path:

```text
/api/telegram/webhook
```

If `TELEGRAM_WEBHOOK_SECRET` is not set, the webhook keeps the current local-development behavior and does not enforce Telegram secret verification.

When you configure the webhook in Telegram, use the same secret token value that you set in `TELEGRAM_WEBHOOK_SECRET`.

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

To capture a student `chat_id` for later linking, send a normal message from that student chat to the connected Telegram Business account and check the Vercel webhook logs for the `business_message` event. The app logs `chatId`, so you can copy that value directly.

Temporary coach-only linking command:

```text
/tp_set_telegram <student_id> <chat_id>
```

Optional username form:

```text
/tp_set_telegram <student_id> <chat_id> <username>
```

This stores Telegram delivery metadata on the student row and enables coach-approved student delivery for weekly reports.

## TrainingPeaks Job Flow

Architecture rules for MVP:

- Telegram only creates and reads `trainingpeaks_jobs` in Supabase.
- Local Mac executes TrainingPeaks export, parsing, and AI report generation.
- Vercel does not run Playwright, export, parser, or AI generation.
- Existing `/tp_report` reads synced report drafts from Supabase.

Example flow:

```text
Telegram:
/tp_add_student Olga | https://app.trainingpeaks.com/#calendar/athletes/5734279
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

For MVP, the student registry in Supabase lives in `trainingpeaks_students` and is used by Telegram commands. The local export pipeline still reads `tools/trainingpeaks-export/config/students.json`, but that file is now refreshed from Supabase by the local runner.

Normal weekly flow:

```text
Telegram:
/tp_add_student <name> | <trainingpeaks_url>
/tp_week
/tp_run_week last

Mac:
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once

Telegram:
coach receives weekly report drafts with inline buttons
`✅ Отправить ученику` -> `tp:rs:<reportId>`
`⏭ Пропустить` -> `tp:rk:<reportId>`
```

To execute one queued weekly job from Supabase on the local Mac runner:

```bash
cd ~/igor-tp-reports-bot/tools/trainingpeaks-export
npm run tp-agent-once
```

`tp-agent-once` claims one queued `trainingpeaks_jobs` row, syncs active weekly-enabled students from Supabase into the local `config/students.json`, then runs the existing `tp-weekly-all` and `tp-sync-reports` pipeline for the requested week. After sync, it reads the generated weekly report drafts from Supabase and sends them back to the Telegram requester chat as separate draft messages for coach review. Each draft now includes inline approval buttons. If the student sync fails, the export does not continue. Before overwriting `config/students.json`, the sync creates a timestamped `students.backup-YYYYMMDD-HHMMSS.json` file when a previous local config exists.

Manual editing of `tools/trainingpeaks-export/config/students.json` is no longer needed for the normal Telegram -> local Mac weekly flow.

Vercel still does not run Playwright, export, parser, or AI generation.

Weekly drafts still go only to the coach chat first. Student delivery happens only after the coach taps the inline approval button.

Coach-approved student delivery requirements:

- `TELEGRAM_BUSINESS_CONNECTION_ID` must be set in production.
- The student row must have `telegram_chat_id` and `telegram_delivery_enabled=true`.
- Link a student chat with `/tp_set_telegram <student_id> <chat_id>`.
- Tapping `✅ Отправить ученику` sends the synced `report_markdown` to the student's Telegram chat through Telegram Business.
- Tapping `⏭ Пропустить` marks the weekly report as skipped without sending anything to the student.

## Telegram Commands

Available commands:

- `/help`
- `/tp_status`
- `/tp_status <from> <to>`
- `/tp_students`
- `/tp_add_student <name> | <trainingpeaks_url>`
- `/tp_week`
- `/tp_run_week last`
- `/tp_run_week current`
- `/tp_run_week previous`
- `/tp_run_week <from> <to>`
- `/tp_jobs`
- `/tp_report <student> [from to]`
- `/tp_weekly`
- `/tp_business_test <chat_id>` (admin smoke test)
- `/tp_set_telegram <student_id> <chat_id>` (temporary coach-only metadata link; not shown in bot menu)
