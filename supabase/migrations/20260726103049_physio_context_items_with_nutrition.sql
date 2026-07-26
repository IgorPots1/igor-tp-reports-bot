create or replace view physio_student_context_items as
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

select
  s.student_id,
  case
    when s.signal_type in ('health_issue_started','health_issue_improving',
                           'health_issue_resolved','pain_injury','pause_training') then 'health'
    when s.signal_type in ('schedule_availability_window','schedule_unavailability_window',
                           'move_workout_candidate','plan_generation_constraint') then 'schedule'
    else 'other'
  end,
  s.signal_type,
  coalesce(s.structured_payload->>'display_summary',
           s.structured_payload->>'latest_summary'),
  s.created_at,
  nullif(s.structured_payload->>'valid_until','')::date,
  'signal'::text,
  s.confidence::text
from trainingpeaks_student_operational_signals s
where s.resolved_at is null
  and coalesce(s.lifecycle_state,'') <> 'resolved'
  and s.created_at >= now() - interval '45 days'
  and coalesce(s.structured_payload->>'display_summary',
               s.structured_payload->>'latest_summary') is not null

union all

-- Профиль питания: цель и текущий фокус
select
  np.student_id, 'nutrition'::text, 'nutrition_focus'::text,
  concat_ws(' · ',
    case np.nutrition_goal_type
      when 'lose' then 'Цель по питанию: снижение веса'
      when 'maintain' then 'Цель по питанию: удержание веса'
      when 'gain' then 'Цель по питанию: набор'
      else 'Ведёт дневник питания' end,
    nullif(np.nutrition_memory->>'last_focus',''),
    case when np.current_weight_kg is not null
         then 'вес ' || np.current_weight_kg || ' кг' end),
  np.updated_at, null::date, 'nutrition'::text, null::text
from nutrition_student_profiles np
where np.enabled

union all

-- Устойчивые тренды по питанию
select
  np.student_id, 'nutrition'::text, 'nutrition_trend'::text, t.trend,
  np.updated_at, null::date, 'nutrition'::text, null::text
from nutrition_student_profiles np
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(np.nutrition_memory->'key_trends')='array'
       then np.nutrition_memory->'key_trends' else '[]'::jsonb end) as t(trend)
where np.enabled and length(t.trend) > 0

union all

-- Предупреждения из последнего недельного разбора питания
select
  wa.student_id, 'nutrition'::text,
  case when f.kind = 'hard' then 'nutrition_hard_flag' else 'nutrition_flag' end,
  f.flag, wa.created_at, null::date, 'nutrition'::text, null::text
from (
  select distinct on (student_id) student_id, safety_flags, created_at
  from nutrition_weekly_analyses
  where archived_at is null and week_to >= current_date - 60
  order by student_id, week_to desc, created_at desc
) wa
cross join lateral (
  select 'hard'::text as kind, x as flag
  from jsonb_array_elements_text(
    case when jsonb_typeof(wa.safety_flags->'hard_flags')='array'
         then wa.safety_flags->'hard_flags' else '[]'::jsonb end) x
  union all
  select 'soft', x
  from jsonb_array_elements_text(
    case when jsonb_typeof(wa.safety_flags->'soft_flags')='array'
         then wa.safety_flags->'soft_flags' else '[]'::jsonb end) x
) f
where length(f.flag) > 0;
