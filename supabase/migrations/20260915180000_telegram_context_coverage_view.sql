-- C1: one-row coverage snapshot for the last 24h, read by the C2 watchdog and available for
-- ad-hoc "is anything obviously broken" checks. A view, not a materialized one — this table's
-- daily volume is small enough (thousands of rows/day) that computing it on read is cheap, and a
-- view never goes stale the way a materialized one could if a refresh job silently stopped
-- (exactly the class of bug this whole наряд's watchdog rules exist to catch elsewhere).
create or replace view public.trainingpeaks_telegram_context_coverage_24h as
with last_24h as (
  select *
  from public.trainingpeaks_telegram_context_observations
  where observed_at >= now() - interval '24 hours'
),
rolling_14d_daily as (
  -- Full days only: [now-15d, now-1d) — yesterday and earlier, so a partial "today" never drags
  -- the average down and makes a real drop look smaller than it is.
  select
    source_type,
    date_trunc('day', observed_at) as day,
    count(*) as day_count
  from public.trainingpeaks_telegram_context_observations
  where observed_at >= now() - interval '15 days'
    and observed_at < date_trunc('day', now())
  group by source_type, date_trunc('day', observed_at)
)
select
  (select count(*) from last_24h where direction = 'inbound') as inbound_count,
  (select count(*) from last_24h where direction = 'outbound') as outbound_count,
  (select count(*) from last_24h where attachment_type is not null) as attachments_count,
  (
    select coalesce(jsonb_object_agg(attachment_type, cnt), '{}'::jsonb)
    from (
      select attachment_type, count(*) as cnt
      from last_24h
      where attachment_type is not null
      group by attachment_type
    ) by_type
  ) as attachments_by_type,
  (select count(*) from last_24h where attachment_type in ('voice', 'video_note')) as voice_total,
  (select count(*) from last_24h where attachment_type in ('voice', 'video_note') and transcript_status = 'done') as voice_done,
  (select count(*) from last_24h where attachment_type in ('voice', 'video_note') and transcript_status = 'pending') as voice_pending,
  (select count(*) from last_24h where attachment_type in ('voice', 'video_note') and transcript_status = 'processing') as voice_processing,
  (select count(*) from last_24h where attachment_type in ('voice', 'video_note') and transcript_status = 'failed') as voice_failed,
  (select count(*) from last_24h where attachment_type in ('voice', 'video_note') and transcript_status = 'skipped') as voice_skipped,
  (select count(*) from last_24h where student_id is null) as unlinked_student_count,
  (select count(*) from last_24h where source_type = 'business_dm') as business_dm_count_24h,
  (select round(avg(day_count), 1) from rolling_14d_daily where source_type = 'business_dm') as business_dm_avg_14d,
  (select count(*) from last_24h where source_type = 'group_topic') as group_topic_count_24h,
  (select round(avg(day_count), 1) from rolling_14d_daily where source_type = 'group_topic') as group_topic_avg_14d,
  (select count(*) from last_24h where source_type = 'private_dm') as private_dm_count_24h,
  (select round(avg(day_count), 1) from rolling_14d_daily where source_type = 'private_dm') as private_dm_avg_14d;

comment on view public.trainingpeaks_telegram_context_coverage_24h is
  'One-row completeness snapshot for the trailing 24h — read by the C2 watchdog (наряд telegram-context-and-voice). Rolling averages exclude the current partial day.';

-- security_invoker: the underlying table is service_role-only (RLS). Without this, a Postgres
-- view runs with the OWNER's privileges by default and would quietly bypass that restriction.
alter view public.trainingpeaks_telegram_context_coverage_24h set (security_invoker = true);

revoke all on public.trainingpeaks_telegram_context_coverage_24h from anon, authenticated, public;
grant select on public.trainingpeaks_telegram_context_coverage_24h to service_role;
