-- Уровни на 14 пресетах контролируемого порога + недостающий 3×14 (наряд 06.08, п.2).
--
-- НЕ ПРИМЕНЯЕТСЯ этим нарядом — только файл.
--
-- ГЕЙТ ПО УРОВНЮ НЕ ВКЛЮЧАЕТСЯ. У учеников поля уровня не существует (аудит 06.08:
-- искали в trainingpeaks_students, athlete_training_baselines, club-таблицах, коде, ростер-импорте
-- и админке — 0 размеченных). Если включить отбор по уровню сейчас, из автогенерации выпадет
-- всё выше L0 и вернётся один формат на всех. Поэтому это ЗАДЕЛ: значения проставляются,
-- код их по-прежнему не читает как фильтр.
--
-- Шкала здесь про ПЕРЕНОСИМОСТЬ ОБЪЁМА, а не про интенсивность: у всех четырнадцати
-- RPE 7/8 и avoid_acidosis=true, различаются они только объёмом работы и длиной отрезка.
--
-- ФАЗОВОЕ ИСКЛЮЧЕНИЕ (механика описана, в код НЕ включена — фаз в системе пока нет):
--   длинные отрезки (work_duration_min >= 10) при уровне L3 должны становиться доступными
--   атлету L2, если он в фазе подготовки к полумарафону. То есть эффективный порог уровня =
--   athlete_level_min − 1 ступень, когда phase = 'hm_prep' И work_duration_min >= 10.
--   Реализовывать после появления фаз (§4.3 спеки) и поля уровня у учеников.

update public.workout_template_presets set athlete_level_min = 'L0'
where preset_code in ('thr_4x5','thr_5x4');

update public.workout_template_presets set athlete_level_min = 'L1'
where preset_code in ('thr_3x8','thr_6x4','thr_7x4','thr_5x6','thr_6x5');

update public.workout_template_presets set athlete_level_min = 'L2'
where preset_code in ('thr_4x8','thr_8x4','thr_5x7','thr_6x6','thr_4x9');

update public.workout_template_presets set athlete_level_min = 'L3'
where preset_code in ('thr_3x12','thr_4x10');

-- thr_4x12 в каталоге уже есть и уже L3 — не трогаем. thr_3x14 отсутствует, добавляем
-- по образцу thr_3x12 (длинные отрезки, длинный отдых, тот же RPE-коридор).
insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only,
  coach_review_required, requires_explicit_vo2_intensity, athlete_level_min,
  display_name_ru, is_enabled, sort_order,
  warmup_ref_id, cooldown_ref_id, description_template_ref_id
)
select p.variant_id, 'thr_3x14', 'manual', 'advanced', true, false,
       true, false, 'L3', '3 x 14 мин контролируемый порог', true, p.sort_order + 1,
       p.warmup_ref_id, p.cooldown_ref_id, p.description_template_ref_id
from public.workout_template_presets p
where p.preset_code = 'thr_3x12'
on conflict (preset_code) do nothing;

insert into public.workout_template_preset_parameters (
  preset_id, reps, work_duration_min, recovery_duration_min, recovery_unit, recovery_type,
  target_mode, pace_hr_hint_mode, rpe_target, rpe_cap, avoid_acidosis, reps_in_reserve
)
select n.id, 3, 14, 3, 'min', 'easy_jog',
       pp.target_mode, pp.pace_hr_hint_mode, pp.rpe_target, pp.rpe_cap, pp.avoid_acidosis, pp.reps_in_reserve
from public.workout_template_presets n
join public.workout_template_presets src on src.preset_code = 'thr_3x12'
join public.workout_template_preset_parameters pp on pp.preset_id = src.id
where n.preset_code = 'thr_3x14'
on conflict (preset_id) do nothing;
