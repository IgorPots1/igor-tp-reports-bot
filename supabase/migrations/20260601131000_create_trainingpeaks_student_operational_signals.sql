-- Dependencies:
-- - public.trainingpeaks_students
-- - public.trainingpeaks_telegram_context_observations
-- - public.trainingpeaks_student_memory_items
-- - public.trainingpeaks_coach_cases
-- - public.trainingpeaks_actions

create table if not exists public.trainingpeaks_student_operational_signals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  signal_type text not null check (
    signal_type in (
      'schedule_availability_window',
      'schedule_unavailability_window',
      'resume_training',
      'pause_training',
      'health_issue_started',
      'health_issue_resolved',
      'health_issue_improving',
      'move_workout_candidate',
      'plan_generation_constraint',
      'race_load_context'
    )
  ),
  status text not null default 'active' check (
    status in ('active', 'consumed', 'expired', 'cancelled', 'dismissed')
  ),
  source_type text not null,
  source_observation_id uuid references public.trainingpeaks_telegram_context_observations(id) on delete set null,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  telegram_message_thread_id bigint,
  structured_payload jsonb not null default '{}'::jsonb,
  confidence numeric,
  valid_from date,
  valid_until date,
  source_date date,
  target_date date,
  source_day text,
  target_day text,
  linked_memory_item_id uuid references public.trainingpeaks_student_memory_items(id) on delete set null,
  linked_case_id uuid references public.trainingpeaks_coach_cases(id) on delete set null,
  linked_action_id uuid references public.trainingpeaks_actions(id) on delete set null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.trainingpeaks_student_operational_signals is
  'Operational coaching signals extracted from Telegram/TrainingPeaks context. Foundation table for review-first signal persistence; no automatic execution.';

comment on column public.trainingpeaks_student_operational_signals.structured_payload is
  'Flexible structured signal payload (date windows, day hints, and classifier details) used for coach review and later guarded workflows.';

create unique index if not exists trainingpeaks_student_operational_signals_source_dedupe_idx
  on public.trainingpeaks_student_operational_signals (source_observation_id, signal_type, dedupe_key)
  where source_observation_id is not null;

create index if not exists trainingpeaks_student_operational_signals_student_status_valid_until_idx
  on public.trainingpeaks_student_operational_signals (student_id, status, valid_until);

create index if not exists trainingpeaks_student_operational_signals_signal_type_status_idx
  on public.trainingpeaks_student_operational_signals (signal_type, status);

create index if not exists trainingpeaks_student_operational_signals_source_type_status_idx
  on public.trainingpeaks_student_operational_signals (source_type, status);

create index if not exists trainingpeaks_student_operational_signals_created_at_desc_idx
  on public.trainingpeaks_student_operational_signals (created_at desc);

create or replace function public.set_trainingpeaks_student_operational_signals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_student_operational_signals_updated_at
on public.trainingpeaks_student_operational_signals;

create trigger set_trainingpeaks_student_operational_signals_updated_at
before update on public.trainingpeaks_student_operational_signals
for each row
execute function public.set_trainingpeaks_student_operational_signals_updated_at();

revoke all on table public.trainingpeaks_student_operational_signals from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_student_operational_signals to service_role;

alter table public.trainingpeaks_student_operational_signals enable row level security;
