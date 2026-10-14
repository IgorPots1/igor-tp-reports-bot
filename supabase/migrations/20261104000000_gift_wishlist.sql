-- Личный виш-лист жены Игоря (igorp.run/wish/<token>), без аккаунтов.
--
-- Доступ только по двум секретным ссылкам, токены живут ЗДЕСЬ, не в коде
-- (репозиторий публичный):
--   her_token — она добавляет, правит и удаляет хотелки;
--   his_token — он видит хотелки и тайно отмечает «Беру».
-- Отметки «Беру» лежат в отдельной таблице и в её ответ API не попадают
-- никогда: она получает только число выбранных и время последнего выбора.
--
-- RLS включён, политик нет: читают и пишут только серверные ручки
-- /api/wish/* через service role.

create table if not exists public.gift_wishlists (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Хочу в подарок',
  her_token text not null unique,
  his_token text not null unique,
  created_at timestamptz not null default now(),
  constraint gift_wishlists_tokens_differ check (her_token <> his_token),
  constraint gift_wishlists_token_len check (length(her_token) >= 24 and length(his_token) >= 24)
);

create table if not exists public.gift_wish_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.gift_wishlists(id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  url text,
  price text,
  note text,
  want smallint not null default 2 check (want between 1 and 3),
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_wish_items_list_idx on public.gift_wish_items(list_id);

create table if not exists public.gift_wish_claims (
  item_id uuid primary key references public.gift_wish_items(id) on delete cascade,
  list_id uuid not null references public.gift_wishlists(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index if not exists gift_wish_claims_list_idx on public.gift_wish_claims(list_id);

alter table public.gift_wishlists enable row level security;
alter table public.gift_wish_items enable row level security;
alter table public.gift_wish_claims enable row level security;

revoke all on public.gift_wishlists, public.gift_wish_items, public.gift_wish_claims from anon, authenticated;
grant all on public.gift_wishlists, public.gift_wish_items, public.gift_wish_claims to service_role;

-- Фото хотелок: приватный бакет, отдаются подписанными ссылками из API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gift-wish-photos', 'gift-wish-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
