import { assertSupabaseEnvOrSkip, loadScriptEnv } from "./lib/load-script-env";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { evaluateWorkoutTemplateCatalogInvariants } from "@/features/trainingpeaks/workout-template-catalog";

type GuardrailRow = {
  rule_code: string;
  severity: "hard_block" | "soft_warning" | "coach_review";
  applies_to_preset_codes: string[] | null;
  is_code_constant: boolean;
};

type ReviewRuleRow = {
  rule_code: string;
  threshold_value: number | null;
};

type FamilyRow = {
  family_code: string;
};

type RefRow = {
  ref_code: string;
};

type PresetRow = {
  preset_code: string;
  source: string;
  enabled_by_default: boolean;
  coach_only: boolean;
  coach_review_required: boolean;
  requires_explicit_vo2_intensity: boolean;
  athlete_level_min: string | null;
  observed_count: number;
  workout_template_variants:
    | {
        variant_code: string;
        intensity_intent: string;
        workout_template_families:
          | {
              family_code: string;
            }
          | Array<{ family_code: string }>
          | null;
      }
    | Array<{
        variant_code: string;
        intensity_intent: string;
        workout_template_families:
          | {
              family_code: string;
            }
          | Array<{ family_code: string }>
          | null;
      }>
    | null;
  workout_template_preset_parameters:
    | {
        work_distance_km: number | null;
        distance_unit: string | null;
        target_mode: string;
      }
    | Array<{
        work_distance_km: number | null;
        distance_unit: string | null;
        target_mode: string;
      }>
    | null;
};

const REQUIRED_GUARDRAILS = [
  "no_beginner_vo2",
  "hr_chest_only",
  "no_hard_stack",
  "warmup_required_for_quality",
  "quality_requires_coach_review",
  "threshold_numbers_not_vo2_default",
  "injury_or_acute_pain_blocks_intensity",
  "insufficient_data_blocks_generation",
] as const;

const REQUIRED_REVIEW_RULES = [
  "weekly_minutes_plus_10pct",
  "long_run_plus_15min",
  "extra_run_session",
  "extra_quality_session",
  "any_marathon_specific_long",
  "any_vo2_session",
  "any_race_specific_key",
  "pilot_any_deviation",
] as const;

const REQUIRED_THRESHOLD_PRESET_CODES = [
  "thr_5x4",
  "thr_4x5",
  "thr_8x4",
  "thr_6x5",
  "thr_6x6",
  "thr_4x9",
  "thr_5x7",
] as const;

const CRITICAL_HARD_BLOCK_CODES = [
  "no_beginner_vo2",
  "hr_chest_only",
  "no_hard_stack",
  "warmup_required_for_quality",
  "threshold_numbers_not_vo2_default",
  "injury_or_acute_pain_blocks_intensity",
  "insufficient_data_blocks_generation",
] as const;

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function runCheck(checks: string[], errors: string[], condition: boolean, passMessage: string, failMessage: string): void {
  if (condition) {
    checks.push(passMessage);
  } else {
    errors.push(failMessage);
  }
}

