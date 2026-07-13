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

/**
 * Health of the workout-cache scan covering the PLAN week.
 *
 * "ok" = the scan ran and came back clean, so an EMPTY week is a REAL week without
 * training (illness / recovery / not written in TP yet) — not a hole in the data.
 * "failed" / "missing" (and absent) = we cannot vouch for the week; an empty week
 * there is a data gap and must NOT be turned into confident rest days.
 *
 * Same discriminator the review already uses (inferCanonicalTrainingType in
 * methodology.ts, via the week context's cacheStatus).
 */
export type NutritionPlanWeekScanState = "ok" | "failed" | "missing";

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
  trainingPeaksDurationHoursToMinutes,
  type NutritionLongRunSource,
} from "@/features/nutrition/long-run";
import {
  isNutritionTrivialShortActivity,
  resolveNutritionActivityCoefByTitle,
  sumDaySessionsExpenditureKcal,
} from "@/features/nutrition/activity-energy";
import {
  resolveCarbLoadBasis,
  resolveCarbRangeByLoadBasis,
  type NutritionCarbLoadBasis,
} from "@/features/nutrition/methodology";
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
    /** Carb-loading lead-up day or race day (HM+): carbs lifted from the real base. */
    carb_loading?: boolean;
    /** Day right after a race: recovery target (glycogen + repair), deficit off. */
    recovery?: boolean;
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
    /**
     * The plan week has NO workouts and the scan covering it is healthy: a real
     * training-free week, planned as maintenance (даже цели по дням, rest-формула).
     * False when the week is empty because the scan failed / never ran — that stays
     * a data gap with null targets.
     */
    no_training_week_maintenance: boolean;
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
  // Base race-day target = intense (hard) level: covers short races (10K / <90 min,
  // no multi-day loading) and the unknown-distance default. Half-marathon+ bumps
  // carbs to the loading level via computeRaceDayTarget (distance source of truth
  // stays computeNutritionRaceProtocol). Без этого race-день шёл null → мини-таблица «н/д».
  race: { kcalPerKg: 43, proteinPerKg: 1.7, fatPerKg: 1.15, carbsPerKg: 6.0 },
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
  /**
   * Structural flag: when loading applies, the renderer adds a hydration/fibre
   * reminder for the loading days (drink more; the scale bump is water, not fat;
   * top up carbs with liquids; ease off raw veg/fibre the day before). Carries no
   * numbers, so it never trips the prose number validator.
   */
  loading_hydration_note: boolean;
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
    loading_hydration_note: loading != null,
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

