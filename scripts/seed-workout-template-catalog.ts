import process from "node:process";

import { assertSupabaseEnvOrSkip, loadScriptEnv } from "./lib/load-script-env";
import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  buildSeedInvariantInput,
  evaluateWorkoutTemplateCatalogInvariants,
  workoutTemplateCatalogSeed,
} from "@/features/trainingpeaks/workout-template-catalog";

type Counts = {
  inserted: number;
  updated: number;
};

type SeedTrackedRow<T> = T & {
  seedExists: boolean;
};

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

async function runPreview(): Promise<void> {
  const invariantResult = evaluateWorkoutTemplateCatalogInvariants(buildSeedInvariantInput());
  console.log("[seed-workout-template-catalog] mode=dry-run");
  console.log(`[seed-workout-template-catalog] families_total=${workoutTemplateCatalogSeed.families.length}`);
  console.log(`[seed-workout-template-catalog] variants_total=${workoutTemplateCatalogSeed.variants.length}`);
  console.log(`[seed-workout-template-catalog] warmup_refs_total=${workoutTemplateCatalogSeed.warmupRefs.length}`);
  console.log(`[seed-workout-template-catalog] cooldown_refs_total=${workoutTemplateCatalogSeed.cooldownRefs.length}`);
  console.log(`[seed-workout-template-catalog] description_refs_total=${workoutTemplateCatalogSeed.descriptionRefs.length}`);
  console.log(`[seed-workout-template-catalog] presets_total=${workoutTemplateCatalogSeed.presets.length}`);
  console.log(
    `[seed-workout-template-catalog] invariant_checks=${invariantResult.checks.length} invariant_errors=${invariantResult.errors.length}`
  );

  for (const check of invariantResult.checks) {
    console.log(`[seed-workout-template-catalog] check=PASS ${check}`);
  }
  for (const error of invariantResult.errors) {
    console.log(`[seed-workout-template-catalog] check=FAIL ${error}`);
  }

  if (!invariantResult.ok) {
    throw new Error("Seed definitions failed invariant validation.");
  }

  console.log("[seed-workout-template-catalog] preview_only=true");
}

