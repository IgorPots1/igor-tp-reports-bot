do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'trainingpeaks_reply_drafts_source_check'
      and conrelid = 'public.trainingpeaks_reply_drafts'::regclass
  ) then
    alter table public.trainingpeaks_reply_drafts
      drop constraint trainingpeaks_reply_drafts_source_check;
  end if;
end $$;

alter table public.trainingpeaks_reply_drafts
  add constraint trainingpeaks_reply_drafts_source_check
  check (
    source in ('telegram_command', 'attention_digest', 'system', 'group_workout_report')
  );

alter table public.trainingpeaks_reply_drafts
  add column if not exists source_chat_id bigint,
  add column if not exists source_message_id bigint,
  add column if not exists source_message_timestamp timestamptz,
  add column if not exists source_telegram_user_id bigint,
  add column if not exists group_workout_report_intake_id uuid references public.trainingpeaks_group_workout_report_intake(id) on delete set null,
  add column if not exists workout_match_status text check (
    workout_match_status is null
    or workout_match_status in ('matched', 'ambiguous', 'not_found')
  ),
  add column if not exists workout_match_confidence text check (
    workout_match_confidence is null
    or workout_match_confidence in ('high', 'medium', 'low')
  ),
  add column if not exists planned_workout_cache_id uuid references public.trainingpeaks_workout_cache(id) on delete set null,
  add column if not exists completed_workout_cache_id uuid references public.trainingpeaks_workout_cache(id) on delete set null,
  add column if not exists workout_analysis_json jsonb;

create unique index if not exists trainingpeaks_reply_drafts_group_workout_report_source_uidx
  on public.trainingpeaks_reply_drafts (source_chat_id, source_message_id)
  where source = 'group_workout_report';

create index if not exists trainingpeaks_reply_drafts_group_workout_report_intake_id_idx
  on public.trainingpeaks_reply_drafts (group_workout_report_intake_id)
  where group_workout_report_intake_id is not null;

comment on column public.trainingpeaks_reply_drafts.source_chat_id is
  'Telegram group chat id for group_workout_report drafts.';
comment on column public.trainingpeaks_reply_drafts.source_message_id is
  'Telegram source message id for group_workout_report drafts.';
comment on column public.trainingpeaks_reply_drafts.workout_analysis_json is
  'Structured plan-vs-actual analysis used for group workout report reply drafts.';
