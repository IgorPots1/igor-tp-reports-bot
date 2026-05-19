import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

const ARTIFACTS_ROOT = path.join(toolRoot, "debug", "weekly-enable");

type CliArgs = {
  studentIds: string[];
  apply: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
  archived_at: string | null;
};

type StudentEntry = {
  student_id: string;
  student_name: string;
  id: string;
  reason?: string;
};

type EnableReport = {
  run_at: string;
  mode: "dry-run" | "apply";
  requested: string[];
  summary: {
    requested: number;
    found: number;
    would_enable: number;
    already_enabled: number;
    not_found: number;
    archived_or_inactive: number;
    enabled?: number;
    enable_errors?: number;
  };
  found: StudentEntry[];
  would_enable: StudentEntry[];
  already_enabled: StudentEntry[];
  not_found: string[];
  archived_or_inactive: StudentEntry[];
  apply_results?: Array<{ student_id: string; ok: boolean; error?: string }>;
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

function printHelp(): void {
  console.log(`Usage: npm run tp-enable-weekly-reports -- [options]

Enable weekly reports for selected TrainingPeaks students in Supabase.
Default mode is dry-run (no Supabase writes).

Options:
  --students=id1,id2,id3   Comma-separated student_id list
  --from-file=<path>       File with one student_id per line
  --apply                  Set weekly_report_enabled=true for eligible students
  --help                   Show this help

Safety:
  - Default: dry-run only
  - Never mutates TrainingPeaks
  - Never creates reports or enqueues jobs
  - Never updates Telegram bindings
  - Never disables weekly reports for anyone
  - Never archives or deletes students
`);
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
    path.join(toolRoot, ".env"),
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

function parseStudentIdsFromFile(filePath: string): string[] {
  const resolvedPath = path.resolve(filePath);
  const content = readTextFileSyncSafe(resolvedPath);
  if (content === null) {
    throw new Error(`Failed to read --from-file path: ${resolvedPath}`);
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function parseArgs(argv: string[]): CliArgs {
  let studentsArg: string | null = null;
  let fromFile: string | null = null;
  let apply = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--students=")) {
      studentsArg = arg.slice("--students=".length);
      continue;
    }
    if (arg.startsWith("--from-file=")) {
      fromFile = arg.slice("--from-file=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const studentIds: string[] = [];

  if (studentsArg !== null) {
    for (const part of studentsArg.split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        studentIds.push(trimmed);
      }
    }
  }

  if (fromFile) {
    studentIds.push(...parseStudentIdsFromFile(fromFile));
  }

  const deduped = dedupePreserveOrder(studentIds);
  if (deduped.length === 0) {
    throw new Error("Provide at least one student via --students=... or --from-file=...");
  }

  return { studentIds: deduped, apply };
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toEntry(row: StudentRow, reason?: string): StudentEntry {
  return {
    student_id: row.student_id,
    student_name: row.student_name,
    id: row.id,
    ...(reason ? { reason } : {}),
  };
}

function buildPlan(requestedIds: string[], students: StudentRow[]) {
  const byStudentId = new Map(students.map((row) => [row.student_id, row]));

  const found: StudentEntry[] = [];
  const wouldEnable: StudentEntry[] = [];
  const alreadyEnabled: StudentEntry[] = [];
  const notFound: string[] = [];
  const archivedOrInactive: StudentEntry[] = [];

  for (const studentId of requestedIds) {
    const row = byStudentId.get(studentId);
    if (!row) {
      notFound.push(studentId);
      continue;
    }

    found.push(toEntry(row));

    if (!row.is_active || row.archived_at !== null) {
      const reasons: string[] = [];
      if (!row.is_active) {
        reasons.push("is_active=false");
      }
      if (row.archived_at !== null) {
        reasons.push("archived");
      }
      archivedOrInactive.push(toEntry(row, reasons.join(", ")));
      continue;
    }

    if (row.weekly_report_enabled) {
      alreadyEnabled.push(toEntry(row));
      continue;
    }

    wouldEnable.push(toEntry(row));
  }

  return {
    found,
    would_enable: wouldEnable,
    already_enabled: alreadyEnabled,
    not_found: notFound,
    archived_or_inactive: archivedOrInactive,
    summary: {
      requested: requestedIds.length,
      found: found.length,
      would_enable: wouldEnable.length,
      already_enabled: alreadyEnabled.length,
      not_found: notFound.length,
      archived_or_inactive: archivedOrInactive.length,
    },
  };
}

function buildMarkdownReport(report: EnableReport): string {
  const lines = [
    "# Enable weekly reports",
    "",
    `- run_at: \`${report.run_at}\``,
    `- mode: **${report.mode}**`,
    "",
    "## Summary",
    "",
    "| metric | count |",
    "| --- | ---: |",
    `| requested | ${report.summary.requested} |`,
    `| found | ${report.summary.found} |`,
    `| would_enable | ${report.summary.would_enable} |`,
    `| already_enabled | ${report.summary.already_enabled} |`,
    `| not_found | ${report.summary.not_found} |`,
    `| archived_or_inactive | ${report.summary.archived_or_inactive} |`,
  ];

  if (report.mode === "apply") {
    lines.push(
      `| enabled | ${report.summary.enabled ?? 0} |`,
      `| enable_errors | ${report.summary.enable_errors ?? 0} |`,
    );
  }

  const formatEntries = (entries: StudentEntry[]) =>
    entries.length
      ? entries.map(
          (entry) =>
            `- \`${entry.student_id}\` | ${entry.student_name}${entry.reason ? ` | ${entry.reason}` : ""}`,
        )
      : ["- none"];

  lines.push(
    "",
    "## would_enable",
    "",
    ...formatEntries(report.would_enable),
    "",
    "## already_enabled",
    "",
    ...formatEntries(report.already_enabled),
    "",
    "## not_found",
    "",
    ...(report.not_found.length ? report.not_found.map((id) => `- \`${id}\``) : ["- none"]),
    "",
    "## archived_or_inactive",
    "",
    ...formatEntries(report.archived_or_inactive),
    "",
    "## Safety",
    "- Dry-run by default; Supabase writes only with `--apply`.",
    "- Updates `weekly_report_enabled` only; never disables or touches Telegram fields.",
    "- Never mutates TrainingPeaks, creates reports, or enqueues jobs.",
    "",
    "## Artifacts",
    `- report_json: \`${report.output_paths.report_json}\``,
    `- report_md: \`${report.output_paths.report_md}\``,
  );

  return `${lines.join("\n")}\n`;
}

async function fetchAllStudents(): Promise<StudentRow[]> {
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, is_active, weekly_report_enabled, archived_at")
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch trainingpeaks_students: ${error.message}`);
  }

  return (data as StudentRow[]) ?? [];
}

async function applyEnables(
  rows: StudentEntry[],
): Promise<Array<{ student_id: string; ok: boolean; error?: string }>> {
  const supabase = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const results: Array<{ student_id: string; ok: boolean; error?: string }> = [];

  for (const row of rows) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .update({ weekly_report_enabled: true })
      .eq("student_id", row.student_id)
      .eq("is_active", true)
      .is("archived_at", null)
      .eq("weekly_report_enabled", false)
      .select("student_id");

    if (error) {
      results.push({ student_id: row.student_id, ok: false, error: error.message });
      continue;
    }

    if (!data?.length) {
      results.push({
        student_id: row.student_id,
        ok: false,
        error: "No row updated (state may have changed since dry-run)",
      });
    } else {
      results.push({ student_id: row.student_id, ok: true });
    }
  }

  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();

  const students = await fetchAllStudents();
  const plan = buildPlan(args.studentIds, students);

  const artifactDir = path.join(ARTIFACTS_ROOT, timestampForPath(new Date()));
  const reportJsonPath = path.join(artifactDir, "enable-report.json");
  const reportMdPath = path.join(artifactDir, "enable-report.md");

  await mkdir(artifactDir, { recursive: true });

  const report: EnableReport = {
    run_at: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    requested: args.studentIds,
    ...plan,
    output_paths: {
      report_json: reportJsonPath,
      report_md: reportMdPath,
    },
  };

  if (args.apply) {
    const applyResults = await applyEnables(plan.would_enable);
    const enabled = applyResults.filter((row) => row.ok).length;
    const enableErrors = applyResults.filter((row) => !row.ok).length;
    report.apply_results = applyResults;
    report.summary.enabled = enabled;
    report.summary.enable_errors = enableErrors;
  }

  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMdPath, buildMarkdownReport(report), "utf8");

  console.log("");
  console.log(`[tp-enable-weekly-reports] mode=${report.mode}`);
  console.log("");
  console.log("summary:");
  console.log(`  requested: ${report.summary.requested}`);
  console.log(`  found: ${report.summary.found}`);
  console.log(`  would_enable: ${report.summary.would_enable}`);
  console.log(`  already_enabled: ${report.summary.already_enabled}`);
  console.log(`  not_found: ${report.summary.not_found}`);
  console.log(`  archived_or_inactive: ${report.summary.archived_or_inactive}`);

  if (report.would_enable.length) {
    console.log("");
    console.log("would_enable:");
    for (const row of report.would_enable) {
      console.log(`  - ${row.student_id} | ${row.student_name}`);
    }
  }

  if (report.already_enabled.length) {
    console.log("");
    console.log("already_enabled:");
    for (const row of report.already_enabled) {
      console.log(`  - ${row.student_id} | ${row.student_name}`);
    }
  }

  if (report.not_found.length) {
    console.log("");
    console.log("not_found:");
    for (const studentId of report.not_found) {
      console.log(`  - ${studentId}`);
    }
  }

  if (report.archived_or_inactive.length) {
    console.log("");
    console.log("archived_or_inactive:");
    for (const row of report.archived_or_inactive) {
      console.log(`  - ${row.student_id} | ${row.student_name} | ${row.reason ?? "ineligible"}`);
    }
  }

  if (args.apply) {
    console.log("");
    console.log(`enabled: ${report.summary.enabled ?? 0}`);
    console.log(`enable_errors: ${report.summary.enable_errors ?? 0}`);
  }

  console.log("");
  console.log("artifact_paths:");
  console.log(`  - ${reportJsonPath}`);
  console.log(`  - ${reportMdPath}`);

  if (!args.apply) {
    console.log("");
    console.log("dry-run complete; pass --apply to enable weekly reports for would_enable students.");
  }
}

main().catch((error: unknown) => {
  console.error("tp-enable-weekly-reports failed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
