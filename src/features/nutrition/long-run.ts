export const NUTRITION_LONG_RUN_MIN_DURATION_MINUTES = 70;
export const NUTRITION_LONG_ENDURANCE_MIN_DURATION_MINUTES = 120;
export const NUTRITION_LONG_ENDURANCE_BIKE_MIN_DURATION_MINUTES = 90;

export type NutritionLongRunWorkoutMode = "past_review" | "target_plan";

export type NutritionLongRunSource = "explicit_title" | "duration" | "none";

export function trainingPeaksDurationHoursToMinutes(
  durationHours: number | null | undefined
): number | null {
  if (durationHours === null || durationHours === undefined || !Number.isFinite(durationHours) || durationHours <= 0) {
    return null;
  }
  return Math.round(durationHours * 60);
}

export function isExplicitNutritionLongRunTitle(title?: string | null): boolean {
  const haystack = (title ?? "").toLocaleLowerCase("ru");
  return /long\s*run|longrun|длитель(?:ная|ный(?:\s+бег)?)?|длинн|лонг/.test(haystack);
}

export function isExplicitNutritionBikeTitle(title?: string | null): boolean {
  const haystack = (title ?? "").toLocaleLowerCase("ru");
  return /\bcycling\b|\bbike\b|вело|велотрен|велостанок|cycle/.test(haystack);
}

export function isExplicitRunTitle(title?: string | null): boolean {
  const haystack = (title ?? "").toLocaleLowerCase("ru");
  return /\brun(ning)?\b|бег|пробеж/.test(haystack);
}

export function resolveNutritionLongRunDurationMinutes(input: {
  durationMinutes?: number | null;
  durationHours?: number | null;
}): number | null {
  if (input.durationMinutes !== null && input.durationMinutes !== undefined && Number.isFinite(input.durationMinutes)) {
    return input.durationMinutes;
  }
  return trainingPeaksDurationHoursToMinutes(input.durationHours);
}

export function isNutritionLongRunWorkout(input: {
  title?: string | null;
  durationMinutes?: number | null;
  durationHours?: number | null;
  isCompleted?: boolean | null;
  mode: NutritionLongRunWorkoutMode;
}): boolean {
  if (input.mode === "past_review" && input.isCompleted === false) {
    return false;
  }

  const durationMinutes = resolveNutritionLongRunDurationMinutes(input);
  if (durationMinutes !== null && durationMinutes > NUTRITION_LONG_RUN_MIN_DURATION_MINUTES) {
    return true;
  }
  if (isExplicitNutritionLongRunTitle(input.title)) {
    return true;
  }
  return false;
}

export function isNutritionLongEnduranceWorkout(input: {
  title?: string | null;
  durationMinutes?: number | null;
  durationHours?: number | null;
  distanceKm?: number | null;
  isRunLike?: boolean;
}): boolean {
  const durationMinutes = resolveNutritionLongRunDurationMinutes(input);
  const isRunLike = input.isRunLike ?? isExplicitRunTitle(input.title);
  if (isRunLike) {
    return false;
  }
  const isBikeLike = isExplicitNutritionBikeTitle(input.title);
  if (isBikeLike && durationMinutes !== null && durationMinutes >= NUTRITION_LONG_ENDURANCE_BIKE_MIN_DURATION_MINUTES) {
    return true;
  }
  if (durationMinutes !== null && durationMinutes > NUTRITION_LONG_ENDURANCE_MIN_DURATION_MINUTES) {
    return true;
  }
  if (isBikeLike && (input.distanceKm ?? null) !== null && (input.distanceKm ?? 0) >= 60) {
    return true;
  }
  return false;
}

export function resolveNutritionLongRunSource(input: {
  title?: string | null;
  durationMinutes?: number | null;
  durationHours?: number | null;
}): NutritionLongRunSource {
  if (isExplicitNutritionLongRunTitle(input.title)) {
    return "explicit_title";
  }
  const durationMinutes = resolveNutritionLongRunDurationMinutes(input);
  if (durationMinutes !== null && durationMinutes > NUTRITION_LONG_RUN_MIN_DURATION_MINUTES) {
    return "duration";
  }
  return "none";
}

export function resolveNutritionLongRunConfidence(source: NutritionLongRunSource): "high" | "medium" | "low" {
  if (source === "explicit_title") {
    return "high";
  }
  if (source === "duration") {
    return "medium";
  }
  return "low";
}
