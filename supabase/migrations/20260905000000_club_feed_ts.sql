-- Лента клуба: сортировка внутри дня по ФАКТИЧЕСКОМУ времени старта, а не по порядку вставки.
--
-- ФАКТ (проверено на данных): start_time — полный наивно-локальный ISO ("2026-08-04T07:47:23",
-- префикс = workout_date), null всего ~0.75% (146 из 19422 completed), суффиксов "Z" нет.
--
-- Генерируемая колонка feed_ts = start_time, либо ISO-дата workout_date, если времени нет. НЕПУСТАЯ,
-- лексикографически = хронологически; строки без времени падают в НИЗ своего дня ("2026-08-04" < любой
-- "2026-08-04T..."). Непустота держит keyset-пагинацию простой (два непустых поля feed_ts, id).
--
-- ВАЖНО про immutability: workout_date::text и to_char() НЕ immutable (зависят от DateStyle/lc_time),
-- а generated-колонке нужно IMMUTABLE-выражение (иначе 42P17). Поэтому ISO-дату собираем из
-- extract(year/month/day) — date_part(text, date) IMMUTABLE, как и ::int/::text/lpad/||/coalesce.
alter table public.trainingpeaks_workout_cache
  add column if not exists feed_ts text
  generated always as (
    coalesce(
      start_time,
      lpad(extract(year  from workout_date)::int::text, 4, '0') || '-' ||
      lpad(extract(month from workout_date)::int::text, 2, '0') || '-' ||
      lpad(extract(day   from workout_date)::int::text, 2, '0')
    )
  ) stored;

-- Индекс ровно под новый ORDER BY (feed_ts desc, id desc) и SQL-фильтр ленты (is_completed=true):
-- частичный, покрывает и порядок, и предикат — index scan вместо seq scan + sort.
create index if not exists club_cache_feed_ts_idx
  on public.trainingpeaks_workout_cache (feed_ts desc, id desc)
  where is_completed = true;

notify pgrst, 'reload schema';
