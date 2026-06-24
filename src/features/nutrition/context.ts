import {
  buildResolvedCommunicationProfilePromptLines,
  resolveStudentCommunicationProfile,
  type ResolvedStudentCommunicationProfile,
} from "@/features/trainingpeaks/communication-profile";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import { getNutritionAdminLocalDate } from "@/features/nutrition/plan-week-policy";
import type {
  TrainingPeaksStudentMemoryItem,
  TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import {
  isNutritionLongRunWorkout,
  resolveNutritionLongRunConfidence,
  resolveNutritionLongRunSource,
  type NutritionLongRunSource,
} from "@/features/nutrition/long-run";
import type { NutritionAthleteReportSignal } from "@/features/nutrition/athlete-signals";
import {
  emptyNutritionStudentMemory,
  getNutritionStudentEssentials,
  getNutritionTrainingPeaksCacheWindow,
  listNutritionRaceEventsForStudentWindow,
  listRecentNutritionWeeklyAnalysesForStudent,
  type NutritionContextItem,
  type NutritionDailyMacro,
  type NutritionGoalType,
  type NutritionRaceEvent,
  type NutritionSex,
  type NutritionStudentMemory,
  type NutritionWeightLog,
} from "@/features/nutrition/repository";

const TP_CACHE_STALE_MS = 48 * 60 * 60 * 1000;

export type NutritionMealSection = "breakfast" | "lunch" | "dinner" | "snack";

export type NutritionFoodItemSource = "fatsecret_pdf_ru_detailed" | "manual" | "unknown";

export type NutritionFoodItem = {
  name: string;
  section: NutritionMealSection | null;
  kcal: number | null;
  fatG: number | null;
  carbsG: number | null;
  proteinG: number | null;
  source?: NutritionFoodItemSource;
};

export type NormalizedManualMacroRow = {
  day: string;
  weekday: string | null;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  confidence: number;
  notes: string | null;
  /**
   * Optional per-day product list parsed from detailed reports (FatSecret RU PDF).
   * Backward compatible: legacy rows and daily-total parsers leave this undefined.
   * Daily totals are never recomputed from items.
   */
  items?: NutritionFoodItem[];
};

const NUTRITION_MEAL_SECTIONS = new Set<NutritionMealSection>([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);

const NUTRITION_FOOD_ITEM_SOURCES = new Set<NutritionFoodItemSource>([
  "fatsecret_pdf_ru_detailed",
  "manual",
  "unknown",
]);

/**
 * Defensive shape validation for food items coming from DB / external JSON.
 * Drops anything that is not a plausible product row so the composer never
 * receives malformed entries.
 */
export function sanitizeNutritionFoodItems(value: unknown): NutritionFoodItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: NutritionFoodItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.replace(/\s+/g, " ").trim() : "";
    if (name.length < 2 || !/[a-zа-яё]/i.test(name)) {
      continue;
    }
    const section =
      typeof entry.section === "string" && NUTRITION_MEAL_SECTIONS.has(entry.section as NutritionMealSection)
        ? (entry.section as NutritionMealSection)
        : null;
    const toNum = (input: unknown): number | null =>
      typeof input === "number" && Number.isFinite(input) ? input : null;
    const source =
      typeof entry.source === "string" && NUTRITION_FOOD_ITEM_SOURCES.has(entry.source as NutritionFoodItemSource)
        ? (entry.source as NutritionFoodItemSource)
        : undefined;
    result.push({
      name: name.slice(0, 120),
      section,
      kcal: toNum(entry.kcal),
      fatG: toNum(entry.fatG ?? entry.fat_g),
      carbsG: toNum(entry.carbsG ?? entry.carbs_g),
      proteinG: toNum(entry.proteinG ?? entry.protein_g),
      ...(source ? { source } : {}),
    });
  }
  return result;
}

export type NutritionDataQuality = {
  parsedDays: number;
  lowConfidenceDays: number;
  hasResolvedDates: boolean;
  unrealisticRows: number;
  duplicateDays: string[];
  qualityFlags: string[];
};

export type NutritionSafetyFlags = {
  hardFlags: string[];
  softFlags: string[];
  blocked: boolean;
  doNotSendReasons: string[];
};

export type NutritionFatFeedbackPolicy = "normal" | "soften" | "coach_only" | "suppress_athlete";
export type NutritionCarbFeedbackPolicy = "normal" | "strong";
export type NutritionNarrativeDetailLevel = "compact" | "normal" | "detailed";
export type NutritionNarrativeFocusPriority =
  | "carbs"
  | "energy"
  | "protein"
  | "fat"
  | "timing"
  | "quality";

export type NutritionNarrativePreferences = {
  fatFeedbackPolicy?: NutritionFatFeedbackPolicy;
  carbFeedbackPolicy?: NutritionCarbFeedbackPolicy;
  detailLevel?: NutritionNarrativeDetailLevel;
  focusPriority?: NutritionNarrativeFocusPriority[];
};

const COACH_CONTEXT_FAT_SUPPRESS_PATTERNS = [
  /жиры не акцентировать/i,
  /не давить по жирам/i,
  /не делать жиры фокусом/i,
  /не фокусироваться на жирах/i,
] as const;

const NUTRITION_FAT_FEEDBACK_POLICIES = new Set<NutritionFatFeedbackPolicy>([
  "normal",
  "soften",
  "coach_only",
  "suppress_athlete",
]);

function asPreferencesObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeFatFeedbackPolicy(value: unknown): NutritionFatFeedbackPolicy | null {
  if (typeof value !== "string") {
    return null;
  }
  return NUTRITION_FAT_FEEDBACK_POLICIES.has(value as NutritionFatFeedbackPolicy)
    ? (value as NutritionFatFeedbackPolicy)
    : null;
}

export function getNutritionNarrativePreferences(input: {
  profilePreferences?: Record<string, unknown> | null;
  coachContextRu?: string | null;
}): Required<Pick<NutritionNarrativePreferences, "fatFeedbackPolicy" | "detailLevel">> &
  NutritionNarrativePreferences {
  const preferences = asPreferencesObject(input.profilePreferences);
  const narrative = asPreferencesObject(preferences.narrative);
  const nutritionNarrative = asPreferencesObject(preferences.nutritionNarrative);
  const narrativeSource = Object.keys(nutritionNarrative).length > 0 ? nutritionNarrative : narrative;
  let fatFeedbackPolicy =
    normalizeFatFeedbackPolicy(narrativeSource.fatFeedbackPolicy) ??
    normalizeFatFeedbackPolicy(preferences.fatFeedbackPolicy);

  if (!fatFeedbackPolicy && input.coachContextRu?.trim()) {
    if (COACH_CONTEXT_FAT_SUPPRESS_PATTERNS.some((pattern) => pattern.test(input.coachContextRu!))) {
      fatFeedbackPolicy = "suppress_athlete";
    }
  }

  const detailLevel =
    narrativeSource.detailLevel === "compact" || narrativeSource.detailLevel === "detailed"
      ? narrativeSource.detailLevel
      : preferences.detailLevel === "compact" || preferences.detailLevel === "detailed"
        ? preferences.detailLevel
        : "normal";

  const carbFeedbackPolicy =
    narrativeSource.carbFeedbackPolicy === "strong" || preferences.carbFeedbackPolicy === "strong"
      ? "strong"
      : "normal";

  const focusPriorityRaw = Array.isArray(narrativeSource.focusPriority)
    ? narrativeSource.focusPriority
    : Array.isArray(preferences.focusPriority)
      ? preferences.focusPriority
      : [];
  const allowedFocus = new Set<NutritionNarrativeFocusPriority>([
    "carbs",
    "energy",
    "protein",
    "fat",
    "timing",
    "quality",
  ]);
  const focusPriority = focusPriorityRaw.filter(
    (item): item is NutritionNarrativeFocusPriority =>
      typeof item === "string" && allowedFocus.has(item as NutritionNarrativeFocusPriority)
  );

  return {
    // Default is athlete-facing fat feedback; per-student opt-outs are applied
    // by applyNutritionFatPolicyOverrides and explicit profile/coach-context.
    fatFeedbackPolicy: fatFeedbackPolicy ?? "normal",
    detailLevel,
    carbFeedbackPolicy,
    ...(focusPriority.length > 0 ? { focusPriority } : {}),
  };
}

/**
 * Наряд 2: a student on her "own regime" (own_regime flag) keeps fat feedback
 * coach-only — replaces the former hardcoded surname check (/polyakova/). The
 * coach now controls this per student from the profile, not the code.
 */
export function applyNutritionFatPolicyOverrides<
  T extends { fatFeedbackPolicy?: NutritionFatFeedbackPolicy },
>(ownRegime: boolean | null | undefined, prefs: T): T {
  if (ownRegime) {
    return { ...prefs, fatFeedbackPolicy: "coach_only" };
  }
  return prefs;
}

export function shouldShowHighFatAthleteFeedback(policy: NutritionFatFeedbackPolicy): boolean {
  return policy === "normal";
}

export function isHighFatHiddenFromAthlete(policy: NutritionFatFeedbackPolicy): boolean {
  return policy === "coach_only" || policy === "suppress_athlete" || policy === "soften";
}

export function nutritionContextNarrativePreferences(
  context: Pick<NutritionStudentContext, "narrativePreferences" | "coachContextRu">
): Required<Pick<NutritionNarrativePreferences, "fatFeedbackPolicy" | "detailLevel">> &
  NutritionNarrativePreferences {
  return (
    context.narrativePreferences ??
    getNutritionNarrativePreferences({
      coachContextRu: context.coachContextRu,
    })
  );
}

export function resolveNutritionNarrativePreferencesFromStored(input: {
  nutritionSummary?: Record<string, unknown> | null;
  contextSnapshot?: Record<string, unknown> | null;
  coachContextRu?: string | null;
}): Required<Pick<NutritionNarrativePreferences, "fatFeedbackPolicy" | "detailLevel">> &
  NutritionNarrativePreferences {
  const summary = input.nutritionSummary ?? {};
  const snapshot = input.contextSnapshot ?? {};
  const fromSummary = asPreferencesObject(summary.narrative_preferences ?? summary.narrativePreferences);
  const fromSnapshot = asPreferencesObject(snapshot.narrative_preferences ?? snapshot.narrativePreferences);
  return getNutritionNarrativePreferences({
    profilePreferences: Object.keys(fromSummary).length > 0 ? fromSummary : fromSnapshot,
    coachContextRu: input.coachContextRu ?? (typeof summary.coach_context_ru === "string" ? summary.coach_context_ru : null),
  });
}