// Mirror of methodology.isLightIntermittentCrossTrainingTitle — kept local to avoid an
// import cycle (methodology → activity-energy → weekly-plan-formulas). Light intermittent
// play / walking (padel, tennis, walk, hike) is fuelled below endurance; bike/swim are
// intentionally NOT matched here so they keep the full cross-training carb level.
function isLightIntermittentCrossTrainingTitle(title: string): boolean {
  const t = title.toLowerCase();
  return /\bpadel\b|падел|\b(?:walk|walking|hike|hiking|trek|tennis)\b|ходьб|прогулк|поход|хайк|теннис/.test(t);
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
      // An explicit race (incl. a reconciled marathon) keeps dayType "race": its long
      // duration must not demote it to long_endurance/long_run, or the carb-loading
      // window (which filters dayType === "race") would never anchor on it.
      if (dayType !== "race") {
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
    .filter((out) => out.date !== "unknown-date")
    // Поток D-5: drop a trivially short non-essential activity (walk/tennis <20 min,
    // swim/bike <15 min) from the plan's load aggregate so a 10-min dip doesn't make a
    // training day. Run/strength have no threshold. A day with a real session keeps it.
    .filter(
      (out) =>
        !isNutritionTrivialShortActivity({
          title: out.title,
          durationMinutes: trainingPeaksDurationHoursToMinutes(out.durationHours),
        })
    );

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

/**
 * The one rule that makes the plan's numbers add up: THE KCAL ARE THE MACROS.
 *
 * Everything the athlete reads on a plan line comes from one object —
 * «🛌 День отдыха - ~2000 ккал · 90 Б · 60 Ж · 190 У» — so the kcal figure has to be what those
 * grams actually contain. It wasn't: maintain fixed all four numbers from independent tables and
 * they disagreed by 10–18% (rest 55 kg: 1950 shown, 1660 in the food). A student who adds it up
 * finds a fifth of her calories unaccounted for.
 *
 * Applied at EVERY point a target is produced or lifted (day-type, goal, race, loading, recovery),
 * so coherence is an invariant rather than a thing to remember: whoever adds the next macro rule
 * gets a consistent kcal for free, and no floor or bump can silently reopen the gap.
 *
 * Direction is always safe: a floor that lifts a macro lifts the kcal to match — more food, never
 * less. It never overrides a floor by cutting food to fit a number.
 */
function reconcileKcalWithMacros(target: NutritionDayTypeTarget, bodyweightKg: number): NutritionDayTypeTarget {
  const kcal = roundToNearest(target.protein_g * 4 + target.fat_g * 9 + target.carbs_g * 4, 50);
  return {
    ...target,
    target_kcal: kcal,
    kcal_per_kg: Number((kcal / bodyweightKg).toFixed(1)),
  };
}

export function calculateNutritionDayTypeTarget(params: {
  bodyweightKg: number | null;
  dayType: NutritionPlanDayType;
  isLightCross?: boolean;
  /** Real planned/completed duration of the day's session, if known — only
   * moves the number for long_run (duration-graduated corridor). */
  durationHours?: number | null;
}): NutritionDayTypeTarget | null {
  if (!params.bodyweightKg || params.bodyweightKg <= 0) {
    return null;
  }
  const formulaBase = FORMULA_BY_DAY_TYPE[params.dayType];
  if (!formulaBase) {
    return null;
  }
  const bw = params.bodyweightKg;
  // SINGLE SOURCE for the carb target: the same coach-approved corridor that drives the review's
  // ok/low status (resolveCarbRangeByLoadBasis). The plan aims at the MIDDLE of that corridor.
  //
  // It used to aim at the corridor's LOWER bound + 0.4 — i.e. the plan told the athlete to eat at
  // the floor of what the review would still accept. That is not a target, it is a minimum, and it
  // is what collapsed the day's energy (rest 55 kg: 190 g of carbs, ~240 kcal below the day's own
  // kcal figure). The midpoint is a real «aim for this», and it is inside the corridor by
  // construction — so the review can never flag the plan's own target as low, which was the whole
  // point of unifying them.
  //
  // kcal are NOT read from the table any more: they are the macros (reconcileKcalWithMacros).
  // protein/fat stay on the fixed-coefficient table.
  // Duration feeds every duration-scaled corridor (long_run and hard), not long_run
  // only — the plan target must land inside the corridor the review then judges by.
  const durationMinutes = trainingPeaksDurationHoursToMinutes(params.durationHours ?? null);
  const loadBasis: NutritionCarbLoadBasis = resolveCarbLoadBasis(params.dayType);
  const carbRange = resolveCarbRangeByLoadBasis(
    loadBasis,
    durationMinutes,
    params.isLightCross,
    params.dayType === "race"
  );
  const carbsPerKg =
    carbRange.rangeMinGPerKg !== null && carbRange.rangeMaxGPerKg !== null
      ? Number(((carbRange.rangeMinGPerKg + carbRange.rangeMaxGPerKg) / 2).toFixed(2))
      : formulaBase.carbsPerKg;
  const proteinG = roundToNearest(formulaBase.proteinPerKg * bw, 5);
  const fatG = roundToNearest(formulaBase.fatPerKg * bw, 5);
  const carbsG = roundToNearest(carbsPerKg * bw, 10);
  return reconcileKcalWithMacros(
    {
      target_kcal: 0, // set by reconcileKcalWithMacros — the macros ARE the kcal
      protein_g: proteinG,
      fat_g: fatG,
      carbs_g: carbsG,
      kcal_per_kg: 0,
      protein_g_per_kg: formulaBase.proteinPerKg,
      fat_g_per_kg: formulaBase.fatPerKg,
      carbs_g_per_kg: carbsPerKg,
    },
    bw
  );
}

/**
 * Race-day ideal target. Base = the intense (race/hard) day-type target; for a
 * half-marathon+ (≥21 km) the carbohydrate target is raised to the loading level,
 * with distance read from the SINGLE source of truth (computeNutritionRaceProtocol)
 * — no second distance ladder here. Short races (10K / <90 min, loading=null) and
 * unknown distance keep the intense base (never null). kcal rises to cover the extra
 * loading carbs. The lose deficit-off in race-week is applied later by resolveDayTarget.
 */
export function computeRaceDayTarget(params: {
  bodyweightKg: number | null;
  distanceKm: number | null;
  title?: string | null;
}): NutritionDayTypeTarget | null {
  const base = calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "race" });
  if (!base || !params.bodyweightKg || params.bodyweightKg <= 0) {
    return base;
  }
  const protocol = computeNutritionRaceProtocol({ distanceKm: params.distanceKm, title: params.title ?? null });
  if (!protocol.loading) {
    return base; // 10K / short / unknown → intense base, no multi-day loading.
  }
  const bw = params.bodyweightKg;
  const carbsPerKg = protocol.loading.g_per_kg_high;
  // The loading carbs are the only thing that moves; the kcal follow them (reconcile), so the
  // race line adds up exactly like every other day instead of re-deriving kcal from a per-kg
  // figure that rounds apart from the grams.
  return reconcileKcalWithMacros(
    {
      ...base,
      carbs_g: roundToNearest(carbsPerKg * bw, 10),
      carbs_g_per_kg: carbsPerKg,
    },
    bw
  );
}

// Carb-loading base: a logged day is only counted toward the loading base if it
// has more than this many carb grams. Days at/below are treated as UNDER-recorded
// (a forgotten dinner), NOT a genuinely starved day — counting them would pull the
// base down and under-load the athlete before a start. A real low day (60–80 g)
// stays in and keeps the base honest and conservative.
export const CARB_LOADING_MIN_LOGGED_G = 50;

