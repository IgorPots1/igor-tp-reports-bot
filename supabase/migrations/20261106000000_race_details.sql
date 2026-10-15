-- Выжимка по стартам (наряд 15.10.2026): что организатор пишет о старте, по полям, с источником.
-- Одна строка = одно поле одной дистанции (distance null — для старта целиком). Значения коротко,
-- как у организатора; «нет данных» — искали и не нашли (source_url = где искали).
-- Это открытые данные организаторов: читать можно всем (как race_events), пишет только service_role
-- (скрипт сбора). Ключ — race_id без внешнего ключа: строки календаря склеиваются и переезжают.

create table if not exists public.race_details (
  id bigint generated always as identity primary key,
  race_id text not null,
  distance numeric,
  field text not null check (field in (
    'start_time', 'waves', 'start_place', 'finish_place', 'packet_pickup', 'cutoff',
    'aid_stations', 'baggage', 'changing_rooms', 'registration_status', 'next_price_increase', 'track'
  )),
  value text not null check (length(value) <= 400),
  source_url text,
  checked_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- одно значение поля на дистанцию; null-дистанция тоже уникальна (поле старта целиком)
  constraint race_details_one_value unique nulls not distinct (race_id, distance, field)
);

create index if not exists race_details_race_id_idx on public.race_details (race_id);

comment on table public.race_details is 'Выжимка по стартам из источников организатора: поле, значение, источник, дата проверки (наряд 15.10.2026).';

alter table public.race_details enable row level security;

create policy race_details_public_read on public.race_details
  for select to anon, authenticated using (true);

grant select on table public.race_details to anon, authenticated;
grant select, insert, update, delete on table public.race_details to service_role;