export type NutritionTrainingPeaksWeekContext = {
  periodFrom: string;
  periodTo: string;
  cacheStatus: "ok" | "empty" | "stale";
  cacheStatusNote: string;
  totalSessions: number;
  plannedSessions: number;
  completedSessions: number;
  runningSessions: number;
  longRun: {
    date: string;
    title: string;
    durationHours: number | null;
    distanceKm: number | null;
    source?: NutritionLongRunSource;
    confidence?: "high" | "medium" | "low";
  } | null;
  keyWorkouts: Array<{
    date: string;
    title: string;
    type: string;
    confidence: string;
  }>;
  workouts: Array<{
    date: string;
    title: string;
    status: "planned" | "completed" | "planned_and_completed" | "other";
    type: string;
    description: string | null;
    coachComments: string | null;
    plannedText: string | null;
    durationHours: number | null;
    distanceKm?: number | null;
  }>;
};

export type NutritionStudentContext = {
  studentName: string;
  studentSlug: string;
  studentUuid: string;
  resolvedCommunicationProfile: ResolvedStudentCommunicationProfile;
  communicationProfilePromptLines: string[];
  telegramContextNotes: string | null;
  coachMemoryItems: TrainingPeaksStudentMemoryItem[];
  nutritionContextItems: NutritionContextItem[];
  weightLogs: NutritionWeightLog[];
  currentWeightKg: number | null;
  nutritionGoal: string | null;
  coachContextRu: string | null;
  /** Наряд 2: student on her own eating regime — don't treat calories/fat as a problem (layer A). */
  ownRegime: boolean;
  /** Часть Ю: TP "Other" activities are dropped for this student (already filtered out of tpPastWeek/tpNextWeek). */
  excludeOtherActivities: boolean;
  /** Наряд 3: upcoming/just-past races (from the TP event scanner + manual marks) within the review+plan window. */
  raceEvents: NutritionRaceEvent[];
  /** Task 8: one-time coach note attached to THIS report (this week's review only). */
  coachReportNoteRu: string | null;
  /**
   * Block 3: the athlete's own words for THIS report (the "Комментарий ученика"
   * diary text). Verbatim context for TONE and circumstances (effort, fatigue,
   * what/when they ate) — never a source of numbers (those come only from PDF).
   * The illness/injury detector still runs over the same text separately
   * (athleteReportSignals) as the medical safety net.
   */
  athleteCommentRu: string | null;
  /** Tasks 7+8: compact per-student review memory (persistent notes, approved patterns, last focus, trends). */
  studentMemory: NutritionStudentMemory;
  /** Task 10: student nutrition goal — drives target/plan math (default maintain = current behavior). */
  nutritionGoalType: NutritionGoalType;
  /** Task 10: optional target weight for goal=lose (tone only; does not change deficit size). */
  targetWeightKg: number | null;
  /** Task 10++: optional anthropometrics for BMR (Mifflin) + FFM/EA. Null = estimate from weight/sex. */
  sex: NutritionSex | null;
  heightCm: number | null;
  ageYears: number | null;
  /**
   * Week-over-week: the most recent PRIOR week's average numbers (kcal/carbs/protein),
   * loaded from persisted weekly analyses. Null when there is no prior week. The
   * actual delta is computed by code (draft-generator), never by the model.
   */
  previousWeekNumbers: {
    weekFrom: string;
    avgKcal: number | null;
    avgCarbsG: number | null;
    avgProteinG: number | null;
  } | null;
  narrativePreferences?: Required<Pick<NutritionNarrativePreferences, "fatFeedbackPolicy" | "detailLevel">> &
    NutritionNarrativePreferences;
  athleteReportSignals: NutritionAthleteReportSignal[];
  manualMacroRows: NormalizedManualMacroRow[];
  dataQuality: NutritionDataQuality;
  reportStatus: "received" | "parsed" | "insufficient" | "needs_review" | "ready_for_analysis";
  tpPastWeek: NutritionTrainingPeaksWeekContext;
  tpNextWeek: NutritionTrainingPeaksWeekContext;
  /**
   * True when the past week had no TP workouts but the athlete has workouts in
   * nearby weeks — i.e. a genuine rest/maintenance week, not a missing-data gap.
   * Drives maintenance-mode review generation (Task 5b). Optional: absent === false.
   */
  noTrainingWeek?: boolean;
};

const WEEKDAY_RU_TO_INDEX: Record<string, number> = {
  пн: 0,
  вт: 1,
  ср: 2,
  чт: 3,
  пт: 4,
  сб: 5,
  вс: 6,
};

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDistanceKm(distanceRaw: number | null): number | null {
  if (distanceRaw === null) {
    return null;
  }
  // TrainingPeaks cache can provide meters; normalize obvious meter values to km.
  if (distanceRaw > 100) {
    return Number((distanceRaw / 1000).toFixed(2));
  }
  return distanceRaw;
}

function inferDistanceKmFromText(text: string | null): number | null {
  if (!text) {
    return null;
  }
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:км|km)\b/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function parseWeekdayKey(input: string): string | null {
  const normalized = input.toLocaleLowerCase("ru").replace(/[^a-zа-яё]/gi, "");
  if (!normalized) {
    return null;
  }
  const keys = Object.keys(WEEKDAY_RU_TO_INDEX);
  const exact = keys.find((key) => normalized === key);
  if (exact) {
    return exact;
  }
  const starts = keys.find((key) => normalized.startsWith(key));
  return starts ?? null;
}

