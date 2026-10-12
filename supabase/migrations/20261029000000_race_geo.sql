-- Координаты городов для «Рядом» в боте «Забеги России» (наряд 12.10.2026).
--
-- race_geo: кэш геокодера по нормализованному «город, регион» (core.ts geoKey). Заполняется ОДИН
-- раз для всех городов race_calendar и race_expected скриптом scripts/races-geo-fill.ts (Nominatim,
-- пауза ≥ 1 с, свой User-Agent); дальше — только новые города. Без запросов на каждый старт.
-- lat/lon null + source 'none' — город не узнан (в отчёт списком), повторно не спрашиваем, пока
-- не поправят руками (source 'manual').
--
-- race_bot_users.geo_lat/geo_lon: точка, присланная геолокацией, — «Рядом» считается от неё,
-- а не от центра города. Сбрасывается при выборе города кнопкой или текстом.

create table if not exists public.race_geo (
  key text primary key,
  city text not null,
  region text not null default '',
  lat double precision,
  lon double precision,
  source text not null check (source in ('nominatim', 'manual', 'none')),
  display_name text,
  note text,
  checked_at timestamptz not null default now()
);

alter table public.race_geo enable row level security;
revoke all on public.race_geo from public, anon, authenticated;
grant select, insert, update on public.race_geo to service_role;

comment on table public.race_geo is 'Координаты городов стартов для «Рядом» в боте (кэш геокодера по «город, регион»).';

alter table public.race_bot_users add column if not exists geo_lat double precision;
alter table public.race_bot_users add column if not exists geo_lon double precision;
