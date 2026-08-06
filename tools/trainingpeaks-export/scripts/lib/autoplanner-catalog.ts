/**
 * autoplanner-catalog — генератор читает МЕТОДОЛОГИЮ ИЗ КАТАЛОГА, а не из строк в коде.
 *
 * До этого модуля названия тренировок и структура были захардкожены в сборщике недели,
 * а таблицы workout_template_* не читались вообще (включая пять аэробных пресетов).
 * Теперь: названия, RPE-рамка, режим контроля, длительности разминки/заминки и
 * ограничения (guardrails / coach_review_rules) приходят из БД.
 *
 * Только чтение. Ничего не пишет.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AerobicPresetCode = "easy_continuous" | "easy_plus_strides" | "recovery_easy" | "long_aerobic" | "steady_continuous";

export type AerobicPreset = {
  presetCode: string;
  displayNameRu: string;
  targetMode: "pace" | "rpe" | "hr_chest_only";
  rpeTarget: number | null;
  rpeCap: number | null;
  advisoryMinMinutes: number | null;
  advisoryMaxMinutes: number | null;
  /** режим контроля переопределяется тиром (§2.7), если пресет это разрешает */
  controlModeOverriddenByTier: boolean;
};

export type QualityPreset = {
  presetCode: string;
  displayNameRu: string;
  intensityIntent: string;      // controlled_threshold | threshold | vo2 | ...
  reps: number;
  workMinutes: number;
  recoveryMinutes: number;
  rpeTarget: number | null;
  rpeCap: number | null;
  avoidAcidosis: boolean;
  coachReviewRequired: boolean;
  requiresExplicitVo2: boolean;
  warmupMinutes: number;
  cooldownMinutes: number;
  /** суммарный объём работы, мин — по нему строится лестница прогрессии */
  totalWorkMinutes: number;
};

export type Guardrail = {
  ruleCode: string; severity: "hard_block" | "soft_warning" | "coach_review";
  messageRu: string; intents: string[]; families: string[]; condition: Record<string, unknown>;
};
export type ReviewRule = { ruleCode: string; triggerType: string; messageRu: string; intents: string[] };

