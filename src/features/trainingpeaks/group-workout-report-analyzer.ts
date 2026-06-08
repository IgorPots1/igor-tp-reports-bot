import type { GroupWorkoutReportWorkoutMatchResult } from "@/features/trainingpeaks/group-workout-report-matcher";
import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";

export type GroupWorkoutReportAnalysisDataAvailability = {
  hasPlannedDuration: boolean;
  hasCompletedDuration: boolean;
  hasPlannedDistance: boolean;
  hasCompletedDistance: boolean;
  hasDurationCompliance: boolean;
  hasDistanceCompliance: boolean;
  hasAveragePace: boolean;
  hasAverageHeartRate: boolean;
  hasLapOrIntervalActuals: boolean;
};

export type GroupWorkoutReportWorkoutAnalysis = {
  confidence: "high" | "medium" | "low";
  workoutType:
    | "easy_run"
    | "long_run"
    | "quality_interval"
    | "tempo_controlled"
    | "race_or_activation"
    | "strength_or_other"
    | "unknown";
  executionStatus:
    | "good"
    | "slightly_short"
    | "significantly_short"
    | "over_plan"
    | "missed_or_not_completed"
    | "ambiguous"
    | "insufficient_data";
  summaryForCoach: string;
  planActualBullets: string[];
  riskFlags: string[];
  dataAvailability: GroupWorkoutReportAnalysisDataAvailability;
  unavailableDataNotes: string[];
  recommendationForDraft: string;
};

type Input = {
  match: GroupWorkoutReportWorkoutMatchResult;
  plannedWorkout: TrainingPeaksWorkoutCacheRow | null;
  completedWorkout: TrainingPeaksWorkoutCacheRow | null;
  reportText: string;
  detectedLabels?: string[];
};

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasAnyKeyDeep(value: unknown, needles: string[], depth = 0): boolean {
  if (depth > 3) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasAnyKeyDeep(entry, needles, depth + 1));
  }
  const record = asObject(value);
  if (!record) {
    return false;
  }
  for (const [key, nested] of Object.entries(record)) {
    const normalized = key.toLowerCase();
    if (needles.some((needle) => normalized.includes(needle))) {
      return true;
    }
    if (hasAnyKeyDeep(nested, needles, depth + 1)) {
      return true;
    }
  }
  return false;
}

function inferWorkoutType(input: {
  planned: TrainingPeaksWorkoutCacheRow | null;
  completed: TrainingPeaksWorkoutCacheRow | null;
}): GroupWorkoutReportWorkoutAnalysis["workoutType"] {
  const row = input.completed ?? input.planned;
  if (!row) {
    return "unknown";
  }
  const title = (row.title ?? "").toLocaleLowerCase("ru");
  const activity = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    sourceSnapshot: row.sourceSnapshot,
  });
  if (!activity.isRunning) {
    return "strength_or_other";
  }

  const durationSeconds = toNumber(row.completedTimeRaw) ?? toNumber(row.plannedTimeRaw) ?? null;
  const durationMinutes = durationSeconds !== null ? durationSeconds / 60 : null;
  if (/\b(интервал|interval|отрез|повтор)\b/iu.test(title)) {
    return "quality_interval";
  }
  if (/\b(темп|tempo|threshold|пано|контрол)\b/iu.test(title)) {
    return "tempo_controlled";
  }
  if (/\b(race|соревн|старт|activation|активац|подвод)\b/iu.test(title)) {
    return "race_or_activation";
  }
  if (durationMinutes !== null && durationMinutes >= 75) {
    return "long_run";
  }
  if (/\b(длит|long)\b/iu.test(title)) {
    return "long_run";
  }
  if (/\b(легк|easy|aerobic|восстанов)\b/iu.test(title)) {
    return "easy_run";
  }
  return "unknown";
}

function deriveExecutionStatus(input: {
  match: GroupWorkoutReportWorkoutMatchResult;
  hasCompleted: boolean;
  durationCompliance: number | null;
}): GroupWorkoutReportWorkoutAnalysis["executionStatus"] {
  if (input.match.status === "ambiguous") {
    return "ambiguous";
  }
  if (!input.hasCompleted) {
    return "missed_or_not_completed";
  }
  if (input.durationCompliance === null) {
    return "insufficient_data";
  }
  if (input.durationCompliance < 80) {
    return "significantly_short";
  }
  if (input.durationCompliance < 95) {
    return "slightly_short";
  }
  if (input.durationCompliance <= 110) {
    return "good";
  }
  return "over_plan";
}