function extractNumber(input: string, regex: RegExp): number | null {
  const match = input.match(regex);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveIsoDayFromWeekday(weekday: string | null, weekFrom: string): string | null {
  if (!weekday) {
    return null;
  }
  const offset = WEEKDAY_RU_TO_INDEX[weekday];
  if (!Number.isInteger(offset)) {
    return null;
  }
  return addDays(weekFrom, offset);
}

function buildLineNotes(input: {
  hadDate: boolean;
  missingAnyMacros: boolean;
  lowCoverage: boolean;
  duplicates: boolean;
}): string | null {
  const notes: string[] = [];
  if (!input.hadDate) {
    notes.push("day_unresolved");
  }
  if (input.missingAnyMacros) {
    notes.push("partial_macros");
  }
  if (input.lowCoverage) {
    notes.push("low_coverage");
  }
  if (input.duplicates) {
    notes.push("duplicate_day");
  }
  return notes.length > 0 ? notes.join(", ") : null;
}

export function normalizeManualMacroInput(input: string, weekFrom: string): NormalizedManualMacroRow[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: NormalizedManualMacroRow[] = [];
  const seenDays = new Set<string>();

  for (const line of lines) {
    const weekday = parseWeekdayKey(line.slice(0, 8));
    const day = resolveIsoDayFromWeekday(weekday, weekFrom);
    const kcal = extractNumber(line, /(\d{3,5})\s*к?к?а?л/i);
    const proteinG =
      extractNumber(line, /(?:б|белок)\s*[:=]?\s*(\d{2,3})/i) ??
      extractNumber(line, /protein\s*[:=]?\s*(\d{2,3})/i);
    const fatG =
      extractNumber(line, /(?:ж|жиры|fat)\s*[:=]?\s*(\d{2,3})/i) ??
      extractNumber(line, /f\s*[:=]?\s*(\d{2,3})/i);
    const carbsG =
      extractNumber(line, /(?:у|углеводы|carb[s]?)\s*[:=]?\s*(\d{2,4})/i) ??
      extractNumber(line, /c\s*[:=]?\s*(\d{2,4})/i);

    const macrosPresent = [kcal, proteinG, fatG, carbsG].filter((value) => value !== null).length;
    const unresolvedDay = day === null;
    const duplicate = day !== null && seenDays.has(day);
    if (day) {
      seenDays.add(day);
    }

    const confidence = Math.max(
      0.1,
      Math.min(
        1,
        1 -
          (unresolvedDay ? 0.35 : 0) -
          (macrosPresent < 2 ? 0.35 : 0) -
          (duplicate ? 0.2 : 0)
      )
    );

    rows.push({
      day: day ?? `unresolved:${rows.length + 1}`,
      weekday,
      kcal,
      proteinG,
      fatG,
      carbsG,
      confidence,
      notes: buildLineNotes({
        hadDate: !unresolvedDay,
        missingAnyMacros: macrosPresent < 4,
        lowCoverage: macrosPresent < 2,
        duplicates: duplicate,
      }),
    });
  }

  return rows;
}

function rowLooksUnrealistic(row: NormalizedManualMacroRow): boolean {
  if (row.kcal !== null && (row.kcal < 900 || row.kcal > 7000)) {
    return true;
  }
  if (row.proteinG !== null && (row.proteinG < 20 || row.proteinG > 350)) {
    return true;
  }
  if (row.fatG !== null && (row.fatG < 10 || row.fatG > 250)) {
    return true;
  }
  if (row.carbsG !== null && (row.carbsG < 20 || row.carbsG > 900)) {
    return true;
  }
  return false;
}

export function calculateNutritionDataQuality(rows: NormalizedManualMacroRow[]): NutritionDataQuality {
  const unresolved = rows.filter((row) => row.day.startsWith("unresolved:"));
  const lowConfidence = rows.filter((row) => row.confidence < 0.6);
  const unrealistic = rows.filter((row) => rowLooksUnrealistic(row));
  const duplicateDays = rows
    .map((row) => row.day)
    .filter((day, index, all) => !day.startsWith("unresolved:") && all.indexOf(day) !== index);
  const qualityFlags: string[] = [];

  if (rows.length < 3) {
    qualityFlags.push("fewer_than_three_days");
  }
  if (unresolved.length > 0) {
    qualityFlags.push("unresolved_days_present");
  }
  if (unrealistic.length > 0) {
    qualityFlags.push("unrealistic_values");
  }
  if (duplicateDays.length > 0) {
    qualityFlags.push("duplicate_days");
  }
  if (rows.filter((row) => row.kcal !== null || row.proteinG !== null || row.fatG !== null || row.carbsG !== null).length < 3) {
    qualityFlags.push("insufficient_macro_coverage");
  }

  return {
    parsedDays: rows.length,
    lowConfidenceDays: lowConfidence.length,
    hasResolvedDates: unresolved.length === 0,
    unrealisticRows: unrealistic.length,
    duplicateDays: [...new Set(duplicateDays)],
    qualityFlags,
  };
}

export function classifyNutritionReportStatus(dataQuality: NutritionDataQuality): "parsed" | "insufficient" | "needs_review" | "ready_for_analysis" {
  if (
    dataQuality.parsedDays < 3 ||
    !dataQuality.hasResolvedDates ||
    dataQuality.unrealisticRows > 0
  ) {
    return "insufficient";
  }
  if (dataQuality.lowConfidenceDays > 0 || dataQuality.duplicateDays.length > 0) {
    return "needs_review";
  }
  if (dataQuality.qualityFlags.length > 0) {
    return "parsed";
  }
  return "ready_for_analysis";
}

function collectSafetyText(input: {
  studentNotes: string[];
  nutritionContextItems: NutritionContextItem[];
  rows: NormalizedManualMacroRow[];
}): string {
  const contextTexts = input.nutritionContextItems.map((item) => item.text);
  const notes = input.studentNotes;
  const macroSummary = input.rows
    .map((row) => `${row.day}:${row.kcal ?? "-"}:${row.carbsG ?? "-"}:${row.proteinG ?? "-"}:${row.fatG ?? "-"}`)
    .join(" ");
  return `${contextTexts.join(" ")} ${notes.join(" ")} ${macroSummary}`.toLocaleLowerCase("ru");
}

export function buildNutritionSafetyFlags(input: {
  studentName: string;
  studentNotes: string[];
  nutritionContextItems: NutritionContextItem[];
  rows: NormalizedManualMacroRow[];
  weightLogs: NutritionWeightLog[];
}): NutritionSafetyFlags {
  const haystack = collectSafetyText(input);
  const hardFlags: string[] = [];
  const softFlags: string[] = [];

  const has = (re: RegExp): boolean => re.test(haystack);
  if (has(/\b(рпп|анорекси|булими|eating disorder|ed)\b/i)) {
    hardFlags.push("ed_or_disordered_eating_signal");
  }
  if (has(/\b(компенсац|наказа(ть|ние) себя|отработать еду)\b/i)) {
    hardFlags.push("food_compensation_or_self_punishment_signal");
  }
  if (has(/\b(диабет|pregnan|беремен|послеродов|postpartum|аменоре|менстру)\b/i)) {
    hardFlags.push("medical_condition_requires_manual_review");
  }
  if (has(/\b(стресс.?перелом|fracture|repeat(ed)? injur|повторн(ая|ые) травм)\b/i)) {
    hardFlags.push("injury_or_stress_fracture_with_energy_risk");
  }
  if (has(/\b(кето|keto|интервальн(ое|ый) голод|if\b|fasting)\b/i)) {
    softFlags.push("restrictive_protocol_with_running_load");
  }

  const veryLowKcalDays = input.rows.filter((row) => (row.kcal ?? 9999) < 1300);
  if (veryLowKcalDays.length >= 2) {
    hardFlags.push("very_low_kcal_repeated");
  }
  const veryLowCarbDays = input.rows.filter((row) => (row.carbsG ?? 9999) < 90);
  if (veryLowCarbDays.length >= 3) {
    hardFlags.push("very_low_carb_repeated");
  }
  if (input.weightLogs.length >= 2) {
    const sorted = [...input.weightLogs].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    const first = sorted[0]?.weightKg ?? null;
    const last = sorted[sorted.length - 1]?.weightKg ?? null;
    if (first !== null && last !== null && first > 0 && ((first - last) / first) >= 0.04) {
      hardFlags.push("rapid_weight_loss_signal");
    }
  }

  // Coach decision (Igor): these signals no longer HARD-BLOCK the report. CRITICAL:
  // hardFlags must stay EMPTY here — multiple downstream consumers (combined-message
  // extractReviewDoNotSendReasons/extractPlanDoNotSendReasons, weekly-plan-generator,
  // coach-summary, the student-page UI) reconstruct a do-not-send block from
  // safety.hard_flags. Setting blocked=false / doNotSendReasons=[] is NOT enough —
  // any populated hard_flags re-blocks. So the detected signals are exposed as
  // ADVISORY soft flags (coach still sees them; nothing blocks). The very-low-kcal
  // note reaches the athlete via the dedicated very_low_kcal_days prompt rule.
  return {
    hardFlags: [],
    softFlags: [...softFlags, ...hardFlags],
    blocked: false,
    doNotSendReasons: [],
  };
}

function resolveCacheStatus(rows: TrainingPeaksWorkoutCacheRow[]): {
  kind: "ok" | "empty" | "stale";
  note: string;
} {
  if (rows.length === 0) {
    return {
      kind: "empty",
      note: "TrainingPeaks workout cache is empty for selected window.",
    };
  }
  const latestScannedAt = rows.reduce<string | null>((latest, row) => {
    if (!row.scannedAt) {
      return latest;
    }
    if (!latest || row.scannedAt > latest) {
      return row.scannedAt;
    }
    return latest;
  }, null);
  if (!latestScannedAt) {
    return {
      kind: "stale",
      note: "TrainingPeaks workout cache has no scanned_at markers.",
    };
  }
  const scannedAtMs = Date.parse(latestScannedAt);
  if (!Number.isFinite(scannedAtMs) || Date.now() - scannedAtMs > TP_CACHE_STALE_MS) {
    return {
      kind: "stale",
      note: `TrainingPeaks workout cache is stale (last scanned ${latestScannedAt}).`,
    };
  }
  return {
    kind: "ok",
    note: `TrainingPeaks cache freshness is OK (last scanned ${latestScannedAt}).`,
  };
}

function resolveWorkoutStatus(row: TrainingPeaksWorkoutCacheRow): "planned" | "completed" | "planned_and_completed" | "other" {
  if (row.isPlanned && row.isCompleted) {
    return "planned_and_completed";
  }
  if (row.isCompleted) {
    return "completed";
  }
  if (row.isPlanned) {
    return "planned";
  }
  return "other";
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function snapshotText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || null;
}

type NutritionKeyWorkoutMode = "all" | "completed_only";

function isQualityWorkoutTitle(title: string): boolean {
  if (/\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\s*(?:мин|min|m)?\b/iu.test(title)) {
    return true;
  }
  return /интерв|tempo|темпо|темпов|порог|threshold|vo2|спринт|hill|hiit|хиит/iu.test(title);
}

function isKeyWorkout(row: TrainingPeaksWorkoutCacheRow, mode: NutritionKeyWorkoutMode): boolean {
  if (mode === "completed_only" && !row.isCompleted) {
    return false;
  }
  const title = (row.title ?? "").toLocaleLowerCase("ru");
  if (isQualityWorkoutTitle(title)) {
    return true;
  }
  const classification = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
  });
  return classification.isRunning && /quality|race|interval/.test(classification.reason.toLocaleLowerCase("ru"));
}

