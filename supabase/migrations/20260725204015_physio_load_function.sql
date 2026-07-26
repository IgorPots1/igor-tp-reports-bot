-- Тренировочная нагрузка: Banister TRIMP по пульсовому резерву (считается
-- по кругам, а не по средним за тренировку), CTL/ATL/TSB с константами 42/7,
-- ACWR в связанном и НЕсвязанном варианте (связанный математически некорректен,
-- Impellizzeri 2020), монотонность и strain по Foster.
create or replace function physio_compute_load(p_days int default 400)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with zsnap as (
    select distinct on (student_id) student_id,
      nullif((zones->'heartRateZones'->0->>'maximumHeartRate'),'')::numeric as max_hr,
      nullif((zones->'heartRateZones'->0->>'restingHeartRate'),'')::numeric as rest_hr
    from tp_zone_snapshots where student_id is not null
    order by student_id, captured_at desc
  ),
  obs as (
    select l.student_id,
           percentile_cont(0.995) within group (order by l.max_hr) as obs_max_hr
    from trainingpeaks_workout_laps l
    where l.max_hr between 90 and 230
    group by 1
  ),
  obs_rest as (
    select student_id, percentile_cont(0.10) within group (order by rhr) as obs_rest_hr
    from physio_readiness_daily where rhr is not null group by 1
  ),
  hr_ref as (
    select s.id as student_id, s.student_name, s.sex,
           coalesce(z.max_hr,  o.obs_max_hr,  190)::numeric as hr_max,
           coalesce(z.rest_hr, r.obs_rest_hr, 55)::numeric  as hr_rest
    from trainingpeaks_students s
    left join zsnap z on z.student_id = s.id
    left join obs o   on o.student_id = s.id
    left join obs_rest r on r.student_id = s.id
  ),
  w as (
    select w.id as wid, w.student_id, w.workout_date, w.completed_time_raw, w.completed_distance_raw
    from trainingpeaks_workout_cache w
    where w.is_completed and w.workout_date >= current_date - p_days
      and w.workout_date <= current_date
  ),
  lap_agg as (
    select l.workout_cache_id as wid,
           sum(coalesce(l.timer_time_s, l.elapsed_time_s)) as t_s,
           sum(l.distance_m) as d_m,
           sum(l.avg_hr * coalesce(l.timer_time_s, l.elapsed_time_s))
             / nullif(sum(case when l.avg_hr is not null then coalesce(l.timer_time_s,l.elapsed_time_s) end),0) as hr
    from trainingpeaks_workout_laps l
    where l.avg_hr between 70 and 220
    group by 1
  ),
  per_workout as (
    select w.student_id, w.workout_date,
           coalesce(la.t_s, w.completed_time_raw*3600) as t_s,
           coalesce(la.d_m, w.completed_distance_raw)  as d_m,
           coalesce(la.hr, dm.avg_hr) as hr
    from w
    left join lap_agg la on la.wid = w.wid
    left join trainingpeaks_workout_derived_metrics dm on dm.workout_cache_id = w.wid
  ),
  trimped as (
    select p.student_id, p.workout_date, p.t_s, p.d_m,
      case when p.hr is not null and h.hr_max > h.hr_rest then
        (p.t_s/60.0) * greatest(0, least(1, (p.hr - h.hr_rest)/(h.hr_max - h.hr_rest)))
        * case when h.sex = 'female'
               then 0.86 * exp(1.67 * greatest(0, least(1, (p.hr - h.hr_rest)/(h.hr_max - h.hr_rest)))::double precision)
               else 0.64 * exp(1.92 * greatest(0, least(1, (p.hr - h.hr_rest)/(h.hr_max - h.hr_rest)))::double precision)
          end
      else 0 end::numeric as trimp
    from per_workout p join hr_ref h on h.student_id = p.student_id
    where p.t_s > 0
  ),
  daily as (
    select student_id, workout_date as day, count(*)::int as sessions,
           sum(t_s) as dur, sum(coalesce(d_m,0)) as dist, sum(trimp) as trimp
    from trimped group by 1,2
  ),
  bounds as (
    select student_id, min(day) as d0, current_date as d1 from daily group by 1
  ),
  spine as (
    select b.student_id, g::date as day,
           coalesce(d.sessions,0) as sessions, coalesce(d.dur,0) as dur,
           coalesce(d.dist,0) as dist, coalesce(d.trimp,0) as trimp,
           row_number() over (partition by b.student_id order by g) as rn
    from bounds b
    cross join lateral generate_series(b.d0, b.d1, interval '1 day') g
    left join daily d on d.student_id = b.student_id and d.day = g::date
  ),
  rec as (
    select student_id, day, rn, sessions, dur, dist, trimp,
           (trimp/42.0)::numeric as ctl, (trimp/7.0)::numeric as atl
    from spine where rn = 1
    union all
    select s.student_id, s.day, s.rn, s.sessions, s.dur, s.dist, s.trimp,
           (r.ctl + (s.trimp - r.ctl)/42.0)::numeric,
           (r.atl + (s.trimp - r.atl)/7.0)::numeric
    from rec r join spine s on s.student_id = r.student_id and s.rn = r.rn + 1
  ),
  final as (
    select r.*,
      avg(trimp) over (partition by student_id order by day rows between 6 preceding and current row) as a7,
      avg(trimp) over (partition by student_id order by day rows between 27 preceding and current row) as a28,
      avg(trimp) over (partition by student_id order by day rows between 27 preceding and 7 preceding) as a21_prev,
      stddev_samp(trimp) over (partition by student_id order by day rows between 6 preceding and current row) as sd7,
      sum(trimp) over (partition by student_id order by day rows between 6 preceding and current row) as sum7
    from rec r
  )
  insert into physio_load_daily (
    student_id, student_name, metric_date, sessions, duration_s, distance_m, trimp,
    ctl, atl, tsb, acwr, acwr_uncoupled, monotony, strain)
  select f.student_id, s.student_name, f.day, f.sessions, round(f.dur), round(f.dist), round(f.trimp,2),
    round(f.ctl,2), round(f.atl,2), round(f.ctl - f.atl,2),
    case when f.a28 > 0 then round((f.a7/f.a28)::numeric,3) end,
    case when f.a21_prev > 0 then round((f.a7/f.a21_prev)::numeric,3) end,
    case when f.sd7 > 0 then round((f.a7/f.sd7)::numeric,2) end,
    case when f.sd7 > 0 then round((f.sum7 * f.a7/f.sd7)::numeric,0) end
  from final f
  join trainingpeaks_students s on s.id = f.student_id
  on conflict (student_id, metric_date) do update set
    sessions = excluded.sessions, duration_s = excluded.duration_s,
    distance_m = excluded.distance_m, trimp = excluded.trimp,
    ctl = excluded.ctl, atl = excluded.atl, tsb = excluded.tsb,
    acwr = excluded.acwr, acwr_uncoupled = excluded.acwr_uncoupled,
    monotony = excluded.monotony, strain = excluded.strain, computed_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;
