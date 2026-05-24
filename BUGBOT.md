# BugBot Review Focus

Review this repository as production coaching infrastructure, not a toy app.

Pay special attention to:

- Telegram callback handlers that must remain coach-only
- wrong student matching, especially username-only binding or inference
- Telegram Business message paths and any bridge into athlete chats
- weekly report send idempotency and duplicate-send risk
- TrainingPeaks action approval and execute gates
- Supabase migrations, RLS coverage, and grants
- secret leakage in logs, docs, debug files, SQL, or checked-in artifacts
- local runner dry-run versus real execution gates
- AI prompt/model/schema changes and downstream consumer compatibility
- debug artifacts, backups, local exports, and accidental staging of sensitive files

Escalate findings where a change could:

- send to an athlete without coach approval
- bind the wrong athlete/student
- mutate TrainingPeaks without an explicit execute gate
- weaken RLS or over-broaden privileged access
- leak tokens, cookies, headers, or private athlete data
