PROJECT: igor-tp-reports-bot
BRANCH:
MODE: TASK

TASK:
Implement the approved scoped change. Examples: add docs-only guidance, update a safe admin UI label, introduce a new migration file, or adjust a prompt/schema with reviewed consumers.

SCOPE:
  MAY_TOUCH:
  - list exact files or directories allowed for this task
  MUST_READ_NOT_MODIFY:
  - `.cursor/rules/**`
  - `CLAUDE.md`
  - `AGENTS.md`
  - any referenced runtime files needed for context
  MUST_NOT_TOUCH:
  - `.env*`
  - unrelated runtime paths
  - debug exports and backups
  - live Telegram/TrainingPeaks credentials or profiles

CONTEXT:
State what was approved in ASK mode. Include the exact user goal and the safety assumptions to preserve. Example: "Change admin UI copy only; do not alter callback logic." Or: "Add a Supabase migration but do not apply it."

CONSTRAINTS:
- Keep scope explicit and minimal.
- Preserve coach-only gates, dry-run defaults, and approval flows.
- Treat prompt/schema edits as logic changes.
- Stop instead of widening scope silently.

EXPECTED_OUTPUT:
- Changed files
- Checks run
- QA notes
- Deferred work

STOP_IF:
- implementation needs files outside `MAY_TOUCH`
- runtime behavior would change beyond approval
- a migration, send path, or TP execute path becomes necessary unexpectedly
