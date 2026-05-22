import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { TrainingImpliedHalfAnchor } from "./e-predictor-training-implied-half.ts";
import { toolRoot } from "./paths.ts";
import {
  DISTANCE_PRESETS,
  type DistanceKey,
} from "./race-distance.ts";
import { VDOT_STYLE_STANDARD_DISTANCES } from "./vdot-style/constants.ts";
import type { VdotStyleCheck } from "./vdot-style/check-report.ts";
import type { VdotStyleTargetPrediction } from "./vdot-style/types.ts";

export const PREDICTION_VALIDATION_SCHEMA_VERSION = "prediction-validation.v1";

export const VALIDATION_LOG_DIR = path.join(
  toolRoot,
  "debug",
  "prediction-validation-log",
);
export const VALIDATION_LOG_PATH = path.join(VALIDATION_LOG_DIR, "predictions.jsonl");

export type PredictionValidationConfidence = "low" | "medium" | "high";

export type PredictionValidationBand = {
  time_seconds: number;
  time_text: string;
  pace_seconds_per_km: number;
  pace_text: string;
};

export type PredictionValidationRecord = {
  schema_version: typeof PREDICTION_VALIDATION_SCHEMA_VERSION;
  created_at: string;
  student_id: string;
  athlete_id: number;
  athlete_name: string;
  race: {
    date: string;
    distance: DistanceKey;
    distance_meters: number;
  };
  prediction: {
    method: string;
    confidence: PredictionValidationConfidence;
    overall_confidence_score: number;
    conservative: PredictionValidationBand;
    likely: PredictionValidationBand;
    optimistic: PredictionValidationBand;
  };
  vdot_style: {
    primary_source: string;
    primary_verdict: string;
    staleness_flagged: boolean;
    secondary_sources_count: number;
    target_distance_prediction: VdotStyleTargetPrediction | null;
  };
  evidence_summary: {
    weeks_found: number;
    weeks_requested: number;
    selected_anchor: {
      kind: string;
      date: string;
      pace_text: string;
      distance_bucket: DistanceKey;
    } | null;
    training_implied_anchor: {
      available: boolean;
      implied_half_time_s: number | null;
      implied_half_pace_s_per_km: number | null;
    } | null;
    usable_segment_key_workouts_count: number;
    sustained_effort_candidates_count: number;
    fit_lap_promoted_count: number;
    main_flags: string[];
  };
  coach_estimate: null;
  actual_result: null;
  post_race_review: null;
  artifacts: {
    report_json: string;
    report_md: string;
  };
};

type PredictionScenarioLike = {
  seconds: number;
  time_text: string;
  pace_text: string;
};

type SelectedAnchorLike = {
  kind: string;
  candidate: {
    date: string;
    pace_text: string;
    distance_bucket: DistanceKey;
  };
};

type SegmentKeyWorkoutLike = {
  usable_for_prediction: boolean;
  sustained_effort_candidate?: { available?: boolean };
  segment_matching?: {
    fit_lap_candidate?: { prediction_eligible?: boolean };
  };
};

export type BuildValidationRecordInput = {
  createdAt: string;
  studentId: string;
  athleteId: number;
  athleteName: string;
  raceDate: string;
  distance: DistanceKey;
  prediction: {
    method: string;
    confidence: PredictionValidationConfidence;
    confidence_score: number;
    conservative: PredictionScenarioLike;
    likely: PredictionScenarioLike;
    optimistic: PredictionScenarioLike;
    insufficient_data?: boolean;
  };
  readinessScores: {
    overall_confidence_score: number;
  };
  vdotStyleCheck: VdotStyleCheck;
  selectedAnchor: SelectedAnchorLike | null;
  trainingImpliedAnchor: TrainingImpliedHalfAnchor | null;
  weeksFound: number;
  weeksRequested: number;
  segmentKeyWorkouts: SegmentKeyWorkoutLike[];
  dataQualityWarnings: string[];
  predictionLimitations: string[];
  reportJsonPath: string;
  reportMdPath: string;
};

