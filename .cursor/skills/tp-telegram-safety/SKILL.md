---
name: tp-telegram-safety
description: Audit Telegram and TrainingPeaks-facing safety paths in this repo. Use for webhook handlers, commands, callbacks, Business messages, report delivery, student lookup, and action creation.
disable-model-invocation: true
---

# TP Telegram Safety

## When to use

Use for changes involving:

- Telegram webhook handlers
- bot commands and callback handlers
- Telegram Business message ingestion or delivery
- weekly report delivery or approval flows
- student lookup, linking, or chat binding
- TrainingPeaks action creation or approval initiated from Telegram

## What to inspect

- Full routing trace from inbound event to final side effect
- Coach-only gate checks on commands, callbacks, and admin paths
- Student lookup method: `chat_id` vs username
- Wrong-student risk at every branch
- Athlete-facing send risk and report-delivery approval gates
- Idempotency, duplicate delivery, and callback replay risk

## Required output format

Return exactly these sections:

```markdown
## Routing Trace
1. ...

## Safety Gates
- Coach-only:
- Student binding:
- Athlete send:

## Risks
- Wrong student:
- Unapproved send:
- Approval bypass:

## Verdict
- safe to proceed / stop
```

## Stop conditions

Stop immediately if any path:

- can send to an athlete without coach approval
- can approve or execute a TP action without a preserved gate
- can bind or infer the wrong student
- relies on username-only matching without explicit safeguards

## Allowed commands

- Read-only inspection
- static search
- targeted lint or test reads
- manual routing analysis

## Must not run without approval

- live Telegram send commands
- webhook replays against production
- real TrainingPeaks action execution
