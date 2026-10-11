-- НЕ ПРИМЕНЕНО. Вынесено из 20261022000000_audit_fixes_indexes_and_quiet_rewrites.sql 11.10:
-- при применении оба шага отклонены в окне разрешения, Игорь выбрал «без них, дальше».
-- Применять отдельным шагом по отдельному слову. До этого:
--  - laps по-прежнему удаляются и вставляются заново на каждом прогоне fit-ingest, их updated_at
--    двигается, и materialize видит «затронутыми» учеников с FIT за последние 5 дней (сам запрос
--    уже быстрый — индекс по updated_at и RPC применены);
--  - дубль индекса (12 МБ) продолжает поддерживаться на каждой вставке.
-- Индекс удалять CONCURRENTLY, вне транзакции:
--   drop index concurrently if exists public.trainingpeaks_workout_laps_workout_cache_id_idx;

-- 4. Дубль: тот же набор колонок, что у unique-констрейнта trainingpeaks_workout_laps_unique
--    (workout_cache_id, source, lap_index). Планировщик просто перейдёт на unique-индекс,
--    а таблица перестанет поддерживать два одинаковых индекса на каждой вставке.
--    Подтверждено Игорем 11.10 отдельно. Остальные мелкие дубли и «неиспользуемые» —
--    НЕ трогаем (статистика всего за 17 дней, еженедельные/месячные задачи могли не успеть).
drop index if exists public.trainingpeaks_workout_laps_workout_cache_id_idx;

