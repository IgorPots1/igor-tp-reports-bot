create table if not exists public.trainingpeaks_student_contact_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.trainingpeaks_students(id) on delete cascade,
  event_type text not null,
  source text not null,
  occurred_at timestamptz not null default now(),
  reference_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint trainingpeaks_student_contact_events_event_type_check check (
    event_type in ('athlete_message', 'coach_message', 'report_sent', 'coach_action_decision')
  ),
  constraint trainingpeaks_student_contact_events_source_check check (
    source in (
      'telegram_business_dm',
      'telegram_private_dm',
      'telegram_group_topic',
      'admin_report_send',
      'admin_action'
    )
  )
);

create index if not exists trainingpeaks_student_contact_events_student_id_occurred_at_desc_idx
  on public.trainingpeaks_student_contact_events (student_id, occurred_at desc);

create index if not exists trainingpeaks_student_contact_events_event_type_occurred_at_desc_idx
  on public.trainingpeaks_student_contact_events (event_type, occurred_at desc);

create index if not exists trainingpeaks_student_contact_events_source_occurred_at_desc_idx
  on public.trainingpeaks_student_contact_events (source, occurred_at desc);

revoke all on table public.trainingpeaks_student_contact_events from anon, authenticated, public;
grant select, insert on table public.trainingpeaks_student_contact_events to service_role;

alter table public.trainingpeaks_student_contact_events enable row level security;

create or replace view public.trainingpeaks_student_contact_status as
with event_rollup as (
  select
    events.student_id,
    max(events.occurred_at) filter (where events.event_type = 'athlete_message') as last_athlete_message_at,
    max(events.occurred_at) filter (
      where events.event_type in ('coach_message', 'report_sent', 'coach_action_decision')
    ) as last_coach_touch_at
  from public.trainingpeaks_student_contact_events as events
  group by events.student_id
)
select
  students.id as student_id,
  event_rollup.last_athlete_message_at,
  event_rollup.last_coach_touch_at,
  case
    when event_rollup.last_athlete_message_at is not null and event_rollup.last_coach_touch_at is not null
      then greatest(event_rollup.last_athlete_message_at, event_rollup.last_coach_touch_at)
    else coalesce(event_rollup.last_athlete_message_at, event_rollup.last_coach_touch_at)
  end as last_contact_event_at,
  case
    when event_rollup.last_athlete_message_at is null then null
    else floor(extract(epoch from (now() - event_rollup.last_athlete_message_at)) / 86400)::integer
  end as silence_days,
  case
    when event_rollup.last_athlete_message_at is null then null
    when event_rollup.last_coach_touch_at is null then event_rollup.last_athlete_message_at
    when event_rollup.last_athlete_message_at > event_rollup.last_coach_touch_at
      then event_rollup.last_athlete_message_at
    else null
  end as unanswered_since,
  case
    when event_rollup.last_athlete_message_at is null then null
    when event_rollup.last_coach_touch_at is null
      then floor(extract(epoch from (now() - event_rollup.last_athlete_message_at)))::bigint
    when event_rollup.last_athlete_message_at > event_rollup.last_coach_touch_at
      then floor(extract(epoch from (now() - event_rollup.last_athlete_message_at)))::bigint
    else null
  end as unanswered_seconds
from public.trainingpeaks_students as students
left join event_rollup on event_rollup.student_id = students.id
where students.is_active = true;

revoke all on table public.trainingpeaks_student_contact_status from anon, authenticated, public;
grant select on table public.trainingpeaks_student_contact_status to service_role;
