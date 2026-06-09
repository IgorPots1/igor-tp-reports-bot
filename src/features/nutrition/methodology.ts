import type {
  NutritionStudentContext,
  NutritionTrainingPeaksWeekContext,
  NormalizedManualMacroRow,
} from "@/features/nutrition/context";

export type NutritionTrainingType =
  | "rest"
  | "easy"
  | "long_run"
  | "intervals"
  | "tempo"
  | "race"
  | "strength"
  | "unknown";

export type NutritionStatusForDay =
  | "adequate"
  | "low_for_load"
  | "moderate_for_load"
  | "ample"
  | "rest_ok"
  | "suspect"
  | "missing";

export type NutritionDailyRelevance = "high" | "medium" | "low";

export type NutritionDailyAnalysis = {
  date: string;
  trainingType: NutritionTrainingType;
  previousDayTrainingType: NutritionTrainingType | null;
  nextDayTrainingType: NutritionTrainingType | null;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  bodyweightKg: number | null;
  proteinGPerKg: number | null;
  carbsGPerKg: number | null;
  nutritionStatus: NutritionStatusForDay;
  relevance: NutritionDailyRelevance;
  findings: string[];
  trainingNutritionLinks: string[];
  duringRunFuelPlanned?: boolean;
  fuelingEvidence?: string[];
};

export type NutritionFocusCategory =
  | "long_run_underfueling"
  | "hard_session_underfueling"
  | "post_hard_recovery_support"
  | "carbs_around_key_sessions"
  | "weekly_consistency"
  | "energy_availability"
  | "protein_support"
  | "maintenance"
  | "limited_data"
  | "blocked_safety";

export type CarbProgressionStrategy =
  | "maintain"
  | "small_step"
  | "moderate_step"
  | "toward_reference_band";

export type WorkoutFuelingInstructionDetection = {
  hasFuelingInstruction: boolean;
  hasGelInstruction: boolean;
  hasSportsDrinkInstruction: boolean;
  evidence: string[];
  normalizedType: "gels" | "sports_drink" | "carbs" | "fueling" | "none";
};

export type NutritionOneFocus = {
  category: NutritionFocusCategory;
  statementRu: string;
  progressionStrategy: CarbProgressionStrategy;
};

export type NutritionMethodologyContext = {
  bodyweightKg: number | null;
  sex: "female" | "male" | "unknown";
  averages: {
    kcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    proteinGPerKg: number | null;
    carbsGPerKg: number | null;
  };
  proteinSufficient: boolean;
  carbReferenceBandUsed: true;
  carbReferenceNotPrescriptive: true;
  dailyAnalysis: NutritionDailyAnalysis[];
  trainingNutritionLinks: string[];
  longRunFuelingInstructionDetected: boolean;
  duringRunFuelPlanned: boolean;
  carbProgressionStrategy: CarbProgressionStrategy;
  focusCandidateSignals: {
    severeEnergyAvailability: boolean;
    longRunUnderfueling: boolean;
    hardSessionUnderfueling: boolean;
    postHardRecoverySupport: boolean;
    carbsAroundKeySessions: boolean;
    weeklyConsistency: boolean;
    proteinSupport: boolean;
    limitedData: boolean;
  };
};

type WorkoutContextByDate = {
  date: string;
  title: string;
  type: NutritionTrainingType;
  description: string | null;
  coachComments: string | null;
  plannedText: string | null;
};

const FUELING_MARKERS: Array<{ token: RegExp; kind: WorkoutFuelingInstructionDetection["normalizedType"] }> = [
  { token: /\bгель\b/i, kind: "gels" },
  { token: /\bгели\b/i, kind: "gels" },
  { token: /\bгелем\b/i, kind: "gels" },
  { token: /\bгелями\b/i, kind: "gels" },
  { token: /\bgel\b/i, kind: "gels" },
  { token: /\bgels\b/i, kind: "gels" },
  { token: /\bизотоник\b/i, kind: "sports_drink" },
  { token: /\bспортнапиток\b/i, kind: "sports_drink" },
  { token: /\bsports?\s*drink\b/i, kind: "sports_drink" },
  { token: /\bdrink\s*mix\b/i, kind: "sports_drink" },
  { token: /\bпитание\b/i, kind: "fueling" },
  { token: /\bпитание\s+на\s+тренировке\b/i, kind: "fueling" },
  { token: /\bуглеводы\s+во\s+время\b/i, kind: "carbs" },
  { token: /\bcarbs?\s+during\b/i, kind: "carbs" },
  { token: /\bfuel\b/i, kind: "fueling" },
  { token: /\bfueling\b/i, kind: "fueling" },
  { token: /\bкаждые\s*30\s*мин\b/i, kind: "fueling" },
  { token: /\bкаждые\s*40\s*мин\b/i, kind: "fueling" },
  { token: /\b30[\s-–]*60\s*г\/ч\b/i, kind: "carbs" },
  { token: /\b30[\s-–]*60\s*g\/h\b/i, kind: "carbs" },
];

