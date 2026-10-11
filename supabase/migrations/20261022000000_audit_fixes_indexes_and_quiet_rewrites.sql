-- Наряд 2026-10-11 «исправления по аудиту инфраструктуры» (ops-log 2026-10-11-1803-infra-audit-runners-db).
--
-- Диагноз аудита: база не мала, а занята лишним. Каждый скан переписывал всё своё окно
-- (workout_cache — 273 тыс. UPDATE на 33 тыс. строк за 17 дней, laps — 543 тыс. DELETE и
-- 551 тыс. INSERT на 221 тыс. строк), updated_at сдвигался у неизменённых строк, и materialize
-- считал «затронутыми» всех 109 учеников. Его запрос `select student_id ... where updated_at > X
-- order by student_id offset ...` шёл seq scan'ом 0,6–8,4 с на shared-CPU при statement_timeout
-- 8 с и падал ~12 раз в день.
--
-- ПРИМЕНЕНО 2026-10-11 через execute_sql по одному оператору (индексы — CONCURRENTLY).
-- Drop дубля и новая replace_trainingpeaks_workout_laps вынесены в 20261023000000_*_pending.sql:
-- их применение отклонено в окне разрешения, решили идти без них.
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
