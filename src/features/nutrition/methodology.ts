import type {
  NutritionStudentContext,
  NutritionTrainingPeaksWeekContext,
  NormalizedManualMacroRow,
  NutritionFoodItem,
} from "@/features/nutrition/context";
import { sanitizeNutritionFoodItems } from "@/features/nutrition/context";
import { resolveNutritionActivityCoefByTitle } from "@/features/nutrition/activity-energy";
import type { NutritionGoalType } from "@/features/nutrition/repository";
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

export const NUTRITION_REVIEW_METHODOLOGY_VERSION = "ea_macro_narrative_v1";

export type NutritionTrainingType =
  | "rest"
  | "easy"
  | "long_run"
  | "long_endurance"
  | "intervals"
  | "tempo"
  | "race"
  | "strength"
  | "cross_training"
  | "unknown";

export type NutritionStatusForDay =
  | "adequate"
  | "low_for_load"
  | "below_energy_availability"
  | "below_energy_floor"
  | "low_for_cross_training"
  | "low_for_strength"
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
  | "long_endurance"
  | "pre_long"
  | "strength"
  | "cross_training"
  | "race"
  | "unknown";

export type NutritionCanonicalStatus =
  | "rest_ok"
  | "adequate"
  | "ample"
  | "low_for_load"
  | "low_fat"
  | "low_protein"
  | "below_energy_availability"
  | "below_energy_floor"
  | "low_for_cross_training"
  | "low_for_strength"
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
    strength: boolean;
    crossTraining: boolean;
    preLong: boolean;
    longRun: boolean;
    longEndurance?: boolean;
    dayBeforeKeyWorkout: boolean;
    dayAfterKeyWorkout: boolean;
    suspect: boolean;
  };
  energyAvailability: NutritionEnergyAvailabilityFacts;
  energyFloor: NutritionEnergyFloorFacts;
  macroGuardrails: NutritionMacroGuardrailsFacts;
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
  /**
   * Per-day product rows parsed from detailed reports. Optional and never used
   * to recompute totals — only to surface notable foods (coach-only by default).
   */
  items?: NutritionFoodItem[];
};

export type NutritionMacroStatus = "low" | "borderline" | "ok" | "high" | "unknown";

export type NutritionFatPercentStatus = "ok" | "borderline_high" | "high" | "unknown";

export const NUTRITION_FAT_PERCENT_HIGH_THRESHOLD = 40;
export const NUTRITION_FAT_PERCENT_BORDERLINE_HIGH_THRESHOLD = 37;

export type NutritionCarbLoadBasis =
  | "rest"
  | "easy"
  | "cross_training"
  | "strength"
  | "hard"
  | "long_run"
  | "long_endurance"
  | "pre_long"
  | "unknown";

export type NutritionMacroGuardrailsFacts = {
  protein: {
    gPerKg: number | null;
    status: NutritionMacroStatus;
    floorGPerKg: number;
    finding: string | null;
  };
  fat: {
    g: number | null;
    gPerKg: number | null;
    percentEnergy: number | null;
    status: NutritionMacroStatus;
    percentStatus?: NutritionFatPercentStatus;
    floorGPerKg: number;
    finding: string | null;
    coachOnlyFindings?: string[];
  };
  carbs: {
    gPerKg: number | null;
    status: NutritionMacroStatus;
    rangeMinGPerKg: number | null;
    rangeMaxGPerKg: number | null;
    loadBasis: NutritionCarbLoadBasis;
    finding: string | null;
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
  | "lose_high_fat"
  | "lose_steady_deficit"
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
    /** Task 10: weekly fat share is high (>~35% energy) — the lose-goal vector. */
    highFat: boolean;
  };
  adjacentTrainingWithoutNutritionDays: Array<{
    date: string;
    trainingLabel: string;
    durationMinutes: number | null;
  }>;
};

type WorkoutContextByDate = {
  date: string;
  title: string;
  type: NutritionTrainingType;
  secondaryTitles: string[];
  longRunSource: NutritionLongRunSource;
  longRunConfidence: "high" | "medium" | "low";
  description: string | null;
  coachComments: string | null;
  plannedText: string | null;
  durationHours: number | null;
  distanceKm: number | null;
  hasRunSession: boolean;
  hasLongEnduranceSession: boolean;
};

const PROTEIN_GUARD_LOW_G_PER_KG = 1.1;
const PROTEIN_GUARD_BORDERLINE_G_PER_KG = 1.5;
const PROTEIN_GUARD_SUFFICIENT_G_PER_KG = 1.5;
const PROTEIN_GUARD_HIGH_G_PER_KG = 2.0;

const WORKOUT_LOAD_PRIORITY: Record<NutritionTrainingType, number> = {
  long_endurance: 105,
  long_run: 100,
  race: 95,
  intervals: 90,
  tempo: 85,
  strength: 70,
  cross_training: 60,
  easy: 50,
  rest: 0,
  unknown: 10,
};

function formatAthleteWorkoutTitleRu(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    return "";
  }
  if (/\bpadel\b/i.test(normalized)) {
    return "падел";
  }
  if (/^strength$/i.test(normalized) || /силов/i.test(normalized)) {
    return "силовая";
  }
  if (/^running$/i.test(normalized) || /^run$/i.test(normalized) || /бег/i.test(normalized)) {
    return "бег";
  }
  return normalized;
}

function mergeWorkoutTitlesForDay(titles: string[]): string {
  const labels = titles.map(formatAthleteWorkoutTitleRu).filter(Boolean);
  return [...new Set(labels)].join(" + ");
}

export type NutritionEnergyAvailabilityFacts = {
  intakeKcal: number | null;
  exerciseEnergyKcal: number | null;
  exerciseEnergySource:
    | "trainingpeaks_workout_kcal"
    | "estimated_by_duration_or_distance"
    | "missing"
    | "none";
  bodyweightKg: number | null;
  fatFreeMassKg: number | null;
  ffmSource: "measured" | "estimated_from_bodyweight" | "missing";
  ffmCoefficient: number | null;
  ffmConfidence: "high" | "medium" | "low";
  eaKcalPerKgFfm: number | null;
  eaZone: "green" | "amber" | "red" | "unknown";
  confidence: "high" | "medium" | "low";
  notes: string[];
};

