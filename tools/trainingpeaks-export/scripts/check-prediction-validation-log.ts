import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

import {
  PREDICTION_VALIDATION_SCHEMA_VERSION,
  VALIDATION_LOG_PATH,
  type PredictionValidationConfidence,
  type PredictionValidationRecord,
} from "./lib/prediction-validation-log.ts";
import { ALL_DISTANCE_KEYS } from "./lib/race-distance.ts";

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

function expectString(value: unknown, label: string): string {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string.`);
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

function expectNullable(value: unknown, label: string): null {
  assert(value === null, `${label} must be null.`);
  return null;
}

function expectConfidence(value: unknown, label: string): PredictionValidationConfidence {
  assert(
    value === "low" || value === "medium" || value === "high",
    `${label} must be low, medium, or high.`,
  );
  return value;
}

function expectDistance(value: unknown, label: string): string {
  const distance = expectString(value, label);
  assert(
    (ALL_DISTANCE_KEYS as readonly string[]).includes(distance),
    `${label} must be one of: ${ALL_DISTANCE_KEYS.join(", ")}.`,
  );
  return distance;
}

function validateBand(value: unknown, label: string): void {
  const band = expectRecord(value, label);
  expectNumber(band.time_seconds, `${label}.time_seconds`);
  expectString(band.time_text, `${label}.time_text`);
  expectNumber(band.pace_seconds_per_km, `${label}.pace_seconds_per_km`);
  expectString(band.pace_text, `${label}.pace_text`);
}

function validateRecord(raw: unknown, lineNumber: number): PredictionValidationRecord {
  const record = expectRecord(raw, `line ${lineNumber}`);
  const prefix = `line ${lineNumber}`;

  assert(
    record.schema_version === PREDICTION_VALIDATION_SCHEMA_VERSION,
    `${prefix}: schema_version must be ${PREDICTION_VALIDATION_SCHEMA_VERSION}.`,
  );
  expectString(record.created_at, `${prefix}.created_at`);
  expectString(record.student_id, `${prefix}.student_id`);
  expectNumber(record.athlete_id, `${prefix}.athlete_id`);
  expectString(record.athlete_name, `${prefix}.athlete_name`);

  const race = expectRecord(record.race, `${prefix}.race`);
  expectString(race.date, `${prefix}.race.date`);
  expectDistance(race.distance, `${prefix}.race.distance`);
  expectNumber(race.distance_meters, `${prefix}.race.distance_meters`);

  const prediction = expectRecord(record.prediction, `${prefix}.prediction`);
  expectString(prediction.method, `${prefix}.prediction.method`);
  expectConfidence(prediction.confidence, `${prefix}.prediction.confidence`);
  expectNumber(prediction.overall_confidence_score, `${prefix}.prediction.overall_confidence_score`);
  validateBand(prediction.conservative, `${prefix}.prediction.conservative`);
  validateBand(prediction.likely, `${prefix}.prediction.likely`);
  validateBand(prediction.optimistic, `${prefix}.prediction.optimistic`);

  const vdotStyle = expectRecord(record.vdot_style, `${prefix}.vdot_style`);
  expectString(vdotStyle.primary_source, `${prefix}.vdot_style.primary_source`);
  expectString(vdotStyle.primary_verdict, `${prefix}.vdot_style.primary_verdict`);
  expectBoolean(vdotStyle.staleness_flagged, `${prefix}.vdot_style.staleness_flagged`);
  expectNumber(vdotStyle.secondary_sources_count, `${prefix}.vdot_style.secondary_sources_count`);
  if (vdotStyle.target_distance_prediction !== null) {
    const targetPrediction = expectRecord(
      vdotStyle.target_distance_prediction,
      `${prefix}.vdot_style.target_distance_prediction`,
    );
    expectDistance(targetPrediction.distance, `${prefix}.vdot_style.target_distance_prediction.distance`);
    expectNumber(
      targetPrediction.time_seconds,
      `${prefix}.vdot_style.target_distance_prediction.time_seconds`,
    );
    expectNumber(
      targetPrediction.pace_seconds_per_km,
      `${prefix}.vdot_style.target_distance_prediction.pace_seconds_per_km`,
    );
  }

  const evidenceSummary = expectRecord(record.evidence_summary, `${prefix}.evidence_summary`);
  expectNumber(evidenceSummary.weeks_found, `${prefix}.evidence_summary.weeks_found`);
  expectNumber(evidenceSummary.weeks_requested, `${prefix}.evidence_summary.weeks_requested`);
  if (evidenceSummary.selected_anchor !== null) {
    const selectedAnchor = expectRecord(
      evidenceSummary.selected_anchor,
      `${prefix}.evidence_summary.selected_anchor`,
    );
    expectString(selectedAnchor.kind, `${prefix}.evidence_summary.selected_anchor.kind`);
    expectString(selectedAnchor.date, `${prefix}.evidence_summary.selected_anchor.date`);
    expectString(selectedAnchor.pace_text, `${prefix}.evidence_summary.selected_anchor.pace_text`);
    expectDistance(
      selectedAnchor.distance_bucket,
      `${prefix}.evidence_summary.selected_anchor.distance_bucket`,
    );
  }
  if (evidenceSummary.training_implied_anchor !== null) {
    const trainingImpliedAnchor = expectRecord(
      evidenceSummary.training_implied_anchor,
      `${prefix}.evidence_summary.training_implied_anchor`,
    );
    expectBoolean(
      trainingImpliedAnchor.available,
      `${prefix}.evidence_summary.training_implied_anchor.available`,
    );
    if (trainingImpliedAnchor.implied_half_time_s !== null) {
      expectNumber(
        trainingImpliedAnchor.implied_half_time_s,
        `${prefix}.evidence_summary.training_implied_anchor.implied_half_time_s`,
      );
    }
    if (trainingImpliedAnchor.implied_half_pace_s_per_km !== null) {
      expectNumber(
        trainingImpliedAnchor.implied_half_pace_s_per_km,
        `${prefix}.evidence_summary.training_implied_anchor.implied_half_pace_s_per_km`,
      );
    }
  }
  expectNumber(
    evidenceSummary.usable_segment_key_workouts_count,
    `${prefix}.evidence_summary.usable_segment_key_workouts_count`,
  );
  expectNumber(
    evidenceSummary.sustained_effort_candidates_count,
    `${prefix}.evidence_summary.sustained_effort_candidates_count`,
  );
  expectNumber(
    evidenceSummary.fit_lap_promoted_count,
    `${prefix}.evidence_summary.fit_lap_promoted_count`,
  );
  assert(Array.isArray(evidenceSummary.main_flags), `${prefix}.evidence_summary.main_flags must be an array.`);

  expectNullable(record.coach_estimate, `${prefix}.coach_estimate`);
  expectNullable(record.actual_result, `${prefix}.actual_result`);
  expectNullable(record.post_race_review, `${prefix}.post_race_review`);

  const artifacts = expectRecord(record.artifacts, `${prefix}.artifacts`);
  expectString(artifacts.report_json, `${prefix}.artifacts.report_json`);
  expectString(artifacts.report_md, `${prefix}.artifacts.report_md`);

  return record as PredictionValidationRecord;
}

function main(): void {
  if (!existsSync(VALIDATION_LOG_PATH)) {
    console.log(`[check-prediction-validation-log] No log file at ${VALIDATION_LOG_PATH}`);
    console.log("records: 0");
    return;
  }

  const content = readFileSync(VALIDATION_LOG_PATH, "utf8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const byDistance = new Map<string, number>();
  const byConfidence = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`line ${lineNumber}: invalid JSON (${message}).`);
    }

    const record = validateRecord(parsed, lineNumber);
    byDistance.set(record.race.distance, (byDistance.get(record.race.distance) ?? 0) + 1);
    byConfidence.set(
      record.prediction.confidence,
      (byConfidence.get(record.prediction.confidence) ?? 0) + 1,
    );
  }

  console.log(`[check-prediction-validation-log] Validated ${lines.length} record(s).`);
  console.log(`log_path: ${VALIDATION_LOG_PATH}`);
  console.log(`records: ${lines.length}`);
  console.log("by_distance:");
  for (const distance of ALL_DISTANCE_KEYS) {
    console.log(`  ${distance}: ${byDistance.get(distance) ?? 0}`);
  }
  console.log("by_confidence:");
  for (const confidence of ["low", "medium", "high"] as const) {
    console.log(`  ${confidence}: ${byConfidence.get(confidence) ?? 0}`);
  }
}

try {
  main();
} catch (error) {
  console.error("check-prediction-validation-log failed.");
  console.error(error);
  process.exit(1);
}
