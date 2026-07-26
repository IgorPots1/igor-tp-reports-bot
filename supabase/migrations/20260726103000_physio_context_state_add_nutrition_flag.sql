-- Пересоздаём цепочку зависимых вьюх, чтобы добавить признак «ведёт питание»
drop view if exists physio_coach_radar;
drop view if exists physio_athlete_overview;
drop view if exists physio_student_context_state;

create view physio_student_context_state as
select
  s.id as student_id,
  s.student_name,
  exists (
    select 1 from trainingpeaks_student_operational_signals os
    where os.student_id = s.id and os.resolved_at is null
      and os.lifecycle_state = 'active_problem'
      and os.created_at >= now() - interval '45 days'
  ) as has_active_health_problem,
  exists (
    select 1 from trainingpeaks_student_operational_signals os
    where os.student_id = s.id and os.resolved_at is null
      and os.signal_type in ('pause_training','schedule_unavailability_window')
      and os.created_at >= now() - interval '45 days'
  ) as has_pause_or_unavailable,
  exists (
    select 1 from trainingpeaks_student_operational_signals os
    where os.student_id = s.id and os.resolved_at is null
      and os.lifecycle_state = 'monitoring_after_return'
      and os.created_at >= now() - interval '45 days'
  ) as returning_after_issue,
  exists (
    select 1 from trainingpeaks_student_memory_items m
    where m.student_id = s.id and m.is_active
      and m.memory_type in ('health_status','pain_or_injury')
      and (m.valid_until is null or m.valid_until::date >= current_date)
      and m.last_seen_at >= now() - interval '60 days'
  ) as has_recent_health_note,
  exists (
    select 1 from nutrition_student_profiles np where np.student_id = s.id and np.enabled
  ) as tracks_nutrition,
  (select count(*) from physio_student_context_items c where c.student_id = s.id) as context_items
from trainingpeaks_students s
where s.is_active and not coalesce(s.is_service_account,false) and s.archived_at is null;

create view physio_coach_radar as
with last_day as (select max(alert_date) as d from physio_alerts where status = 'open'),
ctx as (
  select student_id,
         jsonb_agg(jsonb_build_object(
           'kind', kind, 'type', raw_type, 'text', text,
           'when', observed_at::date, 'source', source
         ) order by observed_at desc) filter (where rn <= 8) as items,
         count(*) as total
  from (
    select c.*, row_number() over (partition by student_id order by observed_at desc) rn
    from physio_student_context_items c
  ) q group by student_id
),
enriched as (
  select
    a.student_id, a.student_name, a.alert_date, a.code, a.severity,
    a.title, a.detail, a.payload,
    g.plain_name, g.term, g.what_it_means, g.what_to_do, g.sort_order,
    case
      when a.code in ('training_gap','compliance_low')
        then (s.has_active_health_problem or s.has_pause_or_unavailable)
      when a.code in ('hrv_suppressed','decoupling_high','durability_worsening','race_readiness_low')
        then s.has_active_health_problem
      when a.code = 'return_to_load'
        then (s.has_active_health_problem or s.has_pause_or_unavailable or s.returning_after_issue)
      else false
    end as explained
  from physio_alerts a
  cross join last_day ld
  left join physio_glossary g on g.code = a.code and g.kind = 'alert'
  left join physio_student_context_state s on s.student_id = a.student_id
  where a.status = 'open' and a.alert_date = ld.d
)
select
  e.student_id, e.student_name, e.alert_date,
  max(e.severity) as max_severity,
  count(*)::int as alerts,
  bool_and(coalesce(e.explained,false)) as fully_explained,
  bool_or(coalesce(e.explained,false)) as partly_explained,
  jsonb_agg(jsonb_build_object(
    'code', e.code, 'severity', e.severity,
    'title', coalesce(e.plain_name, e.title), 'headline', e.title,
    'term', e.term, 'means', e.what_it_means, 'todo', e.what_to_do,
    'explained', coalesce(e.explained,false), 'payload', e.payload
  ) order by coalesce(e.explained,false), e.severity desc, e.sort_order) as alerts_json,
  coalesce(c.items, '[]'::jsonb) as context_json,
  coalesce(c.total, 0)::int as context_items,
  st.has_active_health_problem, st.has_pause_or_unavailable, st.returning_after_issue,
  st.tracks_nutrition,
  r.readiness_score, r.readiness_state, r.hrv_state, r.rhr_delta, r.sleep_debt_3d,
  l.ctl, l.atl, l.tsb, l.acwr_uncoupled, l.monotony,
  p.cs_pace_sec_per_km, p.d_prime_m, p.vdot, p.durability_index, p.durability_grade, p.quality,
  dh.verdict as data_verdict
from enriched e
left join ctx c on c.student_id = e.student_id
left join physio_student_context_state st on st.student_id = e.student_id
left join physio_data_health dh on dh.student_id = e.student_id
left join lateral (
  select * from physio_readiness_daily r2
  where r2.student_id = e.student_id and r2.metric_date <= e.alert_date
  order by r2.metric_date desc limit 1) r on true
left join lateral (
  select * from physio_load_daily l2
  where l2.student_id = e.student_id and l2.metric_date <= e.alert_date
  order by l2.metric_date desc limit 1) l on true
left join physio_profiles p on p.student_id = e.student_id and p.is_current
group by e.student_id, e.student_name, e.alert_date, c.items, c.total,
         st.has_active_health_problem, st.has_pause_or_unavailable, st.returning_after_issue,
         st.tracks_nutrition,
         r.readiness_score, r.readiness_state, r.hrv_state, r.rhr_delta, r.sleep_debt_3d,
         l.ctl, l.atl, l.tsb, l.acwr_uncoupled, l.monotony,
         p.cs_pace_sec_per_km, p.d_prime_m, p.vdot, p.durability_index, p.durability_grade, p.quality,
         dh.verdict;

create view physio_athlete_overview as
select
  s.id as student_id, s.student_name, s.is_active, s.sex,
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
  cs.has_active_health_problem, cs.has_pause_or_unavailable, cs.returning_after_issue,
  cs.tracks_nutrition,
  dh.verdict as data_verdict, dh.hrv_days_30, dh.sleep_days_30, dh.rhr_days_30,
  dh.last_health_date, dh.runs_30,
  coalesce(ci.items, '[]'::jsonb) as context_json,
  (select count(*) from physio_alerts al
    where al.student_id = s.id and al.status='open'
      and al.alert_date = (select max(alert_date) from physio_alerts where status='open')) as open_alerts
from trainingpeaks_students s
left join physio_profiles p on p.student_id = s.id and p.is_current
left join physio_student_context_state cs on cs.student_id = s.id
left join physio_data_health dh on dh.student_id = s.id
left join lateral (select * from physio_readiness_daily r2 where r2.student_id = s.id
                   order by r2.metric_date desc limit 1) r on true
left join lateral (select * from physio_load_daily l2 where l2.student_id = s.id
                   order by l2.metric_date desc limit 1) l on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
           'kind', z.kind, 'type', z.raw_type, 'text', z.text,
           'when', z.observed_at::date, 'source', z.source) order by z.observed_at desc) as items
  from (select * from physio_student_context_items ci2
        where ci2.student_id = s.id order by ci2.observed_at desc limit 14) z
) ci on true
where s.is_active and not coalesce(s.is_service_account,false) and s.archived_at is null;
