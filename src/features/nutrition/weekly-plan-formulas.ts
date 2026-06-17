export type NutritionPlanDayType =
  | "rest"
  | "easy"
  | "hard"
  | "pre_long"
  | "long_run"
  | "long_endurance"
  | "strength"
  | "cross_training"
  | "race"
  | "unknown";

export type NutritionPlanSource =
  | "tp_workout"
  | "inferred_from_week_structure"
  | "generic_day_type"
  | "missing_bodyweight"
  | "unknown";

import {
  hasNutritionIntervalWorkoutEvidence,
  hasNutritionTempoWorkEvidence,
  isEasyLightNutritionTitle,
  isExplicitRunTitle,
  isNutritionLongEnduranceWorkout,
  isExplicitNutritionLongRunTitle,
  isNutritionLongRunWorkout,
  resolveNutritionLongRunConfidence,
  resolveNutritionLongRunSource,
  type NutritionLongRunSource,
} from "@/features/nutrition/long-run";
import { resolveNutritionActivityCoefByTitle } from "@/features/nutrition/activity-energy";
import type { NutritionGoalType, NutritionSex } from "@/features/nutrition/repository";

export type { NutritionLongRunSource };
export type NutritionLongRunConfidence = "high" | "medium" | "low";

export type NutritionDayTypeTarget = {
  target_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  kcal_per_kg: number;
  protein_g_per_kg: number;
  fat_g_per_kg: number;
  carbs_g_per_kg: number;
};

export type NutritionNextWeekPlanDay = {
  date: string;
  weekday_ru: string;
  training_type: NutritionPlanDayType;
  training_label: string;
  workout_title: string | null;
  target_kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  kcal_per_kg: number | null;
  protein_g_per_kg: number | null;
  fat_g_per_kg: number | null;
  carbs_g_per_kg: number | null;
  flags: {
    rest: boolean;
    easy: boolean;
    hard: boolean;
    pre_long: boolean;
    long_run: boolean;
    strength: boolean;
    cross_training?: boolean;
    race: boolean;
    key_workout: boolean;
    day_before_long_run: boolean;
    has_training_context: boolean;
  };
  long_run_source: NutritionLongRunSource;
  long_run_confidence: NutritionLongRunConfidence;
  pre_training_guidance: string | null;
  /** Наряд 3 Шаг 2: race-day protocol (gel / loading / timing) — null for non-race days. */
  race_protocol: NutritionRaceProtocol | null;
  source: NutritionPlanSource;
  ideal_target: NutritionDayTypeTarget | null;
  practical_target: NutritionDayTypeTarget | null;
  display_target: {
    kcal_min: number | null;
    kcal_max: number | null;
    carbs_g_min: number | null;
    carbs_g_max: number | null;
  };
};

export type NutritionNextWeekPlan = {
  formula_version: "nutrition_next_week_plan_v1";
  bodyweight_kg: number | null;
  rounding: {
    kcal: "nearest_50";
    carbs_g: "nearest_10";
    protein_g: "nearest_5";
    fat_g: "nearest_5";
  };
  days: NutritionNextWeekPlanDay[];
  day_type_targets: {
    rest: NutritionDayTypeTarget | null;
    easy: NutritionDayTypeTarget | null;
    hard: NutritionDayTypeTarget | null;
    pre_long: NutritionDayTypeTarget | null;
    long_run: NutritionDayTypeTarget | null;
    long_endurance?: NutritionDayTypeTarget | null;
    strength: NutritionDayTypeTarget | null;
    cross_training?: NutritionDayTypeTarget | null;
  };
  day_type_ideal_targets: {
    rest: NutritionDayTypeTarget | null;
    easy: NutritionDayTypeTarget | null;
    hard: NutritionDayTypeTarget | null;
    pre_long: NutritionDayTypeTarget | null;
    long_run: NutritionDayTypeTarget | null;
    long_endurance?: NutritionDayTypeTarget | null;
    strength: NutritionDayTypeTarget | null;
    cross_training?: NutritionDayTypeTarget | null;
  };
  summary: {
    has_training_context: boolean;
    total_days: number;
    days_with_training: number;
    key_days_count: number;
    long_run_dates: string[];
    long_run_source: NutritionLongRunSource;
    long_run_confidence: NutritionLongRunConfidence;
    hard_dates: string[];
    missing_bodyweight: boolean;
  };
  warnings: string[];
};

type FormulaCoefficients = {
  kcalPerKg: number;
  proteinPerKg: number;
  fatPerKg: number;
  carbsPerKg: number;
};

type ParsedWorkout = {
  date: string;
  title: string | null;
  type: string | null;
  dayType: NutritionPlanDayType;
  keyWorkout: boolean;
  isRunning: boolean;
  longRunSource: NutritionLongRunSource;
  longRunConfidence: NutritionLongRunConfidence;
  /** Task 10++: planned load for the goal=lose/gain maintenance anchor (BMR + TP expenditure). */
  durationHours: number | null;
  distanceKm: number | null;
};

type PreviousWeekMacroPoint = {
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
};

type PreviousWeekTargets = {
  overall: PreviousWeekMacroPoint;
  byDayType: Partial<Record<NutritionPlanDayType, PreviousWeekMacroPoint>>;
};

const WEEKDAY_RU_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"] as const;

const DAY_TYPE_PRIORITY: Record<NutritionPlanDayType, number> = {
  race: 7,
  long_endurance: 7,
  long_run: 6,
  hard: 5,
  pre_long: 4,
  strength: 3,
  cross_training: 3,
  easy: 2,
  rest: 1,
  unknown: 0,
};

