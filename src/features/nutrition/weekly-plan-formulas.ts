export type NutritionPlanDayType =
  | "rest"
  | "easy"
  | "hard"
  | "pre_long"
  | "long_run"
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
  isExplicitNutritionLongRunTitle,
  isNutritionLongRunWorkout,
  resolveNutritionLongRunConfidence,
  resolveNutritionLongRunSource,
  type NutritionLongRunSource,
} from "@/features/nutrition/long-run";

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
    strength: NutritionDayTypeTarget | null;
    cross_training?: NutritionDayTypeTarget | null;
  };
  day_type_ideal_targets: {
    rest: NutritionDayTypeTarget | null;
    easy: NutritionDayTypeTarget | null;
    hard: NutritionDayTypeTarget | null;
    pre_long: NutritionDayTypeTarget | null;
    long_run: NutritionDayTypeTarget | null;
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
  strength: { kcalPerKg: 39, proteinPerKg: 1.8, fatPerKg: 1.15, carbsPerKg: 5.2 },
  cross_training: { kcalPerKg: 39, proteinPerKg: 1.6, fatPerKg: 1.15, carbsPerKg: 5.2 },
};

const GUIDANCE_BY_DAY_TYPE: Record<NutritionPlanDayType, string | null> = {
  rest: null,
  easy: "Лёгкая пробежка: можно налегке или после небольшого перекуса, как удобнее.",
  hard: "Ключевая работа: не выходить голодным; углеводы в течение дня держать ближе к ориентиру для интервального/темпового дня.",
  pre_long: "День перед длительной: это не обычный отдых; важно не просадить углеводы за день.",
  long_run: "Длительная: заранее поддержать углеводы и после тренировки закрыть восстановление.",
  strength: "Силовая: держать белок и углеводы без сильной просадки.",
  cross_training: "Кросс-тренировка: поддержать питание вокруг нагрузки, без пустого дня по энергии.",
  race: "Соревновательный день: не экспериментировать с питанием и держать проверенные схемы.",
  unknown: null,
};

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
  const title = (titleRaw ?? "").toLowerCase();
  const haystack = `${type} ${title}`;
  if (/race|гонк|соревн/.test(haystack)) {
    return "race";
  }
  if (
    type === "intervals" ||
    type === "tempo" ||
    type === "threshold" ||
    /интерв|tempo|темп|порог|threshold|vo2|hill|ключ/.test(haystack) ||
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\b/.test(haystack)
  ) {
    return "hard";
  }
  if (type === "strength" || /силов/.test(haystack)) {
    return "strength";
  }
  if (
    type === "crosstrain" ||
    type === "cross_training" ||
    type === "bike" ||
    type === "swim" ||
    /\bpadel\b|падел|cross.?train|crosstrain|bike|cycling|swim|плав|вело/.test(haystack)
  ) {
    return "cross_training";
  }
  if (
    type === "easy" ||
    type === "easy_run" ||
    type === "run" ||
    type === "endurance" ||
    type === "recovery" ||
    /легк|easy|recovery/.test(haystack)
  ) {
    return "easy";
  }
  if (type === "rest" || type === "day_off" || /rest|отдых/.test(haystack)) {
    return "rest";
  }
  return "unknown";
}

function isKeyWorkout(dayType: NutritionPlanDayType): boolean {
  return dayType === "hard" || dayType === "long_run" || dayType === "race";
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
      const status = toStringOrNull(workout.status);
      const isCompleted = status === "completed" || status === "planned_and_completed" || status === null;
      let dayType = normalizeDayType(type, title);
      if (
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
}): NutritionNextWeekPlan {
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
    parsedWorkouts.filter((workout) => workout.dayType === "long_run").map((workout) => workout.date)
  );
  const previousWeekTargets = extractPreviousWeekTargets(params.previousWeekDailyAnalysis);

  const days: NutritionNextWeekPlanDay[] = dates.map((date) => {
    const dayWorkouts = workoutsByDate.get(date) ?? [];
    const primaryWorkout = pickPrimaryWorkout(dayWorkouts);
    const baseType = primaryWorkout?.dayType ?? (hasTrainingContext ? "rest" : "unknown");
    const dayBeforeLongRun = longRunDates.has(addDays(date, 1));
    const harder = baseType === "race" || baseType === "long_run" || baseType === "hard";
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
    const practicalTarget = applyPracticalTarget({
      dayType: trainingType,
      bodyweightKg: params.bodyweightKg,
      ideal: idealTarget,
      baseline,
    });

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
        key_workout: trainingType === "hard" || trainingType === "long_run" || trainingType === "race",
        day_before_long_run: dayBeforeLongRun,
        has_training_context: hasWorkout,
      },
      long_run_source: trainingType === "long_run" ? primaryWorkout?.longRunSource ?? "none" : "none",
      long_run_confidence: trainingType === "long_run" ? primaryWorkout?.longRunConfidence ?? "low" : "low",
      pre_training_guidance: GUIDANCE_BY_DAY_TYPE[trainingType],
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
      rest: applyPracticalTarget({
        dayType: "rest",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "rest" }),
        baseline: previousWeekTargets.byDayType.rest ?? previousWeekTargets.overall,
      }),
      easy: applyPracticalTarget({
        dayType: "easy",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "easy" }),
        baseline: previousWeekTargets.byDayType.easy ?? previousWeekTargets.overall,
      }),
      hard: applyPracticalTarget({
        dayType: "hard",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "hard" }),
        baseline: previousWeekTargets.byDayType.hard ?? previousWeekTargets.overall,
      }),
      pre_long: applyPracticalTarget({
        dayType: "pre_long",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "pre_long" }),
        baseline: previousWeekTargets.byDayType.pre_long ?? previousWeekTargets.overall,
      }),
      long_run: applyPracticalTarget({
        dayType: "long_run",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_run" }),
        baseline: previousWeekTargets.byDayType.long_run ?? previousWeekTargets.overall,
      }),
      strength: applyPracticalTarget({
        dayType: "strength",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "strength" }),
        baseline: previousWeekTargets.byDayType.strength ?? previousWeekTargets.overall,
      }),
      cross_training: applyPracticalTarget({
        dayType: "cross_training",
        bodyweightKg: params.bodyweightKg,
        ideal: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "cross_training" }),
        baseline: previousWeekTargets.byDayType.cross_training ?? previousWeekTargets.overall,
      }),
    },
    day_type_ideal_targets: {
      rest: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "rest" }),
      easy: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "easy" }),
      hard: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "hard" }),
      pre_long: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "pre_long" }),
      long_run: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_run" }),
      strength: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "strength" }),
      cross_training: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "cross_training" }),
    },
    summary: {
      has_training_context: hasTrainingContext,
      total_days: days.length,
      days_with_training: days.filter((day) => day.flags.has_training_context).length,
      key_days_count: days.filter((day) => day.flags.key_workout || day.flags.day_before_long_run).length,
      long_run_dates: days.filter((day) => day.training_type === "long_run").map((day) => day.date),
      long_run_source: longRunDay?.long_run_source ?? "none",
      long_run_confidence: longRunDay?.long_run_confidence ?? "low",
      hard_dates: days.filter((day) => day.training_type === "hard").map((day) => day.date),
      missing_bodyweight: !params.bodyweightKg || params.bodyweightKg <= 0,
    },
    warnings,
  };
}
