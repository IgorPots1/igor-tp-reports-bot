-- Закрыть данные календаря от публичного ключа (наряд 20.10.2026). ПРИМЕНЯТЬ ТОЛЬКО ВМЕСТЕ С
-- ВЫКАТКОЙ feature/races-protect: до неё сайт читает race_calendar и race_details публичным
-- ключом (src/app/races/load.ts), и /races, страницы стартов и выжимка в мини-приложении упадут.
--
-- Было открыто anon и authenticated (select, а ещё references, trigger, truncate):
--   race_calendar (представление, security_invoker), race_details, race_events,
--   race_overrides, race_sync_runs; execute — race_geo_point (security definer),
--   race_calendar_row (через PUBLIC).
-- После: только service_role (сервер сайта, бот, edge-функция race-calendar-sync, раннеры).
--
-- Ничего не оставлено открытым: публичному ключу в race_* нужно ноль объектов. Сайт, бот и
-- мини-приложение читают на сервере ключом сервисной роли; браузер в Supabase не ходит.
-- Политики *_public_read не удаляются (удаление — отдельное «да»): без гранта они ничего не дают.

do $$
declare
  r record;
begin
  -- Все таблицы и представления race_*, включая уже закрытые: у них могли остаться
  -- references/trigger/truncate. Префикс строгий: trainingpeaks_race_events не задевается.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'race\_%' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;
end;
$$;

revoke execute on function public.race_geo_point(text, text) from public, anon, authenticated;
revoke execute on function public.race_calendar_row(public.race_events) from public, anon, authenticated;
grant execute on function public.race_geo_point(text, text) to service_role;
grant execute on function public.race_calendar_row(public.race_events) to service_role;
