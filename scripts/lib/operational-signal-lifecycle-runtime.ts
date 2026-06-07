import {
  classifyTpWorkoutEvidence,
  evaluateOperationalSignalLifecycle,
  type EvidenceFreshness,
  type OperationalSignalClass,
  type OperationalSignalLifecycle,
  type OperationalSignalLifecycleInput,
  type PlannedVsCompletedDelta,
  type ReturnWorkoutBlocker,
  type ReturnWorkoutBlockerKind,
} from "@/features/trainingpeaks/operational-signal-lifecycle";
import type {
  TrainingPeaksStudentOperationalSignal,
  TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";

const RECOVERY_PATTERNS = [
  /все\s*ок/iu,
  /всё\s*ок/iu,
  /восстановил[а-я]*/iu,
  /боли?\s+нет/iu,
  /пробежал[а-я]*\s+норм/iu,
  /самочувствие\s+норм/iu,
];

const NEGATIVE_PATTERNS = [
  /боли?\s+(снова|опять|вернул[а-я]*)/iu,
  /хуже/iu,
  /усилил[а-я]*\s+боль/iu,
  /болит/iu,
  /дискомфорт/iu,
  /травм/iu,
];

type ObservationForLifecycle = {
  id: string;
  observedAt: string;
  textPreview: string | null;
  labels: string[];
};

function getSignalString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getSignalLifecycle(signal: TrainingPeaksStudentOperationalSignal): OperationalSignalLifecycle {
  if (signal.lifecycleState) {
    return signal.lifecycleState;
  }
  const payload = signal.structuredPayload ?? {};
  const metadata = signal.metadata ?? {};
  const fromPayload = getSignalString(payload, "lifecycle_state");
  if (fromPayload && isLifecycleValue(fromPayload)) {
    return fromPayload;
  }
  const fromMeta = getSignalString(metadata, "lifecycle_state");
  if (fromMeta && isLifecycleValue(fromMeta)) {
    return fromMeta;
  }
  return "active_problem";
}

function isLifecycleValue(value: string): value is OperationalSignalLifecycle {
  return (
    value === "active_problem" ||
    value === "return_planned" ||
    value === "return_trial_completed" ||
    value === "monitoring_after_return" ||
    value === "resolved"
  );
}

export function classifySignal(signal: TrainingPeaksStudentOperationalSignal): OperationalSignalClass {
  const payload = signal.structuredPayload ?? {};
  const metadata = signal.metadata ?? {};
  const signalType = String(getSignalString(payload, "signal_type") ?? signal.signalType);
  const activityDomain = getSignalString(payload, "activity_domain") ?? getSignalString(metadata, "activity_domain");
  const healthKind = getSignalString(payload, "health_issue_kind") ?? "";
  const summary = `${getSignalString(payload, "display_summary") ?? ""} ${getSignalString(payload, "latest_summary") ?? ""}`.toLowerCase();

  if (
    signalType === "schedule_availability_window" ||
    signalType === "schedule_unavailability_window" ||
    signalType === "plan_generation_constraint"
  ) {
    return "schedule_pause";
  }
  if (signalType === "resume_training" || signalType === "external_training_context") {
    return "return_to_run";
  }
  if (signalType === "pain_injury" || activityDomain === "injury") {
    return "injury_pain";
  }
  if (signalType === "pause_training") {
    return "confirmed_illness";
  }
  if (signalType.startsWith("health_issue")) {
    if (healthKind.includes("ambiguous") || summary.includes("возможно") || summary.includes("не очень")) {
      return "ambiguous_illness";
    }
    if (summary.includes("возможно") || summary.includes("не очень") || summary.includes("кажется")) {
      return "ambiguous_illness";
    }
    return "confirmed_illness";
  }
  return "unknown";
}

function parseNumberish(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value.replace(",", ".").replace(/[^\d.-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveDelta(workout: TrainingPeaksWorkoutCacheRow): PlannedVsCompletedDelta {
  const complianceDuration = parseNumberish(workout.complianceDurationPercent);
  const complianceDistance = parseNumberish(workout.complianceDistancePercent);
  if (complianceDuration !== null && complianceDuration < 80) {
    return "modified_easy";
  }
  if (complianceDistance !== null && complianceDistance < 80) {
    return "modified_easy";
  }
  const plannedTime = parseNumberish(workout.plannedTimeRaw);
  const completedTime = parseNumberish(workout.completedTimeRaw);
  if (plannedTime !== null && plannedTime > 0 && completedTime !== null) {
    const ratio = completedTime / plannedTime;
    if (ratio < 0.8) {
      return "modified_easy";
    }
    if (ratio > 1.25) {
      return "modified_other";
    }
    return "normal";
  }
  return "unknown";
}

function deriveFreshness(workout: TrainingPeaksWorkoutCacheRow, asOfDate: string): EvidenceFreshness {
  const asOf = new Date(`${asOfDate}T23:59:59.999Z`).getTime();
  const scannedAt = Date.parse(workout.scannedAt);
  if (Number.isNaN(scannedAt)) {
    return "missing";
  }
  const ageDays = (asOf - scannedAt) / (24 * 60 * 60 * 1000);
  return ageDays > 3 ? "stale" : "ok";
}

export function buildCompletionInfo(
  workouts: TrainingPeaksWorkoutCacheRow[],
  openedDate: string,
  asOfDate: string
): OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"] {
  const candidates = workouts
    .filter((workout) => workout.workoutDate >= openedDate && workout.workoutDate <= asOfDate)
    .filter((workout) => workout.isCompleted)
    .sort((left, right) => {
      if (left.workoutDate === right.workoutDate) {
        return (left.trainingPeaksWorkoutId ?? 0) - (right.trainingPeaksWorkoutId ?? 0);
      }
      return left.workoutDate.localeCompare(right.workoutDate);
    });
  if (candidates.length === 0) {
    return null;
  }
  const latest = candidates[candidates.length - 1]!;
  const sourceSnapshot =
    latest.sourceSnapshot && typeof latest.sourceSnapshot === "object" && !Array.isArray(latest.sourceSnapshot)
      ? (latest.sourceSnapshot as Record<string, unknown>)
      : {};
  const evidenceClassification = classifyTpWorkoutEvidence({
    workoutId: String(latest.trainingPeaksWorkoutId),
    workoutDate: latest.workoutDate,
    title: latest.title,
    description: typeof sourceSnapshot.description === "string" ? sourceSnapshot.description : null,
    coachComments: typeof sourceSnapshot.coachComments === "string" ? sourceSnapshot.coachComments : null,
    sportOrTypeCode: latest.sportOrTypeCode,
    workoutTypeValueId: latest.workoutTypeValueId,
    workoutSubTypeId: latest.workoutSubTypeId,
    snapshotWorkoutTypeValueId:
      typeof sourceSnapshot.workoutTypeValueId === "number" ? sourceSnapshot.workoutTypeValueId : null,
    snapshotRawWorkoutTypeValueId:
      typeof sourceSnapshot.rawWorkoutTypeValueId === "number" ? sourceSnapshot.rawWorkoutTypeValueId : null,
    snapshotRawWorkoutSubTypeId:
      typeof sourceSnapshot.rawWorkoutSubTypeId === "number" ? sourceSnapshot.rawWorkoutSubTypeId : null,
    snapshotRawCode: typeof sourceSnapshot.rawCode === "string" ? sourceSnapshot.rawCode : null,
    isPlanned: latest.isPlanned,
    isCompleted: latest.isCompleted,
    plannedVsCompletedDelta: deriveDelta(latest),
    complianceDurationPercent: parseNumberish(latest.complianceDurationPercent),
    complianceDistancePercent: parseNumberish(latest.complianceDistancePercent),
    plannedTimeRaw: parseNumberish(latest.plannedTimeRaw),
    completedTimeRaw: parseNumberish(latest.completedTimeRaw),
    plannedDistanceRaw: parseNumberish(latest.plannedDistanceRaw),
    completedDistanceRaw: parseNumberish(latest.completedDistanceRaw),
  });
  return {
    workoutId: String(latest.trainingPeaksWorkoutId),
    workoutDate: latest.workoutDate,
    title: latest.title,
    sportOrTypeCode: latest.sportOrTypeCode,
    sportClass: evidenceClassification.sportClass,
    runningCompletionClass: evidenceClassification.runningCompletionClass,
    classificationConfidence: evidenceClassification.confidence,
    classificationReasonCodes: evidenceClassification.reasonCodes,
    classificationInspectedFields: evidenceClassification.inspectedFields,
    plannedVsCompletedDelta: deriveDelta(latest),
    evidenceFreshness: deriveFreshness(latest, asOfDate),
    completionObservedAt: latest.startTime ?? latest.startTimePlanned ?? null,
  };
}

export function findRecoveryMessage(
  observations: readonly ObservationForLifecycle[]
): OperationalSignalLifecycleInput["explicitRecoveryMessage"] {
  for (const observation of observations) {
    const text = `${observation.textPreview ?? ""} ${(observation.labels ?? []).join(" ")}`;
    if (RECOVERY_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        observationId: observation.id,
        observedAt: observation.observedAt,
        reason: "matched_recovery_pattern",
      };
    }
  }
  return null;
}

export function findNegativeAfterCompletion(
  observations: readonly ObservationForLifecycle[],
  completionDate: string | null,
  completionObservedAt: string | null,
  openedAt: string
): OperationalSignalLifecycleInput["negativeMessageAfterCompletion"] {
  if (!completionDate) {
    return null;
  }
  const completionStart = Number.isFinite(Date.parse(completionObservedAt ?? ""))
    ? Date.parse(completionObservedAt as string)
    : Date.parse(`${completionDate}T00:00:00.000Z`);
  const openedAtMs = Date.parse(openedAt);
  const threshold = Number.isFinite(openedAtMs) ? Math.max(completionStart, openedAtMs) : completionStart;
  for (const observation of observations) {
    const observedAt = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedAt) || observedAt < threshold) {
      continue;
    }
    const text = `${observation.textPreview ?? ""} ${(observation.labels ?? []).join(" ")}`;
    if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        observationId: observation.id,
        observedAt: observation.observedAt,
        reason: "matched_negative_pattern",
      };
    }
  }
  return null;
}