// Carb-loading step over the athlete's real base (tunable 0.20–0.30). The loading
// target lifts the base by this fraction, capped at the protocol corridor's upper
// bound and never cut below the base.
export const CARB_LOADING_STEP = 0.3;

/**
 * Absolute floor for the pre-race loading days and the start day, in g/kg — nobody toes a start
 * below this, however modest their logged base.
 *
 * It is DELIBERATELY its own number and not the easy-day target. The floor used to be «the
 * athlete's easy-run carbs», which silently coupled the start line to a training-day setting: when
 * the easy target was re-tuned (corridor floor → corridor middle), the loading floor moved with it
 * and a low-base athlete's start-day carbs slid from 290 g to 210 g at 55 kg without anyone
 * choosing that. Filling a glycogen store before a race and fuelling an easy jog are different
 * questions and must not share a number.
 *
 * 5.3 g/kg reproduces the historical floor at the reference athlete (5.3 × 55 = 291.5 → 290 g) and
 * always sits well under the protocol ceiling (HM 8 / M 9 / ultra 10 g/kg), so it can only lift a
 * modest base from below — it never caps a well-fuelled one from above.
 */
export const CARB_LOADING_FLOOR_G_PER_KG = 5.3;

/**
 * Carb-loading BASE from the previous week's REAL per-day carbohydrate intake
 * (parsed report, not the plan). The base is the MEAN of the usable days — not the
 * peak, not the upper corridor — so loading lifts from where the athlete actually
 * eats and never overloads the gut. Days at/below CARB_LOADING_MIN_LOGGED_G are
 * dropped as under-recorded. Returns null when nothing usable remains (caller then
 * skips loading and falls back to the standard protocol target).
 */
export function computeCarbBaseFromReview(perDayCarbsG: number[]): number | null {
  const usable = perDayCarbsG.filter(
    (grams) => typeof grams === "number" && Number.isFinite(grams) && grams > CARB_LOADING_MIN_LOGGED_G
  );
  if (usable.length === 0) {
    return null;
  }
  const sum = usable.reduce((acc, grams) => acc + grams, 0);
  return sum / usable.length;
}

/**
 * Carb-loading carb grams for the lead-up days and the race day, anchored on the
 * athlete's real base (computeCarbBaseFromReview), not an absolute g/kg figure.
 *
 * - ceiling = corridor upper bound × weight (HM 8 / M 9 / ultra 10 g/kg — passed
 *   in from computeNutritionRaceProtocol, never hard-coded here).
 * - target  = max( min(base × (1 + STEP), ceiling), base ): lift the base by STEP
 *   but never above the corridor and never below the base (a base above the
 *   ceiling holds the base — we don't cut someone who already eats plenty).
 *   The corridor LOWER bound is NOT forced: a target below 6 g/kg is fine when it
 *   comes from a real, modest base — no artificial jump.
 * - ramp: leadDays[i] = round(base + (target − base) × i/N) for i = 1..N, so the
 *   last lead day (the day before the start) reaches the full target.
 * - raceDay = round(target) (timing/gel/"2–3 h before" stay in the protocol).
 * - floorG: every loading day AND the start day is floored at this (the dedicated
 *   CARB_LOADING_FLOOR_G_PER_KG, NOT the easy-day target — see that constant), so a modest
 *   weekly-average base cannot ramp a start day down to an ordinary training number. The floor
 *   only lifts from below; the ceiling still caps the top, and the base-driven ramp is untouched
 *   whenever it already clears the floor. Default 0 = no floor.
 */
