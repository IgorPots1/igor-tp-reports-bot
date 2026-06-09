export type NutritionPlanDayType =
  | "rest"
  | "easy"
  | "hard"
  | "pre_long"
  | "long_run"
  | "strength"
  | "race"
  | "unknown";

export type NutritionPlanSource =
  | "tp_workout"
  | "inferred_from_week_structure"
  | "generic_day_type"
  | "missing_bodyweight"
  | "unknown";

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
    race: boolean;
    key_workout: boolean;
    day_before_long_run: boolean;
    has_training_context: boolean;
  };
  pre_training_guidance: string | null;
  source: NutritionPlanSource;
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
  };
  summary: {
    has_training_context: boolean;
    total_days: number;
    days_with_training: number;
    key_days_count: number;
    long_run_dates: string[];
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
};

const WEEKDAY_RU_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"] as const;

const DAY_TYPE_PRIORITY: Record<NutritionPlanDayType, number> = {
  race: 7,
  long_run: 6,
  hard: 5,
  pre_long: 4,
  strength: 3,
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
};

const GUIDANCE_BY_DAY_TYPE: Record<NutritionPlanDayType, string | null> = {
  rest: null,
  easy: "Лёгкая пробежка: можно налегке или после небольшого перекуса, как удобнее.",
  hard: "Ключевая работа: не выходить голодным; углеводы в течение дня держать ближе к ориентиру для интервального/темпового дня.",
  pre_long: "День перед длительной: это не обычный отдых; важно не просадить углеводы за день.",
  long_run: "Длительная: заранее поддержать углеводы и после тренировки закрыть восстановление.",
  strength: "Силовая: держать белок и углеводы без сильной просадки.",
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

function normalizeDayType(typeRaw: string | null, titleRaw: string | null): NutritionPlanDayType {
  const type = (typeRaw ?? "").toLowerCase();
  const title = (titleRaw ?? "").toLowerCase();
  const haystack = `${type} ${title}`;
  if (/race|гонк|соревн/.test(haystack)) {
    return "race";
  }
  if (type === "long_run" || /длитель|long run|longrun/.test(haystack)) {
    return "long_run";
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
  const longRun = asObject(ctx.longRun);
  const longRunDate = toIsoDate(longRun?.date);

  return workoutsRaw
    .map((item) => asObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((workout) => {
      const date = toIsoDate(workout.date) ?? "unknown-date";
      const title = toStringOrNull(workout.title);
      const type = toStringOrNull(workout.type);
      let dayType = normalizeDayType(type, title);
      if (longRunDate && date === longRunDate) {
        dayType = "long_run";
      }
      return {
        date,
        title,
        type,
        dayType,
        keyWorkout: isKeyWorkout(dayType),
      };
    })
    .filter((workout) => workout.date !== "unknown-date");
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

export function buildNutritionNextWeekPlan(params: {
  bodyweightKg: number | null;
  planWeekFrom: string;
  planWeekTo: string;
  trainingContext: unknown;
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

  const days: NutritionNextWeekPlanDay[] = dates.map((date) => {
    const dayWorkouts = workoutsByDate.get(date) ?? [];
    const primaryWorkout = pickPrimaryWorkout(dayWorkouts);
    const baseType = primaryWorkout?.dayType ?? (hasTrainingContext ? "rest" : "unknown");
    const dayBeforeLongRun = longRunDates.has(addDays(date, 1));
    const harder = baseType === "race" || baseType === "long_run" || baseType === "hard";
    const trainingType: NutritionPlanDayType = dayBeforeLongRun && !harder ? "pre_long" : baseType;
    const hasWorkout = Boolean(primaryWorkout);
    const target = calculateNutritionDayTypeTarget({
      bodyweightKg: params.bodyweightKg,
      dayType: trainingType,
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
      target_kcal: target?.target_kcal ?? null,
      protein_g: target?.protein_g ?? null,
      fat_g: target?.fat_g ?? null,
      carbs_g: target?.carbs_g ?? null,
      kcal_per_kg: target?.kcal_per_kg ?? null,
      protein_g_per_kg: target?.protein_g_per_kg ?? null,
      fat_g_per_kg: target?.fat_g_per_kg ?? null,
      carbs_g_per_kg: target?.carbs_g_per_kg ?? null,
      flags: {
        rest: trainingType === "rest",
        easy: trainingType === "easy",
        hard: trainingType === "hard",
        pre_long: trainingType === "pre_long",
        long_run: trainingType === "long_run",
        strength: trainingType === "strength",
        race: trainingType === "race",
        key_workout: trainingType === "hard" || trainingType === "long_run" || trainingType === "race",
        day_before_long_run: dayBeforeLongRun,
        has_training_context: hasWorkout,
      },
      pre_training_guidance: GUIDANCE_BY_DAY_TYPE[trainingType],
      source,
    };
  });

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
      rest: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "rest" }),
      easy: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "easy" }),
      hard: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "hard" }),
      pre_long: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "pre_long" }),
      long_run: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "long_run" }),
      strength: calculateNutritionDayTypeTarget({ bodyweightKg: params.bodyweightKg, dayType: "strength" }),
    },
    summary: {
      has_training_context: hasTrainingContext,
      total_days: days.length,
      days_with_training: days.filter((day) => day.flags.has_training_context).length,
      key_days_count: days.filter((day) => day.flags.key_workout || day.flags.day_before_long_run).length,
      long_run_dates: days.filter((day) => day.training_type === "long_run").map((day) => day.date),
      hard_dates: days.filter((day) => day.training_type === "hard").map((day) => day.date),
      missing_bodyweight: !params.bodyweightKg || params.bodyweightKg <= 0,
    },
    warnings,
  };
}
