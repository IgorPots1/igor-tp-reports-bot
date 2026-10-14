-- «Убрать из каталога» на странице проверки черновиков (решение Игоря,
-- 14.10.2026): модель целиком получает статус excluded с причиной. В подбор не
-- попадает, счётчик пачки её не учитывает.
--
-- Только расширение: новое значение в check статуса и три новые колонки.
-- Существующие строки не переписываются. Список значений взят из живой базы
-- (pg_constraint), а не из файла прошлой миграции.

alter table public.shoe_coach_drafts drop constraint if exists shoe_coach_drafts_status_check;
alter table public.shoe_coach_drafts
  add constraint shoe_coach_drafts_status_check check (status in ('draft', 'confirmed', 'excluded'));

alter table public.shoe_coach_drafts add column if not exists excluded_reason text
  check (excluded_reason in ('outdated', 'not_running', 'duplicate'));
alter table public.shoe_coach_drafts add column if not exists excluded_by text;
alter table public.shoe_coach_drafts add column if not exists excluded_at timestamptz;

comment on column public.shoe_coach_drafts.excluded_reason is
  'Почему модель убрана из каталога: outdated — устарела, есть новая версия; not_running — не беговая; duplicate — дубль.';
