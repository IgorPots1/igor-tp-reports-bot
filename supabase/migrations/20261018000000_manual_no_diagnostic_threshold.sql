-- Порог diagnostic невозможен у ручного источника — на уровне базы, не только кода.
--
-- ── ПОЧЕМУ КОНСТРЕЙНТ, А НЕ ТОЛЬКО ПРОВЕРКА В СКРИПТЕ ────────────────────────
--
-- Написать проверку в intervals-set-threshold.ts легко, но это ОДИН путь
-- записи. Ошибка руками через SQL-редактор, будущий скрипт, который забудет
-- про manual, — ни один из них констрейнт не пропустит.
--
-- diagnostic означает ИЗМЕРЕНИЕ: средний темп за последние двадцать минут
-- теста, посчитанный по посекундным рядам, с детектором ровности, который эти
-- ряды проверил. У auth_method='manual' рядов нет и не будет НИКОГДА — даже
-- если человек честно провёл протокол теста, число дошло только её словами.
-- Разрешённый источник для такого порога — только coach_manual.
--
-- auth_method и threshold_source — колонки ОДНОЙ таблицы (порог живёт у
-- источника, см. 20261014000000_intervals_threshold_home.sql), поэтому это
-- обычный CHECK, без триггера.
alter table public.student_data_sources
  drop constraint if exists student_data_sources_manual_no_diagnostic_check;

alter table public.student_data_sources
  add constraint student_data_sources_manual_no_diagnostic_check
  check (not (auth_method = 'manual' and threshold_source = 'diagnostic'));
