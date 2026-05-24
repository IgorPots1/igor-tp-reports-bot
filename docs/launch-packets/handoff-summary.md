PROJECT: igor-tp-reports-bot
BRANCH:
MODE: HANDOFF

TASK:
Prepare a clean handoff for the next agent or session. Examples: pause after a Telegram safety audit, after drafting a Supabase migration, after docs/rules infrastructure work, or after investigating a local runner or AI schema issue.

SCOPE:
  MAY_TOUCH:
  - No edits required unless explicitly asked.
  MUST_READ_NOT_MODIFY:
  - changed files from the current session
  - `.cursor/rules/**`
  - relevant docs and latest git metadata
  MUST_NOT_TOUCH:
  - `.env*`
  - unrelated dirty files
  - production systems

CONTEXT:
Summarize the session goal, what was completed, what was intentionally deferred, and what safety assumptions still matter. Mention if the next step touches Telegram, Supabase migrations, local TrainingPeaks automation, AI schemas, or admin UI.

CONSTRAINTS:
- Keep the handoff factual and actionable.
- Include risks and the next best task.
- Do not hide unresolved scope or verification gaps.

EXPECTED_OUTPUT:
- Project state
- What changed
- Decisions
- Deferred work
- Next task
- Risks
- Files to inspect

STOP_IF:
- branch/worktree state is unclear
- key unresolved risks cannot be summarized confidently
