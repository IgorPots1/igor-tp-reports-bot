---
name: pre-commit-review
description: Review the staged diff before commit in this repo. Use to verify scope, secrets, debug artifacts, and required checks without performing git writes.
disable-model-invocation: true
---

# Pre Commit Review

## When to use

Use right before a requested commit. Inspect staged changes only.

## What to inspect

- `git diff --cached`
- staged file list and whether scope matches the approved task
- secrets, `.env` files, debug exports, backups, local artifacts, generated outputs
- lint/build status and any focused checks relevant to the touched area
- evidence that unrelated files were not staged

## Required output format

Return exactly these sections:

```markdown
## Staged Scope
- `path`: why it is included

## Checks
- `command`: pass/fail and short result

## Risks
- ...

## Commit Readiness
- ready / not ready
```

## Stop conditions

Stop if:

- staged files include secrets, local artifacts, backups, or unrelated changes
- required lint/build or focused checks were not run
- the staged diff changes runtime behavior unexpectedly

## Allowed commands

- `git diff --cached`
- `git status --short`
- read-only file inspection
- targeted verification commands

## Must not run without approval

- `git add`
- `git commit`
- `git push`
