import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  TrainingPeaksWorkoutCacheScanStatus,
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as workoutActivityClassification from "../../../src/features/trainingpeaks/workout-activity-classification.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";
import type { TrainingPeaksWorkoutActivityFamily } from "../../../src/features/trainingpeaks/workout-activity-classification.ts";

const classifyTrainingPeaksWorkoutActivity = (
  workoutActivityClassification as {
    classifyTrainingPeaksWorkoutActivity?: unknown;
    default?: { classifyTrainingPeaksWorkoutActivity?: unknown };
  }
).classifyTrainingPeaksWorkoutActivity ??
  (
    workoutActivityClassification as {
      classifyTrainingPeaksWorkoutActivity?: unknown;
      default?: { classifyTrainingPeaksWorkoutActivity?: unknown };
    }
  ).default?.classifyTrainingPeaksWorkoutActivity;

if (typeof classifyTrainingPeaksWorkoutActivity !== "function") {
  throw new Error("Failed to load classifyTrainingPeaksWorkoutActivity helper.");
}

type CliArgs = {
  from: string;
  to: string;
  student: string | null;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  listTrainingPeaksWorkoutCacheForDateRange?: (input: {
    from: string;
    to: string;
    studentId?: string;
  }) => Promise<TrainingPeaksWorkoutCacheRow[]>;
  getTrainingPeaksWorkoutCacheFreshness?: (input?: {
    date?: string;
  }) => Promise<{ latestScannedAt: string | null; rowCount: number }>;
  listTrainingPeaksWorkoutCacheScanStatusesForRange?: (input: {
    from: string;
    to: string;
  }) => Promise<TrainingPeaksWorkoutCacheScanStatus[]>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    listTrainingPeaksWorkoutCacheForDateRange?: (input: {
      from: string;
      to: string;
      studentId?: string;
    }) => Promise<TrainingPeaksWorkoutCacheRow[]>;
    getTrainingPeaksWorkoutCacheFreshness?: (input?: {
      date?: string;
    }) => Promise<{ latestScannedAt: string | null; rowCount: number }>;
    listTrainingPeaksWorkoutCacheScanStatusesForRange?: (input: {
      from: string;
      to: string;
    }) => Promise<TrainingPeaksWorkoutCacheScanStatus[]>;
  };
};

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];
  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseArgs(argv: string[]): CliArgs {
  let date: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  let student: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--student=")) {
      const raw = arg.slice("--student=".length).trim();
      student = raw || null;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (date && (from || to)) {
    throw new Error("Use either --date=YYYY-MM-DD or --from=YYYY-MM-DD --to=YYYY-MM-DD, not both.");
  }

  if (date) {
    if (!isIsoDate(date)) {
      throw new Error(`Invalid --date value: "${date}". Expected YYYY-MM-DD.`);
    }
    return { from: date, to: date, student };
  }

  if (!from || !to) {
    throw new Error("Provide --date=YYYY-MM-DD or both --from=YYYY-MM-DD and --to=YYYY-MM-DD.");
  }
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error(`Invalid date range (${from}..${to}). Expected YYYY-MM-DD.`);
  }
  if (from > to) {
    throw new Error(`Invalid date range: --from (${from}) is after --to (${to}).`);
  }

  return { from, to, student };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveStudentId(input: { students: TrainingPeaksStudent[]; studentNeedle: string | null }): string | null {
  const { students, studentNeedle } = input;
  if (!studentNeedle) {
    return null;
  }
  const needle = normalizeName(studentNeedle);
  const matched = students.filter((student) => {
    const byName = normalizeName(student.studentName) === needle;
    const byStudentId = student.studentId.trim().toLowerCase() === needle;
    const byId = student.id.trim().toLowerCase() === needle;
    return byName || byStudentId || byId;
  });

  if (matched.length === 0) {
    throw new Error(`No active student matched --student="${studentNeedle}".`);
  }
  if (matched.length > 1) {
    const sample = matched.slice(0, 5).map((student) => `${student.studentName} (${student.studentId})`);
    throw new Error(`Multiple active students matched --student="${studentNeedle}": ${sample.join(", ")}`);
  }
  return matched[0]!.id;
}

function formatMonthName(month: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[month - 1] ?? "???";
}

function formatWorkoutDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }
  const day = Number(match[3]);
  const month = Number(match[2]);
  return `${day} ${formatMonthName(month)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatFamilyLabel(family: TrainingPeaksWorkoutActivityFamily): string {
  switch (family) {
    case "walk_hike":
      return "walk/hike";
    case "day_off":
      return "day off";
    case "run":
      return "run";
    case "strength":
      return "strength";
    case "bike":
      return "bike";
    case "swim":
      return "swim";
    case "paddle":
      return "paddle";
    case "row":
      return "row";
    case "ski":
      return "ski";
    case "crosstrain":
      return "crosstrain";
    case "other":
      return "other";
    case "unknown":
      return "unknown";
    default:
      return "unknown";
  }
}

function printReport(input: {
  from: string;
  to: string;
  rows: TrainingPeaksWorkoutCacheRow[];
  scanStatuses: TrainingPeaksWorkoutCacheScanStatus[];
  globalFreshness: { latestScannedAt: string | null; rowCount: number };
}): void {
  const { from, to, rows, scanStatuses, globalFreshness } = input;
  const label = from === to ? from : `${from}..${to}`;
  const latestScannedAtInResult = rows.reduce<string | null>((latest, row) => {
    if (!latest || row.scannedAt > latest) {
      return row.scannedAt;
    }
    return latest;
  }, null);

  console.log("Workout cache report");
  console.log(`Range: ${label}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Latest scan: ${formatDateTime(latestScannedAtInResult)}`);
  console.log("");

  const scannedStudentsCount = scanStatuses.length;
  const okCount = scanStatuses.filter((row) => row.status === "ok").length;
  const failedCount = scanStatuses.filter((row) => row.status === "failed").length;
  const skippedCount = scanStatuses.filter((row) => row.status === "skipped").length;
  const latestScannedAtFromStatus = scanStatuses.reduce<string | null>((latest, row) => {
    if (!latest || row.scannedAt > latest) {
      return row.scannedAt;
    }
    return latest;
  }, null);
  const failedOrSkipped = scanStatuses.filter((row) => row.status === "failed" || row.status === "skipped");

  console.log("Scan status");
  console.log(`Scanned students: ${scannedStudentsCount}`);
  console.log(`OK: ${okCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Latest scanned_at: ${formatDateTime(latestScannedAtFromStatus)}`);
  if (failedOrSkipped.length > 0) {
    console.log("Failed/skipped students:");
    for (const row of failedOrSkipped) {
      const message = row.errorMessage?.trim();
      const athleteLabel = row.trainingPeaksAthleteId ?? "n/a";
      const suffix = message ? ` (${message})` : "";
      console.log(`- ${row.studentName} [athlete=${athleteLabel}]: ${row.status}${suffix}`);
    }
  }
  console.log("");

  if (rows.length === 0) {
    console.log("No cached workout rows found for this filter.");
    console.log("");
    console.log("Global freshness");
    console.log(`Latest scan: ${formatDateTime(globalFreshness.latestScannedAt)}`);
    console.log(`Row count: ${globalFreshness.rowCount}`);
    return;
  }

  const rowsByStudent = new Map<string, TrainingPeaksWorkoutCacheRow[]>();
  for (const row of rows) {
    const key = `${row.studentId}::${row.studentName}`;
    const current = rowsByStudent.get(key) ?? [];
    current.push(row);
    rowsByStudent.set(key, current);
  }

  const studentKeys = Array.from(rowsByStudent.keys()).sort((a, b) => {
    const aName = a.split("::")[1] ?? "";
    const bName = b.split("::")[1] ?? "";
    return aName.localeCompare(bName);
  });

  for (const studentKey of studentKeys) {
    const studentRows = rowsByStudent.get(studentKey) ?? [];
    const [, studentName] = studentKey.split("::");
    const classifiedRows = studentRows.map((row) => ({
      row,
      classification: classifyTrainingPeaksWorkoutActivity({
        title: row.title,
        sportOrTypeCode: row.sportOrTypeCode,
        workoutTypeValueId: row.workoutTypeValueId,
        workoutSubTypeId: row.workoutSubTypeId,
        sourceSnapshot: row.sourceSnapshot,
      }),
    }));

    const plannedCount = classifiedRows.filter((entry) => entry.row.isPlanned).length;
    const completedCount = classifiedRows.filter((entry) => entry.row.isCompleted).length;
    const plannedButNotCompleted = classifiedRows.filter(
      (entry) => entry.row.isPlanned && !entry.row.isCompleted
    );
    const completedWithoutPlanCount = classifiedRows.filter(
      (entry) => !entry.row.isPlanned && entry.row.isCompleted
    ).length;

    const runningPlannedCount = classifiedRows.filter(
      (entry) => entry.row.isPlanned && entry.classification.isRunning
    ).length;
    const runningCompletedCount = classifiedRows.filter(
      (entry) => entry.row.isCompleted && entry.classification.isRunning
    ).length;
    const runningPlannedButNotCompleted = classifiedRows.filter(
      (entry) => entry.row.isPlanned && entry.classification.isRunning && !entry.row.isCompleted
    );

    const nonRunningCompleted = classifiedRows.filter(
      (entry) => entry.row.isCompleted && !entry.classification.isRunning
    );
    const strengthCompletedCount = nonRunningCompleted.filter(
      (entry) => entry.classification.family === "strength"
    ).length;
    const paddleCompletedCount = nonRunningCompleted.filter(
      (entry) => entry.classification.family === "paddle"
    ).length;
    const unknownCompletedCount = nonRunningCompleted.filter(
      (entry) => entry.classification.family === "unknown"
    ).length;
    const otherCompletedCount = nonRunningCompleted.filter(
      (entry) =>
        entry.classification.family !== "strength" &&
        entry.classification.family !== "paddle" &&
        entry.classification.family !== "unknown"
    ).length;
    const warningsCount = studentRows.reduce((acc, row) => acc + row.normalizationWarnings.length, 0);

    console.log(studentName);
    console.log("All activities");
    console.log(`- planned: ${plannedCount}`);
    console.log(`- completed: ${completedCount}`);
    console.log(`- planned but not completed: ${plannedButNotCompleted.length}`);
    console.log(`- completed without plan: ${completedWithoutPlanCount}`);
    console.log("Running");
    console.log(`- running planned: ${runningPlannedCount}`);
    console.log(`- running completed: ${runningCompletedCount}`);
    console.log(`- running planned but not completed: ${runningPlannedButNotCompleted.length}`);
    console.log("Other completed");
    console.log(`- strength completed: ${strengthCompletedCount}`);
    console.log(`- paddle completed: ${paddleCompletedCount}`);
    console.log(`- other completed: ${otherCompletedCount}`);
    console.log(`- unknown completed: ${unknownCompletedCount}`);
    console.log(`- warnings: ${warningsCount}`);
    console.log("");

    if (runningPlannedButNotCompleted.length > 0) {
      console.log("Running planned but not completed");
      for (const entry of runningPlannedButNotCompleted) {
        const title = entry.row.title?.trim() ? entry.row.title.trim() : "(no title)";
        console.log(`- ${formatWorkoutDate(entry.row.workoutDate)} - ${title}`);
      }
      console.log("");
    }

    if (nonRunningCompleted.length > 0) {
      console.log("Other completed");
      for (const entry of nonRunningCompleted) {
        const title = entry.row.title?.trim() ? entry.row.title.trim() : "(no title)";
        const familyLabel = formatFamilyLabel(entry.classification.family);
        console.log(`- ${formatWorkoutDate(entry.row.workoutDate)} - ${title} - ${familyLabel}`);
      }
      console.log("");
    }
  }

  console.log("Global freshness");
  console.log(`Latest scan: ${formatDateTime(globalFreshness.latestScannedAt)}`);
  console.log(`Row count: ${globalFreshness.rowCount}`);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listRangeFn =
    repoCompat.listTrainingPeaksWorkoutCacheForDateRange ??
    repoCompat.default?.listTrainingPeaksWorkoutCacheForDateRange;
  const freshnessFn =
    repoCompat.getTrainingPeaksWorkoutCacheFreshness ??
    repoCompat.default?.getTrainingPeaksWorkoutCacheFreshness;
  const listScanStatusesFn =
    repoCompat.listTrainingPeaksWorkoutCacheScanStatusesForRange ??
    repoCompat.default?.listTrainingPeaksWorkoutCacheScanStatusesForRange;

  if (!listStudentsFn || !listRangeFn || !freshnessFn || !listScanStatusesFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const studentId = resolveStudentId({ students, studentNeedle: args.student });

  const [rows, scanStatuses, globalFreshness] = await Promise.all([
    listRangeFn({
      from: args.from,
      to: args.to,
      studentId: studentId ?? undefined,
    }),
    listScanStatusesFn({
      from: args.from,
      to: args.to,
    }),
    freshnessFn(),
  ]);

  const filteredScanStatuses = studentId
    ? scanStatuses.filter((status) => status.studentId === studentId)
    : scanStatuses;

  printReport({
    from: args.from,
    to: args.to,
    rows,
    scanStatuses: filteredScanStatuses,
    globalFreshness,
  });
}

main().catch((error: unknown) => {
  console.error("tp-workouts-cache-report failed.");
  console.error(error);
  process.exit(1);
});
