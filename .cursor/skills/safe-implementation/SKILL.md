---
name: safe-implementation
description: Implement an approved scoped change safely in this repo. Use after ASK approval when the allowed files and constraints are explicit.
disable-model-invocation: true
---

# Safe Implementation

## When to use

Use after an ASK or audit phase has defined:

- the exact task
- the allowed scope
- files that may be touched
- safety constraints and QA expectations

## What to inspect

- Approved scope and stop conditions
- Existing rules in `.cursor/rules/`
- Relevant cross-agent docs such as `CLAUDE.md`, `AGENTS.md`, and `BUGBOT.md`
- Adjacent code or docs needed to make the smallest safe change
- Existing tests or checks that validate the touched area

## Required output format

Return exactly these sections:

```markdown
## Changed Files
- `path`: short note

## Checks
- `command`: pass/fail and short result

## QA Notes
- ...

## Deferred Work
- ...
```

## Stop conditions

Stop immediately if:

- implementation requires files outside the approved scope
- the task would change Telegram delivery behavior, Supabase data, or TrainingPeaks execution without explicit approval
- safety assumptions turn out to be wrong or incomplete
- a migration, secret change, or runtime behavior change becomes necessary unexpectedly

## Allowed commands

- Explicit, scoped file edits
- Read-only inspection and search
- Targeted lint/build/test commands relevant to the change
- `git status --short` for reporting

## Must not run without approval

- `git add`, `git commit`, `git push`
- broad refactors outside scope
- migration apply commands
- real TrainingPeaks execute flows
- Telegram send flows to real users
