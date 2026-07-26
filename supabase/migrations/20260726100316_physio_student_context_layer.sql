-- Контекст ученика: то, что он сам написал в Telegram, уже разобрано в
-- memory_items и operational_signals. Сводим в один слой, чтобы цифры
-- читались вместе с причиной, а не отдельно от неё.

create or replace view physio_student_context_items as
-- 1. Долгая память по ученику
select
  m.student_id,
  case m.memory_type
    when 'health_status'    then 'health'
    when 'pain_or_injury'   then 'health'
    when 'schedule_constraint'     then 'schedule'
    when 'availability_preference' then 'schedule'
    when 'travel_or_life_event'    then 'schedule'
    when 'race_or_goal'     then 'goal'
    when 'emotional_state'  then 'mood'
    when 'load_tolerance'   then 'mood'
    else 'other'
  end as kind,
  m.memory_type as raw_type,
  m.summary_text as text,
  m.last_seen_at as observed_at,
  m.valid_until::date as valid_until,
  'memory'::text as source,
  m.confidence::text as confidence
from trainingpeaks_student_memory_items m
where m.is_active
  and (m.valid_until is null or m.valid_until::date >= current_date)
  and m.summary_text is not null
  and m.memory_type in ('health_status','pain_or_injury','schedule_constraint',
                        'availability_preference','travel_or_life_event',
                        'race_or_goal','emotional_state','load_tolerance')

union all

-- 2. Свежие операционные сигналы из переписки
select
  s.student_id,
  case
    when s.signal_type in ('health_issue_started','health_issue_improving',
                           'health_issue_resolved','pain_injury','pause_training') then 'health'
    when s.signal_type in ('schedule_availability_window','schedule_unavailability_window',
                           'move_workout_candidate','plan_generation_constraint') then 'schedule'
    else 'other'
  end as kind,
  s.signal_type as raw_type,
  coalesce(s.structured_payload->>'display_summary',
           s.structured_payload->>'latest_summary') as text,
  s.created_at as observed_at,
  nullif(s.structured_payload->>'valid_until','')::date as valid_until,
  'signal'::text as source,
  s.confidence::text as confidence
from trainingpeaks_student_operational_signals s
where s.resolved_at is null
  and coalesce(s.lifecycle_state,'') <> 'resolved'
  and s.created_at >= now() - interval '45 days'
  and coalesce(s.structured_payload->>'display_summary',
               s.structured_payload->>'latest_summary') is not null;

comment on view physio_student_context_items is
  'Плоский список актуального контекста ученика: здоровье, график, цели, настроение. Источники — распознанная память и операционные сигналы из Telegram.';

-- Есть ли прямо сейчас активная проблема со здоровьем / пауза / недоступность
create or replace view physio_student_context_state as
select
  s.id as student_id,
  s.student_name,
  exists (
    select 1 from trainingpeaks_student_operational_signals os
    where os.student_id = s.id and os.resolved_at is null
      and os.lifecycle_state = 'active_problem'
      and os.created_at >= now() - interval '45 days'
  ) as has_active_health_problem,
  exists (
    select 1 from trainingpeaks_student_operational_signals os
    where os.student_id = s.id and os.resolved_at is null
      and os.signal_type in ('pause_training','schedule_unavailability_window')
      and os.created_at >= now() - interval '45 days'
  ) as has_pause_or_unavailable,
  exists (
    select 1 from trainingpeaks_student_operational_signals os
    where os.student_id = s.id and os.resolved_at is null
      and os.lifecycle_state = 'monitoring_after_return'
      and os.created_at >= now() - interval '45 days'
  ) as returning_after_issue,
  exists (
    select 1 from trainingpeaks_student_memory_items m
    where m.student_id = s.id and m.is_active
      and m.memory_type in ('health_status','pain_or_injury')
      and (m.valid_until is null or m.valid_until::date >= current_date)
      and m.last_seen_at >= now() - interval '60 days'
  ) as has_recent_health_note,
  (select count(*) from physio_student_context_items c where c.student_id = s.id) as context_items
from trainingpeaks_students s
where s.is_active and not coalesce(s.is_service_account,false) and s.archived_at is null;

-- Здоровье данных: что реально доезжает по каждому ученику
create or replace view physio_data_health as
select
  s.id as student_id,
  s.student_name,
  (select count(*) from trainingpeaks_health_metrics_cache h
    where h.student_id=s.id and h.metric_key='hrv' and h.metric_date >= current_date-30) as hrv_days_30,
  (select count(*) from trainingpeaks_health_metrics_cache h
    where h.student_id=s.id and h.metric_key='sleep_hours' and h.metric_date >= current_date-30) as sleep_days_30,
  (select count(*) from trainingpeaks_health_metrics_cache h
    where h.student_id=s.id and h.metric_key='pulse' and h.metric_date >= current_date-30) as rhr_days_30,
  (select count(*) from trainingpeaks_health_metrics_cache h
    where h.student_id=s.id and h.metric_key='weight_kg' and h.metric_date >= current_date-90) as weight_days_90,
  (select max(h.metric_date) from trainingpeaks_health_metrics_cache h where h.student_id=s.id) as last_health_date,
  (select count(*) from trainingpeaks_workout_cache w
    where w.student_id=s.id and w.is_completed and w.workout_date >= current_date-30) as runs_30,
  (select count(*) from trainingpeaks_workout_laps l
     join trainingpeaks_workout_cache w on w.id=l.workout_cache_id
    where w.student_id=s.id and w.workout_date >= current_date-30) as laps_30,
  (select ss.status from trainingpeaks_health_metrics_scan_status ss
    where ss.student_id=s.id order by ss.created_at desc limit 1) as last_scan_status,
  (select ss.error_message from trainingpeaks_health_metrics_scan_status ss
    where ss.student_id=s.id and ss.status='failed' order by ss.created_at desc limit 1) as last_scan_error,
  case
    when (select max(h.metric_date) from trainingpeaks_health_metrics_cache h where h.student_id=s.id) is null
      then 'часы не подключены'
    when (select max(h.metric_date) from trainingpeaks_health_metrics_cache h where h.student_id=s.id) < current_date - 7
      then 'данные с часов перестали приходить'
    when (select count(*) from trainingpeaks_health_metrics_cache h
           where h.student_id=s.id and h.metric_key='hrv' and h.metric_date >= current_date-30) = 0
      then 'нет HRV: готовность считается вслепую'
    when (select count(*) from trainingpeaks_health_metrics_cache h
           where h.student_id=s.id and h.metric_key='sleep_hours' and h.metric_date >= current_date-30) = 0
      then 'нет данных сна'
    else 'всё на месте'
  end as verdict
from trainingpeaks_students s
where s.is_active and not coalesce(s.is_service_account,false) and s.archived_at is null;

comment on view physio_data_health is
  'Полнота данных по каждому ученику. Нужна, чтобы отличать "у человека всё хорошо" от "мы про него ничего не знаем".';