function avg(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return Number((present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(1));
}

function toDateValue(iso: string): number {
  return Date.parse(`${iso}T12:00:00.000Z`);
}

function normalizeTrainingType(rawType: string | null | undefined, title: string): NutritionTrainingType {
  const raw = (rawType ?? "").toLowerCase();
  const titleLc = title.toLowerCase();
  if (raw === "day_off" || /rest|отдых/.test(titleLc)) {
    return "rest";
  }
  if (raw === "strength") {
    return "strength";
  }
  if (/race|гонк|соревн/.test(titleLc)) {
    return "race";
  }
  if (/tempo|темп|порог|threshold/.test(titleLc)) {
    return "tempo";
  }
  if (/интерв|interval|vo2|спринт|hill/.test(titleLc)) {
    return "intervals";
  }
  if (/длитель|long run|longrun/.test(titleLc)) {
    return "long_run";
  }
  if (raw === "run") {
    return "easy";
  }
  if (raw === "unknown" || raw === "other") {
    return "unknown";
  }
  return "easy";
}

function buildWorkoutContextByDate(week: NutritionTrainingPeaksWeekContext): Map<string, WorkoutContextByDate> {
  const map = new Map<string, WorkoutContextByDate>();
  for (const workout of week.workouts) {
    const type = normalizeTrainingType(workout.type, workout.title);
    const current = map.get(workout.date);
    if (!current || type === "long_run" || type === "intervals" || type === "tempo" || type === "race") {
      map.set(workout.date, {
        date: workout.date,
        title: workout.title,
        type,
        description: workout.description ?? null,
        coachComments: workout.coachComments ?? null,
        plannedText: workout.plannedText ?? null,
      });
    }
  }
  return map;
}

function asSex(context: NutritionStudentContext): "female" | "male" | "unknown" {
  const haystack = `${context.telegramContextNotes ?? ""} ${context.nutritionGoal ?? ""}`.toLowerCase();
  if (/\bfemale\b|жен|девушк/.test(haystack)) {
    return "female";
  }
  if (/\bmale\b|муж|парен/.test(haystack)) {
    return "male";
  }
  return "unknown";
}

function getLowThresholds(rows: NormalizedManualMacroRow[]): {
  lowKcal: number | null;
  lowCarbs: number | null;
} {
  const kcalSorted = rows.map((row) => row.kcal).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const carbsSorted = rows.map((row) => row.carbsG).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const lowKcal = kcalSorted.length >= 2 ? kcalSorted[Math.min(1, kcalSorted.length - 1)] : kcalSorted[0] ?? null;
  const lowCarbs = carbsSorted.length >= 2 ? carbsSorted[Math.min(1, carbsSorted.length - 1)] : carbsSorted[0] ?? null;
  return { lowKcal, lowCarbs };
}

function detectCarbProgressionStrategy(input: {
  avgCarbsGPerKg: number | null;
  hasHeavyTraining: boolean;
}): CarbProgressionStrategy {
  if (input.avgCarbsGPerKg === null) {
    return "small_step";
  }
  if (input.hasHeavyTraining && input.avgCarbsGPerKg < 4.5) {
    return "small_step";
  }
  if (input.hasHeavyTraining && input.avgCarbsGPerKg < 6) {
    return "moderate_step";
  }
  if (input.hasHeavyTraining && input.avgCarbsGPerKg < 7) {
    return "toward_reference_band";
  }
  return "maintain";
}

export function detectWorkoutFuelingInstructions(text: string | null): WorkoutFuelingInstructionDetection {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return {
      hasFuelingInstruction: false,
      hasGelInstruction: false,
      hasSportsDrinkInstruction: false,
      evidence: [],
      normalizedType: "none",
    };
  }
  const evidence: string[] = [];
  const kinds = new Set<WorkoutFuelingInstructionDetection["normalizedType"]>();
  for (const marker of FUELING_MARKERS) {
    if (marker.token.test(compact)) {
      evidence.push(marker.token.source);
      kinds.add(marker.kind);
    }
  }
  const hasFuelingInstruction = kinds.size > 0;
  const hasGelInstruction = kinds.has("gels");
  const hasSportsDrinkInstruction = kinds.has("sports_drink");
  let normalizedType: WorkoutFuelingInstructionDetection["normalizedType"] = "none";
  if (hasGelInstruction) {
    normalizedType = "gels";
  } else if (hasSportsDrinkInstruction) {
    normalizedType = "sports_drink";
  } else if (kinds.has("carbs")) {
    normalizedType = "carbs";
  } else if (kinds.has("fueling")) {
    normalizedType = "fueling";
  }
  return {
    hasFuelingInstruction,
    hasGelInstruction,
    hasSportsDrinkInstruction,
    evidence,
    normalizedType,
  };
}

