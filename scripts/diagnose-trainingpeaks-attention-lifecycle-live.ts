import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { formatTrainingPeaksAttentionSnapshotMessage } from "@/features/trainingpeaks/attention-telegram";
import {
  DEFAULT_COACH_TIMEZONE,
  normalizeOperationalSignalFollowUp,
} from "@/features/trainingpeaks/operational-follow-up";
import { getSignalMetadataString } from "@/features/trainingpeaks/operational-schedule-display";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  collectOperationalHealthFollowUpsFromSignals,
  collectOperationalScheduleSignalsForAttentionFromSignals,
  type TrainingPeaksAttentionSnapshot,
} from "@/features/trainingpeaks/service";
import { getSignalLifecycle } from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[diagnose-trainingpeaks-attention-lifecycle-live]";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_AS_OF = "2026-06-05";

const HEALTH_SIGNAL_TYPES = new Set([
  "health_issue_started",
  "health_issue_improving",
  "pause_training",
  "pain_injury",
  "resume_training",
]);

const SCHEDULE_SIGNAL_TYPES = new Set([
  "schedule_unavailability_window",
  "schedule_availability_window",
  "plan_generation_constraint",
]);

type CliOptions = {
  limit: number;
  student: string | null;
  asOfDate: string;
  json: boolean;
};

type LifecycleState =
  | "active_problem"
  | "return_planned"
  | "return_trial_completed"
  | "monitoring_after_return"
  | "ready_for_coach_close"
  | "stale_needs_review"
  | "resolved";

type AttentionSectionDecision = "included" | "omitted" | "not_applicable";

type SignalDiagnosticRow = {
  signalId: string;
  studentId: string;
  studentName: string;
  signalType: string;
  lifecycleState: LifecycleState;
  requiresCoachClose: boolean;
  visibleInTpSignals: boolean | null;
  superseded: boolean;
  followUpState: string;
  followUpDueDate: string | null;
  checkToday: AttentionSectionDecision;
  planToday: AttentionSectionDecision;
  reason: string;
  renderedReason: string | null;
};

