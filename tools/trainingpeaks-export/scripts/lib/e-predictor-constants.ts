import { readFileSync } from "node:fs";
import path from "node:path";

import { configRoot } from "./paths.ts";
import type { DistanceKey } from "./race-distance.ts";

export type ConfidenceBand = "high" | "medium" | "medium_low" | "low";

export type EPredictorConstants = {
  schema_version: string;
  default_analysis_weeks: Record<DistanceKey, number>;
  half_marathon: {
    pace_offset_seconds_per_km_by_finish_band: Array<{
      max_finish_seconds: number;
      offset_seconds_per_km: number;
    }>;
    training_implied_anchor: {
      min_weeks_found: number;
      min_usable_threshold_workouts: number;
      preferred_usable_threshold_workouts: number;
      min_long_runs_14k: number;
      min_longest_run_fraction_of_race: number;
      max_confidence_without_race_anchor: ConfidenceBand;
      no_race_anchor_safety_penalty_s_per_km: number;
      durability_penalty_seconds_per_km: {
        cleared: number;
        partial: number;
        weak: number;
      };
    };
    training_implied_anchor_sanity: {
      near_half_distance_km_min: number;
      near_half_distance_km_max: number;
      mild_conflict_faster_pct: number;
      strong_conflict_faster_pct: number;
      block_automatic_likely_faster_pct: number;
      aerobic_blend_likely_max_faster_than_floor_pct: Record<
        "mild" | "strong" | "block",
        number
      >;
      aerobic_blend_optimistic_max_faster_than_floor_pct: Record<
        "mild" | "strong" | "block",
        number
      >;
      cross_distance_race_freshness_days: {
        "5k": number;
        "10k": number;
      };
    };
    sustained_effort: {
      min_duration_seconds: number;
      max_duration_seconds: number;
      promotion_min_duration_seconds: number;
      strong_single_block_min_duration_seconds: number;
      min_half_pace_penalty_sec_per_km: number;
      max_half_pace_penalty_sec_per_km: number;
      default_half_pace_penalty_sec_per_km: number;
      controlled_block_half_pace_penalty_sec_per_km: number;
      shorter_block_half_pace_penalty_sec_per_km: number;
      long_block_half_pace_penalty_sec_per_km: number;
      elevated_hr_threshold_bpm: number;
      high_hr_penalty_threshold_bpm: number;
      elevated_hr_extra_penalty_sec_per_km: number;
      high_hr_extra_penalty_sec_per_km: number;
      fade_extra_penalty_sec_per_km: number;
    };
  };
  range_spread: Record<
    ConfidenceBand,
    {
      conservative_pct: number;
      optimistic_pct: number;
    }
  >;
  long_run_gates: Record<
    DistanceKey,
    {
      min_longest_run_fraction_of_race: number;
      good_long_run_km?: number;
    }
  >;
};

let cachedConstants: EPredictorConstants | null = null;

export function loadEPredictorConstants(): EPredictorConstants {
  if (cachedConstants) return cachedConstants;
  const configPath = path.join(configRoot, "e-predictor-constants.json");
  cachedConstants = JSON.parse(readFileSync(configPath, "utf8")) as EPredictorConstants;
  return cachedConstants;
}

export function defaultAnalysisWeeksForDistance(distance: DistanceKey): number {
  return loadEPredictorConstants().default_analysis_weeks[distance];
}