const RETURN_WORKOUT_BLOCKER_REASONS: Record<ReturnWorkoutBlockerKind, string> = {
  missed_before_today: "Planned return workout before as-of date was not completed.",
  pending_today: "Planned return workout is scheduled today; wait for completion before close.",
  future_planned: "Future planned return workout exists; wait for completion before close.",
};

function isRunningLikePlannedReturnWorkout(workout: TrainingPeaksWorkoutCacheRow): boolean {
  if (!workout.isPlanned || workout.isCompleted) {
    return false;
  }
  const sourceSnapshot =
    workout.sourceSnapshot && typeof workout.sourceSnapshot === "object" && !Array.isArray(workout.sourceSnapshot)
      ? (workout.sourceSnapshot as Record<string, unknown>)
      : {};
  const classification = classifyTpWorkoutEvidence({
    workoutId: String(workout.trainingPeaksWorkoutId),
    workoutDate: workout.workoutDate,
    title: workout.title,
    description: typeof sourceSnapshot.description === "string" ? sourceSnapshot.description : null,
    coachComments: typeof sourceSnapshot.coachComments === "string" ? sourceSnapshot.coachComments : null,
    sportOrTypeCode: workout.sportOrTypeCode,
    workoutTypeValueId: workout.workoutTypeValueId,
    workoutSubTypeId: workout.workoutSubTypeId,
    snapshotWorkoutTypeValueId:
      typeof sourceSnapshot.workoutTypeValueId === "number" ? sourceSnapshot.workoutTypeValueId : null,
    snapshotRawWorkoutTypeValueId:
      typeof sourceSnapshot.rawWorkoutTypeValueId === "number" ? sourceSnapshot.rawWorkoutTypeValueId : null,
    snapshotRawWorkoutSubTypeId:
      typeof sourceSnapshot.rawWorkoutSubTypeId === "number" ? sourceSnapshot.rawWorkoutSubTypeId : null,
    snapshotRawCode: typeof sourceSnapshot.rawCode === "string" ? sourceSnapshot.rawCode : null,
    isPlanned: workout.isPlanned,
    isCompleted: workout.isCompleted,
    plannedVsCompletedDelta: deriveDelta(workout),
    complianceDurationPercent: parseNumberish(workout.complianceDurationPercent),
    complianceDistancePercent: parseNumberish(workout.complianceDistancePercent),
    plannedTimeRaw: parseNumberish(workout.plannedTimeRaw),
    completedTimeRaw: parseNumberish(workout.completedTimeRaw),
    plannedDistanceRaw: parseNumberish(workout.plannedDistanceRaw),
    completedDistanceRaw: parseNumberish(workout.completedDistanceRaw),
  });
  return classification.sportClass === "running_like";
}