const FORMULA_BY_DAY_TYPE: Partial<Record<NutritionPlanDayType, FormulaCoefficients>> = {
  rest: { kcalPerKg: 35, proteinPerKg: 1.6, fatPerKg: 1.1, carbsPerKg: 4.5 },
  easy: { kcalPerKg: 39, proteinPerKg: 1.6, fatPerKg: 1.15, carbsPerKg: 5.2 },
  hard: { kcalPerKg: 43, proteinPerKg: 1.7, fatPerKg: 1.15, carbsPerKg: 6.0 },
  pre_long: { kcalPerKg: 39, proteinPerKg: 1.6, fatPerKg: 1.15, carbsPerKg: 5.5 },
  long_run: { kcalPerKg: 45, proteinPerKg: 1.7, fatPerKg: 1.15, carbsPerKg: 7.0 },
  long_endurance: { kcalPerKg: 45, proteinPerKg: 1.7, fatPerKg: 1.15, carbsPerKg: 7.0 },
  strength: { kcalPerKg: 39, proteinPerKg: 1.8, fatPerKg: 1.15, carbsPerKg: 5.2 },
  cross_training: { kcalPerKg: 39, proteinPerKg: 1.6, fatPerKg: 1.15, carbsPerKg: 5.2 },
};

const GUIDANCE_BY_DAY_TYPE: Record<NutritionPlanDayType, string | null> = {
  rest: null,
  easy: "Лёгкая пробежка: можно налегке или после небольшого перекуса, как удобнее.",
  hard: "Ключевая работа: не выходить голодным; углеводы в течение дня держать ближе к ориентиру для интервального/темпового дня.",
  pre_long: "День перед длительной: это не обычный отдых; важно не просадить углеводы за день.",
  long_run: "Длительная: заранее поддержать углеводы и после тренировки закрыть восстановление.",
  long_endurance: "Длинная выносливостная нагрузка: поддержать углеводы и восстановление после работы.",
  strength: "Силовая: держать белок и углеводы без сильной просадки.",
  cross_training: "Кросс-тренировка: поддержать питание вокруг нагрузки, без пустого дня по энергии.",
  race: "Соревновательный день: не экспериментировать с питанием и держать проверенные схемы.",
  unknown: null,
};

/**
 * Наряд 3 Шаг 2: race protocol by distance. Loading ONLY for >90-min efforts
 * (half+); 5K/10K are intense race days WITHOUT loading. A gel ~10 min before is
 * a hard rule for ≥10 km (5K — no gel). Timing comes from the title (no race time
 * in TP): "ночной/вечерний" → evening, the carb load is spread across the day;
 * otherwise default to a morning race (carb dinner the night before).
 */
export type NutritionRaceProtocol = {
  distance_km: number | null;
  effort_over_90min: boolean;
  loading: { g_per_kg_low: number; g_per_kg_high: number; days: number } | null;
  gel_before: boolean;
  timing: "morning" | "evening_or_night";
  recovery_after: boolean;
};