function analyzeDailyTrainingNutrition(input: {
  rows: NormalizedManualMacroRow[];
  workoutsByDate: Map<string, WorkoutContextByDate>;
  bodyweightKg: number | null;
}): NutritionDailyAnalysis[] {
  const sortedRows = [...input.rows]
    .filter((row) => !row.day.startsWith("unresolved:"))
    .sort((a, b) => toDateValue(a.day) - toDateValue(b.day));
  const thresholds = getLowThresholds(sortedRows);

  return sortedRows.map((row, index) => {
    const previousDate = sortedRows[index - 1]?.day ?? null;
    const nextDate = sortedRows[index + 1]?.day ?? null;
    const currentWorkout = input.workoutsByDate.get(row.day);
    const previousWorkout = previousDate ? input.workoutsByDate.get(previousDate) : null;
    const nextWorkout = nextDate ? input.workoutsByDate.get(nextDate) : null;
    const trainingType = currentWorkout?.type ?? "rest";
    const previousDayTrainingType = previousWorkout?.type ?? null;
    const nextDayTrainingType = nextWorkout?.type ?? null;
    const carbsGPerKg =
      row.carbsG !== null && input.bodyweightKg && input.bodyweightKg > 0
        ? Number((row.carbsG / input.bodyweightKg).toFixed(2))
        : null;
    const proteinGPerKg =
      row.proteinG !== null && input.bodyweightKg && input.bodyweightKg > 0
        ? Number((row.proteinG / input.bodyweightKg).toFixed(2))
        : null;
    const findings: string[] = [];
    const trainingNutritionLinks: string[] = [];
    let relevance: NutritionDailyRelevance = "low";
    let nutritionStatus: NutritionStatusForDay = "adequate";
    let duringRunFuelPlanned: boolean | undefined;
    let fuelingEvidence: string[] | undefined;

    const isHardOrLong = trainingType === "long_run" || trainingType === "intervals" || trainingType === "tempo" || trainingType === "race";
    const nextIsHardOrLong = nextDayTrainingType === "long_run" || nextDayTrainingType === "intervals" || nextDayTrainingType === "tempo" || nextDayTrainingType === "race";
    const prevIsHardOrLong = previousDayTrainingType === "long_run" || previousDayTrainingType === "intervals" || previousDayTrainingType === "tempo" || previousDayTrainingType === "race";
    const lowKcal = row.kcal !== null && thresholds.lowKcal !== null && row.kcal <= thresholds.lowKcal;
    const lowCarbs = row.carbsG !== null && thresholds.lowCarbs !== null && row.carbsG <= thresholds.lowCarbs;

    if (row.kcal === null && row.carbsG === null && row.proteinG === null && row.fatG === null) {
      nutritionStatus = "missing";
      findings.push("Нет данных по макросам за день.");
      relevance = "medium";
    }

    if (nextIsHardOrLong && lowCarbs) {
      findings.push("День перед ключевой тренировкой попал в низкие по углеводам.");
      trainingNutritionLinks.push("Перед ключевой тренировкой нужны более стабильные углеводы.");
      nutritionStatus = "low_for_load";
      relevance = "high";
    }

    if (isHardOrLong && (lowCarbs || lowKcal)) {
      findings.push("Ключевая тренировка совпала с низкой энергией/углеводами.");
      trainingNutritionLinks.push("В день ключевой работы стоит поддержать углеводы и общую энергию.");
      nutritionStatus = "low_for_load";
      relevance = "high";
    }

    if (trainingType === "long_run") {
      const workoutText = [currentWorkout?.title, currentWorkout?.description, currentWorkout?.coachComments, currentWorkout?.plannedText]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      const fuelingDetection = detectWorkoutFuelingInstructions(workoutText || null);
      duringRunFuelPlanned = fuelingDetection.hasFuelingInstruction;
      fuelingEvidence = fuelingDetection.evidence;
      if (fuelingDetection.hasFuelingInstruction) {
        trainingNutritionLinks.push("По описанию длительной указано питание во время бега.");
      } else {
        trainingNutritionLinks.push("По описанию длительной питание во время бега не указано.");
      }
      if (lowKcal) {
        findings.push("Длительная пришлась на один из самых низких по энергии дней.");
        relevance = "high";
        nutritionStatus = "low_for_load";
      }
    }

    if (prevIsHardOrLong && (lowKcal || lowCarbs || (row.proteinG !== null && row.proteinG < 95))) {
      findings.push("День восстановления после ключевой тренировки выглядит недоподкреплённым.");
      trainingNutritionLinks.push("После тяжёлой нагрузки важно закрывать энергию и углеводы для восстановления.");
      relevance = relevance === "high" ? "high" : "medium";
      nutritionStatus = nutritionStatus === "low_for_load" ? "low_for_load" : "moderate_for_load";
    }

    if (trainingType === "rest" && lowKcal && !nextIsHardOrLong && !prevIsHardOrLong) {
      findings.push("Низкий приём на отдыхе допустим, но без накопления таких дней подряд.");
      nutritionStatus = "rest_ok";
      relevance = relevance === "high" ? "high" : "low";
    }

    if (nutritionStatus === "adequate" && trainingType === "rest") {
      nutritionStatus = "rest_ok";
    }
    if (nutritionStatus === "adequate" && isHardOrLong && !lowKcal && !lowCarbs) {
      nutritionStatus = "ample";
      findings.push("Энергия и углеводы в день ключевой нагрузки выглядят устойчиво.");
      relevance = relevance === "low" ? "medium" : relevance;
    }
    if (findings.length === 0 && nutritionStatus === "adequate") {
      findings.push("Явных несоответствий нагрузки и питания в этот день не видно.");
    }

    return {
      date: row.day,
      trainingType,
      previousDayTrainingType,
      nextDayTrainingType,
      kcal: row.kcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbsG: row.carbsG,
      bodyweightKg: input.bodyweightKg,
      proteinGPerKg,
      carbsGPerKg,
      nutritionStatus,
      relevance,
      findings,
      trainingNutritionLinks,
      duringRunFuelPlanned,
      fuelingEvidence,
    };
  });
}

