-- Telegram-бот «Забеги России» (@ruruns_bot), наряд 2026-10-12. Только аддитивное.
--
-- Бот работает без Мака: приём сообщений — webhook на Vercel (/api/races-bot/webhook),
-- плановые сообщения — pg_cron раз в час зовёт /api/races-bot/cron через pg_net.
-- Все таблицы — только service role: RLS включён, политик нет, anon/authenticated без прав.
-- Старты бот читает из view race_calendar (как сайт).

create table if not exists public.race_bot_users (
  tg_id bigint primary key,
  first_name text,
  username text,
  city text,
  types text[] not null default '{}',
  distances text[] not null default '{}',
  digest_on boolean not null default false,
  -- 1 — каждую неделю, 2 — раз в две недели («Реже»)
  digest_every_weeks integer not null default 1 check (digest_every_weeks in (1, 2)),
  digest_last_at timestamptz,
  paused_until timestamptz,
  tz text not null default 'Europe/Moscow',
  source text,
  -- что бот ждёт от человека следующим сообщением (например, название города)
  state text,
  consult_offered_at timestamptz,
  consult_requested_at timestamptz,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.race_bot_users is
  'Пользователи бота «Забеги России»: Telegram ID, имя, username, город и фильтры. Удаляются командой /delete.';

create table if not exists public.race_bot_follows (
  id bigint generated always as identity primary key,
  tg_id bigint not null references public.race_bot_users(tg_id) on delete cascade,
  race_id text not null,
  -- снимок на момент сохранения: нужен, чтобы сообщить об отмене, когда старта уже нет во view
  race_name text,
  race_date date,
  -- конец многодневного старта: view race_calendar держит только предстоящие, и «С финишем!»
  -- на следующий день строится по снимку
  race_end date,
  race_city text,
  created_at timestamptz not null default now(),
  unique (tg_id, race_id)
);

create index if not exists race_bot_follows_race_idx on public.race_bot_follows (race_id);

create table if not exists public.race_bot_sends (
  id bigint generated always as identity primary key,
  tg_id bigint not null,
  kind text not null,
  race_id text,
  sent_at timestamptz not null default now()
);

-- Защита от повторов: одно сообщение одного вида по одному старту одному человеку.
-- Дайджест (race_id null) повторяется по неделям — его уникальность держит digest_last_at.
create unique index if not exists race_bot_sends_once_idx
  on public.race_bot_sends (tg_id, kind, race_id) where race_id is not null;
create index if not exists race_bot_sends_tg_idx on public.race_bot_sends (tg_id, sent_at desc);

-- Служебные значения бота: chat_id тренера (узнаётся по его /start), ключ почасового тика.
create table if not exists public.race_bot_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.race_bot_users enable row level security;
alter table public.race_bot_follows enable row level security;
alter table public.race_bot_sends enable row level security;
alter table public.race_bot_config enable row level security;

revoke all on public.race_bot_users, public.race_bot_follows, public.race_bot_sends, public.race_bot_config
  from anon, authenticated;
grant select, insert, update, delete on public.race_bot_users, public.race_bot_follows, public.race_bot_sends
  to service_role;
grant select, insert, update on public.race_bot_config to service_role;

-- Почасовой тик: pg_net зовёт маршрут на Vercel с ключом из race_bot_config.
create or replace function public.race_bot_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare k text; rid bigint;
begin
  select value into k from public.race_bot_config where key = 'cron_key';
  if k is null then
    return null;
  end if;
  select net.http_post(
    url := 'https://igorp.run/api/races-bot/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', k),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000) into rid;
  return rid;
end $$;

revoke all on function public.race_bot_tick() from public, anon, authenticated;

-- Раз в час, на 3-й минуте. С тем же именем cron.schedule перезаписывает задачу: повторный прогон безопасен.
select cron.schedule('race-bot-hourly', '3 * * * *', $$select public.race_bot_tick()$$);
