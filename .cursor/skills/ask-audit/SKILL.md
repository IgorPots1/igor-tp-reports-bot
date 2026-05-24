---
name: ask-audit
description: Perform a read-only safety audit before risky work in this repo. Use before changing Supabase, Telegram, TrainingPeaks runner flows, AI prompts, migrations, admin auth, or local automation.
disable-model-invocation: true
---

# Ask Audit

## When to use

Use this skill before risky work involving:

- Supabase schema, RLS, grants, or migrations
- Telegram webhook, commands, callbacks, Business DMs, or report delivery
- `tools/trainingpeaks-export` runner flows or LaunchAgent automation
- AI prompts, models, temperatures, or structured output schemas
- Admin auth, coach-only access, or student linking

This is read-only. Do not edit files while using this skill.

## What to inspect

- Current entrypoints, approval gates, and data flow
- Safety-critical handlers and any existing guard clauses
- Related docs, rules, scripts, migrations, and tests
- Known risks: wrong student, athlete auto-send, real TP mutation, secret leakage, privilege escalation
- Files most likely to change if work proceeds

## Required output format

Return exactly these sections:

```markdown
## Current State
- ...

## Root Cause Or Gaps
- ...

## Minimal Safe Plan
1. ...

## Risks
- ...

## Likely Files To Change
- `path`
```

## Stop conditions

Stop and ask for confirmation if:

- the task needs files outside the approved scope
- current behavior is unclear in a safety-critical path
- a change could send to athletes, bind the wrong student, mutate TrainingPeaks, or bypass coach/admin gates
- the only safe next step is a migration or production data intervention

## Allowed commands

- Read-only file inspection
- `git status --short`
- `git diff -- <paths>`
- targeted search commands
- safe static analysis and lint reads

## Must not run without approval

- Any file edit
- `git add`, `git commit`, `git push`
- Migrations or DB write commands
- Real TrainingPeaks runner scripts
- Playwright flows against live local profiles
- Anything that can send Telegram messages to athletes
