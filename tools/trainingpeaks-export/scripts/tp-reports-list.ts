import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { exportsRoot, parsedRoot, reportsRoot, toolRoot } from "./lib/paths.ts";
import { formatStudentLabel, readStudentsConfig } from "./lib/students.ts";

type CliArgs = {
  from?: string;
  to?: string;
  enabledOnly: boolean;
};

type StudentStatus = "ready" | "parsed_only" | "exported_only" | "missing_export" | "skipped";
type SkippedReason = "inactive" | "weekly_report_disabled";

type StatusResult = {
  student_id: string;
  name?: string;
  status: StudentStatus;
  reason?: SkippedReason;
  reportMarkdownPath?: string;
  expectedExportFolderPath?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-reports-list",
    "  npm run tp-reports-list -- --from=2026-04-27 --to=2026-05-03",
    "  npm run tp-reports-list -- --enabled-only",
    "  npm run tp-reports-list -- --from=2026-04-27 --to=2026-05-03 --enabled-only"
  ].join("\n");
}

function assertIsoDate(value: string, flagName: "--from" | "--to"): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flagName} must use YYYY-MM-DD format.`);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<Pick<CliArgs, "from" | "to">> = {};
  let enabledOnly = false;

  for (const arg of argv) {
    if (arg === "--enabled-only") {
      enabledOnly = true;
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

    if (rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if ((values.from && !values.to) || (!values.from && values.to)) {
    throw new Error(`Provide both --from and --to together.\n\n${usage()}`);
  }

  if (values.from && values.to) {
    assertIsoDate(values.from, "--from");
    assertIsoDate(values.to, "--to");
  }

  return {
    from: values.from,
    to: values.to,
    enabledOnly
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolvePreviousWeekRange(): { from: string; to: string } {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const dayOfWeek = today.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const currentWeekMonday = addDays(today, -daysSinceMonday);
  const previousWeekMonday = addDays(currentWeekMonday, -7);
  const previousWeekSunday = addDays(currentWeekMonday, -1);

  return {
    from: formatLocalDate(previousWeekMonday),
    to: formatLocalDate(previousWeekSunday)
  };
}

function toRelativePath(targetPath: string): string {
  return path.relative(toolRoot, targetPath) || ".";
}

async function hasZipExports(exportDir: string): Promise<boolean> {
  if (!existsSync(exportDir)) {
    return false;
  }

  const entries = await readdir(exportDir, { withFileTypes: true });
  return entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
}

async function resolveStudentStatus(
  student: { student_id: string; name?: string; is_active: boolean; weekly_report_enabled: boolean },
  weekKey: string
): Promise<StatusResult> {
  if (!student.is_active) {
    return {
      student_id: student.student_id,
      name: student.name,
      status: "skipped",
      reason: "inactive"
    };
  }

  if (!student.weekly_report_enabled) {
    return {
      student_id: student.student_id,
      name: student.name,
      status: "skipped",
      reason: "weekly_report_disabled"
    };
  }

  const reportMarkdownPath = path.join(reportsRoot, student.student_id, weekKey, "report-draft.md");
  const summaryPath = path.join(parsedRoot, student.student_id, weekKey, "weekly-summary.json");
  const exportDir = path.join(exportsRoot, student.student_id, weekKey);

  if (existsSync(reportMarkdownPath)) {
    return {
      student_id: student.student_id,
      name: student.name,
      status: "ready",
      reportMarkdownPath: toRelativePath(reportMarkdownPath)
    };
  }

  if (existsSync(summaryPath)) {
    return {
      student_id: student.student_id,
      name: student.name,
      status: "parsed_only"
    };
  }

  if (await hasZipExports(exportDir)) {
    return {
      student_id: student.student_id,
      name: student.name,
      status: "exported_only"
    };
  }

  return {
    student_id: student.student_id,
    name: student.name,
    status: "missing_export",
    expectedExportFolderPath: toRelativePath(exportDir)
  };
}

function printStatus(result: StatusResult): void {
  const label = formatStudentLabel({ student_id: result.student_id, name: result.name });

  if (result.status === "skipped") {
    console.log(`- ${label}: skipped (${result.reason})`);
    return;
  }

  if (result.status === "ready") {
    console.log(`- ${label}: ready -> ${result.reportMarkdownPath}`);
    return;
  }

  if (result.status === "missing_export") {
    console.log(`- ${label}: missing_export -> expected ${result.expectedExportFolderPath}`);
    return;
  }

  console.log(`- ${label}: ${result.status}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const period = args.from && args.to ? { from: args.from, to: args.to } : resolvePreviousWeekRange();
  const weekKey = `${period.from}_${period.to}`;
  const students = await readStudentsConfig();
  const listedStudents = args.enabledOnly
    ? students.filter((student) => student.is_active === true && student.weekly_report_enabled === true)
    : students;

  console.log("Selected period:");
  console.log(`- from=${period.from}`);
  console.log(`- to=${period.to}`);
  console.log(`- enabled_only=${args.enabledOnly ? "yes" : "no"}`);
  console.log("");
  console.log("Report status:");

  if (listedStudents.length === 0) {
    console.log("- none");
    console.log("");
    console.log("Summary:");
    console.log("- ready: 0");
    console.log("- parsed_only: 0");
    console.log("- exported_only: 0");
    console.log("- missing_export: 0");
    console.log("- skipped: 0");
    return;
  }

  const results: StatusResult[] = [];

  for (const student of listedStudents) {
    const result = await resolveStudentStatus(student, weekKey);
    results.push(result);
    printStatus(result);
  }

  const summary = {
    ready: results.filter((result) => result.status === "ready").length,
    parsed_only: results.filter((result) => result.status === "parsed_only").length,
    exported_only: results.filter((result) => result.status === "exported_only").length,
    missing_export: results.filter((result) => result.status === "missing_export").length,
    skipped: results.filter((result) => result.status === "skipped").length
  };

  console.log("");
  console.log("Summary:");
  console.log(`- ready: ${summary.ready}`);
  console.log(`- parsed_only: ${summary.parsed_only}`);
  console.log(`- exported_only: ${summary.exported_only}`);
  console.log(`- missing_export: ${summary.missing_export}`);
  console.log(`- skipped: ${summary.skipped}`);
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