export function computeCarbLoadingTargets(params: {
  baseG: number;
  weightKg: number;
  corridorUpperGkg: number;
  leadDayCount: number;
  floorG?: number;
}): { leadDays: number[]; raceDay: number } {
  const ceilingG = params.corridorUpperGkg * params.weightKg;
  const targetG = Math.max(Math.min(params.baseG * (1 + CARB_LOADING_STEP), ceilingG), params.baseG);
  const floorG = params.floorG ?? 0;
  const n = Math.max(1, Math.round(params.leadDayCount));
  const leadDays: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    const ramp = params.baseG + (targetG - params.baseG) * (i / n);
    leadDays.push(Math.max(Math.round(ramp), Math.round(floorG)));
  }
  return { leadDays, raceDay: Math.max(Math.round(targetG), Math.round(floorG)) };
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
  if (
    (dayType === "long_run" || dayType === "long_endurance" || dayType === "race") &&
    params.distanceKm &&
    params.distanceKm > 0
  ) {
    // A reconciled race carries the OFFICIAL distance, so the day's expenditure is
    // distance×bw on the clean figure (one session, not race + inflated-GPS run).
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
    /**
     * Lose ramp: the athlete's real average intake (kcal) from the reviewed week.
     * When present, the lose target is the next achievable step (base + 600) capped
     * at the scientific absolute — not the textbook absolute itself. null/absent →
     * no intake history → fall back to the scientific absolute with EA/abs floors.
     */
    actualBaseKcal?: number | null;
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
    const scientific = maintenance - deficit;
    const base = params.actualBaseKcal && params.actualBaseKcal > 0 ? params.actualBaseKcal : null;
    // Ramp, not jump: show the next ACHIEVABLE step from the athlete's real intake
    // base (avg kcal of the reviewed week), capped at the scientific absolute. base+600
    // is always > base, so we never recommend less than she already eats (no RED-S by
    // reduction); the base re-bases each week, so the step climbs to `scientific` over
    // ~2-4 weeks. Hard lower nets (rest 1650 / other 1600) catch an anomalously low
    // single week (e.g. an illness week 800 → 1400 → lifted to the net). These nets
    // are deliberately NOT the EA floor (FFM·30 + exercise): that would restore the
    // absolute on loaded days and kill the ramp (accepted trade-off — a transitional
    // loaded-day EA may dip below 30, the athlete still eats MORE than before).
    // No intake history (base null, first review) → fall back to the scientific
    // absolute guarded by the EA/absolute floors.
    let rawKcal: number;
    if (base !== null) {
      const step = Math.min(scientific, base + 600);
      const hardFloor = params.dayType === "rest" ? 1650 : 1600;
      rawKcal = Math.max(step, hardFloor);
    } else {
      const eaFloor = ffmKgForSex(bw, params.sex ?? null) * 30 + exercise;
      const absFloor = Math.max(26 * bw, 1400);
      rawKcal = Math.max(scientific, Math.max(eaFloor, absFloor));
    }
    const kcal = roundToNearest(rawKcal, 50);
    const proteinG = roundToNearest(1.9 * bw, 5);
    // Fat ~0.9 g/kg, but clamp to 20–30% of energy.
    const fatMin = (0.2 * kcal) / 9;
    const fatMax = (0.3 * kcal) / 9;
    const fatG = roundToNearest(Math.min(Math.max(0.9 * bw, fatMin), fatMax), 5);
    const carbsFloor = roundToNearest(2.0 * bw, 10);
    const carbsRemainder = (kcal - proteinG * 4 - fatG * 9) / 4;
    const carbsG = Math.max(roundToNearest(carbsRemainder, 10), carbsFloor);
    // Carbs are the remainder here, so kcal and macros already agree — EXCEPT when the 2 g/kg carb
    // floor wins, and then the food on the plate exceeds the kcal line. Reconciling lifts the kcal
    // to the food, never the other way round: the floor exists to stop a dangerous carb cut, and it
    // must not be quietly undone to make a number look right.
    return reconcileKcalWithMacros(
      {
        target_kcal: kcal,
        protein_g: proteinG,
        fat_g: fatG,
        carbs_g: carbsG,
        kcal_per_kg: Number((kcal / bw).toFixed(1)),
        protein_g_per_kg: roundPerKg(proteinG, bw),
        fat_g_per_kg: roundPerKg(fatG, bw),
        carbs_g_per_kg: roundPerKg(carbsG, bw),
      },
      bw
    );
  }

  // gain: surplus on the corrected maintenance.
  const kcal = roundToNearest(maintenance * 1.11, 50);
  const proteinG = roundToNearest(1.8 * bw, 5);
  const fatG = roundToNearest(1.0 * bw, 5);
  // The floor reads the MAINTAIN carb target (ideal.carbs_g) — a gaining athlete must never be fed
  // fewer carbs than a maintaining one. That floor now bites: with the maintain target at the
  // corridor's middle it beats the surplus remainder on the low-exercise days (pre_long, rest,
  // cross, strength) and the macros outgrow the kcal — up to +410 kcal at 70 kg on pre_long.
  // Reconciling below settles it the safe way: the kcal follow the food.
  const carbsG = roundToNearest(Math.max((kcal - proteinG * 4 - fatG * 9) / 4, ideal.carbs_g), 10);
  return reconcileKcalWithMacros(
    {
      target_kcal: kcal,
      protein_g: proteinG,
      fat_g: fatG,
      carbs_g: carbsG,
      kcal_per_kg: Number((kcal / bw).toFixed(1)),
      protein_g_per_kg: roundPerKg(proteinG, bw),
      fat_g_per_kg: roundPerKg(fatG, bw),
      carbs_g_per_kg: roundPerKg(carbsG, bw),
    },
    bw
  );
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

/**
 * Real per-day carbohydrate grams from the previous week's parsed report — the
 * raw series fed to computeCarbBaseFromReview (which drops under-recorded days).
 * Mirrors extractPreviousWeekTargets' field resolution (actual.carbsG first).
 */
function extractPreviousWeekCarbsPerDay(previousWeekDailyAnalysis: unknown): number[] {
  const days = Array.isArray(previousWeekDailyAnalysis) ? previousWeekDailyAnalysis : [];
  const carbs: number[] = [];
  for (const item of days) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const actual =
      record.actual && typeof record.actual === "object" && !Array.isArray(record.actual)
        ? (record.actual as Record<string, unknown>)
        : {};
    const value = toFinite(actual.carbsG ?? record.carbsG ?? record.carbs_g);
    if (value !== null) {
      carbs.push(value);
    }
  }
  return carbs;
}

