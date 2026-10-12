-- Ожидаемые старты: откуда строка (наряд 12.10.2026). probeg — стадия expected edge-функции
-- race-calendar-sync; manual — шлюз scripts/races-manual.ts (регулярные старты без даты следующего
-- года, найденные агентом: ВК, сайты организаторов). Только добавление колонки с умолчанием.
alter table public.race_expected add column if not exists source text not null default 'probeg';
alter table public.race_expected drop constraint if exists race_expected_source_check;
alter table public.race_expected add constraint race_expected_source_check check (source in ('probeg', 'manual'));
comment on column public.race_expected.source is 'probeg — робот (стадия expected), manual — шлюз races-manual';
