import type { TrainingPeaksWorkoutRaw } from "../../scripts/lib/trainingpeaks-workout-normalization.ts";

export type NumberParser = (value: unknown) => number | null;

export type WorkoutSummaryMetrics = {
  distanceMeters: number | null;
  totalTimeHours: number | null;
  derivedSpeedMps: number | null;
  velocityAverage: number | null;
  velocityMaximum: number | null;
  normalizedSpeedActual: number | null;
  heartRateMinimum: number | null;
  heartRateMaximum: number | null;
  heartRateAverage: number | null;
  cadenceAverage: number | null;
  cadenceMaximum: number | null;
  powerAverage: number | null;
  powerMaximum: number | null;
  normalizedPowerActual: number | null;
};

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function collectWorkoutText(raw: TrainingPeaksWorkoutRaw): string {
  const parts = [
    raw.title,
    raw.description,
    raw.coachComments,
    raw.workoutComments,
    raw.userTags,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => String(value));

  return parts.join(" ");
}

export function extractWorkoutSummaryMetrics(
  raw: TrainingPeaksWorkoutRaw,
  parseNumber: NumberParser = toFiniteNumber,
): WorkoutSummaryMetrics {
  const distanceMeters = parseNumber(raw.distance);
  const totalTimeHours = parseNumber(raw.totalTime);
  const derivedSpeedMps =
    distanceMeters !== null && totalTimeHours !== null && totalTimeHours > 0
      ? distanceMeters / (totalTimeHours * 3600)
      : null;

  return {
    distanceMeters,
    totalTimeHours,
    derivedSpeedMps,
    velocityAverage: parseNumber(raw.velocityAverage),
    velocityMaximum: parseNumber(raw.velocityMaximum),
    normalizedSpeedActual: parseNumber(raw.normalizedSpeedActual),
    heartRateMinimum: parseNumber(raw.heartRateMinimum),
    heartRateMaximum: parseNumber(raw.heartRateMaximum),
    heartRateAverage: parseNumber(raw.heartRateAverage),
    cadenceAverage: parseNumber(raw.cadenceAverage),
    cadenceMaximum: parseNumber(raw.cadenceMaximum),
    powerAverage: parseNumber(raw.powerAverage),
    powerMaximum: parseNumber(raw.powerMaximum),
    normalizedPowerActual: parseNumber(raw.normalizedPowerActual),
  };
}
