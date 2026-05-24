# Agent Workflow Contract

## Repo Purpose

This repo runs the TrainingPeaks / Telegram Coach OS stack: Telegram bot and admin flows, local Mac TrainingPeaks automation, report generation, and Supabase-backed storage.

## Safe Workflow

Read `.cursor/rules/` and `CLAUDE.md` before making risky changes. Keep scope narrow, preserve existing approval gates, and stop when work would escape the approved files or behavior.

## Modes

- `ASK`: read-only audit. Explain current state, gaps, safe plan, risks, and likely files.
- `TASK`: implement the approved scoped change only.
- `DEBUG`: find root cause before proposing or applying a fix.
- `REVIEW`: review for bugs, safety regressions, wrong-student risk, send risk, and missing QA.
- `HANDOFF`: summarize branch, worktree, decisions, deferred items, next task, and risks.

## Non-Negotiables

- Respect `.cursor/rules/*` and project safety docs.
- No auto-commit or push.
- No auto-send to athletes.
- No real TrainingPeaks mutation without explicit approval.
- Do not widen scope silently.
