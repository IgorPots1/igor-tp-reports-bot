import { assertSupabaseEnvOrSkip, loadScriptEnv } from "./lib/load-script-env";
import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  evaluateWorkoutTemplateCatalogInvariants,
  type WorkoutTemplateCatalogInvariantInput,
  type WorkoutTemplateCatalogPresetRecord,
} from "@/features/trainingpeaks/workout-template-catalog";

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

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function mapPresetRows(rows: PresetRow[]): WorkoutTemplateCatalogPresetRecord[] {
  return rows.map((row) => {
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
  });
}

async function run(): Promise<void> {
  loadScriptEnv();
  const env = assertSupabaseEnvOrSkip("check-workout-template-catalog");
  if (!env) {
    return;
  }

  const supabase = createSupabaseServerClient();
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

  const input: WorkoutTemplateCatalogInvariantInput = {
    familyCodes: ((familiesResult.data ?? []) as FamilyRow[]).map((row) => row.family_code),
    warmupRefCodes: ((warmupsResult.data ?? []) as RefRow[]).map((row) => row.ref_code),
    cooldownRefCodes: ((cooldownsResult.data ?? []) as RefRow[]).map((row) => row.ref_code),
    presets: mapPresetRows((presetsResult.data ?? []) as PresetRow[]),
  };

  const result = evaluateWorkoutTemplateCatalogInvariants(input);
  for (const check of result.checks) {
    console.log(`[check-workout-template-catalog] PASS: ${check}`);
  }
  for (const error of result.errors) {
    console.log(`[check-workout-template-catalog] FAIL: ${error}`);
  }

  if (!result.ok) {
    throw new Error("Workout template catalog invariants failed.");
  }

  console.log("[check-workout-template-catalog] PASS");
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[check-workout-template-catalog] FAIL");
  console.error(message);
  process.exit(1);
});
