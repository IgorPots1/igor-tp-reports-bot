-- Сбор кривой максимальных усилий из последовательных кругов.
-- Идея: у нас нет посекундного потока, но есть 153k кругов. Скользящим окном
-- по последовательным кругам одной тренировки строим все возможные отрезки
-- длительностью 1.5-40 мин и берём лучший по скорости в каждом бакете.
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
      and w.workout_type_value_id = 3            -- бег
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
           row_number() over (partition by l.workout_cache_id order by l.lap_index) as rn
    from trainingpeaks_workout_laps l
    join runs r on r.wid = l.workout_cache_id
    where l.distance_m > 50
      and coalesce(l.timer_time_s, l.elapsed_time_s) > 15
      and l.distance_m / nullif(coalesce(l.timer_time_s, l.elapsed_time_s),0) between 1.2 and 8.0
  ),
  cum as (
    select c.*,
           sum(t_s)  over w as ct,
           sum(d_m)  over w as cd,
           sum(coalesce(avg_hr,0) * t_s) over w as chr_num,
           sum(case when avg_hr is not null then t_s else 0 end) over w as chr_den
    from clean_laps c
    window w as (partition by wid order by rn rows between unbounded preceding and current row)
  ),
  windows as (
    select
      e.student_id, e.student_name, e.workout_date, e.wid, e.trainingpeaks_workout_id,
      s.lap_index as lap_from, e.lap_index as lap_to,
      (e.ct - s.ct + s.t_s) as dur_s,
      (e.cd - s.cd + s.d_m) as dist_m,
      case when (e.chr_den - s.chr_den + case when s.avg_hr is not null then s.t_s else 0 end) > 0
           then (e.chr_num - s.chr_num + coalesce(s.avg_hr,0)*s.t_s)
                / (e.chr_den - s.chr_den + case when s.avg_hr is not null then s.t_s else 0 end)
      end as w_hr
    from cum e
    join cum s
      on s.wid = e.wid
     and s.rn <= e.rn
     and e.rn - s.rn < 40
     and (e.lap_index - s.lap_index) = (e.rn - s.rn)   -- только непрерывные отрезки
  ),
  valid as (
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
      and dist_m / dur_s between 1.5 and 7.5
  ),
  best as (
    select distinct on (student_id, bucket)
      student_id, student_name, bucket, dur_s, dist_m, speed_mps, w_hr,
      wid, trainingpeaks_workout_id, workout_date, lap_from, lap_to
    from valid
    order by student_id, bucket, speed_mps desc
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