function classifyReturnWorkoutBlockerKind(workoutDate: string, asOfDate: string): ReturnWorkoutBlockerKind {
  if (workoutDate < asOfDate) {
    return "missed_before_today";
  }
  if (workoutDate === asOfDate) {
    return "pending_today";
  }
  return "future_planned";
}

function buildReturnWorkoutBlocker(
  workout: TrainingPeaksWorkoutCacheRow,
  kind: ReturnWorkoutBlockerKind
): ReturnWorkoutBlocker {
  return {
    kind,
    workoutId: String(workout.trainingPeaksWorkoutId),
    workoutDate: workout.workoutDate,
    title: workout.title,
    reason: RETURN_WORKOUT_BLOCKER_REASONS[kind],
  };
}

export function computeReturnWorkoutBlocker(
  workouts: TrainingPeaksWorkoutCacheRow[],
  openedDate: string,
  asOfDate: string
): ReturnWorkoutBlocker | null {
  const candidates = workouts
    .filter((workout) => workout.workoutDate >= openedDate)
    .filter((workout) => isRunningLikePlannedReturnWorkout(workout))
    .map((workout) => ({
      workout,
      kind: classifyReturnWorkoutBlockerKind(workout.workoutDate, asOfDate),
    }));

  if (candidates.length === 0) {
    return null;
  }

  const missed = candidates
    .filter((candidate) => candidate.kind === "missed_before_today")
    .sort((left, right) => left.workout.workoutDate.localeCompare(right.workout.workoutDate));
  if (missed.length > 0) {
    const first = missed[0]!;
    return buildReturnWorkoutBlocker(first.workout, first.kind);
  }

  const pending = candidates.filter((candidate) => candidate.kind === "pending_today");
  if (pending.length > 0) {
    const first = pending[0]!;
    return buildReturnWorkoutBlocker(first.workout, first.kind);
  }

  const future = candidates
    .filter((candidate) => candidate.kind === "future_planned")
    .sort((left, right) => left.workout.workoutDate.localeCompare(right.workout.workoutDate));
  if (future.length > 0) {
    const first = future[0]!;
    return buildReturnWorkoutBlocker(first.workout, first.kind);
  }

  return null;
}

