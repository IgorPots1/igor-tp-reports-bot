-- Ожидаемые старты (наряд 2026-10-12): забеги России, прошедшие за последний год на probeg.org,
-- у которых ещё нет даты следующего проведения в календаре. Только аддитивное, только service role.
--
-- Пересчёт раз в неделю — стадия ?stage=expected edge-функции race-calendar-sync (понедельничный
-- сбор). Когда в календаре появляется следующее проведение (у робота или вручную) — status =
-- announced и race_id. Сайт /races показывает status = expected блоком «Ожидаются»; бот шлёт
-- подписавшимся «Объявили дату».

create table if not exists public.race_expected (
  id text primary key,                 -- probeg:<id прошлого проведения>
  name text not null,
  name_key text not null,              -- название без года, номеров и служебных слов
  city text,
  region text,
  race_type text,
  distances text[] not null default '{}',
  last_date date not null,             -- дата прошлого проведения
  last_month integer not null check (last_month between 1 and 12),
  last_url text not null,              -- ссылка на прошлогоднее событие
  site_url text,
  last_finishers integer,
  status text not null default 'expected' check (status in ('expected', 'announced', 'dropped')),
  race_id text,                        -- следующее проведение в календаре, когда announced
  announced_at timestamptz,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.race_expected is
  'Ожидаемые старты: прошлогодние без даты следующего проведения. Пересчёт: race-calendar-sync ?stage=expected.';

create index if not exists race_expected_status_month_idx on public.race_expected (status, last_month);

-- «Сообщить, когда объявят дату» в боте «Забеги России».
create table if not exists public.race_bot_expected_watch (
  id bigint generated always as identity primary key,
  tg_id bigint not null references public.race_bot_users(tg_id) on delete cascade,
  expected_id text not null references public.race_expected(id) on delete cascade,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (tg_id, expected_id)
);

alter table public.race_expected enable row level security;
alter table public.race_bot_expected_watch enable row level security;
revoke all on public.race_expected, public.race_bot_expected_watch from anon, authenticated;
grant select, insert, update on public.race_expected to service_role;
grant select, insert, update, delete on public.race_bot_expected_watch to service_role;

-- Понедельничный пересчёт после сбора и склейки (merge в 22:31 по UTC в воскресенье).
select cron.schedule('race-calendar-expected', '45 22 * * 0', $$select public.race_calendar_run_stage('expected')$$);
