-- Где живёт порог у ученика Intervals.
--
-- ── ПОЧЕМУ ЗДЕСЬ, А НЕ В ЖУРНАЛЕ ПРИМЕНЕНИЙ ─────────────────────────────────
--
-- У ростера TrainingPeaks порог лежит в tp_threshold_applications — это ЖУРНАЛ
-- ПРИМЕНЕНИЙ: каждая строка означает «мы записали такое-то число в чужую
-- систему такого-то числа». История там нужна, потому что запись идёт наружу и
-- иногда её приходится откатывать.
--
-- У ученика Intervals наружу мы не пишем НИЧЕГО. Порог нужен только нам и
-- только в момент генерации плана. Поэтому он — свойство источника данных,
-- ровно как athlete id и токен: живёт столько же, удаляется вместе с ним,
-- попадает в архив удаления сам собой (снимок уже включает sources).
--
-- Если однажды понадобится история изменений, она добавится журналом РЯДОМ и
-- ничего здесь не сломает. Заводить журнал заранее, ради истории, которой ещё
-- нет, дороже, чем добавить его потом.
--
-- ── ОТКУДА БЕРЁТСЯ ЧИСЛО ────────────────────────────────────────────────────
--   diagnostic   — из диагностической тренировки (тест, следующий кусок работы)
--   race_result  — пересчётом из результата старта
--   coach_manual — тренер поставил руками, зная человека
-- Источник хранится рядом со значением, потому что доверие к темпам всей
-- работы цикла зависит именно от него, а не от самого числа.
alter table public.student_data_sources
  add column if not exists threshold_pace_sec_per_km numeric,
  add column if not exists threshold_source text,
  add column if not exists threshold_set_at timestamptz;

alter table public.student_data_sources
  drop constraint if exists student_data_sources_threshold_source_check;

alter table public.student_data_sources
  add constraint student_data_sources_threshold_source_check
  check (
    threshold_source is null
    or threshold_source in ('diagnostic', 'race_result', 'coach_manual')
  );

-- Значение без происхождения и без даты — это число неизвестного качества,
-- которым потом будут назначены темпы всех отрезков. Либо всё, либо ничего.
alter table public.student_data_sources
  drop constraint if exists student_data_sources_threshold_complete_check;

alter table public.student_data_sources
  add constraint student_data_sources_threshold_complete_check
  check (
    threshold_pace_sec_per_km is null
    or (threshold_source is not null and threshold_set_at is not null)
  );

-- Разумные границы: 2:00/км — быстрее мировых рекордов на длинные, 12:00/км —
-- медленнее быстрого шага. Всё за пределами — опечатка, а не человек.
alter table public.student_data_sources
  drop constraint if exists student_data_sources_threshold_range_check;

alter table public.student_data_sources
  add constraint student_data_sources_threshold_range_check
  check (
    threshold_pace_sec_per_km is null
    or (threshold_pace_sec_per_km >= 120 and threshold_pace_sec_per_km <= 720)
  );

comment on column public.student_data_sources.threshold_pace_sec_per_km is
  'Пороговый темп, секунд на километр. Пусто — порога нет, и качество назначается по усилию.';
comment on column public.student_data_sources.threshold_source is
  'diagnostic | race_result | coach_manual. От источника зависит доверие к темпам всей работы цикла.';
