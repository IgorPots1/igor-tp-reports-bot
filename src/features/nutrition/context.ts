import {
  buildResolvedCommunicationProfilePromptLines,
  resolveStudentCommunicationProfile,
  type ResolvedStudentCommunicationProfile,
} from "@/features/trainingpeaks/communication-profile";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
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
  getNutritionStudentEssentials,
  getNutritionTrainingPeaksCacheWindow,
  type NutritionContextItem,
  type NutritionDailyMacro,
  type NutritionWeightLog,
} from "@/features/nutrition/repository";

const TP_CACHE_STALE_MS = 48 * 60 * 60 * 1000;

export type NormalizedManualMacroRow = {
  day: string;
  weekday: string | null;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  confidence: number;
  notes: string | null;
};

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
  athleteReportSignals: NutritionAthleteReportSignal[];
  manualMacroRows: NormalizedManualMacroRow[];
  dataQuality: NutritionDataQuality;
  reportStatus: "received" | "parsed" | "insufficient" | "needs_review" | "ready_for_analysis";
  tpPastWeek: NutritionTrainingPeaksWeekContext;
  tpNextWeek: NutritionTrainingPeaksWeekContext;
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

  const doNotSendReasons = hardFlags.map((flag) => `manual_review_required:${flag}`);
  return {
    hardFlags,
    softFlags,
    blocked: hardFlags.length > 0,
    doNotSendReasons,
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
  return /интерв|tempo|темпо|темпов|порог|threshold|vo2|спринт|hill/iu.test(title);
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

export async function buildNutritionTrainingPeaksWeekContext(
  studentId: string,
  weekFrom: string,
  weekTo: string,
  options?: { keyWorkoutMode?: NutritionKeyWorkoutMode; longRunMode?: "past_review" | "target_plan" }
): Promise<NutritionTrainingPeaksWeekContext> {
  const rows = await getNutritionTrainingPeaksCacheWindow({
    studentId,
    from: weekFrom,
    to: weekTo,
  });
  const cacheStatus = resolveCacheStatus(rows);
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

export async function buildNutritionStudentContext(input: {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  manualRows: NormalizedManualMacroRow[];
  athleteReportSignals?: NutritionAthleteReportSignal[];
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
  const [tpPastWeek, tpNextWeek] = await Promise.all([
    buildNutritionTrainingPeaksWeekContext(input.studentId, input.weekFrom, input.weekTo, {
      keyWorkoutMode: "completed_only",
    }),
    buildNutritionTrainingPeaksWeekContext(
      input.studentId,
      addDays(input.weekTo, 1),
      addDays(input.weekTo, 7),
      { keyWorkoutMode: "all" }
    ),
  ]);
  const latestConfirmedWeight =
    essentials.weightLogs.find((item) => item.confirmedByCoach)?.weightKg ?? null;
  const latestWeight = essentials.weightLogs[0]?.weightKg ?? null;

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
    athleteReportSignals: input.athleteReportSignals ?? [],
    manualMacroRows: input.manualRows,
    dataQuality,
    reportStatus,
    tpPastWeek,
    tpNextWeek,
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
      createdAt: new Date().toISOString(),
    }));
}
