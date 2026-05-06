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
/tp_run_week 2026-04-27 2026-05-03

Mac:
cd tools/trainingpeaks-export
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

This sync writes sanitized weekly metadata plus `report-draft.md` content into Supabase and does not send anything to students.

For MVP, the student registry in Supabase lives in `trainingpeaks_students` and is used by Telegram commands. The local export pipeline still reads `tools/trainingpeaks-export/config/students.json`, but that file is now refreshed from Supabase by the local runner.

Normal weekly flow:

```text
Telegram:
/tp_add_student <name> | <trainingpeaks_url>
/tp_run_week YYYY-MM-DD YYYY-MM-DD

Mac:
cd tools/trainingpeaks-export
npm run tp-agent-once
```

To execute one queued weekly job from Supabase on the local Mac runner:

```bash
cd tools/trainingpeaks-export
npm run tp-agent-once
```

`tp-agent-once` claims one queued `trainingpeaks_jobs` row, syncs active weekly-enabled students from Supabase into the local `config/students.json`, then runs the existing `tp-weekly-all` and `tp-sync-reports` pipeline for the requested week. If the student sync fails, the export does not continue. Before overwriting `config/students.json`, the sync creates a timestamped `students.backup-YYYYMMDD-HHMMSS.json` file when a previous local config exists.

Manual editing of `tools/trainingpeaks-export/config/students.json` is no longer needed for the normal Telegram -> local Mac weekly flow.

Vercel still does not run Playwright, export, parser, or AI generation.

## Telegram Commands

Available commands:

- `/help`
- `/tp_status`
- `/tp_status <from> <to>`
- `/tp_students`
- `/tp_add_student <name> | <trainingpeaks_url>`
- `/tp_run_week <from> <to>`
- `/tp_jobs`
- `/tp_report <student> [from to]`
- `/tp_weekly`
