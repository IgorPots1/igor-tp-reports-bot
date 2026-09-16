-- Ручной ввод тренировки: ученики без подключаемых часов (наряд 16.09.2026).
--
-- ── ПОЧЕМУ РАСШИРЯЕМ СУЩЕСТВУЮЩИЕ КОЛОНКИ, А НЕ ЗАВОДИМ НОВУЮ ТАБЛИЦУ ────────
--
-- Ручная тренировка обязана вести себя как обычная: закрывать плановую сессию,
-- двигать прогрессию по чек-ину, попадать в стартовую точку при генерации
-- плана. Вся эта механика уже читает intervals_activities и intervals_checkins
-- по source_id и дате — заводить для ручного ввода отдельные таблицы значило
-- бы продублировать её целиком, и она разошлась бы на первой же правке.
--
-- ── auth_method = 'manual' ───────────────────────────────────────────────────
--
-- Источник без подключения к Intervals.icu вообще — ученица вводит тренировки
-- сама, credential и external_athlete_id остаются служебными заглушками
-- (см. src/features/intervals/manual-entry.ts). is_active = true: это не
-- сломанное подключение, а осознанно выбранный способ вести тренировки, и
-- раннер синхронизации его не трогает по kind, а не по is_active.
alter table public.student_data_sources
  drop constraint if exists student_data_sources_auth_method_check;

alter table public.student_data_sources
  add constraint student_data_sources_auth_method_check
  check (auth_method in ('api_key', 'oauth', 'manual'));

comment on column public.student_data_sources.auth_method is
  'api_key — личный ключ ученика. oauth — вход через Intervals.icu. manual — часов нет вообще, ученица вводит тренировки сама; credential и external_athlete_id остаются заглушками.';

-- ── data_level = 'manual' ─────────────────────────────────────────────────────
--
-- ТРЕТЬЕ ЗНАЧЕНИЕ, А НЕ ПЕРЕИСПОЛЬЗОВАНИЕ 'none'. 'none' означает «мы ничего
-- не знаем о тренировке» (силовая без записи, чужой импорт без рядов). Ручной
-- ввод — противоположный случай: время и дистанция ИЗВЕСТНЫ со слов человека,
-- просто без посекундных рядов. Генератор обязан пользоваться числами (объём,
-- частота, средний темп) и НЕ рассуждать об интенсивности ВНУТРИ тренировки —
-- ровно так же, как он уже не рассуждает об интенсивности без пульса. Один и
-- тот же принцип, третье значение делает его видимым в данных, а не спрятанным
-- в комментарии к коду.
alter table public.intervals_activities
  drop constraint if exists intervals_activities_data_level_check;

alter table public.intervals_activities
  add constraint intervals_activities_data_level_check
  check (data_level in ('heartrate', 'pace_only', 'none', 'manual'));

comment on column public.intervals_activities.data_level is
  'Что реально есть в рядах: heartrate — пульс (и темп); pace_only — только темп/скорость; none — ни того, ни другого, рядов нет и природа тренировки неизвестна; manual — введено человеком со слов, рядов нет НИКОГДА, числа (время/дистанция/средний пульс/средний темп) достоверны как средние, но генератор не рассуждает по ним об интенсивности внутри тренировки.';
