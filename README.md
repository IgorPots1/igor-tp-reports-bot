# igor-agent-hub

Minimal production-safe foundation for a personal Telegram-controlled AI agent hub.

## Setup

```bash
npm install
npm run dev
```

## Webhook

Webhook endpoint path:

```text
/api/telegram/webhook
```

Example Telegram webhook setup command:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-domain.example/api/telegram/webhook"
```

## Reminders Cron

Vercel Hobby does not support the high-frequency cron schedule this project originally used, so production reminders should be triggered by an external cron service instead of `vercel.json`.

Recommended external cron setup:

- URL: `https://your-domain.example/api/cron/reminders`
- Method: `POST` (the endpoint also accepts `GET` for manual checks)
- Header: `Authorization: Bearer <CRON_SECRET>`
- Interval: every 5 minutes
- Keep real secrets out of the repo and configure `CRON_SECRET` only in your deployment/provider settings

Example request:

```bash
curl -X POST "https://your-domain.example/api/cron/reminders" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Obsidian Export

Obsidian is an export target in this project, not the source of truth. Active notes are exported from Supabase `brain_items` as Markdown files with YAML frontmatter and grouped into category folders inside a zip archive.

Configure a separate export secret in your local or deployment environment:

```text
EXPORT_SECRET=<your_export_secret>
```

Do not commit real secrets to the repo. `.env.example` only contains placeholders.

Example export request:

```bash
curl "https://your-domain.example/api/export/obsidian" \
  -H "Authorization: Bearer <EXPORT_SECRET>" \
  --output obsidian-export.zip
```

To import into Obsidian:

1. Unzip `obsidian-export.zip`.
2. Copy the extracted category folders into your Obsidian vault, or unzip directly into a dedicated vault folder.
3. Open the vault in Obsidian and let it index the new Markdown files.

## TrainingPeaks Report Sync

TrainingPeaks exports, parsed summaries, raw ZIP files, browser profile data, and local student config stay local in `tools/trainingpeaks-export/`. To publish only safe shared metadata and weekly report draft text for later Telegram bot reads, run:

```bash
npm run tp-sync-reports -- --from=YYYY-MM-DD --to=YYYY-MM-DD
```

This sync writes sanitized weekly metadata plus `report-draft.md` content into Supabase and does not send anything to students.
