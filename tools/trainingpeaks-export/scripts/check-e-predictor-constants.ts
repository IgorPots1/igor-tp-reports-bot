import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { configRoot } from "./lib/paths.ts";

const REQUIRED_DISTANCES = ["5k", "10k", "half", "marathon"] as const;
const REQUIRED_RANGE_SPREAD_LEVELS = ["high", "medium", "medium_low", "low"] as const;
const REQUIRED_TOP_LEVEL_KEYS = [
  "schema_version",
  "riegel",
  "freshness_windows_days",
  "default_analysis_weeks",
  "half_marathon",
  "distance_layer_weights",
  "range_spread",
  "refusal_thresholds",
  "long_run_gates",
  "segment_quality",
] as const;

const WEIGHT_SUM_TOLERANCE = 0.001;

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): JsonRecord {
  assert(isRecord(value), `${label} must be an object.`);
  return value;
}

function expectNumber(value: unknown, label: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be a finite number.`);
  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  assert(typeof value === "boolean", `${label} must be a boolean.`);
  return value;
}

function expectString(value: unknown, label: string): string {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string.`);
  return value;
}

function validateTopLevelKeys(config: JsonRecord): void {
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    assert(key in config, `Missing required top-level key: ${key}`);
  }
}

function validateRiegel(riegel: unknown): void {
  const section = expectRecord(riegel, "riegel");
  expectNumber(section.default_exponent, "riegel.default_exponent");
  expectRecord(section.distance_pair_overrides, "riegel.distance_pair_overrides");
}

function validateFreshnessWindows(freshness: unknown): void {
  const section = expectRecord(freshness, "freshness_windows_days");
  for (const distance of REQUIRED_DISTANCES) {
    expectNumber(section[distance], `freshness_windows_days.${distance}`);
  }
}

function validateDefaultAnalysisWeeks(weeks: unknown): void {
  const section = expectRecord(weeks, "default_analysis_weeks");
  for (const distance of REQUIRED_DISTANCES) {
    const value = expectNumber(section[distance], `default_analysis_weeks.${distance}`);
    assert(Number.isInteger(value) && value > 0, `default_analysis_weeks.${distance} must be a positive integer.`);
  }
}

function validateHalfMarathon(halfMarathon: unknown): void {
  const section = expectRecord(halfMarathon, "half_marathon");
  const bands = section.pace_offset_seconds_per_km_by_finish_band;
  assert(Array.isArray(bands) && bands.length > 0, "half_marathon.pace_offset_seconds_per_km_by_finish_band must be a non-empty array.");

  let previousMaxFinish = -1;
  for (const [index, band] of bands.entries()) {
    const row = expectRecord(band, `half_marathon.pace_offset_seconds_per_km_by_finish_band[${index}]`);
    const maxFinish = expectNumber(row.max_finish_seconds, `half_marathon.pace_offset_seconds_per_km_by_finish_band[${index}].max_finish_seconds`);
    expectNumber(row.offset_seconds_per_km, `half_marathon.pace_offset_seconds_per_km_by_finish_band[${index}].offset_seconds_per_km`);
    assert(maxFinish > previousMaxFinish, "half_marathon pace bands must be sorted by increasing max_finish_seconds.");
    previousMaxFinish = maxFinish;
  }

  const trainingImplied = expectRecord(section.training_implied_anchor, "half_marathon.training_implied_anchor");
  expectNumber(trainingImplied.min_weeks_found, "half_marathon.training_implied_anchor.min_weeks_found");
  expectNumber(trainingImplied.min_usable_threshold_workouts, "half_marathon.training_implied_anchor.min_usable_threshold_workouts");
  expectNumber(trainingImplied.preferred_usable_threshold_workouts, "half_marathon.training_implied_anchor.preferred_usable_threshold_workouts");
  expectNumber(trainingImplied.min_long_runs_14k, "half_marathon.training_implied_anchor.min_long_runs_14k");
  expectNumber(trainingImplied.min_longest_run_fraction_of_race, "half_marathon.training_implied_anchor.min_longest_run_fraction_of_race");
  expectString(trainingImplied.max_confidence_without_race_anchor, "half_marathon.training_implied_anchor.max_confidence_without_race_anchor");
  expectNumber(
    trainingImplied.no_race_anchor_safety_penalty_s_per_km,
    "half_marathon.training_implied_anchor.no_race_anchor_safety_penalty_s_per_km",
  );

  const durability = expectRecord(
    trainingImplied.durability_penalty_seconds_per_km,
    "half_marathon.training_implied_anchor.durability_penalty_seconds_per_km",
  );
  for (const key of ["cleared", "partial", "weak"] as const) {
    expectNumber(durability[key], `half_marathon.training_implied_anchor.durability_penalty_seconds_per_km.${key}`);
  }
}