/**
 * Override a plan day's carbohydrates with the carb-loading target and recompute
 * kcal from the three macros (4·carb + 4·protein + 9·fat). Protein and fat are
 * left exactly as the day formula produced them — only carbs (and the kcal that
 * follow) change. Updates carbs_g/kcal, the per-kg figures, practical_target, the
 * display ranges, and marks the carb_loading flag. No-op if the day has no macro
 * numbers (missing bodyweight).
 */
function applyCarbLoadingToPlanDay(day: NutritionNextWeekPlanDay, carbsG: number, bodyweightKg: number): void {
  if (day.carbs_g === null || day.protein_g === null || day.fat_g === null) {
    return;
  }
  const protein = day.protein_g;
  const fat = day.fat_g;
  const kcal = roundToNearest(4 * carbsG + 4 * protein + 9 * fat, 50);
  day.carbs_g = carbsG;
  day.carbs_g_per_kg = Number((carbsG / bodyweightKg).toFixed(2));
  day.target_kcal = kcal;
  day.kcal_per_kg = Number((kcal / bodyweightKg).toFixed(1));
  if (day.practical_target) {
    day.practical_target = {
      ...day.practical_target,
      carbs_g: carbsG,
      carbs_g_per_kg: day.carbs_g_per_kg,
      target_kcal: kcal,
      kcal_per_kg: day.kcal_per_kg,
    };
  }
  day.display_target = {
    kcal_min: roundToNearest(kcal - 50, 50),
    kcal_max: roundToNearest(kcal + 50, 50),
    carbs_g_min: roundToNearest(carbsG - 20, 10),
    carbs_g_max: roundToNearest(carbsG + 20, 10),
  };
  day.flags.carb_loading = true;
}

// Protein for glycogen + tissue repair on a recovery day — upper of the repair band.
const RECOVERY_PROTEIN_G_PER_KG = 1.8;

/**
 * Recovery target for the day right AFTER a race: carbs at least the easy-run level
 * (glycogen resynthesis), protein at the upper repair band (~1.8 g/kg), fat left as
 * computed; kcal recomputed; the lose-deficit is already off on race-week days.
 * Never lowers an existing macro — only lifts toward recovery.
 */
function applyRecoveryToPlanDay(day: NutritionNextWeekPlanDay, bodyweightKg: number, easyCarbFloorG: number): void {
  if (day.carbs_g === null || day.protein_g === null || day.fat_g === null) {
    return;
  }
  const carbs = Math.max(day.carbs_g, Math.round(easyCarbFloorG));
  const protein = Math.max(day.protein_g, roundToNearest(RECOVERY_PROTEIN_G_PER_KG * bodyweightKg, 5));
  const fat = day.fat_g;
  const kcal = roundToNearest(4 * carbs + 4 * protein + 9 * fat, 50);
  day.carbs_g = carbs;
  day.protein_g = protein;
  day.target_kcal = kcal;
  day.carbs_g_per_kg = Number((carbs / bodyweightKg).toFixed(2));
  day.protein_g_per_kg = Number((protein / bodyweightKg).toFixed(2));
  day.kcal_per_kg = Number((kcal / bodyweightKg).toFixed(1));
  if (day.practical_target) {
    day.practical_target = {
      ...day.practical_target,
      carbs_g: carbs,
      protein_g: protein,
      target_kcal: kcal,
      carbs_g_per_kg: day.carbs_g_per_kg,
      protein_g_per_kg: day.protein_g_per_kg,
      kcal_per_kg: day.kcal_per_kg,
    };
  }
  day.display_target = {
    kcal_min: roundToNearest(kcal - 50, 50),
    kcal_max: roundToNearest(kcal + 50, 50),
    carbs_g_min: roundToNearest(carbs - 20, 10),
    carbs_g_max: roundToNearest(carbs + 20, 10),
  };
  // Label the day as recovery so the mini-table and prose read «восстановление»
  // (not «день отдыха»); numbers above are unchanged.
  day.training_label = "восстановление после старта";
  day.flags.recovery = true;
}

/**
 * Build a recovery day for a date that falls OUTSIDE the Mon–Sun plan window (a
 * Sunday race → the next Monday). It is appended to the plan's display days WITHOUT
 * changing plan_week.from/to — the week key stays Mon–Sun so plan↔review↔report
 * pairing by exact week is untouched. Modelled as a rest day, then recovery-lifted.
 */
