import { resolveNutritionActivityCoefByTitle } from "@/features/nutrition/activity-energy";

export const NUTRITION_LONG_RUN_MIN_DURATION_MINUTES = 80;
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
  // Cyrillic \b is ASCII-only, so the «вел» abbreviation gets letter-boundary
  // lookarounds (matches «… вел», not «велик»); «вело…» forms covered separately.
  return /\bcycling\b|\bbike\b|вело|велотрен|велостанок|cycle|(?<![а-яёa-z])вел(?![а-яёa-z])/i.test(haystack);
}

export function isExplicitRunTitle(title?: string | null): boolean {
  const haystack = (title ?? "").toLocaleLowerCase("ru");
  return /\brun(ning)?\b|бег|пробеж/.test(haystack);
}

const EASY_LIGHT_NUTRITION_TITLE_PATTERN =
  /бег\s+в\s+легк(?:ом|ом)\s+темпе|легк\w*\s+бег\s+по\s+темпу|легк\w*\s+по\s+темпу|бег\s+по\s+темпу|easy\s+(?:run|pace)|recovery\s+run|легк\w*\s+пробеж|разминк|заминк/i;

function isExplicitEasyLightNutritionTitle(title: string): boolean {
  return EASY_LIGHT_NUTRITION_TITLE_PATTERN.test(title);
}

export function isEasyLightNutritionTitle(title?: string | null): boolean {
  const haystack = (title ?? "").trim();
  if (!haystack) {
    return false;
  }
  if (isExplicitEasyLightNutritionTitle(haystack)) {
    return true;
  }
  const haystackLc = haystack.toLocaleLowerCase("ru");
  if (/легк|easy|recovery|восстанов|комфортн/.test(haystackLc)) {
    if (/\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\s*(?:мин|min|m)?\b/i.test(haystack)) {
      return false;
    }
    if (/интерв|interval|vo2|спринт|hill/i.test(haystack)) {
      return false;
    }
    if (/темпов(?:ая|ый)|^tempo\b|tempo\s+run|threshold|порог(?:ов(?:ой|ая)?)?/i.test(haystack)) {
      return false;
    }
    return true;
  }
  return false;
}

export function hasNutritionIntervalWorkoutEvidence(title?: string | null): boolean {
  const haystack = (title ?? "").trim();
  if (!haystack || isExplicitEasyLightNutritionTitle(haystack)) {
    return false;
  }
  return (
    /интерв|interval|vo2|спринт|hill|hiit|хиит/i.test(haystack) ||
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\s*(?:мин|min|m)?\b/i.test(haystack)
  );
}

export function hasNutritionTempoWorkEvidence(title?: string | null): boolean {
  const haystack = (title ?? "").trim();
  if (!haystack || isExplicitEasyLightNutritionTitle(haystack)) {
    return false;
  }
  if (/темпов(?:ая|ый)|tempo\s+run|threshold|порог(?:ов(?:ой|ая)?)?/i.test(haystack)) {
    return true;
  }
  if (/^tempo\b/i.test(haystack)) {
    return true;
  }
  return false;
}

export function hasExplicitNutritionQualityWorkoutEvidence(title?: string | null): boolean {
  return hasNutritionIntervalWorkoutEvidence(title) || hasNutritionTempoWorkEvidence(title);
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

  // A bike is never a long RUN — guard before the «длительн»-title check so
  // «Длительный вел» isn't forced into the run family (it's a вело day).
  if (isExplicitNutritionBikeTitle(input.title)) {
    return false;
  }
  // Поток D-8: any RECOGNISED non-run activity (walk/hike/tennis/padel/swim/bike/
  // strength — anything carrying a non-run expenditure coefficient) is never a long
  // RUN, even past the duration threshold and even with a «длительн» title («длительная
  // ходьба» is a long walk, not a long run). Without this an 80-min walk/swim was
  // wrongly classified long_run and got a long-run carb target. Runs are not in the
  // coefficient map (coef null), so a genuine long run still classifies below.
  if (resolveNutritionActivityCoefByTitle(input.title) !== null) {
    return false;
  }
  if (isExplicitNutritionLongRunTitle(input.title)) {
    return true;
  }
  // Intermittent interval work (×/repeats, intervals, VO2, sprints, HIIT) is a HARD
  // day regardless of duration — intervals are intensity, not volume. Keyed on
  // INTERVAL evidence (intermittent), NOT tempo: a CONTINUOUS long effort like
  // «23 км в темпе марафона» / «Бег по темпу 90 мин» is fuel-demanding and must stay
  // LONG, so it is deliberately NOT excluded here.
  if (hasNutritionIntervalWorkoutEvidence(input.title)) {
    return false;
  }
  // Duration WINS over a (continuous) tempo title: a run at/above the long threshold is
  // a long fuelling day even if titled «Бег по темпу» (intervals already returned above).
  // Short continuous quality work (< threshold) stays a quality day.
  const durationMinutes = resolveNutritionLongRunDurationMinutes(input);
  if (durationMinutes !== null && durationMinutes >= NUTRITION_LONG_RUN_MIN_DURATION_MINUTES) {
    return true;
  }
  if (hasExplicitNutritionQualityWorkoutEvidence(input.title)) {
    return false;
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
  // An explicitly long bike («Длительный вел») is a long-endurance day by title,
  // even when planned workouts carry no duration/distance yet.
  if (isBikeLike && isExplicitNutritionLongRunTitle(input.title)) {
    return true;
  }
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
  // Intermittent intervals never source a long_run (they are hard days); a continuous
  // long effort at/above the threshold sources "duration" even with a tempo title.
  if (hasNutritionIntervalWorkoutEvidence(input.title)) {
    return "none";
  }
  const durationMinutes = resolveNutritionLongRunDurationMinutes(input);
  if (durationMinutes !== null && durationMinutes >= NUTRITION_LONG_RUN_MIN_DURATION_MINUTES) {
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
