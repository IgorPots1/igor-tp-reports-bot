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
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Telegram Webhook

Webhook endpoint path:

```text
/api/telegram/webhook
```

Example Telegram webhook setup command:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-domain.example/api/telegram/webhook"
```

## TrainingPeaks Report Sync

TrainingPeaks exports, parsed summaries, raw ZIP files, browser profile data, and local student config stay local in `tools/trainingpeaks-export/`. To publish only safe shared metadata and weekly report draft text for later Telegram bot reads, run:

```bash
npm run tp-sync-reports -- --from=YYYY-MM-DD --to=YYYY-MM-DD
```

This sync writes sanitized weekly metadata plus `report-draft.md` content into Supabase and does not send anything to students.

For MVP, the student registry in Supabase lives in `trainingpeaks_students` and is used by Telegram commands. The local export pipeline still reads `tools/trainingpeaks-export/config/students.json`.

After adding a student through Telegram with `/tp_add_student`, manually mirror that student into `tools/trainingpeaks-export/config/students.json`, otherwise local export/parsing/report generation will not run for that athlete.

## Telegram Commands

Available commands:

- `/help`
- `/tp_status`
- `/tp_status <from> <to>`
- `/tp_students`
- `/tp_add_student <name> | <trainingpeaks_url>`
- `/tp_report <student> [from to]`
- `/tp_weekly`
