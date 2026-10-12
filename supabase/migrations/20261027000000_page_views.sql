-- Свой счётчик просмотров публичных страниц igorp.run (наряд 2026-10-12): /tools, /races, /camp,
-- /club, /start и главная. Пишет POST /api/pv, читает /admin/tools-stats — оба на сервере через
-- service role. Только аддитивное. RLS включён, политик нет: anon/authenticated не видят ничего.
--
-- Без персональных данных: visitor_id — случайный id из localStorage браузера, session_id —
-- из sessionStorage; ни IP, ни Telegram id, ни имён. country — двухбуквенный код из заголовка
-- Vercel x-vercel-ip-country, если он есть.

create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  path text not null,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  visitor_id text,
  session_id text,
  user_agent text,
  country text
);

comment on table public.page_views is
  'Просмотры публичных страниц igorp.run (свой счётчик). Пишет /api/pv, читает /admin/tools-stats; только service role.';

create index if not exists page_views_path_created_idx on public.page_views (path, created_at);
create index if not exists page_views_created_idx on public.page_views (created_at);

alter table public.page_views enable row level security;
revoke all on public.page_views from anon, authenticated;
grant select, insert on public.page_views to service_role;
