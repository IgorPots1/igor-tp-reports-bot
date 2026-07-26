-- Права доступа к движку физиологии.
--
-- 1) Витринам при создании права не выдаются автоматически — service_role не мог
--    их читать, из-за чего страница админки падала с серверной ошибкой.
-- 2) Функции по умолчанию доступны PUBLIC, то есть и anon-ключу. Для
--    physio_refresh_all это означало возможность запускать 40-секундный
--    пересчёт с публичного ключа. Закрываем.
--
-- Итог: читает и запускает только service_role, то есть код на сервере.

do $$
declare r record;
begin
  -- Чтение витрин и таблиц движка
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'physio%'
      and c.relkind in ('r','v')
  loop
    execute format('grant select on public.%I to service_role', r.relname);
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;

  -- Запуск функций движка
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'physio%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- Запись в словарь формулировок — тоже только с сервера
grant insert, update, delete on public.physio_glossary to service_role;

notify pgrst, 'reload schema';
