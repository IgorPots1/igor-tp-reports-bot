---
name: multi-repo-handoff
description: Produce a clean end-of-session handoff for this repo and adjacent work. Use when wrapping up a session or transferring context to another agent or future run.
disable-model-invocation: true
---

# Multi Repo Handoff

## When to use

Use at the end of a session, especially when work may continue later in this repo or in a related repo.

## What to inspect

- Current project state and branch
- Most recent commit and uncommitted changes
- What changed in this session
- Decisions made, deferred work, and open safety risks
- Files the next agent should inspect first

## Required output format

Return exactly these sections:

```markdown
## Project State
- Branch:
- Last commit:
- Working tree:

## What Changed
- ...

## Decisions
- ...

## Deferred Work
- ...

## Next Task
- ...

## Risks
- ...

## Files To Inspect
- `path`
```

## Stop conditions

Stop and note the blocker if:

- branch or worktree state is unclear
- critical context is missing to describe risks or next steps

## Allowed commands

- `git status --short`
- `git branch --show-current`
- `git log -1 --oneline`
- read-only inspection of changed files

## Must not run without approval

- commit, push, reset, rebase, or stash operations
