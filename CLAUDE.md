# Claude Code Notes

## Project Purpose

`igor-tp-reports-bot` is the production Coach OS repository for Telegram-driven coaching operations, TrainingPeaks report automation, local Mac runner workflows, and Supabase-backed storage/admin flows.

## Main Architecture Layers

- `src/`: Next.js app, Telegram webhook/admin flows, bot commands, and Supabase-backed runtime behavior.
- `tools/trainingpeaks-export/`: local Mac runner, Playwright/TrainingPeaks scripts, report generation, local automation, and debug tooling.
- `supabase/`: SQL migrations and database policy/schema changes.
- `scripts/`: focused checks and local verification helpers.
- `docs/`: project notes and launch packet templates.

## Critical Safety Rules

- Respect `.cursor/rules/*` first.
- No auto-send to athletes.
- No real TrainingPeaks mutation without explicit approval and preserved gates.
- Coach-only and admin-only paths must stay gated.
- Prefer student matching by `chat_id`; username-only matching is high risk.
- Treat AI prompt/model/schema changes as logic changes.
- Do not commit, push, or widen scope unless explicitly asked.

## Do Not Touch Casually

- Telegram webhook and Business message handling
- student linking and callback approval paths
- `tools/trainingpeaks-export` execution flows and LaunchAgent automation
- Supabase migrations, RLS, and grants
- AI prompts, schemas, and athlete-facing wording

## Working Modes

- `ASK`: read-only audit first. Summarize current state, gaps, minimal safe plan, risks, and likely files.
- `TASK`: implement only the approved scoped change. Stop if work escapes scope.
- `DEBUG`: trace end-to-end before fixing: input -> parsing -> logic -> storage/output -> UI/delivery.
- `REVIEW`: prioritize bugs, safety regressions, wrong-student risk, send risk, and missing QA.

## Standard Checks

- `npm run lint`
- `npm run build`
- focused `check-*` scripts when touching parser, intent, digest, or attention logic
- report what ran, what failed, and whether failures are unrelated

## Repo-Specific Notes

- Telegram paths are safety-critical because they can reach real coaches and athletes.
- Supabase changes need migrations and explicit RLS/grant review.
- Local runner changes can affect real TrainingPeaks data and local browser state.
- AI prompts and schemas require consumer review and tone preservation, especially for Russian coach/athlete copy.