export type Catalog = {
  aerobic: Map<string, AerobicPreset>;
  quality: QualityPreset[];
  guardrails: Guardrail[];
  reviewRules: ReviewRule[];
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

type ParamRow = { reps?: number | null; work_duration_min?: number | null; recovery_duration_min?: number | null;
  target_mode?: string | null; rpe_target?: number | null; rpe_cap?: number | null; avoid_acidosis?: boolean | null;
  extra_params?: Record<string, unknown> | null };
type RefRow = { duration_min_approx?: number | null };
type CatalogRow = {
  preset_code: string; display_name_ru: string; coach_only: boolean | null;
  coach_review_required: boolean | null; requires_explicit_vo2_intensity: boolean | null;
  athlete_level_min: string | null; enabled_by_default: boolean | null;
  workout_template_variants: { variant_code: string; intensity_intent: string; workout_template_families: { family_code: string } };
  workout_template_preset_parameters: ParamRow | ParamRow[] | null;
  workout_template_warmup_refs: RefRow | RefRow[] | null;
  workout_template_cooldown_refs: RefRow | RefRow[] | null;
};
type GuardrailRow = { rule_code: string; severity: Guardrail["severity"]; message_ru: string;
  applies_to_intensity_intents: string[] | null; applies_to_family_codes: string[] | null; condition_jsonb: Record<string, unknown> | null };
type ReviewRuleRow = { rule_code: string; trigger_type: string; message_ru: string; applies_to_intensity_intents: string[] | null };

export async function loadCatalog(sb: SupabaseClient): Promise<Catalog> {
  const { data: presets, error } = await sb.from("workout_template_presets")
    .select(`preset_code, display_name_ru, coach_only, coach_review_required, requires_explicit_vo2_intensity,
             athlete_level_min, is_enabled, enabled_by_default,
             workout_template_variants!inner(variant_code, intensity_intent, workout_template_families!inner(family_code)),
             workout_template_preset_parameters(reps, work_duration_min, recovery_duration_min, target_mode, rpe_target, rpe_cap, avoid_acidosis, extra_params),
             workout_template_warmup_refs(duration_min_approx),
             workout_template_cooldown_refs(duration_min_approx)`)
    .eq("is_enabled", true);
  if (error) throw error;

  const aerobic = new Map<string, AerobicPreset>();
  const quality: QualityPreset[] = [];

  for (const r of (presets ?? []) as unknown as Array<CatalogRow>) {
    const v = r.workout_template_variants; const fam = v?.workout_template_families?.family_code;
    const pp = Array.isArray(r.workout_template_preset_parameters) ? r.workout_template_preset_parameters[0] : r.workout_template_preset_parameters;
    const extra = (pp?.extra_params ?? {}) as Record<string, unknown>;

    if (fam === "easy" || fam === "long_run" || fam === "steady_tempo") {
      aerobic.set(r.preset_code as string, {
        presetCode: r.preset_code, displayNameRu: r.display_name_ru,
        targetMode: (pp?.target_mode ?? "pace") as AerobicPreset["targetMode"],
        rpeTarget: num(pp?.rpe_target), rpeCap: num(pp?.rpe_cap),
        advisoryMinMinutes: num(extra.advisory_min_minutes), advisoryMaxMinutes: num(extra.advisory_max_minutes),
        controlModeOverriddenByTier: extra.control_mode_overridden_by_tier !== false,
      });
      continue;
    }
    if (fam !== "intervals" && fam !== "race_specific") continue;

    // Кандидат автогенерации: не coach_only и без гейта уровня выше L0 — уровня у учеников
    // не существует (аудит 06.08), поэтому всё, что требует L2+, автоматике недоступно.
    const lvl = r.athlete_level_min as string | null;
    if (r.coach_only === true) continue;
    // enabled_by_default читается КАК ФИЛЬТР: раньше он лежал в выборке, но не применялся,
    // и выключенный thr_7x4 выбирался автогенерацией 7 раз.
    if (r.enabled_by_default === false) continue;
    if (lvl !== null && lvl !== "L0") continue;
    if (!pp?.reps || !pp?.work_duration_min) continue;

    const warm = Array.isArray(r.workout_template_warmup_refs) ? r.workout_template_warmup_refs[0] : r.workout_template_warmup_refs;
    const cool = Array.isArray(r.workout_template_cooldown_refs) ? r.workout_template_cooldown_refs[0] : r.workout_template_cooldown_refs;
    const reps = Number(pp.reps), work = Number(pp.work_duration_min);
    quality.push({
      presetCode: r.preset_code, displayNameRu: r.display_name_ru,
      intensityIntent: v.intensity_intent, reps, workMinutes: work,
      recoveryMinutes: Number(pp.recovery_duration_min ?? 2),
      rpeTarget: num(pp.rpe_target), rpeCap: num(pp.rpe_cap),
      avoidAcidosis: pp.avoid_acidosis === true,
      coachReviewRequired: r.coach_review_required === true,
      requiresExplicitVo2: r.requires_explicit_vo2_intensity === true,
      warmupMinutes: Number(warm?.duration_min_approx ?? 12),
      cooldownMinutes: Number(cool?.duration_min_approx ?? 10),
      totalWorkMinutes: reps * work,
    });
  }

  const { data: gr } = await sb.from("workout_template_guardrails")
    .select("rule_code, severity, message_ru, applies_to_intensity_intents, applies_to_family_codes, condition_jsonb").eq("is_enabled", true);
  const { data: rr } = await sb.from("coach_review_rules")
    .select("rule_code, trigger_type, message_ru, applies_to_intensity_intents").eq("is_enabled", true);

  return {
    aerobic, quality: quality.sort((a, b) => a.totalWorkMinutes - b.totalWorkMinutes),
    guardrails: ((gr ?? []) as unknown as Array<GuardrailRow>).map((g) => ({
      ruleCode: g.rule_code, severity: g.severity, messageRu: g.message_ru,
      intents: g.applies_to_intensity_intents ?? [], families: g.applies_to_family_codes ?? [],
      condition: (g.condition_jsonb ?? {}) as Record<string, unknown>,
    })),
    reviewRules: ((rr ?? []) as unknown as Array<ReviewRuleRow>).map((r) => ({
      ruleCode: r.rule_code, triggerType: r.trigger_type, messageRu: r.message_ru,
      intents: r.applies_to_intensity_intents ?? [],
    })),
  };
}
