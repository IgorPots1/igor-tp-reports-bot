-- Durability: как деградирует эффективность внутри длинной аэробной работы.
-- Вместо одной цифры "декаплинг первая/вторая половина" считаем EF по четырём
-- квартилям времени — получается кривая деградации, а не точка.
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
  ),
  laps as (
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
  tot as (
    select wid, sum(t_s) tt, sum(d_m) td, count(*) nlaps,
           stddev_pop(d_m/nullif(t_s,0)) / nullif(avg(d_m/nullif(t_s,0)),0) as pace_cv,
           sum(abs(net_climb)) / nullif(sum(d_m),0) as climb_ratio
    from laps group by wid
  ),
  eligible as (
    select * from tot
    where tt between 2400 and 21600   -- от 40 мин до 6 ч
      and nlaps >= 4
      and pace_cv < 0.12              -- равномерная аэробная работа, не интервалы
      and climb_ratio < 0.04          -- не горный рельеф
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
           sum(d_m)/sum(t_s) as sp,
           sum(avg_hr*t_s)/sum(t_s) as hr,
           sum(t_s) as t
    from q group by 1,2,3,4,5,6
  ),
  piv as (
    select wid, min(student_id) student_id, min(student_name) student_name,
           min(workout_date) workout_date, min(trainingpeaks_workout_id) tpwid,
           sum(t) dur_s,
           array_agg(round((sp/nullif(hr,0))::numeric, 6) order by quart) as ef,
           array_agg(round((1000/nullif(sp,0))::numeric, 1) order by quart) as pace,
           array_agg(round(hr::numeric, 1) order by quart) as hrs,
           count(*) nq
    from agg group by wid
  )
  insert into physio_durability_samples (
    student_id, student_name, workout_cache_id, trainingpeaks_workout_id, workout_date,
    duration_s, distance_m, quartile_ef, quartile_pace, quartile_hr,
    ef_decline_pct, decline_per_hour_pct, hr_drift_pct, pace_fade_pct, is_valid, invalid_reason)
  select p.student_id, p.student_name, p.wid, p.tpwid, p.workout_date,
         p.dur_s, e.td, p.ef, p.pace, p.hrs,
         round(((p.ef[1] - p.ef[4]) / nullif(p.ef[1],0) * 100)::numeric, 2),
         round(((p.ef[1] - p.ef[4]) / nullif(p.ef[1],0) * 100 / (p.dur_s/3600.0))::numeric, 2),
         round(((p.hrs[4] - p.hrs[1]) / nullif(p.hrs[1],0) * 100)::numeric, 2),
         round(((p.pace[4] - p.pace[1]) / nullif(p.pace[1],0) * 100)::numeric, 2),
         (p.nq = 4 and p.ef[1] is not null and p.ef[4] is not null),
         case when p.nq <> 4 then 'incomplete_quartiles' end
  from piv p join eligible e on e.wid = p.wid
  where p.nq = 4
  on conflict (workout_cache_id) do update set
    quartile_ef = excluded.quartile_ef,
    quartile_pace = excluded.quartile_pace,
    quartile_hr = excluded.quartile_hr,
    ef_decline_pct = excluded.ef_decline_pct,
    decline_per_hour_pct = excluded.decline_per_hour_pct,
    hr_drift_pct = excluded.hr_drift_pct,
    pace_fade_pct = excluded.pace_fade_pct,
    duration_s = excluded.duration_s,
    distance_m = excluded.distance_m,
    computed_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;
