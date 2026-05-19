import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { exportsRoot, reportsRoot, scriptsRoot, parsedRoot } from "./lib/paths.ts";
import { findStudentById, readStudentsConfig } from "./lib/students.ts";

export type WeeklyCliArgs = {
  student: string;
  from: string;
  to: string;
  skipExport: boolean;
  headless: boolean;
  forceSingleStudentJob: boolean;
};

type RuntimeStudentRow = {
  student_id: string;
  student_name: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
  archived_at: string | null;
  trainingpeaks_athlete_url: string | null;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03",
    "  npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export"
  ].join("\n");
}

function hasForceSingleStudentJobFlag(): boolean {
  return (
    process.argv.slice(2).includes("--force-single-student-job") ||
    process.env.TP_SINGLE_STUDENT_JOB === "1"
  );
}

function parseArgs(argv: string[]): WeeklyCliArgs {
  const values: Partial<Omit<WeeklyCliArgs, "skipExport" | "headless" | "forceSingleStudentJob">> = {};
  let skipExport = false;
  let headless = false;
  let forceSingleStudentJob = hasForceSingleStudentJobFlag();

  for (const arg of argv) {
    if (arg === "--skip-export") {
      skipExport = true;
      continue;
    }

    if (arg === "--headless") {
      headless = true;
      continue;
    }

    if (arg === "--force-single-student-job") {
      forceSingleStudentJob = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "student" || rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if (!values.student || !values.from || !values.to) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDatePattern.test(values.from) || !isoDatePattern.test(values.to)) {
    throw new Error("`--from` and `--to` must use YYYY-MM-DD format.");
  }

  return {
    student: values.student,
    from: values.from,
    to: values.to,
    skipExport,
    headless,
    forceSingleStudentJob
  };
}

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
  const repoRoot = path.resolve(scriptsRoot, "..", "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(path.resolve(scriptsRoot, ".."), ".env")
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Local weekly commands now require Supabase as the source of truth. Run tp-sync-students after setting ${name}.`
    );
  }

  return value;
}

async function runNpmScript(scriptName: string): Promise<void> {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmExecutable, ["run", scriptName], {
      cwd: path.resolve(scriptsRoot, ".."),
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptName} exited from signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${scriptName} failed with exit code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

export async function refreshStudentsConfigFromSupabase(): Promise<void> {
  loadLocalEnv();
  console.log("Refreshing local students.json from Supabase before weekly run...");
  await runNpmScript("tp-sync-students");
}

export async function assertStudentAllowedBySupabase(
  studentId: string,
  options?: { forceSingleStudentJob?: boolean }
): Promise<void> {
  loadLocalEnv();
  const forceSingleStudentJob =
    options?.forceSingleStudentJob === true || process.env.TP_SINGLE_STUDENT_JOB === "1";

  const supabase = createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("student_id, student_name, is_active, weekly_report_enabled, archived_at, trainingpeaks_athlete_url")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate student "${studentId}" against Supabase: ${error.message}`);
  }

  const runtimeStudent = data as RuntimeStudentRow | null;
  if (!runtimeStudent) {
    throw new Error(
      `Student "${studentId}" was not found in Supabase. Local weekly commands no longer trust stale config/students.json.`
    );
  }

  if (runtimeStudent.archived_at) {
    throw new Error(`Student "${studentId}" is archived in Supabase. Weekly report generation is blocked.`);
  }

  if (!runtimeStudent.is_active) {
    throw new Error(`Student "${studentId}" is inactive in Supabase. Weekly report generation is blocked.`);
  }

  if (!runtimeStudent.trainingpeaks_athlete_url?.trim()) {
    throw new Error(
      `Student "${studentId}" has no TrainingPeaks athlete URL in Supabase. Weekly report generation is blocked.`
    );
  }

  if (!forceSingleStudentJob && !runtimeStudent.weekly_report_enabled) {
    throw new Error(
      `Student "${studentId}" has weekly_report_enabled=false in Supabase. Weekly report generation is blocked.`
    );
  }
}