type StudentAttentionDiagnostic = {
  studentId: string;
  studentName: string;
  signalRows: SignalDiagnosticRow[];
  followUpItems: Array<{ signalId: string; reason: string }>;
  planItems: Array<{ signalId: string; reason: string }>;
  appearsInAttentionPreview: boolean;
  attentionPreview: string;
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

function getSignalMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const value = metadata[key];
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

function resolveEffectiveVisibleInTpSignals(signal: TrainingPeaksStudentOperationalSignal): boolean | null {
  return (
    normalizeRecordBoolean(signal.structuredPayload.visible_in_tp_signals) ??
    getSignalMetadataBoolean(signal.metadata, "visible_in_tp_signals")
  );
}

function isSignalSuperseded(signal: TrainingPeaksStudentOperationalSignal): boolean {
  const supersededBySignalId =
    getSignalMetadataString(signal.metadata, "superseded_by_signal_id") ??
    normalizeRecordString(signal.structuredPayload.superseded_by_signal_id) ??
    normalizeRecordString(signal.lifecycleMeta.superseded_by_signal_id);
  return Boolean(supersededBySignalId);
}

function isSignalMarkedStaleNeedsReview(signal: TrainingPeaksStudentOperationalSignal): boolean {
  const metadata = signal.metadata;
  const payload = signal.structuredPayload;
  const lifecycleMeta = signal.lifecycleMeta;
  const markerCandidates = [
    getSignalMetadataString(metadata, "lifecycle_effective"),
    getSignalMetadataString(metadata, "proposed_action"),
    normalizeRecordString(payload.lifecycle_effective),
    normalizeRecordString(payload.proposed_action),
    normalizeRecordString(lifecycleMeta.lifecycle_effective),
    normalizeRecordString(lifecycleMeta.proposed_action),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  if (markerCandidates.includes("stale_needs_review") || markerCandidates.includes("stale")) {
    return true;
  }
  return (
    getSignalMetadataBoolean(metadata, "stale_needs_review") === true ||
    normalizeRecordBoolean(payload.stale_needs_review) === true ||
    normalizeRecordBoolean(lifecycleMeta.stale_needs_review) === true
  );
}

function resolveDisplayLifecycleState(signal: TrainingPeaksStudentOperationalSignal): LifecycleState {
  if (signal.lifecycleState === "resolved") {
    return "resolved";
  }
  if (isSignalMarkedStaleNeedsReview(signal)) {
    return "stale_needs_review";
  }
  if (signal.lifecycleState === "monitoring_after_return") {
    if (signal.requiresCoachClose) {
      return "ready_for_coach_close";
    }
    return "monitoring_after_return";
  }
  if (signal.lifecycleState === "active_problem") {
    return "active_problem";
  }
  return null;
}

function resolveEffectiveSignalType(signal: TrainingPeaksStudentOperationalSignal): string {
  return (
    normalizeRecordString(signal.structuredPayload.signal_type) ??
    getSignalMetadataString(signal.metadata, "signal_type") ??
    signal.signalType
  );
}

function diagnoseHealthFollowUp(
  signal: TrainingPeaksStudentOperationalSignal,
  asOfDate: string
): { decision: AttentionSectionDecision; reason: string } {
  if (!HEALTH_SIGNAL_TYPES.has(signal.signalType)) {
    return { decision: "not_applicable", reason: "not a health signal type" };
  }
  if (signal.lifecycleState === "resolved") {
    return { decision: "omitted", reason: "resolved" };
  }
  if (isSignalSuperseded(signal)) {
    return { decision: "omitted", reason: "superseded" };
  }
  if (resolveEffectiveVisibleInTpSignals(signal) === false) {
    return { decision: "omitted", reason: "hidden" };
  }
  const followUp = normalizeOperationalSignalFollowUp(signal.metadata, {
    asOfDate,
    timeZone: DEFAULT_COACH_TIMEZONE,
  });
  if (followUp.state === "none") {
    return { decision: "omitted", reason: "no due follow-up" };
  }
  if (followUp.state === "resolved_or_non_pending") {
    return { decision: "omitted", reason: "follow-up not pending" };
  }
  if (followUp.state === "pending_future") {
    return { decision: "omitted", reason: "follow-up not due yet" };
  }
  if (followUp.state === "pending_due") {
    const displayState = resolveDisplayLifecycleState(signal);
    if (displayState === "monitoring_after_return") {
      return { decision: "included", reason: "monitoring + due follow-up" };
    }
    if (displayState === "ready_for_coach_close") {
      return { decision: "included", reason: "requiresCoachClose + due follow-up" };
    }
    if (displayState === "stale_needs_review") {
      return { decision: "included", reason: "stale_needs_review + due follow-up" };
    }
    return { decision: "included", reason: "active follow-up due today" };
  }
  if (followUp.state === "pending_overdue") {
    const displayState = resolveDisplayLifecycleState(signal);
    if (displayState === "ready_for_coach_close") {
      return { decision: "included", reason: "requiresCoachClose + overdue follow-up" };
    }
    if (displayState === "monitoring_after_return") {
      return { decision: "included", reason: "monitoring + overdue follow-up" };
    }
    if (displayState === "stale_needs_review") {
      return { decision: "included", reason: "stale_needs_review + overdue follow-up" };
    }
    return { decision: "included", reason: "active follow-up overdue" };
  }
  return { decision: "omitted", reason: "follow-up state not attention-worthy" };
}

function diagnosePlanConstraint(
  signal: TrainingPeaksStudentOperationalSignal,
  asOfDate: string
): { decision: AttentionSectionDecision; reason: string } {
  if (!SCHEDULE_SIGNAL_TYPES.has(signal.signalType)) {
    return { decision: "not_applicable", reason: "not a schedule/plan signal type" };
  }
  if (signal.validUntil && signal.validUntil < asOfDate) {
    return { decision: "omitted", reason: "expired valid_until" };
  }
  if (signal.lifecycleState === "resolved") {
    return { decision: "omitted", reason: "resolved" };
  }
  if (isSignalSuperseded(signal)) {
    return { decision: "omitted", reason: "superseded" };
  }
  if (resolveEffectiveVisibleInTpSignals(signal) === false) {
    return { decision: "omitted", reason: "hidden" };
  }
  const effectiveSignalType = resolveEffectiveSignalType(signal);
  if (effectiveSignalType === "external_training_context") {
    return { decision: "omitted", reason: "external strength context" };
  }
  return { decision: "included", reason: "active non-expired schedule/plan constraint" };
}

function buildAttentionPreview(input: {
  followUps: ReturnType<typeof collectOperationalHealthFollowUpsFromSignals>;
  planConstraints: ReturnType<typeof collectOperationalScheduleSignalsForAttentionFromSignals>;
}): string {
  const snapshot: TrainingPeaksAttentionSnapshot = {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    checkTodaySignals: [],
    painDiscomfort: [],
    missedWorkouts: [],
    noContact5Days: [],
    followUpToday: input.followUps.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_follow_up",
    })),
    followUpOverflowCount: input.followUps.overflowCount,
    planConstraintsToday: input.planConstraints.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_schedule",
    })),
    planConstraintsOverflowCount: input.planConstraints.overflowCount,
    movesToday: [],
    movesOverflowCount: 0,
  };
  return formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Утренний обзор (live dry-run)");
}

