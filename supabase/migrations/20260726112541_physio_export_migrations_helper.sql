-- Отдаёт SQL применённых миграций physio_* наружу, чтобы выгрузить их в файлы
-- репозитория без установки Supabase CLI. Только для service_role.
create or replace function physio_export_migrations()
returns table (version text, name text, sql text)
language sql
stable
security definer
set search_path = public
as $$
  select m.version, m.name, array_to_string(m.statements, E'\n')
  from supabase_migrations.schema_migrations m
  where m.name like 'physio%'
  order by m.version;
$$;

revoke all on function physio_export_migrations() from public;
revoke all on function physio_export_migrations() from anon;
revoke all on function physio_export_migrations() from authenticated;
grant execute on function physio_export_migrations() to service_role;
