-- Запросы для подготовки гоночных карточек.
-- Supabase MCP, проект igor-agent-hub (wlbswdnpqrcdaqwlfnoo).
--
-- ГЛАВНАЯ ЛОВУШКА СХЕМЫ:
--   trainingpeaks_students.student_id  — текстовый слаг ('valentin-shavkun')
--   trainingpeaks_students.id          — uuid
--   trainingpeaks_workout_cache.student_id и
--   trainingpeaks_workout_derived_metrics.student_id — это uuid,
--   то есть ссылка на students.id, а НЕ на слаг.
-- Подставишь слаг напрямую в workout_cache — получишь
-- "invalid input syntax for type uuid". Всегда идти через CTE со students.
--
-- Единицы в source_snapshot:
--   rawDistance      — метры
--   rawTotalTime     — ЧАСЫ (дробные)
--   elevationGain    — метры
--   heartRateAverage — уд/мин
--   velocityAverage  — м/с, считается по времени в движении, ДЛЯ РЕКОРДОВ НЕ ГОДИТСЯ


-- 1. Найти ученика. Имена в базе латиницей, кириллица по ilike не найдётся.
select student_id, student_name, telegram_formality, sex, is_active
from trainingpeaks_students
where student_name ilike '%shavkun%' or student_id ilike '%shavkun%';


-- 2. Кто стартует в ближайшие выходные.
-- Скан неполон и местами неверен: сверять с Игорем (см. research-brief.md).
select r.event_date, s.student_name, s.student_id,
       r.title, r.distance_km, r.distance_raw, r.source
from trainingpeaks_race_events r
join trainingpeaks_students s on s.id = r.student_id
where r.event_date between :from and :to
order by r.event_date, s.student_name;


-- 3. Форма группы: медианный рабочий темп по отрезкам.
-- Это главный источник для расчёта цели. Средний темп сессии НЕ использовать.
with s as (
  select id, student_id, student_name
  from trainingpeaks_students
  where student_id = any(:student_ids)
),
d as (
  select s.student_name, s.student_id, dm.workout_date, (p.pace)::numeric as pace
  from trainingpeaks_workout_derived_metrics dm
  join s on s.id = dm.student_id
  cross join lateral jsonb_array_elements_text(dm.rep_paces) as p(pace)
  where dm.rep_paces is not null
    and dm.workout_date >= current_date - interval '90 days'
)
select student_name, student_id,
       count(distinct workout_date) as sessions,
       count(*) as reps,
       to_char((round(percentile_cont(0.5)  within group (order by pace)) || ' seconds')::interval, 'MI:SS') as median_pace,
       to_char((round(percentile_cont(0.15) within group (order by pace)) || ' seconds')::interval, 'MI:SS') as fast_pace,
       max(workout_date) as last_session
from d
group by student_name, student_id
order by percentile_cont(0.5) within group (order by pace);


-- 4. Отдельные интервальные сессии с разбивкой по отрезкам.
-- rep_pace_fade_pct показывает, разваливался ли темп к концу.
with s as (select id from trainingpeaks_students where student_id = :student_id)
select dm.workout_date, w.title, dm.reps_detected_count,
       dm.rep_paces, dm.rep_pace_fade_pct, round(dm.avg_hr) as hr
from trainingpeaks_workout_derived_metrics dm
join trainingpeaks_workout_cache w on w.id = dm.workout_cache_id, s
where dm.student_id = s.id and dm.rep_paces is not null
order by dm.workout_date desc
limit 12;


-- 5. Личный рекорд на дистанции (пример: десятка).
-- Сортировка по ЧИСТОМУ темпу. По velocityAverage сортировать нельзя:
-- он считается по времени в движении и ставит наверх медленные пробежки.
with s as (select id from trainingpeaks_students where student_id = :student_id),
r as (
  select workout_date, title,
         (source_snapshot->>'rawDistance')::numeric as dist_m,
         (source_snapshot->>'rawTotalTime')::numeric * 3600 as sec,
         (source_snapshot->>'elevationGain')::numeric as gain,
         (source_snapshot->>'heartRateAverage')::numeric as hr
  from trainingpeaks_workout_cache w, s
  where w.student_id = s.id and w.is_completed
    and (source_snapshot->>'rawDistance')::numeric between :dist_min and :dist_max
)
select workout_date, title, round(dist_m) as dist_m,
       to_char((sec || ' seconds')::interval, 'HH24:MI:SS') as total_time,
       to_char((round(sec / (dist_m / 1000)) || ' seconds')::interval, 'MI:SS') as pace_km,
       round(gain) as gain, round(hr) as hr
from r
order by sec / (dist_m / 1000)
limit 10;
-- Границы дистанции: десятка 9600..10600, полумарафон 20500..21600, пятёрка 4800..5300.
-- Рекорд с заметным набором высоты сильнее такого же по плоскому: цель поднимать.


-- 6. Последние тренировки с рельефом и пульсом.
-- Высокий пульс на лёгком бегу — повод ставить цель консервативнее.
with s as (select id from trainingpeaks_students where student_id = :student_id)
select workout_date, title,
       round((source_snapshot->>'rawDistance')::numeric) as dist_m,
       to_char((round((source_snapshot->>'rawTotalTime')::numeric * 3600
              / ((source_snapshot->>'rawDistance')::numeric / 1000)) || ' seconds')::interval, 'MI:SS') as pace_km,
       round((source_snapshot->>'elevationGain')::numeric) as gain,
       round((source_snapshot->>'heartRateAverage')::numeric) as hr
from trainingpeaks_workout_cache w, s
where w.student_id = s.id and w.is_completed
  and coalesce((source_snapshot->>'rawDistance')::numeric, 0) > 1500
order by workout_date desc
limit 25;


-- 7. Обращение и заметки по ученику. При telegram_formality = 'unknown'
-- спрашивать Игоря, не угадывать.
select student_id, student_name, telegram_formality, telegram_context_notes, notes
from trainingpeaks_students
where student_id = :student_id;
