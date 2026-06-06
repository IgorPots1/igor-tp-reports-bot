alter table public.trainingpeaks_student_operational_signals
  add column if not exists lifecycle_state text,
  add column if not exists lifecycle_state_updated_at timestamptz,
  add column if not exists lifecycle_applied_at timestamptz,
  add column if not exists lifecycle_meta jsonb not null default '{}'::jsonb,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_reason text,
  add column if not exists requires_coach_close boolean not null default false;

alter table public.trainingpeaks_student_operational_signals
  drop constraint if exists trainingpeaks_student_operational_signals_lifecycle_state_check;

alter table public.trainingpeaks_student_operational_signals
  add constraint trainingpeaks_student_operational_signals_lifecycle_state_check
  check (
    lifecycle_state is null
    or lifecycle_state in (
      'active_problem',
      'return_planned',
      'return_trial_completed',
      'monitoring_after_return',
      'resolved'
    )
  );

create index if not exists trainingpeaks_student_operational_signals_lifecycle_state_idx
  on public.trainingpeaks_student_operational_signals (lifecycle_state);

create index if not exists trainingpeaks_student_operational_signals_student_lifecycle_state_idx
  on public.trainingpeaks_student_operational_signals (student_id, lifecycle_state);

create table if not exists public.trainingpeaks_student_operational_signal_lifecycle_transitions (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.trainingpeaks_student_operational_signals(id) on delete cascade,
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  from_lifecycle_state text,
  to_lifecycle_state text not null,
  reason text not null,
  reason_codes text[] not null default '{}',
  actor text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  dry_run_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint trainingpeaks_student_operational_signal_lifecycle_transitions_to_lifecycle_state_check
    check (
      to_lifecycle_state in (
        'active_problem',
        'return_planned',
        'return_trial_completed',
        'monitoring_after_return',
        'resolved'
      )
    ),
  constraint trainingpeaks_student_operational_signal_lifecycle_transitions_from_lifecycle_state_check
    check (
      from_lifecycle_state is null
      or from_lifecycle_state in (
        'active_problem',
        'return_planned',
        'return_trial_completed',
        'monitoring_after_return',
        'resolved'
      )
    )
);

create index if not exists trainingpeaks_student_operational_signal_lifecycle_transitions_signal_created_idx
  on public.trainingpeaks_student_operational_signal_lifecycle_transitions (signal_id, created_at desc);

create index if not exists trainingpeaks_student_operational_signal_lifecycle_transitions_student_created_idx
  on public.trainingpeaks_student_operational_signal_lifecycle_transitions (student_id, created_at desc);

create unique index if not exists trainingpeaks_student_operational_signal_lifecycle_transitions_signal_fingerprint_idx
  on public.trainingpeaks_student_operational_signal_lifecycle_transitions (signal_id, dry_run_fingerprint);

revoke all on table public.trainingpeaks_student_operational_signal_lifecycle_transitions from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_student_operational_signal_lifecycle_transitions to service_role;

alter table public.trainingpeaks_student_operational_signal_lifecycle_transitions enable row level security;
