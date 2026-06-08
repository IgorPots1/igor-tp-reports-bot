create table if not exists public.trainingpeaks_group_workout_report_intake (
  id uuid primary key default gen_random_uuid(),
  source_chat_id bigint not null,
  source_message_id bigint not null,
  source_message_timestamp timestamptz not null,
  source_telegram_user_id bigint,
  source_telegram_username text,
  source_telegram_display_name text,
  source_chat_title text,
  student_id uuid references public.trainingpeaks_students(id) on delete set null,
  trainingpeaks_athlete_id text,
  message_text text not null,
  detected_labels text[] not null default '{}'::text[],
  intake_status text not null check (
    intake_status in (
      'candidate_stored',
      'skipped_feature_disabled',
      'skipped_group_not_allowed',
      'skipped_bot_or_service',
      'skipped_coach_message',
      'skipped_not_report_like',
      'skipped_unknown_student',
      'skipped_inactive_student',
      'skipped_missing_tp_link',
      'duplicate_source_message'
    )
  ),
  skip_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trainingpeaks_group_workout_report_intake_source_uidx
  on public.trainingpeaks_group_workout_report_intake (source_chat_id, source_message_id);

create index if not exists trainingpeaks_group_workout_report_intake_created_at_desc_idx
  on public.trainingpeaks_group_workout_report_intake (created_at desc);

create index if not exists trainingpeaks_group_workout_report_intake_status_created_at_desc_idx
  on public.trainingpeaks_group_workout_report_intake (intake_status, created_at desc);

create index if not exists trainingpeaks_group_workout_report_intake_student_created_at_desc_idx
  on public.trainingpeaks_group_workout_report_intake (student_id, created_at desc);

create or replace function public.set_trainingpeaks_group_workout_report_intake_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_group_workout_report_intake_updated_at
  on public.trainingpeaks_group_workout_report_intake;

create trigger set_trainingpeaks_group_workout_report_intake_updated_at
before update on public.trainingpeaks_group_workout_report_intake
for each row
execute function public.set_trainingpeaks_group_workout_report_intake_updated_at();

revoke all on table public.trainingpeaks_group_workout_report_intake from anon, authenticated, public;
grant select, insert, update, delete on table public.trainingpeaks_group_workout_report_intake to service_role;

alter table public.trainingpeaks_group_workout_report_intake enable row level security;
