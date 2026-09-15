-- Индекс на student_id у трёх таблиц, где его не было с самого начала.
--
-- ЧЕМ ЭТО БЫЛО ПОЙМАНО. Удаление ученика Intervals (delete_intervals_student)
-- каскадом проверяет ссылочную целостность на trainingpeaks_workout_laps —
-- у ЖИВОГО ростера TrainingPeaks, не у самого удаляемого ученика Intervals.
-- Без индекса это Seq Scan по всей таблице на КАЖДОЕ удаление, независимо от
-- того, сколько у удаляемого человека своих данных. Замер (explain analyze,
-- 15.09.2026): 209 256 строк, 63 МБ, 5112 мс на пустой карточке.
--
-- ПРОВЕРЕНО, ЧТО ЕЩЁ ЗАДЕВАЛ ЭТОТ ЖЕ ПРОБЕЛ (16.09.2026). Прошёл кодовую базу:
-- у workout_laps все живые запросы идут по workout_cache_id или
-- trainingpeaks_athlete_id (оба уже индексированы) — там пробел трогал только
-- каскад. Но нашлось одно живое место, задетое напрямую:
--   src/features/club/track-maps.ts → purgeStudentRouteImages(studentId)
--   вызывается синхронно из /api/m/club/routes-visibility — когда ученица
--   выключает показ своих маршрутов в мини-приложении. Замер: 2646 мс на
--   пустом результате (6805 строк, 9,7 МБ). Реальный человек в реальный
--   момент ждал этот Seq Scan при каждом нажатии тумблера.
-- autoplanner_shadow_results — 215 мс на 1385 строках, живых потребителей по
-- student_id в src/ нет (только офлайн-скрипты), но тот же каскад его тоже
-- сканирует, поэтому чинится заодно.
--
-- ЗАМЕР ПОСЛЕ (той же командой explain analyze, все три indisvalid = true):
--   trainingpeaks_workout_laps:        5112 мс → 3,8 мс   (index only scan)
--   trainingpeaks_workout_tracks:      2646 мс → 2,4 мс   (index scan)
--   autoplanner_shadow_results:         215 мс → 3,1 мс   (index only scan)
--
-- CONCURRENTLY: не блокирует таблицу на запись, поэтому применено без окна.
-- Файл документирует то, что уже реально создано через Supabase-MCP
-- (см. IF NOT EXISTS — повторный прогон этого файла безопасен и ничего не
-- меняет, если индексы уже стоят).
create index concurrently if not exists trainingpeaks_workout_laps_student_id_idx
  on public.trainingpeaks_workout_laps (student_id);

create index concurrently if not exists trainingpeaks_workout_tracks_student_id_idx
  on public.trainingpeaks_workout_tracks (student_id);

create index concurrently if not exists autoplanner_shadow_results_student_id_idx
  on public.autoplanner_shadow_results (student_id);
