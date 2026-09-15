-- On-demand feedback generation + group-share status (Mini App «Отчёты»).
-- Two additive changes, FILE ONLY — apply manually, not auto-run.
--
--   1. app_runtime_flags — a tiny key/value store so Igor flips the generator backend
--      (api|cowork) from the Mini App WITHOUT a redeploy. Narrow on purpose: the
--      dangerous switch (FEEDBACK_SEND_ENABLED, real delivery) stays in env.
--   2. widen the feedback-job status check to add 'shared' — a GROUP draft handed to
--      Telegram's share sheet from Igor's own account. Delivery is NOT confirmable, so
--      it's a distinct terminal state from 'sent' (verified DM) — the history must not
--      claim a group message as delivered.

-- ── 1. runtime flags ──────────────────────────────────────────────────────────
create table if not exists public.app_runtime_flags (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

revoke all on table public.app_runtime_flags from anon, authenticated, public;
grant select, insert, update on table public.app_runtime_flags to service_role;

alter table public.app_runtime_flags enable row level security;

-- Seed the generator backend to 'api' (balance topped up → API is the primary path).
-- Igor can flip it to 'cowork' from the Mini App toggle at any time.
insert into public.app_runtime_flags (key, value)
values ('feedback_generator_backend', 'api')
on conflict (key) do nothing;

-- ── 2. 'shared' status ────────────────────────────────────────────────────────
-- A CHECK cannot be extended in place — drop and re-add with the full set.
alter table public.trainingpeaks_workout_feedback_jobs
  drop constraint if exists tp_workout_feedback_jobs_status_check;

alter table public.trainingpeaks_workout_feedback_jobs
  add constraint tp_workout_feedback_jobs_status_check
    check (status in ('pending', 'generating', 'done', 'failed', 'blocked', 'sent', 'shared', 'dismissed'));