async function run(): Promise<void> {
  loadScriptEnv();
  const env = assertSupabaseEnvOrSkip("check-workout-template-guardrails");
  if (!env) {
    return;
  }

  const supabase = createSupabaseServerClient();

  const [guardrailsResult, reviewRulesResult] = await Promise.all([
    supabase
      .from("workout_template_guardrails")
      .select("rule_code, severity, applies_to_preset_codes, is_code_constant"),
    supabase.from("coach_review_rules").select("rule_code, threshold_value"),
  ]);

  if (guardrailsResult.error) {
    throw new Error(`Failed to read workout_template_guardrails: ${guardrailsResult.error.message}`);
  }
  if (reviewRulesResult.error) {
    throw new Error(`Failed to read coach_review_rules: ${reviewRulesResult.error.message}`);
  }

  const guardrails = (guardrailsResult.data ?? []) as GuardrailRow[];
  const reviewRules = (reviewRulesResult.data ?? []) as ReviewRuleRow[];

  const checks: string[] = [];
  const errors: string[] = [];

  runCheck(
    checks,
    errors,
    guardrails.length > 0,
    "workout_template_guardrails table exists with seeded rows.",
    "workout_template_guardrails table has no rows."
  );
  runCheck(
    checks,
    errors,
    reviewRules.length > 0,
    "coach_review_rules table exists with seeded rows.",
    "coach_review_rules table has no rows."
  );

  const guardrailByCode = new Map(guardrails.map((row) => [row.rule_code, row]));
  const reviewRuleByCode = new Map(reviewRules.map((row) => [row.rule_code, row]));

  for (const code of REQUIRED_GUARDRAILS) {
    runCheck(
      checks,
      errors,
      guardrailByCode.has(code),
      `Required guardrail exists: ${code}`,
      `Missing required guardrail: ${code}`
    );
  }

  for (const code of REQUIRED_REVIEW_RULES) {
    runCheck(
      checks,
      errors,
      reviewRuleByCode.has(code),
      `Required coach review rule exists: ${code}`,
      `Missing required coach review rule: ${code}`
    );
  }

  const thresholdGuardrail = guardrailByCode.get("threshold_numbers_not_vo2_default");
  const thresholdCodes = new Set(thresholdGuardrail?.applies_to_preset_codes ?? []);
  const missingThresholdPresetCodes = REQUIRED_THRESHOLD_PRESET_CODES.filter((code) => !thresholdCodes.has(code));
  runCheck(
    checks,
    errors,
    missingThresholdPresetCodes.length === 0,
    "threshold_numbers_not_vo2_default contains all required threshold preset codes.",
    `threshold_numbers_not_vo2_default missing preset codes: ${missingThresholdPresetCodes.join(", ")}`
  );

  const notConstantCritical = CRITICAL_HARD_BLOCK_CODES.filter((code) => {
    const row = guardrailByCode.get(code);
    return !row || row.severity !== "hard_block" || row.is_code_constant !== true;
  });
  runCheck(
    checks,
    errors,
    notConstantCritical.length === 0,
    "Critical hard guardrails remain code-constant.",
    `Critical hard guardrails must be hard_block + is_code_constant=true: ${notConstantCritical.join(", ")}`
  );

  runCheck(
    checks,
    errors,
    reviewRuleByCode.get("weekly_minutes_plus_10pct")?.threshold_value === 10,
    "weekly_minutes_plus_10pct threshold_value is 10.",
    "weekly_minutes_plus_10pct threshold_value must be 10."
  );
  runCheck(
    checks,
    errors,
    reviewRuleByCode.get("long_run_plus_15min")?.threshold_value === 15,
    "long_run_plus_15min threshold_value is 15.",
    "long_run_plus_15min threshold_value must be 15."
  );
  runCheck(
    checks,
    errors,
    guardrailByCode.has("quality_requires_coach_review"),
    "quality_requires_coach_review guardrail exists.",
    "quality_requires_coach_review guardrail is missing."
  );

  const [familiesResult, warmupsResult, cooldownsResult, presetsResult] = await Promise.all([
    supabase.from("workout_template_families").select("family_code"),
    supabase.from("workout_template_warmup_refs").select("ref_code"),
    supabase.from("workout_template_cooldown_refs").select("ref_code"),
    supabase
      .from("workout_template_presets")
      .select(
        "preset_code, source, enabled_by_default, coach_only, coach_review_required, requires_explicit_vo2_intensity, athlete_level_min, observed_count, workout_template_variants(variant_code, intensity_intent, workout_template_families(family_code)), workout_template_preset_parameters(work_distance_km, distance_unit, target_mode)"
      ),
  ]);

  if (familiesResult.error) {
    throw new Error(`Failed to read workout_template_families: ${familiesResult.error.message}`);
  }
  if (warmupsResult.error) {
    throw new Error(`Failed to read workout_template_warmup_refs: ${warmupsResult.error.message}`);
  }
  if (cooldownsResult.error) {
    throw new Error(`Failed to read workout_template_cooldown_refs: ${cooldownsResult.error.message}`);
  }
  if (presetsResult.error) {
    throw new Error(`Failed to read workout_template_presets: ${presetsResult.error.message}`);
  }

  const catalogInvariantInput = {
    familyCodes: ((familiesResult.data ?? []) as FamilyRow[]).map((row) => row.family_code),
    warmupRefCodes: ((warmupsResult.data ?? []) as RefRow[]).map((row) => row.ref_code),
    cooldownRefCodes: ((cooldownsResult.data ?? []) as RefRow[]).map((row) => row.ref_code),
    presets: ((presetsResult.data ?? []) as PresetRow[]).map((row) => {
      const variant = unwrapSingle(row.workout_template_variants);
      const family = unwrapSingle(variant?.workout_template_families);
      const parameters = unwrapSingle(row.workout_template_preset_parameters);
      return {
        presetCode: row.preset_code,
        familyCode: family?.family_code ?? "unknown",
        variantCode: variant?.variant_code ?? "unknown",
        intensityIntent: variant?.intensity_intent ?? "unknown",
        source: row.source,
        enabledByDefault: row.enabled_by_default,
        coachOnly: row.coach_only,
        coachReviewRequired: row.coach_review_required,
        requiresExplicitVo2Intensity: row.requires_explicit_vo2_intensity,
        athleteLevelMin: row.athlete_level_min,
        observedCount: row.observed_count,
        workDistanceKm: parameters?.work_distance_km ?? null,
        distanceUnit: parameters?.distance_unit ?? null,
        targetMode: parameters?.target_mode ?? "unknown",
      };
    }),
  };

  const catalogInvariantResult = evaluateWorkoutTemplateCatalogInvariants(catalogInvariantInput);
  runCheck(
    checks,
    errors,
    catalogInvariantResult.ok,
    "Workout template catalog invariants still pass.",
    `Catalog invariants failed: ${catalogInvariantResult.errors.join(" | ")}`
  );

  for (const check of checks) {
    console.log(`[check-workout-template-guardrails] PASS: ${check}`);
  }
  for (const error of errors) {
    console.log(`[check-workout-template-guardrails] FAIL: ${error}`);
  }

  if (errors.length > 0) {
    throw new Error("Workout template guardrail checks failed.");
  }

  console.log(
    `[check-workout-template-guardrails] PASS checks=${checks.length} guardrails=${guardrails.length} review_rules=${reviewRules.length}`
  );
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[check-workout-template-guardrails] FAIL");
  console.error(message);
  process.exit(1);
});