function toValidationBand(
  scenario: PredictionScenarioLike,
  distanceKm: number,
): PredictionValidationBand {
  return {
    time_seconds: scenario.seconds,
    time_text: scenario.time_text,
    pace_seconds_per_km: Math.round(scenario.seconds / distanceKm),
    pace_text: scenario.pace_text,
  };
}

function buildMainFlags(input: BuildValidationRecordInput): string[] {
  const flags = new Set<string>([
    ...input.dataQualityWarnings,
    ...input.predictionLimitations,
  ]);
  if (input.prediction.insufficient_data) {
    flags.add("insufficient_data");
  }
  if (input.vdotStyleCheck.staleness.flagged) {
    flags.add(
      input.vdotStyleCheck.staleness.reason
        ? `vdot_staleness:${input.vdotStyleCheck.staleness.reason}`
        : "vdot_staleness",
    );
  }
  return [...flags].sort();
}

export function buildValidationRecord(
  input: BuildValidationRecordInput,
): PredictionValidationRecord {
  const distanceKm = DISTANCE_PRESETS[input.distance].target_km;

  return {
    schema_version: PREDICTION_VALIDATION_SCHEMA_VERSION,
    created_at: input.createdAt,
    student_id: input.studentId,
    athlete_id: input.athleteId,
    athlete_name: input.athleteName,
    race: {
      date: input.raceDate,
      distance: input.distance,
      distance_meters: VDOT_STYLE_STANDARD_DISTANCES[input.distance],
    },
    prediction: {
      method: input.prediction.method,
      confidence: input.prediction.confidence,
      overall_confidence_score: input.readinessScores.overall_confidence_score,
      conservative: toValidationBand(input.prediction.conservative, distanceKm),
      likely: toValidationBand(input.prediction.likely, distanceKm),
      optimistic: toValidationBand(input.prediction.optimistic, distanceKm),
    },
    vdot_style: {
      primary_source: input.vdotStyleCheck.source,
      primary_verdict:
        input.vdotStyleCheck.comparison_to_e_predictor?.verdict ?? "no_anchor",
      staleness_flagged: input.vdotStyleCheck.staleness.flagged,
      secondary_sources_count: input.vdotStyleCheck.secondary_sources.length,
      target_distance_prediction: input.vdotStyleCheck.target_distance_prediction,
    },
    evidence_summary: {
      weeks_found: input.weeksFound,
      weeks_requested: input.weeksRequested,
      selected_anchor: input.selectedAnchor
        ? {
            kind: input.selectedAnchor.kind,
            date: input.selectedAnchor.candidate.date,
            pace_text: input.selectedAnchor.candidate.pace_text,
            distance_bucket: input.selectedAnchor.candidate.distance_bucket,
          }
        : null,
      training_implied_anchor: input.trainingImpliedAnchor
        ? {
            available: input.trainingImpliedAnchor.available,
            implied_half_time_s: input.trainingImpliedAnchor.implied_half_time_s,
            implied_half_pace_s_per_km:
              input.trainingImpliedAnchor.implied_half_pace_s_per_km,
          }
        : null,
      usable_segment_key_workouts_count: input.segmentKeyWorkouts.filter(
        (workout) => workout.usable_for_prediction,
      ).length,
      sustained_effort_candidates_count: input.segmentKeyWorkouts.filter(
        (workout) => workout.sustained_effort_candidate?.available === true,
      ).length,
      fit_lap_promoted_count: input.segmentKeyWorkouts.filter(
        (workout) =>
          workout.segment_matching?.fit_lap_candidate?.prediction_eligible === true,
      ).length,
      main_flags: buildMainFlags(input),
    },
    coach_estimate: null,
    actual_result: null,
    post_race_review: null,
    artifacts: {
      report_json: input.reportJsonPath,
      report_md: input.reportMdPath,
    },
  };
}

export async function appendValidationRecord(
  record: PredictionValidationRecord,
): Promise<string> {
  await mkdir(VALIDATION_LOG_DIR, { recursive: true });
  await appendFile(VALIDATION_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
  return VALIDATION_LOG_PATH;
}
