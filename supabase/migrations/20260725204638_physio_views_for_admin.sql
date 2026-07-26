-- Витрины для вкладки в админке и мини-аппа.
-- Читать через service_role (RLS на базовых таблицах закрыт наглухо).

create or replace view physio_coach_radar as
select
  a.student_id,
  a.student_name,
  a.alert_date,
  max(a.severity) as max_severity,
  count(*)::int as alerts,
  jsonb_agg(jsonb_build_object(
    'code', a.code, 'severity', a.severity, 'title', a.title,
    'detail', a.detail, 'payload', a.payload, 'status', a.status
  ) order by a.severity desc, a.code) as alerts_json,
  r.readiness_score, r.readiness_state, r.hrv_state, r.rhr_delta, r.sleep_debt_3d,
  l.ctl, l.atl, l.tsb, l.acwr_uncoupled, l.monotony,
  p.cs_pace_sec_per_km, p.d_prime_m, p.vdot, p.durability_index, p.durability_grade, p.quality
from physio_alerts a
left join lateral (
  select * from physio_readiness_daily r2
  where r2.student_id = a.student_id and r2.metric_date <= a.alert_date
  order by r2.metric_date desc limit 1) r on true
left join lateral (
  select * from physio_load_daily l2
  where l2.student_id = a.student_id and l2.metric_date <= a.alert_date
  order by l2.metric_date desc limit 1) l on true
left join physio_profiles p on p.student_id = a.student_id and p.is_current
where a.status = 'open'
group by a.student_id, a.student_name, a.alert_date,
         r.readiness_score, r.readiness_state, r.hrv_state, r.rhr_delta, r.sleep_debt_3d,
         l.ctl, l.atl, l.tsb, l.acwr_uncoupled, l.monotony,
         p.cs_pace_sec_per_km, p.d_prime_m, p.vdot, p.durability_index, p.durability_grade, p.quality;

create or replace view physio_athlete_overview as
select
  s.id as student_id,
  s.student_name,
  s.is_active,
  s.sex,
  p.cs_mps, p.cs_pace_sec_per_km, p.d_prime_m, p.model_r2, p.n_points, p.quality,
  p.quality_reasons, p.points, p.zones, p.predictions, p.vdot,
  p.lthr, p.max_hr, p.rest_hr, p.tp_threshold_pace_sec_per_km,
  p.durability_index, p.durability_grade, p.durability_samples,
  p.window_from, p.window_to, p.computed_at as profile_computed_at,
  r.metric_date as readiness_date, r.readiness_score, r.readiness_state,
  r.hrv, r.hrv_state, r.ln_rmssd_7d, r.swc_low, r.rhr, r.rhr_delta,
  r.sleep_h, r.sleep_debt_3d, r.drivers,
  l.metric_date as load_date, l.ctl, l.atl, l.tsb, l.acwr, l.acwr_uncoupled,
  l.monotony, l.strain,
  (select count(*) from physio_alerts al
    where al.student_id = s.id and al.alert_date = current_date and al.status='open') as open_alerts
from trainingpeaks_students s
left join physio_profiles p on p.student_id = s.id and p.is_current
left join lateral (select * from physio_readiness_daily r2 where r2.student_id = s.id
                   order by r2.metric_date desc limit 1) r on true
left join lateral (select * from physio_load_daily l2 where l2.student_id = s.id
                   order by l2.metric_date desc limit 1) l on true
where s.is_active and not coalesce(s.is_service_account,false) and s.archived_at is null;

-- Сводка по группе одним вызовом — для шапки вкладки
create or replace function physio_group_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'athletes', (select count(*) from physio_athlete_overview),
    'profiles_high', (select count(*) from physio_profiles where is_current and quality='high'),
    'profiles_total', (select count(*) from physio_profiles where is_current),
    'flagged_today', (select count(distinct student_id) from physio_alerts
                       where alert_date=current_date and status='open' and severity>=2),
    'urgent_today', (select count(distinct student_id) from physio_alerts
                       where alert_date=current_date and status='open' and severity=3),
    'durability', (select jsonb_object_agg(coalesce(durability_grade,'unknown'), n)
                   from (select durability_grade, count(*) n from physio_profiles
                         where is_current group by 1) q),
    'median_ef_decline_pct', (select round(percentile_cont(0.5) within group (order by ef_decline_pct)::numeric,2)
                              from physio_durability_samples where is_valid),
    'durability_samples', (select count(*) from physio_durability_samples where is_valid),
    'effort_points', (select count(*) from physio_effort_points),
    'last_run', (select jsonb_build_object('finished_at', finished_at, 'status', status, 'stats', stats)
                 from physio_engine_runs order by started_at desc limit 1)
  );
$$;
