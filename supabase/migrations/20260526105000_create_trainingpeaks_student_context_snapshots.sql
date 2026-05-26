-- Dependencies:
-- - public.trainingpeaks_students
-- - public.trainingpeaks_message_intent_logs
-- - public.trainingpeaks_actions
-- - public.trainingpeaks_telegram_context_observations

create table if not exists public.trainingpeaks_student_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  source_intent_log_id uuid references public.trainingpeaks_message_intent_logs(id) on delete set null,
  cache_status text not null check (cache_status in ('ok', 'empty', 'stale')),
  silence_days integer,
  last_coach_touch_at timestamptz,
  unanswered_seconds integer,
  recovery_alert_kind text check (
    recovery_alert_kind in ('short_sleep_streak', 'short_sleep_plus_low_body_battery')
  ),
  missed_planned_dates date[],
  label_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.trainingpeaks_student_context_snapshots is
  'Compact structured context snapshots for coach-case triage; excludes raw athlete text, prompts, and full health/workout dumps.';

comment on column public.trainingpeaks_student_context_snapshots.label_summary is
  'Compact flags/labels only (structured json), no raw athlete message content.';

create index if not exists trainingpeaks_student_context_snapshots_student_created_at_desc_idx
  on public.trainingpeaks_student_context_snapshots (student_id, created_at desc);

create index if not exists trainingpeaks_student_context_snapshots_source_intent_log_id_idx
  on public.trainingpeaks_student_context_snapshots (source_intent_log_id);

revoke all on table public.trainingpeaks_student_context_snapshots from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_student_context_snapshots to service_role;

alter table public.trainingpeaks_student_context_snapshots enable row level security;
