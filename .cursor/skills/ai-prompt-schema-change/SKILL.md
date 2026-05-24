---
name: ai-prompt-schema-change
description: Review AI prompt, model, temperature, and schema changes safely in this repo. Use for OpenAI-related prompt logic, structured output contracts, and downstream consumer compatibility.
disable-model-invocation: true
---

# AI Prompt Schema Change

## When to use

Use for any change to:

- prompts or system instructions
- model names or provider settings
- temperature or determinism settings
- JSON/structured output schemas
- post-processing logic that assumes a schema shape

## What to inspect

- Before/after prompt or schema diff
- Downstream consumers: parser logic, storage, admin views, Telegram formatting, scripts, logs
- Safety gates that should remain deterministic
- Tone drift risk for Russian coach or athlete copy
- Failure handling for malformed or partial model output

## Required output format

Return exactly these sections:

```markdown
## Before After Summary
- ...

## Downstream Consumers
- `path`: dependency

## Compatibility Risks
- ...

## Verdict
- safe to proceed / stop
```

## Stop conditions

Stop if:

- any consumer will break on the new schema
- athlete-facing wording changes accidentally
- the change weakens deterministic safety gates
- the path would auto-send AI-generated content without approval

## Allowed commands

- Read prompts, schemas, and consumers
- static search
- targeted tests/lint/build when safe

## Must not run without approval

- live message delivery
- broad model/provider rewrites beyond scope
- commits or pushes
