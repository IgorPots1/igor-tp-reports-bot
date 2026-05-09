import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { configRoot, studentsConfigPath, toolRoot } from "./lib/paths.ts";
import type { WritableStudentConfig } from "./lib/students.ts";

type CliArgs = {
  dryRun: boolean;
};

type TrainingPeaksStudentRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  data_quality_status: string | null;
  notes: string | null;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-sync-students",
    "  npm run tp-sync-students -- --dry-run"
  ].join("\n");
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
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env")
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}\n\n${usage()}`);
    }
  }

  return { dryRun };
}

function mapStudents(rows: TrainingPeaksStudentRow[]): WritableStudentConfig[] {
  return rows.map((row) => ({
    student_id: row.student_id,
    name: row.student_name,
    trainingpeaks_athlete_url: row.trainingpeaks_athlete_url,
    is_active: true,
    weekly_report_enabled: true,
    data_quality_status: row.data_quality_status ?? "ok",
    notes: row.notes ?? ""
  }));
}

function formatTimestampForBackup(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

async function writeBackupIfNeeded(): Promise<string | null> {
  if (!existsSync(studentsConfigPath)) {
    return null;
  }

  const backupPath = path.join(configRoot, `students.backup-${formatTimestampForBackup(new Date())}.json`);
  await mkdir(configRoot, { recursive: true });
  await copyFile(studentsConfigPath, backupPath);
  return backupPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();

  const supabase = createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("student_id, student_name, trainingpeaks_athlete_url, data_quality_status, notes")
    .eq("is_active", true)
    .eq("weekly_report_enabled", true)
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch active TrainingPeaks students: ${error.message}`);
  }

  const rows = (data as TrainingPeaksStudentRow[]) ?? [];
  const nextStudents = mapStudents(rows);
  const serialized = `${JSON.stringify(nextStudents, null, 2)}\n`;
  const hasNoActiveStudents = rows.length === 0;

  if (args.dryRun) {
    if (hasNoActiveStudents) {
      console.warn("Dry run: would write empty students.json to avoid stale local runs.");
    } else {
      console.log(`Dry run: would write ${rows.length} student(s) to config/students.json`);
    }
    console.log(serialized);
    return;
  }

  const backupPath = await writeBackupIfNeeded();
  await mkdir(configRoot, { recursive: true });
  await writeFile(studentsConfigPath, serialized, "utf8");

  if (hasNoActiveStudents) {
    console.warn(
      "No active weekly-enabled students found. Wrote empty students.json to avoid stale local runs."
    );
  } else {
    console.log(`Wrote ${rows.length} student(s) to config/students.json`);
  }
  if (backupPath) {
    console.log(`Created backup: ${path.relative(toolRoot, backupPath)}`);
  } else {
    console.log("No backup created because config/students.json did not exist yet.");
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
  } else {
    console.error(error);
  }

  process.exit(1);
});
