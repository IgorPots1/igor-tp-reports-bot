-- Лестница шаг-бега новичка: каталожные пресеты приводятся к варианту A.
--
-- ЗАЧЕМ. В каталоге лежали четыре пресета по ДРУГОЙ логике: у них росла
-- длина бега (4 → 5 → 6 мин) при сокращающемся шаге, RPE стоял 4/5, а
-- описания были заглушками «Финальный текст будет добавлен позже».
-- Методика тренера (true_beginner_v2) устроена иначе: сначала сокращается
-- ОТДЫХ при неизменной работе, потом добавляется повтор, и только затем шаг
-- убирается совсем. Ступеней семь, RPE на сессии 2–4.
--
-- СТАРЫЕ ПРЕСЕТЫ НЕ УДАЛЯЮТСЯ [решение Игоря 14.09.2026]. Они уводятся в
-- сторону: код получает суффикс _deprecated, is_enabled и enabled_by_default
-- гасятся. Выключенный пресет в планировщик не попадает — loadCatalog читает
-- выборку с .eq("is_enabled", true). Обратимо одной строкой; удалить всегда
-- успеем, а вернуть удалённое — нет.
--
-- РОСТЕР TRAININGPEAKS ЭТИМ НЕ ЗАТРОНУТ: семейство beginner_run_walk не
-- проходит отбор в loadCatalog (аэробными считаются easy/long_run/steady_tempo,
-- качеством — intervals/race_specific), поэтому ни один пресет этого
-- семейства никогда не попадал и не попадёт в неделю атлета из ростера.
--
-- ИСТОЧНИК ПРАВДЫ — src/features/methodology/beginner.ts. Тексты ниже
-- порождены из него; расхождение ловит check:beginner-methodology.
--
-- ИДЕМПОТЕНТНО: повторный прогон не задвоит суффикс и обновит строки на месте.
--
-- ПРИМЕНЕНА 14.09.2026 агентом. Результат сверен чтением схемы: 7 включённых
-- пресетов с RPE 2/4 и настоящими описаниями, 3 старых переведены в
-- *_deprecated с is_enabled = false. Удалено ноль строк.

-- ── Описания вместо заглушек ──
insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_1', 'Новичок · ступень 1: 5 x 4 мин бег / 2 мин шаг', '5 повторов: 4 мин лёгкого бега + 2 мин шага. Шаг — это отдых, идти спокойно. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_2', 'Новичок · ступень 2: 5 x 5 мин бег / 2 мин шаг', '5 повторов: 5 мин лёгкого бега + 2 мин шага. Шаг — это отдых, идти спокойно. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_3', 'Новичок · ступень 3: 5 x 5 мин бег / 1:30 шаг', '5 повторов: 5 мин лёгкого бега + 1 мин 30 сек шага. Шаг — это отдых, идти спокойно. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_4', 'Новичок · ступень 4: 5 x 5 мин бег / 1 мин шаг', '5 повторов: 5 мин лёгкого бега + 1 мин шага. Шаг — это отдых, идти спокойно. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_5', 'Новичок · ступень 5: 5-6 x 5 мин бег / 1 мин шаг', '5–6 повторов: 5 мин лёгкого бега + 1 мин шага. Шаг — это отдых, идти спокойно. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_6', 'Новичок · ступень 6: 25 мин лёгкого непрерывного бега', '25 минут непрерывного лёгкого бега, без переходов на шаг. Если стало тяжело — перейдите на шаг и отметьте это: значит, ступень взята рано. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

insert into public.workout_template_description_refs (ref_code, display_name_ru, description_text_ru, is_draft, is_enabled)
values ('desc_beginner_step_7', 'Новичок · ступень 7: 30 мин лёгкого непрерывного бега', '30 минут непрерывного лёгкого бега, без переходов на шаг. Если стало тяжело — перейдите на шаг и отметьте это: значит, ступень взята рано. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.', false, true)
on conflict (ref_code) do update set display_name_ru = excluded.display_name_ru, description_text_ru = excluded.description_text_ru, is_draft = false, is_enabled = true;

-- ── Старые пресеты уводим в сторону, НЕ удаляем ──
update public.workout_template_presets p
set preset_code = p.preset_code || '_deprecated',
    display_name_ru = p.display_name_ru || ' (устарел)',
    is_enabled = false,
    enabled_by_default = false,
    updated_at = now()
from public.workout_template_variants v, public.workout_template_families f
where p.variant_id = v.id and v.family_id = f.id
  and f.family_code = 'beginner_run_walk'
  and p.preset_code not like '%\_deprecated'
  and p.preset_code not in ('rw_5x4_2walk', 'rw_5x5_2walk', 'rw_5x5_90walk', 'rw_5x5_1walk', 'rw_6x5_1walk', 'rw_continuous_25', 'rw_continuous_30');

