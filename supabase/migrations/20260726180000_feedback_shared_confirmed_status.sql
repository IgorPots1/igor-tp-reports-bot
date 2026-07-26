-- Block 4 — «Отправить в чат» больше не хоронит карточку.
-- A group share has no delivery confirmation, so 'shared' is no longer terminal: the card stays in
-- review («Отправить ещё раз» / «Готово»). Igor's explicit «Готово» moves it to 'shared_confirmed',
-- the new terminal state that reaches history. This widens the status CHECK to allow it.
--
-- Additive only. A CHECK cannot be ALTERed in place, so drop-and-recreate with the extra value.
-- Apply BEFORE deploying the code that writes 'shared_confirmed':
--   supabase migration up   (or psql -f this file against the prod DB)

alter table public.trainingpeaks_workout_feedback_jobs
  drop constraint if exists tp_workout_feedback_jobs_status_check;

alter table public.trainingpeaks_workout_feedback_jobs
  add constraint tp_workout_feedback_jobs_status_check
    check (status in ('pending', 'generating', 'done', 'failed', 'blocked', 'sent', 'shared', 'shared_confirmed', 'dismissed'));