async function buildDiagnostics(options: CliOptions): Promise<StudentAttentionDiagnostic[]> {
  const students = await listTrainingPeaksStudents();
  const studentById = new Map(students.map((student) => [student.id, student]));
  const signalResult = await listTrainingPeaksOperationalSignals({
    status: "active",
    studentQuery: options.student ?? undefined,
    limit: options.limit,
    offset: 0,
  });

  const activeStudentNameById = new Map<string, string | null>(
    students.map((student) => [student.id, student.studentName])
  );

  const followUps = collectOperationalHealthFollowUpsFromSignals({
    signals: signalResult.items,
    activeStudentNameById,
    asOfDate: options.asOfDate,
    maxItems: 50,
  });
  const planConstraints = collectOperationalScheduleSignalsForAttentionFromSignals({
    signals: signalResult.items,
    activeStudentNameById,
    asOfDate: options.asOfDate,
    maxItems: 50,
  });
  const fullAttentionPreview = buildAttentionPreview({ followUps, planConstraints });

  const followUpBySignalId = new Map(followUps.items.map((item) => [item.signalId, item.reason]));
  const planBySignalId = new Map(planConstraints.items.map((item) => [item.signalId, item.reason]));

  const signalsByStudent = new Map<string, TrainingPeaksStudentOperationalSignal[]>();
  for (const signal of signalResult.items) {
    const student = studentById.get(signal.studentId);
    if (!student) {
      continue;
    }
    if (options.student) {
      const query = options.student.toLowerCase();
      const haystack = `${student.studentName} ${student.studentId} ${student.id}`.toLowerCase();
      if (!haystack.includes(query)) {
        continue;
      }
    }
    const group = signalsByStudent.get(signal.studentId) ?? [];
    group.push(signal);
    signalsByStudent.set(signal.studentId, group);
  }

  const diagnostics: StudentAttentionDiagnostic[] = [];
  for (const [studentId, signals] of signalsByStudent) {
    const student = studentById.get(studentId);
    if (!student) {
      continue;
    }

    const signalRows: SignalDiagnosticRow[] = signals.map((signal) => {
      const followUp = normalizeOperationalSignalFollowUp(signal.metadata, {
        asOfDate: options.asOfDate,
        timeZone: DEFAULT_COACH_TIMEZONE,
      });
      const healthDecision = diagnoseHealthFollowUp(signal, options.asOfDate);
      const planDecision = diagnosePlanConstraint(signal, options.asOfDate);
      const renderedReason =
        followUpBySignalId.get(signal.id) ?? planBySignalId.get(signal.id) ?? null;

      return {
        signalId: signal.id,
        studentId,
        studentName: student.studentName,
        signalType: signal.signalType,
        lifecycleState: getSignalLifecycle(signal),
        requiresCoachClose: signal.requiresCoachClose,
        visibleInTpSignals: resolveEffectiveVisibleInTpSignals(signal),
        superseded: isSignalSuperseded(signal),
        followUpState: followUp.state,
        followUpDueDate: followUp.due_date,
        checkToday: healthDecision.decision,
        planToday: planDecision.decision,
        reason:
          healthDecision.decision === "included"
            ? healthDecision.reason
            : planDecision.decision === "included"
              ? planDecision.reason
              : healthDecision.decision === "omitted"
                ? healthDecision.reason
                : planDecision.decision === "omitted"
                  ? planDecision.reason
                  : healthDecision.reason,
        renderedReason,
      };
    });

    const studentFollowUps = followUps.items
      .filter((item) => item.studentId === studentId)
      .map((item) => ({ signalId: item.signalId, reason: item.reason }));
    const studentPlanItems = planConstraints.items
      .filter((item) => item.studentId === studentId)
      .map((item) => ({ signalId: item.signalId, reason: item.reason }));

    const studentPreview = buildAttentionPreview({
      followUps: {
        items: followUps.items.filter((item) => item.studentId === studentId),
        overflowCount: 0,
      },
      planConstraints: {
        items: planConstraints.items.filter((item) => item.studentId === studentId),
        overflowCount: 0,
      },
    });

    diagnostics.push({
      studentId,
      studentName: student.studentName,
      signalRows,
      followUpItems: studentFollowUps,
      planItems: studentPlanItems,
      appearsInAttentionPreview:
        studentPreview.includes(student.studentName) || fullAttentionPreview.includes(student.studentName),
      attentionPreview: studentPreview,
    });
  }

  diagnostics.sort((left, right) => left.studentName.localeCompare(right.studentName, "ru-RU"));
  return diagnostics;
}

