---
name: debug-root-cause
description: Diagnose a broken path in this repo before attempting a fix. Use when something is failing in Telegram, TrainingPeaks flows, admin UI, AI parsing, or Supabase-backed behavior.
disable-model-invocation: true
---

# Debug Root Cause

## When to use

Use when behavior is broken or unclear. Do not jump to a fix first.

## What to inspect

- Input or trigger
- Parsing and validation
- Business logic and safety gates
- Storage, job creation, or side effects
- UI, Telegram delivery, or admin output
- Logs, scripts, and recent related changes

Trace the path end-to-end:

`input -> parsing -> logic -> storage/output -> UI/delivery`

## Required output format

Return exactly these sections:

```markdown
## Root Cause
- ...

## Evidence
- `path`:

## Smallest Safe Fix
1. ...

## Regression Risk
- ...
```

## Stop conditions

Stop if:

- evidence is insufficient to identify the failing stage
- the likely fix touches high-risk paths without enough safety context
- the issue might involve production data corruption or real external side effects

## Allowed commands

- Read-only inspection
- static search
- safe diagnostics and targeted non-destructive checks

## Must not run without approval

- broad speculative fixes
- data writes or migrations
- real Telegram sends or TrainingPeaks execution
