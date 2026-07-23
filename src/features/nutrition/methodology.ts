import type {
  NutritionStudentContext,
  NutritionTrainingPeaksWeekContext,
  NormalizedManualMacroRow,
  NutritionFoodItem,
  NutritionWorkoutTimeOfDay,
} from "@/features/nutrition/context";
import { rowLooksUnrealistic, sanitizeNutritionFoodItems } from "@/features/nutrition/context";
import {
  isNutritionTrivialShortActivity,
  resolveNutritionActivityCoefByTitle,
  sumDaySessionsExpenditureKcal,
} from "@/features/nutrition/activity-energy";
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
  trainingPeaksDurationHoursToMinutes,
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
  // Factual part of day of the session (from start_time). null when unknown —
  // consumers must not invent a time. Review-only; never set from planned time.
  timeOfDay: NutritionWorkoutTimeOfDay | null;
  /**
   * Duration of the day's PRIMARY (hardest) session, in minutes. Exposed because the carb
   * corridor scales by it, and every consumer must scale by the SAME number: without this
   * the review's energy target for an 80-minute long run was computed from the "unknown
   * duration" corridor (5.5-9 → 350 г) while the plan for that very day asked 290 г.
   * Read it from here — do NOT re-derive it from the workout list, or the third copy of
   * "which session is the primary one" will drift away from the other two.
   */
  workoutDurationMinutes: number | null;
  actual: {
    kcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbsG: number | null;
    proteinGPerKg: number | null;
    carbsGPerKg: number | null;
  };
  target: {
    /** Energy FLOOR for the day (e.g. 35 kcal/kg on a long run) — a safety bound, not a target. */
    kcalMin?: number | null;
    kcalMax?: number | null;
    /**
     * The day's ENERGY TARGET — the kcal the athlete actually reads on her plan line, filled in by
     * draft-generator for every goal (goal-aware for lose/gain, the ideal day-type target for
     * maintain). Distinct from kcalMin, which is a floor: the prose may cite THIS as an orientation
     * («ориентир около 2300»), and the number validator allows it on the same terms as the carb
     * bounds.
     */
    kcalTarget?: number | null;
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

type WorkoutSessionContext = {
  type: NutritionTrainingType;
  title: string;
  durationHours: number | null;
  distanceKm: number | null;
};

type WorkoutContextByDate = {
  date: string;
  title: string;
  type: NutritionTrainingType;
  secondaryTitles: string[];
  // Task 10d (Bug б): every session of the day (run, strength, …). The day type is
  // still the primary's (below), but expenditure sums over ALL of these.
  sessions: WorkoutSessionContext[];
  longRunSource: NutritionLongRunSource;
  longRunConfidence: "high" | "medium" | "low";
  description: string | null;
  coachComments: string | null;
  plannedText: string | null;
  durationHours: number | null;
  distanceKm: number | null;
  hasRunSession: boolean;
  hasLongEnduranceSession: boolean;
  // Factual part of day of the PRIMARY session (from start_time). null when unknown.
  timeOfDay: NutritionWorkoutTimeOfDay | null;
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

/**
 * TrainingPeaks activity names arrive in English — «Pilates», «Lap Swimming», «Hiit»,
 * «Walking» — and used to reach the athlete verbatim: the fallback below is `return
 * normalized`, and only three names were covered, so everything else went out in English.
 * 39 real days across 20 athletes carried an English workout name; combined days read
 * «бег + Pilates», «Lap Swimming + Pilates».
 *
 * The list is taken from the DATA — every Latin title actually present in the athletes'
 * TrainingPeaks calendars — not invented. An unknown name still falls through unchanged:
 * a raw name is better than a wrong translation.
 *
 * THIS IS THE LABEL ONLY, AND IT CANNOT MOVE A DAY BETWEEN TYPES. normalizeTrainingType
 * runs on the RAW session title, before the day's titles are merged through here (see
 * buildWorkoutContextByDate), so classification never sees the translation. The one
 * consumer that reads the merged title and cares about words — isLightIntermittentCross-
 * TrainingTitle — matches «ходьб» as well as «walk», so «Walking» → «ходьба» stays a light
 * cross day and its carb corridor does not move.
 */
export function formatAthleteWorkoutTitleRu(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    return "";
  }
  // HIIT is a strength session — there is no HIIT mode on a running watch (coach's call), and
  // normalizeTrainingType already classifies it as strength. The label follows the classification.
  if (/\bhiit\b|хиит/iu.test(normalized)) {
    return "силовая";
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
  // Open water BEFORE the generic swim rule, or it would collapse into plain «плавание».
  if (/open\s*water\s*swim/i.test(normalized)) {
    return "плавание на открытой воде";
  }
  if (/\bswim(?:ming)?\b/i.test(normalized)) {
    return "плавание";
  }
  if (/\bwalk(?:ing)?\b/i.test(normalized)) {
    return "ходьба";
  }
  if (/\bpilates\b/i.test(normalized)) {
    return "пилатес";
  }
  if (/\byoga\b/i.test(normalized)) {
    return "йога";
  }
  if (/\bcycling\b|\bbik(?:e|ing)\b/i.test(normalized)) {
    return "велотренировка";
  }
  if (/\bkayak(?:ing)?\b/i.test(normalized)) {
    return "каякинг";
  }
  if (/\belliptical\b/i.test(normalized)) {
    return "эллипс";
  }
  // «8 x 4 мин» — a Latin x standing in for the multiplication sign. The words are already
  // Russian; only the glyph is foreign, and after the names above it is the last Latin left in
  // the athlete's labels. Swapped ONLY between digits, so nothing else can be caught by it.
  // Classification is untouched: normalizeTrainingType reads the RAW title, and its interval
  // regex accepts «x» and «х» alike.
  return normalized.replace(/(\d\s*)x(\s*\d)/gi, "$1х$2");
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

export function formatDistanceKmRu(distanceKm: number): string {
  // Whole distances drop the decimal («10 км», «18 км»); fractional keep one («21,1 км»).
  const rounded = Math.round(distanceKm * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} км`;
}

/**
 * Наряд 3: recognise a RACE from a workout title — забег/старт/гонка/соревнование/
 * паркран/полу-/марафон/ультра/триатлон — WITHOUT misreading marathon-PACE training
 * runs ("бег в темпе марафона", "15 км в темпе марафона", "марафонским темпом") or
 * route notes ("по маршруту забега") as actual races. Events from the TP scanner /
 * manual marks come through a separate path (raw === "race"); this only covers races
 * a coach logged as a workout.
 */
export function isNutritionRaceTitle(title: string): boolean {
  const t = (title ?? "").toLowerCase();
  if (!t.trim()) {
    return false;
  }
  // Exclude pace-run / prep / route phrasings that merely mention a race distance.
  const paceOrPrep =
    /в\s+темпе|марафонск[\p{L}]*\s+темп|темп[\p{L}]*\s+марафон|в\s+марафонском|маршрут[\p{L}]*\s+забег|подготовк[\p{L}]*\s+к|к\s+марафону|to\s+marathon|marathon\s+pace|race\s+pace/u.test(
      t
    );
  if (paceOrPrep) {
    return false;
  }
  // Low-ambiguity race nouns (substring); marathon variants are already guarded
  // by paceOrPrep above. \p{L} lookarounds are Unicode word boundaries (\b is
  // ASCII-only and never fires around Cyrillic).
  return /гонк|соревнов|паркран|полумарафон|ультрамарафон|триатлон|марафон|(?<![\p{L}])(?:забег|старт|ультра|race|parkrun|triathlon)(?![\p{L}])/u.test(
    t
  );
}

export function normalizeTrainingType(rawType: string | null | undefined, title: string): NutritionTrainingType {
  const raw = (rawType ?? "").toLowerCase();
  const titleLc = title.toLowerCase();
  // Наряд 3: explicit race entity (injected from a TP race event / manual mark)
  // wins regardless of title wording.
  if (raw === "race") {
    return "race";
  }
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
  // Coach's call (2026-07-14): elliptical is light-tempo effort, not a cross-training
  // machine (bike/swim/walk carry a lower coefficient and a different corridor) and not
  // "unknown" (TP has no dedicated type id for it — arrives as workoutTypeValueId=100,
  // "Other" — so it fell all the way through to unknown: priority 10 instead of 50, a
  // day with only elliptical would have been read as no-training-evidence). Checked on
  // the TITLE, ahead of the cross_training block below, so the general TP classifier's
  // family assignment (crosstrain, for OTHER general-purpose consumers of that
  // classifier) can never downgrade this specific nutrition decision.
  if (/\belliptical\b|эллипс/iu.test(titleLc)) {
    return "easy";
  }
  // Coach's call (2026-07-14): unqualified "Cardio" (no further detail — TP's generic
  // cardio-machine bucket) is the same light-tempo effort as elliptical, same reasoning,
  // same bypass ahead of cross_training.
  if (/\bcardio\b|кардио/iu.test(titleLc)) {
    return "easy";
  }
  if (
    raw === "crosstrain" ||
    raw === "cross_training" ||
    raw === "bike" ||
    raw === "swim" ||
    raw === "walk" ||
    raw === "hike" ||
    // Coach's call (2026-07-14): yoga/pilates/jump rope/ice skating/volleyball had NO
    // classification anywhere (same "Other"/workoutTypeValueId=100 root cause as
    // elliptical) and fell to unknown. Folded into the EXISTING cross_training bucket
    // rather than inventing a parallel mechanism — yoga/pilates additionally qualify as
    // "light" below (low glycogen depletion, same reasoning as padel/tennis/walk); jump
    // rope/ice skating/volleyball get the regular (non-light) cross_training corridor.
    /\bpadel\b|падел|cross.?train|crosstrain|bike|cycling|swim|плав|вело|\b(?:walk|walking|hike|hiking|trek|tennis)\b|ходьб|прогулк|поход|хайк|теннис|\byoga\b|йога|\bpilates\b|пилатес|jump\s*rope|скакалк|ice\s*skating|коньк|volleyball|волейбол/.test(
      titleLc
    )
  ) {
    // Non-run activities (incl. walk/hike/tennis) → cross-training family, so they
    // are not mislabeled as "лёгкий бег" or evaluated against run carb targets.
    return "cross_training";
  }
  if (isNutritionRaceTitle(title)) {
    return "race";
  }
  if (isEasyLightNutritionTitle(title)) {
    return "easy";
  }
  // HIIT on a watch is almost always a strength/circuit session — athletes rarely do
  // true HIIT — so treat a HIIT-titled day as STRENGTH (4–6 г/кг), not a hard interval
  // session (5–6.5 г/кг). A title with REAL interval structure (reps «8×4», VO2,
  // sprint, «интервалы», tempo/threshold) still wins as hard even if it also says HIIT.
  const hasRealHardStructure =
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\b/iu.test(title) ||
    /интерв|interval|vo2|спринт|sprint|hill|порог|threshold|tempo|темп/iu.test(titleLc);
  if (/\bhiit\b|хиит/iu.test(titleLc) && !hasRealHardStructure) {
    return "strength";
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
      timeOfDay: NutritionWorkoutTimeOfDay | null;
    }>
  >();
  for (const workout of week.workouts) {
    if (workout.status === "planned") {
      continue;
    }
    // Поток D-5: drop a trivially short non-essential activity (10-min open-water dip,
    // 15-min stroll) from the day's session aggregate so it doesn't inflate the day
    // type/label. Run/strength have no threshold. Aggregate-only — does not touch the
    // expenditure formula; a day with a real session keeps it.
    if (
      isNutritionTrivialShortActivity({
        title: workout.title,
        durationMinutes: trainingPeaksDurationHoursToMinutes(workout.durationHours),
      })
    ) {
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
      // An explicit race (raw type "race", incl. a reconciled marathon) stays a race:
      // its long duration must not demote it to long_endurance/long_run, or the day
      // loses its race identity (label, loading, protocol all key on type "race").
      inferredType === "race"
        ? "race"
        : isLongEndurance
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
      // Carry distance ONLY for races, so the canonical label can say «забег 10 км»
      // (the race entity's distance lives on the event, not the title). Other types
      // stay null — review expenditure for them is duration-based, so this is inert.
      distanceKm: type === "race" ? workout.distanceKm ?? null : null,
      timeOfDay: workout.timeOfDay ?? null,
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
    const hasRunSession = sessions.some((session) => session.type === "easy" || session.type === "long_run");
    const hasLongEnduranceSession = sessions.some((session) => session.type === "long_endurance");
    // Coach's call (2026-07-23): a day with BOTH strength and an easy/light session used to be
    // forced to "easy" here regardless of priority (removed override, see git history) — an
    // unvalidated day-one design choice with no documented real-data basis. It silently demoted
    // ~324 real days (measured: 318 run+strength, 6 elliptical+strength) to "easy", losing the
    // strength-day protein emphasis and the strength carb corridor (4-6 vs easy's 3.5-6 g/kg) even
    // though strength (priority 70) legitimately outranks easy (50). The plan side never had this
    // override and picks the priority winner cleanly (pickPrimaryWorkout) — review now matches.
    const effectiveType = primary.type;
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
      // All sessions for expenditure summation (Bug б). Each keeps its own type/
      // duration so a run+strength day costs run-energy + strength-energy.
      sessions: sessions.map((session) => ({
        type: session.type,
        title: session.title,
        durationHours: session.durationHours,
        distanceKm: session.distanceKm,
      })),
      longRunSource,
      longRunConfidence: resolveNutritionLongRunConfidence(longRunSource),
      description: primary.description,
      coachComments: primary.coachComments,
      plannedText: primary.plannedText,
      durationHours: primary.durationHours,
      distanceKm: primary.distanceKm,
      hasRunSession,
      hasLongEnduranceSession,
      // Part of day of the primary (load-dominant) session — factual start_time only.
      timeOfDay: primary.timeOfDay ?? null,
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

// Energy for ONE session, by its own intensity. Long runs use distance (≈ km × bw)
// when available, else duration × the long-run coefficient. Returns null when the
// session has neither duration nor usable distance (cannot estimate it).
function estimateSessionEnergyKcal(session: WorkoutSessionContext, bw: number): number | null {
  // Task 10d (Bug 2): expenditure scales with INTENSITY, not just duration.
  if (
    (session.type === "long_run" || session.type === "long_endurance" || session.type === "race") &&
    session.distanceKm !== null &&
    session.distanceKm > 0
  ) {
    // A reconciled race carries the OFFICIAL distance (e.g. 42.2 km), so distance×bw
    // uses the clean figure rather than the inflated GPS one. Races with no distance
    // fall through to the duration×intensity estimate below.
    return Math.round(session.distanceKm * bw);
  }
  if (session.durationHours !== null && session.durationHours > 0) {
    // Activity-specific coefficient (walk/hike/tennis/padel/bike/swim/strength) wins
    // over the run-intensity default, so a non-run session is costed correctly.
    const perKgPerHour =
      resolveNutritionActivityCoefByTitle(session.title) ??
      NUTRITION_EXERCISE_KCAL_PER_KG_PER_HOUR[session.type] ??
      9;
    return Math.round(session.durationHours * bw * perKgPerHour);
  }
  return null;
}

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
  // Task 10d (Bug б): sum every session of the day (run + strength + …), each by
  // its own intensity, so a multi-session day isn't under-credited. A single-session
  // day is byte-identical to the previous primary-only estimate.
  const sessions =
    input.workout.sessions.length > 0
      ? input.workout.sessions
      : [
          {
            type: input.workout.type,
            title: input.workout.title,
            durationHours: input.workout.durationHours,
            distanceKm: input.workout.distanceKm,
          },
        ];
  const estimable = sessions.some((session) => estimateSessionEnergyKcal(session, bw) !== null);
  if (!estimable) {
    // Sessions exist but none has duration/distance — same "missing" as before.
    return { exerciseEnergyKcal: null, exerciseEnergySource: "missing" };
  }
  const total = sumDaySessionsExpenditureKcal(sessions, (session) => estimateSessionEnergyKcal(session, bw));
  return { exerciseEnergyKcal: total, exerciseEnergySource: "estimated_by_duration_or_distance" };
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
  /** No TP row for this date is ambiguous: a genuine rest day (coach just didn't
   * mark it) vs a sync gap/failure (don't know). Only trust it as confident "rest"
   * when the week's scan itself came back healthy. */
  trainingCacheStatus: NutritionTrainingPeaksWeekContext["cacheStatus"];
}): NutritionCanonicalTrainingType {
  if (input.preLong) {
    return "pre_long";
  }
  if (!input.hasTrainingContext) {
    return input.trainingType === "rest" && input.trainingCacheStatus === "ok" ? "rest" : "unknown";
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

// Light, intermittent cross-training — racket games with pauses (padel, tennis),
// walking/hiking, and (coach's call, 2026-07-14) yoga/pilates — flexibility/core work with
// the same low glycogen depletion as an intermittent racket game, not continuous endurance.
// These do NOT deplete glycogen like continuous endurance, so they are fuelled at easy-day
// carb level, not the 5-7 г/кг endurance band. Continuous endurance cross-training (bike,
// swim, cycling) is intentionally NOT matched here — it stays high, and neither is jump
// rope/ice skating/volleyball, which are real calorie-burning cardio/game activity, not
// low-intensity flexibility work — they get the regular (non-light) cross_training corridor.
function isLightIntermittentCrossTrainingTitle(title: string): boolean {
  const t = title.toLowerCase();
  return /\bpadel\b|падел|\b(?:walk|walking|hike|hiking|trek|tennis)\b|ходьб|прогулк|поход|хайк|теннис|\byoga\b|йога|\bpilates\b|пилатес/.test(
    t
  );
}

function buildCanonicalTarget(input: {
  canonicalTrainingType: NutritionCanonicalTrainingType;
  bodyweightKg: number | null;
  hasTrainingContext: boolean;
  crossTrainingIsLight?: boolean;
  // The day's primary session duration. Feeds every duration-scaled corridor
  // (long_run and hard) — NOT long-run-only, or the displayed target would drift
  // away from the ok/low status, which reads the same duration for every type.
  workoutDurationMinutes?: number | null;
}): NutritionCanonicalDailyAnalysis["target"] {
  if (!input.bodyweightKg || input.bodyweightKg <= 0) {
    return {
      formulaCode: "missing_weight",
    };
  }

  const bodyweight = input.bodyweightKg;
  // "unknown" here means genuinely low-confidence data (no TP row AND the week's
  // scan itself wasn't healthy) — see inferCanonicalTrainingType. A confident rest
  // day (no TP row, but the scan is fine) resolves to canonicalTrainingType "rest"
  // and falls through to that branch below, same corridor as any other rest day.
  if (input.canonicalTrainingType === "unknown") {
    return {
      carbsGPerKgMin: 3,
      carbsGPerKgMax: 5,
      carbsGMin: Number((3 * bodyweight).toFixed(0)),
      carbsGMax: Number((5 * bodyweight).toFixed(0)),
      proteinGMin: Number((1.6 * bodyweight).toFixed(0)),
      formulaCode: "limited_context",
    };
  }

  // SINGLE SOURCE for the carb corridor: resolveCarbRangeByLoadBasis is the same
  // table that drives macro_guardrails.carbs.status (ok/low), so the displayed
  // target and the internal status can never disagree for the same day again.
  // Everything below this line only adds the per-type EXTRAS that guardrails
  // doesn't carry (kcal floor, protein floor, formulaCode) — the carb numbers
  // themselves come from one place.
  const loadBasis = resolveCarbLoadBasis(input.canonicalTrainingType);
  const range = resolveCarbRangeByLoadBasis(
    loadBasis,
    input.workoutDurationMinutes ?? null,
    input.crossTrainingIsLight,
    input.canonicalTrainingType === "race"
  );
  if (range.rangeMinGPerKg === null || range.rangeMaxGPerKg === null) {
    return {
      formulaCode: "limited_context",
    };
  }
  const carbsGPerKgMin = range.rangeMinGPerKg;
  const carbsGPerKgMax = range.rangeMaxGPerKg;
  const carbsGMin = Number((carbsGPerKgMin * bodyweight).toFixed(0));
  const carbsGMax = Number((carbsGPerKgMax * bodyweight).toFixed(0));

  // proteinGMin: SAME 1.6 g/kg the plan side already uses for every day type
  // (weekly-plan-formulas.ts DAY_TYPE_FORMULAS) - protein need does not depend on
  // today's training type the way carbs do. Previously only "strength" carried this
  // field, so the model had to invent its own protein orientation for every other
  // day type (it lands on the same 1.6 g/kg by general nutrition knowledge, but the
  // number validator rejects it as "not in facts" since it was never in target) -
  // the whole day's prose then fell to the dry deterministic comment for a real,
  // formula-matching number the code just never wrote down.
  const proteinGMin = Number((1.6 * bodyweight).toFixed(0));
  if (input.canonicalTrainingType === "long_run") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      kcalMin: Number((35 * bodyweight).toFixed(0)),
      proteinGMin,
      formulaCode: "canonical_daily_v1_long_run",
    };
  }
  if (input.canonicalTrainingType === "long_endurance") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      kcalMin: Number((35 * bodyweight).toFixed(0)),
      proteinGMin,
      formulaCode: "canonical_daily_v1_long_endurance",
    };
  }
  if (input.canonicalTrainingType === "pre_long") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      proteinGMin,
      formulaCode: "canonical_daily_v1_pre_long",
    };
  }
  if (input.canonicalTrainingType === "hard" || input.canonicalTrainingType === "race") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      proteinGMin,
      formulaCode: "canonical_daily_v1_hard",
    };
  }
  if (input.canonicalTrainingType === "easy") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      proteinGMin,
      formulaCode: "canonical_daily_v1_easy",
    };
  }
  if (input.canonicalTrainingType === "cross_training") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      kcalMin: Number((30 * bodyweight).toFixed(0)),
      proteinGMin,
      formulaCode: input.crossTrainingIsLight
        ? "canonical_daily_v1_cross_training_light"
        : "canonical_daily_v1_cross_training",
    };
  }
  if (input.canonicalTrainingType === "strength") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      kcalMin: Number((30 * bodyweight).toFixed(0)),
      proteinGMin,
      formulaCode: "canonical_daily_v1_strength",
    };
  }
  if (input.canonicalTrainingType === "rest") {
    return {
      carbsGPerKgMin,
      carbsGPerKgMax,
      carbsGMin,
      carbsGMax,
      proteinGMin,
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
  // Check "rest" before the missing-workout fallback: a confident rest day (no TP
  // row, scan healthy — see inferCanonicalTrainingType) already resolved to "rest"
  // and deserves the honest label, not "no workout in TrainingPeaks".
  if (input.canonicalTrainingType === "rest") {
    return "день отдыха";
  }
  if (!input.workout) {
    // Бренд в тексте ученице ни к чему — она читает про свой день, а не про наш инструмент.
    return "день без тренировки по плану";
  }
  const title = input.workout.title.trim();
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
  if (input.canonicalTrainingType === "race") {
    const distanceFromTitle = normalizeDistanceFromTitleKm(title);
    const distanceKm = input.workout.distanceKm ?? distanceFromTitle;
    return distanceKm !== null ? `забег ${formatDistanceKmRu(distanceKm)}` : "забег";
  }
  if (input.canonicalTrainingType === "hard") {
    return title || "ключевая тренировка";
  }
  return title || "тренировка";
}

function buildHintForComment(status: NutritionCanonicalStatus, findings: string[]): string {
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
    // "below_energy_availability" is set for BOTH the red and amber EA zones — amber
    // alone (no ea_red_screen) is a soft screen on an often-ESTIMATED FFM, not a
    // confirmed shortfall. Only nudge gently for amber; keep the firmer hint for red.
    if (!findings.includes("ea_red_screen")) {
      return "Мягкий, пограничный сигнал по энергодоступности на приблизительной оценке состава тела — НЕ утверждать нехватку энергии как факт; можно вскользь, без акцента, отметить общий уровень энергии под нагрузку, если это уместно.";
    }
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

export function resolveCarbLoadBasis(trainingType: NutritionCanonicalTrainingType): NutritionCarbLoadBasis {
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

export function resolveCarbRangeByLoadBasis(
  loadBasis: NutritionCarbLoadBasis,
  workoutDurationMinutes?: number | null,
  crossTrainingIsLight?: boolean,
  // A race and a hard session share one load basis (resolveCarbLoadBasis collapses them), but they
  // must NOT share one carb corridor: the duration grid below lowers the floor for short quality
  // work, and a race is never "short quality work" — a 25-minute 5k is still a race, run at maximal
  // effort, and the days around it LOAD carbs rather than trim them. Callers that know the day is a
  // race say so; the corridor then ignores duration entirely. Everything else about the race day
  // (protein, fat, EA) keeps riding the hard basis, which is why this is a flag and not a new basis.
  isRaceDay?: boolean
): {
  rangeMinGPerKg: number | null;
  rangeMaxGPerKg: number | null;
} {
  if (loadBasis === "rest") {
    return { rangeMinGPerKg: 3, rangeMaxGPerKg: 5 };
  }
  if (loadBasis === "easy") {
    // Lower bound kept at the pre-unify 3.5 (not 4.0) — verified on 227 real days
    // (2026-07-08 Option B Layer 3): raising it to 4.0 would falsely flag 6 real
    // easy-day cases at 3.2-3.57 g/kg as "low" that were correctly "ok". Upper
    // bound raised to 6 (from 5) — that direction only removed false "high" flags
    // (5.6-6.03 g/kg cases), coach-confirmed safe.
    return { rangeMinGPerKg: 3.5, rangeMaxGPerKg: 6 };
  }
  if (loadBasis === "cross_training") {
    if (crossTrainingIsLight) {
      // Padel/tennis/walk/hike: intermittent, not glycogen-depleting → easy-day
      // band, matching buildCanonicalTarget's cross_training_light band (bb22de3).
      return { rangeMinGPerKg: 3.5, rangeMaxGPerKg: 5 };
    }
    return { rangeMinGPerKg: 4.5, rangeMaxGPerKg: 6.5 };
  }
  if (loadBasis === "strength") {
    return { rangeMinGPerKg: 4, rangeMaxGPerKg: 6 };
  }
  if (loadBasis === "hard") {
    // RACE: floor 5 ALWAYS, duration is irrelevant (coach decision, 2026-07-14). A race is maximal
    // effort by definition, and the short ones are the sharpest — a 25-minute 5k needs carbs in
    // full, not the lowered floor the grid gives short quality work. Trimming the floor before a
    // race would also contradict the plan, which LOADS carbs into race day (its own 5.3 g/kg floor).
    if (isRaceDay) {
      return { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 };
    }
    // Scale the floor by session duration, as long_run below already does — hard was
    // the only load basis judging 40 min of intervals and 2 h of tempo by one number.
    // Coach-approved grid (2026-07-13), measured on 27 real hard days:
    //   < 45 min  → 4-7  (short quality work; floor lowered, removes 1 false "low")
    //   >= 45 min → 5-7  (unchanged, and deliberately NOT raised for long sessions)
    //
    // The 5.0 floor above 45 min stays exactly as validated on 227 real days
    // (2026-07-08 Option B Layer 3): raising it to 5.5 would falsely flag 2 real
    // hard days at 4.71-4.92 g/kg as "low" that were correctly "ok". Ceiling stays 7.
    //
    // Duration here is the day's PRIMARY (hardest) session, not the day's total time
    // — see buildWorkoutContextByDate. Combined days (intervals + bike/pilates) must
    // not be scaled on inflated total time, which overstates the quality work.
    const minutes = workoutDurationMinutes ?? null;
    if (minutes !== null && minutes < 45) {
      return { rangeMinGPerKg: 4, rangeMaxGPerKg: 7 };
    }
    return { rangeMinGPerKg: 5, rangeMaxGPerKg: 7 };
  }
  if (loadBasis === "long_run") {
    // Scale the long-run carb corridor by the run's actual duration. A short/easy
    // long run (right at the 80-min long-run threshold) depletes far less glycogen
    // than a 2h+ marathon-prep long run, so a flat 6 g/kg lower bound over-flags
    // small long runs as "мало углеводов". Coach-approved grid (duration is the
    // primary signal — more reliable than GPS distance):
    //   <110 min  → 4.5–8   (short / easy long run)
    //   110–150   → 5.5–9   (moderate)
    //   ≥150 min  → 6–10    (2h+ marathon volume — unchanged)
    //   unknown   → 5.5–9   (safe middle; never re-inflate to 6.0 without evidence)
    const min = workoutDurationMinutes ?? null;
    if (min !== null && min < 110) {
      return { rangeMinGPerKg: 4.5, rangeMaxGPerKg: 8 };
    }
    if (min !== null && min < 150) {
      return { rangeMinGPerKg: 5.5, rangeMaxGPerKg: 9 };
    }
    if (min !== null) {
      return { rangeMinGPerKg: 6, rangeMaxGPerKg: 10 };
    }
    return { rangeMinGPerKg: 5.5, rangeMaxGPerKg: 9 };
  }
  if (loadBasis === "long_endurance") {
    // Matches buildCanonicalTarget's long_endurance band (2c3b839): a light
    // recreational long bike must not be fuelled MORE than a long run. Was 6-8,
    // which inverted bike > run.
    return { rangeMinGPerKg: 5, rangeMaxGPerKg: 6.5 };
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
  /** Duration of the day's load-dominant session, used to scale the long_run corridor. */
  workoutDurationMinutes?: number | null;
  /** Padel/tennis/walk/hike vs continuous endurance cross-training — see resolveCarbRangeByLoadBasis. */
  crossTrainingIsLight?: boolean;
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
  const carbRange = resolveCarbRangeByLoadBasis(
    loadBasis,
    input.workoutDurationMinutes,
    input.crossTrainingIsLight,
    input.canonicalTrainingType === "race"
  );
  let carbsStatus: NutritionMacroStatus = "unknown";
  let carbsFinding: string | null = null;
  if (
    input.carbsGPerKg !== null &&
    carbRange.rangeMinGPerKg !== null &&
    carbRange.rangeMaxGPerKg !== null
  ) {
    // Carb under-target is flagged ONLY when the day is more than 10% BELOW the
    // lower bound of its corridor. In-corridor (>= lower) is fine, and a near-miss
    // (within 10% below the lower bound — «почти дотянула») is not flagged either,
    // so a generally-on-target athlete isn't nagged for every load day. The 10% is
    // taken from the LOWER bound (carbRange.rangeMinGPerKg), and because that bound
    // is day-type-specific, loading days are judged against THEIR own lower bound.
    const carbsLowerFlagThresholdGPerKg = carbRange.rangeMinGPerKg * 0.9;
    if (input.carbsGPerKg < carbsLowerFlagThresholdGPerKg) {
      carbsStatus = "low";
      carbsFinding = "Углеводов для такого дня низковато.";
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
    const carbRangeForFat = resolveCarbRangeByLoadBasis(
      loadBasisForFat,
      input.workoutDurationMinutes,
      input.crossTrainingIsLight,
      input.canonicalTrainingType === "race"
    );
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
      trainingCacheStatus: input.trainingCacheStatus,
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
    const crossTrainingIsLight =
      canonicalTrainingType === "cross_training" &&
      isLightIntermittentCrossTrainingTitle(currentWorkout?.title ?? "");
    const target = buildCanonicalTarget({
      canonicalTrainingType,
      bodyweightKg: input.bodyweightKg,
      hasTrainingContext,
      crossTrainingIsLight,
      workoutDurationMinutes: trainingPeaksDurationHoursToMinutes(currentWorkout?.durationHours ?? null),
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
      workoutDurationMinutes: trainingPeaksDurationHoursToMinutes(currentWorkout?.durationHours ?? null),
      crossTrainingIsLight,
    });
    const suspect =
      row.confidence < 0.6 ||
      (row.kcal !== null && (row.kcal < 900 || row.kcal > 7000)) ||
      (row.carbsG !== null && row.carbsG === 0) ||
      (row.proteinG !== null && row.proteinG === 0);

    // Likely-broken INPUT (not just "suspect"): clearly impossible numbers — a single item
    // >3000 kcal («Котлета Домашняя» 17454), a day >7000 kcal, or a macro far outside the
    // human range. Deliberately EXCLUDES the kcal<900 / low-confidence cases: a genuinely
    // low day is real under-eating (handled by the very_low_kcal prompt rule) and must NOT
    // be mislabeled «ошибка ввода». The outlier item is named so the day prose can point at it.
    const suspectOutlierItem =
      suspect && row.items && row.items.length > 0
        ? [...row.items].sort((a, b) => (b.kcal ?? 0) - (a.kcal ?? 0))[0] ?? null
        : null;
    const suspectItemName =
      suspectOutlierItem && (suspectOutlierItem.kcal ?? 0) > 3000 ? suspectOutlierItem.name?.trim() || null : null;
    const brokenInput =
      suspectItemName !== null ||
      (row.kcal !== null && row.kcal > 7000) ||
      (row.proteinG !== null && row.proteinG > 350) ||
      (row.fatG !== null && row.fatG > 250) ||
      (row.carbsG !== null && row.carbsG > 900);

    const canonicalFindings: string[] = [];
    if (!input.bodyweightKg || input.bodyweightKg <= 0) {
      canonicalFindings.push("missing_weight");
    }
    // A confident rest day (no TP row, but the week's scan is healthy) is NOT
    // "limited context" — canonicalTrainingType already resolved that distinction
    // (inferCanonicalTrainingType). Only a genuinely unhealthy scan — whether or
    // not a workout row exists — earns this finding.
    if (input.trainingCacheStatus !== "ok") {
      canonicalFindings.push("limited_training_context");
    }
    if (suspect) {
      canonicalFindings.push("suspect_macro_values");
    }
    if (brokenInput) {
      canonicalFindings.push("broken_input_values");
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
              // amber-only below_energy_availability is a soft screen — only bump
              // relevance for the confirmed-red case, same split as hasDayEnergyIssue.
              (canonicalNutritionStatus === "below_energy_availability" &&
                canonicalFindings.includes("ea_red_screen")) ||
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
    if (input.trainingCacheStatus !== "ok") {
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
      // Same expression the corridor and the ok/low status already use — one duration, one
      // primary-session pick, no third copy to drift.
      workoutDurationMinutes: trainingPeaksDurationHoursToMinutes(currentWorkout?.durationHours ?? null),
      // FACT only: part of day from start_time of the completed session.
      timeOfDay: currentWorkout?.timeOfDay ?? null,
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
      hintForComment: brokenInput
        ? `${buildHintForComment(canonicalNutritionStatus, canonicalFindings)} Данные дня нереалистичны (вероятная ошибка ввода${suspectItemName ? ` продукта «${suspectItemName}»` : ""} — вес/порция). НЕ делай выводов/похвал/упрёков по числам этого дня; мягко попроси перепроверить ввод.`
        : buildHintForComment(canonicalNutritionStatus, canonicalFindings),
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
  // Weekly averages EXCLUDE broken-input days (rowLooksUnrealistic — a 17454-kcal item,
  // a >7000 day, impossible macros) so one mis-entered product never poisons the stored
  // avg_kcal that next week's week-over-week comparison reads. If every day is unrealistic,
  // fall back to all rows (don't divide by zero / hide a fully-broken week from the coach).
  const realisticRows = context.manualMacroRows.filter((row) => !rowLooksUnrealistic(row));
  const avgRows = realisticRows.length > 0 ? realisticRows : context.manualMacroRows;
  const averages = {
    kcal: avg(avgRows.map((row) => row.kcal)),
    proteinG: avg(avgRows.map((row) => row.proteinG)),
    fatG: avg(avgRows.map((row) => row.fatG)),
    carbsG: avg(avgRows.map((row) => row.carbsG)),
    proteinGPerKg:
      bodyweightKg && bodyweightKg > 0
        ? avg(avgRows.map((row) => (row.proteinG !== null ? Number((row.proteinG / bodyweightKg).toFixed(2)) : null)))
        : null,
    carbsGPerKg:
      bodyweightKg && bodyweightKg > 0
        ? avg(avgRows.map((row) => (row.carbsG !== null ? Number((row.carbsG / bodyweightKg).toFixed(2)) : null)))
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
