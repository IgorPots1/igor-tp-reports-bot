import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import type { TrainingPeaksWorkoutCacheRow } from "../../../src/features/trainingpeaks/repository.ts";
import {
  buildRecentWorkoutDiagnosticSummary,
  defaultHistoryWindowBeforeWeekStart,
  diagnoseWorkoutRow,
  isCompletedRunningWorkout,
  type WorkoutDiagnosticRow,
} from "./lib/recent-workout-quality-diagnostic.ts";
import { toolRoot } from "./lib/paths.ts";

type CliArgs = {
  athleteId: number;
  studentId: string;
  from: string | null;
  to: string | null;
  weekStart: string | null;
  json: boolean;
};

type TrainingPeaksWorkoutCacheDbRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number;
  trainingpeaks_workout_id: number;
  workout_date: string;
  title: string | null;
  sport_or_type_code: string | null;
  workout_type_value_id: number | null;
  workout_sub_type_id: number | null;
  is_planned: boolean;
  is_completed: boolean;
  planned_time_raw: number | string | null;
  completed_time_raw: number | string | null;
  planned_distance_raw: number | string | null;
  completed_distance_raw: number | string | null;
  compliance_duration_percent: number | string | null;
  compliance_distance_percent: number | string | null;
  start_time_planned: string | null;
  start_time: string | null;
  source_updated_at: string | null;
  order_on_day: number | string | null;
  scanned_at: string;
  scan_job_id: string | null;
  normalization_warnings: string[] | null;
  source_snapshot: unknown;
  created_at: string;
  updated_at: string;
};

const DEFAULT_ATHLETE_ID = 5905779;
const DEFAULT_STUDENT_ID = "5f5d400d-6024-4ba4-b6ae-6bbe3a679862";
const DEFAULT_WEEK_START = "2026-06-08";

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) return;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
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
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")];
  for (const envPath of envPaths) loadDotEnvFile(envPath);
}

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function printHelp(): void {
  console.log("Anna Kruglova recent workout diagnostic (read-only)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-plan-anna-recent-workout-diagnostic.ts \\",
  );
  console.log("    --athlete-id 5905779 \\");
  console.log("    --student-id 5f5d400d-6024-4ba4-b6ae-6bbe3a679862 \\");
  console.log("    --from 2026-05-12 \\");
  console.log("    --to 2026-06-08");
  console.log("");
  console.log("Optional:");
  console.log("  --week-start 2026-06-08   # default history window ending on draft week start");
  console.log("  --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no TrainingPeaks mutations");
  console.log("  - no DB writes");
  console.log("  - no Telegram sends");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteId: DEFAULT_ATHLETE_ID,
    studentId: DEFAULT_STUDENT_ID,
    from: null,
    to: null,
    weekStart: DEFAULT_WEEK_START,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = Number(arg.slice("--athlete-id=".length));
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student-id=")) {
      parsed.studentId = arg.slice("--student-id=".length).trim();
      continue;
    }
    if (arg === "--student-id") {
      parsed.studentId = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim() || null;
      continue;
    }
    if (arg === "--from") {
      parsed.from = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim() || null;
      continue;
    }
    if (arg === "--to") {
      parsed.to = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--week-start=")) {
      parsed.weekStart = arg.slice("--week-start=".length).trim() || null;
      continue;
    }
    if (arg === "--week-start") {
      parsed.weekStart = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(parsed.athleteId) || parsed.athleteId <= 0) {
    throw new Error("Invalid --athlete-id. Expected positive integer.");
  }
  if (!parsed.studentId) {
    throw new Error("Missing --student-id.");
  }

  const hasExplicitRange = parsed.from !== null || parsed.to !== null;
  if (hasExplicitRange) {
    if (!parsed.from || !parsed.to) {
      throw new Error("Provide both --from and --to for explicit date range.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.from) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.to)) {
      throw new Error("Invalid --from/--to date format. Expected YYYY-MM-DD.");
    }
    if (parsed.from > parsed.to) {
      throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
    }
  } else {
    if (!parsed.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.weekStart)) {
      throw new Error("Invalid --week-start. Expected YYYY-MM-DD when --from/--to are omitted.");
    }
    const defaults = defaultHistoryWindowBeforeWeekStart(parsed.weekStart);
    parsed.from = defaults.from;
    parsed.to = defaults.to;
  }

  return parsed;
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local or .env.`);
  }
  return value;
}

function createSupabaseServerClient() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function mapWorkoutCacheDbRow(row: TrainingPeaksWorkoutCacheDbRow): TrainingPeaksWorkoutCacheRow {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    trainingPeaksWorkoutId: row.trainingpeaks_workout_id,
    workoutDate: row.workout_date,
    title: row.title,
    sportOrTypeCode: row.sport_or_type_code,
    workoutTypeValueId: row.workout_type_value_id,
    workoutSubTypeId: row.workout_sub_type_id,
    isPlanned: row.is_planned,
    isCompleted: row.is_completed,
    plannedTimeRaw: row.planned_time_raw,
    completedTimeRaw: row.completed_time_raw,
    plannedDistanceRaw: row.planned_distance_raw,
    completedDistanceRaw: row.completed_distance_raw,
    complianceDurationPercent: row.compliance_duration_percent,
    complianceDistancePercent: row.compliance_distance_percent,
    startTimePlanned: row.start_time_planned,
    startTime: row.start_time,
    sourceUpdatedAt: row.source_updated_at,
    orderOnDay: row.order_on_day,
    scannedAt: row.scanned_at,
    scanJobId: row.scan_job_id,
    normalizationWarnings: row.normalization_warnings ?? [],
    sourceSnapshot: row.source_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchWorkoutCacheRows(input: {
  studentId: string;
  athleteId: number;
  from: string;
  to: string;
}): Promise<{ rows: TrainingPeaksWorkoutCacheRow[]; latestScannedAt: string | null }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("*")
    .eq("student_id", input.studentId)
    .eq("trainingpeaks_athlete_id", input.athleteId)
    .gte("workout_date", input.from)
    .lte("workout_date", input.to)
    .order("workout_date", { ascending: true })
    .order("trainingpeaks_workout_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to read workout cache for student ${input.studentId} and range ${input.from}..${input.to}: ${error.message}`,
    );
  }

  const rows = ((data as TrainingPeaksWorkoutCacheDbRow[] | null) ?? []).map(mapWorkoutCacheDbRow);
  const latestScannedAt =
    rows.reduce<string | null>((latest, row) => {
      if (!latest || row.scannedAt > latest) return row.scannedAt;
      return latest;
    }, null) ?? null;

  return { rows, latestScannedAt };
}

