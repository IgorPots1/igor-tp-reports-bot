---
name: supabase-migration-review
description: Review a Supabase migration for data safety, RLS, grants, indexes, and rollback risk. Use for any SQL migration or schema change in this repo.
disable-model-invocation: true
---

# Supabase Migration Review

## When to use

Use for any change under `supabase/migrations/` or any task that alters schema, policies, grants, indexes, or constraints.

## What to inspect

- Added or changed tables, columns, constraints, indexes, and policies
- RLS coverage and `service_role` usage
- Grants and privilege changes
- Guard clauses for `create index`, `alter table`, or repeatable migration safety
- Rollback risk and backfill implications
- Secret leakage or environment-specific values in SQL
- Required QA notes: lint/build plus migration-specific checks

## Required output format

Return exactly these sections:

```markdown
## Migration Summary
- ...

## Safety Review
- RLS:
- Grants:
- Indexes And Constraints:
- Data Safety:

## Risks
- ...

## Required Follow-ups
1. ...
```

## Stop conditions

Stop and escalate if:

- the migration weakens RLS without explicit justification
- it drops or rewrites critical constraints/indexes without rollback notes
- it changes production data directly
- it embeds secrets or irreversible environment-specific behavior

## Allowed commands

- Read migration files
- Search for dependent tables/policies/queries
- Run lint/build or SQL review helpers if already present

## Must not run without approval

- Applying migrations to any environment
- Direct SQL writes against real data
- Granting broad privileges as a convenience shortcut
