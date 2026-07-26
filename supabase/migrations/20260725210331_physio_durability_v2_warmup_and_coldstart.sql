-- v2 после проверки: (1) отбрасываем первые 5 минут — в них пульс ещё
-- догоняет нагрузку, и «холодный старт» датчика давал фиктивные 20-40%
-- декаплинга; (2) исключаем тренировки с интервальным названием;
-- (3) помечаем невалидными случаи, где пульс в Q1 аномально ниже остальных
-- квартилей — это артефакт ремня, а не физиология.
create or replace function physio_compute_durability(p_days int default 400)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with runs as (
    select w.id as wid, w.student_id, w.student_name, w.workout_date, w.trainingpeaks_workout_id
    from trainingpeaks_workout_cache w
    left join trainingpeaks_workout_derived_metrics dm on dm.workout_cache_id = w.id
    where w.is_completed and w.workout_type_value_id = 3
      and coalesce(dm.workout_type,'run') = 'run'
      and w.workout_date >= current_date - p_days
      and coalesce(w.title,'') !~* '\d+\s*[xхXХ]\s*\d'          -- не интервальная сессия
      and coalesce(dm.reps_detected_count, 0) = 0                -- и повторы не детектированы
  ),
  laps_raw as (
    select r.*, l.lap_index,
           coalesce(l.timer_time_s, l.elapsed_time_s) as t_s,
           l.distance_m as d_m, l.avg_hr,
           coalesce(l.total_ascent_m,0) - coalesce(l.total_descent_m,0) as net_climb
    from trainingpeaks_workout_laps l
    join runs r on r.wid = l.workout_cache_id
    where l.distance_m > 50 and coalesce(l.timer_time_s,l.elapsed_time_s) > 20
      and l.avg_hr between 70 and 220
      and l.distance_m / nullif(coalesce(l.timer_time_s,l.elapsed_time_s),0) between 1.5 and 7.0
  ),
  offsets as (
    select lr.*, sum(t_s) over (partition by wid order by lap_index
                                rows between unbounded preceding and current row) as cum_t
    from laps_raw lr
  ),
  laps as (
    -- разминочные 5 минут не участвуют: пульс там ещё догоняет нагрузку
    select * from offsets where cum_t > 300
  ),
  tot as (
    select wid, sum(t_s) tt, sum(d_m) td, count(*) nlaps,
           stddev_pop(d_m/nullif(t_s,0)) / nullif(avg(d_m/nullif(t_s,0)),0) as pace_cv,
           sum(abs(net_climb)) / nullif(sum(d_m),0) as climb_ratio
    from laps group by wid
  ),
  eligible as (
    select * from tot
    where tt between 2400 and 21600
      and nlaps >= 4 and pace_cv < 0.10 and climb_ratio < 0.04
  ),
  marked as (
    select l.*, e.tt,
           sum(l.t_s) over (partition by l.wid order by l.lap_index
                            rows between unbounded preceding and current row) - l.t_s/2 as mid_t
    from laps l join eligible e on e.wid = l.wid
  ),
  q as (
    select *, least(4, greatest(1, floor(mid_t / (tt/4.0))::int + 1)) as quart
    from marked
  ),
  agg as (
    select wid, student_id, student_name, workout_date, trainingpeaks_workout_id, quart,
           sum(d_m)/sum(t_s) as sp, sum(avg_hr*t_s)/sum(t_s) as hr, sum(t_s) as t
    from q group by 1,2,3,4,5,6
  ),
  piv as (
    select wid, student_id, student_name, workout_date, trainingpeaks_workout_id as tpwid,
           sum(t) dur_s,
           array_agg(round((sp/nullif(hr,0))::numeric, 6) order by quart) as ef,
           array_agg(round((1000/nullif(sp,0))::numeric, 1) order by quart) as pace,
           array_agg(round(hr::numeric, 1) order by quart) as hrs,
           count(*) nq
    from agg group by 1,2,3,4,5
  ),
  checked as (
    select p.*, e.td, e.pace_cv,
      -- «холодный старт»: пульс первой четверти аномально ниже остальных
      (p.hrs[1] < 0.88 * ((p.hrs[2]+p.hrs[3]+p.hrs[4])/3.0)) as cold_start
    from piv p join eligible e on e.wid = p.wid
    where p.nq = 4 and p.ef[1] is not null and p.ef[4] is not null
  )
  insert into physio_durability_samples (
    student_id, student_name, workout_cache_id, trainingpeaks_workout_id, workout_date,
    duration_s, distance_m, quartile_ef, quartile_pace, quartile_hr,
    ef_decline_pct, decline_per_hour_pct, hr_drift_pct, pace_fade_pct, pace_cv,
    is_valid, invalid_reason)
  select c.student_id, c.student_name, c.wid, c.tpwid, c.workout_date,
         c.dur_s, c.td, c.ef, c.pace, c.hrs,
         round(((c.ef[1] - c.ef[4]) / nullif(c.ef[1],0) * 100)::numeric, 2),
         round(((c.ef[1] - c.ef[4]) / nullif(c.ef[1],0) * 100 / (c.dur_s/3600.0))::numeric, 2),
         round(((c.hrs[4] - c.hrs[1]) / nullif(c.hrs[1],0) * 100)::numeric, 2),
         round(((c.pace[4] - c.pace[1]) / nullif(c.pace[1],0) * 100)::numeric, 2),
         round(c.pace_cv::numeric, 4),
         not c.cold_start,
         case when c.cold_start then 'cold_start_hr' end
  from checked c
  on conflict (workout_cache_id) do update set
    quartile_ef = excluded.quartile_ef, quartile_pace = excluded.quartile_pace,
    quartile_hr = excluded.quartile_hr, ef_decline_pct = excluded.ef_decline_pct,
    decline_per_hour_pct = excluded.decline_per_hour_pct, hr_drift_pct = excluded.hr_drift_pct,
    pace_fade_pct = excluded.pace_fade_pct, pace_cv = excluded.pace_cv,
    is_valid = excluded.is_valid, invalid_reason = excluded.invalid_reason,
    duration_s = excluded.duration_s, distance_m = excluded.distance_m, computed_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;