export function analyzeGroupWorkoutReport(input: Input): GroupWorkoutReportWorkoutAnalysis {
  const planned = input.plannedWorkout;
  const completed = input.completedWorkout;
  const completedDuration = toNumber(completed?.completedTimeRaw);
  const plannedDuration = toNumber(planned?.plannedTimeRaw);
  const completedDistance = toNumber(completed?.completedDistanceRaw);
  const plannedDistance = toNumber(planned?.plannedDistanceRaw);
  const durationCompliance =
    toNumber(completed?.complianceDurationPercent) ?? toNumber(planned?.complianceDurationPercent);
  const distanceCompliance =
    toNumber(completed?.complianceDistancePercent) ?? toNumber(planned?.complianceDistancePercent);

  const snapshot = asObject(completed?.sourceSnapshot ?? planned?.sourceSnapshot);
  const hasAveragePace = hasAnyKeyDeep(snapshot, ["avgpace", "averagepace", "pace_avg"]);
  const hasAverageHeartRate = hasAnyKeyDeep(snapshot, ["avgheartrate", "averageheartrate", "heart_rate_avg"]);
  const hasLapOrIntervalActuals = hasAnyKeyDeep(snapshot, [
    "lap",
    "interval",
    "split",
    "repetition",
    "segment",
  ]);
  const hasPlannedStructure = hasAnyKeyDeep(snapshot, ["structure", "steps", "planned"]);
  const hasCoachComments = hasAnyKeyDeep(snapshot, ["coachcomments", "coach_comments", "notes"]);

  const dataAvailability: GroupWorkoutReportAnalysisDataAvailability = {
    hasPlannedDuration: plannedDuration !== null,
    hasCompletedDuration: completedDuration !== null,
    hasPlannedDistance: plannedDistance !== null,
    hasCompletedDistance: completedDistance !== null,
    hasDurationCompliance: durationCompliance !== null,
    hasDistanceCompliance: distanceCompliance !== null,
    hasAveragePace,
    hasAverageHeartRate,
    hasLapOrIntervalActuals,
  };

  const unavailableDataNotes: string[] = [];
  if (!dataAvailability.hasAveragePace) {
    unavailableDataNotes.push("average pace is unavailable in current cache/source_snapshot.");
  }
  if (!dataAvailability.hasAverageHeartRate) {
    unavailableDataNotes.push("average heart rate is unavailable in current cache/source_snapshot.");
  }
  if (!dataAvailability.hasLapOrIntervalActuals) {
    unavailableDataNotes.push("lap/interval actuals are unavailable in current cache/source_snapshot.");
  }
  if (!hasPlannedStructure) {
    unavailableDataNotes.push("planned interval/step structure is unavailable or sparse.");
  }
  if (!hasCoachComments) {
    unavailableDataNotes.push("coach comments are unavailable or sparse.");
  }

  const workoutType = inferWorkoutType({ planned, completed });
  const executionStatus = deriveExecutionStatus({
    match: input.match,
    hasCompleted: Boolean(completed),
    durationCompliance,
  });
  const confidence: GroupWorkoutReportWorkoutAnalysis["confidence"] =
    executionStatus === "insufficient_data" || executionStatus === "ambiguous"
      ? "low"
      : input.match.confidence === "high"
        ? "high"
        : "medium";

  const planActualBullets: string[] = [];
  if (plannedDuration !== null) {
    planActualBullets.push(`Planned duration: ${Math.round(plannedDuration / 60)} min.`);
  }
  if (completedDuration !== null) {
    planActualBullets.push(`Completed duration: ${Math.round(completedDuration / 60)} min.`);
  }
  if (durationCompliance !== null) {
    planActualBullets.push(`Duration compliance: ${durationCompliance.toFixed(1)}%.`);
  }
  if (plannedDistance !== null) {
    planActualBullets.push(`Planned distance: ${plannedDistance.toFixed(2)}.`);
  }
  if (completedDistance !== null) {
    planActualBullets.push(`Completed distance: ${completedDistance.toFixed(2)}.`);
  }
  if (distanceCompliance !== null) {
    planActualBullets.push(`Distance compliance: ${distanceCompliance.toFixed(1)}%.`);
  }

  const riskFlags: string[] = [];
  const labels = input.detectedLabels ?? [];
  if (labels.includes("pain_or_health") || /\b(бол|ахилл|колен|pain|injur|ill)\b/iu.test(input.reportText)) {
    riskFlags.push("pain_or_health_signal_in_report");
  }
  if (executionStatus === "over_plan") {
    riskFlags.push("duration_over_plan");
  }
  if (executionStatus === "significantly_short") {
    riskFlags.push("workout_significantly_short");
  }
  if (input.match.status === "ambiguous") {
    riskFlags.push("workout_match_ambiguous");
  }

  let summaryForCoach = "";
  if (executionStatus === "good") {
    summaryForCoach = "Execution is close to plan by available duration/distance metrics.";
  } else if (executionStatus === "slightly_short") {
    summaryForCoach = "Workout looks slightly short versus plan by duration compliance.";
  } else if (executionStatus === "significantly_short") {
    summaryForCoach = "Workout looks significantly short versus plan by duration compliance.";
  } else if (executionStatus === "over_plan") {
    summaryForCoach = "Workout appears above planned duration; verify intent and recovery impact.";
  } else if (executionStatus === "missed_or_not_completed") {
    summaryForCoach = "Planned workout exists but completed evidence was not matched.";
  } else if (executionStatus === "ambiguous") {
    summaryForCoach = "Multiple plausible completed workouts found; manual selection is required.";
  } else {
    summaryForCoach = "Insufficient plan-vs-actual metrics for confident execution assessment.";
  }

  const recommendationForDraft =
    unavailableDataNotes.length > 0
      ? "When generating a draft later, explicitly state missing pace/HR/lap data and avoid claims about zones/interval precision."
      : "Draft can use available plan-vs-actual metrics conservatively.";

  return {
    confidence,
    workoutType,
    executionStatus,
    summaryForCoach,
    planActualBullets,
    riskFlags,
    dataAvailability,
    unavailableDataNotes,
    recommendationForDraft,
  };
}