-- 8. Замена кругов не трогает строки, если пришло ровно то же самое. Раньше каждый прогон
--    fit-ingest (окно 5 дней, 48 раз в сутки) удалял и вставлял все круги заново, новые строки
--    получали свежий updated_at — и materialize видел «изменение» у всех.
--    Сравнение — мультимножеством по всем колонкам содержимого (без id, created_at, updated_at,
--    scanned_at, scan_job_id), с теми же coalesce, что и при вставке. Совпало — выходим, вернув
--    число строк, как вернула бы вставка. Иначе — прежнее поведение без изменений.
create or replace function public.replace_trainingpeaks_workout_laps(
  p_workout_cache_id uuid,
  p_source text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inserted integer;
  v_existing integer;
  v_changed boolean;
begin
  select count(*) into v_existing
    from public.trainingpeaks_workout_laps
   where workout_cache_id = p_workout_cache_id
     and source = p_source;

  if v_existing > 0 and v_existing = coalesce(jsonb_array_length(p_rows), 0) then
    select exists (
      select
        x.student_id, x.student_name, x.trainingpeaks_athlete_id, x.trainingpeaks_workout_id,
        x.workout_cache_id, x.lap_index, x.source, x.start_offset_s, x.timer_time_s,
        x.elapsed_time_s, x.distance_m, x.avg_speed_mps, x.max_speed_mps, x.pace_sec_per_km,
        x.avg_hr, x.max_hr, x.min_hr, x.avg_cadence, x.max_cadence, x.avg_power,
        x.total_ascent_m, x.total_descent_m, x.lap_trigger, x.intensity, x.wkt_step_index,
        x.is_work, x.planned_target,
        coalesce(x.source_snapshot, '{}'::jsonb),
        coalesce(x.normalization_warnings, '{}'::text[])
      from jsonb_to_recordset(p_rows) as x(
        student_id uuid, student_name text, trainingpeaks_athlete_id bigint,
        trainingpeaks_workout_id bigint, workout_cache_id uuid, lap_index integer, source text,
        start_offset_s numeric, timer_time_s numeric, elapsed_time_s numeric, distance_m numeric,
        avg_speed_mps numeric, max_speed_mps numeric, pace_sec_per_km numeric, avg_hr numeric,
        max_hr numeric, min_hr numeric, avg_cadence numeric, max_cadence numeric,
        avg_power numeric, total_ascent_m numeric, total_descent_m numeric, lap_trigger text,
        intensity text, wkt_step_index integer, is_work boolean, planned_target jsonb,
        source_snapshot jsonb, normalization_warnings text[], scanned_at timestamptz,
        scan_job_id uuid
      )
      except all
      select
        l.student_id, l.student_name, l.trainingpeaks_athlete_id, l.trainingpeaks_workout_id,
        l.workout_cache_id, l.lap_index, l.source, l.start_offset_s, l.timer_time_s,
        l.elapsed_time_s, l.distance_m, l.avg_speed_mps, l.max_speed_mps, l.pace_sec_per_km,
        l.avg_hr, l.max_hr, l.min_hr, l.avg_cadence, l.max_cadence, l.avg_power,
        l.total_ascent_m, l.total_descent_m, l.lap_trigger, l.intensity, l.wkt_step_index,
        l.is_work, l.planned_target, l.source_snapshot, l.normalization_warnings
      from public.trainingpeaks_workout_laps l
      where l.workout_cache_id = p_workout_cache_id
        and l.source = p_source
    ) into v_changed;

    if not v_changed then
      return v_existing;
    end if;
  end if;

  delete from public.trainingpeaks_workout_laps
   where workout_cache_id = p_workout_cache_id
     and source = p_source;

  insert into public.trainingpeaks_workout_laps (
    student_id,
    student_name,
    trainingpeaks_athlete_id,
    trainingpeaks_workout_id,
    workout_cache_id,
    lap_index,
    source,
    start_offset_s,
    timer_time_s,
    elapsed_time_s,
    distance_m,
    avg_speed_mps,
    max_speed_mps,
    pace_sec_per_km,
    avg_hr,
    max_hr,
    min_hr,
    avg_cadence,
    max_cadence,
    avg_power,
    total_ascent_m,
    total_descent_m,
    lap_trigger,
    intensity,
    wkt_step_index,
    is_work,
    planned_target,
    source_snapshot,
    normalization_warnings,
    scanned_at,
    scan_job_id
  )
  select
    x.student_id,
    x.student_name,
    x.trainingpeaks_athlete_id,
    x.trainingpeaks_workout_id,
    x.workout_cache_id,
    x.lap_index,
    x.source,
    x.start_offset_s,
    x.timer_time_s,
    x.elapsed_time_s,
    x.distance_m,
    x.avg_speed_mps,
    x.max_speed_mps,
    x.pace_sec_per_km,
    x.avg_hr,
    x.max_hr,
    x.min_hr,
    x.avg_cadence,
    x.max_cadence,
    x.avg_power,
    x.total_ascent_m,
    x.total_descent_m,
    x.lap_trigger,
    x.intensity,
    x.wkt_step_index,
    x.is_work,
    x.planned_target,
    coalesce(x.source_snapshot, '{}'::jsonb),
    coalesce(x.normalization_warnings, '{}'::text[]),
    coalesce(x.scanned_at, now()),
    x.scan_job_id
  from jsonb_to_recordset(p_rows) as x(
    student_id uuid,
    student_name text,
    trainingpeaks_athlete_id bigint,
    trainingpeaks_workout_id bigint,
    workout_cache_id uuid,
    lap_index integer,
    source text,
    start_offset_s numeric,
    timer_time_s numeric,
    elapsed_time_s numeric,
    distance_m numeric,
    avg_speed_mps numeric,
    max_speed_mps numeric,
    pace_sec_per_km numeric,
    avg_hr numeric,
    max_hr numeric,
    min_hr numeric,
    avg_cadence numeric,
    max_cadence numeric,
    avg_power numeric,
    total_ascent_m numeric,
    total_descent_m numeric,
    lap_trigger text,
    intensity text,
    wkt_step_index integer,
    is_work boolean,
    planned_target jsonb,
    source_snapshot jsonb,
    normalization_warnings text[],
    scanned_at timestamptz,
    scan_job_id uuid
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;