function buildReadme(summary: ReturnType<typeof buildRecentWorkoutDiagnosticSummary>): string {
  const lines = [
    "# Anna Kruglova recent workout diagnostic",
    "",
    "Read-only diagnostic for recent completed running context before plan draft generation.",
    "",
    "## Window",
    "",
    `- from: ${summary.window.from}`,
    `- to: ${summary.window.to}`,
    `- target draft week: ${summary.window.target_draft_week_start ?? "n/a"} → ${summary.window.target_draft_week_end ?? "n/a"}`,
    "",
    "## Counts",
    "",
    `- cache rows in window: ${summary.cache.rows_total}`,
    `- completed running workouts: ${summary.recent_completed_running_count}`,
    `- quality-like workouts: ${summary.recent_quality_like_count}`,
    `- latest cache scan in window: ${summary.cache.latest_scanned_at ?? "unknown"}`,
    "",
    "## Last quality session",
    "",
    summary.last_quality_session_date
      ? `- date: ${summary.last_quality_session_date}`
      : "- date: none found",
    summary.last_quality_session_title
      ? `- title: ${summary.last_quality_session_title}`
      : "- title: n/a",
    summary.last_quality_session_estimated_type
      ? `- estimated type: ${summary.last_quality_session_estimated_type}`
      : "- estimated type: n/a",
    summary.last_quality_session_estimated_structure
      ? `- estimated structure: ${summary.last_quality_session_estimated_structure}`
      : "- estimated structure: n/a",
    "",
    "## 20 x 1 min candidate",
    "",
    `- found: ${summary.found_20x1min_candidate ? "yes" : "no"}`,
  ];

  if (summary.twenty_by_one_candidate.found) {
    lines.push(
      `- date: ${summary.twenty_by_one_candidate.date}`,
      `- title: ${summary.twenty_by_one_candidate.title}`,
      `- repeat_count: ${summary.twenty_by_one_candidate.repeat_count}`,
      `- work_duration: ${summary.twenty_by_one_candidate.work_duration}`,
      `- recovery_duration: ${summary.twenty_by_one_candidate.recovery_duration ?? "unknown"}`,
      `- quality_family: ${summary.twenty_by_one_candidate.quality_family ?? "unknown"}`,
    );
  }

  lines.push(
    "",
    "## Progression hint",
    "",
    summary.quality_progression_hint,
    "",
    "## Recommended next quality intent candidates",
    "",
    ...summary.recommended_next_quality_intent_candidates.map((candidate) => `- ${candidate}`),
    "",
    "## Next-step recommendation",
    "",
    summary.found_20x1min_candidate
      ? "Before changing the draft generator or writer, review the recent 20 x 1 min session and decide whether the next quality session should stay in short-interval family or deliberately move to controlled sub-threshold/tempo."
      : "No 20 x 1 min candidate was found in the window. Review listed quality sessions manually before assigning a generic controlled quality template.",
    "",
    "## Safety",
    "",
    "- read-only",
    "- no TrainingPeaks mutations",
    "- no DB writes",
    "- no Telegram sends",
    "",
  );

  return lines.join("\n");
}