function validateDistanceLayerWeights(weights: unknown): void {
  const section = expectRecord(weights, "distance_layer_weights");
  for (const distance of REQUIRED_DISTANCES) {
    const row = expectRecord(section[distance], `distance_layer_weights.${distance}`);
    const values = Object.values(row);
    assert(values.length > 0, `distance_layer_weights.${distance} must not be empty.`);
    let sum = 0;
    for (const [key, value] of Object.entries(row)) {
      sum += expectNumber(value, `distance_layer_weights.${distance}.${key}`);
    }
    assert(
      Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE,
      `distance_layer_weights.${distance} must sum to ~1.0 (got ${sum.toFixed(4)}).`,
    );
  }
}

function validateRangeSpread(rangeSpread: unknown): void {
  const section = expectRecord(rangeSpread, "range_spread");
  for (const level of REQUIRED_RANGE_SPREAD_LEVELS) {
    const row = expectRecord(section[level], `range_spread.${level}`);
    const conservative = expectNumber(row.conservative_pct, `range_spread.${level}.conservative_pct`);
    const optimistic = expectNumber(row.optimistic_pct, `range_spread.${level}.optimistic_pct`);
    assert(conservative > 0, `range_spread.${level}.conservative_pct must be > 0.`);
    assert(optimistic > 0, `range_spread.${level}.optimistic_pct must be > 0.`);
  }
}

function validateRefusalThresholds(refusal: unknown): void {
  const section = expectRecord(refusal, "refusal_thresholds");
  expectNumber(section.min_data_quality_score, "refusal_thresholds.min_data_quality_score");
  expectNumber(section.min_weeks_found, "refusal_thresholds.min_weeks_found");
  expectBoolean(section.require_anchor_or_training_implied_anchor, "refusal_thresholds.require_anchor_or_training_implied_anchor");
}

function validateLongRunGates(gates: unknown): void {
  const section = expectRecord(gates, "long_run_gates");
  for (const distance of REQUIRED_DISTANCES) {
    const row = expectRecord(section[distance], `long_run_gates.${distance}`);
    expectNumber(row.min_longest_run_fraction_of_race, `long_run_gates.${distance}.min_longest_run_fraction_of_race`);
    if ("good_long_run_km" in row) {
      expectNumber(row.good_long_run_km, `long_run_gates.${distance}.good_long_run_km`);
    }
  }
}

function validateSegmentQuality(segmentQuality: unknown): void {
  const section = expectRecord(segmentQuality, "segment_quality");
  expectNumber(section.warning_completion_ratio_below, "segment_quality.warning_completion_ratio_below");
  expectNumber(section.warning_pace_spread_pct_above, "segment_quality.warning_pace_spread_pct_above");
  expectNumber(section.warning_any_rep_slower_than_fastest_pct_above, "segment_quality.warning_any_rep_slower_than_fastest_pct_above");
  expectNumber(section.warning_fade_pct_above, "segment_quality.warning_fade_pct_above");
}

function run(): void {
  const configPath = path.join(configRoot, "e-predictor-constants.json");
  const raw = readFileSync(configPath, "utf8");
  const config = JSON.parse(raw) as JsonRecord;

  validateTopLevelKeys(config);
  expectString(config.schema_version, "schema_version");
  validateRiegel(config.riegel);
  validateFreshnessWindows(config.freshness_windows_days);
  validateDefaultAnalysisWeeks(config.default_analysis_weeks);
  validateHalfMarathon(config.half_marathon);
  validateDistanceLayerWeights(config.distance_layer_weights);
  validateRangeSpread(config.range_spread);
  validateRefusalThresholds(config.refusal_thresholds);
  validateLongRunGates(config.long_run_gates);
  validateSegmentQuality(config.segment_quality);

  console.log("[check-e-predictor-constants] OK");
  console.log(`schema_version=${config.schema_version}`);
  console.log(`config=${configPath}`);
  console.log(`distances=${REQUIRED_DISTANCES.join(",")}`);
  console.log(`range_levels=${REQUIRED_RANGE_SPREAD_LEVELS.join(",")}`);
}

try {
  run();
} catch (error) {
  console.error("[check-e-predictor-constants] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