async function runApply(): Promise<void> {
  const invariantResult = evaluateWorkoutTemplateCatalogInvariants(buildSeedInvariantInput());
  if (!invariantResult.ok) {
    for (const error of invariantResult.errors) {
      console.log(`[seed-workout-template-catalog] check=FAIL ${error}`);
    }
    throw new Error("Seed definitions failed invariant validation.");
  }

  loadScriptEnv();
  const env = assertSupabaseEnvOrSkip("seed-workout-template-catalog");
  if (!env) {
    return;
  }

  const supabase = createSupabaseServerClient();

  const familyExistingResult = await supabase.from("workout_template_families").select("family_code");
  if (familyExistingResult.error) {
    throw new Error(`Failed to inspect workout_template_families: ${familyExistingResult.error.message}`);
  }
  const familyExisting = new Set((familyExistingResult.data ?? []).map((row) => row.family_code));
  const familyPayload: Array<
    SeedTrackedRow<{
      family_code: string;
      structure_type: string;
      display_name_ru: string;
      is_enabled: boolean;
      sort_order: number;
    }>
  > = workoutTemplateCatalogSeed.families.map((family) => ({
    family_code: family.familyCode,
    structure_type: family.structureType,
    display_name_ru: family.displayNameRu,
    is_enabled: true,
    sort_order: family.sortOrder,
    seedExists: familyExisting.has(family.familyCode),
  }));
  const { error: familyUpsertError } = await supabase.from("workout_template_families").upsert(
    stripSeedExists(familyPayload),
    { onConflict: "family_code" }
  );
  if (familyUpsertError) {
    throw new Error(`Failed to upsert workout_template_families: ${familyUpsertError.message}`);
  }

  const familyRowsResult = await supabase.from("workout_template_families").select("id, family_code");
  if (familyRowsResult.error) {
    throw new Error(`Failed to read workout_template_families after upsert: ${familyRowsResult.error.message}`);
  }
  const familyIdByCode = new Map((familyRowsResult.data ?? []).map((row) => [row.family_code, row.id]));

  const variantExistingResult = await supabase.from("workout_template_variants").select("id, family_id, variant_code");
  if (variantExistingResult.error) {
    throw new Error(`Failed to inspect workout_template_variants: ${variantExistingResult.error.message}`);
  }
  const variantExistingKeys = new Set(
    (variantExistingResult.data ?? []).map((row) => `${row.family_id}:${row.variant_code}`)
  );
  const variantPayload: Array<
    SeedTrackedRow<{
      family_id: string;
      variant_code: string;
      intensity_intent: string;
      display_name_ru: string;
      is_coach_only: boolean;
      is_enabled: boolean;
      notes: string | null;
      sort_order: number;
    }>
  > = workoutTemplateCatalogSeed.variants.map((variant) => {
    const familyId = familyIdByCode.get(variant.familyCode);
    if (!familyId) {
      throw new Error(`Missing family id for variant ${variant.familyCode}/${variant.variantCode}`);
    }
    return {
      family_id: familyId,
      variant_code: variant.variantCode,
      intensity_intent: variant.intensityIntent,
      display_name_ru: variant.displayNameRu,
      is_coach_only: variant.isCoachOnly ?? false,
      is_enabled: true,
      notes: variant.notes ?? null,
      sort_order: variant.sortOrder,
      seedExists: variantExistingKeys.has(`${familyId}:${variant.variantCode}`),
    };
  });
  const { error: variantUpsertError } = await supabase.from("workout_template_variants").upsert(
    stripSeedExists(variantPayload),
    { onConflict: "family_id,variant_code" }
  );
  if (variantUpsertError) {
    throw new Error(`Failed to upsert workout_template_variants: ${variantUpsertError.message}`);
  }

  const variantRowsResult = await supabase.from("workout_template_variants").select("id, family_id, variant_code");
  if (variantRowsResult.error) {
    throw new Error(`Failed to read workout_template_variants after upsert: ${variantRowsResult.error.message}`);
  }
  const variantIdByKey = new Map(
    (variantRowsResult.data ?? []).map((row) => [`${row.family_id}:${row.variant_code}`, row.id])
  );

  const warmupExistingResult = await supabase.from("workout_template_warmup_refs").select("ref_code");
  if (warmupExistingResult.error) {
    throw new Error(`Failed to inspect workout_template_warmup_refs: ${warmupExistingResult.error.message}`);
  }
  const warmupExisting = new Set((warmupExistingResult.data ?? []).map((row) => row.ref_code));
  const warmupPayload: Array<
    SeedTrackedRow<{
      ref_code: string;
      display_name_ru: string;
      duration_min_approx: number | null;
      description_ru: string | null;
      is_enabled: boolean;
    }>
  > = workoutTemplateCatalogSeed.warmupRefs.map((ref) => ({
    ref_code: ref.refCode,
    display_name_ru: ref.displayNameRu,
    duration_min_approx: ref.durationMinApprox ?? null,
    description_ru: ref.descriptionRu ?? null,
    is_enabled: true,
    seedExists: warmupExisting.has(ref.refCode),
  }));
  const { error: warmupUpsertError } = await supabase.from("workout_template_warmup_refs").upsert(
    stripSeedExists(warmupPayload),
    { onConflict: "ref_code" }
  );
  if (warmupUpsertError) {
    throw new Error(`Failed to upsert workout_template_warmup_refs: ${warmupUpsertError.message}`);
  }

  const cooldownExistingResult = await supabase.from("workout_template_cooldown_refs").select("ref_code");
  if (cooldownExistingResult.error) {
    throw new Error(`Failed to inspect workout_template_cooldown_refs: ${cooldownExistingResult.error.message}`);
  }
  const cooldownExisting = new Set((cooldownExistingResult.data ?? []).map((row) => row.ref_code));
  const cooldownPayload: Array<
    SeedTrackedRow<{
      ref_code: string;
      display_name_ru: string;
      duration_min_approx: number | null;
      description_ru: string | null;
      is_enabled: boolean;
    }>
  > = workoutTemplateCatalogSeed.cooldownRefs.map((ref) => ({
    ref_code: ref.refCode,
    display_name_ru: ref.displayNameRu,
    duration_min_approx: ref.durationMinApprox ?? null,
    description_ru: ref.descriptionRu ?? null,
    is_enabled: true,
    seedExists: cooldownExisting.has(ref.refCode),
  }));
  const { error: cooldownUpsertError } = await supabase.from("workout_template_cooldown_refs").upsert(
    stripSeedExists(cooldownPayload),
    { onConflict: "ref_code" }
  );
  if (cooldownUpsertError) {
    throw new Error(`Failed to upsert workout_template_cooldown_refs: ${cooldownUpsertError.message}`);
  }

  const descriptionExistingResult = await supabase.from("workout_template_description_refs").select("ref_code");
  if (descriptionExistingResult.error) {
    throw new Error(
      `Failed to inspect workout_template_description_refs: ${descriptionExistingResult.error.message}`
    );
  }
  const descriptionExisting = new Set((descriptionExistingResult.data ?? []).map((row) => row.ref_code));
  const descriptionPayload: Array<
    SeedTrackedRow<{
      ref_code: string;
      display_name_ru: string;
      description_text_ru: string;
      supports_communication_style: boolean;
      is_draft: boolean;
      is_enabled: boolean;
    }>
  > = workoutTemplateCatalogSeed.descriptionRefs.map((ref) => ({
    ref_code: ref.refCode,
    display_name_ru: ref.displayNameRu,
    description_text_ru: ref.descriptionTextRu,
    supports_communication_style: true,
    is_draft: true,
    is_enabled: true,
    seedExists: descriptionExisting.has(ref.refCode),
  }));
  const { error: descriptionUpsertError } = await supabase.from("workout_template_description_refs").upsert(
    stripSeedExists(descriptionPayload),
    { onConflict: "ref_code" }
  );
  if (descriptionUpsertError) {
    throw new Error(`Failed to upsert workout_template_description_refs: ${descriptionUpsertError.message}`);
  }

  const [warmupRowsResult, cooldownRowsResult, descriptionRowsResult] = await Promise.all([
    supabase.from("workout_template_warmup_refs").select("id, ref_code"),
    supabase.from("workout_template_cooldown_refs").select("id, ref_code"),
    supabase.from("workout_template_description_refs").select("id, ref_code"),
  ]);
  if (warmupRowsResult.error) {
    throw new Error(`Failed to read warmup refs after upsert: ${warmupRowsResult.error.message}`);
  }
  if (cooldownRowsResult.error) {
    throw new Error(`Failed to read cooldown refs after upsert: ${cooldownRowsResult.error.message}`);
  }
  if (descriptionRowsResult.error) {
    throw new Error(`Failed to read description refs after upsert: ${descriptionRowsResult.error.message}`);
  }
  const warmupIdByCode = new Map((warmupRowsResult.data ?? []).map((row) => [row.ref_code, row.id]));
  const cooldownIdByCode = new Map((cooldownRowsResult.data ?? []).map((row) => [row.ref_code, row.id]));
  const descriptionIdByCode = new Map((descriptionRowsResult.data ?? []).map((row) => [row.ref_code, row.id]));

  const presetExistingResult = await supabase.from("workout_template_presets").select("id, preset_code");
  if (presetExistingResult.error) {
    throw new Error(`Failed to inspect workout_template_presets: ${presetExistingResult.error.message}`);
  }
  const presetExistingByCode = new Map((presetExistingResult.data ?? []).map((row) => [row.preset_code, row.id]));

  const presetPayload: Array<
    SeedTrackedRow<{
      variant_id: string;
      preset_code: string;
      source: string;
      tier: string;
      enabled_by_default: boolean;
      coach_only: boolean;
      coach_review_required: boolean;
      requires_explicit_vo2_intensity: boolean;
      athlete_level_min: string | null;
      display_name_ru: string;
      observed_count: number;
      athlete_count: number;
      warmup_ref_id: string | null;
      cooldown_ref_id: string | null;
      description_template_ref_id: string | null;
      is_enabled: boolean;
      sort_order: number;
    }>
  > = workoutTemplateCatalogSeed.presets.map((preset) => {
    const familyId = familyIdByCode.get(preset.familyCode);
    if (!familyId) {
      throw new Error(`Missing family id for preset ${preset.presetCode}`);
    }
    const variantId = variantIdByKey.get(`${familyId}:${preset.variantCode}`);
    if (!variantId) {
      throw new Error(`Missing variant id for preset ${preset.presetCode}`);
    }
    return {
      variant_id: variantId,
      preset_code: preset.presetCode,
      source: preset.source,
      tier: preset.tier,
      enabled_by_default: preset.enabledByDefault ?? true,
      coach_only: preset.coachOnly ?? false,
      coach_review_required: preset.coachReviewRequired ?? true,
      requires_explicit_vo2_intensity: preset.requiresExplicitVo2Intensity ?? false,
      athlete_level_min: preset.athleteLevelMin ?? null,
      display_name_ru: preset.displayNameRu,
      observed_count: preset.observedCount ?? 0,
      athlete_count: preset.athleteCount ?? 0,
      warmup_ref_id: warmupIdByCode.get(preset.warmupRefCode) ?? null,
      cooldown_ref_id: cooldownIdByCode.get(preset.cooldownRefCode) ?? null,
      description_template_ref_id: descriptionIdByCode.get(preset.descriptionRefCode) ?? null,
      is_enabled: true,
      sort_order: preset.sortOrder,
      seedExists: presetExistingByCode.has(preset.presetCode),
    };
  });
  const { error: presetUpsertError } = await supabase.from("workout_template_presets").upsert(
    stripSeedExists(presetPayload),
    { onConflict: "preset_code" }
  );
  if (presetUpsertError) {
    throw new Error(`Failed to upsert workout_template_presets: ${presetUpsertError.message}`);
  }

  const presetRowsResult = await supabase.from("workout_template_presets").select("id, preset_code");
  if (presetRowsResult.error) {
    throw new Error(`Failed to read workout_template_presets after upsert: ${presetRowsResult.error.message}`);
  }
  const presetIdByCode = new Map((presetRowsResult.data ?? []).map((row) => [row.preset_code, row.id]));

  const parameterExistingResult = await supabase.from("workout_template_preset_parameters").select("preset_id");
  if (parameterExistingResult.error) {
    throw new Error(
      `Failed to inspect workout_template_preset_parameters: ${parameterExistingResult.error.message}`
    );
  }
  const parameterExisting = new Set((parameterExistingResult.data ?? []).map((row) => row.preset_id));
  const parameterPayload: Array<
    SeedTrackedRow<{
      preset_id: string;
      reps: number | null;
      work_duration_min: number | null;
      work_duration_sec: number | null;
      work_distance_km: number | null;
      work_unit: string | null;
      distance_unit: string | null;
      recovery_duration_min: number | null;
      recovery_duration_sec: number | null;
      recovery_unit: string | null;
      recovery_type: string | null;
      total_quality_volume_min: number | null;
      rpe_target: number | null;
      rpe_cap: number | null;
      reps_in_reserve: string | null;
      avoid_acidosis: boolean | null;
      target_mode: string;
      pace_hr_hint_mode: string | null;
      nutrition_required: boolean;
      fueling_strategy: string | null;
      run_duration_min: number | null;
      walk_duration_min: number | null;
      extra_params: Record<string, unknown>;
    }>
  > = workoutTemplateCatalogSeed.presets.map((preset) => {
    const presetId = presetIdByCode.get(preset.presetCode);
    if (!presetId) {
      throw new Error(`Missing preset id for parameter row ${preset.presetCode}`);
    }
    return {
      preset_id: presetId,
      reps: preset.parameters.reps ?? null,
      work_duration_min: preset.parameters.workDurationMin ?? null,
      work_duration_sec: preset.parameters.workDurationSec ?? null,
      work_distance_km: preset.parameters.workDistanceKm ?? null,
      work_unit: preset.parameters.workUnit ?? null,
      distance_unit: preset.parameters.distanceUnit ?? null,
      recovery_duration_min: preset.parameters.recoveryDurationMin ?? null,
      recovery_duration_sec: preset.parameters.recoveryDurationSec ?? null,
      recovery_unit: preset.parameters.recoveryUnit ?? null,
      recovery_type: preset.parameters.recoveryType ?? null,
      total_quality_volume_min: preset.parameters.totalQualityVolumeMin ?? null,
      rpe_target: preset.parameters.rpeTarget ?? null,
      rpe_cap: preset.parameters.rpeCap ?? null,
      reps_in_reserve: preset.parameters.repsInReserve ?? null,
      avoid_acidosis: preset.parameters.avoidAcidosis ?? null,
      target_mode: preset.parameters.targetMode ?? "rpe",
      pace_hr_hint_mode: preset.parameters.paceHrHintMode ?? null,
      nutrition_required: preset.parameters.nutritionRequired ?? false,
      fueling_strategy: preset.parameters.fuelingStrategy ?? null,
      run_duration_min: preset.parameters.runDurationMin ?? null,
      walk_duration_min: preset.parameters.walkDurationMin ?? null,
      extra_params: preset.parameters.extraParams ?? {},
      seedExists: parameterExisting.has(presetId),
    };
  });
  const { error: parameterUpsertError } = await supabase.from("workout_template_preset_parameters").upsert(
    stripSeedExists(parameterPayload),
    { onConflict: "preset_id" }
  );
  if (parameterUpsertError) {
    throw new Error(
      `Failed to upsert workout_template_preset_parameters: ${parameterUpsertError.message}`
    );
  }

  console.log("[seed-workout-template-catalog] mode=apply");
  const familyCounts = countChange(familyPayload);
  const variantCounts = countChange(variantPayload);
  const warmupCounts = countChange(warmupPayload);
  const cooldownCounts = countChange(cooldownPayload);
  const descriptionCounts = countChange(descriptionPayload);
  const presetCounts = countChange(presetPayload);
  const parameterCounts = countChange(parameterPayload);
  console.log(
    `[seed-workout-template-catalog] families inserted=${familyCounts.inserted} updated=${familyCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] variants inserted=${variantCounts.inserted} updated=${variantCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] warmup_refs inserted=${warmupCounts.inserted} updated=${warmupCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] cooldown_refs inserted=${cooldownCounts.inserted} updated=${cooldownCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] description_refs inserted=${descriptionCounts.inserted} updated=${descriptionCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] presets inserted=${presetCounts.inserted} updated=${presetCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] preset_parameters inserted=${parameterCounts.inserted} updated=${parameterCounts.updated}`
  );
  console.log(
    `[seed-workout-template-catalog] invariant_checks=${invariantResult.checks.length} invariant_errors=${invariantResult.errors.length}`
  );
  for (const check of invariantResult.checks) {
    console.log(`[seed-workout-template-catalog] check=PASS ${check}`);
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
  console.error("[seed-workout-template-catalog] FAIL");
  console.error(message);
  process.exit(1);
});
