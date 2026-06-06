import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  evaluateOperationalSignalLifecycle,
  type OperationalSignalClass,
  type OperationalSignalLifecycle,
  type OperationalSignalLifecycleInput,
} from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  buildLifecycleInputFromEvidence,
  classifySignal,
  getSignalLifecycle,
} from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[diagnose-operational-signal-episodes]";
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 400;
const DEFAULT_AS_OF = "2026-06-05";
const DUPLICATE_WINDOW_DAYS = 10;
const STALE_WINDOW_DAYS = 10;

type CliOptions = {
  student: string | null;
  asOfDate: string;
  limit: number;
  json: boolean;
};

type EpisodeClass =
  | "confirmed_illness"
  | "ambiguous_illness"
  | "injury_pain"
  | "schedule_pause"
  | "external_training_context"
  | "return_to_training"
  | "coach_follow_up"
  | "resolved_context_memory";

type EffectiveLifecycleState =
  | OperationalSignalLifecycle
  | "reopened"
  | "stale_needs_review";

type ProposedAction =
  | "keep_active"
  | "demote_to_monitoring"
  | "ready_for_coach_close"
  | "stale_needs_review"
  | "possible_duplicate_superseded"
  | "resolve_to_memory";

type EpisodeDiagnosticRow = {
  student: string;
  student_slug: string;
  signal_id: string;
  episode_group: string;
  signal_type: string;
  episode_class: EpisodeClass;
  lifecycle_current: OperationalSignalLifecycle;
  lifecycle_effective: EffectiveLifecycleState;
  lifecycle_proposed: OperationalSignalLifecycle;
  opened_at: string;
  latest_raw_evidence: string;
  proposed_action: ProposedAction;
  remain_in_tp_signals: boolean;
  memory_history_only: boolean;
  duplicate_cluster_size: number;
  requires_coach_close: boolean;
  reason: string;
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

function toDaysBetween(leftIso: string, rightIso: string): number {
  const left = Date.parse(leftIso);
  const right = Date.parse(rightIso);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.floor(Math.abs(right - left) / (24 * 60 * 60 * 1000));
}

function resolveEpisodeClass(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  signalClass: OperationalSignalClass;
}): EpisodeClass {
  const signalType = input.signal.signalType;
  const metadata = input.signal.metadata ?? {};
  const hasPendingFollowUp = String(metadata.follow_up_status ?? "").toLowerCase() === "pending";
  const lifecycleState = input.signal.lifecycleState;

  if (lifecycleState === "resolved") {
    return "resolved_context_memory";
  }
  if (signalType === "external_training_context") {
    return "external_training_context";
  }
  if (signalType === "resume_training" || signalType === "health_issue_resolved") {
    return "return_to_training";
  }
  if (hasPendingFollowUp) {
    return "coach_follow_up";
  }
  if (
    signalType === "schedule_availability_window" ||
    signalType === "schedule_unavailability_window" ||
    signalType === "plan_generation_constraint"
  ) {
    return "schedule_pause";
  }
  if (input.signalClass === "injury_pain") {
    return "injury_pain";
  }
  if (input.signalClass === "confirmed_illness") {
    return "confirmed_illness";
  }
  if (input.signalClass === "ambiguous_illness") {
    return "ambiguous_illness";
  }
  if (input.signalClass === "schedule_pause") {
    return "schedule_pause";
  }
  return "coach_follow_up";
}

function buildFallbackEpisodeGroupKey(
  signal: TrainingPeaksStudentOperationalSignal,
  episodeClass: EpisodeClass
): string {
  const opened = signal.createdAt.slice(0, 10);
  return `${signal.studentId}:${episodeClass}:${opened}`;
}

function getEpisodeGroupKey(signal: TrainingPeaksStudentOperationalSignal, episodeClass: EpisodeClass): string {
  const metadata = signal.metadata ?? {};
  const payload = signal.structuredPayload ?? {};
  const fromMeta = typeof metadata.episode_key === "string" ? metadata.episode_key.trim() : "";
  const fromPayload = typeof payload.episode_key === "string" ? payload.episode_key.trim() : "";
  if (fromMeta) {
    return `${signal.studentId}:meta:${fromMeta}`;
  }
  if (fromPayload) {
    return `${signal.studentId}:payload:${fromPayload}`;
  }
  return buildFallbackEpisodeGroupKey(signal, episodeClass);
}

