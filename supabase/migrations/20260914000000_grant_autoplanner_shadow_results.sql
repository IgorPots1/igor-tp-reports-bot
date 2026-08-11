-- autoplanner_shadow_results: выдать права service_role.
--
-- НЕ ПРИМЕНЯЕТСЯ этим нарядом — только файл.
--
-- ЗАЧЕМ. Миграция 20260901000000 создала таблицу и включила RLS без единой политики (это верно:
-- service_role обходит RLS). Но GRANT на саму таблицу не выдан, а без него обход RLS не помогает:
-- запись падает на «permission denied for table autoplanner_shadow_results».
-- Факт на 13.08: у service_role только REFERENCES, TRIGGER, TRUNCATE — ни SELECT, ни INSERT.
-- Для сравнения, у tp_zone_snapshots права есть у postgres и service_role.
--
-- Политик для anon/authenticated по-прежнему НЕТ и быть не должно: таблица аналитическая,
-- содержит поатлетные срезы и наружу не смотрит.

grant select, insert, update, delete on table public.autoplanner_shadow_results to service_role;