function printDiagnostics(options: CliOptions, diagnostics: StudentAttentionDiagnostic[]): void {
  console.log(`${LOG_PREFIX} as_of=${options.asOfDate} students=${diagnostics.length}`);
  for (const student of diagnostics) {
    console.log("");
    console.log(`=== ${student.studentName} (${student.studentId}) ===`);
    console.log(`appears_in_tp_attention: ${student.appearsInAttentionPreview ? "yes" : "no"}`);
    console.log(`active_operational_signals: ${student.signalRows.length}`);
    for (const row of student.signalRows) {
      console.log("");
      console.log(`signal_id: ${row.signalId}`);
      console.log(`signal_type: ${row.signalType}`);
      console.log(`lifecycle_state: ${row.lifecycleState}`);
      console.log(`requiresCoachClose: ${row.requiresCoachClose ? "true" : "false"}`);
      console.log(`visible_in_tp_signals: ${row.visibleInTpSignals === null ? "unset" : String(row.visibleInTpSignals)}`);
      console.log(`superseded: ${row.superseded ? "yes" : "no"}`);
      console.log(`follow_up_state: ${row.followUpState}`);
      console.log(`follow_up_due_date: ${row.followUpDueDate ?? "—"}`);
      console.log(`check_today: ${row.checkToday}`);
      console.log(`plan_today: ${row.planToday}`);
      console.log(`reason: ${row.reason}`);
      console.log(`rendered_reason: ${row.renderedReason ?? "—"}`);
    }
    console.log("");
    console.log("follow_up_items:");
    if (student.followUpItems.length === 0) {
      console.log("  (none)");
    } else {
      for (const item of student.followUpItems) {
        console.log(`  - ${item.signalId}: ${item.reason}`);
      }
    }
    console.log("plan_items:");
    if (student.planItems.length === 0) {
      console.log("  (none)");
    } else {
      for (const item of student.planItems) {
        console.log(`  - ${item.signalId}: ${item.reason}`);
      }
    }
    console.log("");
    console.log("attention_preview:");
    console.log(student.attentionPreview);
  }
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const diagnostics = await buildDiagnostics(options);
  if (options.student && diagnostics.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no active signals match --student "${options.student}"`);
  }
  if (options.json) {
    console.log(JSON.stringify({ asOfDate: options.asOfDate, diagnostics }, null, 2));
    return;
  }
  printDiagnostics(options, diagnostics);
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-trainingpeaks-attention-lifecycle-live.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exitCode = 1;
  });
}
