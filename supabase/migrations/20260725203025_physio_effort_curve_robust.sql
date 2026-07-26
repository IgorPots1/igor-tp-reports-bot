-- Робастная версия: одиночный лучший результат почти всегда GPS-артефакт,
-- поэтому берём ВТОРОЙ лучший среди РАЗНЫХ тренировок (повторяемая способность),
-- отсекаем сброс высоты и физиологически невозможные скорости.
create or replace function physio_build_effort_points(p_window_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := current_date - p_window_days;
  v_count int;
begin
  delete from physio_effort_points where window_days = p_window_days;

  with runs as (
    select w.id as wid, w.student_id, w.student_name, w.workout_date,
           w.trainingpeaks_workout_id
    from trainingpeaks_workout_cache w
    where w.is_completed
      and w.workout_type_value_id = 3
      and w.workout_date >= v_from
      and w.workout_date <= current_date
  ),
  clean_laps as (
    select r.student_id, r.student_name, r.workout_date, r.wid,
           r.trainingpeaks_workout_id,
           l.lap_index,
           coalesce(l.timer_time_s, l.elapsed_time_s) as t_s,
           l.distance_m as d_m,
           l.avg_hr,
           coalesce(l.total_ascent_m,0)  as asc_m,
           coalesce(l.total_descent_m,0) as desc_m,
           row_number() over (partition by l.workout_cache_id order by l.lap_index) as rn
    from trainingpeaks_workout_laps l
    join runs r on r.wid = l.workout_cache_id
    where l.distance_m > 50
      and coalesce(l.timer_time_s, l.elapsed_time_s) > 15
      and l.distance_m / nullif(coalesce(l.timer_time_s, l.elapsed_time_s),0) between 1.2 and 8.0
  ),
  cum as (
    select c.*,
           sum(t_s)   over w as ct,
           sum(d_m)   over w as cd,
           sum(asc_m) over w as ca,
           sum(desc_m) over w as cdsc,
           sum(coalesce(avg_hr,0) * t_s) over w as chr_num,
           sum(case when avg_hr is not null then t_s else 0 end) over w as chr_den
    from clean_laps c
    window w as (partition by wid order by rn rows between unbounded preceding and current row)
  ),
  windows as (
    select
      e.student_id, e.student_name, e.workout_date, e.wid, e.trainingpeaks_workout_id,
      s.lap_index as lap_from, e.lap_index as lap_to,
      (e.ct - s.ct + s.t_s)  as dur_s,
      (e.cd - s.cd + s.d_m)  as dist_m,
      (e.ca - s.ca + s.asc_m)   as asc_m,
      (e.cdsc - s.cdsc + s.desc_m) as desc_m,
      case when (e.chr_den - s.chr_den + case when s.avg_hr is not null then s.t_s else 0 end) > 0
           then (e.chr_num - s.chr_num + coalesce(s.avg_hr,0)*s.t_s)
                / (e.chr_den - s.chr_den + case when s.avg_hr is not null then s.t_s else 0 end)
      end as w_hr
    from cum e
    join cum s
      on s.wid = e.wid
     and s.rn <= e.rn
     and e.rn - s.rn < 40
     and (e.lap_index - s.lap_index) = (e.rn - s.rn)
  ),
  typed as (
    select *, dist_m / dur_s as speed_mps,
      case
        when dur_s <  180 then '02_03min'
        when dur_s <  360 then '03_06min'
        when dur_s <  720 then '06_12min'
        when dur_s < 1500 then '12_25min'
        else '25_40min'
      end as bucket
    from windows
    where dur_s between 90 and 2400
  ),
  valid as (
    select * from typed
    where speed_mps between 1.5 and
      case bucket
        when '02_03min' then 6.7   -- 2:29/км
        when '03_06min' then 6.5
        when '06_12min' then 6.2
        when '12_25min' then 6.0
        else 5.8
      end
      -- отсекаем спуск: чистый сброс высоты > 1% искажает скорость
      and (desc_m - asc_m) / nullif(dist_m,0) < 0.01
  ),
  -- лучший результат в каждой тренировке (чтобы одна тренировка не дала все топ-места)
  per_workout as (
    select distinct on (student_id, bucket, wid)
      student_id, student_name, bucket, wid, trainingpeaks_workout_id, workout_date,
      dur_s, dist_m, speed_mps, w_hr, lap_from, lap_to
    from valid
    order by student_id, bucket, wid, speed_mps desc
  ),
  ranked as (
    select *,
      row_number() over (partition by student_id, bucket order by speed_mps desc) as rk,
      count(*)     over (partition by student_id, bucket) as n_workouts
    from per_workout
  ),
  -- робастный выбор: 2-й лучший при >=3 независимых тренировках, иначе лучший
  best as (
    select * from ranked
    where rk = case when n_workouts >= 3 then 2 else 1 end
  )
  insert into physio_effort_points (
    student_id, student_name, duration_bucket, duration_s, distance_m, speed_mps,
    avg_hr, workout_cache_id, trainingpeaks_workout_id, workout_date,
    lap_from, lap_to, window_days
  )
  select student_id, student_name, bucket, round(dur_s,1), round(dist_m,1), round(speed_mps,4),
         round(w_hr,1), wid, trainingpeaks_workout_id, workout_date, lap_from, lap_to, p_window_days
  from best;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
