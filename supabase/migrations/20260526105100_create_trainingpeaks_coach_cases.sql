-- Dependencies:
-- - public.trainingpeaks_students
-- - public.trainingpeaks_message_intent_logs
-- - public.trainingpeaks_actions
-- - public.trainingpeaks_telegram_context_observations
-- - public.trainingpeaks_student_context_snapshots

create table if not exists public.trainingpeaks_coach_cases (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete restrict,
  case_kind text not null check (
    case_kind in (
      'move_workout_requested',
      'move_workout_needs_review',
      'question_to_coach',
      'pain_or_health_signal',
      'unrecognized_intent',
      'observation_only'
    )
  ),
  intent_log_id uuid references public.trainingpeaks_message_intent_logs(id) on delete set null,
  action_id uuid references public.trainingpeaks_actions(id) on delete set null,
  context_obs_id uuid references public.trainingpeaks_telegram_context_observations(id) on delete set null,
  snapshot_id uuid references public.trainingpeaks_student_context_snapshots(id) on delete set null,
  telegram_chat_id text,
  telegram_message_id bigint,
  status text not null default 'logged' check (
    status in ('logged', 'open', 'needs_review', 'resolved', 'dismissed')
  ),
  coach_notes_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.trainingpeaks_coach_cases is
  'Coach case ledger rows for intent/action/context linkage and lifecycle tracking without storing raw athlete message text.';

create index if not exists trainingpeaks_coach_cases_student_created_at_desc_idx
  on public.trainingpeaks_coach_cases (student_id, created_at desc);

create index if not exists trainingpeaks_coach_cases_case_kind_status_created_at_desc_idx
  on public.trainingpeaks_coach_cases (case_kind, status, created_at desc);

create index if not exists trainingpeaks_coach_cases_intent_log_id_idx
  on public.trainingpeaks_coach_cases (intent_log_id);

create index if not exists trainingpeaks_coach_cases_action_id_idx
  on public.trainingpeaks_coach_cases (action_id);

create unique index if not exists trainingpeaks_coach_cases_intent_log_id_case_kind_uidx
  on public.trainingpeaks_coach_cases (intent_log_id, case_kind)
  where intent_log_id is not null;

create or replace function public.set_trainingpeaks_coach_cases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_coach_cases_updated_at on public.trainingpeaks_coach_cases;

create trigger set_trainingpeaks_coach_cases_updated_at
before update on public.trainingpeaks_coach_cases
for each row
execute function public.set_trainingpeaks_coach_cases_updated_at();

revoke all on table public.trainingpeaks_coach_cases from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_coach_cases to service_role;

alter table public.trainingpeaks_coach_cases enable row level security;
