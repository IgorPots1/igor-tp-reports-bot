import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

type Counts = {
  inserted: number;
  updated: number;
};

type SeedTrackedRow<T> = T & {
  seedExists: boolean;
};

type WorkoutTemplateGuardrailSeed = {
  ruleCode: string;
  severity: "hard_block" | "soft_warning" | "coach_review";
  appliesToFamilyCodes?: string[];
  appliesToVariantCodes?: string[];
  appliesToPresetCodes?: string[];
  appliesToIntensityIntents?: string[];
  conditionJsonb: Record<string, unknown>;
  messageRu: string;
  isCodeConstant: boolean;
  isEnabled?: boolean;
  sortOrder: number;
};

type CoachReviewRuleSeed = {
  ruleCode: string;
  triggerType: "percentage_increase" | "absolute_increase" | "flag_present" | "always";
  thresholdValue?: number | null;
  appliesToContextFlags?: string[];
  appliesToFamilyCodes?: string[];
  appliesToVariantCodes?: string[];
  appliesToPresetCodes?: string[];
  appliesToIntensityIntents?: string[];
  conditionJsonb?: Record<string, unknown>;
  messageRu: string;
  isCodeConstant?: boolean;
  isEnabled?: boolean;
  sortOrder: number;
};

const REQUIRED_THRESHOLD_PRESET_CODES = [
  "thr_5x4",
  "thr_4x5",
  "thr_8x4",
  "thr_6x5",
  "thr_6x6",
  "thr_4x9",
  "thr_5x7",
] as const;

const REQUIRED_GUARDRAIL_CODES = [
  "no_beginner_vo2",
  "hr_chest_only",
  "no_hard_stack",
  "warmup_required_for_quality",
  "quality_requires_coach_review",
  "threshold_numbers_not_vo2_default",
  "no_vo2_before_priority_race",
  "marathon_long_coach_only",
  "injury_or_acute_pain_blocks_intensity",
  "insufficient_data_blocks_generation",
  "returning_after_break_requires_review",
] as const;

const REQUIRED_REVIEW_RULE_CODES = [
  "weekly_minutes_plus_10pct",
  "long_run_plus_15min",
  "extra_run_session",
  "extra_quality_session",
  "any_marathon_specific_long",
  "any_vo2_session",
  "any_race_specific_key",
  "pilot_any_deviation",
] as const;

const CRITICAL_HARD_BLOCK_CODES = [
  "no_beginner_vo2",
  "hr_chest_only",
  "no_hard_stack",
  "warmup_required_for_quality",
  "threshold_numbers_not_vo2_default",
  "no_vo2_before_priority_race",
  "injury_or_acute_pain_blocks_intensity",
  "insufficient_data_blocks_generation",
] as const;