function resolveLatestRawEvidence(input: {
  lifecycleInput: OperationalSignalLifecycleInput;
  latestObservationText: string | null;
}): string {
  const completion = input.lifecycleInput.latestTpCompletionAfterOpen;
  if (input.lifecycleInput.negativeMessageAfterCompletion) {
    return `negative_after_return:${input.lifecycleInput.negativeMessageAfterCompletion.reason}`;
  }
  if (input.lifecycleInput.explicitRecoveryMessage) {
    return `explicit_recovery:${input.lifecycleInput.explicitRecoveryMessage.reason}`;
  }
  if (completion) {
    return `tp_completion:${completion.workoutDate}:${completion.sportClass}:${completion.runningCompletionClass}`;
  }
  if (input.latestObservationText) {
    return `telegram:${input.latestObservationText}`;
  }
  return "none";
}

function resolveEffectiveLifecycle(input: {
  current: OperationalSignalLifecycle;
  proposal: ReturnType<typeof evaluateOperationalSignalLifecycle>;
  stale: boolean;
}): EffectiveLifecycleState {
  if (input.stale) {
    return "stale_needs_review";
  }
  if (input.current === "resolved") {
    return "resolved";
  }
  if (input.current !== "active_problem" && input.proposal.proposedLifecycle === "active_problem") {
    return "reopened";
  }
  return input.current;
}

function buildDuplicateClusters(signals: TrainingPeaksStudentOperationalSignal[]): Map<string, number> {
  const rows = [...signals].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const counts = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const base = rows[index]!;
    let count = 1;
    for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
      const next = rows[nextIndex]!;
      if (next.studentId !== base.studentId || next.signalType !== base.signalType) {
        continue;
      }
      if (toDaysBetween(base.createdAt, next.createdAt) > DUPLICATE_WINDOW_DAYS) {
        continue;
      }
      count += 1;
    }
    counts.set(base.id, count);
  }
  return counts;
}

function resolveProposedAction(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  episodeClass: EpisodeClass;
  lifecycleCurrent: OperationalSignalLifecycle;
  lifecycleEffective: EffectiveLifecycleState;
  proposal: ReturnType<typeof evaluateOperationalSignalLifecycle>;
  duplicateCount: number;
}): ProposedAction {
  if (input.duplicateCount > 1 && input.proposal.proposedLifecycle !== "active_problem") {
    return "possible_duplicate_superseded";
  }
  if (input.lifecycleEffective === "stale_needs_review") {
    return "stale_needs_review";
  }
  if (
    input.proposal.proposedLifecycle === "monitoring_after_return" &&
    input.proposal.requiresCoachClose &&
    input.lifecycleCurrent === "monitoring_after_return"
  ) {
    return "ready_for_coach_close";
  }
  if (input.proposal.proposedLifecycle === "monitoring_after_return") {
    return "demote_to_monitoring";
  }
  if (input.proposal.proposedLifecycle === "resolved" || input.episodeClass === "resolved_context_memory") {
    return "resolve_to_memory";
  }
  return "keep_active";
}

function shouldRemainInTpSignals(action: ProposedAction, lifecycleEffective: EffectiveLifecycleState): boolean {
  if (lifecycleEffective === "resolved") {
    return false;
  }
  if (action === "resolve_to_memory" || action === "possible_duplicate_superseded") {
    return false;
  }
  return true;
}

function shouldBeMemoryHistoryOnly(input: {
  action: ProposedAction;
  episodeClass: EpisodeClass;
  remainInTpSignals: boolean;
}): boolean {
  if (!input.remainInTpSignals) {
    return true;
  }
  if (input.action === "resolve_to_memory") {
    return true;
  }
  return input.episodeClass === "external_training_context" || input.episodeClass === "resolved_context_memory";
}

