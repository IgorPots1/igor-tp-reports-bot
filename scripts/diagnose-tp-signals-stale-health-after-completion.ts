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

const LOG_PREFIX = "[diagnose-tp-signals-stale-health-after-completion]";

type CliOptions = {
  students: string[];
  days: number;
  json: boolean;
};

type AthleteReport = {
  student_name: string;
  student_id: string;
  active_health_signal_id: string;
  lifecycle_state: string;
  signal_opened: string;
  signal_updated: string;
  display_summary: string;
  observations_after_signal_open: {
    id: string;
    observed_at: string;
    text_preview: string;
  }[];
  completed_tp_workouts_after_signal_open: {
    workout_id: string;
    workout_date: string;
    title: string | null;
    sport_class: string | null;
    running_completion_class: string | null;
  }[];
  bridge_recommendation: string;
  bridge_reason: string;
  confidence: string;
  blocker_reason: string | null;
  recommended_next_step: string;
  apply_dry_run_command: string | null;
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

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    students: [],
    days: 30,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--student=")) {
      const value = arg.slice("--student=".length).trim();
      if (value) {
        options.students.push(value);
      }
      continue;
    }
    if (arg.startsWith("--athletes=")) {
      const value = arg.slice("--athletes=".length).trim();
      if (value) {
        options.students.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
      }
      continue;
    }
    if (arg === "--athletes") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --athletes`);
      }
      options.students.push(...next.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.students.push(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--days=")) {
      const parsed = Number(arg.slice("--days=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.days = Math.floor(parsed);
      }
      continue;
    }
    if (arg === "--days") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --days`);
      }
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.days = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
  }
  return options;
}

function normalizeMatch(input: string): string {
  const lower = input.toLowerCase().replace(/\s+/gu, " ").trim();
  const transliterated = transliterateCyrillicForMatch(lower);
  return transliterated && transliterated !== lower
    ? `${lower} ${transliterated}`.replace(/\s+/gu, " ").trim()
    : lower;
}

function transliterateCyrillicForMatch(input: string): string {
  const table: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ы: "y",
    э: "e",
    ю: "yu",
    я: "ya",
    ь: "",
    ъ: "",
  };
  return input.replace(/[а-яё]/gu, (char) => table[char] ?? char);
}

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveDisplaySummary(signal: TrainingPeaksStudentOperationalSignal): string {
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
  return `${signal.studentId}:${signal.signalType}`;
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
    return days <= 10;
  }).length;
}

function resolveNextStep(recommendedAction: string): string {
  switch (recommendedAction) {
    case "apply_monitoring_after_return":
      return "guarded apply (monitoring_after_return)";
    case "resolved_candidate":
      return "guarded apply (resolved)";
    case "coach_close_candidate":
      return "manual review (coach close)";
    case "manual_review":
      return "manual review";
    case "pending_tp_cache":
      return "wait for TP cache update";
    case "blocked_by_negative":
      return "keep active (negative message after completion)";
    case "fix_tp_workout_classification":
      return "classification fix needed";
    case "non_tp_lifecycle_apply_gap":
      return "manual review (no TP evidence but lifecycle gap)";
    case "keep_active":
      return "keep active (no evidence of recovery yet)";
    default:
      return `no action (${recommendedAction})`;
  }
}

function resolveBlockerReason(recommendedAction: string, reason: string): string | null {
  if (recommendedAction === "apply_monitoring_after_return" || recommendedAction === "resolved_candidate") {
    return null;
  }
  return reason || null;
}

function getAsOfDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getFromDate(asOfDate: string, days: number): string {
  const d = new Date(`${asOfDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function printAthleteReport(report: AthleteReport): void {
  console.log("");
  console.log(`━━━ ${report.student_name} ━━━`);
  console.log(`  student_id: ${report.student_id}`);
  console.log(`  active_health_signal: ${report.active_health_signal_id}`);
  console.log(`  lifecycle_state: ${report.lifecycle_state}`);
  console.log(`  signal_opened: ${report.signal_opened}`);
  console.log(`  signal_updated: ${report.signal_updated}`);
  console.log(`  display_summary: ${report.display_summary}`);
  console.log("");
  console.log(`  observations_after_signal_open: ${report.observations_after_signal_open.length}`);
  for (const obs of report.observations_after_signal_open.slice(0, 5)) {
    console.log(`    - [${obs.observed_at}] ${obs.text_preview.slice(0, 100)}`);
  }
  if (report.observations_after_signal_open.length > 5) {
    console.log(`    ... +${report.observations_after_signal_open.length - 5} more`);
  }
  console.log("");
  console.log(`  completed_tp_workouts_after_signal_open: ${report.completed_tp_workouts_after_signal_open.length}`);
  for (const w of report.completed_tp_workouts_after_signal_open.slice(0, 5)) {
    const sport = w.sport_class ? ` [${w.sport_class}]` : "";
    const runClass = w.running_completion_class ? ` (${w.running_completion_class})` : "";
    console.log(`    - ${w.workout_date}: ${w.title ?? "untitled"}${sport}${runClass}`);
  }
  if (report.completed_tp_workouts_after_signal_open.length > 5) {
    console.log(`    ... +${report.completed_tp_workouts_after_signal_open.length - 5} more`);
  }
  console.log("");
  console.log(`  bridge_recommendation: ${report.bridge_recommendation}`);
  console.log(`  confidence: ${report.confidence}`);
  console.log(`  bridge_reason: ${report.bridge_reason}`);
  if (report.blocker_reason) {
    console.log(`  blocker_reason: ${report.blocker_reason}`);
  }
  console.log(`  recommended_next_step: ${report.recommended_next_step}`);
  if (report.apply_dry_run_command) {
    console.log(`  apply_dry_run_command: ${report.apply_dry_run_command}`);
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const asOfDate = getAsOfDate();
  const fromDate = getFromDate(asOfDate, options.days);

  if (options.students.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: at least one --student is required`);
  }

  const students = await listTrainingPeaksStudents();
  const studentQueries = options.students.map(normalizeMatch);

  const matchedStudents = students.filter((student) => {
    const haystack = normalizeMatch(`${student.studentName} ${student.studentId} ${student.id}`);
    return studentQueries.some((query) => haystack.includes(query));
  });

  if (matchedStudents.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no students matched any --student query`);
  }

  const reports: AthleteReport[] = [];

  for (const student of matchedStudents) {
    const signalResult = await listTrainingPeaksOperationalSignals({
      status: "active",
      studentQuery: student.studentName,
      limit: 200,
    });
    const healthSignals = signalResult.items.filter(
      (signal) => signal.studentId === student.id && isActiveHealthSignal(signal)
    );

    if (healthSignals.length === 0) {
      reports.push({
        student_name: student.studentName ?? "unknown",
        student_id: student.id,
        active_health_signal_id: "none",
        lifecycle_state: "no_active_signal",
        signal_opened: "n/a",
        signal_updated: "n/a",
        display_summary: "No active health signals found",
        observations_after_signal_open: [],
        completed_tp_workouts_after_signal_open: [],
        bridge_recommendation: "n/a",
        bridge_reason: "No active health signals",
        confidence: "n/a",
        blocker_reason: null,
        recommended_next_step: "signal already resolved or not present",
        apply_dry_run_command: null,
      });
      continue;
    }

    const observations = await listTrainingPeaksTelegramContextObservationsForStudent(student.id, 250);
    const workouts = await listTrainingPeaksWorkoutCacheForStudentDateRange({
      studentId: student.id,
      from: fromDate,
      to: asOfDate,
    });

    for (const signal of healthSignals) {
      const openedAt = resolveSignalOpenTime(signal);
      const openedDate = openedAt.slice(0, 10);
      const observationsAfterOpen = observations.filter(
        (obs) => obs.observedAt >= openedAt
      );
      const workoutsAfterOpen = workouts.filter(
        (w) => w.workoutDate >= openedDate && w.isCompleted
      );

      const { lifecycleInput, proposal } = evaluateLifecycleFromEvidence({
        signal,
        asOfDate,
        workouts,
        observations,
      });

      const duplicateClusterSize = countDuplicateCluster(signal, healthSignals);
      const cleanRunningCompletionCount = countCleanRunningCompletionsAfterOpen({
        workouts,
        openedDate,
        asOfDate,
      });

      const bridge = resolveBridgeRecommendedAction({
        signalId: signal.id,
        signalType: signal.signalType,
        signalClass: lifecycleInput.signalClass,
        currentLifecycle: lifecycleInput.currentLifecycle,
        lifecycleInput,
        proposal,
        asOfDate,
        duplicateClusterSize,
        cleanRunningCompletionCount,
      });

      reports.push({
        student_name: student.studentName ?? "unknown",
        student_id: student.id,
        active_health_signal_id: signal.id,
        lifecycle_state: getSignalLifecycle(signal),
        signal_opened: openedAt,
        signal_updated: signal.updatedAt ?? signal.createdAt,
        display_summary: resolveDisplaySummary(signal),
        observations_after_signal_open: observationsAfterOpen.slice(0, 10).map((obs) => ({
          id: obs.id,
          observed_at: obs.observedAt,
          text_preview: obs.textPreview ?? "",
        })),
        completed_tp_workouts_after_signal_open: workoutsAfterOpen.slice(0, 10).map((w) => ({
          workout_id: w.workoutId ?? w.id,
          workout_date: w.workoutDate,
          title: w.title ?? null,
          sport_class: w.sportClass ?? null,
          running_completion_class: w.runningCompletionClass ?? null,
        })),
        bridge_recommendation: bridge.recommendedAction,
        bridge_reason: bridge.reason,
        confidence: proposal.confidence,
        blocker_reason: resolveBlockerReason(bridge.recommendedAction, bridge.reason),
        recommended_next_step: resolveNextStep(bridge.recommendedAction),
        apply_dry_run_command: bridge.applyDryRunCommand,
      });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ as_of: asOfDate, from_date: fromDate, days: options.days, reports }, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} as_of=${asOfDate} from=${fromDate} days=${options.days}`);
  console.log(`Matched students: ${matchedStudents.map((s) => s.studentName).join(", ")}`);
  for (const report of reports) {
    printAthleteReport(report);
  }
  console.log("");
  console.log("━━━ SUMMARY ━━━");
  console.log(`Total signals scanned: ${reports.length}`);
  const actionCounts = new Map<string, number>();
  for (const report of reports) {
    const key = report.recommended_next_step;
    actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1);
  }
  for (const [action, count] of actionCounts) {
    console.log(`  ${action}: ${count}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-tp-signals-stale-health-after-completion.ts")) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} FAIL`);
    console.error(message);
    process.exitCode = 1;
  });
}
