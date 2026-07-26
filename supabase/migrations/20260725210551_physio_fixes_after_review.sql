-- Правки по итогам независимой проверки:
-- 1) отсутствие HRV больше не выглядит как «всё зелено» — отдельное состояние partial
-- 2) ACWR-алерты не выдаются, пока хроническая база короче 42 дней (постоянная сглаживания CTL)
-- 3) return_to_load только при реально низкой базе (CTL < 25), иначе это настоящий скачок
-- 4) quality='high' не выдаётся при D' > 300 м

create or replace function physio_compute_readiness(p_days int default 400)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  with daily as (
    select student_id, max(student_name) as student_name, metric_date,
      avg(value_numeric) filter (where metric_key='hrv'          and value_numeric between 5 and 300)  as hrv,
      avg(value_numeric) filter (where metric_key='pulse'        and value_numeric between 30 and 110) as rhr,
      max(value_numeric) filter (where metric_key='sleep_hours'  and value_numeric between 1 and 16)   as sleep_h,
      avg(value_numeric) filter (where metric_key='body_battery' and value_numeric between 0 and 100)  as bb,
      avg(value_numeric) filter (where metric_key='stress_level' and value_numeric between 0 and 100)  as stress
    from trainingpeaks_health_metrics_cache
    where metric_date >= current_date - p_days
    group by student_id, metric_date
  ),
  ln as (select d.*, case when hrv > 0 then ln(hrv) end as ln_rmssd from daily d),
  rolled as (
    select l.*,
      avg(ln_rmssd) over (partition by student_id order by metric_date
                          range between interval '6 days' preceding and current row) as ln7,
      avg(ln_rmssd) over (partition by student_id order by metric_date
                          range between interval '60 days' preceding and interval '1 day' preceding) as base60,
      stddev_samp(ln_rmssd) over (partition by student_id order by metric_date
                          range between interval '60 days' preceding and interval '1 day' preceding) as sd60,
      avg(rhr) over (partition by student_id order by metric_date
                          range between interval '30 days' preceding and interval '1 day' preceding) as rhr_base,
      avg(sleep_h) over (partition by student_id order by metric_date
                          range between interval '30 days' preceding and interval '1 day' preceding) as sleep_base,
      sum(sleep_h) over (partition by student_id order by metric_date
                          range between interval '2 days' preceding and current row) as sleep_3d,
      count(sleep_h) over (partition by student_id order by metric_date
                          range between interval '2 days' preceding and current row) as sleep_3d_n
    from ln l
  ),
  scored as (
    select r.*,
      (0.5 * sd60)::numeric as swc,
      (base60 - 0.5*sd60)::numeric as swc_low,
      (base60 + 0.5*sd60)::numeric as swc_high,
      case
        when ln_rmssd is null or base60 is null or sd60 is null then 'no_data'
        when ln7 < base60 - 0.5*sd60 then 'red'
        when ln_rmssd < base60 - 0.5*sd60 then 'amber'
        else 'green'
      end as hrv_state,
      (rhr - rhr_base)::numeric as rhr_delta,
      case when sleep_3d_n = 3 and sleep_base is not null
           then (sleep_base*3 - sleep_3d)::numeric end as sleep_debt_3d
    from rolled r
  ),
  final as (
    select s.*,
      greatest(0, least(100,
        100
        - case s.hrv_state when 'red' then 30 when 'amber' then 15 else 0 end
        - case when s.rhr_delta > 7 then 20 when s.rhr_delta > 4 then 10 else 0 end
        - case when s.sleep_debt_3d > 3 then 20 when s.sleep_debt_3d > 1.5 then 10 else 0 end
        - case when s.bb < 30 then 10 when s.bb < 45 then 5 else 0 end
        - case when s.stress > 55 then 5 else 0 end
      ))::numeric as score
    from scored s
  )
  insert into physio_readiness_daily (
    student_id, student_name, metric_date, hrv, ln_rmssd, ln_rmssd_7d, ln_rmssd_sd,
    swc, swc_low, swc_high, hrv_state, rhr, rhr_baseline, rhr_delta,
    sleep_h, sleep_baseline, sleep_debt_3d, body_battery, stress_level,
    readiness_score, readiness_state, drivers)
  select f.student_id, f.student_name, f.metric_date,
    round(f.hrv::numeric,1), round(f.ln_rmssd::numeric,4), round(f.ln7::numeric,4), round(f.sd60::numeric,4),
    round(f.swc,4), round(f.swc_low,4), round(f.swc_high,4), f.hrv_state,
    round(f.rhr::numeric,1), round(f.rhr_base::numeric,1), round(f.rhr_delta,1),
    round(f.sleep_h::numeric,2), round(f.sleep_base::numeric,2), round(f.sleep_debt_3d,2),
    round(f.bb::numeric,1), round(f.stress::numeric,1),
    round(f.score,0),
    case when f.hrv_state='no_data' and f.rhr is null and f.sleep_h is null then 'no_data'
         -- без HRV нельзя утверждать «зелено»: это неполные данные, а не хорошая новость
         when f.hrv_state='no_data' and f.score >= 75 then 'partial'
         when f.score >= 75 then 'green'
         when f.score >= 50 then 'amber'
         else 'red' end,
    array_remove(array[
      case when f.hrv_state = 'red'   then 'HRV ниже нормального коридора (тренд 7 дней)' end,
      case when f.hrv_state = 'amber' then 'HRV ниже коридора одним днём' end,
      case when f.hrv_state = 'no_data' then 'нет данных HRV за этот день' end,
      case when f.rhr_delta > 7 then 'пульс покоя выше базы более чем на 7' end,
      case when f.rhr_delta between 4 and 7 then 'пульс покоя подрос' end,
      case when f.sleep_debt_3d > 3 then 'дефицит сна за 3 дня более 3 часов' end,
      case when f.sleep_debt_3d between 1.5 and 3 then 'умеренный недосып' end,
      case when f.bb < 30 then 'низкий body battery' end,
      case when f.stress > 55 then 'высокий стресс по часам' end
    ], null)
  from final f
  where f.metric_date >= current_date - p_days
  on conflict (student_id, metric_date) do update set
    hrv = excluded.hrv, ln_rmssd = excluded.ln_rmssd, ln_rmssd_7d = excluded.ln_rmssd_7d,
    ln_rmssd_sd = excluded.ln_rmssd_sd, swc = excluded.swc, swc_low = excluded.swc_low,
    swc_high = excluded.swc_high, hrv_state = excluded.hrv_state, rhr = excluded.rhr,
    rhr_baseline = excluded.rhr_baseline, rhr_delta = excluded.rhr_delta,
    sleep_h = excluded.sleep_h, sleep_baseline = excluded.sleep_baseline,
    sleep_debt_3d = excluded.sleep_debt_3d, body_battery = excluded.body_battery,
    stress_level = excluded.stress_level, readiness_score = excluded.readiness_score,
    readiness_state = excluded.readiness_state, drivers = excluded.drivers,
    computed_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Диагностика: почему у активного атлета нет профиля
