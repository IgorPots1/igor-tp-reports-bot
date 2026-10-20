-- Защита /races от выкачивания (наряд 20.10.2026): счётчик частоты по IP и журнал отказов.
-- Только аддитивное: две таблицы и три функции. Читает и пишет только сервер (service_role):
-- middleware считает запросы, маршруты мини-приложения пишут отказы по initData, недельный
-- отчёт (scripts/races-protect-weekly.ts) читает журнал.

-- Окна счётчика: минутное и часовое. Строки живут два часа, их чистит сама race_guard_hit.
create table if not exists public.race_guard_hits (
  bucket text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (bucket, window_start)
);
comment on table public.race_guard_hits is
  'Счётчик запросов к /races и /api/races/* по IP (минута и час). Временные строки, живут 2 часа. Пишет только race_guard_hit.';

-- Журнал отказов: одна строка на (минута, вид, IP с маской, user-agent), n — сколько раз за минуту.
-- Так скрейпер на 200 запросов в минуту даёт одну строку, а не 140.
create table if not exists public.race_guard_log (
  minute timestamptz not null,
  kind text not null check (kind in ('rate_limit', 'no_init_data', 'bad_init_data', 'forbidden')),
  ip_masked text not null,
  ua text not null default '',
  path text not null default '',
  n integer not null default 1,
  primary key (minute, kind, ip_masked, ua)
);
comment on table public.race_guard_log is
  'Отказы защиты /races: 429 по частоте, запросы мини-приложения без initData или с плохой подписью. IP с маской последнего октета. Итог — в недельный отчёт.';

alter table public.race_guard_hits enable row level security;
alter table public.race_guard_log enable row level security;
revoke all on public.race_guard_hits, public.race_guard_log from anon, authenticated;
grant select, insert, update, delete on public.race_guard_hits, public.race_guard_log to service_role;

-- Один вызов на запрос: прибавить в оба окна и вернуть счётчики. Решение (пускать или 429)
-- принимает вызывающий: лимиты в коде, не в базе.
create or replace function public.race_guard_hit(p_bucket text)
returns table (n_min integer, n_hour integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  m timestamptz := date_trunc('minute', now());
  h timestamptz := date_trunc('hour', now());
begin
  insert into race_guard_hits as g (bucket, window_start, n) values (p_bucket || '|m', m, 1)
    on conflict (bucket, window_start) do update set n = g.n + 1
    returning g.n into n_min;
  insert into race_guard_hits as g (bucket, window_start, n) values (p_bucket || '|h', h, 1)
    on conflict (bucket, window_start) do update set n = g.n + 1
    returning g.n into n_hour;
  -- Уборка старых окон примерно раз на 200 вызовов: таблица не растёт.
  if random() < 0.005 then
    delete from race_guard_hits where window_start < now() - interval '2 hours';
  end if;
  return next;
end;
$$;

create or replace function public.race_guard_log_add(p_kind text, p_ip_masked text, p_ua text, p_path text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into race_guard_log as l (minute, kind, ip_masked, ua, path, n)
  values (date_trunc('minute', now()), p_kind, left(coalesce(p_ip_masked, ''), 64), left(coalesce(p_ua, ''), 300), left(coalesce(p_path, ''), 300), 1)
  on conflict (minute, kind, ip_masked, ua) do update set n = l.n + 1;
$$;

revoke execute on function public.race_guard_hit(text) from public, anon, authenticated;
revoke execute on function public.race_guard_log_add(text, text, text, text) from public, anon, authenticated;
grant execute on function public.race_guard_hit(text) to service_role;
grant execute on function public.race_guard_log_add(text, text, text, text) to service_role;