async function runNodeScript(scriptName: string, args: WeeklyCliArgs): Promise<void> {
  const scriptPath = path.join(scriptsRoot, scriptName);
  const childArgs = [
    "--experimental-strip-types",
    scriptPath,
    `--student=${args.student}`,
    `--from=${args.from}`,
    `--to=${args.to}`
  ];

  if (args.headless && scriptName === "tp-export-one-student.ts") {
    childArgs.push("--headless");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: path.resolve(scriptsRoot, ".."),
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptName} exited from signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${scriptName} failed with exit code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

async function ensureExportFolderForWorkflow(exportDir: string): Promise<void> {
  await mkdir(exportDir, { recursive: true });
}

function assertExportFolderExists(exportDir: string, skipExport: boolean): void {
  if (existsSync(exportDir)) {
    return;
  }

  if (skipExport) {
    throw new Error(
      `Export folder does not exist: ${exportDir}\nRun the manual export first or omit --skip-export.`
    );
  }

  throw new Error(`Export folder does not exist after export step: ${exportDir}`);
}

async function listZipFiles(exportDir: string): Promise<string[]> {
  const entries = await readdir(exportDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".zip")
    .map((entry) => path.join(exportDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeExportName(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyWorkoutSummaryZip(filePath: string): boolean {
  const normalized = normalizeExportName(filePath);
  return normalized.includes("workoutexport") || normalized.includes("workoutsummary");
}

function isLikelyWorkoutSummaryCsv(filePath: string): boolean {
  if (path.extname(filePath).toLowerCase() !== ".csv") {
    return false;
  }

  const lowerName = path.basename(filePath).toLowerCase();
  return /^workouts.*\.csv$/.test(lowerName) || (lowerName.includes("workout") && lowerName.endsWith(".csv"));
}

function isLikelyWorkoutFilesZip(filePath: string): boolean {
  const normalized = normalizeExportName(filePath);
  return normalized.includes("workoutfileexport") || normalized.includes("workoutfiles");
}

async function assertWorkoutSummaryAvailable(exportDir: string): Promise<void> {
  const [zipFiles, entries] = await Promise.all([
    listZipFiles(exportDir),
    readdir(exportDir, { withFileTypes: true })
  ]);
  const summaryZip = zipFiles.find((filePath) => isLikelyWorkoutSummaryZip(filePath));
  const summaryCsv = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".csv")
    .map((entry) => path.join(exportDir, entry.name))
    .find((filePath) => isLikelyWorkoutSummaryCsv(filePath));
  const workoutFilesZip = zipFiles.find((filePath) => isLikelyWorkoutFilesZip(filePath));

  if (!summaryZip && !summaryCsv) {
    console.log("Workout Summary export was not found. This student cannot be parsed.");
    throw new Error(`Workout Summary export is required in ${exportDir}`);
  }

  if (summaryZip) {
    console.log("Workout Summary export found. Continuing.");
    console.log(`- ${summaryZip}`);
  } else if (summaryCsv) {
    console.log("Workout Summary CSV found. Continuing.");
    console.log(`- ${summaryCsv}`);
  }

  if (!workoutFilesZip) {
    console.log("Workout Files export not found. Continuing because it is optional for weekly reports.");
  }
}

export type WeeklyWorkflowResult = {
  summaryPath: string;
  reportMarkdownPath: string;
  reportJsonPath: string;
};

export async function runWeeklyWorkflow(args: WeeklyCliArgs): Promise<WeeklyWorkflowResult> {
  await assertStudentAllowedBySupabase(args.student, {
    forceSingleStudentJob: args.forceSingleStudentJob
  });

  const students = await readStudentsConfig();
  const student = findStudentById(students, args.student);

  if (!student) {
    throw new Error(
      `Student "${args.student}" is not present in the freshly synced config/students.json. Run tp-sync-students and retry.`
    );
  }

  const weekKey = `${args.from}_${args.to}`;
  const exportDir = path.join(exportsRoot, student.student_id, weekKey);
  const summaryPath = path.join(parsedRoot, student.student_id, weekKey, "weekly-summary.json");
  const reportMarkdownPath = path.join(reportsRoot, student.student_id, weekKey, "report-draft.md");
  const reportJsonPath = path.join(reportsRoot, student.student_id, weekKey, "report-draft.json");

  console.log(`Student: ${student.student_id}`);
  console.log(`TrainingPeaks URL: ${student.trainingpeaks_athlete_url}`);
  console.log(`Week: ${args.from} -> ${args.to}`);
  console.log(`Export folder: ${exportDir}`);

  if (!args.skipExport) {
    await ensureExportFolderForWorkflow(exportDir);
    console.log("");
    console.log("Step 1/3: manual TrainingPeaks export capture");
    await runNodeScript("tp-export-one-student.ts", args);
  } else {
    console.log("");
    console.log("Skipping TrainingPeaks export step (--skip-export).");
  }

  assertExportFolderExists(exportDir, args.skipExport);
  await assertWorkoutSummaryAvailable(exportDir);

  console.log("");
  console.log("Step 2/3: parse week");
  await runNodeScript("tp-parse-week.ts", args);

  console.log("");
  console.log("Step 3/3: generate AI report draft");
  await runNodeScript("tp-generate-report.ts", args);

  console.log("");
  console.log("Weekly workflow complete.");
  console.log(`weekly-summary.json: ${summaryPath}`);
  console.log(`report-draft.md: ${reportMarkdownPath}`);
  console.log(`report-draft.json: ${reportJsonPath}`);

  return {
    summaryPath,
    reportMarkdownPath,
    reportJsonPath
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await refreshStudentsConfigFromSupabase();
  await runWeeklyWorkflow(args);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  });
}