export function buildNutritionMethodologyContext(input: {
  context: NutritionStudentContext;
}): NutritionMethodologyContext {
  const { context } = input;
  const bodyweightKg = context.currentWeightKg ?? null;
  const workoutsByDate = buildWorkoutContextByDate(context.tpPastWeek);
  const dailyAnalysis = analyzeDailyTrainingNutrition({
    rows: context.manualMacroRows,
    workoutsByDate,
    bodyweightKg,
  });
  const averages = {
    kcal: avg(context.manualMacroRows.map((row) => row.kcal)),
    proteinG: avg(context.manualMacroRows.map((row) => row.proteinG)),
    fatG: avg(context.manualMacroRows.map((row) => row.fatG)),
    carbsG: avg(context.manualMacroRows.map((row) => row.carbsG)),
    proteinGPerKg:
      bodyweightKg && bodyweightKg > 0
        ? avg(context.manualMacroRows.map((row) => (row.proteinG !== null ? Number((row.proteinG / bodyweightKg).toFixed(2)) : null)))
        : null,
    carbsGPerKg:
      bodyweightKg && bodyweightKg > 0
        ? avg(context.manualMacroRows.map((row) => (row.carbsG !== null ? Number((row.carbsG / bodyweightKg).toFixed(2)) : null)))
        : null,
  };
  const proteinSufficient = (averages.proteinGPerKg ?? 0) >= 1.6;
  const severeEnergyAvailability =
    context.manualMacroRows.filter((row) => (row.kcal ?? 9999) < 1300 || (row.carbsG ?? 9999) < 90).length >= 2;
  const longRunUnderfueling = dailyAnalysis.some(
    (day) =>
      day.trainingType === "long_run" &&
      (day.nutritionStatus === "low_for_load" ||
        day.previousDayTrainingType === "long_run" ||
        day.findings.some((item) => item.toLowerCase().includes("длитель")))
  );
  const hardSessionUnderfueling = dailyAnalysis.some(
    (day) =>
      (day.trainingType === "intervals" || day.trainingType === "tempo" || day.trainingType === "race") &&
      day.nutritionStatus === "low_for_load"
  );
  const postHardRecoverySupport = dailyAnalysis.some(
    (day) =>
      (day.previousDayTrainingType === "long_run" ||
        day.previousDayTrainingType === "intervals" ||
        day.previousDayTrainingType === "tempo" ||
        day.previousDayTrainingType === "race") &&
      (day.nutritionStatus === "low_for_load" || day.nutritionStatus === "moderate_for_load")
  );
  const carbsAroundKeySessions = dailyAnalysis.some(
    (day) =>
      (day.nextDayTrainingType === "long_run" ||
        day.nextDayTrainingType === "intervals" ||
        day.nextDayTrainingType === "tempo" ||
        day.nextDayTrainingType === "race") &&
      day.nutritionStatus === "low_for_load"
  );
  const weeklyConsistency = dailyAnalysis.filter((day) => day.nutritionStatus === "low_for_load").length >= 2;
  const proteinSupport = !proteinSufficient && (averages.proteinGPerKg ?? 0) > 0;
  const heavyTraining = context.tpPastWeek.longRun !== null || context.tpPastWeek.keyWorkouts.length > 0;
  const carbProgressionStrategy = detectCarbProgressionStrategy({
    avgCarbsGPerKg: averages.carbsGPerKg,
    hasHeavyTraining: heavyTraining,
  });
  const longRunFuelingInstructionDetected = dailyAnalysis.some((day) => day.trainingType === "long_run" && day.duringRunFuelPlanned === true);
  const duringRunFuelPlanned = longRunFuelingInstructionDetected;

  const trainingNutritionLinks = [...new Set(dailyAnalysis.flatMap((day) => day.trainingNutritionLinks))];
  return {
    bodyweightKg,
    sex: asSex(context),
    averages,
    proteinSufficient,
    carbReferenceBandUsed: true,
    carbReferenceNotPrescriptive: true,
    dailyAnalysis,
    trainingNutritionLinks,
    longRunFuelingInstructionDetected,
    duringRunFuelPlanned,
    carbProgressionStrategy,
    focusCandidateSignals: {
      severeEnergyAvailability,
      longRunUnderfueling,
      hardSessionUnderfueling,
      postHardRecoverySupport,
      carbsAroundKeySessions,
      weeklyConsistency,
      proteinSupport,
      limitedData: context.manualMacroRows.length < 3 || context.tpPastWeek.cacheStatus !== "ok",
    },
  };
}