/**
 * Часть Ю: is this TP workout an "Other"/"Custom" activity to drop for a student
 * with exclude_other_activities? Keys on the RAW TP type code first (sportOrTypeCode
 * other/custom) so a strength-TITLED session that is TP-typed "Other" is still
 * caught — the activity classifier would otherwise let the title win and call it
 * "strength". Falls back to the classifier's "other" family for neutral titles.
 */
export function isNutritionExcludedOtherActivity(input: {
  title: string | null;
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
}): boolean {
  // Existing signal #1: raw sport/type-code string says other/custom.
  if (/(?:^|[^\p{L}])(?:other|custom)(?:[^\p{L}]|$)/iu.test(input.sportOrTypeCode ?? "")) {
    return true;
  }
  // Signal #2 (anchor): TP's "Other" activity arrives as workoutTypeValueId=100
  // with title "Other" and a null sportOrTypeCode — the classifier returns
  // "unknown" (it maps only 3→run, 9→strength), so signals #1 and #4 miss it.
  // The type id is the reliable anchor for TP-"Other".
  if (input.workoutTypeValueId === 100) {
    return true;
  }
  // Signal #3 (extra): a raw TP title of exactly "Other" — but only when the
  // session has no real activity type id (3=run, 9=strength). Someone may title a
  // genuine run/strength "Other"; that real type wins and the session stays.
  // Exact match (not substring) so "Brotherhood" never trips it.
  if (
    (input.title ?? "").trim().toLowerCase() === "other" &&
    input.workoutTypeValueId !== 3 &&
    input.workoutTypeValueId !== 9
  ) {
    return true;
  }
  // Existing signal #4: the activity classifier resolves the family to "other".
  return classifyTrainingPeaksWorkoutActivity(input).family === "other";
}

