import process from "node:process";

import { formatStudentLabel, readStudentsConfig } from "./lib/students.ts";
import { runWeeklyWorkflow } from "./tp-weekly-one.ts";

type CliArgs = {
  from?: string;
  to?: string;
  skipExport: boolean;
};

type StudentRunResult = {
  student_id: string;
  success: boolean;
  reportMarkdownPath?: string;
  error?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-weekly-all",
    "  npm run tp-weekly-all -- --skip-export",
    "  npm run tp-weekly-all -- --from=2026-04-27 --to=2026-05-03 --skip-export"
  ].join("\n");
}

function assertIsoDate(value: string, flagName: "--from" | "--to"): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flagName} must use YYYY-MM-DD format.`);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<Omit<CliArgs, "skipExport">> = {};
  let skipExport = false;

  for (const arg of argv) {
    if (arg === "--skip-export") {
      skipExport = true;
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
    skipExport
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const period = args.from && args.to ? { from: args.from, to: args.to } : resolvePreviousWeekRange();
  const students = await readStudentsConfig();
  const selectedStudents = students.filter(
    (student) => student.is_active === true && student.weekly_report_enabled === true
  );

  console.log("Selected period:");
  console.log(`- from=${period.from}`);
  console.log(`- to=${period.to}`);
  console.log(`- skip_export=${args.skipExport ? "yes" : "no"}`);
  console.log("");
  console.log("Selected students:");

  if (selectedStudents.length === 0) {
    console.log("- none");
    console.log("");
    console.log("No students matched is_active=true and weekly_report_enabled=true.");
    return;
  }

  for (const student of selectedStudents) {
    console.log(`- ${formatStudentLabel(student)}`);
  }

  const results: StudentRunResult[] = [];

  for (const student of selectedStudents) {
    console.log("");
    console.log("============================================================");
    console.log(`Running weekly workflow for ${formatStudentLabel(student)}`);
    console.log("============================================================");

    try {
      const result = await runWeeklyWorkflow({
        student: student.student_id,
        from: period.from,
        to: period.to,
        skipExport: args.skipExport
      });

      results.push({
        student_id: student.student_id,
        success: true,
        reportMarkdownPath: result.reportMarkdownPath
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Workflow failed for ${student.student_id}: ${message}`);

      results.push({
        student_id: student.student_id,
        success: false,
        error: message
      });
    }
  }

  const successCount = results.filter((result) => result.success).length;
  const failedCount = results.length - successCount;

  console.log("");
  console.log("Summary:");
  console.log(`- success count: ${successCount}`);
  console.log(`- failed count: ${failedCount}`);

  for (const result of results) {
    if (result.success) {
      console.log(`- ${result.student_id}: report-draft.md -> ${result.reportMarkdownPath}`);
      continue;
    }

    console.log(`- ${result.student_id}: error -> ${result.error}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
