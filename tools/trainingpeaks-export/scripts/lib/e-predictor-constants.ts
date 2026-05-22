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
