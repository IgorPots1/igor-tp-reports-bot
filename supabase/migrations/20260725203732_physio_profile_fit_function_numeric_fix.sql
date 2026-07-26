create or replace function physio_fit_profiles(p_window_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  update physio_profiles set is_current = false
   where is_current and window_days = p_window_days;

  with fit as (
    select student_id,
           max(student_name) as student_name,
           regr_slope(distance_m, duration_s)::numeric     as cs,
           regr_intercept(distance_m, duration_s)::numeric as dprime,
           regr_r2(distance_m, duration_s)::numeric        as r2,
           count(*)::int as n,
           min(workout_date) as wfrom, max(workout_date) as wto,
           jsonb_agg(jsonb_build_object(
             'bucket', duration_bucket, 't', round(duration_s), 'd', round(distance_m),
             'speed', round(speed_mps,3), 'pace_s_km', round(1000/speed_mps),
             'hr', avg_hr, 'date', workout_date, 'workout_id', trainingpeaks_workout_id
           ) order by duration_s) as points
    from physio_effort_points
    where window_days = p_window_days
    group by student_id
    having count(*) >= 3
  ),
  dur as (
    select student_id,
           (percentile_cont(0.5) within group (order by decline_per_hour_pct))::numeric as dur_idx,
           count(*)::int as n_samples
    from physio_durability_samples
    where is_valid and workout_date >= current_date - p_window_days
      and decline_per_hour_pct between -15 and 40
    group by student_id
    having count(*) >= 3
  ),
  zsnap as (
    select distinct on (student_id) student_id,
      nullif((zones->'heartRateZones'->0->>'threshold'),'')::numeric        as lthr,
      nullif((zones->'heartRateZones'->0->>'maximumHeartRate'),'')::numeric as max_hr,
      nullif((zones->'heartRateZones'->0->>'restingHeartRate'),'')::numeric as rest_hr,
      nullif((zones->'speedZones'->0->>'threshold'),'')::numeric            as thr_speed
    from tp_zone_snapshots where student_id is not null
    order by student_id, captured_at desc
  ),
  base as (
    select f.*, d.dur_idx, d.n_samples, z.lthr, z.max_hr, z.rest_hr, z.thr_speed,
           s.tp_id as trainingpeaks_athlete_id,
           (f.cs * 1800 + f.dprime) as d30,
           least(1.14::numeric, greatest(1.03::numeric,
             1.04 + 0.008 * least(12::numeric, greatest(0::numeric, coalesce(d.dur_idx, 5))))) as riegel_e
    from fit f
    left join dur d on d.student_id = f.student_id
    left join zsnap z on z.student_id = f.student_id
    left join (select id, (regexp_match(trainingpeaks_athlete_url, '(\d+)'))[1]::bigint as tp_id
               from trainingpeaks_students) s on s.id = f.student_id
  ),
  scored as (
    select b.*,
      case
        when b.cs is null or b.cs < 1.8 or b.cs > 6.5 then 'insufficient'
        when b.n >= 4 and b.r2 >= 0.985 and b.dprime between 20 and 450 then 'high'
        when b.n >= 3 and b.r2 >= 0.95  and b.dprime between 0  and 700 then 'medium'
        else 'low'
      end as quality
    from base b
  ),
  predicted as (
    select s.*,
      (select jsonb_object_agg(dist.label, jsonb_build_object(
          'distance_m', dist.d,
          'seconds', round(t.sec),
          'time', to_char((round(t.sec) || ' seconds')::interval, 'HH24:MI:SS'),
          'pace_s_km', round(t.sec / (dist.d/1000.0)),
          'method', t.method))
       from (values ('d1500',1500.0::numeric),('d3000',3000.0::numeric),('d5000',5000.0::numeric),
                    ('d10000',10000.0::numeric),('half',21097.5::numeric),('marathon',42195.0::numeric)) as dist(label,d)
       cross join lateral (
         select case when dist.d <= s.d30 then (dist.d - s.dprime)/s.cs
                     else 1800 * power(dist.d / nullif(s.d30,0), s.riegel_e) end as sec,
                case when dist.d <= s.d30 then 'cs_model' else 'cs_anchor_riegel_durability' end as method
       ) t
      ) as predictions
    from scored s
    where s.quality <> 'insufficient'
  ),
  withvdot as (
    select p.*,
      (select case when pc.pct > 0 then (o.vo2/pc.pct)::numeric end
       from (select (p.predictions->'d5000'->>'seconds')::numeric/60.0 as tmin) q,
       lateral (select (5000.0/q.tmin) as vmin) v,
       lateral (select -4.60 + 0.182258*v.vmin + 0.000104*v.vmin*v.vmin as vo2) o,
       lateral (select 0.8 + 0.1894393*exp(-0.012778*q.tmin::double precision)
                     + 0.2989558*exp(-0.1932605*q.tmin::double precision) as pct) pc
      ) as vdot
    from predicted p
  )
  insert into physio_profiles (
    student_id, student_name, trainingpeaks_athlete_id, window_days, window_from, window_to,
    cs_mps, d_prime_m, cs_pace_sec_per_km, model_r2, n_points, points, quality, quality_reasons,
    lthr, max_hr, rest_hr, tp_threshold_pace_sec_per_km, vdot, zones, predictions,
    durability_index, durability_grade, durability_samples, is_current)
  select
    w.student_id, w.student_name, w.trainingpeaks_athlete_id, p_window_days, w.wfrom, w.wto,
    round(w.cs, 4), round(w.dprime, 1), round(1000/w.cs), round(w.r2, 4), w.n, w.points, w.quality,
    array_remove(array[
      case when w.n < 4 then 'мало точек кривой' end,
      case when w.r2 < 0.985 then 'разброс точек выше идеального' end,
      case when w.dprime < 20 then 'D-prime занижен: мало коротких максимальных отрезков' end,
      case when w.dprime > 450 then 'D-prime завышен: возможен артефакт короткого отрезка' end,
      case when w.n_samples is null then 'нет данных durability, взят средний показатель' end,
      'точки взяты из тренировок, а не из контрольных тестов — CS скорее занижена'
    ], null),
    w.lthr, w.max_hr, w.rest_hr,
    case when w.thr_speed > 0 then round(1000/w.thr_speed) end,
    round(w.vdot, 1),
    jsonb_build_object(
      'basis','critical_speed',
      'cs_pace_s_km', round(1000/w.cs),
      'z1_recovery',  jsonb_build_object('from_pace_s_km', null,                    'to_pace_s_km', round(1000/(w.cs*0.72))),
      'z2_aerobic',   jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.72)), 'to_pace_s_km', round(1000/(w.cs*0.83))),
      'z3_marathon',  jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.83)), 'to_pace_s_km', round(1000/(w.cs*0.90))),
      'z4_threshold', jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.90)), 'to_pace_s_km', round(1000/(w.cs*0.97))),
      'z5_cs',        jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.97)), 'to_pace_s_km', round(1000/(w.cs*1.03))),
      'z6_vo2max',    jsonb_build_object('from_pace_s_km', round(1000/(w.cs*1.03)), 'to_pace_s_km', round(1000/(w.cs*1.15))),
      'z7_anaerobic', jsonb_build_object('from_pace_s_km', round(1000/(w.cs*1.15)), 'to_pace_s_km', null)
    ),
    w.predictions,
    round(w.dur_idx, 2),
    case when w.dur_idx is null then 'unknown'
         when w.dur_idx < 3 then 'strong'
         when w.dur_idx < 7 then 'ok'
         else 'weak' end,
    coalesce(w.n_samples, 0),
    true
  from withvdot w
  on conflict (student_id, window_days) where is_current do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
