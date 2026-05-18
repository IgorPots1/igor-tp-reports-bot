import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import type {
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheUpsertRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest } from "./lib/trainingpeaks-api-move.ts";
import {
  normalizeTrainingPeaksWorkoutItems,
  type TrainingPeaksWorkoutRaw,
} from "./lib/trainingpeaks-workout-normalization.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";

type CliArgs = {
  from: string;
  to: string;
  athleteId: number | null;
  athleteUrl: string | null;
  student: string | null;
  headed: boolean;
};

type ResolvedTarget = {
  student: TrainingPeaksStudent;
  athleteId: number;
  athleteUrl: string;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  upsertTrainingPeaksWorkoutCacheRows?: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    upsertTrainingPeaksWorkoutCacheRows?: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
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

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseOptionalIsoDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: "",
    to: "",
    athleteId: null,
    athleteUrl: null,
    student: null,
    headed: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      const athleteId = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(athleteId) || athleteId <= 0) {
        throw new Error(`Invalid --athlete-id value: ${arg}`);
      }
      parsed.athleteId = athleteId;
      continue;
    }
    if (arg.startsWith("--athlete-url=")) {
      const athleteUrl = arg.slice("--athlete-url=".length).trim();
      if (!athleteUrl) {
        throw new Error("Empty --athlete-url value.");
      }
      parsed.athleteUrl = athleteUrl;
      continue;
    }
    if (arg.startsWith("--student=")) {
      const student = arg.slice("--student=".length).trim();
      parsed.student = student || null;
      continue;
    }
    if (arg === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headed = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!isIsoDate(parsed.from)) {
    throw new Error(`Missing or invalid --from date: "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!isIsoDate(parsed.to)) {
    throw new Error(`Missing or invalid --to date: "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid date range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }

  if (!parsed.athleteId && !parsed.athleteUrl && !parsed.student) {
    throw new Error("Provide one identity input: --athlete-id, --athlete-url, or --student.");
  }

  return parsed;
}

function resolveTargetStudent(input: { args: CliArgs; students: TrainingPeaksStudent[] }): ResolvedTarget {
  const { args, students } = input;
  const studentNeedle = args.student?.trim().toLowerCase() ?? null;
  const athleteIdFromUrl = args.athleteUrl ? parseAthleteIdFromUrl(args.athleteUrl) : null;
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl;
  const normalizedAthleteUrl = args.athleteUrl ? normalizeUrl(args.athleteUrl) : null;

  const matched = students.filter((student) => {
    if (!student.isActive) return false;
    if (studentNeedle) {
      const idMatch = student.id.toLowerCase() === studentNeedle;
      const studentIdMatch = student.studentId.toLowerCase() === studentNeedle;
      const nameMatch = student.studentName.toLowerCase() === studentNeedle;
      if (!idMatch && !studentIdMatch && !nameMatch) {
        return false;
      }
    }

    const studentAthleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
    if (resolvedAthleteId && studentAthleteId !== resolvedAthleteId) {
      if (!normalizedAthleteUrl) return false;
      if (normalizeUrl(student.trainingPeaksAthleteUrl) !== normalizedAthleteUrl) {
        return false;
      }
    }

    if (normalizedAthleteUrl && normalizeUrl(student.trainingPeaksAthleteUrl) !== normalizedAthleteUrl) {
      if (!resolvedAthleteId || studentAthleteId !== resolvedAthleteId) {
        return false;
      }
    }

    return true;
  });

  if (matched.length === 0) {
    const identityParts = [
      args.student ? `student=${args.student}` : null,
      args.athleteId ? `athleteId=${args.athleteId}` : null,
      args.athleteUrl ? `athleteUrl=${args.athleteUrl}` : null,
    ].filter(Boolean);
    throw new Error(
      `No active TrainingPeaks student matched (${identityParts.join(", ")}). Refusing to write orphan rows.`,
    );
  }
  if (matched.length > 1) {
    const sample = matched.slice(0, 5).map((student) => `${student.studentName} (${student.studentId})`);
    throw new Error(`Multiple active students matched. Please narrow input. Matches: ${sample.join(", ")}`);
  }

  const student = matched[0]!;
  const athleteId = resolvedAthleteId ?? parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
  if (!athleteId) {
    throw new Error(
      `Matched student "${student.studentName}" has no parseable athlete id in URL: ${student.trainingPeaksAthleteUrl}`,
    );
  }

  const athleteUrl = args.athleteUrl ?? `${APP_HOST}/#calendar/athletes/${athleteId}`;
  return { student, athleteId, athleteUrl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildCompactSourceSnapshot(raw: TrainingPeaksWorkoutRaw): Record<string, unknown> {
  return {
    rawTitle: raw.title ?? null,
    rawWorkoutDay: raw.workoutDay ?? null,
    rawCode: raw.code ?? null,
    rawWorkoutTypeValueId: raw.workoutTypeValueId ?? null,
    rawWorkoutSubTypeId: raw.workoutSubTypeId ?? null,
    rawTotalTimePlanned: raw.totalTimePlanned ?? null,
    rawTotalTime: raw.totalTime ?? null,
    rawDistancePlanned: raw.distancePlanned ?? null,
    rawDistance: raw.distance ?? null,
    rawComplianceDurationPercent: raw.complianceDurationPercent ?? null,
    rawComplianceDistancePercent: raw.complianceDistancePercent ?? null,
    rawCompleted: raw.completed ?? null,
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const upsertCacheFn =
    repoCompat.upsertTrainingPeaksWorkoutCacheRows ?? repoCompat.default?.upsertTrainingPeaksWorkoutCacheRows;

  if (!listStudentsFn || !upsertCacheFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const resolved = resolveTargetStudent({ args, students });

  const endpoint = `${TP_API_HOST}/fitness/v6/athletes/${resolved.athleteId}/workouts/${args.from}/${args.to}`;
  const scannedAt = new Date().toISOString();

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });

  let writeSucceeded = false;
  try {
    const page = context.pages()[0] ?? (await context.newPage());

    let auth;
    try {
      auth = await captureSessionAuth({
        context,
        page,
        athleteId: resolved.athleteId,
      });
    } catch (error) {
      throw new Error(`Failed to capture TrainingPeaks auth/session: ${(error as Error).message}`);
    }

    if (!auth.sampleRequestUrl && !auth.authorizationHeader) {
      throw new Error("Failed to capture TrainingPeaks auth/session (no API session context observed).");
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
    };
    if (auth.authorizationHeader) {
      headers.authorization = auth.authorizationHeader;
    }
    if (typeof auth.sampleHeaders.referer === "string" && auth.sampleHeaders.referer.trim()) {
      headers.referer = auth.sampleHeaders.referer;
    }
    if (typeof auth.sampleHeaders.origin === "string" && auth.sampleHeaders.origin.trim()) {
      headers.origin = auth.sampleHeaders.origin;
    }

    const result = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint,
      headers,
    });

    if (result.status !== 200) {
      throw new Error(`TrainingPeaks workouts GET failed: status=${result.status}, ok=${result.ok}`);
    }
    if (!Array.isArray(result.body)) {
      throw new Error("TrainingPeaks workouts GET returned non-array JSON body.");
    }

    const rawItems = result.body.filter((item): item is TrainingPeaksWorkoutRaw => isRecord(item));
    const normalizedItems = normalizeTrainingPeaksWorkoutItems({
      athleteId: resolved.athleteId,
      rawItems,
    });
    const filteredItems = normalizedItems.filter(
      (item) => item.workoutDate >= args.from && item.workoutDate <= args.to,
    );

    const rawByWorkoutId = new Map<number, TrainingPeaksWorkoutRaw>();
    for (const rawItem of rawItems) {
      const workoutId = readPositiveInt(rawItem.workoutId);
      if (workoutId && !rawByWorkoutId.has(workoutId)) {
        rawByWorkoutId.set(workoutId, rawItem);
      }
    }

    const rows: TrainingPeaksWorkoutCacheUpsertRow[] = filteredItems.map((item) => {
      const rawItem = rawByWorkoutId.get(item.trainingPeaksWorkoutId);
      return {
        student_id: resolved.student.id,
        student_name: resolved.student.studentName,
        trainingpeaks_athlete_id: item.trainingPeaksAthleteId,
        trainingpeaks_workout_id: item.trainingPeaksWorkoutId,
        workout_date: item.workoutDate,
        title: item.title,
        sport_or_type_code: item.sportOrTypeCode,
        workout_type_value_id: item.workoutTypeValueId,
        workout_sub_type_id: item.workoutSubTypeId,
        is_planned: item.isPlanned,
        is_completed: item.isCompleted,
        planned_time_raw: item.plannedTimeRaw,
        completed_time_raw: item.completedTimeRaw,
        planned_distance_raw: item.plannedDistanceRaw,
        completed_distance_raw: item.completedDistanceRaw,
        compliance_duration_percent: item.complianceDurationPercent,
        compliance_distance_percent: item.complianceDistancePercent,
        start_time_planned: item.startTimePlanned,
        start_time: item.startTime,
        source_updated_at: parseOptionalIsoDateTime(item.lastModifiedDate),
        order_on_day: item.orderOnDay,
        scanned_at: scannedAt,
        normalization_warnings: item.normalizationWarnings,
        source_snapshot: rawItem ? buildCompactSourceSnapshot(rawItem) : {},
      };
    });

    try {
      await upsertCacheFn(rows);
      writeSucceeded = true;
    } catch (error) {
      throw new Error(
        `Failed writing to trainingpeaks_workout_cache (is migration applied?): ${(error as Error).message}`,
      );
    }

    const plannedCount = filteredItems.filter((item) => item.isPlanned).length;
    const completedCount = filteredItems.filter((item) => item.isCompleted).length;
    const plannedButNotCompletedCount = filteredItems.filter((item) => item.isPlanned && !item.isCompleted).length;
    const warningsCount = filteredItems.reduce((acc, item) => acc + item.normalizationWarnings.length, 0);

    console.log("[tp-workouts-cache-scan] Summary");
    console.log(`athlete_id: ${resolved.athleteId}`);
    console.log(`student_name: ${resolved.student.studentName}`);
    console.log(`date_range: ${args.from} -> ${args.to}`);
    console.log(`raw_items_returned: ${result.body.length}`);
    console.log(`normalized_items: ${normalizedItems.length}`);
    console.log(`filtered_in_range_items: ${filteredItems.length}`);
    console.log(`upserted_rows: ${rows.length}`);
    console.log(`planned_count: ${plannedCount}`);
    console.log(`completed_count: ${completedCount}`);
    console.log(`planned_but_not_completed_count: ${plannedButNotCompletedCount}`);
    console.log(`warnings_count: ${warningsCount}`);
    console.log(`table_write_succeeded: ${writeSucceeded ? "yes" : "no"}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-workouts-cache-scan failed.");
  console.error(error);
  process.exit(1);
});