const workoutTemplateGuardrailsSeed: WorkoutTemplateGuardrailSeed[] = [
  {
    ruleCode: "no_beginner_vo2",
    severity: "hard_block",
    appliesToIntensityIntents: ["vo2"],
    conditionJsonb: { athlete_level_max: "L1" },
    messageRu: "Новичкам нельзя назначать VO2/МПК-сессии.",
    isCodeConstant: true,
    sortOrder: 10,
  },
  {
    ruleCode: "hr_chest_only",
    severity: "hard_block",
    conditionJsonb: { target_mode: "hr_chest_only", requires_chest_strap: true },
    messageRu: "Пульсовые таргеты можно использовать только при наличии нагрудного датчика.",
    isCodeConstant: true,
    sortOrder: 20,
  },
  {
    ruleCode: "no_hard_stack",
    severity: "hard_block",
    conditionJsonb: { no_consecutive_hard_days: true },
    messageRu: "Нельзя ставить две тяжёлые тренировки подряд.",
    isCodeConstant: true,
    sortOrder: 30,
  },
  {
    ruleCode: "warmup_required_for_quality",
    severity: "hard_block",
    conditionJsonb: { quality_requires_warmup: true },
    messageRu: "Интенсивная тренировка требует разминки по уровню.",
    isCodeConstant: true,
    sortOrder: 40,
  },
  {
    ruleCode: "quality_requires_coach_review",
    severity: "coach_review",
    conditionJsonb: { all_quality_sessions: true },
    messageRu: "Все quality-сессии требуют подтверждения тренера.",
    isCodeConstant: true,
    sortOrder: 50,
  },
  {
    ruleCode: "threshold_numbers_not_vo2_default",
    severity: "hard_block",
    appliesToPresetCodes: [...REQUIRED_THRESHOLD_PRESET_CODES],
    conditionJsonb: {
      blocked_intensity_intent: "vo2",
      unless_requires_explicit_vo2_intensity: true,
    },
    messageRu:
      "Эти интервалы являются controlled_threshold по умолчанию и не могут стать VO2 без явного выбора тренером.",
    isCodeConstant: true,
    sortOrder: 60,
  },
  {
    ruleCode: "no_vo2_before_priority_race",
    severity: "hard_block",
    appliesToIntensityIntents: ["vo2"],
    conditionJsonb: { min_days_to_priority_race: 5 },
    messageRu: "VO2 нельзя ставить слишком близко к приоритетному старту.",
    isCodeConstant: true,
    sortOrder: 70,
  },
  {
    ruleCode: "marathon_long_coach_only",
    severity: "coach_review",
    appliesToFamilyCodes: ["long_run", "race_specific"],
    appliesToVariantCodes: ["marathon_specific", "marathon"],
    conditionJsonb: { marathon_specific_long: true },
    messageRu: "Марафонская специфическая длительная требует ручного подтверждения.",
    isCodeConstant: true,
    sortOrder: 80,
  },
  {
    ruleCode: "injury_or_acute_pain_blocks_intensity",
    severity: "hard_block",
    appliesToIntensityIntents: [
      "controlled_threshold",
      "threshold",
      "vo2",
      "race_pace",
      "marathon_pace",
      "hm_pace",
      "ten_k_pace",
    ],
    conditionJsonb: { blocked_context_flags: ["injury", "acute_pain"] },
    messageRu: "При травме или острой боли интенсивность блокируется.",
    isCodeConstant: true,
    sortOrder: 90,
  },
  {
    ruleCode: "insufficient_data_blocks_generation",
    severity: "hard_block",
    conditionJsonb: { blocked_context_flags: ["insufficient_data"] },
    messageRu: "Недостаточно данных для безопасной генерации плана.",
    isCodeConstant: true,
    sortOrder: 100,
  },
  {
    ruleCode: "returning_after_break_requires_review",
    severity: "coach_review",
    conditionJsonb: { review_context_flags: ["returning"] },
    messageRu: "Возвращение после паузы требует проверки тренера.",
    isCodeConstant: false,
    sortOrder: 110,
  },
];

