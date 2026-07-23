-- Review/send columns for the workout-feedback queue (Mini App «Отчёты»).
-- The bridge (part 1, migration 20260722180000) drafts into this table; this part
-- lets Igor REVIEW each draft in the coach Mini App and consciously send it.
-- INVARIANT: draft → Igor reads → edits if needed → taps Send. Zero auto-send.
--
-- Additive only (columns + widened status check) — the create migration is not
-- mutated. FILE ONLY — apply manually, not auto-run.

-- Igor's edit of the draft (null = sent verbatim). Kept even after send: the pair
-- (draft_text, coach_edited_text) is future few-shot signal — how Igor rewrites us.
alter table public.trainingpeaks_workout_feedback_jobs
  add column if not exists coach_edited_text text;

-- The EXACT text delivered to the student (coach_edited_text ?? draft_text at send
-- time), frozen. Separate from draft_text so a later edit can't rewrite history.
alter table public.trainingpeaks_workout_feedback_jobs
  add column if not exists sent_text text;

alter table public.trainingpeaks_workout_feedback_jobs
  add column if not exists sent_at timestamptz;

alter table public.trainingpeaks_workout_feedback_jobs
  add column if not exists dismissed_at timestamptz;

-- Which coach acted (Telegram id) — audit for the review actions.
alter table public.trainingpeaks_workout_feedback_jobs
  add column if not exists reviewed_by_chat_id text;

-- Widen the status check to the two review terminal states. A CHECK cannot be
-- extended in place — drop and re-add with the full set.
alter table public.trainingpeaks_workout_feedback_jobs
  drop constraint if exists tp_workout_feedback_jobs_status_check;

alter table public.trainingpeaks_workout_feedback_jobs
  add constraint tp_workout_feedback_jobs_status_check
    check (status in ('pending', 'generating', 'done', 'failed', 'blocked', 'sent', 'dismissed'));
