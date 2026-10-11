-- Наряд 2026-10-11 «исправления по аудиту инфраструктуры» (ops-log 2026-10-11-1803-infra-audit-runners-db).
--
-- Диагноз аудита: база не мала, а занята лишним. Каждый скан переписывал всё своё окно
-- (workout_cache — 273 тыс. UPDATE на 33 тыс. строк за 17 дней, laps — 543 тыс. DELETE и
-- 551 тыс. INSERT на 221 тыс. строк), updated_at сдвигался у неизменённых строк, и materialize
-- считал «затронутыми» всех 109 учеников. Его запрос `select student_id ... where updated_at > X
-- order by student_id offset ...` шёл seq scan'ом 0,6–8,4 с на shared-CPU при statement_timeout
-- 8 с и падал ~12 раз в день.
--
-- Индексы — без CONCURRENTLY: файл миграции исполняется в транзакции, а таблицы маленькие
-- (laps 66 МБ) — блокировка записи на секунды. При ручном применении можно CONCURRENTLY.

-- 1. updated_at — под list_students_touched_since (ниже).
create index if not exists trainingpeaks_workout_laps_updated_at_idx
  on public.trainingpeaks_workout_laps (updated_at);
create index if not exists trainingpeaks_workout_cache_updated_at_idx
  on public.trainingpeaks_workout_cache (updated_at);

-- 2. Наблюдённый максимум пульса атлета (repository.ts getTrainingPeaksAthleteObservedMaxHr):
--    fit-ingest зовёт его на каждого ученика в каждом прогоне (~29 тыс. в сутки), было 97–370 мс.
create index if not exists trainingpeaks_workout_laps_athlete_max_hr_idx
  on public.trainingpeaks_workout_laps (trainingpeaks_athlete_id, max_hr desc)
  where max_hr is not null;

-- 3. Дедуп входящего бизнес-сообщения в вебхуке Telegram (chat_id + message_id), а также
--    правка и пометка удалённого: все три шли seq scan'ом, ~355 мс на каждое сообщение.
create index if not exists trainingpeaks_telegram_context_observations_chat_message_idx
  on public.trainingpeaks_telegram_context_observations (chat_id, message_id);

-- 4. Дубль: тот же набор колонок, что у unique-констрейнта trainingpeaks_workout_laps_unique
--    (workout_cache_id, source, lap_index). Планировщик просто перейдёт на unique-индекс,
--    а таблица перестанет поддерживать два одинаковых индекса на каждой вставке.
--    Подтверждено Игорем 11.10 отдельно. Остальные мелкие дубли и «неиспользуемые» —
--    НЕ трогаем (статистика всего за 17 дней, еженедельные/месячные задачи могли не успеть).
drop index if exists public.trainingpeaks_workout_laps_workout_cache_id_idx;

-- 5. Журнал входящих вызовов крона billing-email-import был пуст за всё время: у service_role
--    не было INSERT (только TRUNCATE/REFERENCES/TRIGGER), а logAttempt глотает ошибку молча.
grant insert on public.billing_email_import_attempts to service_role;

-- 6. Набор «затронутых с момента X» одним запросом вместо постраничного OFFSET по student_id
--    через PostgREST (src/features/club/service.ts loadStudentsTouchedSince).
create or replace function public.list_students_touched_since(p_since timestamptz)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select student_id from public.trainingpeaks_workout_cache
   where updated_at > p_since and student_id is not null
  union
  select student_id from public.trainingpeaks_workout_laps
   where updated_at > p_since and student_id is not null
$$;

revoke all on function public.list_students_touched_since(timestamptz) from public, anon, authenticated;
grant execute on function public.list_students_touched_since(timestamptz) to service_role;

-- 7. updated_at у кэша двигается только при реальном изменении содержимого.
--    scanned_at и scan_job_id по-прежнему пишутся при каждом скане: на scanned_at держится
--    reconcile плановых строк (удаляет плановые, которые прогон НЕ обновил), трогать его нельзя.
--    updated_at теперь значит «содержимое менялось», scanned_at — «строку видели».
create or replace function public.set_trainingpeaks_workout_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - array['updated_at', 'scanned_at', 'scan_job_id'])
     = (to_jsonb(old) - array['updated_at', 'scanned_at', 'scan_job_id']) then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

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
