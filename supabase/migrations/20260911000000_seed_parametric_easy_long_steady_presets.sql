-- Autoplanner v1 — пять ПАРАМЕТРИЧЕСКИХ пресетов easy / long_run / steady_tempo (спека §5).
--
-- НЕ ПРИМЕНЯЕТСЯ этим нарядом — только файл. Применять осознанно.
--
-- Зачем: easy / long_run / steady_tempo = 0 пресетов, при этом это ~2/3 реальной работы
-- (интервальное качество уже покрыто 31 пресетом). Пять строк закрывают дыру.
--
-- ПРИНЦИПЫ (спека §5):
--  * СХЕМА НЕ МЕНЯЕТСЯ — только строки в существующие workout_template_* таблицы.
--  * ИНТЕНСИВНОСТЬ ЗДЕСЬ НЕ ХРАНИТСЯ. Числа (pct/абсолютный темп) даёт pace-resolver из
--    якоря атлета; в каталоге лежат только структура, режим контроля по умолчанию и RPE-рамка.
--  * ДЛИТЕЛЬНОСТЬ ТОЖЕ НЕ ФИКСИРУЕТСЯ: её даёт объёмный конверт (катящийся 4-нед объём и
--    потолки baseline). Ориентировочные границы из спеки записаны в extra_params как
--    advisory_*, чтобы не притворяться точным числом в run_duration_min.
--  * athlete_level_min = 'L0' у всех пяти: уровень здесь ГЕЙТ, а не масштаб (спека §2/§B).
--
-- ДВА ОТСТУПЛЕНИЯ ОТ БУКВЫ СПЕКИ (осознанные, схему не трогают):
--  1. `recovery_easy` повешен на существующий вариант easy/plain (intensity_intent='easy'),
--     а НЕ на отдельный вариант с intent='recovery': CHECK-ограничение
--     workout_template_variants_intensity_intent_check не содержит значения 'recovery',
--     а менять схему запрещено. Восстановительность несут preset_code + RPE 3/4 + короткая
--     длительность; резолвер маппит preset_code='recovery_easy' → intent 'recovery'.
--  2. target_mode обязателен (CHECK допускает только pace|rpe|hr_chest_only, NULL нельзя),
--     поэтому записан РЕЖИМ ПО УМОЛЧАНИЮ из таблицы §5. Резолвер переопределяет его по тиру
--     атлета (§2.7: T1 → ощущения/rpe, T2/T3 → pace). Это режим контроля, не интенсивность.
--
-- Идемпотентно: preset_code уникален глобально, preset_id уникален в параметрах.

-- ── 1. пресеты ───────────────────────────────────────────────────────────────
insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only,
  coach_review_required, requires_explicit_vo2_intensity, athlete_level_min,
  display_name_ru, is_enabled, sort_order
)
select v.id, x.preset_code, 'manual', 'core', true, false, false, false, 'L0',
       x.display_name_ru, true, x.sort_order
from (values
  ('easy',        'plain',           'easy_continuous',   'Лёгкий бег',                        10),
  ('easy',        'with_strides',    'easy_plus_strides', 'Лёгкий бег с ускорениями',          20),
  ('easy',        'plain',           'recovery_easy',     'Восстановительный бег',             30),
  ('long_run',    'aerobic',         'long_aerobic',      'Длительный аэробный',               40),
  ('steady_tempo','steady',          'steady_continuous', 'Ровный (суб-порог)',                50)
) as x(family_code, variant_code, preset_code, display_name_ru, sort_order)
join public.workout_template_families f on f.family_code = x.family_code
join public.workout_template_variants  v on v.family_id = f.id and v.variant_code = x.variant_code
on conflict (preset_code) do nothing;

-- ── 2. параметры ─────────────────────────────────────────────────────────────
-- reps/work_* заполнены ТОЛЬКО у easy_plus_strides (ускорения — это реальная структура).
-- У остальных структуры нет: непрерывный бег, длительность из конверта.
insert into public.workout_template_preset_parameters (
  preset_id, reps, work_duration_sec, work_unit, recovery_type,
  target_mode, pace_hr_hint_mode, rpe_target, rpe_cap, extra_params
)
select p.id, x.reps, x.work_duration_sec, x.work_unit, x.recovery_type,
       x.target_mode, x.pace_hr_hint_mode, x.rpe_target, x.rpe_cap, x.extra_params::jsonb
from (values
  ('easy_continuous',   null::int, null::numeric, null::text, null::text,
   'pace', 'advisory_wide_band_only', 4::numeric, 5::numeric,
   '{"duration_from_envelope":true,"advisory_min_minutes":30,"advisory_max_minutes":70,"intensity_from":"pace_resolver","control_mode_overridden_by_tier":true}'),

  ('easy_plus_strides', 5,         15,            'sec',      'easy_jog',
   'pace', 'advisory_wide_band_only', 4, 5,
   '{"duration_from_envelope":true,"advisory_min_minutes":30,"advisory_max_minutes":55,"strides":"4-6 x 15 сек в конце, темп по ощущениям, не спринт","intensity_from":"pace_resolver","control_mode_overridden_by_tier":true}'),

  ('recovery_easy',     null,      null,          null,       null,
   'rpe',  'advisory_wide_band_only', 3, 4,
   '{"duration_from_envelope":true,"advisory_min_minutes":20,"advisory_max_minutes":35,"slow_only":true,"intensity_from":"pace_resolver","control_mode_overridden_by_tier":false}'),

  ('long_aerobic',      null,      null,          null,       null,
   'pace', 'advisory_wide_band_only', 4, 5,
   '{"duration_from_envelope":true,"duration_cap_source":"long_run_cap_min","intensity_from":"pace_resolver","control_mode_overridden_by_tier":true}'),

  ('steady_continuous', null,      null,          null,       null,
   'pace', 'advisory_wide_band_only', 6, 7,
   '{"duration_from_envelope":true,"advisory_min_minutes":20,"advisory_max_minutes":40,"anchor":"threshold_down","intensity_from":"pace_resolver","control_mode_overridden_by_tier":false}')
) as x(preset_code, reps, work_duration_sec, work_unit, recovery_type,
       target_mode, pace_hr_hint_mode, rpe_target, rpe_cap, extra_params)
join public.workout_template_presets p on p.preset_code = x.preset_code
on conflict (preset_id) do nothing;