async function writeReportArtifacts(input: {
  summary: ReturnType<typeof buildRecentWorkoutDiagnosticSummary>;
  workouts: WorkoutDiagnosticRow[];
}): Promise<string> {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const reportDir = path.join(
    repoRoot,
    "reports",
    "anna-recent-workout-diagnostic-v0",
    timestampForPath(new Date()),
  );
  await mkdir(reportDir, { recursive: true });

  const qualityCandidates = input.workouts.filter((workout) => workout.quality_like);

  await writeFile(path.join(reportDir, "summary.json"), `${JSON.stringify(input.summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(reportDir, "workouts.json"), `${JSON.stringify(input.workouts, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(reportDir, "quality_candidates.json"),
    `${JSON.stringify(qualityCandidates, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(reportDir, "README.md"), buildReadme(input.summary), "utf8");

  return reportDir;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  console.log("[tp-plan-anna-recent-workout-diagnostic] mode=read-only");
  console.log("[tp-plan-anna-recent-workout-diagnostic] no_db_writes=true");
  console.log("[tp-plan-anna-recent-workout-diagnostic] no_trainingpeaks_mutations=true");
  console.log("[tp-plan-anna-recent-workout-diagnostic] no_telegram_sends=true");

  const { rows, latestScannedAt } = await fetchWorkoutCacheRows({
    studentId: args.studentId,
    athleteId: args.athleteId,
    from: args.from!,
    to: args.to!,
  });

  const completedRunningRows = rows.filter(isCompletedRunningWorkout);
  const workouts = completedRunningRows.map(diagnoseWorkoutRow);
  const studentName = rows[0]?.studentName ?? completedRunningRows[0]?.studentName ?? null;

  const summary = buildRecentWorkoutDiagnosticSummary({
    athleteId: args.athleteId,
    studentId: args.studentId,
    studentName,
    from: args.from!,
    to: args.to!,
    targetDraftWeekStart: args.weekStart,
    rowsTotal: rows.length,
    latestScannedAt,
    workouts,
  });

  const reportDir = await writeReportArtifacts({ summary, workouts });

  console.log("");
  console.log("Anna Kruglova recent workout diagnostic");
  console.log(`- athlete_id: ${summary.athlete.athlete_id}`);
  console.log(`- student_id: ${summary.athlete.student_id}`);
  console.log(`- window: ${summary.window.from} .. ${summary.window.to}`);
  console.log(`- completed running workouts: ${summary.recent_completed_running_count}`);
  console.log(`- quality-like workouts: ${summary.recent_quality_like_count}`);
  console.log(
    `- last quality session: ${summary.last_quality_session_date ?? "none"} | ${summary.last_quality_session_title ?? "n/a"} | ${summary.last_quality_session_estimated_type ?? "n/a"}`,
  );
  console.log(`- found_20x1min_candidate: ${summary.found_20x1min_candidate ? "true" : "false"}`);
  console.log(`- quality_progression_hint: ${summary.quality_progression_hint}`);
  console.log(
    `- recommended_next_quality_intent_candidates: ${summary.recommended_next_quality_intent_candidates.join(", ")}`,
  );
  console.log(`- report_dir: ${reportDir}`);

  if (args.json) {
    console.log("");
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error("tp-plan-anna-recent-workout-diagnostic failed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
