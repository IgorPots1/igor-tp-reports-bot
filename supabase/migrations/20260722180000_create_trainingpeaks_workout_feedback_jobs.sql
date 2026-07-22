-- Buffer queue for workout-feedback draft generation (мост генерации, часть 1).
-- The planner (planObservations + context-packet builder) puts one job per
-- workout here; a generator (API or Cowork, one env switch) picks it up, drafts
-- the message in Igor's voice, and submitFeedbackDraft runs the fact-check and
-- stores draft_text. Nothing is lost if generation fails — the job stays and can
-- be retried. Zero auto-send: drafts wait here for Igor's Mini App review (next part).
-- Mirrors public.trainingpeaks_jobs (partial-unique active index, updated_at
-- trigger, service_role-only RLS). FILE ONLY — apply manually, not auto-run.

create table if not exists public.trainingpeaks_workout_feedback_jobs (
  id uuid primary key default gen_random_uuid(),
  workout_cache_id uuid not null,
  student_id uuid not null,
  -- WHAT to say, from the planner (observations + arc + comparison delta +
  -- register/sex + few-shot keys + allowed_numbers). The generator dresses it in
  -- voice; the fact-check validates draft numbers against context_packet.allowed_numbers.
  context_packet jsonb not null,
  status text not null default 'pending',
  draft_text text,
  -- Which backend produced the draft ('api' | 'cowork'), for traceability across
  -- the env switch. Null until generated.
  generator_backend text,
  attempts integer not null default 0,
  -- Fact-check failure or generation error (status='failed'); coach-facing reason
  -- for a data-integrity block (status='blocked' — untrusted data, no draft).
  error_reason text,
  blocked_reason text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tp_workout_feedback_jobs_status_check
    check (status in ('pending', 'generating', 'done', 'failed', 'blocked')),
  constraint tp_workout_feedback_jobs_backend_check
    check (generator_backend is null or generator_backend in ('api', 'cowork'))
);

create index if not exists tp_workout_feedback_jobs_status_idx
  on public.trainingpeaks_workout_feedback_jobs (status, created_at asc);

create index if not exists tp_workout_feedback_jobs_student_idx
  on public.trainingpeaks_workout_feedback_jobs (student_id, created_at desc);

-- No duplicate ACTIVE job for the same workout (pending/generating). A workout
-- can be re-enqueued after a job reaches done/failed/blocked (e.g. metrics
-- recomputed), so the guard only covers in-flight jobs.
create unique index if not exists tp_workout_feedback_jobs_active_workout_idx
  on public.trainingpeaks_workout_feedback_jobs (workout_cache_id)
  where status in ('pending', 'generating');

create or replace function public.set_tp_workout_feedback_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tp_workout_feedback_jobs_updated_at on public.trainingpeaks_workout_feedback_jobs;

create trigger set_tp_workout_feedback_jobs_updated_at
before update on public.trainingpeaks_workout_feedback_jobs
for each row
execute function public.set_tp_workout_feedback_jobs_updated_at();

revoke all on table public.trainingpeaks_workout_feedback_jobs from anon, authenticated, public;
grant select, insert, update on table public.trainingpeaks_workout_feedback_jobs to service_role;

alter table public.trainingpeaks_workout_feedback_jobs enable row level security;
