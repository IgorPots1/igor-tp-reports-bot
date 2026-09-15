-- Run Club импорт треков (ФАЗА 3): полилинии старых Strava-пробежек ложатся на СУЩЕСТВУЮЩИЕ
-- TP-записи (trainingpeaks_workout_tracks.workout_cache_id), схему не меняем. Единственное, что
-- нужно, — допустить source='strava' в чек-констрейнте (FIT-ингест пишет 'fit'). Идемпотентно;
-- DO-блок снимает старый source-чек по определению, не завися от авто-имени констрейнта.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.trainingpeaks_workout_tracks'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%(source %' loop
    execute format('alter table public.trainingpeaks_workout_tracks drop constraint %I', c);
  end loop;
end $$;
alter table public.trainingpeaks_workout_tracks add constraint trainingpeaks_workout_tracks_source_check
  check (source in ('fit', 'strava'));

notify pgrst, 'reload schema';
