import { equivalentRaceTimes, type EquivalentRaceTimeOptions } from "./equivalency.ts";
import {
  VDOT_STYLE_TEN_K_PACE_MULTIPLIERS,
  type VdotStyleZoneName,
} from "./constants.ts";

export type TrainingZoneRange = {
  min_pace_sec_per_km: number;
  max_pace_sec_per_km: number;
};

export type TrainingZones = Record<VdotStyleZoneName, TrainingZoneRange>;

export type TrainingZonesFromAnchorResult = {
  source_equivalent_10k_pace_sec_per_km: number;
  zones: TrainingZones;
};

function roundPaceSeconds(value: number): number {
  return Math.round(value);
}

function normalizeRange(a: number, b: number): TrainingZoneRange {
  return {
    min_pace_sec_per_km: Math.min(a, b),
    max_pace_sec_per_km: Math.max(a, b),
  };
}

export function trainingZonesFromAnchor(
  anchorDistanceMeters: number,
  anchorTimeSeconds: number,
  options: EquivalentRaceTimeOptions = {},
): TrainingZonesFromAnchorResult {
  const tenKPaceSecondsPerKm =
    equivalentRaceTimes(anchorDistanceMeters, anchorTimeSeconds, options)["10k"]
      .pace_seconds_per_km;

  const zones = {} as TrainingZones;

  for (const [zoneName, multipliers] of Object.entries(VDOT_STYLE_TEN_K_PACE_MULTIPLIERS)) {
    const fasterPace = roundPaceSeconds(tenKPaceSecondsPerKm * multipliers.min_pct);
    const slowerPace = roundPaceSeconds(tenKPaceSecondsPerKm * multipliers.max_pct);
    zones[zoneName as VdotStyleZoneName] = normalizeRange(fasterPace, slowerPace);
  }

  return {
    source_equivalent_10k_pace_sec_per_km: tenKPaceSecondsPerKm,
    zones,
  };
}
