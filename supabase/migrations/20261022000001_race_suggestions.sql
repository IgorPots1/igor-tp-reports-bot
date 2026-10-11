-- Наряд 2026-10-11 «форма "Добавить старт" на /races». Только аддитивное.
--
-- Посетитель /races предлагает старт, которого нет в календаре. Еженедельный раннер
-- (scripts/races-manual.ts, команда suggestions) разбирает status = 'new': открывает
-- ссылку, проверяет по правилам ручных стартов и добавляет через шлюз или ставит
-- duplicate / rejected с причиной.
--
-- ДОСТУП СТРОЖЕ, ЧЕМ В НАРЯДЕ («anon только insert»). Ключ anon публичный: с правом
-- insert любой писал бы прямо в PostgREST, мимо honeypot и лимита 5 в час по IP. Поэтому
-- anon не получает ничего, вставку делает только серверный маршрут сайта
-- /api/races/suggest ключом service role, и он же держит honeypot и лимит.
--
-- ip_hash: для лимита по IP хранится не адрес, а sha256 от адреса с солью сервера.

create table if not exists public.race_suggestions (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  name text,
  city text,
  date_text text,
  contact text,
  is_organizer boolean not null default false,
  ip_hash text,
  created_at timestamptz not null default now(),
  status text not null default 'new',
  race_id text references public.race_events(id) on delete set null,
  note text,
  reviewed_at timestamptz,
  constraint race_suggestions_status_check check (status = any (array['new', 'added', 'duplicate', 'rejected'])),
  constraint race_suggestions_url_check check (url ~* '^https?://' and length(url) <= 500)
);

create index if not exists race_suggestions_status_created_idx on public.race_suggestions (status, created_at);
create index if not exists race_suggestions_ip_created_idx on public.race_suggestions (ip_hash, created_at);

comment on table public.race_suggestions is
  'Старты, предложенные посетителями /races. Пишет /api/races/suggest (service role), разбирает '
  'еженедельный раннер races-weekly через scripts/races-manual.ts. anon доступа не имеет.';

alter table public.race_suggestions enable row level security;

grant select, insert, update on public.race_suggestions to service_role;
revoke all on public.race_suggestions from anon, authenticated;
