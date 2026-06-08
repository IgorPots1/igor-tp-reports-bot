import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import { TRAININGPEAKS_TIME_ZONE } from "@/features/trainingpeaks/week";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPLICIT_DATE_PATTERN = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/u;
const RUN_HINT_PATTERN =
  /\b(run|running|jog|tempo|interval|long run|бег|пробеж|интервал|темп|длит|пано|отрез)\b/iu;
const NON_RUN_HINT_PATTERN =
  /\b(bike|cycling|swim|strength|gym|walk|hike|вело|плав|силов|ходьб|зал)\b/iu;

export type GroupWorkoutReportReferenceDate = {
  referenceDate: string;
  policy:
    | "message_date"
    | "text_yesterday"
    | "text_day_before_yesterday"
    | "text_explicit_date"
    | "unknown_fallback_message_date";
  warnings: string[];
};

export type GroupWorkoutReportWorkoutMatchStatus = "matched" | "ambiguous" | "not_found";

export type GroupWorkoutReportWorkoutMatchConfidence = "high" | "medium" | "low";

export type GroupWorkoutReportWorkoutMatchResult = {
  status: GroupWorkoutReportWorkoutMatchStatus;
  confidence: GroupWorkoutReportWorkoutMatchConfidence;
  referenceDate: string;
  referenceDatePolicy: GroupWorkoutReportReferenceDate["policy"];
  selectedPlannedWorkoutId: string | null;
  selectedCompletedWorkoutId: string | null;
  candidateWorkoutIds: string[];
  reasons: string[];
  warnings: string[];
};

function formatDateInBelgrade(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRAININGPEAKS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  if (!year || !month || !day) {
    throw new Error("Failed to format Belgrade date.");
  }
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(isoDate: string, days: number): string {
  const utc = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(utc)) {
    return isoDate;
  }
  return new Date(utc + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function normalizeYear(raw: string | undefined, fallbackYear: number): number {
  if (!raw) {
    return fallbackYear;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) {
    return fallbackYear;
  }
  if (value < 100) {
    return 2000 + value;
  }
  return value;
}

function resolveExplicitDate(input: {
  text: string;
  messageDateIso: string;
}): { date: string | null; warning: string | null } {
  const match = input.text.match(EXPLICIT_DATE_PATTERN);
  if (!match) {
    return { date: null, warning: null };
  }
  const first = Number.parseInt(match[1] ?? "", 10);
  const second = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isInteger(first) || !Number.isInteger(second)) {
    return { date: null, warning: "explicit_date_parse_failed" };
  }

  if (first <= 12 && second <= 12) {
    return { date: null, warning: "explicit_date_ambiguous_day_month" };
  }

  const fallbackYear = Number.parseInt(input.messageDateIso.slice(0, 4), 10);
  const year = normalizeYear(match[3], fallbackYear);
  const day = first > 12 ? first : second;
  const month = first > 12 ? second : first;
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return { date: null, warning: "explicit_date_out_of_range" };
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { date: null, warning: "explicit_date_invalid_calendar_date" };
  }
  return { date: parsed.toISOString().slice(0, 10), warning: null };
}

export function extractGroupWorkoutReportReferenceDate(input: {
  messageText: string;
  messageDateUnixSeconds: number;
}): GroupWorkoutReportReferenceDate {
  const messageDateIso = formatDateInBelgrade(new Date(input.messageDateUnixSeconds * 1000));
  const text = input.messageText.toLocaleLowerCase("ru");
  const warnings: string[] = [];

  if (text.includes("позавчера") || text.includes("day before yesterday")) {
    return {
      referenceDate: shiftIsoDate(messageDateIso, -2),
      policy: "text_day_before_yesterday",
      warnings,
    };
  }

  if (text.includes("вчера") || text.includes("yesterday")) {
    return {
      referenceDate: shiftIsoDate(messageDateIso, -1),
      policy: "text_yesterday",
      warnings,
    };
  }

  const explicit = resolveExplicitDate({ text, messageDateIso });
  if (explicit.date) {
    return {
      referenceDate: explicit.date,
      policy: "text_explicit_date",
      warnings,
    };
  }

  if (explicit.warning) {
    warnings.push(explicit.warning);
    return {
      referenceDate: messageDateIso,
      policy: "unknown_fallback_message_date",
      warnings,
    };
  }

  return {
    referenceDate: messageDateIso,
    policy: "message_date",
    warnings,
  };
}

function parseWorkoutId(row: TrainingPeaksWorkoutCacheRow): string {
  return String(row.trainingPeaksWorkoutId);
}

function sortByDateAndOrder(rows: TrainingPeaksWorkoutCacheRow[]): TrainingPeaksWorkoutCacheRow[] {
  return [...rows].sort((left, right) => {
    if (left.workoutDate !== right.workoutDate) {
      return left.workoutDate.localeCompare(right.workoutDate);
    }
    const leftOrder = Number(left.orderOnDay ?? 0);
    const rightOrder = Number(right.orderOnDay ?? 0);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.trainingPeaksWorkoutId - right.trainingPeaksWorkoutId;
  });
}

function reportLikelyRun(messageText: string): boolean {
  const hasRunHint = RUN_HINT_PATTERN.test(messageText);
  const hasNonRunHint = NON_RUN_HINT_PATTERN.test(messageText);
  if (hasRunHint) {
    return true;
  }
  return !hasNonRunHint;
}

function isCompatiblePlannedWorkout(
  row: TrainingPeaksWorkoutCacheRow,
  referenceDate: string,
  likelyRun: boolean
): boolean {
  if (!row.isPlanned || row.workoutDate !== referenceDate) {
    return false;
  }
  if (!likelyRun) {
    return true;
  }
  const activity = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    sourceSnapshot: row.sourceSnapshot,
  });
  return activity.isRunning;
}

