-- Введённое и выведенное хранятся ОТДЕЛЬНО [наряд Игоря, 11.10.2026].
--
-- ЗАЧЕМ. Человек на дорожке вводит скорость с панели, дистанцию считаем мы.
-- Через месяц должно быть видно, что ввёл человек, а что посчитала программа:
-- иначе наш расчёт становится «фактом», и первый же спор о нём неразрешим.
-- Поводом стали 8610 метров за 56 минут — число, восстановить из которого
-- нечего, потому что непонятно, откуда оно взялось.
--
-- entered_speed_kmh         — что человек видел на панели (ровный бег) или
--                             скорость РАБОТЫ (интервальная).
-- entered_recovery_speed_kmh — скорость восстановления между отрезками.
-- distance_is_derived       — дистанцию посчитали мы, а не ввёл человек.
-- derived_note              — КАК посчитали, текстом. След для разбора.
-- suspect_reason            — запись вызывает сомнения (старые цифры, которые
--                             решено не пересчитывать, а только помечать).
--
-- Аддитивно: пять пустых колонок, ни одна не обязательна.
alter table public.intervals_activities
  add column if not exists entered_speed_kmh numeric,
  add column if not exists entered_recovery_speed_kmh numeric,
  add column if not exists distance_is_derived boolean not null default false,
  add column if not exists derived_note text,
  add column if not exists suspect_reason text;

comment on column public.intervals_activities.distance_is_derived is
  'true — дистанцию посчитали из скорости и времени, человек её не вводил.';
comment on column public.intervals_activities.suspect_reason is
  'Запись вызывает сомнения и НЕ пересчитывалась: восстанавливать нечего, только пометка.';
