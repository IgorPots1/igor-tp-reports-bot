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
  buildOperationalSignalLifecycleApplyToken,
  buildOperationalSignalLifecycleDryRunFingerprint,
  collectOperationalSignalLifecycleReasonCodes,
} from "@/features/trainingpeaks/operational-signal-lifecycle-apply";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
} from "@/features/trainingpeaks/repository";
import {
  buildLifecycleInputFromEvidence,
} from "./lib/operational-signal-lifecycle-runtime";

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
  signal_id: string;
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
  dry_run_fingerprint: string;
  apply_token: string;
  apply_command: string;
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

function normalizeMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
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
    const lifecycleInput: OperationalSignalLifecycleInput = buildLifecycleInputFromEvidence({
      signal,
      asOfDate: options.asOfDate,
      workouts,
      observations,
    });
    const completion = lifecycleInput.latestTpCompletionAfterOpen;
    const negativeAfterCompletion = lifecycleInput.negativeMessageAfterCompletion;
    const missedSkipped = Boolean(lifecycleInput.missedOrSkippedReturnWorkout);
    const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
    const reasonCodes = collectOperationalSignalLifecycleReasonCodes({
      proposal,
      lifecycleInput,
    });
    const dryRunFingerprint = buildOperationalSignalLifecycleDryRunFingerprint({
      signalId: signal.id,
      signalType: signal.signalType,
      signalClass: lifecycleInput.signalClass,
      currentLifecycle: lifecycleInput.currentLifecycle,
      proposedLifecycle: proposal.proposedLifecycle,
      latestTpCompletionAfterOpen: completion
        ? {
            workoutId: completion.workoutId,
            workoutDate: completion.workoutDate,
            title: completion.title ?? null,
            sportOrTypeCode: completion.sportOrTypeCode ?? null,
            runningCompletionClass: completion.runningCompletionClass,
            sportClass: completion.sportClass,
            evidenceFreshness: completion.evidenceFreshness,
            classificationConfidence: completion.classificationConfidence,
          }
        : null,
      hasNegativeAfterCompletion: Boolean(negativeAfterCompletion),
      missedOrSkippedReturnWorkout: missedSkipped,
      reasonCodes,
      asOfDate: options.asOfDate,
    });
    const applyToken = buildOperationalSignalLifecycleApplyToken({
      signalId: signal.id,
      proposedLifecycle: proposal.proposedLifecycle,
      dryRunFingerprint,
    });
    const applyCommand = `npm run apply-operational-signal-lifecycle -- --signal-id ${signal.id} --as-of ${options.asOfDate} --apply --confirm "${applyToken}"`;
    const workoutEvidenceSummary = completion
      ? `sport=${completion.sportClass}; running=${completion.runningCompletionClass}; confidence=${completion.classificationConfidence}`
      : null;
    const classificationReasonCodes = completion ? completion.classificationReasonCodes.join(",") : null;
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
      classification_reason_codes: classificationReasonCodes,
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
      signal_id: signal.id,
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
      dry_run_fingerprint: dryRunFingerprint,
      apply_token: applyToken,
      apply_command: applyCommand,
    });
  }
  return rows.slice(0, options.limit);
}

function printTable(rows: DiagnosticRow[]): void {
  const header = [
    "signal_id",
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
    "dry_run_fingerprint",
    "apply_token",
    "apply_command",
  ];
  console.log(header.join("\t"));
  for (const row of rows) {
    console.log(
      [
        row.episode_key ?? "",
        row.signal_id,
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
        row.dry_run_fingerprint,
        row.apply_token,
        row.apply_command,
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