const coachReviewRulesSeed: CoachReviewRuleSeed[] = [
  {
    ruleCode: "weekly_minutes_plus_10pct",
    triggerType: "percentage_increase",
    thresholdValue: 10,
    messageRu: "Недельный объём выше baseline больше чем на 10%.",
    isCodeConstant: true,
    sortOrder: 10,
  },
  {
    ruleCode: "long_run_plus_15min",
    triggerType: "absolute_increase",
    thresholdValue: 15,
    messageRu: "Длительная выше baseline больше чем на 15 минут.",
    isCodeConstant: true,
    sortOrder: 20,
  },
  {
    ruleCode: "extra_run_session",
    triggerType: "absolute_increase",
    thresholdValue: 1,
    messageRu: "Добавлена дополнительная беговая тренировка относительно baseline.",
    isCodeConstant: true,
    sortOrder: 30,
  },
  {
    ruleCode: "extra_quality_session",
    triggerType: "absolute_increase",
    thresholdValue: 1,
    messageRu: "Добавлена дополнительная quality-сессия относительно baseline.",
    isCodeConstant: true,
    sortOrder: 40,
  },
  {
    ruleCode: "any_marathon_specific_long",
    triggerType: "always",
    appliesToFamilyCodes: ["long_run", "race_specific"],
    appliesToVariantCodes: ["marathon_specific", "marathon"],
    messageRu: "Любая марафонская специфическая длительная требует проверки тренера.",
    isCodeConstant: true,
    sortOrder: 50,
  },
  {
    ruleCode: "any_vo2_session",
    triggerType: "always",
    appliesToIntensityIntents: ["vo2"],
    messageRu: "Любая VO2/МПК-сессия требует проверки тренера.",
    isCodeConstant: true,
    sortOrder: 60,
  },
  {
    ruleCode: "any_race_specific_key",
    triggerType: "always",
    appliesToFamilyCodes: ["race_specific"],
    messageRu: "Любая race-specific key session требует проверки тренера.",
    isCodeConstant: true,
    sortOrder: 70,
  },
  {
    ruleCode: "pilot_any_deviation",
    triggerType: "always",
    appliesToContextFlags: ["pilot"],
    conditionJsonb: { any_baseline_deviation: true },
    messageRu: "В пилотной партии любое отклонение от baseline показывать тренеру.",
    isCodeConstant: false,
    sortOrder: 80,
  },
];

function getEnvValue(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function isDryRunMode(): boolean {
  return !hasFlag("--apply");
}

function countChange<T extends { seedExists: boolean }>(rows: T[]): Counts {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (row.seedExists) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }
  return { inserted, updated };
}

function stripSeedExists<T>(rows: Array<SeedTrackedRow<T>>): T[] {
  return rows.map((row) => {
    const nextRow = { ...row };
    delete nextRow.seedExists;
    return nextRow;
  });
}

function evaluateGuardrailSeedInvariants(): { ok: boolean; checks: string[]; errors: string[] } {
  const checks: string[] = [];
  const errors: string[] = [];

  const guardrailByCode = new Map(workoutTemplateGuardrailsSeed.map((row) => [row.ruleCode, row]));
  const reviewRuleByCode = new Map(coachReviewRulesSeed.map((row) => [row.ruleCode, row]));

  const missingGuardrails = REQUIRED_GUARDRAIL_CODES.filter((code) => !guardrailByCode.has(code));
  if (missingGuardrails.length > 0) {
    errors.push(`Missing required guardrails: ${missingGuardrails.join(", ")}`);
  } else {
    checks.push("All required guardrails are present in seed.");
  }

  const missingReviewRules = REQUIRED_REVIEW_RULE_CODES.filter((code) => !reviewRuleByCode.has(code));
  if (missingReviewRules.length > 0) {
    errors.push(`Missing required coach review rules: ${missingReviewRules.join(", ")}`);
  } else {
    checks.push("All required coach review rules are present in seed.");
  }

  const thresholdGuardrail = guardrailByCode.get("threshold_numbers_not_vo2_default");
  const thresholdPresetCodes = new Set(thresholdGuardrail?.appliesToPresetCodes ?? []);
  const missingThresholdCodes = REQUIRED_THRESHOLD_PRESET_CODES.filter((code) => !thresholdPresetCodes.has(code));
  if (missingThresholdCodes.length > 0) {
    errors.push(`threshold_numbers_not_vo2_default missing preset codes: ${missingThresholdCodes.join(", ")}`);
  } else {
    checks.push("threshold_numbers_not_vo2_default protects all required threshold-number presets.");
  }

  for (const ruleCode of CRITICAL_HARD_BLOCK_CODES) {
    const rule = guardrailByCode.get(ruleCode);
    if (!rule) {
      continue;
    }
    if (rule.severity !== "hard_block" || !rule.isCodeConstant) {
      errors.push(`${ruleCode} must stay hard_block and is_code_constant=true.`);
    }
  }
  checks.push("Critical hard-block guardrails remain code-constant.");

  const weeklyMinutes = reviewRuleByCode.get("weekly_minutes_plus_10pct");
  if (!weeklyMinutes || weeklyMinutes.thresholdValue !== 10) {
    errors.push("weekly_minutes_plus_10pct threshold_value must be 10.");
  } else {
    checks.push("weekly_minutes_plus_10pct threshold is 10.");
  }

  const longRun = reviewRuleByCode.get("long_run_plus_15min");
  if (!longRun || longRun.thresholdValue !== 15) {
    errors.push("long_run_plus_15min threshold_value must be 15.");
  } else {
    checks.push("long_run_plus_15min threshold is 15.");
  }

  const qualityReview = guardrailByCode.get("quality_requires_coach_review");
  if (!qualityReview) {
    errors.push("quality_requires_coach_review guardrail is required.");
  } else {
    checks.push("quality_requires_coach_review guardrail is present.");
  }

  return { ok: errors.length === 0, checks, errors };
}

