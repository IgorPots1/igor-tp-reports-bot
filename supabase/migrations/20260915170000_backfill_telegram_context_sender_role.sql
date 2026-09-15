-- Backfill sender_role from the legacy metadata->>'senderRole' field (added in
-- 20260915160000). Separate migration from the DDL on purpose: this one rewrites existing rows
-- (~5.9k as of 2026-09-15) and gets counted/verified before/after on its own, per the
-- telegram-context-and-voice naряд's rule that DDL and backfill are different operations.
--
-- Only ever touches rows that currently have sender_role IS NULL — safe to re-run.
update public.trainingpeaks_telegram_context_observations
set sender_role = metadata->>'senderRole'
where sender_role is null
  and metadata ? 'senderRole'
  and metadata->>'senderRole' is not null
  and metadata->>'senderRole' <> '';