function isPlausibleCompletedWorkout(row: TrainingPeaksWorkoutCacheRow, likelyRun: boolean): boolean {
  if (!row.isCompleted) {
    return false;
  }
  if (!likelyRun) {
    return true;
  }
  const activity = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    sourceSnapshot: row.sourceSnapshot,
  });
  return activity.isRunning;
}

function buildResult(input: {
  status: GroupWorkoutReportWorkoutMatchStatus;
  confidence: GroupWorkoutReportWorkoutMatchConfidence;
  reference: GroupWorkoutReportReferenceDate;
  selectedPlannedWorkoutId?: string | null;
  selectedCompletedWorkoutId?: string | null;
  candidateWorkoutIds?: string[];
  reasons: string[];
  warnings?: string[];
}): GroupWorkoutReportWorkoutMatchResult {
  return {
    status: input.status,
    confidence: input.confidence,
    referenceDate: input.reference.referenceDate,
    referenceDatePolicy: input.reference.policy,
    selectedPlannedWorkoutId: input.selectedPlannedWorkoutId ?? null,
    selectedCompletedWorkoutId: input.selectedCompletedWorkoutId ?? null,
    candidateWorkoutIds: input.candidateWorkoutIds ?? [],
    reasons: input.reasons,
    warnings: input.warnings ?? [],
  };
}

export function matchGroupWorkoutReportWorkoutFromCache(input: {
  messageText: string;
  messageDateUnixSeconds: number;
  workouts: TrainingPeaksWorkoutCacheRow[];
}): GroupWorkoutReportWorkoutMatchResult {
  const reference = extractGroupWorkoutReportReferenceDate({
    messageText: input.messageText,
    messageDateUnixSeconds: input.messageDateUnixSeconds,
  });
  const likelyRun = reportLikelyRun(input.messageText);
  const warnings = [...reference.warnings];
  const reasons: string[] = [];
  const windowFrom = shiftIsoDate(reference.referenceDate, -1);
  const windowTo = shiftIsoDate(reference.referenceDate, 1);

  const inWindow = sortByDateAndOrder(
    input.workouts.filter((row) => row.workoutDate >= windowFrom && row.workoutDate <= windowTo)
  );
  const completedPlausible = inWindow.filter((row) => isPlausibleCompletedWorkout(row, likelyRun));
  const completedOnReferenceDate = completedPlausible.filter(
    (row) => row.workoutDate === reference.referenceDate
  );
  const plannedOnReferenceDate = inWindow.filter((row) =>
    isCompatiblePlannedWorkout(row, reference.referenceDate, likelyRun)
  );

  if (completedOnReferenceDate.length >= 2) {
    reasons.push("multiple_plausible_completed_on_reference_date");
    return buildResult({
      status: "ambiguous",
      confidence: "medium",
      reference,
      candidateWorkoutIds: completedOnReferenceDate.map(parseWorkoutId),
      reasons,
      warnings,
    });
  }

  if (completedOnReferenceDate.length === 1) {
    const selectedCompleted = completedOnReferenceDate[0]!;
    const selectedPlanned = plannedOnReferenceDate[0] ?? null;
    reasons.push("single_completed_on_reference_date");
    if (selectedPlanned) {
      reasons.push("planned_aligned_same_date");
    }
    return buildResult({
      status: "matched",
      confidence: "high",
      reference,
      selectedCompletedWorkoutId: parseWorkoutId(selectedCompleted),
      selectedPlannedWorkoutId: selectedPlanned ? parseWorkoutId(selectedPlanned) : null,
      candidateWorkoutIds: [parseWorkoutId(selectedCompleted)],
      reasons,
      warnings,
    });
  }

  const nearCompleted = completedPlausible.filter((row) => row.workoutDate !== reference.referenceDate);
  if (nearCompleted.length >= 2) {
    reasons.push("multiple_plausible_completed_nearby");
    warnings.push("nearby_completed_workouts_ambiguous");
    return buildResult({
      status: "ambiguous",
      confidence: "medium",
      reference,
      candidateWorkoutIds: nearCompleted.map(parseWorkoutId),
      reasons,
      warnings,
    });
  }

  if (nearCompleted.length === 1) {
    const selectedCompleted = nearCompleted[0]!;
    const selectedPlanned = plannedOnReferenceDate[0] ?? null;
    reasons.push("single_completed_near_reference_date");
    warnings.push("matched_on_nearby_day");
    return buildResult({
      status: "matched",
      confidence: "medium",
      reference,
      selectedCompletedWorkoutId: parseWorkoutId(selectedCompleted),
      selectedPlannedWorkoutId: selectedPlanned ? parseWorkoutId(selectedPlanned) : null,
      candidateWorkoutIds: [parseWorkoutId(selectedCompleted)],
      reasons,
      warnings,
    });
  }

  if (plannedOnReferenceDate.length > 0) {
    reasons.push("planned_exists_without_completed");
    warnings.push("planned_exists_but_no_completed");
    return buildResult({
      status: "not_found",
      confidence: "low",
      reference,
      selectedPlannedWorkoutId: parseWorkoutId(plannedOnReferenceDate[0]!),
      candidateWorkoutIds: plannedOnReferenceDate.map(parseWorkoutId),
      reasons,
      warnings,
    });
  }

  reasons.push("no_plausible_workout_in_window");
  return buildResult({
    status: "not_found",
    confidence: "low",
    reference,
    reasons,
    warnings,
  });
}