-- ── Семь ступеней ──
-- Разминка и заминка — ссылки «без разминки»/«без заминки» намеренно: формат
-- шаг-бег сам себе разминка, первый отрезок бежится с холодных ног в том же
-- лёгком усилии. Приписать сверху 8 + 10 минут значило бы выдать новичку
-- сессию на 48 минут вместо тридцати.
insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_5x4_2walk', 'manual', 'core', true, false, true,
  false, 'L0', '5 x 4 мин бег / 2 мин шаг',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_1'), true, 310
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, 5, 4, 2, 'walk',
  'rpe', 2, 4, 'none', '{"beginnerStep": 1, "repsMin": 5, "runningMinutes": 20}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_5x4_2walk'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_5x5_2walk', 'manual', 'core', true, false, true,
  false, 'L0', '5 x 5 мин бег / 2 мин шаг',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_2'), true, 320
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, 5, 5, 2, 'walk',
  'rpe', 2, 4, 'none', '{"beginnerStep": 2, "repsMin": 5, "runningMinutes": 25}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_5x5_2walk'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_5x5_90walk', 'manual', 'core', true, false, true,
  false, 'L0', '5 x 5 мин бег / 1:30 шаг',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_3'), true, 330
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, 5, 5, 1.5, 'walk',
  'rpe', 2, 4, 'none', '{"beginnerStep": 3, "repsMin": 5, "runningMinutes": 25}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_5x5_90walk'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_5x5_1walk', 'manual', 'core', true, false, true,
  false, 'L0', '5 x 5 мин бег / 1 мин шаг',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_4'), true, 340
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, 5, 5, 1, 'walk',
  'rpe', 2, 4, 'none', '{"beginnerStep": 4, "repsMin": 5, "runningMinutes": 25}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_5x5_1walk'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_6x5_1walk', 'manual', 'core', true, false, true,
  false, 'L0', '5-6 x 5 мин бег / 1 мин шаг',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_5'), true, 350
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, 6, 5, 1, 'walk',
  'rpe', 2, 4, 'none', '{"beginnerStep": 5, "repsMin": 5, "runningMinutes": 30}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_6x5_1walk'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_continuous_25', 'manual', 'core', true, false, true,
  false, 'L0', '25 мин лёгкого непрерывного бега',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_6'), true, 360
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, null, null, null, null,
  'rpe', 2, 4, 'none', '{"beginnerStep": 6, "continuousMinutes": 25, "runningMinutes": 25}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_continuous_25'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

insert into public.workout_template_presets (
  variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required,
  requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, warmup_ref_id, cooldown_ref_id,
  description_template_ref_id, is_enabled, sort_order)
select v.id, 'rw_continuous_30', 'manual', 'core', true, false, true,
  false, 'L0', '30 мин лёгкого непрерывного бега',
  (select id from public.workout_template_warmup_refs where ref_code = 'warmup_none'),
  (select id from public.workout_template_cooldown_refs where ref_code = 'cooldown_none'),
  (select id from public.workout_template_description_refs where ref_code = 'desc_beginner_step_7'), true, 370
from public.workout_template_variants v
join public.workout_template_families f on f.id = v.family_id
where f.family_code = 'beginner_run_walk' and v.variant_code = 'default'
on conflict (preset_code) do update set
  display_name_ru = excluded.display_name_ru,
  description_template_ref_id = excluded.description_template_ref_id,
  warmup_ref_id = excluded.warmup_ref_id,
  cooldown_ref_id = excluded.cooldown_ref_id,
  is_enabled = true, enabled_by_default = true, sort_order = excluded.sort_order, updated_at = now();

insert into public.workout_template_preset_parameters (
  preset_id, reps, run_duration_min, walk_duration_min, recovery_type,
  target_mode, rpe_target, rpe_cap, pace_hr_hint_mode, extra_params)
select p.id, null, null, null, null,
  'rpe', 2, 4, 'none', '{"beginnerStep": 7, "continuousMinutes": 30, "runningMinutes": 30}'::jsonb
from public.workout_template_presets p where p.preset_code = 'rw_continuous_30'
on conflict (preset_id) do update set
  reps = excluded.reps, run_duration_min = excluded.run_duration_min,
  walk_duration_min = excluded.walk_duration_min, recovery_type = excluded.recovery_type,
  target_mode = excluded.target_mode, rpe_target = excluded.rpe_target, rpe_cap = excluded.rpe_cap,
  pace_hr_hint_mode = excluded.pace_hr_hint_mode, extra_params = excluded.extra_params, updated_at = now();

