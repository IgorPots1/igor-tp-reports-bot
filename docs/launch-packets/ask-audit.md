PROJECT: igor-tp-reports-bot
BRANCH:
MODE: ASK

TASK:
Audit the current implementation before any risky change. Examples: Telegram callback safety, Supabase migration planning, local TrainingPeaks runner changes, AI prompt/schema updates, admin auth or admin UI changes.

SCOPE:
  MAY_TOUCH:
  - No file edits in ASK mode unless explicitly approved later.
  MUST_READ_NOT_MODIFY:
  - `CLAUDE.md`
  - `AGENTS.md`
  - `.cursor/rules/**`
  - relevant runtime/docs files for the audited path
  MUST_NOT_TOUCH:
  - `.env*`
  - production data
  - TrainingPeaks live execution paths
  - Telegram delivery behavior

CONTEXT:
Include known symptoms, goals, linked tickets, related commands, and which user-visible flow is under review. For example: "Review Telegram Business student linking for wrong-student risk" or "Audit planned Supabase migration for RLS/grants impact."

CONSTRAINTS:
- Read-only audit.
- Trace real routing and approval gates.
- Call out athlete-facing send risk, wrong-student risk, RLS risk, dry-run risk, and schema consumer risk where relevant.

EXPECTED_OUTPUT:
- Current state
- Root cause or gaps
- Minimal safe plan
- Risks
- Likely files to change

STOP_IF:
- safe implementation would require files outside the approved area
- any path could auto-send to athletes
- any path could mutate TrainingPeaks without explicit approval
- current Telegram/Supabase/AI safety behavior is unclear