function buildRecoveryAppendedDay(
  date: string,
  bodyweightKg: number,
  easyCarbFloorG: number
): NutritionNextWeekPlanDay {
  const restIdeal = calculateNutritionDayTypeTarget({ bodyweightKg, dayType: "rest" });
  const day: NutritionNextWeekPlanDay = {
    date,
    weekday_ru: toWeekdayRu(date),
    training_type: "rest",
    training_label: "восстановление после старта",
    workout_title: null,
    target_kcal: restIdeal?.target_kcal ?? null,
    protein_g: restIdeal?.protein_g ?? null,
    fat_g: restIdeal?.fat_g ?? null,
    carbs_g: restIdeal?.carbs_g ?? null,
    kcal_per_kg: restIdeal?.kcal_per_kg ?? null,
    protein_g_per_kg: restIdeal?.protein_g_per_kg ?? null,
    fat_g_per_kg: restIdeal?.fat_g_per_kg ?? null,
    carbs_g_per_kg: restIdeal?.carbs_g_per_kg ?? null,
    flags: {
      rest: true,
      easy: false,
      hard: false,
      pre_long: false,
      long_run: false,
      strength: false,
      cross_training: false,
      race: false,
      key_workout: false,
      day_before_long_run: false,
      has_training_context: false,
      carb_loading: false,
      recovery: false,
    },
    long_run_source: "none",
    long_run_confidence: "low",
    pre_training_guidance: GUIDANCE_BY_DAY_TYPE.rest,
    race_protocol: null,
    source: "inferred_from_week_structure",
    ideal_target: restIdeal,
    practical_target: restIdeal,
    display_target: {
      kcal_min: restIdeal ? roundToNearest(restIdeal.target_kcal - 50, 50) : null,
      kcal_max: restIdeal ? roundToNearest(restIdeal.target_kcal + 50, 50) : null,
      carbs_g_min: restIdeal ? roundToNearest(restIdeal.carbs_g - 20, 10) : null,
      carbs_g_max: restIdeal ? roundToNearest(restIdeal.carbs_g + 20, 10) : null,
    },
  };
  applyRecoveryToPlanDay(day, bodyweightKg, easyCarbFloorG);
  return day;
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

  // Lower floor (maintain ≠ deficit): no day is fed below the REST band. Carbs are
  // floored at the rest level (4.5 г/кг) and, with protein/fat already at their floors,
  // the kcal that follow can't sink toward RMR (the easy-day-below-rest-day / ~1200 ккал
  // case). It also keeps a training day ≥ a rest day: a rest day lands at exactly the rest
  // band, every load day's band is ≥ rest, so flooring all days at the rest band leaves
  // load ≥ rest. The ramp's "don't jump" cap still applies ABOVE this floor, and the floor
  // never exceeds the day's own ideal band (rest is the lowest band) so nothing is
  // over-fuelled. lose/gain go through applyNutritionGoalToDayTarget and are untouched.
  const restCarbFloorG = roundToNearest((FORMULA_BY_DAY_TYPE.rest?.carbsPerKg ?? 4.5) * input.bodyweightKg, 10);
  const rampedCarbs =
    baselineCarbs === null
      ? input.ideal.carbs_g
      : Math.min(input.ideal.carbs_g, roundToNearest(baselineCarbs + maxCarbJump, 10));
  const practicalCarbs = Math.min(input.ideal.carbs_g, Math.max(rampedCarbs, restCarbFloorG));
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
  // Kcal ↔ macros consistency: the displayed kcal can NEVER read below its own macros.
  // The old target was min(ideal_kcal, baseline+jump), which on a low-intake day fell
  // BELOW the floored macros (the 1200-ккал-shown vs ~1760-from-macros bug). We floor the
  // kcal at the macro sum (4·carb+4·prot+9·fat). Where the ramp/band already sits ABOVE
  // the macros (a normally-fed day), that higher figure is kept — protein/fat are minimums
  // and the extra is discretionary energy, so a target is never LOWERED.
  const macroKcal = 4 * practicalCarbs + 4 * practicalProtein + 9 * practicalFat;
  const rampedKcal =
    baselineKcal === null
      ? input.ideal.target_kcal
      : Math.min(input.ideal.target_kcal, roundToNearest(baselineKcal + maxKcalJump, 50));
  const practicalKcal = roundToNearest(Math.max(rampedKcal, macroKcal), 50);

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
  /**
   * Health of the scan covering the plan week. Only "ok" lets a workout-less day
   * become a CONFIDENT rest day (see NutritionPlanWeekScanState). Absent = no scan
   * evidence = conservative: workout-less days stay "unknown" (null targets), so a
   * caller that cannot vouch for the data never gets invented numbers.
   */
  planWeekScanState?: NutritionPlanWeekScanState | null;
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
          // Lose ramp: real intake base = overall avg kcal of the reviewed week
          // (matches nutrition_summary.avg_kcal). null when no history → absolute fallback.
          actualBaseKcal: previousWeekTargets.overall.kcal ?? null,
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
  // A week with NO workouts is ambiguous: a REAL training-free week (illness,
  // recovery, week not written in TP yet) vs a scan that never brought the data.
  // The review already resolves exactly this ambiguity — inferCanonicalTrainingType
  // (methodology.ts): a day with no TP workout is a CONFIDENT rest day when the
  // week's scan came back healthy, and only an unhealthy scan leaves it "unknown".
  //
  // The plan had no scan signal at all and substituted a proxy: "does the week have
  // ANY workout". So a week with zero workouts made EVERY day "unknown" — a day type
  // with no row in FORMULA_BY_DAY_TYPE — and calculateNutritionDayTypeTarget returned
  // null for all eight days: a plan without a single number. Absurd by construction:
  // ONE workout in the week would have given every other day a normal rest target,
  // while NONE gave nothing. A sick athlete got strictly worse output than a training
  // one. Now the plan uses the same discriminator as the review: healthy scan ⇒ a day
  // without a workout is rest; unhealthy/absent scan ⇒ "unknown" (data gap, null).
  const planWeekScanHealthy = params.planWeekScanState === "ok";
  const noTrainingWeekMaintenance = !hasTrainingContext && planWeekScanHealthy;
  const warnings: string[] = [];
  if (noTrainingWeekMaintenance) {
    // Not a missing context — an UNDERSTOOD empty week, planned as maintenance.
    warnings.push("no_training_week_maintenance");
  } else if (!hasTrainingContext) {
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
  // Pre-race interval window: a short interval session 3-6 days before a start is an
  // intensity REFRESH (вт/ср перед сб/вс-стартом + lead погрешности), NOT heavy work —
  // питать как лёгкую, иначе перекармливаем предстартовые дни. Outside the window
  // intervals stay hard (see the day loop). Carb-loading (applied later) is independent
  // and still lifts these days; the race day itself is untouched (it's dayType "race").
  const preRaceIntervalDates = new Set<string>();
  for (const workout of parsedWorkouts) {
    if (workout.dayType !== "race") {
      continue;
    }
    for (let offset = -6; offset <= -3; offset += 1) {
      preRaceIntervalDates.add(addDays(workout.date, offset));
    }
  }
  const previousWeekTargets = extractPreviousWeekTargets(params.previousWeekDailyAnalysis);

  const days: NutritionNextWeekPlanDay[] = dates.map((date) => {
    const dayWorkouts = workoutsByDate.get(date) ?? [];
    const primaryWorkout = pickPrimaryWorkout(dayWorkouts);
    // No workout on this day ⇒ rest, provided we can trust the week: either the week
    // does carry workouts (so the calendar is real and this day is simply empty), or
    // the scan covering the week is healthy (so an empty WEEK is real too). Otherwise
    // "unknown" — no formula, null targets, an honest data gap.
    const baseType =
      primaryWorkout?.dayType ?? (hasTrainingContext || planWeekScanHealthy ? "rest" : "unknown");
    const dayBeforeLongRun = longRunDates.has(addDays(date, 1));
    const harder =
      baseType === "race" || baseType === "long_run" || baseType === "long_endurance" || baseType === "hard";
    let trainingType: NutritionPlanDayType = dayBeforeLongRun && !harder ? "pre_long" : baseType;
    // Pre-race interval refresh: an INTERVAL session in the 3-6-day pre-start window is
    // light, not hard — питать как easy (intensity refresh, not heavy work). Only the
    // interval evidence on the title triggers this; continuous tempo/long days are NOT
    // reclassified, and the race day (dayType "race") is excluded by the hard-check.
    if (
      trainingType === "hard" &&
      preRaceIntervalDates.has(date) &&
      hasNutritionIntervalWorkoutEvidence(primaryWorkout?.title ?? null)
    ) {
      trainingType = "easy";
    }
    const hasWorkout = Boolean(primaryWorkout);
    const idealTarget =
      trainingType === "race"
        ? computeRaceDayTarget({
            bodyweightKg: params.bodyweightKg,
            distanceKm: primaryWorkout?.distanceKm ?? null,
            title: primaryWorkout?.title ?? null,
          })
        : calculateNutritionDayTypeTarget({
            bodyweightKg: params.bodyweightKg,
            dayType: trainingType,
            isLightCross:
              trainingType === "cross_training" &&
              isLightIntermittentCrossTrainingTitle(primaryWorkout?.title ?? ""),
            durationHours: primaryWorkout?.durationHours ?? null,
          });
    const baseline =
      previousWeekTargets.byDayType[trainingType] ??
      (trainingType === "race" ? previousWeekTargets.byDayType.hard ?? null : null) ??
      previousWeekTargets.overall;
    // Task 10d (Bug б): count EVERY session of the day, not just the primary, so a
    // run+strength day isn't under-credited. The day type stays the primary's; the
    // primary session keeps its (pre_long-adjusted) trainingType, each secondary
    // uses its own dayType. Single-session and zero-workout days are byte-identical
    // to the previous primary-only estimate (the latter preserves the pre_long
    // phantom-expenditure on a no-workout day-before-long-run).
    const dayExerciseKcal =
      dayWorkouts.length > 0
        ? sumDaySessionsExpenditureKcal(dayWorkouts, (workout) =>
            planDayExerciseKcal(
              workout === primaryWorkout ? trainingType : workout.dayType,
              workout.durationHours,
              workout.distanceKm,
              workout.title
            )
          )
        : planDayExerciseKcal(
            trainingType,
            primaryWorkout?.durationHours ?? null,
            primaryWorkout?.distanceKm ?? null,
            primaryWorkout?.title ?? null
          );
    const practicalTarget = resolveDayTarget(trainingType, idealTarget, baseline, dayExerciseKcal, raceWeekDates.has(date));

    let source: NutritionPlanSource = "unknown";
    if (!params.bodyweightKg || params.bodyweightKg <= 0) {
      source = "missing_bodyweight";
    } else if (!hasTrainingContext && !planWeekScanHealthy) {
      // Empty week we cannot vouch for → generic, as before. An empty week with a
      // HEALTHY scan is not generic: its days are inferred rest (below).
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
        carb_loading: false,
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

  // ⭐ Carb LOADING (HM+): on the lead-up days and the race day, lift carbs from the
  // athlete's REAL prior-week base up the protocol corridor, so the plan numbers
  // match the "loading" prose. Only when the protocol prescribes loading (≥21 km)
  // and a real base exists — otherwise the standard race-day target (ceiling) and
  // formula numbers stand (fallback). Protein stays race-week (deficit already off
  // on these days); fat is left as the day formula computed it (no clamp — it falls
  // as a % share by itself); kcal is recomputed from the three macros.
  const loadingBodyweight = params.bodyweightKg;
  const carbLoadingBase = computeCarbBaseFromReview(
    extractPreviousWeekCarbsPerDay(params.previousWeekDailyAnalysis)
  );
  // Recovery days are floored at the athlete's EASY-run carbs: the day after a start must not sit
  // below an ordinary running day. This one stays tied to the easy target on purpose — a recovery
  // day IS an ordinary day.
  const easyCarbFloorG =
    loadingBodyweight && loadingBodyweight > 0
      ? calculateNutritionDayTypeTarget({ bodyweightKg: loadingBodyweight, dayType: "easy" })?.carbs_g ?? 0
      : 0;
  // Pre-race LOADING gets its OWN floor — see CARB_LOADING_FLOOR_G_PER_KG. It used to reuse the
  // easy-day floor, which quietly coupled the start line to a training-day setting: when the easy
  // target moved (corridor floor → corridor middle), the loading floor moved with it. Loading a
  // glycogen store before a race and fuelling an easy jog are different questions and must not
  // share a number.
  const carbLoadingFloorG =
    loadingBodyweight && loadingBodyweight > 0
      ? roundToNearest(CARB_LOADING_FLOOR_G_PER_KG * loadingBodyweight, 10)
      : 0;
  if (carbLoadingBase !== null && loadingBodyweight && loadingBodyweight > 0) {
    for (const workout of parsedWorkouts) {
      if (workout.dayType !== "race") {
        continue;
      }
      const protocol = computeNutritionRaceProtocol({ distanceKm: workout.distanceKm, title: workout.title });
      if (!protocol.loading) {
        continue;
      }
      const n = protocol.loading.days;
      const targets = computeCarbLoadingTargets({
        baseG: carbLoadingBase,
        weightKg: loadingBodyweight,
        corridorUpperGkg: protocol.loading.g_per_kg_high,
        leadDayCount: n,
        floorG: carbLoadingFloorG,
      });
      for (let offset = -n; offset <= 0; offset += 1) {
        const date = addDays(workout.date, offset);
        const day = days.find((item) => item.date === date);
        if (!day) {
          continue; // lead day falls outside the plan week
        }
        const carbsG = offset === 0 ? targets.raceDay : targets.leadDays[offset + n];
        applyCarbLoadingToPlanDay(day, carbsG, loadingBodyweight);
      }
    }
  }

  // Recovery day right AFTER any race (glycogen + repair, deficit already off).
  // In-window → lift the existing day; a Sunday race whose recovery (Mon) falls
  // OUTSIDE the Mon–Sun window → append that one display day WITHOUT changing
  // plan_week.from/to (the week key stays Mon–Sun so exact-week pairing holds).
  if (loadingBodyweight && loadingBodyweight > 0) {
    for (const workout of parsedWorkouts) {
      if (workout.dayType !== "race") {
        continue;
      }
      const recoveryDate = addDays(workout.date, 1);
      const existing = days.find((item) => item.date === recoveryDate);
      if (existing) {
        applyRecoveryToPlanDay(existing, loadingBodyweight, easyCarbFloorG);
      } else if (recoveryDate > params.planWeekTo && !days.some((item) => item.date === recoveryDate)) {
        days.push(buildRecoveryAppendedDay(recoveryDate, loadingBodyweight, easyCarbFloorG));
      }
    }
  }

  // Day-type table is per-type (one cross_training row). Treat the cross_training row as
  // light ONLY when EVERY cross-training workout this week is light (padel/tennis/walk) —
  // a week that also has a bike/swim endurance session keeps the full 5.2 so it is not
  // under-fuelled.
  const crossTrainingWorkouts = parsedWorkouts.filter((workout) => workout.dayType === "cross_training");
  const weekCrossTrainingIsLight =
    crossTrainingWorkouts.length > 0 &&
    crossTrainingWorkouts.every((workout) => isLightIntermittentCrossTrainingTitle(workout.title ?? ""));

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
        calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "cross_training", isLightCross: weekCrossTrainingIsLight }),
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
      cross_training: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "cross_training", isLightCross: weekCrossTrainingIsLight }),
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
      no_training_week_maintenance: noTrainingWeekMaintenance,
    },
    warnings,
  };
}