async function runPreview(): Promise<void> {
  const invariantResult = evaluateGuardrailSeedInvariants();
  console.log("[seed-workout-template-guardrails] mode=dry-run");
  console.log(`[seed-workout-template-guardrails] guardrails_total=${workoutTemplateGuardrailsSeed.length}`);
  console.log(`[seed-workout-template-guardrails] coach_review_rules_total=${coachReviewRulesSeed.length}`);
  console.log(
    `[seed-workout-template-guardrails] invariant_checks=${invariantResult.checks.length} invariant_errors=${invariantResult.errors.length}`
  );
  for (const check of invariantResult.checks) {
    console.log(`[seed-workout-template-guardrails] check=PASS ${check}`);
  }
  for (const error of invariantResult.errors) {
    console.log(`[seed-workout-template-guardrails] check=FAIL ${error}`);
  }
  if (!invariantResult.ok) {
    throw new Error("Guardrail seed definitions failed invariant validation.");
  }
  console.log("[seed-workout-template-guardrails] preview_only=true");
}

async function runApply(): Promise<void> {
  const invariantResult = evaluateGuardrailSeedInvariants();
  if (!invariantResult.ok) {
    for (const error of invariantResult.errors) {
      console.log(`[seed-workout-template-guardrails] check=FAIL ${error}`);
    }
    throw new Error("Guardrail seed definitions failed invariant validation.");
  }

  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(
      "[seed-workout-template-guardrails] SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const supabase = createSupabaseServerClient();

  const existingGuardrailsResult = await supabase
    .from("workout_template_guardrails")
    .select("rule_code");
  if (existingGuardrailsResult.error) {
    throw new Error(
      `Failed to inspect workout_template_guardrails (did you apply migration?): ${existingGuardrailsResult.error.message}`
    );
  }
  const existingGuardrailCodes = new Set((existingGuardrailsResult.data ?? []).map((row) => row.rule_code));

  const guardrailPayload: Array<
    SeedTrackedRow<{
      rule_code: string;
      severity: "hard_block" | "soft_warning" | "coach_review";
      applies_to_family_codes: string[];
      applies_to_variant_codes: string[];
      applies_to_preset_codes: string[];
      applies_to_intensity_intents: string[];
      condition_jsonb: Record<string, unknown>;
      message_ru: string;
      is_code_constant: boolean;
      is_enabled: boolean;
      sort_order: number;
    }>
  > = workoutTemplateGuardrailsSeed.map((row) => ({
    rule_code: row.ruleCode,
    severity: row.severity,
    applies_to_family_codes: row.appliesToFamilyCodes ?? [],
    applies_to_variant_codes: row.appliesToVariantCodes ?? [],
    applies_to_preset_codes: row.appliesToPresetCodes ?? [],
    applies_to_intensity_intents: row.appliesToIntensityIntents ?? [],
    condition_jsonb: row.conditionJsonb,
    message_ru: row.messageRu,
    is_code_constant: row.isCodeConstant,
    is_enabled: row.isEnabled ?? true,
    sort_order: row.sortOrder,
    seedExists: existingGuardrailCodes.has(row.ruleCode),
  }));
  const { error: guardrailsUpsertError } = await supabase
    .from("workout_template_guardrails")
    .upsert(stripSeedExists(guardrailPayload), { onConflict: "rule_code" });
  if (guardrailsUpsertError) {
    throw new Error(`Failed to upsert workout_template_guardrails: ${guardrailsUpsertError.message}`);
  }

  const existingReviewRulesResult = await supabase.from("coach_review_rules").select("rule_code");
  if (existingReviewRulesResult.error) {
    throw new Error(
      `Failed to inspect coach_review_rules (did you apply migration?): ${existingReviewRulesResult.error.message}`
    );
  }
  const existingReviewRuleCodes = new Set((existingReviewRulesResult.data ?? []).map((row) => row.rule_code));

  const reviewRulePayload: Array<
    SeedTrackedRow<{
      rule_code: string;
      trigger_type: "percentage_increase" | "absolute_increase" | "flag_present" | "always";
      threshold_value: number | null;
      applies_to_context_flags: string[];
      applies_to_family_codes: string[];
      applies_to_variant_codes: string[];
      applies_to_preset_codes: string[];
      applies_to_intensity_intents: string[];
      condition_jsonb: Record<string, unknown>;
      message_ru: string;
      is_code_constant: boolean;
      is_enabled: boolean;
      sort_order: number;
    }>
  > = coachReviewRulesSeed.map((row) => ({
    rule_code: row.ruleCode,
    trigger_type: row.triggerType,
    threshold_value: row.thresholdValue ?? null,
    applies_to_context_flags: row.appliesToContextFlags ?? [],
    applies_to_family_codes: row.appliesToFamilyCodes ?? [],
    applies_to_variant_codes: row.appliesToVariantCodes ?? [],
    applies_to_preset_codes: row.appliesToPresetCodes ?? [],
    applies_to_intensity_intents: row.appliesToIntensityIntents ?? [],
    condition_jsonb: row.conditionJsonb ?? {},
    message_ru: row.messageRu,
    is_code_constant: row.isCodeConstant ?? false,
    is_enabled: row.isEnabled ?? true,
    sort_order: row.sortOrder,
    seedExists: existingReviewRuleCodes.has(row.ruleCode),
  }));
  const { error: reviewRulesUpsertError } = await supabase
    .from("coach_review_rules")
    .upsert(stripSeedExists(reviewRulePayload), { onConflict: "rule_code" });
  if (reviewRulesUpsertError) {
    throw new Error(`Failed to upsert coach_review_rules: ${reviewRulesUpsertError.message}`);
  }

  const guardrailCounts = countChange(guardrailPayload);
  const reviewRuleCounts = countChange(reviewRulePayload);

  console.log("[seed-workout-template-guardrails] mode=apply");
  console.log(
    `[seed-workout-template-guardrails] guardrails inserted=${guardrailCounts.inserted} updated=${guardrailCounts.updated}`
  );
  console.log(
    `[seed-workout-template-guardrails] coach_review_rules inserted=${reviewRuleCounts.inserted} updated=${reviewRuleCounts.updated}`
  );
  console.log(
    `[seed-workout-template-guardrails] invariant_checks=${invariantResult.checks.length} invariant_errors=${invariantResult.errors.length}`
  );
  for (const check of invariantResult.checks) {
    console.log(`[seed-workout-template-guardrails] check=PASS ${check}`);
  }
}

async function run(): Promise<void> {
  if (isDryRunMode()) {
    await runPreview();
    return;
  }
  await runApply();
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[seed-workout-template-guardrails] FAIL");
  console.error(message);
  process.exit(1);
});
