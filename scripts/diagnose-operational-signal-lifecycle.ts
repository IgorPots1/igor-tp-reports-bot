import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
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
  planned_vs_completed_delta: PlannedVsCompletedDelta | null;
  negative_message_after_completion: string | null;
  missed_skipped_after_return: boolean;
  evidence_freshness: EvidenceFreshness;
  proposed_transition: OperationalSignalLifecycle;
  confidence: "high" | "medium" | "low";
  hide_from_tp_signals: boolean;
  reason: string;
};

const RUN_KEYWORDS = ["run", "running", "jog", "бег", "пробеж"];
const STRENGTH_KEYWORDS = ["strength", "gym", "crossfit", "сил", "зал", "weights"];
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

function isRunningLikeWorkout(workout: TrainingPeaksWorkoutCacheRow): boolean {
  const sport = (workout.sportOrTypeCode ?? "").toLowerCase();
  const title = (workout.title ?? "").toLowerCase();
  return RUN_KEYWORDS.some((part) => sport.includes(part) || title.includes(part));
}

function isStrengthLikeWorkout(workout: TrainingPeaksWorkoutCacheRow): boolean {
  const sport = (workout.sportOrTypeCode ?? "").toLowerCase();
  const title = (workout.title ?? "").toLowerCase();
  return STRENGTH_KEYWORDS.some((part) => sport.includes(part) || title.includes(part));
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
  return {
    workoutId: String(latest.trainingPeaksWorkoutId),
    workoutDate: latest.workoutDate,
    title: latest.title,
    sportOrTypeCode: latest.sportOrTypeCode,
    isRunningLike: isRunningLikeWorkout(latest),
    isStrengthLike: isStrengthLikeWorkout(latest),
    plannedVsCompletedDelta: deriveDelta(latest),
    evidenceFreshness: deriveFreshness(latest, asOfDate),
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
  completionDate: string | null
): OperationalSignalLifecycleInput["negativeMessageAfterCompletion"] {
  if (!completionDate) {
    return null;
  }
  const completionStart = Date.parse(`${completionDate}T00:00:00.000Z`);
  for (const observation of observations) {
    const observedAt = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedAt) || observedAt < completionStart) {
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
    return isRunningLikeWorkout(workout);
  });
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
      completion?.workoutDate ?? null
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
    "planned_vs_completed_delta",
    "negative_message_after_completion",
    "missed_skipped_after_return",
    "evidence_freshness",
    "proposed_transition",
    "confidence",
    "hide_from_tp_signals",
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
        row.planned_vs_completed_delta ?? "",
        row.negative_message_after_completion ?? "",
        row.missed_skipped_after_return ? "yes" : "no",
        row.evidence_freshness,
        row.proposed_transition,
        row.confidence,
        row.hide_from_tp_signals ? "yes" : "no",
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
