---
name: local-runner-safety
description: Audit local TrainingPeaks runner and LaunchAgent safety in this repo. Use for `tools/trainingpeaks-export`, local Playwright profile usage, and unattended Mac automation.
disable-model-invocation: true
---

# Local Runner Safety

## When to use

Use for any task touching:

- `tools/trainingpeaks-export`
- local wrapper scripts
- LaunchAgent files or schedules
- Playwright profile usage
- TrainingPeaks API access or execution flows

## What to inspect

- Prepare -> validate -> execute stages
- Dry-run default behavior
- Explicit gates that switch from review to real execution
- Secret handling in logs, debug exports, and console output
- Schedule/autostart behavior for unattended automation
- Impact on local browser profile and TrainingPeaks state

## Required output format

Return exactly these sections:

```markdown
## Flow Trace
1. Prepare:
2. Validate:
3. Execute:

## Safety Checks
- Dry-run default:
- Explicit execution gate:
- Secret handling:
- LaunchAgent risk:

## Risks
- ...

## Verdict
- safe to proceed / stop
```

## Stop conditions

Stop if:

- dry-run is no longer the default
- real execution can happen without explicit operator approval
- auth material or athlete private data could be logged
- unattended automation semantics change without explicit review

## Allowed commands

- Read-only code/doc inspection
- static search
- non-destructive validation commands

## Must not run without approval

- Any real TP mutation flow
- LaunchAgent install/uninstall/load/start commands
- Playwright runs against the real persistent profile
