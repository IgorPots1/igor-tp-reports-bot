-- Block 1 — store the word-level diff between the generated draft and what Igor actually sent.
-- draft_text (generated) and sent_text (delivered) already exist; edit_diff is the compact
-- {added, removed} summary computed at edit-save and at send, so later analysis ("which phrasings
-- does Igor rewrite?") is a query, not a re-diff of every row. Nullable jsonb; NULL = not yet edited/sent.
--
-- APPLY: not auto-applied. Run before deploying (supabase db push or the SQL editor).

alter table public.trainingpeaks_workout_feedback_jobs
  add column if not exists edit_diff jsonb;
