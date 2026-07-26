-- Радар внимания тренера. Всё, что здесь появляется — только сигнал для ревью.
-- Никаких автоматических действий с атлетом.
create or replace function physio_generate_alerts(p_date date default current_date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  delete from physio_alerts where alert_date = p_date and status = 'open';

  with active as (
    select id as student_id, student_name from trainingpeaks_students
    where is_active and not coalesce(is_service_account,false) and archived_at is null
  ),

  -- 1. HRV ниже коридора несколько дней подряд
  a_hrv as (
    select r.student_id, r.student_name,
           count(*) filter (where r.hrv_state='red') as red_days,
           max(r.readiness_score) as best_score
    from physio_readiness_daily r
    where r.metric_date between p_date - 2 and p_date
    group by 1,2
    having count(*) filter (where r.hrv_state='red') >= 2
  ),

  -- 2. Высокий декаплинг на последней длинной работе
  a_dec as (
    select distinct on (d.student_id) d.student_id, d.student_name, d.workout_date,
           d.ef_decline_pct, d.hr_drift_pct, round(d.duration_s/60) as minutes
    from physio_durability_samples d
    where d.is_valid and d.duration_s >= 3600 and d.workout_date >= p_date - 10
    order by d.student_id, d.workout_date desc
  ),

  -- 3. Durability ухудшилась: последние 30 дней против предыдущих 90
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

  -- 4. Пропал: нет выполненных тренировок
  a_gap as (
    select a.student_id, a.student_name,
           (p_date - max(w.workout_date)) as days_since
    from active a
    left join trainingpeaks_workout_cache w
      on w.student_id = a.student_id and w.is_completed and w.workout_date <= p_date
    group by 1,2
    having max(w.workout_date) is null or (p_date - max(w.workout_date)) >= 7
  ),

  -- 5. Скачок нагрузки и монотонность
  a_load as (
    select l.student_id, l.student_name, l.acwr, l.acwr_uncoupled, l.monotony, l.strain,
           l.ctl, l.atl, l.tsb
    from physio_load_daily l
    where l.metric_date = p_date - 1
  ),

  -- 6. Старт на горизонте при просевшей готовности
  a_race as (
    select re.student_id, s.student_name, min(re.event_date) as race_date,
           (select round(avg(readiness_score)) from physio_readiness_daily r
             where r.student_id = re.student_id and r.metric_date between p_date - 6 and p_date) as score7
    from trainingpeaks_race_events re
    join active s on s.student_id = re.student_id
    where re.event_date between p_date and p_date + 14
    group by 1,2
  ),

  -- 7. Провал по выполнению плана
  a_comp as (
    select w.student_id, w.student_name,
           round(avg(w.compliance_duration_percent)) as comp,
           count(*) as n_planned
    from trainingpeaks_workout_cache w
    where w.is_planned and w.workout_date between p_date - 14 and p_date - 1
      and w.compliance_duration_percent is not null
    group by 1,2
    having count(*) >= 4 and avg(w.compliance_duration_percent) < 65
  ),

  built as (
    select student_id, student_name, code, severity, title, detail, payload from (
      select h.student_id, h.student_name, 'hrv_suppressed' as code,
             case when h.red_days >= 3 then 3 else 2 end as severity,
             'HRV ниже нормального коридора ' || h.red_days || ' дн. из 3' as title,
             'Тренд ln(RMSSD) за 7 дней ушёл ниже базы минус SWC. Разумно снять интенсивность до возврата в коридор.' as detail,
             jsonb_build_object('red_days', h.red_days, 'best_readiness', h.best_score) as payload
      from a_hrv h

      union all
      select d.student_id, d.student_name, 'decoupling_high',
             case when d.ef_decline_pct > 12 then 3 else 2 end,
             'Декаплинг ' || round(d.ef_decline_pct,1) || '% на длинной ' || d.minutes || ' мин',
             'Эффективность просела между первой и последней четвертью работы сильнее нормы (порог 8%). Причины: аэробная база, топливо, жара, темп выше плана.',
             jsonb_build_object('ef_decline_pct', d.ef_decline_pct, 'hr_drift_pct', d.hr_drift_pct,
                                'minutes', d.minutes, 'workout_date', d.workout_date)
      from a_dec d where d.ef_decline_pct > 8

      union all
      select u.student_id, u.student_name, 'durability_worsening', 2,
             'Durability ухудшилась: ' || round(u.prior,1) || '% → ' || round(u.recent,1) || '% в час',
             'Скорость деградации эффективности внутри длинных работ выросла относительно предыдущих трёх месяцев.',
             jsonb_build_object('recent', round(u.recent,2), 'prior', round(u.prior,2),
                                'n_recent', u.n_recent, 'n_prior', u.n_prior)
      from a_dur u
      where u.n_recent >= 3 and u.n_prior >= 5 and u.recent - u.prior > 3

      union all
      select g.student_id, g.student_name, 'training_gap',
             case when g.days_since >= 14 then 3 else 2 end,
             coalesce('Нет тренировок ' || g.days_since || ' дней', 'Нет ни одной выполненной тренировки'),
             'Пауза в выполненных тренировках. Стоит проверить: травма, болезнь, отпуск или потеря контакта.',
             jsonb_build_object('days_since', g.days_since)
      from a_gap g

      union all
      select l.student_id, l.student_name, 'load_spike',
             case when l.acwr_uncoupled > 1.8 then 3 else 2 end,
             'Скачок нагрузки: ACWR ' || l.acwr_uncoupled,
             'Острая нагрузка заметно выше хронической (несвязанный вариант ACWR, без математической зависимости окон).',
             jsonb_build_object('acwr', l.acwr, 'acwr_uncoupled', l.acwr_uncoupled,
                                'ctl', l.ctl, 'atl', l.atl, 'tsb', l.tsb)
      from a_load l where l.acwr_uncoupled > 1.5

      union all
      select l.student_id, l.student_name, 'monotony_high', 2,
             'Монотонность ' || l.monotony || ' при strain ' || l.strain,
             'Неделя однообразна по нагрузке: нет чередования тяжёлых и лёгких дней (Foster). Классический предвестник застоя.',
             jsonb_build_object('monotony', l.monotony, 'strain', l.strain)
      from a_load l where l.monotony > 2.0

      union all
      select r.student_id, r.student_name, 'race_readiness_low',
             case when r.score7 < 55 then 3 else 2 end,
             'Старт ' || to_char(r.race_date,'DD.MM') || ', готовность за неделю ' || r.score7,
             'До старта меньше двух недель, а средняя готовность за неделю ниже зелёной зоны.',
             jsonb_build_object('race_date', r.race_date, 'readiness_7d', r.score7)
      from a_race r where r.score7 is not null and r.score7 < 70

      union all
      select c.student_id, c.student_name, 'compliance_low', 2,
             'Выполнение плана ' || c.comp || '% за 2 недели',
             'Систематическое недовыполнение запланированного объёма.',
             jsonb_build_object('compliance_pct', c.comp, 'planned_workouts', c.n_planned)
      from a_comp c
    ) q
  )
  insert into physio_alerts (student_id, student_name, alert_date, code, severity, title, detail, payload)
  select b.student_id, b.student_name, p_date, b.code, b.severity, b.title, b.detail, b.payload
  from built b
  join active a on a.student_id = b.student_id
  on conflict (student_id, alert_date, code) do update set
    severity = excluded.severity, title = excluded.title,
    detail = excluded.detail, payload = excluded.payload;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Оркестратор: один вызов пересчитывает всё
create or replace function physio_refresh_all(p_window_days int default 180, p_days int default 400)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid; v_stats jsonb := '{}'::jsonb; v_n int;
begin
  insert into physio_engine_runs (stage, status) values ('start','running') returning id into v_run;

  update physio_engine_runs set stage='load' where id=v_run;
  v_n := physio_compute_load(p_days);        v_stats := v_stats || jsonb_build_object('load_days', v_n);

  update physio_engine_runs set stage='readiness' where id=v_run;
  v_n := physio_compute_readiness(p_days);   v_stats := v_stats || jsonb_build_object('readiness_days', v_n);

  update physio_engine_runs set stage='durability' where id=v_run;
  v_n := physio_compute_durability(p_days);  v_stats := v_stats || jsonb_build_object('durability_samples', v_n);

  update physio_engine_runs set stage='effort_points' where id=v_run;
  v_n := physio_build_effort_points(p_window_days); v_stats := v_stats || jsonb_build_object('effort_points', v_n);

  update physio_engine_runs set stage='profiles' where id=v_run;
  v_n := physio_fit_profiles(p_window_days); v_stats := v_stats || jsonb_build_object('profiles', v_n);

  update physio_engine_runs set stage='alerts' where id=v_run;
  v_n := physio_generate_alerts(current_date); v_stats := v_stats || jsonb_build_object('alerts', v_n);

  update physio_engine_runs
     set finished_at = now(), status='ok', stage='done', stats = v_stats
   where id = v_run;

  return v_stats;
exception when others then
  update physio_engine_runs set finished_at=now(), status='error', error=sqlerrm where id=v_run;
  raise;
end $$;
