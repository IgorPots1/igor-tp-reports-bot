PROJECT: igor-tp-reports-bot
BRANCH:
MODE: DEBUG

TASK:
Find the root cause before fixing. Examples: Telegram callback not gated correctly, wrong student lookup, Supabase query/policy regression, local runner skipping validate stage, AI schema parse failure, or admin UI showing stale status.

SCOPE:
  MAY_TOUCH:
  - No edits until root cause is confirmed, unless explicitly approved.
  MUST_READ_NOT_MODIFY:
  - `.cursor/rules/**`
  - relevant handlers, queries, scripts, prompts, migrations, and docs
  MUST_NOT_TOUCH:
  - `.env*`
  - production data
  - real send/execute paths

CONTEXT:
Include the observed symptom, expected behavior, last known good state, and any logs or commands already checked. Name the entrypoint if known: webhook, callback, cron, local runner, migration, or admin page.

CONSTRAINTS:
- Do not fix first.
- Trace `input -> parsing -> logic -> storage/output -> UI/delivery`.
- Prefer the smallest safe fix once evidence is complete.

EXPECTED_OUTPUT:
- Root cause
- Evidence
- Smallest safe fix
- Regression risk

STOP_IF:
- evidence is insufficient
- issue may involve production data corruption
- reproducing safely would require live Telegram sends or real TrainingPeaks execution
