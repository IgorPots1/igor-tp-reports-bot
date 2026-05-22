import type { DistanceKey } from "../race-distance.ts";
import type { VdotStyleDistanceKey } from "./constants.ts";

export type VdotStyleSource =
  | "official_best"
  | "probable_best"
  | "clean_training_best"
  | "training_implied_anchor"
  | "none";

export type VdotStyleSourceQuality = "high" | "medium" | "low" | "stale" | "none";

export type VdotStyleVerdict = "agree" | "mild_disagree" | "strong_disagree" | "no_anchor";

export type VdotStyleAnchor = {
  distance: VdotStyleDistanceKey;
  date: string | null;
  time_seconds: number;
  pace_seconds_per_km: number;
  label: string;
};

export type VdotStyleRaceTime = {
  time_seconds: number;
  pace_seconds_per_km: number;
};

export type VdotStyleEquivalentRaceTimes = Record<VdotStyleDistanceKey, VdotStyleRaceTime>;

export type VdotStyleComparison = {
  e_predictor_likely_time_seconds: number;
  e_predictor_likely_pace_seconds_per_km: number;
  vdot_style_time_seconds: number;
  vdot_style_pace_seconds_per_km: number;
  disagreement_sec_per_km: number;
  disagreement_pct: number;
  verdict: VdotStyleVerdict;
};

export type VdotStyleTargetPrediction = {
  distance: DistanceKey;
  time_seconds: number;
  pace_seconds_per_km: number;
};
