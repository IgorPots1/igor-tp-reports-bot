-- billing_email_import_attempts — журнал ВХОДЯЩИХ вызовов импорта платежей.
--
-- НЕ ПРИМЕНЯЕТСЯ ЭТИМ НАРЯДОМ — только файл.
--
-- ЗАЧЕМ. Диагностика 13.08 упёрлась в тупик: за 11-12.08 записей о прогонах нет, и отличить
-- «вызов не пришёл» от «вызов пришёл и упал на проверке секрета» ОКАЗАЛОСЬ НЕЧЕМ. Маршрут
-- отдаёт 401/500 до создания строки прогона и не оставляет следа нигде — ни в БД, ни в логах,
-- которые кто-то читает. Обе версии остались догадками.
--
-- Строка пишется ПЕРВЫМ ДЕЙСТВИЕМ маршрута, до всего: до проверки секрета, до конфигурации,
-- до почты. Тогда «вызова не было» = строки нет, а «вызов упал на входе» = строка есть с
-- outcome, и различать больше не нужно гадать.
--
-- Таблица служебная и растёт на одну строку в сутки — чистка не нужна.

create table if not exists public.billing_email_import_attempts (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  -- unauthorized | misconfigured | started | failed | ok
  outcome text not null,
  -- версия деплоя, из которого пришёл вызов: видно, менялось ли что-то между удачными днями
  deployment_id text,
  -- кто дёрнул: vercel-cron или mac-failsafe
  caller text,
  http_status integer,
  note text,
  -- связь с прогоном, если до него дошло
  run_id uuid references public.billing_email_import_runs (id) on delete set null
);

comment on table public.billing_email_import_attempts is
  'Журнал входящих вызовов импорта платежей. Пишется ДО проверки секрета — чтобы «вызов не пришёл» и «вызов упал на входе» различались сразу, а не оставались догадками.';

create index if not exists billing_email_import_attempts_received_idx
  on public.billing_email_import_attempts (received_at desc);
