-- bd_uploads.code: короткая ссылка igorp.run/bd/<code> на разбор Strava (src/app/bd/[code]).
-- 6 случайных a-z0-9, генерирует scripts/bd-upload.py при загрузке. Случайный, а не из ника:
-- по нику чужой разбор не угадать. NULL допустим — у строк status='error' кода нет.
alter table public.bd_uploads add column if not exists code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.bd_uploads'::regclass and conname = 'bd_uploads_code_key') then
    alter table public.bd_uploads add constraint bd_uploads_code_key unique (code);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bd_uploads'::regclass and conname = 'bd_uploads_code_format') then
    alter table public.bd_uploads add constraint bd_uploads_code_format check (code ~ '^[a-z0-9]{6}$');
  end if;
end $$;

comment on column public.bd_uploads.code is
  'Код короткой ссылки igorp.run/bd/<code>: 6 случайных a-z0-9, ставит scripts/bd-upload.py.';
