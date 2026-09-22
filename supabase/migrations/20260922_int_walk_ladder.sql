-- Продолжение лестницы коротких форматов через шаг [22.09.2026].
--
-- ЗАЧЕМ. 20.09 завели три ступени: 3x3, 4x3, 5x3 через минуту шагом. Их хватало
-- на вход, но выше не было НИЧЕГО: самая длинная — 15 минут работы. Тренер уже
-- даёт Валентине 7 x 4 через полторы минуты шага, то есть 28 минут, и генератор
-- на следующую неделю предлагал 5 x 3 — шаг назад почти вдвое.
--
-- ПОЧЕМУ ПОЛТОРЫ МИНУТЫ, А НЕ МИНУТА. На коротких отрезках (3 мин) минуты хватает,
-- на четырёх- и пятиминутных — нет: это ровно тот интервал, который тренер пишет
-- рукой в своей карточке. Число из практики, а не из арифметики.
--
-- ПОРЯДОК СТУПЕНЕЙ. Сначала растёт ЧИСЛО отрезков при четырёх минутах (6, 7, 8),
-- потом удлиняется сам отрезок (6 x 5). Суммарная работа при этом один раз
-- проседает (8x4 = 32, 6x5 = 30) — и это нормально: пять минут подряд тяжелее
-- четырёх, и платить за длину отрезка сокращением объёма правильно.

with v as (select id from workout_template_variants where variant_code = 'controlled_threshold'),
refs as (
  select (select warmup_ref_id from workout_template_presets where preset_code = 'thr_5x4') as warmup_ref_id,
         (select cooldown_ref_id from workout_template_presets where preset_code = 'thr_5x4') as cooldown_ref_id
),
ins as (
  insert into workout_template_presets
    (variant_id, preset_code, source, tier, enabled_by_default, coach_only,
     coach_review_required, requires_explicit_vo2_intensity, athlete_level_min,
     display_name_ru, warmup_ref_id, cooldown_ref_id, is_enabled, sort_order)
  select v.id, x.code, 'manual', 'core', true, false, false, false, 'L0',
         x.name_ru, refs.warmup_ref_id, refs.cooldown_ref_id, true, x.sort_order
  from v, refs,
    (values
      ('int_walk_6x4', '6 x 4 мин через 1:30 шагом', 4),
      ('int_walk_7x4', '7 x 4 мин через 1:30 шагом', 5),
      ('int_walk_8x4', '8 x 4 мин через 1:30 шагом', 6),
      ('int_walk_6x5', '6 x 5 мин через 1:30 шагом', 7)
    ) as x(code, name_ru, sort_order)
  on conflict (preset_code) do update
    set display_name_ru = excluded.display_name_ru,
        is_enabled = excluded.is_enabled,
        enabled_by_default = excluded.enabled_by_default
  returning id, preset_code
)
insert into workout_template_preset_parameters
  (preset_id, reps, work_duration_min, work_unit, recovery_duration_min, recovery_unit,
   recovery_type, total_quality_volume_min, rpe_target, rpe_cap, avoid_acidosis,
   target_mode, pace_hr_hint_mode, reps_in_reserve, nutrition_required, extra_params)
select ins.id, p.reps, p.work_min, 'min', 1.5, 'min',
       'walk', p.reps * p.work_min, 6, 7, true,
       'rpe', 'advisory_wide_band_only', null, false, '{}'::jsonb
from ins
join (values ('int_walk_6x4', 6, 4), ('int_walk_7x4', 7, 4), ('int_walk_8x4', 8, 4), ('int_walk_6x5', 6, 5))
  as p(code, reps, work_min) on p.code = ins.preset_code;