export function selectNutritionWeeklyFocus(input: {
  methodology: NutritionMethodologyContext;
  blockedSafety: boolean;
}): NutritionOneFocus {
  if (input.blockedSafety) {
    return {
      category: "blocked_safety",
      statementRu: "Сначала нужна ручная проверка безопасности, без рекомендаций ученику.",
      progressionStrategy: "maintain",
    };
  }
  const s = input.methodology.focusCandidateSignals;
  if (s.limitedData) {
    return {
      category: "limited_data",
      statementRu: "Данных пока недостаточно для точного тренировка-день анализа, нужен ручной разбор.",
      progressionStrategy: "small_step",
    };
  }
  if (s.severeEnergyAvailability) {
    return {
      category: "energy_availability",
      statementRu: "Главный фокус недели — убрать повторяющиеся очень низкие дни по энергии и углеводам.",
      progressionStrategy: "small_step",
    };
  }
  if (s.longRunUnderfueling) {
    return {
      category: "long_run_underfueling",
      statementRu: "Главный фокус — поддержать углеводы и энергию в день до длительной и в день длительной.",
      progressionStrategy: input.methodology.carbProgressionStrategy,
    };
  }
  if (s.hardSessionUnderfueling) {
    return {
      category: "hard_session_underfueling",
      statementRu: "Главный фокус — не просаживать питание в дни интервальных/темповых работ.",
      progressionStrategy: input.methodology.carbProgressionStrategy,
    };
  }
  if (s.postHardRecoverySupport) {
    return {
      category: "post_hard_recovery_support",
      statementRu: "Главный фокус — добавить питание в день восстановления после тяжёлых сессий.",
      progressionStrategy: input.methodology.carbProgressionStrategy,
    };
  }
  if (s.carbsAroundKeySessions) {
    return {
      category: "carbs_around_key_sessions",
      statementRu: "Главный фокус — выровнять углеводы вокруг ключевых тренировок без резких изменений.",
      progressionStrategy: input.methodology.carbProgressionStrategy,
    };
  }
  if (s.weeklyConsistency) {
    return {
      category: "weekly_consistency",
      statementRu: "Главный фокус — более ровное питание по неделе, особенно рядом с нагрузкой.",
      progressionStrategy: input.methodology.carbProgressionStrategy,
    };
  }
  if (s.proteinSupport) {
    return {
      category: "protein_support",
      statementRu: "Главный фокус — немного выровнять белок по дням, без перегруза рекомендациями.",
      progressionStrategy: "maintain",
    };
  }
  return {
    category: "maintenance",
    statementRu: "Главный фокус — сохранить текущую устойчивость и наблюдать динамику.",
    progressionStrategy: "maintain",
  };
}
