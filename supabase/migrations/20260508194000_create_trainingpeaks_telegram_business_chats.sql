create table if not exists public.trainingpeaks_telegram_business_chats (
  id uuid primary key default gen_random_uuid(),
  business_connection_id text not null,
  chat_id text not null,
  username text,
  first_name text,
  last_name text,
  last_text text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_connection_id, chat_id)
);

create or replace function public.set_trainingpeaks_telegram_business_chats_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_trainingpeaks_telegram_business_chats_updated_at
on public.trainingpeaks_telegram_business_chats;

create trigger set_trainingpeaks_telegram_business_chats_updated_at
before update on public.trainingpeaks_telegram_business_chats
for each row
execute function public.set_trainingpeaks_telegram_business_chats_updated_at();

grant select, insert, update on table public.trainingpeaks_telegram_business_chats to service_role;

alter table public.trainingpeaks_telegram_business_chats enable row level security;