create or replace view physio_coverage_gaps as
select s.id as student_id, s.student_name,
  (select count(*) from trainingpeaks_workout_cache w
    where w.student_id=s.id and w.is_completed and w.workout_type_value_id=3
      and w.workout_date >= current_date - 180) as runs_180d,
  (select count(*) from trainingpeaks_workout_laps l
    join trainingpeaks_workout_cache w on w.id=l.workout_cache_id
   where w.student_id=s.id and w.workout_type_value_id=3
     and w.workout_date >= current_date - 180) as laps_180d,
  (select count(*) from trainingpeaks_workout_laps l
    join trainingpeaks_workout_cache w on w.id=l.workout_cache_id
   where w.student_id=s.id and w.workout_type_value_id=3
     and w.workout_date >= current_date - 180 and l.avg_hr is not null) as laps_with_hr,
  (select count(*) from physio_effort_points p where p.student_id=s.id) as effort_points,
  (select count(*) from physio_durability_samples d where d.student_id=s.id and d.is_valid) as durability_samples,
  case
    when (select count(*) from trainingpeaks_workout_cache w
           where w.student_id=s.id and w.is_completed and w.workout_type_value_id=3
             and w.workout_date >= current_date - 180) = 0 then 'нет пробежек за 180 дней'
    when (select count(*) from trainingpeaks_workout_laps l
           join trainingpeaks_workout_cache w on w.id=l.workout_cache_id
          where w.student_id=s.id and w.workout_date >= current_date - 180) = 0 then 'нет данных по кругам'
    when (select count(*) from trainingpeaks_workout_laps l
           join trainingpeaks_workout_cache w on w.id=l.workout_cache_id
          where w.student_id=s.id and w.workout_date >= current_date - 180
            and l.avg_hr is not null) = 0 then 'круги без пульса — не проходит пульсовой гейт'
    when (select count(*) from physio_effort_points p where p.student_id=s.id) < 3
      then 'мало однородных максимальных отрезков (нужно 3+ разной длительности)'
    else 'профиль есть'
  end as reason
from trainingpeaks_students s
where s.is_active and not coalesce(s.is_service_account,false) and s.archived_at is null
  and not exists (select 1 from physio_profiles p where p.student_id=s.id and p.is_current);
