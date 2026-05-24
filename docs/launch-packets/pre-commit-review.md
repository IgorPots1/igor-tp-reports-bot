PROJECT: igor-tp-reports-bot
BRANCH:
MODE: REVIEW

TASK:
Review the staged diff only before commit. Confirm scope, safety, and verification for examples such as Telegram changes, Supabase migrations, local runner edits, AI prompt/schema changes, or admin UI work.

SCOPE:
  MAY_TOUCH:
  - No file edits unless the review explicitly turns into a follow-up task.
  MUST_READ_NOT_MODIFY:
  - staged diff
  - `.cursor/rules/**`
  - related files needed to judge safety
  MUST_NOT_TOUCH:
  - `.env*`
  - unstaged unrelated files
  - local artifacts, backups, debug exports

CONTEXT:
State the intended commit scope and what checks the implementer claims to have run. Mention whether the change affects Telegram, Supabase, local runner, AI prompts, or admin UI.

CONSTRAINTS:
- Inspect staged diff only.
- Verify no secrets, backups, or debug artifacts are included.
- Verify lint/build and relevant targeted checks were run or explain why not.
- Do not run `git add`, `git commit`, or `git push`.

EXPECTED_OUTPUT:
- Staged scope
- Checks
- Risks
- Commit readiness

STOP_IF:
- staged diff includes unrelated files
- staged diff includes secrets or sensitive artifacts
- required verification is missing
