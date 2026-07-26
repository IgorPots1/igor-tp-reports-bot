-- v4. Главная правка после независимой проверки: окно из последовательных
-- кругов могло захватывать работу ВМЕСТЕ с отдыхом внутри интервальной
-- тренировки — быстрые куски тянули среднюю скорость вверх, а трусцá держала
-- средний пульс внизу, и это проходило пульсовой гейт. Теперь считается
-- взвешенный по времени коэффициент вариации скорости ВНУТРИ окна
-- (через префиксные суммы: сумма d^2/t даёт второй момент) и окна с
-- CV >= 0.08 отбрасываются как неоднородные.
create or replace function physio_build_effort_points(p_window_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := current_date - p_window_days;
  v_count int := 0;
  v_student record;
  v_bucket text;
  v_buckets text[] := array['25_40min','12_25min','06_12min','03_06min','02_03min'];
  v_prev numeric;
  v_pick record;
begin
  delete from physio_effort_points where window_days = p_window_days;

  create temp table if not exists _cand (
    student_id uuid, student_name text, bucket text, wid uuid,
    trainingpeaks_workout_id bigint, workout_date date,
    dur_s numeric, dist_m numeric, speed_mps numeric, w_hr numeric,
    pace_cv numeric, lap_from int, lap_to int, rk int, n_workouts int
  ) on commit drop;
  delete from _cand;

  with runs as (
    select w.id as wid, w.student_id, w.student_name, w.workout_date, w.trainingpeaks_workout_id
    from trainingpeaks_workout_cache w
    left join trainingpeaks_workout_derived_metrics dm on dm.workout_cache_id = w.id
    where w.is_completed
      and w.workout_type_value_id = 3
      and coalesce(dm.workout_type, 'run') = 'run'
      and w.workout_date >= v_from and w.workout_date <= current_date
  ),
  hrmax as (
    select l.student_id, percentile_cont(0.99) within group (order by l.max_hr) as hr_peak
    from trainingpeaks_workout_laps l
    join runs r on r.wid = l.workout_cache_id
    where l.max_hr between 90 and 230
    group by 1
  ),
  clean_laps as (
    select r.student_id, r.student_name, r.workout_date, r.wid, r.trainingpeaks_workout_id,
           l.lap_index,
           coalesce(l.timer_time_s, l.elapsed_time_s) as t_s,
           l.distance_m as d_m, l.avg_hr,
           coalesce(l.total_ascent_m,0) as asc_m, coalesce(l.total_descent_m,0) as desc_m,
           row_number() over (partition by l.workout_cache_id order by l.lap_index) as rn
    from trainingpeaks_workout_laps l
    join runs r on r.wid = l.workout_cache_id
    where l.distance_m > 50
      and coalesce(l.timer_time_s, l.elapsed_time_s) > 15
      and l.distance_m / nullif(coalesce(l.timer_time_s, l.elapsed_time_s),0) between 1.2 and 8.0
  ),
  cum as (
    select c.*,
           sum(t_s) over w as ct, sum(d_m) over w as cd,
           sum(d_m*d_m/t_s) over w as cq,          -- второй момент скорости по времени
           sum(asc_m) over w as ca, sum(desc_m) over w as cdsc,
           sum(coalesce(avg_hr,0)*t_s) over w as chr_num,
           sum(case when avg_hr is not null then t_s else 0 end) over w as chr_den
    from clean_laps c
    window w as (partition by wid order by rn rows between unbounded preceding and current row)
  ),
  windows as (
    select e.student_id, e.student_name, e.workout_date, e.wid, e.trainingpeaks_workout_id,
      s.lap_index as lap_from, e.lap_index as lap_to,
      (e.ct - s.ct + s.t_s) as dur_s,
      (e.cd - s.cd + s.d_m) as dist_m,
      (e.cq - s.cq + s.d_m*s.d_m/s.t_s) as sum_q,
      (e.ca - s.ca + s.asc_m) as asc_m,
      (e.cdsc - s.cdsc + s.desc_m) as desc_m,
      case when (e.chr_den - s.chr_den + case when s.avg_hr is not null then s.t_s else 0 end) > 0
           then (e.chr_num - s.chr_num + coalesce(s.avg_hr,0)*s.t_s)
                / (e.chr_den - s.chr_den + case when s.avg_hr is not null then s.t_s else 0 end)
      end as w_hr
    from cum e
    join cum s on s.wid = e.wid and s.rn <= e.rn and e.rn - s.rn < 40
                and (e.lap_index - s.lap_index) = (e.rn - s.rn)
  ),
  typed as (
    select w.*, w.dist_m / w.dur_s as speed_mps, h.hr_peak,
      -- CV скорости внутри окна, взвешенный по времени
      case when w.dist_m > 0 then
        sqrt(greatest(0, w.sum_q / w.dur_s - power(w.dist_m / w.dur_s, 2)))
        / (w.dist_m / w.dur_s)
      end as pace_cv,
      case when w.dur_s < 180 then '02_03min'
           when w.dur_s < 360 then '03_06min'
           when w.dur_s < 720 then '06_12min'
           when w.dur_s < 1500 then '12_25min'
           else '25_40min' end as bucket
    from windows w
    left join hrmax h on h.student_id = w.student_id
    where w.dur_s between 90 and 2400
  ),
  valid as (
    select * from typed
    where speed_mps between 1.5 and
      case bucket when '02_03min' then 6.7 when '03_06min' then 6.5
                  when '06_12min' then 6.2 when '12_25min' then 6.0 else 5.8 end
      and (desc_m - asc_m) / nullif(dist_m,0) < 0.01
      and w_hr is not null and hr_peak is not null
      and w_hr / hr_peak >= case when bucket in ('02_03min','03_06min') then 0.82 else 0.86 end
      -- окно должно быть ОДНОРОДНЫМ усилием, а не работой вперемешку с отдыхом
      and coalesce(pace_cv, 1) < 0.08
  ),
  per_workout as (
    select distinct on (student_id, bucket, wid)
      student_id, student_name, bucket, wid, trainingpeaks_workout_id, workout_date,
      dur_s, dist_m, speed_mps, w_hr, pace_cv, lap_from, lap_to
    from valid
    order by student_id, bucket, wid, speed_mps desc
  )
  insert into _cand
  select *, row_number() over (partition by student_id, bucket order by speed_mps desc),
         count(*) over (partition by student_id, bucket)
  from per_workout;

  for v_student in select distinct student_id, student_name from _cand loop
    v_prev := null;
    foreach v_bucket in array v_buckets loop
      if v_prev is null then
        select * into v_pick from _cand c
        where c.student_id = v_student.student_id and c.bucket = v_bucket
          and c.rk = case when c.n_workouts >= 3 then 2 else 1 end
        limit 1;
      else
        select * into v_pick from _cand c
        where c.student_id = v_student.student_id and c.bucket = v_bucket
          and c.speed_mps >= v_prev and c.speed_mps <= v_prev * 1.30
        order by c.speed_mps desc
        offset case when (select count(*) from _cand c2
                          where c2.student_id = v_student.student_id and c2.bucket = v_bucket
                            and c2.speed_mps >= v_prev and c2.speed_mps <= v_prev * 1.30) >= 3
                    then 1 else 0 end
        limit 1;
      end if;

      if v_pick.student_id is not null then
        insert into physio_effort_points (
          student_id, student_name, duration_bucket, duration_s, distance_m, speed_mps,
          avg_hr, workout_cache_id, trainingpeaks_workout_id, workout_date,
          lap_from, lap_to, window_days)
        values (v_pick.student_id, v_pick.student_name, v_bucket, round(v_pick.dur_s,1),
                round(v_pick.dist_m,1), round(v_pick.speed_mps,4), round(v_pick.w_hr,1),
                v_pick.wid, v_pick.trainingpeaks_workout_id, v_pick.workout_date,
                v_pick.lap_from, v_pick.lap_to, p_window_days);
        v_count := v_count + 1;
        v_prev := v_pick.speed_mps;
      end if;
      v_pick := null;
    end loop;
  end loop;

  return v_count;
end $$;
