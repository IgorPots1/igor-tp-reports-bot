-- Лента клуба: сортировка внутри дня по ФАКТИЧЕСКОМУ времени старта, а не по порядку вставки.
--
-- ФАКТ (проверено на данных): start_time — полный наивно-локальный ISO ("2026-08-04T07:47:23",
-- префикс = workout_date), null всего ~0.75% (146 из 19422 completed), суффиксов "Z" нет.
--
-- Генерируемая колонка feed_ts = start_time, либо ISO-дата workout_date, если времени нет. НЕПУСТАЯ,
-- лексикографически = хронологически; строки без времени падают в НИЗ своего дня ("2026-08-04" < любой
-- "2026-08-04T..."). Непустота держит keyset-пагинацию простой (два непустых поля feed_ts, id).
--
-- IMMUTABILITY (иначе 42P17): generated-колонке нужно IMMUTABLE-выражение. И workout_date::text, и
-- голый to_char() ядро помечает STABLE (зависят от DateStyle/lc_time для форматов с названиями месяцев
-- и т.п.). Но to_char(date,'YYYY-MM-DD') использует ТОЛЬКО числовые поля — результат детерминирован,
-- от локали не зависит. Заворачиваем в СОБСТВЕННУЮ функцию, честно помеченную IMMUTABLE: Postgres
-- доверяет объявленной волатильности функции и берёт её в generated-колонку. Это канонический фикс 42P17.
create or replace function public.club_feed_iso_date(d date)
  returns text
  language sql
  immutable
  strict
  parallel safe
  as $$ select to_char(d, 'YYYY-MM-DD') $$;

alter table public.trainingpeaks_workout_cache
  add column if not exists feed_ts text
  generated always as (coalesce(start_time, public.club_feed_iso_date(workout_date))) stored;

-- Индекс ровно под новый ORDER BY (feed_ts desc, id desc) и SQL-фильтр ленты (is_completed=true):
-- частичный, покрывает и порядок, и предикат — index scan вместо seq scan + sort.
create index if not exists club_cache_feed_ts_idx
  on public.trainingpeaks_workout_cache (feed_ts desc, id desc)
  where is_completed = true;

notify pgrst, 'reload schema';
