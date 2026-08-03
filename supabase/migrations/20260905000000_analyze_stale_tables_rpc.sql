-- RPC для сторожа статистики планировщика. НЕ ПРИМЕНЕНА — применяет Игорь.
--
-- ЗАЧЕМ. 2026-08-03 статистика планировщика слетала ТРИЖДЫ за день (Fair Use restore,
-- восстановление, смена compute). Каждый раз это ловилось руками по симптомам: 500-е на
-- админке, statement timeout, CPU 100%. Планировщик после рестарта считает 48-мегабайтные
-- таблицы пустыми (n_live_tup = 11 при реальных 23 643), строит nested loop и всё встаёт.
-- Лечится одним ANALYZE, но узнать о беде было неоткуда.
--
-- ПОЧЕМУ RPC, А НЕ ЗАПРОС ИЗ СКРИПТА. Две причины, обе жёсткие:
--   1. PostgREST отдаёт только exposed-схемы; pg_stat_user_tables лежит в pg_catalog и через
--      supabase-js не читается вообще.
--   2. ANALYZE — служебная команда, supabase-js её выполнить не может, а pg-драйвера и psql
--      на раннерной машине нет (проверено 2026-08-03).
-- Поэтому и поиск, и прогон живут здесь, а скрипт только зовёт и логирует.
--
-- БЕЗОПАСНОСТЬ. Имя таблицы НЕ приходит извне — функция сама находит цели в pg_stat_user_tables
-- и подставляет их через format(%I). Инъекции нет по построению. Данные не читаются и не
-- меняются: ANALYZE только пересобирает статистику.

create or replace function public.analyze_stale_tables(max_tables integer default 50)
returns table (table_name text, size_bytes bigint, duration_ms integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rec record;
  started timestamptz;
begin
  -- Своё окно вместо унаследованного: у роли вызывающего statement_timeout может быть 8 с
  -- (дефолт authenticator), а ANALYZE по 116-мегабайтной таблице столько не укладывается.
  set local statement_timeout = '10min';

  for rec in
    select c.relname::text as rel,
           pg_table_size(s.relid) as bytes
    from pg_stat_user_tables s
    join pg_class c on c.oid = s.relid
    where s.schemaname = 'public'
      and s.last_analyze is null
      and s.last_autoanalyze is null
      -- ПУСТЫЕ ПРОПУСКАЕМ. ANALYZE по таблице в 0 байт не проставляет last_analyze,
      -- поэтому без этого условия сторож будет находить их снова и снова каждые сутки
      -- и никогда не сойдётся.
      and pg_table_size(s.relid) > 0
    order by pg_table_size(s.relid) desc
    limit greatest(max_tables, 0)
  loop
    started := clock_timestamp();
    execute format('analyze %I.%I', 'public', rec.rel);
    table_name := rec.rel;
    size_bytes := rec.bytes;
    duration_ms := (extract(epoch from (clock_timestamp() - started)) * 1000)::integer;
    return next;
  end loop;
end;
$$;

comment on function public.analyze_stale_tables(integer) is
  'Находит непроанализированные непустые таблицы public и прогоняет по ним ANALYZE поимённо. '
  'Возвращает что прогнал и сколько заняло. Сторож статистики, см. аварию 2026-08-03.';

revoke all on function public.analyze_stale_tables(integer) from public;
revoke all on function public.analyze_stale_tables(integer) from anon;
revoke all on function public.analyze_stale_tables(integer) from authenticated;
grant execute on function public.analyze_stale_tables(integer) to service_role;

-- Отдельно: только посмотреть, ничего не трогая. Нужна скрипту, чтобы отличить
-- «нашёл 0, всё хорошо» от «нашёл и прогнал» без побочных эффектов.
create or replace function public.count_stale_stat_tables()
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from pg_stat_user_tables s
  where s.schemaname = 'public'
    and s.last_analyze is null
    and s.last_autoanalyze is null
    and pg_table_size(s.relid) > 0;
$$;

comment on function public.count_stale_stat_tables() is
  'Сколько непустых таблиц public без статистики планировщика. Read-only.';

revoke all on function public.count_stale_stat_tables() from public;
revoke all on function public.count_stale_stat_tables() from anon;
revoke all on function public.count_stale_stat_tables() from authenticated;
grant execute on function public.count_stale_stat_tables() to service_role;