function printTable(rows: EpisodeDiagnosticRow[]): void {
  const header = [
    "student",
    "student_slug",
    "signal_id",
    "episode_group",
    "signal_type",
    "episode_class",
    "lifecycle_current",
    "lifecycle_effective",
    "lifecycle_proposed",
    "opened_at",
    "latest_raw_evidence",
    "proposed_action",
    "remain_in_tp_signals",
    "memory_history_only",
    "duplicate_cluster_size",
    "requires_coach_close",
    "reason",
  ];
  console.log(header.join("\t"));
  for (const row of rows) {
    console.log(
      [
        row.student,
        row.student_slug,
        row.signal_id,
        row.episode_group,
        row.signal_type,
        row.episode_class,
        row.lifecycle_current,
        row.lifecycle_effective,
        row.lifecycle_proposed,
        row.opened_at,
        row.latest_raw_evidence,
        row.proposed_action,
        row.remain_in_tp_signals ? "yes" : "no",
        row.memory_history_only ? "yes" : "no",
        String(row.duplicate_cluster_size),
        row.requires_coach_close ? "yes" : "no",
        row.reason.replace(/\s+/gu, " ").trim(),
      ].join("\t")
    );
  }
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

  const rows: EpisodeDiagnosticRow[] = [];
  for (const student of studentsFiltered) {
    if (rows.length >= options.limit) {
      break;
    }
    const signalResult = await listTrainingPeaksOperationalSignals({
      status: "active",
      studentQuery: student.studentName,
      limit: 200,
    });
    const studentSignals = signalResult.items.filter((signal) => signal.studentId === student.id);
    if (studentSignals.length === 0) {
      continue;
    }
    const observations = await listTrainingPeaksTelegramContextObservationsForStudent(student.id, 250);
    const duplicateMap = buildDuplicateClusters(studentSignals);
    for (const signal of studentSignals) {
      if (rows.length >= options.limit) {
        break;
      }
      const openedDate = signal.createdAt.slice(0, 10);
      const workouts = await listTrainingPeaksWorkoutCacheForStudentDateRange({
        studentId: signal.studentId,
        from: openedDate,
        to: options.asOfDate,
      });
      const lifecycleInput = buildLifecycleInputFromEvidence({
        signal,
        asOfDate: options.asOfDate,
        workouts,
        observations,
      });
      const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
      const signalClass = classifySignal(signal);
      const episodeClass = resolveEpisodeClass({
        signal,
        signalClass,
      });
      const lifecycleCurrent = getSignalLifecycle(signal);
      const latestObservation = observations.find((item) => item.observedAt >= signal.createdAt);
      const evidence = resolveLatestRawEvidence({
        lifecycleInput,
        latestObservationText: latestObservation?.textPreview ?? null,
      });
      const stale =
        lifecycleCurrent !== "resolved" &&
        toDaysBetween(signal.createdAt, `${options.asOfDate}T23:59:59.000Z`) > STALE_WINDOW_DAYS &&
        !lifecycleInput.latestTpCompletionAfterOpen &&
        !lifecycleInput.explicitRecoveryMessage &&
        !lifecycleInput.negativeMessageAfterCompletion;
      const lifecycleEffective = resolveEffectiveLifecycle({
        current: lifecycleCurrent,
        proposal,
        stale,
      });
      const duplicateCount = duplicateMap.get(signal.id) ?? 1;
      const proposedAction = resolveProposedAction({
        signal,
        episodeClass,
        lifecycleCurrent,
        lifecycleEffective,
        proposal,
        duplicateCount,
      });
      const remainInTpSignals = shouldRemainInTpSignals(proposedAction, lifecycleEffective);
      const memoryHistoryOnly = shouldBeMemoryHistoryOnly({
        action: proposedAction,
        episodeClass,
        remainInTpSignals,
      });
      rows.push({
        student: student.studentName,
        student_slug: student.studentId,
        signal_id: signal.id,
        episode_group: getEpisodeGroupKey(signal, episodeClass),
        signal_type: signal.signalType,
        episode_class: episodeClass,
        lifecycle_current: lifecycleCurrent,
        lifecycle_effective: lifecycleEffective,
        lifecycle_proposed: proposal.proposedLifecycle,
        opened_at: signal.createdAt,
        latest_raw_evidence: evidence,
        proposed_action: proposedAction,
        remain_in_tp_signals: remainInTpSignals,
        memory_history_only: memoryHistoryOnly,
        duplicate_cluster_size: duplicateCount,
        requires_coach_close: Boolean(proposal.requiresCoachClose),
        reason: proposal.reason,
      });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          as_of: options.asOfDate,
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  printTable(rows);
  console.log(`${LOG_PREFIX} rows=${rows.length} as_of=${options.asOfDate}`);
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-operational-signal-episodes.ts")) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
    process.exit(1);
  });
}