export function computeMissedSkippedReturnWorkout(
  workouts: TrainingPeaksWorkoutCacheRow[],
  openedDate: string,
  asOfDate: string
): boolean {
  return computeReturnWorkoutBlocker(workouts, openedDate, asOfDate)?.kind === "missed_before_today";
}

export function buildLifecycleInputFromEvidence(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  asOfDate: string;
  workouts: TrainingPeaksWorkoutCacheRow[];
  observations: readonly ObservationForLifecycle[];
}): OperationalSignalLifecycleInput {
  const openedAt = input.signal.createdAt;
  const openedDate = openedAt.slice(0, 10);
  const completion = buildCompletionInfo(input.workouts, openedDate, input.asOfDate);
  return {
    episodeKey:
      getSignalString(input.signal.metadata, "episode_key") ??
      getSignalString(input.signal.structuredPayload, "episode_key") ??
      undefined,
    studentId: input.signal.studentId,
    signalClass: classifySignal(input.signal),
    currentLifecycle: getSignalLifecycle(input.signal),
    openedAt,
    latestTpCompletionAfterOpen: completion,
    negativeMessageAfterCompletion: findNegativeAfterCompletion(
      input.observations,
      completion?.workoutDate ?? null,
      completion?.completionObservedAt ?? null,
      openedAt
    ),
    explicitRecoveryMessage: findRecoveryMessage(input.observations),
    returnWorkoutBlocker: computeReturnWorkoutBlocker(input.workouts, openedDate, input.asOfDate),
    missedOrSkippedReturnWorkout: computeMissedSkippedReturnWorkout(input.workouts, openedDate, input.asOfDate),
  };
}

export function evaluateLifecycleFromEvidence(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  asOfDate: string;
  workouts: TrainingPeaksWorkoutCacheRow[];
  observations: readonly ObservationForLifecycle[];
}): {
  lifecycleInput: OperationalSignalLifecycleInput;
  proposal: ReturnType<typeof evaluateOperationalSignalLifecycle>;
} {
  const lifecycleInput = buildLifecycleInputFromEvidence(input);
  const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
  return { lifecycleInput, proposal };
}
