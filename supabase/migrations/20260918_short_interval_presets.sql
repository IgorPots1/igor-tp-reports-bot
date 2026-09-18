-- Короткие интервальные форматы для сегмента с малым объёмом [18.09.2026].
--
-- ЗАЧЕМ. Самый короткий интервальный формат каталога — thr_5x4: блок работы
-- 24 минуты, и даже с ужатой обвязкой сессия выходит 36 минут. У человека с
-- недельным объёмом 70–85 минут бюджет качественной 22–32, и отрезков не
-- существует НИ ПРИ КАКОЙ обвязке. Пропорциональная разминка (withScaledWarmup)
-- эту дыру не закрывает: она чинит обвязку, а не отсутствие короткого блока.
--
-- ЧИСЛА ИЗ КАРТОЧЕК ТРЕНЕРА. Игорь пишет этому сегменту 7 × 4 мин через
-- 1.5 мин ШАГОМ, цель по ощущению. Здесь та же форма ступенью ниже: три минуты
-- вместо четырёх, минута шага вместо полутора. Лестница 3→4→5 повторов, дальше
-- начинается существующий thr_5x4.
--
-- ПОЧЕМУ intensity_intent = controlled_threshold, ХОТЯ ЭТО НЕ ПОРОГ.
-- Guardrail injury_or_acute_pain_blocks_intensity фильтрует по СПИСКУ intent-ов
-- (controlled_threshold, threshold, vo2, race_pace, …). Новый intent выпал бы из
-- этого списка, и человек с активной болью получил бы отрезки. Интенсивность
-- задаётся параметрами (RPE 6/7, а не 7/8 как у thr_*), а тег intent остаётся
-- прежним, чтобы все существующие блокировки продолжали действовать.
--
-- coach_review_required = false СОЗНАТЕЛЬНО [решение Игоря 18.09.2026]:
-- guardrail quality_requires_coach_review уже накрывает ВСЕ качественные
-- (all_quality_sessions), и отдельный флаг был бы вторым звонком о том же.

with v as (
  select id from workout_template_variants where variant_code = 'controlled_threshold'
),
refs as (
  select
    (select warmup_ref_id from workout_template_presets where preset_code = 'thr_5x4') as warmup_ref_id,
    (select cooldown_ref_id from workout_template_presets where preset_code = 'thr_5x4') as cooldown_ref_id
),
ins as (
  insert into workout_template_presets
    (variant_id, preset_code, source, tier, enabled_by_default, coach_only,
     coach_review_required, requires_explicit_vo2_intensity, athlete_level_min,
     display_name_ru, warmup_ref_id, cooldown_ref_id, is_enabled, sort_order)
  select v.id, x.code, 'manual', 'core', true, false,
         false, false, 'L0',
         x.name_ru, refs.warmup_ref_id, refs.cooldown_ref_id, true, x.sort_order
  from v, refs,
    (values
      ('int_walk_3x3', '3 x 3 мин через минуту шагом', 1),
      ('int_walk_4x3', '4 x 3 мин через минуту шагом', 2),
      ('int_walk_5x3', '5 x 3 мин через минуту шагом', 3)
    ) as x(code, name_ru, sort_order)
  on conflict (preset_code) do update
    set display_name_ru = excluded.display_name_ru,
        coach_review_required = excluded.coach_review_required,
        is_enabled = excluded.is_enabled,
        enabled_by_default = excluded.enabled_by_default
  returning id, preset_code
)
insert into workout_template_preset_parameters
  (preset_id, reps, work_duration_min, work_unit, recovery_duration_min, recovery_unit,
   recovery_type, total_quality_volume_min, rpe_target, rpe_cap, avoid_acidosis,
   target_mode, pace_hr_hint_mode, reps_in_reserve, nutrition_required, extra_params)
select ins.id, p.reps, 3, 'min', 1, 'min',
       'walk', p.reps * 3, 6, 7, true,
       'rpe', 'advisory_wide_band_only', null, false, '{}'::jsonb
from ins
join (values ('int_walk_3x3', 3), ('int_walk_4x3', 4), ('int_walk_5x3', 5)) as p(code, reps)
  on p.code = ins.preset_code;
