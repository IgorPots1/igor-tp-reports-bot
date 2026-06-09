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
  canonicalDailyAnalysis: NutritionCanonicalDailyAnalysis;
};

export type NutritionCanonicalTrainingType =
  | "rest"
  | "easy"
  | "hard"
  | "long_run"
  | "pre_long"
  | "strength"
  | "race"
  | "unknown";

export type NutritionCanonicalStatus =
  | "rest_ok"
  | "adequate"
  | "ample"
  | "low_for_load"
  | "pre_long_low"
  | "long_run_low"
  | "suspect";

export type NutritionCanonicalRelevance = "normal" | "important" | "key" | "low_confidence";

export type NutritionCanonicalDailyAnalysis = {
  date: string;
  weekdayRu: string;
  dateLabel: string;
  trainingType: NutritionCanonicalTrainingType;
  trainingLabel: string;
  actual: {
    kcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    proteinGPerKg: number | null;
    carbsGPerKg: number | null;
  };
  target: {
    kcalMin?: number | null;
    kcalMax?: number | null;
    carbsGMin?: number | null;
    carbsGMax?: number | null;
    carbsGPerKgMin?: number | null;
    carbsGPerKgMax?: number | null;
    proteinGMin?: number | null;
    proteinGMax?: number | null;
    formulaCode: string;
  };
  flags: {
    rest: boolean;
    easy: boolean;
    hard: boolean;
    preLong: boolean;
    longRun: boolean;
    dayBeforeKeyWorkout: boolean;
    dayAfterKeyWorkout: boolean;
    suspect: boolean;
  };
  nutritionStatus: NutritionCanonicalStatus;
  relevance: NutritionCanonicalRelevance;
  hintForComment: string;
  findings: string[];
  trainingNutritionLinks: Array<{
    sessionDate: string;
    sessionType: string;
    assessment: string;
    confidence: "low" | "moderate" | "high";
  }>;
  sourceQuality: {
    hasNutritionData: boolean;
    hasTrainingContext: boolean;
    confidence: "high" | "medium" | "low";
    notes: string[];
  };
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
  longRunSource: "explicit_title" | "default_sunday" | "none";
  longRunConfidence: "high" | "medium" | "low";
  description: string | null;
  coachComments: string | null;
  plannedText: string | null;
  durationHours: number | null;
  distanceKm: number | null;
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

const WEEKDAY_RU_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"] as const;

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

function toDateLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}`;
}

function toWeekdayRu(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  const weekday = date.getUTCDay();
  return WEEKDAY_RU_FULL[weekday] ?? "Неизвестно";
}

function normalizeDistanceFromTitleKm(title: string): number | null {
  const match = title.match(/(\d+(?:[.,]\d+)?)\s*км/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDistanceKmRu(distanceKm: number): string {
  return `${distanceKm.toFixed(1).replace(".", ",")} км`;
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
  if (
    /интерв|interval|vo2|спринт|hill/.test(titleLc) ||
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\s*(?:мин|min|m)?\b/i.test(titleLc)
  ) {
    return "intervals";
  }
  if (/длитель|длинн|long\s*run|\blong\b|longrun/.test(titleLc)) {
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
  const forcedLongRunDate = week.longRun?.date ?? null;
  for (const workout of week.workouts) {
    const inferredType = normalizeTrainingType(workout.type, workout.title);
    const type = forcedLongRunDate && workout.date === forcedLongRunDate ? "long_run" : inferredType;
    const longRunSource =
      type === "long_run"
        ? week.longRun?.date === workout.date
          ? week.longRun.source ?? "explicit_title"
          : "explicit_title"
        : "none";
    const current = map.get(workout.date);
    if (!current || type === "long_run" || type === "intervals" || type === "tempo" || type === "race") {
      map.set(workout.date, {
        date: workout.date,
        title: workout.title,
        type,
        longRunSource,
        longRunConfidence: longRunSource === "explicit_title" ? "high" : longRunSource === "default_sunday" ? "medium" : "low",
        description: workout.description ?? null,
        coachComments: workout.coachComments ?? null,
        plannedText: workout.plannedText ?? null,
        durationHours: forcedLongRunDate && workout.date === forcedLongRunDate ? week.longRun?.durationHours ?? null : null,
        distanceKm: forcedLongRunDate && workout.date === forcedLongRunDate ? week.longRun?.distanceKm ?? null : null,
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

function inferCanonicalTrainingType(input: {
  trainingType: NutritionTrainingType;
  hasTrainingContext: boolean;
  preLong: boolean;
}): NutritionCanonicalTrainingType {
  if (input.preLong) {
    return "pre_long";
  }
  if (!input.hasTrainingContext) {
    return "unknown";
  }
  if (input.trainingType === "long_run") {
    return "long_run";
  }
  if (input.trainingType === "intervals" || input.trainingType === "tempo") {
    return "hard";
  }
  if (input.trainingType === "race") {
    return "race";
  }
  if (input.trainingType === "strength") {
    return "strength";
  }
  if (input.trainingType === "easy") {
    return "easy";
  }
  if (input.trainingType === "rest") {
    return "rest";
  }
  return "unknown";
}

function buildCanonicalTarget(input: {
  canonicalTrainingType: NutritionCanonicalTrainingType;
  bodyweightKg: number | null;
  hasTrainingContext: boolean;
}): NutritionCanonicalDailyAnalysis["target"] {
  if (!input.bodyweightKg || input.bodyweightKg <= 0) {
    return {
      formulaCode: "missing_weight",
    };
  }

  const bodyweight = input.bodyweightKg;
  if (!input.hasTrainingContext) {
    return {
      carbsGPerKgMin: 3,
      carbsGPerKgMax: 5,
      carbsGMin: Number((3 * bodyweight).toFixed(0)),
      carbsGMax: Number((5 * bodyweight).toFixed(0)),
      formulaCode: "limited_context",
    };
  }

  if (input.canonicalTrainingType === "long_run") {
    return {
      carbsGPerKgMin: 6,
      carbsGPerKgMax: 7,
      carbsGMin: Number((6 * bodyweight).toFixed(0)),
      carbsGMax: Number((7 * bodyweight).toFixed(0)),
      kcalMin: Number((35 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_long_run",
    };
  }
  if (input.canonicalTrainingType === "pre_long") {
    return {
      carbsGPerKgMin: 5.5,
      carbsGPerKgMax: 6,
      carbsGMin: Number((5.5 * bodyweight).toFixed(0)),
      carbsGMax: Number((6 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_pre_long",
    };
  }
  if (input.canonicalTrainingType === "hard" || input.canonicalTrainingType === "race") {
    return {
      carbsGPerKgMin: 5,
      carbsGPerKgMax: 6.5,
      carbsGMin: Number((5 * bodyweight).toFixed(0)),
      carbsGMax: Number((6.5 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_hard",
    };
  }
  if (input.canonicalTrainingType === "easy") {
    return {
      carbsGPerKgMin: 3.5,
      carbsGPerKgMax: 4.5,
      carbsGMin: Number((3.5 * bodyweight).toFixed(0)),
      carbsGMax: Number((4.5 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_easy",
    };
  }
  if (input.canonicalTrainingType === "rest") {
    return {
      carbsGPerKgMin: 3,
      carbsGPerKgMax: 4.5,
      carbsGMin: Number((3 * bodyweight).toFixed(0)),
      carbsGMax: Number((4.5 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_rest",
    };
  }
  return {
    formulaCode: "limited_context",
  };
}

function buildCanonicalTrainingLabel(input: {
  canonicalTrainingType: NutritionCanonicalTrainingType;
  workout: WorkoutContextByDate | null;
}): string {
  if (!input.workout) {
    return "день без тренировки в TrainingPeaks";
  }
  const title = input.workout.title.trim();
  if (input.canonicalTrainingType === "rest") {
    return "день отдыха";
  }
  if (input.canonicalTrainingType === "strength") {
    return "силовая";
  }
  if (input.canonicalTrainingType === "long_run") {
    const distanceFromTitle = normalizeDistanceFromTitleKm(title);
    const distanceKm = input.workout.distanceKm ?? distanceFromTitle;
    if (distanceKm !== null) {
      return `длительная ${formatDistanceKmRu(distanceKm)}`;
    }
    return title ? `длительная: ${title}` : "длительная";
  }
  if (input.canonicalTrainingType === "easy") {
    const distanceFromTitle = normalizeDistanceFromTitleKm(title);
    if (distanceFromTitle !== null) {
      return `лёгкая пробежка ${formatDistanceKmRu(distanceFromTitle)}`;
    }
    return title || "лёгкая тренировка";
  }
  if (input.canonicalTrainingType === "hard" || input.canonicalTrainingType === "race") {
    return title || "ключевая тренировка";
  }
  return title || "тренировка";
}

function buildHintForComment(status: NutritionCanonicalStatus): string {
  if (status === "rest_ok") {
    return "День отдыха: питание в целом ровное, без ключевого замечания.";
  }
  if (status === "pre_long_low") {
    return "День перед длительной: углеводы низкие для подготовки к длительной; это ключевое место недели.";
  }
  if (status === "long_run_low") {
    return "Длительная: энергия/углеводы низкие для длительной; связать с ощущениями только хеджированно.";
  }
  if (status === "low_for_load") {
    return "Ключевая нагрузка: углеводы за день на нижней границе для такой сессии; указать факт и мягкий ориентир.";
  }
  if (status === "ample") {
    return "Сытный день пришёлся на отдых/лёгкий день; отметить нейтрально в контексте распределения по неделе.";
  }
  if (status === "suspect") {
    return "По дню есть сомнения в качестве данных; нужен осторожный комментарий без жёстких выводов.";
  }
  return "Нагрузка и питание в целом согласованы; можно дать краткий поддерживающий комментарий.";
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
  trainingCacheStatus: NutritionTrainingPeaksWeekContext["cacheStatus"];
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
    const isPreLong = nextDayTrainingType === "long_run";
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

    const hasTrainingContext = Boolean(currentWorkout);
    const canonicalTrainingType = inferCanonicalTrainingType({
      trainingType,
      hasTrainingContext,
      preLong: isPreLong,
    });
    const target = buildCanonicalTarget({
      canonicalTrainingType,
      bodyweightKg: input.bodyweightKg,
      hasTrainingContext,
    });
    const suspect =
      row.confidence < 0.6 ||
      (row.kcal !== null && (row.kcal < 900 || row.kcal > 7000)) ||
      (row.carbsG !== null && row.carbsG === 0) ||
      (row.proteinG !== null && row.proteinG === 0);

    const canonicalFindings: string[] = [];
    if (!input.bodyweightKg || input.bodyweightKg <= 0) {
      canonicalFindings.push("missing_weight");
    }
    if (!hasTrainingContext || input.trainingCacheStatus !== "ok") {
      canonicalFindings.push("limited_training_context");
    }
    if (suspect) {
      canonicalFindings.push("suspect_macro_values");
    }
    if (proteinGPerKg !== null && proteinGPerKg >= 1.6) {
      canonicalFindings.push("protein_sufficient");
    }
    const carbsPerKg = carbsGPerKg;
    const kcalPerKgThreshold = input.bodyweightKg && input.bodyweightKg > 0 ? 35 * input.bodyweightKg : null;
    if ((canonicalTrainingType === "hard" || canonicalTrainingType === "race") && carbsPerKg !== null && carbsPerKg < 4.5) {
      canonicalFindings.push("low_carbs_for_hard_session");
    }
    if (canonicalTrainingType === "pre_long" && carbsPerKg !== null && carbsPerKg < 4.5) {
      canonicalFindings.push("low_carbs_before_long_run");
    }
    if (canonicalTrainingType === "long_run" && kcalPerKgThreshold !== null && row.kcal !== null && row.kcal < kcalPerKgThreshold) {
      canonicalFindings.push("low_energy_long_run_day");
    }
    if (canonicalTrainingType === "rest" && row.fatG !== null && row.fatG >= 95) {
      canonicalFindings.push("high_fat_rest_day");
    }
    if (canonicalTrainingType === "rest" && row.kcal !== null && thresholds.lowKcal !== null && row.kcal > thresholds.lowKcal + 600) {
      canonicalFindings.push("uneven_energy_distribution");
    }

    let canonicalNutritionStatus: NutritionCanonicalStatus = "adequate";
    if (suspect) {
      canonicalNutritionStatus = "suspect";
    } else if (
      canonicalTrainingType === "long_run" &&
      ((carbsPerKg !== null && carbsPerKg < 5) ||
        (kcalPerKgThreshold !== null && row.kcal !== null && row.kcal < kcalPerKgThreshold))
    ) {
      canonicalNutritionStatus = "long_run_low";
    } else if (
      canonicalTrainingType === "pre_long" &&
      ((carbsPerKg !== null && carbsPerKg < 4.5) || lowCarbs)
    ) {
      canonicalNutritionStatus = "pre_long_low";
    } else if (
      (canonicalTrainingType === "hard" || canonicalTrainingType === "race") &&
      carbsPerKg !== null &&
      carbsPerKg < 4.5
    ) {
      canonicalNutritionStatus = "low_for_load";
    } else if (canonicalTrainingType === "easy" && carbsPerKg !== null && carbsPerKg < 3) {
      canonicalNutritionStatus = "low_for_load";
    } else if (canonicalTrainingType === "rest") {
      canonicalNutritionStatus = "rest_ok";
      if (row.kcal !== null && thresholds.lowKcal !== null && row.kcal > thresholds.lowKcal + 700) {
        canonicalNutritionStatus = "ample";
      }
    } else if ((canonicalTrainingType === "hard" || canonicalTrainingType === "long_run") && carbsPerKg !== null && carbsPerKg >= 6) {
      canonicalNutritionStatus = "ample";
    }

    const canonicalRelevance: NutritionCanonicalRelevance =
      canonicalNutritionStatus === "suspect"
        ? "low_confidence"
        : canonicalNutritionStatus === "long_run_low" || canonicalNutritionStatus === "pre_long_low"
          ? "key"
          : canonicalNutritionStatus === "low_for_load"
            ? "important"
            : "normal";

    const sourceNotes: string[] = [];
    if (!input.bodyweightKg || input.bodyweightKg <= 0) {
      sourceNotes.push("missing_bodyweight");
    }
    if (!hasTrainingContext || input.trainingCacheStatus !== "ok") {
      sourceNotes.push("missing_training_context");
    }
    if (sortedRows.length < 7) {
      sourceNotes.push("partial_week");
    }
    if (row.kcal !== null && (row.kcal < 900 || row.kcal > 7000)) {
      sourceNotes.push("suspect_kcal");
    }
    if ((row.kcal ?? null) === 0 || (row.carbsG ?? null) === 0 || (row.proteinG ?? null) === 0 || (row.fatG ?? null) === 0) {
      sourceNotes.push("suspect_zero_macros");
    }

    const canonicalTrainingLinks: NutritionCanonicalDailyAnalysis["trainingNutritionLinks"] = [];
    if (currentWorkout) {
      canonicalTrainingLinks.push({
        sessionDate: currentWorkout.date,
        sessionType: currentWorkout.type,
        assessment:
          canonicalNutritionStatus === "long_run_low" || canonicalNutritionStatus === "pre_long_low" || canonicalNutritionStatus === "low_for_load"
            ? "needs_fuel_support"
            : "aligned_or_ok",
        confidence: currentWorkout.type === "long_run" || currentWorkout.type === "intervals" || currentWorkout.type === "tempo" ? "high" : "moderate",
      });
    }
    if (nextWorkout && nextIsHardOrLong) {
      canonicalTrainingLinks.push({
        sessionDate: nextWorkout.date,
        sessionType: nextWorkout.type,
        assessment: lowCarbs ? "day_before_key_low_carbs" : "day_before_key_ok",
        confidence: "moderate",
      });
    }

    const canonicalDailyAnalysis: NutritionCanonicalDailyAnalysis = {
      date: row.day,
      weekdayRu: toWeekdayRu(row.day),
      dateLabel: toDateLabel(row.day),
      trainingType: canonicalTrainingType,
      trainingLabel: buildCanonicalTrainingLabel({
        canonicalTrainingType,
        workout: currentWorkout ?? null,
      }),
      actual: {
        kcal: row.kcal,
        proteinG: row.proteinG,
        fatG: row.fatG,
        carbsG: row.carbsG,
        proteinGPerKg,
        carbsGPerKg,
      },
      target,
      flags: {
        rest: canonicalTrainingType === "rest",
        easy: canonicalTrainingType === "easy",
        hard: canonicalTrainingType === "hard" || canonicalTrainingType === "race",
        preLong: canonicalTrainingType === "pre_long",
        longRun: canonicalTrainingType === "long_run",
        dayBeforeKeyWorkout: nextIsHardOrLong,
        dayAfterKeyWorkout: prevIsHardOrLong,
        suspect,
      },
      nutritionStatus: canonicalNutritionStatus,
      relevance: canonicalRelevance,
      hintForComment: buildHintForComment(canonicalNutritionStatus),
      findings: [...new Set(canonicalFindings)],
      trainingNutritionLinks: canonicalTrainingLinks,
      sourceQuality: {
        hasNutritionData: row.kcal !== null || row.carbsG !== null || row.proteinG !== null || row.fatG !== null,
        hasTrainingContext,
        confidence:
          suspect || sourceNotes.includes("missing_training_context")
            ? "low"
            : sourceNotes.includes("missing_bodyweight") || sourceNotes.includes("partial_week")
              ? "medium"
              : "high",
        notes: sourceNotes,
      },
    };

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
      canonicalDailyAnalysis,
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
    trainingCacheStatus: context.tpPastWeek.cacheStatus,
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
