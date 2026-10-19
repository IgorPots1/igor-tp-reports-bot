-- Личные страницы планов учеников (igorp.run/plan/<slug>/<token>), без аккаунтов.
--
-- Одна строка athlete_plans = один ученик. Доступ по двум секретным ссылкам,
-- токены живут ЗДЕСЬ, не в коде (репозиторий публичный):
--   athlete_token — ученик видит план и шлёт отчёты со скриншотами;
--   coach_token   — тренер видит то же и отвечает на отчёты.
-- slug только для читаемости ссылки (имя ученика), доступ даёт токен.
-- План целиком лежит в plan (jsonb, недели и тренировки), его пишет тренер
-- (через Claude по SQL); страница его только читает.
--
-- RLS включён, политик нет: читают и пишут только серверные ручки
-- /api/plan/* через service role.

create table if not exists public.athlete_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  athlete_name text not null,
  telegram_chat_id text,
  athlete_token text not null unique,
  coach_token text not null unique,
  plan jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_plans_tokens_differ check (athlete_token <> coach_token),
  constraint athlete_plans_token_len check (length(athlete_token) >= 24 and length(coach_token) >= 24)
);

create table if not exists public.athlete_plan_reports (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.athlete_plans(id) on delete cascade,
  session_id text not null check (length(session_id) between 1 and 60),
  status text not null check (status in ('done','partial','skipped')),
  rpe smallint check (rpe between 1 and 10),
  feel text,
  fields jsonb not null default '{}'::jsonb,
  comment text,
  file_paths text[] not null default '{}',
  coach_reply text,
  coach_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, session_id)
);
create index if not exists athlete_plan_reports_plan_idx on public.athlete_plan_reports(plan_id);

alter table public.athlete_plans enable row level security;
alter table public.athlete_plan_reports enable row level security;

revoke all on public.athlete_plans, public.athlete_plan_reports from anon, authenticated;
grant all on public.athlete_plans, public.athlete_plan_reports to service_role;

-- Скриншоты с часов: приватный бакет, отдаются подписанными ссылками из API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('athlete-plan-files', 'athlete-plan-files', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
