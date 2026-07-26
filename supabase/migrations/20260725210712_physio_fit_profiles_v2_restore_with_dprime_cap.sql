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
        when b.n >= 4 and b.r2 >= 0.985 and b.dprime between 20 and 300 then 'high'
        when b.n >= 3 and b.r2 >= 0.95  and b.dprime between 0  and 700 then 'medium'
        else 'low'
      end as quality
    from base b
  ),
  predicted as (
    select s.*,
      (select jsonb_object_agg(dist.label, jsonb_build_object(
          'distance_m', dist.d, 'seconds', round(t.sec),
          'time', to_char((round(t.sec) || ' seconds')::interval, 'HH24:MI:SS'),
          'pace_s_km', round(t.sec / (dist.d/1000.0)), 'method', t.method))
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
      case when w.dprime > 300 then 'D-prime выше типичного для бегуна коридора 100-250 м' end,
      case when w.n_samples is null then 'нет данных durability, взят средний показатель' end,
      'точки взяты из тренировок, а не из контрольных тестов — CS скорее занижена'
    ], null),
    w.lthr, w.max_hr, w.rest_hr,
    case when w.thr_speed > 0 then round(1000/w.thr_speed) end,
    round(w.vdot, 1),
    jsonb_build_object(
      'basis','critical_speed', 'cs_pace_s_km', round(1000/w.cs),
      'z1_recovery',  jsonb_build_object('from_pace_s_km', null,                    'to_pace_s_km', round(1000/(w.cs*0.72))),
      'z2_aerobic',   jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.72)), 'to_pace_s_km', round(1000/(w.cs*0.83))),
      'z3_marathon',  jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.83)), 'to_pace_s_km', round(1000/(w.cs*0.90))),
      'z4_threshold', jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.90)), 'to_pace_s_km', round(1000/(w.cs*0.97))),
      'z5_cs',        jsonb_build_object('from_pace_s_km', round(1000/(w.cs*0.97)), 'to_pace_s_km', round(1000/(w.cs*1.03))),
      'z6_vo2max',    jsonb_build_object('from_pace_s_km', round(1000/(w.cs*1.03)), 'to_pace_s_km', round(1000/(w.cs*1.15))),
      'z7_anaerobic', jsonb_build_object('from_pace_s_km', round(1000/(w.cs*1.15)), 'to_pace_s_km', null)
    ),
    w.predictions, round(w.dur_idx, 2),
    case when w.dur_idx is null then 'unknown'
         when w.dur_idx < 3 then 'strong'
         when w.dur_idx < 7 then 'ok'
         else 'weak' end,
    coalesce(w.n_samples, 0), true
  from withvdot w
  on conflict (student_id, window_days) where is_current do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Алерты v3: ACWR требует зрелой хронической базы