export async function buildNutritionTrainingPeaksWeekContext(
  studentId: string,
  weekFrom: string,
  weekTo: string,
  options?: {
    keyWorkoutMode?: NutritionKeyWorkoutMode;
    longRunMode?: "past_review" | "target_plan";
    /** Часть Ю: drop TP activities classified "Other" before anything else sees
     * them, so they affect neither expenditure nor the review text. A day left with
     * no other session then reads as a normal rest day. Per-student (profile flag). */
    excludeOtherActivities?: boolean;
    /** Поток D: for the PLAN week take only SCHEDULED workouts (is_planned). Without
     * this an already-completed actual that falls in the early (already-elapsed) days
     * of the plan window (e.g. a Monday walk done before the plan was generated) leaks
     * into the plan as if it were prescribed. The review week leaves this off so the
     * completed actuals (the real past-week facts) are kept. */
    plannedOnly?: boolean;
  }
): Promise<NutritionTrainingPeaksWeekContext> {
  const allRows = await getNutritionTrainingPeaksCacheWindow({
    studentId,
    from: weekFrom,
    to: weekTo,
  });
  const plannedRows = options?.plannedOnly ? allRows.filter((row) => row.isPlanned) : allRows;
  const rows = options?.excludeOtherActivities
    ? plannedRows.filter(
        (row) =>
          !isNutritionExcludedOtherActivity({
            title: row.title,
            sportOrTypeCode: row.sportOrTypeCode,
            workoutTypeValueId: row.workoutTypeValueId,
            workoutSubTypeId: row.workoutSubTypeId,
          })
      )
    : plannedRows;
  const rawCacheStatus = resolveCacheStatus(rows);
  // A week fully in the past won't change anymore, so an "old scan" is expected
  // and shouldn't be treated as stale/unusable (which would wrongly force the
  // review into limited-data mode). Only flag staleness for the current/future
  // window where we actually expect fresh syncs.
  const cacheStatus =
    rawCacheStatus.kind === "stale" && rows.length > 0 && weekTo < getNutritionAdminLocalDate()
      ? { kind: "ok" as const, note: `Прошедшая неделя: кэш финальный. ${rawCacheStatus.note}` }
      : rawCacheStatus;
  const totalSessions = rows.length;
  const plannedSessions = rows.filter((row) => row.isPlanned).length;
  const completedSessions = rows.filter((row) => row.isCompleted).length;
  const runningSessions = rows.filter((row) =>
    classifyTrainingPeaksWorkoutActivity({
      title: row.title,
      sportOrTypeCode: row.sportOrTypeCode,
      workoutTypeValueId: row.workoutTypeValueId,
      workoutSubTypeId: row.workoutSubTypeId,
    }).isRunning
  ).length;

  let longRunCandidate: NutritionTrainingPeaksWeekContext["longRun"] = null;
  const keyWorkouts: NutritionTrainingPeaksWeekContext["keyWorkouts"] = [];

  const keyWorkoutMode: NutritionKeyWorkoutMode = options?.keyWorkoutMode ?? "all";
  const longRunMode = options?.longRunMode ?? (keyWorkoutMode === "completed_only" ? "past_review" : "target_plan");

  for (const row of rows) {
    const classification = classifyTrainingPeaksWorkoutActivity({
      title: row.title,
      sportOrTypeCode: row.sportOrTypeCode,
      workoutTypeValueId: row.workoutTypeValueId,
      workoutSubTypeId: row.workoutSubTypeId,
    });
    const durationHours = toFiniteNumber(row.completedTimeRaw ?? row.plannedTimeRaw);
    const distanceKm = normalizeDistanceKm(toFiniteNumber(row.completedDistanceRaw ?? row.plannedDistanceRaw));
    const qualifiesAsLongRun = isNutritionLongRunWorkout({
      title: row.title,
      durationHours,
      isCompleted: row.isCompleted,
      mode: longRunMode,
    });
    if (qualifiesAsLongRun && !longRunCandidate) {
      const source = resolveNutritionLongRunSource({ title: row.title, durationHours });
      longRunCandidate = {
        date: row.workoutDate,
        title: row.title?.trim() || "Untitled workout",
        durationHours,
        distanceKm,
        source,
        confidence: resolveNutritionLongRunConfidence(source),
      };
    }
    if (isKeyWorkout(row, keyWorkoutMode)) {
      keyWorkouts.push({
        date: row.workoutDate,
        title: row.title?.trim() || "Untitled workout",
        type: classification.family,
        confidence: classification.confidence,
      });
    }
  }

  return {
    periodFrom: weekFrom,
    periodTo: weekTo,
    cacheStatus: cacheStatus.kind,
    cacheStatusNote: cacheStatus.note,
    totalSessions,
    plannedSessions,
    completedSessions,
    runningSessions,
    longRun: longRunCandidate,
    keyWorkouts: keyWorkouts.slice(0, 6),
    workouts: rows.slice(0, 16).map((row) => {
      const c = classifyTrainingPeaksWorkoutActivity({
        title: row.title,
        sportOrTypeCode: row.sportOrTypeCode,
        workoutTypeValueId: row.workoutTypeValueId,
        workoutSubTypeId: row.workoutSubTypeId,
      });
      const sourceSnapshot = toObjectRecord(row.sourceSnapshot);
      return {
        date: row.workoutDate,
        title: row.title?.trim() || "Untitled workout",
        status: resolveWorkoutStatus(row),
        type: c.family,
        description: snapshotText(sourceSnapshot?.description),
        coachComments: snapshotText(sourceSnapshot?.coachComments),
        plannedText: snapshotText(sourceSnapshot?.structure) ?? snapshotText(sourceSnapshot?.plannedText),
        durationHours: toFiniteNumber(row.completedTimeRaw ?? row.plannedTimeRaw),
        distanceKm:
          normalizeDistanceKm(toFiniteNumber(row.completedDistanceRaw ?? row.plannedDistanceRaw)) ??
          inferDistanceKmFromText(snapshotText(sourceSnapshot?.description) ?? row.title ?? null),
      };
    }),
  };
}

