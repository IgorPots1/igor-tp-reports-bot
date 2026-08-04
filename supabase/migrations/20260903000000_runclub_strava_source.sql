-- Run Club импорт (strava_best_effort): расширить source-чеки и добавить ключ идемпотентности журнала.
-- Иерархия: coach_confirmed > official_protocol > race_events > strava_best_effort > реконструкция.
-- Идемпотентно; DO-блоки снимают старый source-чек по определению (не завися от авто-имени констрейнта).

-- 1) club_records.source += 'strava_best_effort'
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.club_records'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%(source %' loop
    execute format('alter table public.club_records drop constraint %I', c);
  end loop;
end $$;
alter table public.club_records add constraint club_records_source_check
  check (source in ('reconstructed', 'official_protocol', 'coach_confirmed', 'strava_best_effort'));

-- 2) club_official_results.source += 'strava_best_effort'
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.club_official_results'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%(source %' loop
    execute format('alter table public.club_official_results drop constraint %I', c);
  end loop;
end $$;
alter table public.club_official_results add constraint club_official_results_source_check
  check (source in ('official_protocol', 'coach_confirmed', 'strava_best_effort'));

-- 3) идемпотентность журнала для Strava (у неё нет protocol_url — текущего ключа дедупа):
--    свой ключ strava_best_effort_id (глобально уникальный id отрезка в Strava, строкой).
alter table public.club_official_results add column if not exists strava_best_effort_id text;
create unique index if not exists club_official_results_strava_be_id
  on public.club_official_results (student_id, strava_best_effort_id)
  where strava_best_effort_id is not null;

notify pgrst, 'reload schema';
