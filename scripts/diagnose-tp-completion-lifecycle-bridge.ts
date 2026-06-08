import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { getSignalMetadataString } from "@/features/trainingpeaks/operational-schedule-display";
import { resolveBridgeRecommendedAction } from "@/features/trainingpeaks/tp-completion-lifecycle-bridge";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  countCleanRunningCompletionsAfterOpen,
  evaluateLifecycleFromEvidence,
  getSignalLifecycle,
  resolveSignalOpenTime,
} from "./lib/operational-signal-lifecycle-runtime";
import { isActiveHealthSignal } from "./diagnose-recovery-trigger-gaps";

const LOG_PREFIX = "[diagnose-tp-completion-lifecycle-bridge]";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 400;
const DEFAULT_AS_OF = "2026-06-08";
const DUPLICATE_WINDOW_DAYS = 10;

type CliOptions = {
  student: string | null;
  asOfDate: string;
  limit: number;
  json: boolean;
};

type BridgeRow = {
  student: string;
  signal_id: string;
  current_display: string;
  lifecycle_state: string;
  signal_type: string;
  opened_at: string;
  latest_tp_completion: string | null;
  sport_class: string | null;
  running_completion_class: string | null;
  negative_after_completion: string;
  proposed_lifecycle: string;
  recommended_action: string;
  confidence: string;
  reason: string;
  apply_dry_run_command: string | null;
  duplicate_cluster_size: number;
  clean_running_completion_count: number;
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

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveCurrentDisplay(signal: TrainingPeaksStudentOperationalSignal): string {
  const payload = signal.structuredPayload ?? {};
  return (
    normalizeRecordString(payload.display_summary) ??
    normalizeRecordString(payload.latest_summary) ??
    getSignalMetadataString(signal.metadata, "summary") ??
    signal.signalType
  );
}

function resolveDuplicateClusterKey(signal: TrainingPeaksStudentOperationalSignal): string {
  const payload = signal.structuredPayload ?? {};
  const metadata = signal.metadata ?? {};
  const episodeKey =
    normalizeRecordString(metadata.episode_key) ?? normalizeRecordString(payload.episode_key);
  if (episodeKey) {
    return `${signal.studentId}:${episodeKey}`;
  }
  const signalType = signal.signalType;
  const healthKind = normalizeRecordString(payload.health_issue_kind) ?? "";
  return `${signal.studentId}:${signalType}:${healthKind}`;
}

function countDuplicateCluster(
  signal: TrainingPeaksStudentOperationalSignal,
  allSignals: TrainingPeaksStudentOperationalSignal[]
): number {
  const key = resolveDuplicateClusterKey(signal);
  const openedMs = Date.parse(resolveSignalOpenTime(signal));
  return allSignals.filter((candidate) => {
    if (candidate.studentId !== signal.studentId) {
      return false;
    }
    if (resolveDuplicateClusterKey(candidate) !== key) {
      return false;
    }
    const candidateOpenedMs = Date.parse(resolveSignalOpenTime(candidate));
    if (!Number.isFinite(openedMs) || !Number.isFinite(candidateOpenedMs)) {
      return true;
    }
    const days = Math.abs(candidateOpenedMs - openedMs) / (24 * 60 * 60 * 1000);
    return days <= DUPLICATE_WINDOW_DAYS;
  }).length;
}

function printTable(rows: BridgeRow[]): void {
  const header = [
    "student",
    "signal_id",
    "current_display",
    "lifecycle_state",
    "signal_type",
    "opened_at",
    "latest_tp_completion",
    "sport_class",
    "running_completion_class",
    "negative_after_completion",
    "proposed_lifecycle",
    "recommended_action",
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
        row.signal_type,
        row.opened_at,
        row.latest_tp_completion ?? "none",
        row.sport_class ?? "none",
        row.running_completion_class ?? "none",
        row.negative_after_completion,
        row.proposed_lifecycle,
        row.recommended_action,
        row.confidence,
        row.reason.replace(/\s+/gu, " ").trim(),
      ].join("\t")
    );
  }
}

function printApplyCommands(rows: BridgeRow[]): void {
  const applyRows = rows.filter((row) => row.recommended_action === "apply_monitoring_after_return");
  if (applyRows.length === 0) {
    return;
  }
  console.log("");
  console.log("=== SAFE APPLY CANDIDATES (dry-run first) ===");
  for (const row of applyRows) {
    console.log(`# ${row.student} ${row.signal_id}`);
    console.log(row.apply_dry_run_command ?? "");
    console.log("");
  }
}

function printSummary(rows: BridgeRow[]): void {
  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`active_health_signals_scanned: ${rows.length}`);
  for (const action of [
    "apply_monitoring_after_return",
    "resolved_candidate",
    "coach_close_candidate",
    "manual_review",
    "pending_tp_cache",
    "blocked_by_negative",
    "fix_tp_workout_classification",
    "non_tp_lifecycle_apply_gap",
    "keep_active",
    "no_action",
  ]) {
    const count = rows.filter((row) => row.recommended_action === action).length;
    if (count > 0) {
      console.log(`${action}: ${count}`);
    }
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

  const rows: BridgeRow[] = [];
  for (const signal of signalsToScan) {
    if (!observationsByStudent.has(signal.studentId)) {
      observationsByStudent.set(
        signal.studentId,
        await listTrainingPeaksTelegramContextObservationsForStudent(signal.studentId, 250)
      );
    }
    const observations = observationsByStudent.get(signal.studentId) ?? [];
    const openedAt = resolveSignalOpenTime(signal);
    const openedDate = openedAt.slice(0, 10);
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
    const completion = lifecycleInput.latestTpCompletionAfterOpen;
    const duplicateClusterSize = countDuplicateCluster(signal, healthSignals);
    const cleanRunningCompletionCount = countCleanRunningCompletionsAfterOpen({
      workouts,
      openedDate,
      asOfDate: options.asOfDate,
    });
    const bridge = resolveBridgeRecommendedAction({
      signalId: signal.id,
      signalType: signal.signalType,
      signalClass: lifecycleInput.signalClass,
      currentLifecycle: lifecycleInput.currentLifecycle,
      lifecycleInput,
      proposal,
      asOfDate: options.asOfDate,
      duplicateClusterSize,
      cleanRunningCompletionCount,
    });

    rows.push({
      student: studentNameById.get(signal.studentId) ?? "unknown",
      signal_id: signal.id,
      current_display: resolveCurrentDisplay(signal),
      lifecycle_state: getSignalLifecycle(signal),
      signal_type: signal.signalType,
      opened_at: openedAt,
      latest_tp_completion: completion
        ? `${completion.workoutDate} #${completion.workoutId} ${completion.title ?? ""}`.trim()
        : null,
      sport_class: completion?.sportClass ?? null,
      running_completion_class: completion?.runningCompletionClass ?? null,
      negative_after_completion: lifecycleInput.negativeMessageAfterCompletion ? "yes" : "no",
      proposed_lifecycle: proposal.proposedLifecycle,
      recommended_action: bridge.recommendedAction,
      confidence: proposal.confidence,
      reason: bridge.reason,
      apply_dry_run_command: bridge.applyDryRunCommand,
      duplicate_cluster_size: duplicateClusterSize,
      clean_running_completion_count: cleanRunningCompletionCount,
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ as_of: options.asOfDate, rows }, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} as_of=${options.asOfDate} limit=${options.limit}`);
  printTable(rows);
  printApplyCommands(rows);
  printSummary(rows);
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-tp-completion-lifecycle-bridge.ts")) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} FAIL`);
    console.error(message);
    process.exitCode = 1;
  });
}
