import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  classifyTpWorkoutEvidence,
  evaluateOperationalSignalLifecycle,
  type EvidenceFreshness,
  type OperationalSignalClass,
  type OperationalSignalLifecycle,
  type OperationalSignalLifecycleInput,
  type PlannedVsCompletedDelta,
} from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudentOperationalSignal,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose-operational-signal-lifecycle]";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
const DEFAULT_AS_OF = "2026-06-05";

type CliOptions = {
  limit: number;
  student: string | null;
  asOfDate: string;
  json: boolean;
};

type DiagnosticRow = {
  episode_key: string | null;
  student: string;
  signal_class: OperationalSignalClass;
  current_lifecycle: OperationalSignalLifecycle;
  opened_at: string;
  latest_tp_completion_after_open: string | null;
  workout_type: string | null;
  workout_evidence_summary: string | null;
  running_completion_class: string | null;
  classification_confidence: "high" | "medium" | "low" | null;
  classification_reason_codes: string | null;
  transition_explanation: string;
  planned_vs_completed_delta: PlannedVsCompletedDelta | null;
  negative_message_after_completion: string | null;
  missed_skipped_after_return: boolean;
  evidence_freshness: EvidenceFreshness;
  proposed_transition: OperationalSignalLifecycle;
  confidence: "high" | "medium" | "low";
  hide_from_tp_signals: boolean;
  reason: string;
};

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

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${raw}`);
  }
  return Math.floor(parsed);
}

function parseAsOfDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --as-of value: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: DEFAULT_LIMIT,
    student: null,
    asOfDate: DEFAULT_AS_OF,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Math.min(parsePositiveInt(arg.slice("--limit=".length), "--limit"), MAX_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = Math.min(parsePositiveInt(next, "--limit"), MAX_LIMIT);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.student = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      options.asOfDate = parseAsOfDate(arg.slice("--as-of=".length));
      continue;
    }
    if (arg === "--as-of") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --as-of`);
      }
      options.asOfDate = parseAsOfDate(next);
      index += 1;
      continue;
    }
  }
  return options;
}

function normalizeMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function getSignalString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getSignalLifecycle(signal: TrainingPeaksStudentOperationalSignal): OperationalSignalLifecycle {
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

function classifySignal(signal: TrainingPeaksStudentOperationalSignal): OperationalSignalClass {
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

function buildCompletionInfo(
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

function findRecoveryMessage(
  observations: Awaited<ReturnType<typeof listTrainingPeaksTelegramContextObservationsForStudent>>
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

function findNegativeAfterCompletion(
  observations: Awaited<ReturnType<typeof listTrainingPeaksTelegramContextObservationsForStudent>>,
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

function computeMissedSkippedReturnWorkout(
  workouts: TrainingPeaksWorkoutCacheRow[],
  openedDate: string,
  asOfDate: string
): boolean {
  return workouts.some((workout) => {
    if (workout.workoutDate < openedDate || workout.workoutDate > asOfDate) {
      return false;
    }
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
  });
}

function explainTransition(
  input: OperationalSignalLifecycleInput,
  row: DiagnosticRow,
  proposalReason: string
): string {
  if (!input.latestTpCompletionAfterOpen) {
    return `No TP completion after signal open (${input.openedAt.slice(0, 10)}), lifecycle kept.`;
  }
  if (input.negativeMessageAfterCompletion) {
    return `Negative Telegram after completion (${input.negativeMessageAfterCompletion.observedAt}) blocks transition.`;
  }
  if (input.missedOrSkippedReturnWorkout) {
    return "Missed/skipped planned running workout blocks closure.";
  }
  if (input.latestTpCompletionAfterOpen.sportClass === "strength_only") {
    return "Latest completion is strength-only, does not count as return-to-run evidence.";
  }
  if (input.latestTpCompletionAfterOpen.sportClass === "cross_training_or_other") {
    return "Latest completion is cross-training/other, not running evidence for this lifecycle.";
  }
  if (input.latestTpCompletionAfterOpen.sportClass === "unknown") {
    return "Latest completion exists, but sport classification is unknown.";
  }
  if (input.latestTpCompletionAfterOpen.runningCompletionClass === "uncertain_running_completion") {
    return "Running-like completion exists, but planned-vs-completed evidence is uncertain.";
  }
  if (input.latestTpCompletionAfterOpen.runningCompletionClass === "modified_or_easy_run") {
    return "Running completion appears modified/easy, so transition is capped at monitoring.";
  }
  if (input.latestTpCompletionAfterOpen.runningCompletionClass === "return_trial_run") {
    return "Running completion appears to be a return trial run; conservative monitoring transition used.";
  }
  return proposalReason || row.reason;
}

async function buildRows(options: CliOptions): Promise<DiagnosticRow[]> {
  const students = await listTrainingPeaksStudents();
  const studentById = new Map(students.map((student) => [student.id, student]));
  const query = options.student ? normalizeMatch(options.student) : null;

  const signalResult = await listTrainingPeaksOperationalSignals({
    status: "active",
    studentQuery: options.student,
    limit: options.limit,
    offset: 0,
  });
  const rows: DiagnosticRow[] = [];
  for (const signal of signalResult.items) {
    const student = studentById.get(signal.studentId);
    if (!student) {
      continue;
    }
    if (query) {
      const haystack = `${student.studentName} ${student.studentId} ${student.id}`.toLowerCase();
      if (!haystack.includes(query)) {
        continue;
      }
    }
    const openedAt = signal.createdAt;
    const openedDate = openedAt.slice(0, 10);
    const workouts = await listTrainingPeaksWorkoutCacheForStudentDateRange({
      studentId: signal.studentId,
      from: openedDate,
      to: options.asOfDate,
    });
    const observations = await listTrainingPeaksTelegramContextObservationsForStudent(signal.studentId, 250);
    const completion = buildCompletionInfo(workouts, openedDate, options.asOfDate);
    const explicitRecovery = findRecoveryMessage(observations);
    const negativeAfterCompletion = findNegativeAfterCompletion(
      observations,
      completion?.workoutDate ?? null,
      completion?.completionObservedAt ?? null,
      openedAt
    );
    const missedSkipped = computeMissedSkippedReturnWorkout(workouts, openedDate, options.asOfDate);
    const lifecycleInput: OperationalSignalLifecycleInput = {
      episodeKey:
        getSignalString(signal.metadata, "episode_key") ??
        getSignalString(signal.structuredPayload, "episode_key") ??
        undefined,
      studentId: signal.studentId,
      signalClass: classifySignal(signal),
      currentLifecycle: getSignalLifecycle(signal),
      openedAt,
      latestTpCompletionAfterOpen: completion,
      negativeMessageAfterCompletion: negativeAfterCompletion,
      explicitRecoveryMessage: explicitRecovery,
      missedOrSkippedReturnWorkout: missedSkipped,
    };
    const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
    const workoutEvidenceSummary = completion
      ? `sport=${completion.sportClass}; running=${completion.runningCompletionClass}; confidence=${completion.classificationConfidence}`
      : null;
    const reasonCodes = completion ? completion.classificationReasonCodes.join(",") : null;
    const transitionExplanation = explainTransition(lifecycleInput, {
      episode_key: "",
      student: student.studentName,
      signal_class: lifecycleInput.signalClass,
      current_lifecycle: lifecycleInput.currentLifecycle,
      opened_at: lifecycleInput.openedAt,
      latest_tp_completion_after_open: completion ? `${completion.workoutDate} #${completion.workoutId}` : null,
      workout_type: completion ? `${completion.sportOrTypeCode ?? "unknown"} ${completion.title ?? ""}`.trim() : null,
      workout_evidence_summary: workoutEvidenceSummary,
      running_completion_class: completion?.runningCompletionClass ?? null,
      classification_confidence: completion?.classificationConfidence ?? null,
      classification_reason_codes: reasonCodes,
      transition_explanation: "",
      planned_vs_completed_delta: completion?.plannedVsCompletedDelta ?? null,
      negative_message_after_completion: negativeAfterCompletion?.reason ?? null,
      missed_skipped_after_return: missedSkipped,
      evidence_freshness: completion?.evidenceFreshness ?? "missing",
      proposed_transition: proposal.proposedLifecycle,
      confidence: proposal.confidence,
      hide_from_tp_signals: proposal.hideFromTpSignals,
      reason: proposal.reason,
    }, proposal.reason);
    rows.push({
      episode_key: lifecycleInput.episodeKey ?? null,
      student: student.studentName,
      signal_class: lifecycleInput.signalClass,
      current_lifecycle: lifecycleInput.currentLifecycle,
      opened_at: lifecycleInput.openedAt,
      latest_tp_completion_after_open: completion ? `${completion.workoutDate} #${completion.workoutId}` : null,
      workout_type: completion
        ? `${completion.sportOrTypeCode ?? "unknown"} ${completion.title ?? ""}`.trim()
        : null,
      workout_evidence_summary: workoutEvidenceSummary,
      running_completion_class: completion?.runningCompletionClass ?? null,
      classification_confidence: completion?.classificationConfidence ?? null,
      classification_reason_codes: reasonCodes,
      transition_explanation: transitionExplanation,
      planned_vs_completed_delta: completion?.plannedVsCompletedDelta ?? null,
      negative_message_after_completion: negativeAfterCompletion?.reason ?? null,
      missed_skipped_after_return: missedSkipped,
      evidence_freshness: completion?.evidenceFreshness ?? "missing",
      proposed_transition: proposal.proposedLifecycle,
      confidence: proposal.confidence,
      hide_from_tp_signals: proposal.hideFromTpSignals,
      reason: proposal.reason,
    });
  }
  return rows.slice(0, options.limit);
}

function printTable(rows: DiagnosticRow[]): void {
  const header = [
    "episode_key",
    "student",
    "signal_class",
    "current_lifecycle",
    "opened_at",
    "latest_tp_completion_after_open",
    "workout_type",
    "workout_evidence_summary",
    "running_completion_class",
    "classification_confidence",
    "classification_reason_codes",
    "planned_vs_completed_delta",
    "negative_message_after_completion",
    "missed_skipped_after_return",
    "evidence_freshness",
    "proposed_transition",
    "confidence",
    "hide_from_tp_signals",
    "transition_explanation",
    "reason",
  ];
  console.log(header.join("\t"));
  for (const row of rows) {
    console.log(
      [
        row.episode_key ?? "",
        row.student,
        row.signal_class,
        row.current_lifecycle,
        row.opened_at,
        row.latest_tp_completion_after_open ?? "",
        row.workout_type ?? "",
        row.workout_evidence_summary ?? "",
        row.running_completion_class ?? "",
        row.classification_confidence ?? "",
        row.classification_reason_codes ?? "",
        row.planned_vs_completed_delta ?? "",
        row.negative_message_after_completion ?? "",
        row.missed_skipped_after_return ? "yes" : "no",
        row.evidence_freshness,
        row.proposed_transition,
        row.confidence,
        row.hide_from_tp_signals ? "yes" : "no",
        row.transition_explanation,
        row.reason,
      ].join("\t")
    );
  }
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const rows = await buildRows(options);
  if (options.student && rows.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no active signals match --student`);
  }
  if (options.json) {
    console.log(JSON.stringify({ asOfDate: options.asOfDate, rows }, null, 2));
    return;
  }
  printTable(rows);
  console.log(`${LOG_PREFIX} rows=${rows.length} as_of=${options.asOfDate}`);
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-operational-signal-lifecycle.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exitCode = 1;
  });
}