export type NutritionEnergyFloorFacts = {
  restFloorKcal: number | null;
  loadFloorKcal: number | null;
  strengthFloorKcal: number | null;
  crossTrainingFloorKcal: number | null;
  hardFloorKcal: number | null;
  belowRestFloor: boolean;
  belowLoadFloor: boolean;
  belowStrengthFloor: boolean;
  belowCrossTrainingFloor: boolean;
  belowHardFloor: boolean;
  floorSource: "bodyweight_fallback" | "none";
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

function addDays(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
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

export function normalizeTrainingType(rawType: string | null | undefined, title: string): NutritionTrainingType {
  const raw = (rawType ?? "").toLowerCase();
  const titleLc = title.toLowerCase();
  // "отдых"/"rest" often appears inside a workout title as recovery between reps
  // (e.g. "3 x 15 мин (отдых бегом)"). Only treat it as a rest DAY when the title
  // carries no actual workout evidence — otherwise an interval session would be
  // misread as a day off.
  const hasWorkoutEvidence =
    hasNutritionIntervalWorkoutEvidence(title) ||
    hasNutritionTempoWorkEvidence(title) ||
    isEasyLightNutritionTitle(title) ||
    isExplicitNutritionLongRunTitle(title) ||
    isExplicitRunTitle(title);
  if (raw === "day_off" || (/rest|отдых|day\s*off|выходн/.test(titleLc) && !hasWorkoutEvidence)) {
    return "rest";
  }
  if (raw === "strength") {
    return "strength";
  }
  if (
    raw === "crosstrain" ||
    raw === "cross_training" ||
    raw === "bike" ||
    raw === "swim" ||
    raw === "walk" ||
    raw === "hike" ||
    /\bpadel\b|падел|cross.?train|crosstrain|bike|cycling|swim|плав|вело|\b(?:walk|walking|hike|hiking|trek|tennis)\b|ходьб|прогулк|поход|хайк|теннис/.test(titleLc)
  ) {
    // Non-run activities (incl. walk/hike/tennis) → cross-training family, so they
    // are not mislabeled as "лёгкий бег" or evaluated against run carb targets.
    return "cross_training";
  }
  if (/race|гонк|соревн/.test(titleLc)) {
    return "race";
  }
  if (isEasyLightNutritionTitle(title)) {
    return "easy";
  }
  if (hasNutritionIntervalWorkoutEvidence(title)) {
    return "intervals";
  }
  if (hasNutritionTempoWorkEvidence(title)) {
    return "tempo";
  }
  if (raw === "long_run" || isExplicitNutritionLongRunTitle(title)) {
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
  const grouped = new Map<
    string,
    Array<{
      title: string;
      type: NutritionTrainingType;
      description: string | null;
      coachComments: string | null;
      plannedText: string | null;
      durationHours: number | null;
      distanceKm: number | null;
    }>
  >();
  for (const workout of week.workouts) {
    if (workout.status === "planned") {
      continue;
    }
    const inferredType = normalizeTrainingType(workout.type, workout.title);
    const isRunLike = inferredType === "easy" || inferredType === "long_run" || isExplicitRunTitle(workout.title);
    const isLongEndurance = isNutritionLongEnduranceWorkout({
      title: workout.title,
      durationHours: workout.durationHours,
      isRunLike,
    });
    const isLongRun = isNutritionLongRunWorkout({
      title: workout.title,
      durationHours: workout.durationHours,
      isCompleted: true,
      mode: "past_review",
    });
    const type =
      isLongEndurance
        ? "long_endurance"
        : isLongRun
          ? "long_run"
          : inferredType === "long_run"
            ? "easy"
            : inferredType;
    const sessions = grouped.get(workout.date) ?? [];
    sessions.push({
      title: workout.title,
      type,
      description: workout.description ?? null,
      coachComments: workout.coachComments ?? null,
      plannedText: workout.plannedText ?? null,
      durationHours: workout.durationHours ?? null,
      distanceKm: null,
    });
    grouped.set(workout.date, sessions);
  }

  const map = new Map<string, WorkoutContextByDate>();
  for (const [date, sessions] of grouped) {
    const sorted = [...sessions].sort((left, right) => WORKOUT_LOAD_PRIORITY[right.type] - WORKOUT_LOAD_PRIORITY[left.type]);
    const primary = sorted[0];
    if (!primary) {
      continue;
    }
    const hasStrength = sessions.some((session) => session.type === "strength");
    const hasEasy = sessions.some((session) => session.type === "easy");
    const hasRunSession = sessions.some((session) => session.type === "easy" || session.type === "long_run");
    const hasLongEnduranceSession = sessions.some((session) => session.type === "long_endurance");
    const effectiveType = hasStrength && hasEasy ? "easy" : primary.type;
    const longRunSource =
      effectiveType === "long_run"
        ? resolveNutritionLongRunSource({
            title: primary.title,
            durationHours: primary.durationHours,
          })
        : "none";
    map.set(date, {
      date,
      title: mergeWorkoutTitlesForDay(sessions.map((session) => session.title)),
      type: effectiveType,
      secondaryTitles: sorted.slice(1).map((session) => session.title),
      longRunSource,
      longRunConfidence: resolveNutritionLongRunConfidence(longRunSource),
      description: primary.description,
      coachComments: primary.coachComments,
      plannedText: primary.plannedText,
      durationHours: primary.durationHours,
      distanceKm: primary.distanceKm,
      hasRunSession,
      hasLongEnduranceSession,
    });
  }
  return map;
}

function asSex(context: NutritionStudentContext): "female" | "male" | "unknown" {
  // Task 10++: explicit profile field wins; fall back to the legacy note heuristic.
  if (context.sex === "female" || context.sex === "male") {
    return context.sex;
  }
  const haystack = `${context.telegramContextNotes ?? ""} ${context.nutritionGoal ?? ""}`.toLowerCase();
  if (/\bfemale\b|жен|девушк/.test(haystack)) {
    return "female";
  }
  if (/\bmale\b|муж|парен/.test(haystack)) {
    return "male";
  }
  return "unknown";
}

// Task 10d (Bug 2): per-hour energy cost by workout intensity (kcal/kg/h).
// Intervals/tempo/race are harder than an easy jog of the same duration, so they
// must drive higher expenditure → higher maintenance/EA → more fuel. Applies to
// ALL goals. Long runs are normally estimated from distance; this covers the
// duration fallback for them.
const NUTRITION_EXERCISE_KCAL_PER_KG_PER_HOUR: Record<NutritionTrainingType, number> = {
  intervals: 12,
  race: 12,
  tempo: 11,
  long_run: 10,
  long_endurance: 9,
  easy: 8,
  cross_training: 7,
  strength: 5,
  rest: 0,
  unknown: 9,
};

function estimateExerciseEnergyKcal(input: {
  workout: WorkoutContextByDate | null;
  bodyweightKg: number | null;
}): {
  exerciseEnergyKcal: number | null;
  exerciseEnergySource: NutritionEnergyAvailabilityFacts["exerciseEnergySource"];
} {
  if (!input.workout) {
    return { exerciseEnergyKcal: 0, exerciseEnergySource: "none" };
  }
  if (!input.bodyweightKg || input.bodyweightKg <= 0) {
    return { exerciseEnergyKcal: null, exerciseEnergySource: "missing" };
  }
  const bw = input.bodyweightKg;
  // Task 10d (Bug 2): expenditure scales with INTENSITY, not just duration.
  // Intervals/tempo burn more per hour than an easy jog of the same length.
  // Long runs use distance (≈ km × bw) when available, else duration × the
  // long-run coefficient (fixes the prior null when distance was missing).
  if (
    (input.workout.type === "long_run" || input.workout.type === "long_endurance") &&
    input.workout.distanceKm !== null &&
    input.workout.distanceKm > 0
  ) {
    return {
      exerciseEnergyKcal: Math.round(input.workout.distanceKm * bw),
      exerciseEnergySource: "estimated_by_duration_or_distance",
    };
  }
  if (input.workout.durationHours !== null && input.workout.durationHours > 0) {
    // Activity-specific coefficient (walk/hike/tennis/padel/bike/swim/strength) wins
    // over the run-intensity default, so a non-run session is costed correctly.
    const perKgPerHour =
      resolveNutritionActivityCoefByTitle(input.workout.title) ??
      NUTRITION_EXERCISE_KCAL_PER_KG_PER_HOUR[input.workout.type] ??
      9;
    return {
      exerciseEnergyKcal: Math.round(input.workout.durationHours * bw * perKgPerHour),
      exerciseEnergySource: "estimated_by_duration_or_distance",
    };
  }
  return { exerciseEnergyKcal: null, exerciseEnergySource: "missing" };
}

function ffmCoefficientForSex(sex: "female" | "male" | "unknown"): number {
  if (sex === "female") {
    return 0.78;
  }
  if (sex === "male") {
    return 0.82;
  }
  return 0.8;
}

function zoneForEa(value: number | null): NutritionEnergyAvailabilityFacts["eaZone"] {
  if (value === null) {
    return "unknown";
  }
  if (value < 30) {
    return "red";
  }
  if (value < 45) {
    return "amber";
  }
  return "green";
}

export function calculateNutritionEnergyAvailabilityFacts(input: {
  intakeKcal: number | null;
  exerciseEnergyKcal: number | null;
  exerciseEnergySource: NutritionEnergyAvailabilityFacts["exerciseEnergySource"];
  bodyweightKg: number | null;
  sex: "female" | "male" | "unknown";
  measuredFatFreeMassKg?: number | null;
  hasLoad: boolean;
}): NutritionEnergyAvailabilityFacts {
  const notes: string[] = [];
  let fatFreeMassKg: number | null = null;
  let ffmSource: NutritionEnergyAvailabilityFacts["ffmSource"] = "missing";
  let ffmCoefficient: number | null = null;

  if (input.measuredFatFreeMassKg && input.measuredFatFreeMassKg > 0) {
    fatFreeMassKg = Number(input.measuredFatFreeMassKg.toFixed(1));
    ffmSource = "measured";
  } else if (input.bodyweightKg && input.bodyweightKg > 0) {
    ffmCoefficient = ffmCoefficientForSex(input.sex);
    fatFreeMassKg = Number((input.bodyweightKg * ffmCoefficient).toFixed(1));
    ffmSource = "estimated_from_bodyweight";
    notes.push("estimated_ffm_used");
  }

  if (input.sex === "male") {
    notes.push("male_ea_threshold_less_validated");
  }

  const exerciseEnergyMissing = input.hasLoad && input.exerciseEnergyKcal === null;
  if (exerciseEnergyMissing) {
    notes.push("exercise_energy_missing");
  }
  if (ffmSource === "missing") {
    notes.push("ffm_missing");
  }

  const intakeKcal = input.intakeKcal;
  const exerciseEnergyKcal = input.exerciseEnergyKcal;
  const ffmForCalculation = fatFreeMassKg;
  let eaKcalPerKgFfm: number | null = null;
  if (intakeKcal !== null && exerciseEnergyKcal !== null && ffmForCalculation !== null && ffmForCalculation > 0) {
    eaKcalPerKgFfm = Number(((intakeKcal - exerciseEnergyKcal) / ffmForCalculation).toFixed(1));
  }
  const eaZone = zoneForEa(eaKcalPerKgFfm);
  const confidence: NutritionEnergyAvailabilityFacts["confidence"] =
    eaKcalPerKgFfm === null || exerciseEnergyMissing
      ? "low"
      : ffmSource === "measured" && input.exerciseEnergySource === "trainingpeaks_workout_kcal"
        ? "high"
        : "medium";

  return {
    intakeKcal: input.intakeKcal,
    exerciseEnergyKcal: input.exerciseEnergyKcal,
    exerciseEnergySource: input.exerciseEnergySource,
    bodyweightKg: input.bodyweightKg,
    fatFreeMassKg,
    ffmSource,
    ffmCoefficient,
    ffmConfidence: ffmSource === "measured" ? "high" : ffmSource === "estimated_from_bodyweight" ? "medium" : "low",
    eaKcalPerKgFfm,
    eaZone,
    confidence,
    notes: [...new Set(notes)],
  };
}

export function calculateNutritionEnergyFloorFacts(input: {
  intakeKcal: number | null;
  bodyweightKg: number | null;
  trainingType: NutritionCanonicalTrainingType;
  hasLoad: boolean;
}): NutritionEnergyFloorFacts {
  if (!input.bodyweightKg || input.bodyweightKg <= 0) {
    return {
      restFloorKcal: null,
      loadFloorKcal: null,
      strengthFloorKcal: null,
      crossTrainingFloorKcal: null,
      hardFloorKcal: null,
      belowRestFloor: false,
      belowLoadFloor: false,
      belowStrengthFloor: false,
      belowCrossTrainingFloor: false,
      belowHardFloor: false,
      floorSource: "none",
    };
  }

  const bw = input.bodyweightKg;
  const restFloorKcal = Math.round(25 * bw);
  const loadFloorKcal = Math.round(30 * bw);
  const strengthFloorKcal = Math.round(30 * bw);
  const crossTrainingFloorKcal = Math.round(30 * bw);
  const hardFloorKcal = Math.round(35 * bw);
  const kcal = input.intakeKcal;
  return {
    restFloorKcal,
    loadFloorKcal,
    strengthFloorKcal,
    crossTrainingFloorKcal,
    hardFloorKcal,
    belowRestFloor: kcal !== null && kcal < restFloorKcal,
    belowLoadFloor: kcal !== null && input.hasLoad && kcal < loadFloorKcal,
    belowStrengthFloor: kcal !== null && input.trainingType === "strength" && kcal < strengthFloorKcal,
    belowCrossTrainingFloor: kcal !== null && input.trainingType === "cross_training" && kcal < crossTrainingFloorKcal,
    belowHardFloor:
      kcal !== null &&
      (input.trainingType === "hard" ||
        input.trainingType === "long_run" ||
        input.trainingType === "long_endurance" ||
        input.trainingType === "race") &&
      kcal < hardFloorKcal,
    floorSource: "bodyweight_fallback",
  };
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
    return input.trainingType === "rest" ? "rest" : "unknown";
  }
  if (input.trainingType === "long_run") {
    return "long_run";
  }
  if (input.trainingType === "long_endurance") {
    return "long_endurance";
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
  if (input.trainingType === "cross_training") {
    return "cross_training";
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
  if (input.canonicalTrainingType === "long_endurance") {
    return {
      carbsGPerKgMin: 6,
      carbsGPerKgMax: 8,
      carbsGMin: Number((6 * bodyweight).toFixed(0)),
      carbsGMax: Number((8 * bodyweight).toFixed(0)),
      kcalMin: Number((35 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_long_endurance",
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
      carbsGPerKgMax: 5,
      carbsGMin: Number((3.5 * bodyweight).toFixed(0)),
      carbsGMax: Number((5 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_easy",
    };
  }
  if (input.canonicalTrainingType === "cross_training") {
    return {
      carbsGPerKgMin: 5,
      carbsGPerKgMax: 7,
      carbsGMin: Number((5 * bodyweight).toFixed(0)),
      carbsGMax: Number((7 * bodyweight).toFixed(0)),
      kcalMin: Number((30 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_cross_training",
    };
  }
  if (input.canonicalTrainingType === "strength") {
    return {
      carbsGPerKgMin: 4,
      carbsGPerKgMax: 6,
      carbsGMin: Number((4 * bodyweight).toFixed(0)),
      carbsGMax: Number((6 * bodyweight).toFixed(0)),
      kcalMin: Number((30 * bodyweight).toFixed(0)),
      proteinGMin: Number((1.6 * bodyweight).toFixed(0)),
      formulaCode: "canonical_daily_v1_strength",
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
  if (input.canonicalTrainingType === "cross_training") {
    if (/\bpadel\b/i.test(title)) {
      return "падел";
    }
    return formatAthleteWorkoutTitleRu(title) || "кросс-тренировка";
  }
  if (input.canonicalTrainingType === "long_run") {
    const distanceFromTitle = normalizeDistanceFromTitleKm(title);
    const distanceKm = input.workout.distanceKm ?? distanceFromTitle;
    if (distanceKm !== null) {
      return `длительная ${formatDistanceKmRu(distanceKm)}`;
    }
    return title ? `длительная: ${title}` : "длительная";
  }
  if (input.canonicalTrainingType === "long_endurance") {
    const durationHours = input.workout.durationHours ?? null;
    const durationLabel =
      durationHours && durationHours > 0
        ? ` ${Math.floor(durationHours)}:${String(Math.round((durationHours % 1) * 60)).padStart(2, "0")}`
        : "";
    return title ? `длинная выносливостная нагрузка${durationLabel}: ${title}` : `длинная выносливостная нагрузка${durationLabel}`;
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
  if (status === "low_fat") {
    return "По жирам день просел ниже мягкого пола; отметить спокойно и без медицинских причин.";
  }
  if (status === "low_protein") {
    return "Белок ниже мягкого ориентира; отметить коротко, не уводя фокус от энергии и углеводов под нагрузку.";
  }
  if (status === "below_energy_availability") {
    return "Для такого дня энергии получилось маловато; написать мягко, без медицинских терминов и без точных добавок ккал.";
  }
  if (status === "below_energy_floor") {
    return "Общая энергия ниже мягкого ориентира для дня; написать спокойно и без тревожных формулировок.";
  }
  if (status === "low_for_cross_training") {
    return "Кросс-тренировка тоже нагрузка: день низкий по общей энергии; не давать OK fallback.";
  }
  if (status === "low_for_strength") {
    return "Силовая пришлась на низкую общую энергию; не давать OK fallback.";
  }
  if (status === "ample") {
    return "Сытный день пришёлся на отдых/лёгкий день; отметить нейтрально в контексте распределения по неделе.";
  }
  if (status === "suspect") {
    return "По дню есть сомнения в качестве данных; нужен осторожный комментарий без жёстких выводов.";
  }
  return "Нагрузка и питание в целом согласованы; можно дать краткий поддерживающий комментарий.";
}

function resolveCarbLoadBasis(trainingType: NutritionCanonicalTrainingType): NutritionCarbLoadBasis {
  if (trainingType === "rest") {
    return "rest";
  }
  if (trainingType === "easy") {
    return "easy";
  }
  if (trainingType === "cross_training") {
    return "cross_training";
  }
  if (trainingType === "strength") {
    return "strength";
  }
  if (trainingType === "hard" || trainingType === "race") {
    return "hard";
  }
  if (trainingType === "long_run") {
    return "long_run";
  }
  if (trainingType === "long_endurance") {
    return "long_endurance";
  }
  if (trainingType === "pre_long") {
    return "pre_long";
  }
  return "unknown";
}

function resolveCarbRangeByLoadBasis(loadBasis: NutritionCarbLoadBasis): {
  rangeMinGPerKg: number | null;
  rangeMaxGPerKg: number | null;
} {
  if (loadBasis === "rest") {
    return { rangeMinGPerKg: 3, rangeMaxGPerKg: 5 };
  }
  if (loadBasis === "easy") {
    return { rangeMinGPerKg: 4, rangeMaxGPerKg: 6 };
  }
  if (loadBasis === "cross_training") {
    return { rangeMinGPerKg: 4.5, rangeMaxGPerKg: 6.5 };
  }
  if (loadBasis === "strength") {
    return { rangeMinGPerKg: 4, rangeMaxGPerKg: 6 };
  }
  if (loadBasis === "hard") {
    return { rangeMinGPerKg: 5.5, rangeMaxGPerKg: 7 };
  }
  if (loadBasis === "long_run") {
    return { rangeMinGPerKg: 6, rangeMaxGPerKg: 10 };
  }
  if (loadBasis === "long_endurance") {
    return { rangeMinGPerKg: 6, rangeMaxGPerKg: 8 };
  }
  if (loadBasis === "pre_long") {
    return { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 };
  }
  return { rangeMinGPerKg: null, rangeMaxGPerKg: null };
}

function buildMacroGuardrails(input: {
  proteinGPerKg: number | null;
  fatG: number | null;
  kcal: number | null;
  bodyweightKg: number | null;
  carbsGPerKg: number | null;
  canonicalTrainingType: NutritionCanonicalTrainingType;
}): NutritionMacroGuardrailsFacts {
  const proteinFloor = PROTEIN_GUARD_SUFFICIENT_G_PER_KG;
  const fatFloor = 1.0;
  const fatGPerKg =
    input.fatG !== null && input.bodyweightKg && input.bodyweightKg > 0
      ? Number((input.fatG / input.bodyweightKg).toFixed(2))
      : null;
  const fatPercentEnergy =
    input.fatG !== null && input.kcal !== null && input.kcal > 0
      ? Number((((input.fatG * 9) / input.kcal) * 100).toFixed(1))
      : null;

  let proteinStatus: NutritionMacroStatus = "unknown";
  let proteinFinding: string | null = null;
  if (input.proteinGPerKg !== null) {
    if (input.proteinGPerKg < PROTEIN_GUARD_LOW_G_PER_KG) {
      proteinStatus = "low";
      proteinFinding = "Белка маловато.";
    } else if (input.proteinGPerKg < PROTEIN_GUARD_BORDERLINE_G_PER_KG) {
      proteinStatus = "borderline";
      proteinFinding = "Белок чуть ниже ориентира.";
    } else if (input.proteinGPerKg > PROTEIN_GUARD_HIGH_G_PER_KG) {
      proteinStatus = "high";
      proteinFinding = null;
    } else {
      proteinStatus = "ok";
      proteinFinding = "Белок закрыт хорошо.";
    }
  }

  let fatStatus: NutritionMacroStatus = "unknown";
  let fatFinding: string | null = null;
  let percentStatus: NutritionFatPercentStatus = "unknown";
  const coachOnlyFindings: string[] = [];
  if (fatPercentEnergy !== null) {
    if (fatPercentEnergy >= NUTRITION_FAT_PERCENT_HIGH_THRESHOLD) {
      percentStatus = "high";
    } else if (fatPercentEnergy >= NUTRITION_FAT_PERCENT_BORDERLINE_HIGH_THRESHOLD) {
      percentStatus = "borderline_high";
    } else {
      percentStatus = "ok";
    }
  }
  const highByGPerKg = fatGPerKg !== null && fatGPerKg > 1.6;
  const highByPercent = percentStatus === "high";
  if (fatGPerKg !== null) {
    if (fatGPerKg < 0.8) {
      fatStatus = "low";
      fatFinding =
        "Жиры в этот день низковаты. Не нужно специально держать такие дни слишком сухими по жирам, особенно если они повторяются.";
    } else if (fatGPerKg < 1) {
      fatStatus = "borderline";
      fatFinding = "Жиры на нижней границе, лучше регулярно не уходить ниже.";
    } else if (highByGPerKg || highByPercent) {
      fatStatus = "high";
      fatFinding = null;
      if (highByPercent) {
        coachOnlyFindings.push("high_fat_percent");
      }
    } else {
      fatStatus = "ok";
      fatFinding = null;
    }
  } else if (highByPercent) {
    fatStatus = "high";
    coachOnlyFindings.push("high_fat_percent");
  }

  const loadBasis = resolveCarbLoadBasis(input.canonicalTrainingType);
  const carbRange = resolveCarbRangeByLoadBasis(loadBasis);
  let carbsStatus: NutritionMacroStatus = "unknown";
  let carbsFinding: string | null = null;
  if (
    input.carbsGPerKg !== null &&
    carbRange.rangeMinGPerKg !== null &&
    carbRange.rangeMaxGPerKg !== null
  ) {
    if (input.carbsGPerKg < carbRange.rangeMinGPerKg - 0.4) {
      carbsStatus = "low";
      carbsFinding = "Углеводов для такого дня низковато.";
    } else if (input.carbsGPerKg < carbRange.rangeMinGPerKg) {
      carbsStatus = "borderline";
      carbsFinding = "Углеводы на нижней границе для такой нагрузки.";
    } else if (input.carbsGPerKg > carbRange.rangeMaxGPerKg + 0.6) {
      carbsStatus = "high";
      carbsFinding = null;
    } else {
      carbsStatus = "ok";
      carbsFinding = null;
    }
  }

  const loadBasisForFat = resolveCarbLoadBasis(input.canonicalTrainingType);
  const isLoadDayForFat = loadBasisForFat !== "rest";
  if (
    (fatStatus === "high" || percentStatus === "high" || percentStatus === "borderline_high") &&
    isLoadDayForFat &&
    input.carbsGPerKg !== null
  ) {
    const carbRangeForFat = resolveCarbRangeByLoadBasis(loadBasisForFat);
    if (
      carbRangeForFat.rangeMinGPerKg !== null &&
      (input.carbsGPerKg < carbRangeForFat.rangeMinGPerKg ||
        input.carbsGPerKg < carbRangeForFat.rangeMinGPerKg + 0.4)
    ) {
      coachOnlyFindings.push("high_fat_may_displace_carbs_on_load_day");
    }
  }

  return {
    protein: {
      gPerKg: input.proteinGPerKg,
      status: proteinStatus,
      floorGPerKg: proteinFloor,
      finding: proteinFinding,
    },
    fat: {
      g: input.fatG,
      gPerKg: fatGPerKg,
      percentEnergy: fatPercentEnergy,
      status: fatStatus,
      percentStatus,
      floorGPerKg: fatFloor,
      finding: fatFinding,
      coachOnlyFindings: coachOnlyFindings.length > 0 ? coachOnlyFindings : undefined,
    },
    carbs: {
      gPerKg: input.carbsGPerKg,
      status: carbsStatus,
      rangeMinGPerKg: carbRange.rangeMinGPerKg,
      rangeMaxGPerKg: carbRange.rangeMaxGPerKg,
      loadBasis,
      finding: carbsFinding,
    },
  };
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
  sex: "female" | "male" | "unknown";
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

    const isHardOrLong =
      trainingType === "long_run" ||
      trainingType === "long_endurance" ||
      trainingType === "intervals" ||
      trainingType === "tempo" ||
      trainingType === "race";
    const nextIsHardOrLong =
      nextDayTrainingType === "long_run" ||
      nextDayTrainingType === "long_endurance" ||
      nextDayTrainingType === "intervals" ||
      nextDayTrainingType === "tempo" ||
      nextDayTrainingType === "race";
    const prevIsHardOrLong =
      previousDayTrainingType === "long_run" ||
      previousDayTrainingType === "long_endurance" ||
      previousDayTrainingType === "intervals" ||
      previousDayTrainingType === "tempo" ||
      previousDayTrainingType === "race";
    const isPreLong =
      (nextDayTrainingType === "long_run" || nextDayTrainingType === "long_endurance") &&
      trainingType !== "long_run" &&
      trainingType !== "long_endurance" &&
      trainingType !== "intervals" &&
      trainingType !== "tempo";
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

    if (trainingType === "long_run" || trainingType === "long_endurance") {
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

    if (trainingType === "strength" && row.kcal !== null && input.bodyweightKg && row.kcal < 30 * input.bodyweightKg) {
      findings.push("В день силовой общая энергия ниже мягкого ориентира для дня с нагрузкой.");
      trainingNutritionLinks.push("В день силовой важно не оставлять питание слишком низким по энергии.");
      nutritionStatus = "low_for_strength";
      relevance = "high";
    }

    if (trainingType === "cross_training" && row.kcal !== null && input.bodyweightKg && row.kcal < 30 * input.bodyweightKg) {
      findings.push("Кросс-тренировка совпала с низкой общей энергией.");
      trainingNutritionLinks.push("Кросс-тренировка тоже даёт нагрузку, день лучше не делать слишком пустым.");
      nutritionStatus = "low_for_cross_training";
      relevance = "high";
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
    const canonicalHasLoad =
      canonicalTrainingType === "easy" ||
      canonicalTrainingType === "hard" ||
      canonicalTrainingType === "long_run" ||
      canonicalTrainingType === "long_endurance" ||
      canonicalTrainingType === "pre_long" ||
      canonicalTrainingType === "race" ||
      canonicalTrainingType === "strength" ||
      canonicalTrainingType === "cross_training";
    const target = buildCanonicalTarget({
      canonicalTrainingType,
      bodyweightKg: input.bodyweightKg,
      hasTrainingContext,
    });
    const exerciseEnergy = estimateExerciseEnergyKcal({
      workout: currentWorkout ?? null,
      bodyweightKg: input.bodyweightKg,
    });
    const energyAvailability = calculateNutritionEnergyAvailabilityFacts({
      intakeKcal: row.kcal,
      exerciseEnergyKcal: exerciseEnergy.exerciseEnergyKcal,
      exerciseEnergySource: exerciseEnergy.exerciseEnergySource,
      bodyweightKg: input.bodyweightKg,
      sex: input.sex,
      hasLoad: canonicalHasLoad,
    });
    const energyFloor = calculateNutritionEnergyFloorFacts({
      intakeKcal: row.kcal,
      bodyweightKg: input.bodyweightKg,
      trainingType: canonicalTrainingType,
      hasLoad: canonicalHasLoad,
    });
    const macroGuardrails = buildMacroGuardrails({
      proteinGPerKg,
      fatG: row.fatG,
      kcal: row.kcal,
      bodyweightKg: input.bodyweightKg,
      carbsGPerKg,
      canonicalTrainingType,
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
    if (proteinGPerKg !== null && proteinGPerKg >= PROTEIN_GUARD_SUFFICIENT_G_PER_KG) {
      canonicalFindings.push("protein_sufficient");
    }
    if (macroGuardrails.protein.status === "low") {
      canonicalFindings.push("protein_low");
    } else if (macroGuardrails.protein.status === "borderline") {
      canonicalFindings.push("protein_borderline");
    }
    if (macroGuardrails.fat.status === "low") {
      canonicalFindings.push("fat_below_floor");
    } else if (macroGuardrails.fat.status === "borderline") {
      canonicalFindings.push("fat_borderline");
    }
    if (macroGuardrails.fat.status === "high" || macroGuardrails.fat.percentStatus === "high") {
      canonicalFindings.push("high_fat_percent");
    }
    for (const finding of macroGuardrails.fat.coachOnlyFindings ?? []) {
      if (!canonicalFindings.includes(finding)) {
        canonicalFindings.push(finding);
      }
    }
    if (macroGuardrails.carbs.status === "low") {
      canonicalFindings.push("low_carbs_for_load_type");
    } else if (macroGuardrails.carbs.status === "borderline") {
      canonicalFindings.push("carbs_borderline_for_load_type");
    }
    for (const note of energyAvailability.notes) {
      canonicalFindings.push(note);
    }
    if (energyAvailability.eaZone === "red") {
      canonicalFindings.push("ea_red_screen");
    } else if (energyAvailability.eaZone === "amber") {
      canonicalFindings.push("ea_amber_screen");
    }
    if (energyFloor.belowLoadFloor) {
      canonicalFindings.push("below_load_energy_floor");
    }
    if (energyFloor.belowCrossTrainingFloor) {
      canonicalFindings.push("below_cross_training_floor");
      canonicalFindings.push("low_energy_with_cross_training");
    }
    if (energyFloor.belowStrengthFloor) {
      canonicalFindings.push("below_strength_floor");
      canonicalFindings.push("low_energy_with_strength");
    }
    if (canonicalFindings.includes("protein_sufficient") && (energyFloor.belowLoadFloor || energyAvailability.eaZone === "red")) {
      canonicalFindings.push("protein_ok_but_energy_low");
    }
    const carbsPerKg = carbsGPerKg;
    const kcalPerKgThreshold = input.bodyweightKg && input.bodyweightKg > 0 ? 35 * input.bodyweightKg : null;
    if (
      (canonicalTrainingType === "hard" ||
        canonicalTrainingType === "race" ||
        canonicalTrainingType === "long_endurance") &&
      carbsPerKg !== null &&
      carbsPerKg < 4.5
    ) {
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
    } else if (energyAvailability.eaZone === "red" || energyAvailability.eaZone === "amber") {
      canonicalNutritionStatus = "below_energy_availability";
    } else if (energyFloor.belowCrossTrainingFloor) {
      canonicalNutritionStatus = "low_for_cross_training";
    } else if (energyFloor.belowStrengthFloor) {
      canonicalNutritionStatus = "low_for_strength";
    } else if (energyFloor.belowHardFloor || energyFloor.belowLoadFloor || energyFloor.belowRestFloor) {
      canonicalNutritionStatus = "below_energy_floor";
    } else if (
      (canonicalTrainingType === "long_run" || canonicalTrainingType === "long_endurance") &&
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
      macroGuardrails.carbs.status === "low" &&
      (canonicalTrainingType === "easy" ||
        canonicalTrainingType === "hard" ||
        canonicalTrainingType === "race" ||
        canonicalTrainingType === "long_run" ||
        canonicalTrainingType === "long_endurance" ||
        canonicalTrainingType === "pre_long" ||
        canonicalTrainingType === "cross_training" ||
        canonicalTrainingType === "strength")
    ) {
      canonicalNutritionStatus = "low_for_load";
    } else if (macroGuardrails.fat.status === "low") {
      canonicalNutritionStatus = "low_fat";
    } else if (macroGuardrails.protein.status === "low") {
      canonicalNutritionStatus = "low_protein";
    } else if (canonicalTrainingType === "rest") {
      canonicalNutritionStatus = "rest_ok";
      if (row.kcal !== null && thresholds.lowKcal !== null && row.kcal > thresholds.lowKcal + 700) {
        canonicalNutritionStatus = "ample";
      }
    } else if (
      (canonicalTrainingType === "hard" ||
        canonicalTrainingType === "long_run" ||
        canonicalTrainingType === "long_endurance") &&
      carbsPerKg !== null &&
      carbsPerKg >= 6
    ) {
      canonicalNutritionStatus = "ample";
    }

    const canonicalRelevance: NutritionCanonicalRelevance =
      canonicalNutritionStatus === "suspect"
          ? "low_confidence"
          : canonicalNutritionStatus === "long_run_low" || canonicalNutritionStatus === "pre_long_low"
            ? "key"
          : canonicalNutritionStatus === "low_for_load" ||
              canonicalNutritionStatus === "below_energy_availability" ||
              canonicalNutritionStatus === "below_energy_floor" ||
              canonicalNutritionStatus === "low_for_cross_training" ||
              canonicalNutritionStatus === "low_for_strength" ||
              canonicalNutritionStatus === "low_fat" ||
              canonicalNutritionStatus === "low_protein"
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
        confidence:
          currentWorkout.type === "long_run" ||
          currentWorkout.type === "long_endurance" ||
          currentWorkout.type === "intervals" ||
          currentWorkout.type === "tempo"
            ? "high"
            : "moderate",
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
        strength: canonicalTrainingType === "strength",
        crossTraining: canonicalTrainingType === "cross_training",
        preLong: canonicalTrainingType === "pre_long",
        longRun: canonicalTrainingType === "long_run",
        longEndurance: canonicalTrainingType === "long_endurance",
        dayBeforeKeyWorkout: nextIsHardOrLong,
        dayAfterKeyWorkout: prevIsHardOrLong,
        suspect,
      },
      energyAvailability,
      energyFloor,
      macroGuardrails,
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
      ...(row.items && row.items.length > 0
        ? { items: sanitizeNutritionFoodItems(row.items) }
        : {}),
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

function buildAdjacentTrainingWithoutNutritionDays(input: {
  rows: NormalizedManualMacroRow[];
  workoutsByDate: Map<string, WorkoutContextByDate>;
  lookbackDays: number;
}): Array<{ date: string; trainingLabel: string; durationMinutes: number | null }> {
  const rowDates = new Set(input.rows.filter((row) => !row.day.startsWith("unresolved:")).map((row) => row.day));
  const sortedDates = [...rowDates].sort();
  const weekStart = sortedDates[0] ?? null;
  if (!weekStart) {
    return [];
  }
  const result: Array<{ date: string; trainingLabel: string; durationMinutes: number | null }> = [];
  for (let index = 1; index <= input.lookbackDays; index += 1) {
    const candidate = addDays(weekStart, -index);
    if (rowDates.has(candidate)) {
      continue;
    }
    const workout = input.workoutsByDate.get(candidate);
    if (!workout || workout.type === "rest") {
      continue;
    }
    result.push({
      date: candidate,
      trainingLabel: workout.title || "тренировка",
      durationMinutes: workout.durationHours ? Math.round(workout.durationHours * 60) : null,
    });
  }
  return result;
}

export function buildNutritionMethodologyContext(input: {
  context: NutritionStudentContext;
}): NutritionMethodologyContext {
  const { context } = input;
  const bodyweightKg = context.currentWeightKg ?? null;
  const sex = asSex(context);
  const workoutsByDate = buildWorkoutContextByDate(context.tpPastWeek);
  const dailyAnalysis = analyzeDailyTrainingNutrition({
    rows: context.manualMacroRows,
    workoutsByDate,
    bodyweightKg,
    sex,
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
  const proteinSufficient = (averages.proteinGPerKg ?? 0) >= PROTEIN_GUARD_SUFFICIENT_G_PER_KG;
  const severeEnergyAvailability =
    dailyAnalysis.filter((day) => {
      const canonical = day.canonicalDailyAnalysis;
      return (
        canonical.energyAvailability.eaZone === "red" ||
        canonical.findings.includes("below_load_energy_floor") ||
        (day.kcal ?? 9999) < 1300 ||
        (day.carbsG ?? 9999) < 90
      );
    }).length >= 2;
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
        day.previousDayTrainingType === "long_endurance" ||
        day.previousDayTrainingType === "intervals" ||
        day.previousDayTrainingType === "tempo" ||
        day.previousDayTrainingType === "race") &&
      (day.nutritionStatus === "low_for_load" || day.nutritionStatus === "moderate_for_load")
  );
  const carbsAroundKeySessions = dailyAnalysis.some(
    (day) =>
      (day.nextDayTrainingType === "long_run" ||
        day.nextDayTrainingType === "long_endurance" ||
        day.nextDayTrainingType === "intervals" ||
        day.nextDayTrainingType === "tempo" ||
        day.nextDayTrainingType === "race") &&
      day.nutritionStatus === "low_for_load"
  );
  const weeklyConsistency =
    dailyAnalysis.filter(
      (day) =>
        day.nutritionStatus === "low_for_load" ||
        day.nutritionStatus === "below_energy_floor" ||
        day.nutritionStatus === "below_energy_availability" ||
        day.nutritionStatus === "low_for_cross_training" ||
        day.nutritionStatus === "low_for_strength"
    ).length >= 2;
  const proteinSupport = !proteinSufficient && (averages.proteinGPerKg ?? 0) > 0;
  // Task 10: high weekly fat share (>~35% energy) — for a weight-loss goal this is
  // the main lever (excess calories), so the focus surfaces it instead of falling
  // through to a vague maintenance focus (Bug C).
  const highFat =
    averages.fatG != null && averages.kcal != null && averages.kcal > 0
      ? (averages.fatG * 9) / averages.kcal > 0.35
      : false;
  const heavyTraining =
    context.tpPastWeek.longRun !== null ||
    context.tpPastWeek.keyWorkouts.length > 0 ||
    dailyAnalysis.some((day) => day.trainingType === "long_endurance");
  const carbProgressionStrategy = detectCarbProgressionStrategy({
    avgCarbsGPerKg: averages.carbsGPerKg,
    hasHeavyTraining: heavyTraining,
  });
  const longRunFuelingInstructionDetected = dailyAnalysis.some((day) => day.trainingType === "long_run" && day.duringRunFuelPlanned === true);
  const duringRunFuelPlanned = longRunFuelingInstructionDetected;

  const trainingNutritionLinks = [...new Set(dailyAnalysis.flatMap((day) => day.trainingNutritionLinks))];
  const adjacentTrainingWithoutNutritionDays = buildAdjacentTrainingWithoutNutritionDays({
    rows: context.manualMacroRows,
    workoutsByDate,
    lookbackDays: 1,
  });
  return {
    bodyweightKg,
    sex,
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
      // A genuine no-training week has an empty TP cache by definition — that is
      // expected, not a data gap. Only treat empty/non-ok cache as limited data
      // when it is NOT a confirmed no-training week (Task 5b).
      limitedData:
        context.manualMacroRows.length < 3 ||
        (context.tpPastWeek.cacheStatus !== "ok" && context.noTrainingWeek !== true),
      highFat,
    },
    adjacentTrainingWithoutNutritionDays,
  };
}

export function selectNutritionWeeklyFocus(input: {
  methodology: NutritionMethodologyContext;
  blockedSafety: boolean;
  goalType?: NutritionGoalType;
}): NutritionOneFocus {
  if (input.blockedSafety) {
    return {
      category: "blocked_safety",
      statementRu: "Сначала нужна ручная проверка безопасности, без рекомендаций ученику.",
      progressionStrategy: "maintain",
    };
  }
  const s = input.methodology.focusCandidateSignals;
  const goalType = input.goalType ?? "maintain";
  if (s.limitedData) {
    return {
      category: "limited_data",
      statementRu: "Данных пока недостаточно для точного тренировка-день анализа, нужен ручной разбор.",
      progressionStrategy: "small_step",
    };
  }
  // Task 10: for a weight-loss goal, safety-critical signals still come first
  // (handled above + severeEnergyAvailability below). But the day-to-day vector
  // for losing is calories/fat, not "add fuel" — so when there is no genuine
  // hard-day underfueling, surface a goal-relevant focus instead of the vague
  // maintenance fallback (Bug C). Fuel-for-work on hard/long days still wins.
  if (goalType === "lose" && !s.severeEnergyAvailability && !s.hardSessionUnderfueling && !s.longRunUnderfueling) {
    if (s.highFat) {
      return {
        category: "lose_high_fat",
        statementRu:
          "Главный фокус при снижении — жир высоковат (лишние калории): сместить часть в белок и овощи, углеводы держать вокруг тренировок, а не везде.",
        progressionStrategy: "maintain",
      };
    }
    return {
      category: "lose_steady_deficit",
      statementRu:
        "Главный фокус — ровный мягкий минус: держим высокий белок, углеводы вокруг тренировок, спокойнее в дни отдыха. Без жёстких ограничений.",
      progressionStrategy: "maintain",
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
