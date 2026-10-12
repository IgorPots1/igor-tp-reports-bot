-- Пресеты под новый ряд лестницы [наряд Игоря, 12.10.2026].
--
-- ЗАЧЕМ. 12.10.2026 ряд ступеней задан явным индексом: 6 x 5 → 5 x 6 → 5 x 7 →
-- 4 x 8 → 4 x 10. Лестница стала ЧИТАТЬ положение ученицы верно, но СОБРАТЬ
-- новые форматы генератор не мог: в каталоге их не было, и каждый шаг вверх
-- требовал ручной правки (5 x 6 на неделе 12.10 именно так и поставлена).
-- Без этих строк лестница просит то, чего нельзя собрать.
--
-- ВОССТАНОВЛЕНИЕ 1:30 У ВСЕХ, КРОМЕ 4 x 10: там 2:00 [решение Игоря].
-- Десятиминутный отрезок на её уровне требует чуть больше отдыха. Это НЕ
-- значение по умолчанию и не описка: ровно на этом заведён отдельный чек.
--
-- Разминка и заминка берутся из тех же ссылок, что у прежних int_walk: для
-- сегмента без часов настоящая раскладка (5 ходьба, 10 лёгкий, 3 перед
-- работой, 3 спокойный, заминка 5) строится в treadmill-shape.ts, а ссылки
-- каталога участвуют только в учёте длительности.
--
-- Аддитивно: четыре новые строки пресетов и четыре строки параметров,
-- on conflict do update — повторный прогон ничего не ломает.
with src as (
  select variant_id, warmup_ref_id, cooldown_ref_id, source, tier, athlete_level_min,
         coach_only, coach_review_required, requires_explicit_vo2_intensity, enabled_by_default
    from public.workout_template_presets
   where preset_code = 'int_walk_6x5'
),
rows_in as (
  select * from (values
    ('int_walk_5x6',  '5 x 6 мин через 1:30 шагом',  5,  6, 1.5, 30, 8),
    ('int_walk_5x7',  '5 x 7 мин через 1:30 шагом',  5,  7, 1.5, 35, 9),
    ('int_walk_4x8',  '4 x 8 мин через 1:30 шагом',  4,  8, 1.5, 32, 10),
    ('int_walk_4x10', '4 x 10 мин через 2:00 шагом', 4, 10, 2.0, 40, 11)
  ) as t(preset_code, display_name_ru, reps, work_min, recovery_min, work_total, sort_order)
),
ins as (
  insert into public.workout_template_presets (
    variant_id, preset_code, source, tier, enabled_by_default, coach_only,
    coach_review_required, requires_explicit_vo2_intensity, athlete_level_min,
    display_name_ru, warmup_ref_id, cooldown_ref_id, is_enabled, sort_order
  )
  select s.variant_id, r.preset_code, s.source, s.tier, s.enabled_by_default, s.coach_only,
         s.coach_review_required, s.requires_explicit_vo2_intensity, s.athlete_level_min,
         r.display_name_ru, s.warmup_ref_id, s.cooldown_ref_id, true, r.sort_order
    from rows_in r cross join src s
  on conflict (preset_code) do update
    set display_name_ru = excluded.display_name_ru,
        is_enabled = true,
        sort_order = excluded.sort_order,
        updated_at = now()
  returning id, preset_code
)
insert into public.workout_template_preset_parameters (
  preset_id, reps, work_duration_min, work_unit,
  recovery_duration_min, recovery_unit, recovery_type,
  total_quality_volume_min, rpe_target, rpe_cap, avoid_acidosis,
  target_mode, pace_hr_hint_mode, nutrition_required, extra_params
)
select ins.id, r.reps, r.work_min, 'min',
       r.recovery_min, 'min', 'walk',
       r.work_total, 6, 7, true,
       'rpe', 'advisory_wide_band_only', false, '{}'::jsonb
  from ins join rows_in r on r.preset_code = ins.preset_code;
