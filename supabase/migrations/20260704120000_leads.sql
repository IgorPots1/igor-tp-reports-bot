create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  telegram text,
  source text not null default 'landing',
  user_agent text,
  status text not null default 'new'
);

alter table public.leads enable row level security;

-- Политик для anon/authenticated не создаём: пишем только service-role с сервера.
grant all on public.leads to service_role;
