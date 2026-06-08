import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { getSignalMetadataString } from "@/features/trainingpeaks/operational-schedule-display";
import type { OperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudentOperationalSignal,
  type TrainingPeaksTelegramContextObservation,
} from "@/features/trainingpeaks/repository";
import {
  classifyCoachOperationalSignals,
  type ObservationLike,
} from "./lib/coach-operational-signals";
import {
  classifyRecoveryEvidenceKind,
  evaluateLifecycleFromEvidence,
  getSignalLifecycle,
  matchesRecoveryPattern,
  resolveSignalOpenTime,
  type RecoveryEvidenceKind,
} from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[diagnose-recovery-trigger-gaps]";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 400;
const DEFAULT_DAYS = 21;
const DEFAULT_AS_OF = "2026-06-07";
const COACH_APPROVAL_WINDOW_HOURS = 72;

type CliOptions = {
  student: string | null;
  asOfDate: string;
  days: number;
  limit: number;
  json: boolean;
};

type ProposedAction =
  | "update_display_return_planned"
  | "apply_monitoring"
  | "resolve_candidate"
  | "coach_review"
  | "no_action"
  | "tp_only_lifecycle_needed"
  | "coach_approval_link_needed";

type DiagnosticRow = {
  student: string;
  signal_id: string;
  current_display: string;
  lifecycle_state: string;
  signal_age: number;
  newer_recovery_obs: boolean;
  obs_id: string | null;
  obs_time: string | null;
  obs_text_short: string | null;
  classifier_result: string | null;
  recovery_pattern_matched: boolean;
  evidence_kind: RecoveryEvidenceKind | "tp_only_completion";
  proposed_action: ProposedAction;
  confidence: string;
  reason: string;
  section: "A" | "B" | "C" | "D" | "E";
};

type RecoveryObservationMatch = {
  observation: TrainingPeaksTelegramContextObservation;
  classifierResult: string | null;
  confidence: string;
  reason: string;
  recoveryPatternMatched: boolean;
  evidenceKind: RecoveryEvidenceKind;
};

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

function parseAsOfDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --as-of value: ${raw}`);
  }
  return normalized;
}

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${raw}`);
  }
  return Math.floor(parsed);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    student: null,
    asOfDate: DEFAULT_AS_OF,
    days: DEFAULT_DAYS,
    limit: DEFAULT_LIMIT,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
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
    if (arg.startsWith("--days=")) {
      options.days = parsePositiveInt(arg.slice("--days=".length), "--days");
      continue;
    }
    if (arg === "--days") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --days`);
      }
      options.days = parsePositiveInt(next, "--days");
      index += 1;
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
  }
  return options;
}

function normalizeMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeRecordBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function toDaysBetween(leftIso: string, rightIso: string): number {
  const left = Date.parse(leftIso);
  const right = Date.parse(rightIso);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.floor(Math.abs(right - left) / (24 * 60 * 60 * 1000));
}

function getSupersededBySignalId(signal: TrainingPeaksStudentOperationalSignal): string | null {
  return (
    getSignalMetadataString(signal.metadata, "superseded_by_signal_id") ??
    normalizeRecordString(signal.structuredPayload.superseded_by_signal_id) ??
    normalizeRecordString(signal.lifecycleMeta.superseded_by_signal_id)
  );
}

function resolveEffectiveVisibleInTpSignals(signal: TrainingPeaksStudentOperationalSignal): boolean | null {
  return (
    normalizeRecordBoolean(signal.structuredPayload.visible_in_tp_signals) ??
    (typeof signal.metadata.visible_in_tp_signals === "boolean"
      ? signal.metadata.visible_in_tp_signals
      : null)
  );
}

function isIncludedLifecycle(lifecycle: OperationalSignalLifecycle): boolean {
  return (
    lifecycle === "active_problem" ||
    lifecycle === "monitoring_after_return" ||
    lifecycle === "return_planned" ||
    lifecycle === "return_trial_completed"
  );
}

function isActiveHealthSignal(signal: TrainingPeaksStudentOperationalSignal): boolean {
  if (signal.status !== "active") {
    return false;
  }
  const lifecycle = getSignalLifecycle(signal);
  if (lifecycle === "resolved" || !isIncludedLifecycle(lifecycle)) {
    return false;
  }
  if (getSupersededBySignalId(signal)) {
    return false;
  }
  const visible = resolveEffectiveVisibleInTpSignals(signal);
  if (visible === false) {
    return false;
  }

  const signalType = signal.signalType;
  const activityDomain =
    normalizeRecordString(signal.structuredPayload.activity_domain) ??
    getSignalMetadataString(signal.metadata, "activity_domain");

  if (
    signalType === "schedule_availability_window" ||
    signalType === "schedule_unavailability_window" ||
    signalType === "plan_generation_constraint"
  ) {
    return false;
  }
  if (signalType === "move_workout_candidate") {
    return activityDomain === "health" || activityDomain === "injury";
  }
  if (
    signalType === "health_issue_started" ||
    signalType === "health_issue_improving" ||
    signalType === "pain_injury" ||
    signalType === "pause_training" ||
    signalType.startsWith("health_issue")
  ) {
    return true;
  }
  return activityDomain === "health" || activityDomain === "injury";
}


function resolveCurrentDisplay(signal: TrainingPeaksStudentOperationalSignal): string {
  return (
    normalizeRecordString(signal.structuredPayload.display_summary) ??
    normalizeRecordString(signal.structuredPayload.latest_summary) ??
    getSignalMetadataString(signal.metadata, "summary") ??
    signal.signalType
  );
}

function isCoachObservation(observation: TrainingPeaksTelegramContextObservation): boolean {
  const role =
    typeof observation.metadata.senderRole === "string"
      ? observation.metadata.senderRole.toLowerCase()
      : "";
  return ["coach", "admin", "bot"].some((item) => role.includes(item));
}

function isAthleteObservation(observation: TrainingPeaksTelegramContextObservation): boolean {
  if (isCoachObservation(observation)) {
    return false;
  }
  const role =
    typeof observation.metadata.senderRole === "string"
      ? observation.metadata.senderRole.toLowerCase()
      : "";
  if (["known_student", "linked_student", "student"].some((item) => role.includes(item))) {
    return true;
  }
  return observation.sourceType === "business_dm" || observation.sourceType === "private_dm";
}

function toObservationLike(
  observation: TrainingPeaksTelegramContextObservation,
  studentId: string
): ObservationLike {
  return {
    sourceType: observation.sourceType,
    textPreview: observation.textPreview,
    labels: observation.labels,
    metadata: observation.metadata,
    observedAt: observation.observedAt,
    studentId,
  };
}

function isRecoveryClassifierSignalType(signalType: string | null): boolean {
  return (
    signalType === "health_issue_improving" ||
    signalType === "health_issue_resolved" ||
    signalType === "resume_training"
  );
}

function classifyObservation(input: {
  observation: TrainingPeaksTelegramContextObservation;
  studentId: string;
}): {
  classifierResult: string | null;
  confidence: string;
  reason: string;
  plannedAttemptDate: string | null;
} {
  const observationLike = toObservationLike(input.observation, input.studentId);
  const candidates = classifyCoachOperationalSignals(observationLike);
  const recoveryCandidate =
    candidates.find((candidate) => isRecoveryClassifierSignalType(candidate.signal_type)) ??
    candidates.find((candidate) => candidate.primary_bucket === "health_lifecycle_signal") ??
    null;
  if (!recoveryCandidate) {
    return {
      classifierResult: null,
      confidence: "none",
      reason: "no recovery classifier candidate",
      plannedAttemptDate: null,
    };
  }
  const plannedAttemptDate =
    normalizeRecordString(recoveryCandidate.structured_payload.planned_attempt_date) ??
    normalizeRecordString(recoveryCandidate.structured_payload.resume_from_date);
  return {
    classifierResult: recoveryCandidate.signal_type,
    confidence: recoveryCandidate.confidence,
    reason: recoveryCandidate.reason,
    plannedAttemptDate,
  };
}

function shortenText(text: string | null, maxLength = 72): string | null {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function findRecoveryObservations(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  observations: TrainingPeaksTelegramContextObservation[];
  asOfDate: string;
  days: number;
}): RecoveryObservationMatch[] {
  const openTime = resolveSignalOpenTime(input.signal);
  const openMs = Date.parse(openTime);
  const openDayMs = Date.parse(`${openTime.slice(0, 10)}T00:00:00.000Z`);
  const asOfMs = Date.parse(`${input.asOfDate}T23:59:59.999Z`);
  const windowStartMs = asOfMs - input.days * 24 * 60 * 60 * 1000;
  const matches: RecoveryObservationMatch[] = [];

  for (const observation of input.observations) {
    if (!isAthleteObservation(observation)) {
      continue;
    }
    const observedMs = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedMs)) {
      continue;
    }
    if (observedMs < Math.min(openMs, openDayMs) || observedMs > asOfMs) {
      continue;
    }
    if (observedMs < windowStartMs) {
      continue;
    }
    const text = `${observation.textPreview ?? ""}`.trim();
    if (!text) {
      continue;
    }
    const classified = classifyObservation({
      observation,
      studentId: input.signal.studentId,
    });
    const recoveryPatternMatched = matchesRecoveryPattern(text);
    const evidenceKind = classifyRecoveryEvidenceKind({
      classifierSignalType: classified.classifierResult,
      text,
      plannedAttemptDate: classified.plannedAttemptDate,
    });
    if (!isRecoveryClassifierSignalType(classified.classifierResult) && !recoveryPatternMatched) {
      continue;
    }
    matches.push({
      observation,
      classifierResult: classified.classifierResult,
      confidence: classified.confidence,
      reason: classified.reason,
      recoveryPatternMatched,
      evidenceKind,
    });
  }

  return matches.sort(
    (left, right) => Date.parse(right.observation.observedAt) - Date.parse(left.observation.observedAt)
  );
}

function hasCoachApprovalNearby(input: {
  recoveryObservation: TrainingPeaksTelegramContextObservation;
  observations: TrainingPeaksTelegramContextObservation[];
}): boolean {
  const recoveryMs = Date.parse(input.recoveryObservation.observedAt);
  if (!Number.isFinite(recoveryMs)) {
    return false;
  }
  const windowEndMs = recoveryMs + COACH_APPROVAL_WINDOW_HOURS * 60 * 60 * 1000;
  for (const observation of input.observations) {
    if (!isCoachObservation(observation)) {
      continue;
    }
    const observedMs = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedMs) || observedMs < recoveryMs || observedMs > windowEndMs) {
      continue;
    }
    const text = `${observation.textPreview ?? ""}`.trim().toLowerCase();
    if (/^(давай|ок|ok|хорошо|можно)[!.]?\s*$/iu.test(text) || /\bдавай\b/iu.test(text)) {
      return true;
    }
  }
  return false;
}

function findCoachApprovalGap(input: {
  recoveryMatches: RecoveryObservationMatch[];
  observations: TrainingPeaksTelegramContextObservation[];
}): RecoveryObservationMatch | null {
  for (const match of input.recoveryMatches) {
    if (match.evidenceKind !== "return_request") {
      continue;
    }
    if (
      hasCoachApprovalNearby({
        recoveryObservation: match.observation,
        observations: input.observations,
      })
    ) {
      return match;
    }
  }
  return null;
}

function resolveProposedAction(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  recoveryMatch: RecoveryObservationMatch | null;
  coachApprovalGap: RecoveryObservationMatch | null;
  hasTpCompletion: boolean;
  lifecycleProposal: string;
  lifecycleHasExplicitRecovery: boolean;
}): { action: ProposedAction; reason: string } {
  if (input.coachApprovalGap) {
    return {
      action: "coach_approval_link_needed",
      reason: "athlete return request with nearby coach approval not linked to signal episode",
    };
  }
  if (input.recoveryMatch) {
    const classifierResult = input.recoveryMatch.classifierResult;
    if (classifierResult === "resume_training" || classifierResult === "health_issue_resolved") {
      return {
        action: "resolve_candidate",
        reason: "classifier recognizes explicit recovery/return intent on newer message",
      };
    }
    if (classifierResult === "health_issue_improving") {
      if (
        input.recoveryMatch.evidenceKind === "return_planned" ||
        input.recoveryMatch.evidenceKind === "return_request"
      ) {
        return {
          action: "update_display_return_planned",
          reason: "classifier recognizes improving health with planned return attempt",
        };
      }
      return {
        action: "apply_monitoring",
        reason: "classifier recognizes health improvement; refresh monitoring display",
      };
    }
    if (input.recoveryMatch.recoveryPatternMatched) {
      return {
        action: "coach_review",
        reason: "recovery pattern matched but classifier did not emit a health lifecycle candidate",
      };
    }
  }

  if (input.hasTpCompletion) {
    return {
      action: "tp_only_lifecycle_needed",
      reason: "TP completion evidence after signal open without message-based recovery trigger",
    };
  }

  if (
    input.lifecycleHasExplicitRecovery &&
    (input.lifecycleProposal === "monitoring_after_return" || input.lifecycleProposal === "resolved")
  ) {
    return {
      action: "coach_review",
      reason: `lifecycle evaluator proposes ${input.lifecycleProposal} based on recovery evidence but signal DB state is stale`,
    };
  }

  if (input.lifecycleProposal === "monitoring_after_return" || input.lifecycleProposal === "resolved") {
    return {
      action: "coach_review",
      reason: `lifecycle evaluator proposes ${input.lifecycleProposal} but signal DB state is stale`,
    };
  }

  return {
    action: "no_action",
    reason: "no newer recovery observation or TP-only return evidence found",
  };
}

function resolveSection(input: {
  proposedAction: ProposedAction;
  recoveryMatch: RecoveryObservationMatch | null;
  hasTpCompletion: boolean;
}): DiagnosticRow["section"] {
  if (input.proposedAction === "coach_approval_link_needed") {
    return "C";
  }
  if (input.proposedAction === "tp_only_lifecycle_needed") {
    return "B";
  }
  if (
    input.recoveryMatch &&
    input.proposedAction !== "no_action" &&
    input.proposedAction !== "coach_review"
  ) {
    return "A";
  }
  if (input.proposedAction === "coach_review") {
    return "E";
  }
  if (input.proposedAction === "no_action") {
    return "D";
  }
  return "E";
}

function printTable(rows: DiagnosticRow[]): void {
  const header = [
    "student",
    "signal_id",
    "current_display",
    "lifecycle_state",
    "signal_age",
    "newer_recovery_obs?",
    "obs_id",
    "obs_time",
    "obs_text_short",
    "classifier_result",
    "proposed_action",
    "confidence",
    "reason",
  ];
  console.log(header.join("\t"));
  for (const row of rows) {
    console.log(
      [
        row.student,
        row.signal_id,
        row.current_display.replace(/\s+/gu, " ").trim(),
        row.lifecycle_state,
        String(row.signal_age),
        row.newer_recovery_obs ? "yes" : "no",
        row.obs_id ?? "none",
        row.obs_time ?? "none",
        row.obs_text_short ?? "none",
        row.classifier_result ?? "none",
        row.proposed_action,
        row.confidence,
        row.reason.replace(/\s+/gu, " ").trim(),
      ].join("\t")
    );
  }
}

function printGroupedSections(rows: DiagnosticRow[]): void {
  const sections: Array<{ key: DiagnosticRow["section"]; title: string }> = [
    { key: "A", title: "A — message recovery found, old signal stale" },
    { key: "B", title: "B — TP-only return evidence" },
    { key: "C", title: "C — coach approval link needed" },
    { key: "D", title: "D — no recovery evidence, keep active" },
    { key: "E", title: "E — uncertain/manual review" },
  ];
  console.log("");
  for (const section of sections) {
    const sectionRows = rows.filter((row) => row.section === section.key);
    console.log(`=== ${section.title} (${sectionRows.length}) ===`);
    for (const row of sectionRows) {
      console.log(
        `  - ${row.student} ${row.signal_id.slice(0, 8)}… ${row.current_display} -> ${row.proposed_action}${
          row.obs_text_short ? ` | obs: ${row.obs_text_short}` : ""
        }`
      );
    }
  }
}

function printSummary(rows: DiagnosticRow[]): void {
  const staleWithRecovery = rows.filter(
    (row) => row.section === "A" || row.section === "C" || row.proposed_action === "resolve_candidate"
  );
  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`active_health_signals_scanned: ${rows.length}`);
  console.log(
    `newer_recovery_observations_found: ${rows.filter((row) => row.newer_recovery_obs).length}`
  );
  console.log(`stale_signals_with_recoveries: ${staleWithRecovery.length}`);
  console.log(`tp_only_candidates: ${rows.filter((row) => row.section === "B").length}`);
  console.log(
    `coach_approval_link_candidates: ${rows.filter((row) => row.section === "C").length}`
  );
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const studentQuery = options.student ? normalizeMatch(options.student) : null;

  const students = await listTrainingPeaksStudents();
  const studentsFiltered = students.filter((student) => {
    if (!studentQuery) {
      return true;
    }
    const haystack = `${student.studentName} ${student.studentId} ${student.id}`.toLowerCase();
    return haystack.includes(studentQuery);
  });
  if (studentQuery && studentsFiltered.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no students match --student`);
  }

  const healthSignals: TrainingPeaksStudentOperationalSignal[] = [];
  for (const student of studentsFiltered) {
    const signalResult = await listTrainingPeaksOperationalSignals({
      status: "active",
      studentQuery: student.studentName,
      limit: 200,
    });
    for (const signal of signalResult.items) {
      if (signal.studentId !== student.id) {
        continue;
      }
      if (!isActiveHealthSignal(signal)) {
        continue;
      }
      healthSignals.push(signal);
    }
  }

  healthSignals.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const signalsToScan = healthSignals.slice(0, options.limit);

  const observationsByStudent = new Map<
    string,
    Awaited<ReturnType<typeof listTrainingPeaksTelegramContextObservationsForStudent>>
  >();
  const workoutsByStudent = new Map<
    string,
    Awaited<ReturnType<typeof listTrainingPeaksWorkoutCacheForStudentDateRange>>
  >();
  const studentNameById = new Map(
    students.map((student) => [student.id, student.studentName?.trim() || "unknown"])
  );

  const rows: DiagnosticRow[] = [];
  for (const signal of signalsToScan) {
    if (!observationsByStudent.has(signal.studentId)) {
      observationsByStudent.set(
        signal.studentId,
        await listTrainingPeaksTelegramContextObservationsForStudent(signal.studentId, 250)
      );
    }
    const observations = observationsByStudent.get(signal.studentId) ?? [];
    const openedDate = resolveSignalOpenTime(signal).slice(0, 10);
    if (!workoutsByStudent.has(signal.studentId)) {
      workoutsByStudent.set(
        signal.studentId,
        await listTrainingPeaksWorkoutCacheForStudentDateRange({
          studentId: signal.studentId,
          from: openedDate,
          to: options.asOfDate,
        })
      );
    }
    const workouts = workoutsByStudent.get(signal.studentId) ?? [];
    const { lifecycleInput, proposal } = evaluateLifecycleFromEvidence({
      signal,
      asOfDate: options.asOfDate,
      workouts,
      observations,
    });
    const recoveryMatches = findRecoveryObservations({
      signal,
      observations,
      asOfDate: options.asOfDate,
      days: options.days,
    });
    const bestRecovery = recoveryMatches[0] ?? null;
    const coachApprovalGap = findCoachApprovalGap({
      recoveryMatches,
      observations,
    });
    const hasTpCompletion = Boolean(lifecycleInput.latestTpCompletionAfterOpen);
    const { action, reason } = resolveProposedAction({
      signal,
      recoveryMatch: bestRecovery,
      coachApprovalGap,
      hasTpCompletion,
      lifecycleProposal: proposal.proposedLifecycle,
      lifecycleHasExplicitRecovery: Boolean(lifecycleInput.explicitRecoveryMessage),
    });
    const displayRecovery = coachApprovalGap ?? bestRecovery;
    const evidenceKind: DiagnosticRow["evidence_kind"] = displayRecovery
      ? displayRecovery.evidenceKind
      : hasTpCompletion
        ? "tp_only_completion"
        : "none";

    rows.push({
      student: studentNameById.get(signal.studentId) ?? "unknown",
      signal_id: signal.id,
      current_display: resolveCurrentDisplay(signal),
      lifecycle_state: getSignalLifecycle(signal),
      signal_age: toDaysBetween(signal.createdAt, `${options.asOfDate}T23:59:59.999Z`),
      newer_recovery_obs: Boolean(displayRecovery),
      obs_id: displayRecovery?.observation.id ?? null,
      obs_time: displayRecovery?.observation.observedAt ?? null,
      obs_text_short: shortenText(displayRecovery?.observation.textPreview ?? null),
      classifier_result: displayRecovery?.classifierResult ?? null,
      recovery_pattern_matched: displayRecovery?.recoveryPatternMatched ?? false,
      evidence_kind: evidenceKind,
      proposed_action: action,
      confidence: displayRecovery?.confidence ?? "none",
      reason,
      section: resolveSection({
        proposedAction: action,
        recoveryMatch: displayRecovery,
        hasTpCompletion,
      }),
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ as_of: options.asOfDate, rows }, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} as_of=${options.asOfDate} days=${options.days} limit=${options.limit}`);
  printTable(rows);
  printGroupedSections(rows);
  printSummary(rows);
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-recovery-trigger-gaps.ts")) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} FAIL`);
    console.error(message);
    process.exitCode = 1;
  });
}

export {
  classifyObservation,
  findRecoveryObservations,
  isActiveHealthSignal,
  resolveProposedAction,
  type DiagnosticRow,
  type ProposedAction,
};
