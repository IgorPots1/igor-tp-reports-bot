# Setup reference (feedback-cowork-worker)

Two things must be set before the skill can run. Full step-by-step with screenshots-in-words
is in the repo: `docs/feedback-cowork-worker.md`. Short version:

## 1. Secret in Vercel
Add an environment variable to the app on Vercel:
- **Name:** `FEEDBACK_WORKER_SECRET`
- **Value:** a long random string (e.g. `openssl rand -hex 32`)
Redeploy so it takes effect.

## 2. LOCAL config file (NOT inside the skill)
The secret must stay local — this skill is registered to the cloud, so nothing secret
may live inside it. Put URL + secret in `~/.tp-reports-bot/feedback-worker.env`:
```
mkdir -p ~/.tp-reports-bot
cat > ~/.tp-reports-bot/feedback-worker.env <<'EOF'
FEEDBACK_WORKER_URL=https://YOUR-APP.vercel.app/api/feedback/worker
FEEDBACK_WORKER_SECRET=<the same value you put in Vercel>
EOF
chmod 600 ~/.tp-reports-bot/feedback-worker.env
```
`FEEDBACK_WORKER_URL` = your app's address (where the admin panel lives) + `/api/feedback/worker`.
**Never** create a `worker.env` inside the skill folder — it would sync to the cloud on
registration. The CLI reads only the local file above (env vars override it).

## Run
```
python scripts/feedback_worker.py claim  --limit 5
python scripts/feedback_worker.py submit --job <jobId> --text-file draft.txt
```

## Notes
- The worker only fills the draft queue. Igor reviews and sends from the Mini App «Отчёты».
- Writes go through the server fact-check (`/submit`); never write to Supabase directly.
- A stopped run is safe: the next `claim` reclaims jobs idle >15 min back to pending.
