import {
  VDOT_STYLE_DEFAULT_RIEGEL_EXPONENT,
  VDOT_STYLE_DISTANCE_PAIR_OVERRIDES,
  VDOT_STYLE_STANDARD_DISTANCES,
  type VdotStyleDistanceKey,
  type VdotStyleDistancePairOverrideMap,
} from "./constants.ts";

export type EquivalentRaceEstimate = {
  distance_meters: number;
  time_seconds: number;
  pace_seconds_per_km: number;
  low_extrapolation_confidence: boolean;
};

export type EquivalentRaceTimes = Record<VdotStyleDistanceKey, EquivalentRaceEstimate>;

export type EquivalentRaceTimeOptions = {
  defaultExponent?: number;
  distancePairOverrides?: VdotStyleDistancePairOverrideMap;
  lowConfidenceRatioThreshold?: number;
};

const DEFAULT_LOW_CONFIDENCE_RATIO_THRESHOLD = 1.75;

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function paceSecondsPerKm(distanceMeters: number, timeSeconds: number): number {
  return timeSeconds / (distanceMeters / 1000);
}

function roundToNearestSecond(value: number): number {
  return Math.round(value);
}

function pairKey(
  fromDistance: VdotStyleDistanceKey,
  toDistance: VdotStyleDistanceKey,
): `${VdotStyleDistanceKey}->${VdotStyleDistanceKey}` {
  return `${fromDistance}->${toDistance}`;
}

function inferDistanceKey(distanceMeters: number): VdotStyleDistanceKey | null {
  for (const [distanceKey, meters] of Object.entries(VDOT_STYLE_STANDARD_DISTANCES)) {
    if (Math.abs(distanceMeters - meters) < 1e-6) {
      return distanceKey as VdotStyleDistanceKey;
    }
  }
  return null;
}

function lookupExponent(
  anchorDistanceMeters: number,
  targetDistanceMeters: number,
  options: EquivalentRaceTimeOptions,
): number {
  const anchorKey = inferDistanceKey(anchorDistanceMeters);
  const targetKey = inferDistanceKey(targetDistanceMeters);
  const overrides = options.distancePairOverrides ?? VDOT_STYLE_DISTANCE_PAIR_OVERRIDES;

  if (anchorKey && targetKey) {
    const override = overrides[pairKey(anchorKey, targetKey)];
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      return override;
    }
  }

  return options.defaultExponent ?? VDOT_STYLE_DEFAULT_RIEGEL_EXPONENT;
}

function isLowExtrapolationConfidence(
  anchorDistanceMeters: number,
  targetDistanceMeters: number,
  threshold: number,
): boolean {
  const ratio = Math.max(anchorDistanceMeters, targetDistanceMeters) /
    Math.min(anchorDistanceMeters, targetDistanceMeters);
  return ratio > threshold;
}

export function equivalentRaceTimes(
  anchorDistanceMeters: number,
  anchorTimeSeconds: number,
  options: EquivalentRaceTimeOptions = {},
): EquivalentRaceTimes {
  assertPositiveFinite(anchorDistanceMeters, "anchorDistanceMeters");
  assertPositiveFinite(anchorTimeSeconds, "anchorTimeSeconds");

  const lowConfidenceRatioThreshold =
    options.lowConfidenceRatioThreshold ?? DEFAULT_LOW_CONFIDENCE_RATIO_THRESHOLD;
  assertPositiveFinite(lowConfidenceRatioThreshold, "lowConfidenceRatioThreshold");

  const result = {} as EquivalentRaceTimes;

  for (const [distanceKey, distanceMeters] of Object.entries(VDOT_STYLE_STANDARD_DISTANCES)) {
    const exponent = lookupExponent(anchorDistanceMeters, distanceMeters, options);
    const rawTimeSeconds =
      anchorTimeSeconds * Math.pow(distanceMeters / anchorDistanceMeters, exponent);
    const timeSeconds = roundToNearestSecond(rawTimeSeconds);

    result[distanceKey as VdotStyleDistanceKey] = {
      distance_meters: distanceMeters,
      time_seconds: timeSeconds,
      pace_seconds_per_km: paceSecondsPerKm(distanceMeters, timeSeconds),
      low_extrapolation_confidence: isLowExtrapolationConfidence(
        anchorDistanceMeters,
        distanceMeters,
        lowConfidenceRatioThreshold,
      ),
    };
  }

  return result;
}