create or replace function physio_generate_alerts(p_date date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  delete from physio_alerts where alert_date = p_date and status = 'open';

  with active as (
    select id as student_id, student_name from trainingpeaks_students
    where is_active and not coalesce(is_service_account,false) and archived_at is null
  ),
  history as (
    select student_id, (max(metric_date) - min(metric_date)) as history_days
    from physio_load_daily group by 1
  ),
  a_hrv as (
    select r.student_id, r.student_name,
           count(*) filter (where r.hrv_state='red') as red_days,
           count(*) filter (where r.hrv_state <> 'no_data') as have_days,
           min(r.readiness_score) as worst_score
    from physio_readiness_daily r
    where r.metric_date between p_date - 4 and p_date
    group by 1,2
    having count(*) filter (where r.hrv_state <> 'no_data') >= 3
       and count(*) filter (where r.hrv_state='red') >= 2
  ),
  a_dec as (
    select distinct on (d.student_id) d.student_id, d.student_name, d.workout_date,
           d.ef_decline_pct, d.hr_drift_pct, round(d.duration_s/60) as minutes
    from physio_durability_samples d
    where d.is_valid and d.duration_s >= 3600 and d.workout_date >= p_date - 10
    order by d.student_id, d.workout_date desc
  ),
  a_dur as (
    select student_id, student_name,
      avg(decline_per_hour_pct) filter (where workout_date >= p_date - 30) as recent,
      avg(decline_per_hour_pct) filter (where workout_date between p_date - 120 and p_date - 31) as prior,
      count(*) filter (where workout_date >= p_date - 30) as n_recent,
      count(*) filter (where workout_date between p_date - 120 and p_date - 31) as n_prior
    from physio_durability_samples
    where is_valid and decline_per_hour_pct between -15 and 40
    group by 1,2
  ),
  a_gap as (
    select a.student_id, a.student_name, (p_date - max(w.workout_date)) as days_since
    from active a
    left join trainingpeaks_workout_cache w
      on w.student_id = a.student_id and w.is_completed and w.workout_date <= p_date
    group by 1,2
    having max(w.workout_date) is not null and (p_date - max(w.workout_date)) between 10 and 60
  ),
  a_load as (
    select distinct on (l.student_id)
           l.student_id, l.student_name, l.acwr, l.acwr_uncoupled,
           l.monotony, l.strain, l.ctl, l.atl, l.tsb, l.metric_date, h.history_days
    from physio_load_daily l
    join history h on h.student_id = l.student_id
    where l.metric_date between p_date - 3 and p_date and h.history_days >= 42
    order by l.student_id, l.metric_date desc
  ),
  a_race as (
    select re.student_id, s.student_name, min(re.event_date) as race_date,
           (select round(avg(readiness_score)) from physio_readiness_daily r
             where r.student_id = re.student_id and r.metric_date between p_date - 9 and p_date) as score7
    from trainingpeaks_race_events re
    join active s on s.student_id = re.student_id
    where re.event_date between p_date and p_date + 14
    group by 1,2
  ),
  a_comp as (
    select w.student_id, w.student_name, round(avg(w.compliance_duration_percent)) as comp, count(*) as n_planned
    from trainingpeaks_workout_cache w
    where w.is_planned and w.workout_date between p_date - 14 and p_date - 1
      and w.compliance_duration_percent is not null
    group by 1,2
    having count(*) >= 5 and avg(w.compliance_duration_percent) < 60
  ),
  built as (
    select h.student_id, h.student_name, 'hrv_suppressed' as code,
           (case when h.red_days >= 3 then 3 else 2 end) as severity,
           ('HRV ниже коридора ' || h.red_days || ' дн. из ' || h.have_days) as title,
           'Тренд ln(RMSSD) за 7 дней ушёл ниже базы минус SWC. Разумно снять интенсивность до возврата в коридор.' as detail,
           jsonb_build_object('red_days', h.red_days, 'worst_readiness', h.worst_score) as payload
    from a_hrv h
    union all
    select d.student_id, d.student_name, 'decoupling_high',
           case when d.ef_decline_pct > 15 then 3 else 2 end,
           'Декаплинг ' || round(d.ef_decline_pct,1) || '% на длинной ' || d.minutes || ' мин',
           'Эффективность просела между первой и последней четвертью работы сильнее нормы группы (медиана 5.3%, порог 10%). Причины: аэробная база, топливо, жара, темп выше плана.',
           jsonb_build_object('ef_decline_pct', d.ef_decline_pct, 'hr_drift_pct', d.hr_drift_pct,
                              'minutes', d.minutes, 'workout_date', d.workout_date)
    from a_dec d where d.ef_decline_pct > 10
    union all
    select u.student_id, u.student_name, 'durability_worsening', 2,
           'Durability ухудшилась: ' || round(u.prior,1) || '% → ' || round(u.recent,1) || '% в час',
           'Скорость деградации эффективности внутри длинных работ выросла относительно предыдущих трёх месяцев.',
           jsonb_build_object('recent', round(u.recent,2), 'prior', round(u.prior,2),
                              'n_recent', u.n_recent, 'n_prior', u.n_prior)
    from a_dur u where u.n_recent >= 4 and u.n_prior >= 8 and u.recent - u.prior > 4
    union all
    select g.student_id, g.student_name, 'training_gap',
           case when g.days_since >= 21 then 3 else 2 end,
           'Нет тренировок ' || g.days_since || ' дней',
           'Пауза в выполненных тренировках. Стоит проверить: травма, болезнь, отпуск или потеря контакта.',
           jsonb_build_object('days_since', g.days_since)
    from a_gap g
    union all
    select l.student_id, l.student_name, 'load_spike',
           case when l.acwr_uncoupled > 1.8 then 3 else 2 end,
           'Скачок нагрузки: ACWR ' || l.acwr_uncoupled,
           'Острая нагрузка выше хронической (несвязанный вариант ACWR — без математической зависимости окон, Impellizzeri 2020).',
           jsonb_build_object('acwr', l.acwr, 'acwr_uncoupled', l.acwr_uncoupled,
                              'ctl', l.ctl, 'atl', l.atl, 'tsb', l.tsb, 'history_days', l.history_days)
    from a_load l where l.acwr_uncoupled >= 1.5 and l.ctl >= 25
    union all
    select l.student_id, l.student_name, 'return_to_load', 1,
           'Возврат к нагрузке после паузы (ACWR ' || l.acwr_uncoupled || ')',
           'Хроническая база низкая, поэтому отношение нагрузок формально огромное. Это не перегруз, а вход обратно — но входить стоит осторожно.',
           jsonb_build_object('acwr_uncoupled', l.acwr_uncoupled, 'ctl', l.ctl)
    from a_load l where l.acwr_uncoupled >= 1.5 and l.ctl < 25
    union all
    select l.student_id, l.student_name, 'monotony_high', 2,
           'Монотонность ' || l.monotony,
           'Неделя однообразна по нагрузке: нет чередования тяжёлых и лёгких дней (Foster). Предвестник застоя.',
           jsonb_build_object('monotony', l.monotony, 'strain', l.strain)
    from a_load l where l.monotony > 2.0
    union all
    select r.student_id, r.student_name, 'race_readiness_low',
           case when r.score7 < 55 then 3 else 2 end,
           'Старт ' || to_char(r.race_date,'DD.MM') || ', готовность за неделю ' || r.score7,
           'До старта меньше двух недель, а средняя готовность ниже зелёной зоны.',
           jsonb_build_object('race_date', r.race_date, 'readiness_7d', r.score7)
    from a_race r where r.score7 is not null and r.score7 < 70
    union all
    select c.student_id, c.student_name, 'compliance_low', 2,
           'Выполнение плана ' || c.comp || '% за 2 недели',
           'Систематическое недовыполнение запланированного объёма.',
           jsonb_build_object('compliance_pct', c.comp, 'planned_workouts', c.n_planned)
    from a_comp c
  )
  insert into physio_alerts (student_id, student_name, alert_date, code, severity, title, detail, payload)
  select b.student_id, b.student_name, p_date, b.code, b.severity, b.title, b.detail, b.payload
  from built b join active a on a.student_id = b.student_id
  on conflict (student_id, alert_date, code) do update set
    severity = excluded.severity, title = excluded.title,
    detail = excluded.detail, payload = excluded.payload;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