/**
 * Наряд 3: inject each race that falls inside this week's window as a race-day
 * "workout" so the existing day-classification pipeline reads it as race (not
 * rest). Skips a date that already carries a race workout. Mutates the week.
 */
function injectRaceEventsIntoWeekContext(
  week: NutritionTrainingPeaksWeekContext,
  raceEvents: NutritionRaceEvent[]
): void {
  for (const event of raceEvents) {
    if (event.eventDate < week.periodFrom || event.eventDate > week.periodTo) {
      continue;
    }
    const alreadyRace = week.workouts.some(
      (workout) => workout.date === event.eventDate && workout.type === "race"
    );
    if (alreadyRace) {
      continue;
    }
    week.workouts.push({
      date: event.eventDate,
      title: event.title?.trim() || "Старт",
      status: "completed",
      type: "race",
      description: null,
      coachComments: null,
      plannedText: null,
      durationHours: null,
      distanceKm: event.distanceKm ?? null,
    });
  }
}

export async function buildNutritionStudentContext(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  manualRows: NormalizedManualMacroRow[];
  athleteReportSignals?: NutritionAthleteReportSignal[];
  /** Task 8: one-time coach note from THIS report's upload. */
  coachReportNoteRu?: string | null;
  /** Block 3: the athlete's own words for THIS report (diary comment, verbatim). */
  athleteCommentRu?: string | null;
}): Promise<NutritionStudentContext> {
  const essentials = await getNutritionStudentEssentials(input.studentId);
  const student = essentials.student;
  if (!student) {
    throw new Error(`Nutrition context student not found: ${input.studentId}`);
  }

  const resolvedCommunicationProfile = resolveStudentCommunicationProfile({
    telegramFormality: student.telegramFormality,
    telegramContextNotes: student.telegramContextNotes,
    activeMemoryItems: essentials.activeMemoryItems,
  });
  const dataQuality = calculateNutritionDataQuality(input.manualRows);
  const reportStatus = classifyNutritionReportStatus(dataQuality);
  const excludeOtherActivities = essentials.profile?.excludeOtherActivities ?? false;
  const [tpPastWeek, tpNextWeek] = await Promise.all([
    buildNutritionTrainingPeaksWeekContext(input.studentId, input.weekFrom, input.weekTo, {
      keyWorkoutMode: "completed_only",
      excludeOtherActivities,
    }),
    buildNutritionTrainingPeaksWeekContext(
      input.studentId,
      addDays(input.weekTo, 1),
      addDays(input.weekTo, 7),
      { keyWorkoutMode: "all", excludeOtherActivities, plannedOnly: true }
    ),
  ]);
  // Наряд 3: pull races (TP scanner + coach manual marks) across the review and
  // plan window, then inject each race date as a race-day so nutrition stops
  // reading a race as a plain "rest" day. Distance rides along for the loading
  // protocol (Step 2). Manual marks already override scan in the repository read.
  const raceEvents = await listNutritionRaceEventsForStudentWindow({
    studentId: input.studentId,
    from: input.weekFrom,
    to: addDays(input.weekTo, 7),
  });
  injectRaceEventsIntoWeekContext(tpPastWeek, raceEvents);
  injectRaceEventsIntoWeekContext(tpNextWeek, raceEvents);

  const latestConfirmedWeight =
    essentials.weightLogs.find((item) => item.confirmedByCoach)?.weightKg ?? null;
  const latestWeight = essentials.weightLogs[0]?.weightKg ?? null;

  // No-training-week detection (Task 5b). An empty past week is ambiguous: it can
  // be a genuine rest week OR a missing TP sync (both leave the cache empty). If
  // the athlete has TP workouts in nearby weeks (±4 weeks) but none this week, it
  // was a real rest week — treat it as maintenance. If there are no workouts
  // anywhere nearby, it's a data gap — leave it to needs_review (don't invent).
  let noTrainingWeek = false;
  if (tpPastWeek.workouts.length === 0) {
    const neighborRows = await getNutritionTrainingPeaksCacheWindow({
      studentId: input.studentId,
      from: addDays(input.weekFrom, -28),
      to: addDays(input.weekTo, 28),
    });
    noTrainingWeek = neighborRows.length > 0;
  }

  // Week-over-week: load the most recent PRIOR week's persisted averages so the
  // generator can praise REAL progress (delta is computed by code, not the model).
  const priorAnalyses = await listRecentNutritionWeeklyAnalysesForStudent(input.studentId, {
    excludeWeekFrom: input.weekFrom,
    limit: 1,
  }).catch(() => [] as Awaited<ReturnType<typeof listRecentNutritionWeeklyAnalysesForStudent>>);
  const prior = priorAnalyses.find((a) => a.weekFrom < input.weekFrom) ?? null;
  let previousWeekNumbers: NutritionStudentContext["previousWeekNumbers"] = null;
  if (prior) {
    const summary: Record<string, unknown> =
      prior.nutritionSummary && typeof prior.nutritionSummary === "object"
        ? (prior.nutritionSummary as Record<string, unknown>)
        : {};
    previousWeekNumbers = {
      weekFrom: prior.weekFrom,
      avgKcal: toFiniteNumber(summary["avg_kcal"] as number | string | null | undefined),
      avgCarbsG: toFiniteNumber(summary["avg_carbs_g"] as number | string | null | undefined),
      avgProteinG: toFiniteNumber(summary["avg_protein_g"] as number | string | null | undefined),
    };
  }

  return {
    studentName: student.studentName,
    studentSlug: student.studentId,
    studentUuid: student.id,
    resolvedCommunicationProfile,
    communicationProfilePromptLines: buildResolvedCommunicationProfilePromptLines(resolvedCommunicationProfile),
    telegramContextNotes: compactText(student.telegramContextNotes),
    coachMemoryItems: essentials.activeMemoryItems.filter((item) =>
      [
        "communication_style",
        "schedule_constraint",
        "availability_preference",
        "planning_preference",
        "travel_or_life_event",
        "health_status",
        "pain_or_injury",
        "load_tolerance",
        "race_or_goal",
      ].includes(item.memoryType)
    ),
    nutritionContextItems: essentials.contextItems,
    weightLogs: essentials.weightLogs,
    currentWeightKg: essentials.profile?.currentWeightKg ?? latestConfirmedWeight ?? latestWeight ?? null,
    nutritionGoal: essentials.profile?.goal ?? null,
    coachContextRu: essentials.profile?.coachContextRu ?? null,
    ownRegime: essentials.profile?.ownRegime ?? false,
    excludeOtherActivities,
    raceEvents,
    coachReportNoteRu: compactText(input.coachReportNoteRu) ?? null,
    athleteCommentRu: compactText(input.athleteCommentRu) ?? null,
    studentMemory: essentials.profile?.nutritionMemory ?? emptyNutritionStudentMemory(),
    nutritionGoalType: essentials.profile?.nutritionGoalType ?? "maintain",
    targetWeightKg: essentials.profile?.targetWeightKg ?? null,
    sex: essentials.profile?.sex ?? null,
    heightCm: essentials.profile?.heightCm ?? null,
    ageYears: essentials.profile?.ageYears ?? null,
    previousWeekNumbers,
    narrativePreferences: applyNutritionFatPolicyOverrides(
      essentials.profile?.ownRegime ?? false,
      getNutritionNarrativePreferences({
        profilePreferences: essentials.profile?.preferences ?? null,
        coachContextRu: essentials.profile?.coachContextRu ?? null,
      })
    ),
    athleteReportSignals: input.athleteReportSignals ?? [],
    manualMacroRows: input.manualRows,
    dataQuality,
    reportStatus,
    tpPastWeek,
    tpNextWeek,
    noTrainingWeek,
  };
}

export function summarizeNutritionRows(rows: NormalizedManualMacroRow[]): NutritionDailyMacro[] {
  return rows
    .filter((row) => !row.day.startsWith("unresolved:"))
    .map((row) => ({
      id: `parsed-${row.day}`,
      reportId: null,
      studentId: "",
      day: row.day,
      kcal: row.kcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbsG: row.carbsG,
      confidence: row.confidence,
      source: "manual_text",
      notes: row.notes,
      items: row.items ?? [],
      createdAt: new Date().toISOString(),
    }));
}