export function computeNutritionRaceProtocol(input: {
  distanceKm: number | null;
  title: string | null;
}): NutritionRaceProtocol {
  const km = typeof input.distanceKm === "number" && Number.isFinite(input.distanceKm) ? input.distanceKm : null;
  const title = (input.title ?? "").toLowerCase();
  const timing: NutritionRaceProtocol["timing"] = /ночн|вечер|night|evening/u.test(title)
    ? "evening_or_night"
    : "morning";
  // Loading only for half-marathon and longer (>~90 min).
  const over90 = km != null && km >= 21;
  let loading: NutritionRaceProtocol["loading"] = null;
  if (km != null) {
    if (km >= 50) {
      loading = { g_per_kg_low: 8, g_per_kg_high: 10, days: 3 };
    } else if (km >= 42) {
      loading = { g_per_kg_low: 7, g_per_kg_high: 9, days: 3 };
    } else if (km >= 21) {
      loading = { g_per_kg_low: 6, g_per_kg_high: 8, days: 2 };
    }
  }
  return {
    distance_km: km,
    effort_over_90min: over90,
    loading,
    gel_before: km != null && km >= 10,
    timing,
    recovery_after: true,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIsoDate(value: unknown): string | null {
  const text = toStringOrNull(value);
  if (!text) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDays(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function buildWeekDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to && dates.length < 14; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
    if (cursor === to) {
      break;
    }
  }
  return dates;
}

function toWeekdayRu(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  const weekday = date.getUTCDay();
  return WEEKDAY_RU_FULL[weekday] ?? "Неизвестно";
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function toFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export { isExplicitNutritionLongRunTitle };

function isRunningWorkout(typeRaw: string | null, titleRaw: string | null): boolean {
  const type = (typeRaw ?? "").toLowerCase();
  const title = (titleRaw ?? "").toLowerCase();
  if (type === "strength" || /силов/.test(title)) {
    return false;
  }
  if (type === "crosstrain" || type === "cross_training" || type === "bike" || type === "swim" || /\bpadel\b|падел/.test(title)) {
    return false;
  }
  if (type === "run" || type === "easy_run" || type === "long_run" || type === "intervals" || type === "tempo" || type === "race") {
    return true;
  }
  return /бег|пробеж|run|running|tempo|темп|интерв|длитель|длинн/.test(`${type} ${title}`);
}

function normalizeDayType(typeRaw: string | null, titleRaw: string | null): NutritionPlanDayType {
  const type = (typeRaw ?? "").toLowerCase();
  const title = titleRaw ?? "";
  const haystack = `${type} ${title}`.toLowerCase();
  // Наряд 3: race entity (injected event type="race") OR a race-titled workout,
  // excluding marathon-PACE training runs and prep/route notes.
  const racePaceOrPrep =
    /в\s+темпе|марафонск[\p{L}]*\s+темп|темп[\p{L}]*\s+марафон|в\s+марафонском|маршрут[\p{L}]*\s+забег|подготовк[\p{L}]*\s+к|к\s+марафону|marathon\s+pace|race\s+pace/u.test(
      haystack
    );
  if (
    !racePaceOrPrep &&
    /гонк|соревнов|паркран|полумарафон|ультрамарафон|триатлон|марафон|(?<![\p{L}])(?:забег|старт|ультра|race|parkrun|triathlon)(?![\p{L}])/u.test(
      haystack
    )
  ) {
    return "race";
  }
  if (type === "strength" || /силов/.test(haystack)) {
    return "strength";
  }
  if (
    type === "crosstrain" ||
    type === "cross_training" ||
    type === "bike" ||
    type === "swim" ||
    type === "walk" ||
    type === "hike" ||
    /\bpadel\b|падел|cross.?train|crosstrain|bike|cycling|swim|плав|вело|\b(?:walk|walking|hike|hiking|trek|tennis)\b|ходьб|прогулк|поход|хайк|теннис/.test(haystack)
  ) {
    // Non-run activities (incl. walk/hike/tennis) → cross-training family.
    return "cross_training";
  }
  if (
    type === "intervals" ||
    hasNutritionIntervalWorkoutEvidence(title) ||
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\b/.test(haystack)
  ) {
    // Quality work first, so an interval run (family "run") is not swallowed by
    // the easy/run branch below.
    return "hard";
  }
  if (
    type === "tempo" ||
    type === "threshold" ||
    hasNutritionTempoWorkEvidence(title) ||
    /интерв|vo2|hill|ключ/.test(haystack)
  ) {
    return "hard";
  }
  // "отдых" can be a recovery jog inside a run title — only a rest DAY when there
  // is no run evidence.
  if (type === "rest" || type === "day_off" || (/rest|отдых|выходн/.test(haystack) && !isExplicitRunTitle(title))) {
    return "rest";
  }
  if (
    type === "easy" ||
    type === "easy_run" ||
    type === "run" ||
    type === "endurance" ||
    type === "recovery" ||
    isEasyLightNutritionTitle(title) ||
    /легк|easy|recovery/.test(haystack)
  ) {
    return "easy";
  }
  return "unknown";
}

function isKeyWorkout(dayType: NutritionPlanDayType): boolean {
  return dayType === "hard" || dayType === "long_run" || dayType === "long_endurance" || dayType === "race";
}

function parseTrainingContextWorkouts(trainingContext: unknown): ParsedWorkout[] {
  const ctx = asObject(trainingContext);
  if (!ctx) {
    return [];
  }
  const workoutsRaw = Array.isArray(ctx.workouts) ? ctx.workouts : [];
  const baseWorkouts = workoutsRaw
    .map((item) => asObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((workout) => {
      const date = toIsoDate(workout.date) ?? "unknown-date";
      const title = toStringOrNull(workout.title);
      const type = toStringOrNull(workout.type);
      const durationHours = toFinite(workout.durationHours) ?? toFinite(workout.duration_hours);
      const distanceKm = toFinite(workout.distanceKm) ?? toFinite(workout.distance_km);
      const status = toStringOrNull(workout.status);
      const isCompleted = status === "completed" || status === "planned_and_completed" || status === null;
      let dayType = normalizeDayType(type, title);
      const isRunLike = isExplicitRunTitle(title) || type === "run" || type === "easy_run" || type === "long_run";
      if (
        isNutritionLongEnduranceWorkout({
          title,
          durationHours,
          isRunLike,
        })
      ) {
        dayType = "long_endurance";
      } else if (
        isNutritionLongRunWorkout({
          title,
          durationHours,
          isCompleted,
          mode: "target_plan",
        })
      ) {
        dayType = "long_run";
      }
      const longRunSource =
        dayType === "long_run"
          ? resolveNutritionLongRunSource({ title, durationHours })
          : "none";
      const longRunConfidence = resolveNutritionLongRunConfidence(longRunSource);
      return {
        date,
        title,
        type,
        dayType,
        keyWorkout: isKeyWorkout(dayType),
        isRunning: isRunningWorkout(type, title),
        longRunSource,
        longRunConfidence,
        durationHours,
        distanceKm,
      };
    })
    .filter((out) => out.date !== "unknown-date");

  return baseWorkouts;
}

function pickPrimaryWorkout(workouts: ParsedWorkout[]): ParsedWorkout | null {
  if (workouts.length === 0) {
    return null;
  }
  let winner = workouts[0];
  for (const workout of workouts.slice(1)) {
    if (DAY_TYPE_PRIORITY[workout.dayType] > DAY_TYPE_PRIORITY[winner.dayType]) {
      winner = workout;
    }
  }
  return winner;
}

function getTrainingLabel(dayType: NutritionPlanDayType, workoutTitle: string | null): string {
  if (workoutTitle) {
    return workoutTitle;
  }
  if (dayType === "rest") {
    return "день отдыха";
  }
  if (dayType === "easy") {
    return "лёгкая тренировка";
  }
  if (dayType === "hard") {
    return "ключевая тренировка";
  }
  if (dayType === "pre_long") {
    return "день перед длительной";
  }
  if (dayType === "long_run") {
    return "длительная";
  }
  if (dayType === "long_endurance") {
    return "длинная выносливостная нагрузка";
  }
  if (dayType === "strength") {
    return "силовая";
  }
  if (dayType === "cross_training") {
    return "кросс-тренировка";
  }
  if (dayType === "race") {
    return "соревнование";
  }
  return "тип тренировки не определён";
}

export function calculateNutritionDayTypeTarget(params: {
  bodyweightKg: number | null;
  dayType: NutritionPlanDayType;
}): NutritionDayTypeTarget | null {
  if (!params.bodyweightKg || params.bodyweightKg <= 0) {
    return null;
  }
  const formula = FORMULA_BY_DAY_TYPE[params.dayType];
  if (!formula) {
    return null;
  }
  const bw = params.bodyweightKg;
  return {
    target_kcal: roundToNearest(formula.kcalPerKg * bw, 50),
    protein_g: roundToNearest(formula.proteinPerKg * bw, 5),
    fat_g: roundToNearest(formula.fatPerKg * bw, 5),
    carbs_g: roundToNearest(formula.carbsPerKg * bw, 10),
    kcal_per_kg: formula.kcalPerKg,
    protein_g_per_kg: formula.proteinPerKg,
    fat_g_per_kg: formula.fatPerKg,
    carbs_g_per_kg: formula.carbsPerKg,
  };
}

// Task 10: periodized daily kcal deficit for goal=lose ("fuel for the work
// required") — bigger cut in rest/easy, minimal in hard/long. Weekly average
// lands in the moderate 300–500 kcal/day band.
const LOSE_DEFICIT_BY_DAY_TYPE: Record<NutritionPlanDayType, number> = {
  rest: 500,
  easy: 400,
  cross_training: 350,
  strength: 300,
  pre_long: 250,
  hard: 200,
  race: 200,
  long_run: 150,
  long_endurance: 150,
  unknown: 350,
};

function roundPerKg(grams: number, bw: number): number {
  return Number((grams / bw).toFixed(2));
}

// Task 10++: corrected maintenance for goal=lose/gain. Instead of anchoring the
// deficit/surplus on the inflated fixed-coefficient ideal (rest 35 kcal/kg →
// ~2450 for 70 kg), anchor on BMR (Mifflin when height/age are known, else a
// Cunningham/FFM estimate) + the day's actual TP training expenditure. This is
// used ONLY for lose/gain; the maintain path is untouched.
const NON_EXERCISE_PAL = 1.3;

const FFM_COEFFICIENT_BY_SEX: Record<"female" | "male" | "unknown", number> = {
  female: 0.78,
  male: 0.82,
  unknown: 0.8,
};

function ffmKgForSex(bw: number, sex: NutritionSex | null): number {
  const coef = FFM_COEFFICIENT_BY_SEX[sex ?? "unknown"];
  return bw * coef;
}

/**
 * Resting metabolic rate. Mifflin–St Jeor when height + age are known (exact);
 * otherwise a sex-aware Cunningham estimate on estimated fat-free mass
 * (approximate — the review still generates without height/age). Unknown sex is
 * treated as female (lower base) for the Mifflin constant.
 */
export function estimateRestingMetabolicRate(params: {
  bodyweightKg: number;
  sex: NutritionSex | null;
  heightCm: number | null;
  ageYears: number | null;
}): { rmrKcal: number; source: "mifflin" | "cunningham_ffm" } {
  const { bodyweightKg: w, sex, heightCm, ageYears } = params;
  if (heightCm && heightCm > 0 && ageYears && ageYears > 0) {
    const base = 10 * w + 6.25 * heightCm - 5 * ageYears;
    const rmr = sex === "male" ? base + 5 : base - 161;
    return { rmrKcal: Math.max(Math.round(rmr), 800), source: "mifflin" };
  }
  const ffm = ffmKgForSex(w, sex);
  return { rmrKcal: Math.round(500 + 22 * ffm), source: "cunningham_ffm" };
}

// Typical session length per day type, used to estimate planned training
// expenditure when the TP workout has no explicit duration/distance.
const TYPICAL_EXERCISE_HOURS_BY_DAY_TYPE: Partial<Record<NutritionPlanDayType, number>> = {
  easy: 0.75,
  hard: 1.0,
  pre_long: 0.5,
  long_run: 1.5,
  long_endurance: 1.75,
  strength: 0.75,
  cross_training: 0.75,
  race: 1.5,
};

// Task 10d (Bug 2): per-hour energy cost by intensity (kcal/kg/h). "hard" (the
// plan's intervals/tempo bucket) burns more than an easy run of equal duration,
// so a quality day gets more fuel/carbs than a light day. Mirrors the review-side
// coefficients in methodology.ts. Applies to ALL goals (lose/gain anchor + EA).
const EXERCISE_KCAL_PER_KG_PER_HOUR_BY_DAY_TYPE: Partial<Record<NutritionPlanDayType, number>> = {
  hard: 12,
  race: 12,
  long_run: 10,
  long_endurance: 9,
  pre_long: 8,
  easy: 8,
  cross_training: 7,
  strength: 5,
};

/**
 * Goal-aware day target on the corrected (BMR + this day's TP expenditure)
 * maintenance. Single source of truth shared by the next-week plan and the
 * review's per-day "deficit line" so the two never drift. maintain → ideal.
 */
export function computeNutritionGoalDayTarget(params: {
  goalType: NutritionGoalType;
  dayType: NutritionPlanDayType;
  bodyweightKg: number | null;
  sex: NutritionSex | null;
  heightCm: number | null;
  ageYears: number | null;
  exerciseKcal: number;
  ideal?: NutritionDayTypeTarget | null;
  /** Наряд 3: race-week → lose deficit OFF (don't toe a start on a deficit). */
  raceWeekDeficitOff?: boolean;
}): NutritionDayTypeTarget | null {
  const ideal =
    params.ideal ??
    calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: params.dayType });
  if (params.goalType === "maintain" || !params.bodyweightKg || params.bodyweightKg <= 0) {
    return ideal;
  }
  const rmrKcal = estimateRestingMetabolicRate({
    bodyweightKg: params.bodyweightKg,
    sex: params.sex,
    heightCm: params.heightCm,
    ageYears: params.ageYears,
  }).rmrKcal;
  const maintenanceKcal = Math.round(rmrKcal * NON_EXERCISE_PAL + Math.max(params.exerciseKcal, 0));
  return applyNutritionGoalToDayTarget(ideal, {
    goalType: params.goalType,
    dayType: params.dayType,
    bodyweightKg: params.bodyweightKg,
    maintenanceKcal,
    exerciseKcal: params.exerciseKcal,
    sex: params.sex,
    raceWeekDeficitOff: params.raceWeekDeficitOff ?? false,
  });
}

/** Planned training expenditure for a day (mirrors the review estimator). */
export function estimatePlanDayExerciseKcal(params: {
  dayType: NutritionPlanDayType;
  bodyweightKg: number;
  durationHours: number | null;
  distanceKm: number | null;
  workoutTitle?: string | null;
}): number {
  const { dayType, bodyweightKg: bw } = params;
  if (dayType === "rest" || dayType === "unknown") {
    return 0;
  }
  if ((dayType === "long_run" || dayType === "long_endurance") && params.distanceKm && params.distanceKm > 0) {
    return Math.round(params.distanceKm * bw);
  }
  const hours =
    params.durationHours && params.durationHours > 0
      ? params.durationHours
      : TYPICAL_EXERCISE_HOURS_BY_DAY_TYPE[dayType] ?? 0.75;
  // Activity-specific coefficient (walk/hike/tennis/padel/bike/swim/strength) wins
  // over the day-type default, so a non-run session is costed correctly.
  const perKgPerHour =
    resolveNutritionActivityCoefByTitle(params.workoutTitle) ??
    EXERCISE_KCAL_PER_KG_PER_HOUR_BY_DAY_TYPE[dayType] ??
    9;
  return Math.round(hours * bw * perKgPerHour);
}

/**
 * Task 10 / 10++: shift a maintenance day target to the student's goal.
 * - maintain: unchanged (this function is not called for maintain).
 * - lose: kcal = corrected maintenance (BMR + this day's TP expenditure) −
 *   periodized deficit, clamped UP to the energy-availability floor
 *   (FFM·30 + the day's exercise) and an absolute floor — the formula never
 *   prescribes a dangerous deficit; protein HIGH (1.9 g/kg); fat 20–30% energy;
 *   carbs = remainder, floored at ~2 g/kg.
 * - gain: surplus on the corrected maintenance, protein 1.8 g/kg, carbs fill it.
 * `maintenanceKcal` is the corrected per-day anchor; when absent (no anthropometrics)
 * it falls back to the fixed-coefficient ideal so a review still generates.
 * Safety floors here are formula guards only; the safety-flag system is separate
 * and is never bypassed by goal.
 */
export function applyNutritionGoalToDayTarget(
  ideal: NutritionDayTypeTarget | null,
  params: {
    goalType: NutritionGoalType;
    dayType: NutritionPlanDayType;
    bodyweightKg: number | null;
    maintenanceKcal?: number | null;
    exerciseKcal?: number | null;
    sex?: NutritionSex | null;
    /**
     * Наряд 3: in race-week a losing athlete must NOT toe the start on a deficit
     * (incomplete glycogen → "the wall" + health risk). When true the lose deficit
     * is switched off (treat the day as maintenance — loading wins over weight
     * loss). The EA/absolute floors and the safety-flag system are unchanged.
     */
    raceWeekDeficitOff?: boolean;
  }
): NutritionDayTypeTarget | null {
  if (!ideal || params.goalType === "maintain" || !params.bodyweightKg || params.bodyweightKg <= 0) {
    return ideal;
  }
  const bw = params.bodyweightKg;
  const maintenance =
    params.maintenanceKcal && params.maintenanceKcal > 0 ? params.maintenanceKcal : ideal.target_kcal;
  const exercise = params.exerciseKcal && params.exerciseKcal > 0 ? params.exerciseKcal : 0;

  if (params.goalType === "lose") {
    // Race-week priority rule: deficit OFF (fuel normally for the start).
    const deficit = params.raceWeekDeficitOff ? 0 : LOSE_DEFICIT_BY_DAY_TYPE[params.dayType] ?? 350;
    // Energy-availability floor: keep EA ≥ 30 kcal/kg FFM, i.e. intake never
    // below FFM·30 + the day's training expenditure. Plus an absolute floor.
    const eaFloor = ffmKgForSex(bw, params.sex ?? null) * 30 + exercise;
    const absFloor = Math.max(26 * bw, 1400);
    const floor = roundToNearest(Math.max(eaFloor, absFloor), 50);
    const kcal = Math.max(roundToNearest(maintenance - deficit, 50), floor);
    const proteinG = roundToNearest(1.9 * bw, 5);
    // Fat ~0.9 g/kg, but clamp to 20–30% of energy.
    const fatMin = (0.2 * kcal) / 9;
    const fatMax = (0.3 * kcal) / 9;
    const fatG = roundToNearest(Math.min(Math.max(0.9 * bw, fatMin), fatMax), 5);
    const carbsFloor = roundToNearest(2.0 * bw, 10);
    const carbsRemainder = (kcal - proteinG * 4 - fatG * 9) / 4;
    const carbsG = Math.max(roundToNearest(carbsRemainder, 10), carbsFloor);
    return {
      target_kcal: kcal,
      protein_g: proteinG,
      fat_g: fatG,
      carbs_g: carbsG,
      kcal_per_kg: Number((kcal / bw).toFixed(1)),
      protein_g_per_kg: roundPerKg(proteinG, bw),
      fat_g_per_kg: roundPerKg(fatG, bw),
      carbs_g_per_kg: roundPerKg(carbsG, bw),
    };
  }

  // gain: surplus on the corrected maintenance.
  const kcal = roundToNearest(maintenance * 1.11, 50);
  const proteinG = roundToNearest(1.8 * bw, 5);
  const fatG = roundToNearest(1.0 * bw, 5);
  const carbsG = roundToNearest(Math.max((kcal - proteinG * 4 - fatG * 9) / 4, ideal.carbs_g), 10);
  return {
    target_kcal: kcal,
    protein_g: proteinG,
    fat_g: fatG,
    carbs_g: carbsG,
    kcal_per_kg: Number((kcal / bw).toFixed(1)),
    protein_g_per_kg: roundPerKg(proteinG, bw),
    fat_g_per_kg: roundPerKg(fatG, bw),
    carbs_g_per_kg: roundPerKg(carbsG, bw),
  };
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return Number((present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(1));
}

function normalizePrevDayType(raw: unknown): NutritionPlanDayType {
  if (typeof raw !== "string") {
    return "unknown";
  }
  const value = raw.toLowerCase();
  if (
    value === "rest" ||
    value === "easy" ||
    value === "hard" ||
    value === "pre_long" ||
    value === "long_run" ||
    value === "strength" ||
    value === "cross_training" ||
    value === "race"
  ) {
    return value;
  }
  return "unknown";
}

function extractPreviousWeekTargets(previousWeekDailyAnalysis: unknown): PreviousWeekTargets {
  const days = Array.isArray(previousWeekDailyAnalysis) ? previousWeekDailyAnalysis : [];
  const points = days
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const actual =
        item.actual && typeof item.actual === "object" && !Array.isArray(item.actual)
          ? (item.actual as Record<string, unknown>)
          : {};
      const trainingType = normalizePrevDayType(item.trainingType ?? item.training_type);
      return {
        trainingType,
        kcal: toFinite(actual.kcal ?? item.kcal ?? item.actual_kcal),
        protein: toFinite(actual.proteinG ?? item.proteinG ?? item.protein_g),
        fat: toFinite(actual.fatG ?? item.fatG ?? item.fat_g),
        carbs: toFinite(actual.carbsG ?? item.carbsG ?? item.carbs_g),
      };
    });

  const overall: PreviousWeekMacroPoint = {
    kcal: average(points.map((point) => point.kcal)),
    protein: average(points.map((point) => point.protein)),
    fat: average(points.map((point) => point.fat)),
    carbs: average(points.map((point) => point.carbs)),
  };

  const byDayType: Partial<Record<NutritionPlanDayType, PreviousWeekMacroPoint>> = {};
  for (const dayType of ["rest", "easy", "hard", "pre_long", "long_run", "strength", "cross_training", "race"] as const) {
    const scoped = points.filter((point) => point.trainingType === dayType);
    if (scoped.length === 0) {
      continue;
    }
    byDayType[dayType] = {
      kcal: average(scoped.map((point) => point.kcal)),
      protein: average(scoped.map((point) => point.protein)),
      fat: average(scoped.map((point) => point.fat)),
      carbs: average(scoped.map((point) => point.carbs)),
    };
  }
  return { overall, byDayType };
}

function applyPracticalTarget(input: {
  dayType: NutritionPlanDayType;
  bodyweightKg: number | null;
  ideal: NutritionDayTypeTarget | null;
  baseline: PreviousWeekMacroPoint | null;
}): NutritionDayTypeTarget | null {
  if (!input.ideal || !input.bodyweightKg || input.bodyweightKg <= 0) {
    return input.ideal;
  }
  const isKeyDay =
    input.dayType === "hard" ||
    input.dayType === "pre_long" ||
    input.dayType === "long_run" ||
    input.dayType === "long_endurance" ||
    input.dayType === "race";
  const maxCarbJump = isKeyDay ? 100 : 80;
  const maxKcalJump = isKeyDay ? 500 : 400;
  const proteinFloor = 1.6 * input.bodyweightKg;
  const fatFloor = 1.0 * input.bodyweightKg;

  const baseline = input.baseline;
  const baselineCarbs = baseline?.carbs ?? null;
  const baselineKcal = baseline?.kcal ?? null;
  const baselineProtein = baseline?.protein ?? null;
  const baselineFat = baseline?.fat ?? null;

  const practicalCarbs =
    baselineCarbs === null
      ? input.ideal.carbs_g
      : Math.min(input.ideal.carbs_g, roundToNearest(baselineCarbs + maxCarbJump, 10));
  const practicalKcal =
    baselineKcal === null
      ? input.ideal.target_kcal
      : Math.min(input.ideal.target_kcal, roundToNearest(baselineKcal + maxKcalJump, 50));
  const practicalProtein = Math.min(
    input.ideal.protein_g,
    Math.max(
      roundToNearest(proteinFloor, 5),
      baselineProtein === null ? roundToNearest(proteinFloor, 5) : roundToNearest(baselineProtein, 5)
    )
  );
  const practicalFat = Math.max(
    roundToNearest(fatFloor, 5),
    Math.min(
      input.ideal.fat_g,
      baselineFat === null ? input.ideal.fat_g : roundToNearest(Math.max(baselineFat, fatFloor), 5)
    )
  );

  return {
    target_kcal: practicalKcal,
    protein_g: practicalProtein,
    fat_g: practicalFat,
    carbs_g: practicalCarbs,
    kcal_per_kg: Number((practicalKcal / input.bodyweightKg).toFixed(1)),
    protein_g_per_kg: Number((practicalProtein / input.bodyweightKg).toFixed(2)),
    fat_g_per_kg: Number((practicalFat / input.bodyweightKg).toFixed(2)),
    carbs_g_per_kg: Number((practicalCarbs / input.bodyweightKg).toFixed(2)),
  };
}

export function buildNutritionNextWeekPlan(params: {
  bodyweightKg: number | null;
  planWeekFrom: string;
  planWeekTo: string;
  trainingContext: unknown;
  previousWeekDailyAnalysis?: unknown;
  /** Task 10: student goal. maintain (default) = current behavior; lose/gain shift targets. */
  goalType?: NutritionGoalType;
  /** Task 10++: anthropometrics for the lose/gain maintenance anchor (BMR + TP expenditure). */
  sex?: NutritionSex | null;
  heightCm?: number | null;
  ageYears?: number | null;
}): NutritionNextWeekPlan {
  const goalType: NutritionGoalType = params.goalType ?? "maintain";
  // Task 10++: for lose/gain the deficit/surplus is anchored on a corrected
  // maintenance = BMR (weight+sex, Mifflin when height/age known) × non-exercise
  // PAL + the day's actual TP training expenditure. maintain is untouched.
  const rmrKcal =
    params.bodyweightKg && params.bodyweightKg > 0 && goalType !== "maintain"
      ? estimateRestingMetabolicRate({
          bodyweightKg: params.bodyweightKg,
          sex: params.sex ?? null,
          heightCm: params.heightCm ?? null,
          ageYears: params.ageYears ?? null,
        }).rmrKcal
      : null;
  const maintenanceForDay = (exerciseKcal: number): number | null =>
    rmrKcal === null ? null : Math.round(rmrKcal * NON_EXERCISE_PAL + exerciseKcal);
  // For lose/gain the plan is anchored on the corrected maintenance, NOT the
  // last-week practical baseline (which could pull a losing athlete back up toward
  // a surplus). maintain keeps the existing baseline-aware practical target.
  const resolveDayTarget = (
    dayType: NutritionPlanDayType,
    ideal: NutritionDayTypeTarget | null,
    baseline: PreviousWeekMacroPoint | null,
    exerciseKcal: number,
    raceWeekDeficitOff = false
  ): NutritionDayTypeTarget | null =>
    goalType === "maintain"
      ? applyPracticalTarget({ dayType, bodyweightKg: params.bodyweightKg, ideal, baseline })
      : applyNutritionGoalToDayTarget(ideal, {
          goalType,
          dayType,
          bodyweightKg: params.bodyweightKg,
          maintenanceKcal: maintenanceForDay(exerciseKcal),
          exerciseKcal,
          sex: params.sex ?? null,
          raceWeekDeficitOff,
        });
  const planDayExerciseKcal = (
    dayType: NutritionPlanDayType,
    durationHours: number | null,
    distanceKm: number | null,
    workoutTitle: string | null = null
  ): number =>
    params.bodyweightKg && params.bodyweightKg > 0
      ? estimatePlanDayExerciseKcal({ dayType, bodyweightKg: params.bodyweightKg, durationHours, distanceKm, workoutTitle })
      : 0;
  const dates = buildWeekDates(params.planWeekFrom, params.planWeekTo);
  const parsedWorkouts = parseTrainingContextWorkouts(params.trainingContext);
  const hasTrainingContext = parsedWorkouts.length > 0;
  const warnings: string[] = [];
  if (!hasTrainingContext) {
    warnings.push("training_context_missing");
  }
  if (!params.bodyweightKg || params.bodyweightKg <= 0) {
    warnings.push("missing_bodyweight");
  }

  const workoutsByDate = new Map<string, ParsedWorkout[]>();
  for (const workout of parsedWorkouts) {
    const list = workoutsByDate.get(workout.date) ?? [];
    list.push(workout);
    workoutsByDate.set(workout.date, list);
  }

  const longRunDates = new Set(
    parsedWorkouts
      .filter((workout) => workout.dayType === "long_run" || workout.dayType === "long_endurance")
      .map((workout) => workout.date)
  );
  // Наряд 3: race-week = the lead-up (loading window, or ~2 days for short races),
  // the race day, and the recovery day after. On these days a losing athlete's
  // deficit is switched off (fuel for the start; loading wins over weight loss).
  const raceWeekDates = new Set<string>();
  for (const workout of parsedWorkouts) {
    if (workout.dayType !== "race") {
      continue;
    }
    const protocol = computeNutritionRaceProtocol({ distanceKm: workout.distanceKm, title: workout.title });
    const leadDays = protocol.loading?.days ?? 2;
    for (let offset = -leadDays; offset <= 1; offset += 1) {
      raceWeekDates.add(addDays(workout.date, offset));
    }
  }
  const previousWeekTargets = extractPreviousWeekTargets(params.previousWeekDailyAnalysis);

  const days: NutritionNextWeekPlanDay[] = dates.map((date) => {
    const dayWorkouts = workoutsByDate.get(date) ?? [];
    const primaryWorkout = pickPrimaryWorkout(dayWorkouts);
    const baseType = primaryWorkout?.dayType ?? (hasTrainingContext ? "rest" : "unknown");
    const dayBeforeLongRun = longRunDates.has(addDays(date, 1));
    const harder =
      baseType === "race" || baseType === "long_run" || baseType === "long_endurance" || baseType === "hard";
    const trainingType: NutritionPlanDayType = dayBeforeLongRun && !harder ? "pre_long" : baseType;
    const hasWorkout = Boolean(primaryWorkout);
    const idealTarget = calculateNutritionDayTypeTarget({
      bodyweightKg: params.bodyweightKg,
      dayType: trainingType,
    });
    const baseline =
      previousWeekTargets.byDayType[trainingType] ??
      (trainingType === "race" ? previousWeekTargets.byDayType.hard ?? null : null) ??
      previousWeekTargets.overall;
    const dayExerciseKcal = planDayExerciseKcal(
      trainingType,
      primaryWorkout?.durationHours ?? null,
      primaryWorkout?.distanceKm ?? null,
      primaryWorkout?.title ?? null
    );
    const practicalTarget = resolveDayTarget(trainingType, idealTarget, baseline, dayExerciseKcal, raceWeekDates.has(date));

    let source: NutritionPlanSource = "unknown";
    if (!params.bodyweightKg || params.bodyweightKg <= 0) {
      source = "missing_bodyweight";
    } else if (!hasTrainingContext) {
      source = "generic_day_type";
    } else if (dayBeforeLongRun && !harder) {
      source = "inferred_from_week_structure";
    } else if (hasWorkout) {
      source = "tp_workout";
    } else if (trainingType === "rest") {
      source = "inferred_from_week_structure";
    }

    return {
      date,
      weekday_ru: toWeekdayRu(date),
      training_type: trainingType,
      training_label: getTrainingLabel(trainingType, primaryWorkout?.title ?? null),
      workout_title: primaryWorkout?.title ?? null,
      target_kcal: practicalTarget?.target_kcal ?? null,
      protein_g: practicalTarget?.protein_g ?? null,
      fat_g: practicalTarget?.fat_g ?? null,
      carbs_g: practicalTarget?.carbs_g ?? null,
      kcal_per_kg: practicalTarget?.kcal_per_kg ?? null,
      protein_g_per_kg: practicalTarget?.protein_g_per_kg ?? null,
      fat_g_per_kg: practicalTarget?.fat_g_per_kg ?? null,
      carbs_g_per_kg: practicalTarget?.carbs_g_per_kg ?? null,
      flags: {
        rest: trainingType === "rest",
        easy: trainingType === "easy",
        hard: trainingType === "hard",
        pre_long: trainingType === "pre_long",
        long_run: trainingType === "long_run",
        strength: trainingType === "strength",
        cross_training: trainingType === "cross_training",
        race: trainingType === "race",
        key_workout:
          trainingType === "hard" ||
          trainingType === "long_run" ||
          trainingType === "long_endurance" ||
          trainingType === "race",
        day_before_long_run: dayBeforeLongRun,
        has_training_context: hasWorkout,
      },
      long_run_source: trainingType === "long_run" ? primaryWorkout?.longRunSource ?? "none" : "none",
      long_run_confidence: trainingType === "long_run" ? primaryWorkout?.longRunConfidence ?? "low" : "low",
      pre_training_guidance: GUIDANCE_BY_DAY_TYPE[trainingType],
      race_protocol:
        trainingType === "race"
          ? computeNutritionRaceProtocol({
              distanceKm: primaryWorkout?.distanceKm ?? null,
              title: primaryWorkout?.title ?? null,
            })
          : null,
      source,
      ideal_target: idealTarget,
      practical_target: practicalTarget,
      display_target: {
        kcal_min: practicalTarget ? roundToNearest(practicalTarget.target_kcal - 50, 50) : null,
        kcal_max: practicalTarget ? roundToNearest(practicalTarget.target_kcal + 50, 50) : null,
        carbs_g_min: practicalTarget ? roundToNearest(practicalTarget.carbs_g - 20, 10) : null,
        carbs_g_max: practicalTarget ? roundToNearest(practicalTarget.carbs_g + 20, 10) : null,
      },
    };
  });

  const longRunDay = days.find((day) => day.training_type === "long_run") ?? null;
  const longEnduranceDay = days.find((day) => day.training_type === "long_endurance") ?? null;

  const preLongTarget = days.find((day) => day.training_type === "pre_long")?.practical_target ?? null;
  const longDay =
    days.find((day) => day.training_type === "long_endurance") ??
    days.find((day) => day.training_type === "long_run") ??
    null;
  const longDayTarget = longDay?.practical_target ?? null;
  if (preLongTarget && longDayTarget && longDay) {
    if (longDayTarget.carbs_g < preLongTarget.carbs_g) {
      longDayTarget.carbs_g = preLongTarget.carbs_g;
      longDayTarget.carbs_g_per_kg = Number((longDayTarget.carbs_g / (params.bodyweightKg ?? 1)).toFixed(2));
      longDayTarget.target_kcal = Math.max(longDayTarget.target_kcal, preLongTarget.target_kcal);
      longDayTarget.kcal_per_kg = Number((longDayTarget.target_kcal / (params.bodyweightKg ?? 1)).toFixed(1));
    }
    longDay.carbs_g = longDayTarget.carbs_g;
    longDay.target_kcal = longDayTarget.target_kcal;
    longDay.kcal_per_kg = longDayTarget.kcal_per_kg;
    longDay.carbs_g_per_kg = longDayTarget.carbs_g_per_kg;
    longDay.display_target = {
      kcal_min: roundToNearest(longDayTarget.target_kcal - 50, 50),
      kcal_max: roundToNearest(longDayTarget.target_kcal + 50, 50),
      carbs_g_min: roundToNearest(longDayTarget.carbs_g - 20, 10),
      carbs_g_max: roundToNearest(longDayTarget.carbs_g + 20, 10),
    };
    const preLongDay = days.find((day) => day.training_type === "pre_long");
    if (
      preLongDay?.display_target?.carbs_g_min != null &&
      longDay.display_target.carbs_g_min != null &&
      longDay.display_target.carbs_g_min < preLongDay.display_target.carbs_g_min
    ) {
      longDay.display_target.carbs_g_min = preLongDay.display_target.carbs_g_min;
      longDay.display_target.carbs_g_max = Math.max(
        longDay.display_target.carbs_g_max ?? longDay.display_target.carbs_g_min,
        preLongDay.display_target.carbs_g_max ?? preLongDay.display_target.carbs_g_min
      );
    }
  }

  return {
    formula_version: "nutrition_next_week_plan_v1",
    bodyweight_kg: params.bodyweightKg ?? null,
    rounding: {
      kcal: "nearest_50",
      carbs_g: "nearest_10",
      protein_g: "nearest_5",
      fat_g: "nearest_5",
    },
    days,
    day_type_targets: {
      rest: resolveDayTarget(
        "rest",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "rest" }),
        previousWeekTargets.byDayType.rest ?? previousWeekTargets.overall,
        planDayExerciseKcal("rest", null, null)
      ),
      easy: resolveDayTarget(
        "easy",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "easy" }),
        previousWeekTargets.byDayType.easy ?? previousWeekTargets.overall,
        planDayExerciseKcal("easy", null, null)
      ),
      hard: resolveDayTarget(
        "hard",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "hard" }),
        previousWeekTargets.byDayType.hard ?? previousWeekTargets.overall,
        planDayExerciseKcal("hard", null, null)
      ),
      pre_long: resolveDayTarget(
        "pre_long",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "pre_long" }),
        previousWeekTargets.byDayType.pre_long ?? previousWeekTargets.overall,
        planDayExerciseKcal("pre_long", null, null)
      ),
      long_run: resolveDayTarget(
        "long_run",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_run" }),
        previousWeekTargets.byDayType.long_run ?? previousWeekTargets.overall,
        planDayExerciseKcal("long_run", null, null)
      ),
      long_endurance: resolveDayTarget(
        "long_endurance",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_endurance" }),
        previousWeekTargets.byDayType.long_run ?? previousWeekTargets.overall,
        planDayExerciseKcal("long_endurance", null, null)
      ),
      strength: resolveDayTarget(
        "strength",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "strength" }),
        previousWeekTargets.byDayType.strength ?? previousWeekTargets.overall,
        planDayExerciseKcal("strength", null, null)
      ),
      cross_training: resolveDayTarget(
        "cross_training",
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "cross_training" }),
        previousWeekTargets.byDayType.cross_training ?? previousWeekTargets.overall,
        planDayExerciseKcal("cross_training", null, null)
      ),
    },
    day_type_ideal_targets: {
      rest: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "rest" }),
      easy: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "easy" }),
      hard: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "hard" }),
      pre_long: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "pre_long" }),
      long_run: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_run" }),
      long_endurance: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_endurance" }),
      strength: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "strength" }),
      cross_training: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "cross_training" }),
    },
    summary: {
      has_training_context: hasTrainingContext,
      total_days: days.length,
      days_with_training: days.filter((day) => day.flags.has_training_context).length,
      key_days_count: days.filter((day) => day.flags.key_workout || day.flags.day_before_long_run).length,
      long_run_dates: days
        .filter((day) => day.training_type === "long_run" || day.training_type === "long_endurance")
        .map((day) => day.date),
      long_run_source: longRunDay?.long_run_source ?? (longEnduranceDay ? "duration" : "none"),
      long_run_confidence: longRunDay?.long_run_confidence ?? (longEnduranceDay ? "medium" : "low"),
      hard_dates: days.filter((day) => day.training_type === "hard").map((day) => day.date),
      missing_bodyweight: !params.bodyweightKg || params.bodyweightKg <= 0,
    },
    warnings,
  };
}
