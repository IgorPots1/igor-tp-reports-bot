import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { reportsRoot, toolRoot } from "./lib/paths.ts";

type CliArgs = {
  student: string;
  from?: string;
  to?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-report-copy -- --student=Olga",
    "  npm run tp-report-copy -- --student=Olga --from=2026-04-27 --to=2026-05-03"
  ].join("\n");
}

function assertIsoDate(value: string, flagName: "--from" | "--to"): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flagName} must use YYYY-MM-DD format.`);
  }
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};

  for (const arg of argv) {
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

  if (!values.student) {
    throw new Error(`Missing required --student.\n\n${usage()}`);
  }

  if ((values.from && !values.to) || (!values.from && values.to)) {
    throw new Error(`Provide both --from and --to together.\n\n${usage()}`);
  }

  if (values.from && values.to) {
    assertIsoDate(values.from, "--from");
    assertIsoDate(values.to, "--to");
  }

  return {
    student: values.student,
    from: values.from,
    to: values.to
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

function missingReportMessage(studentId: string, from: string, to: string, relativeReportPath: string): string {
  return [
    `Report draft not found: ${relativeReportPath}`,
    "",
    "Generate it first with one of:",
    `  npm run tp-weekly-one -- --student=${studentId} --from=${from} --to=${to}`,
    `  npm run tp-weekly-all -- --from=${from} --to=${to}`
  ].join("\n");
}

async function copyToClipboard(content: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("tp-report-copy currently supports macOS only.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("pbcopy");

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`pbcopy exited from signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`pbcopy failed with exit code ${code}.`));
        return;
      }

      resolve();
    });

    child.stdin.on("error", reject);
    child.stdin.end(content);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const period = args.from && args.to ? { from: args.from, to: args.to } : resolvePreviousWeekRange();
  const weekKey = `${period.from}_${period.to}`;
  const reportPath = path.join(reportsRoot, args.student, weekKey, "report-draft.md");
  const relativeReportPath = toRelativePath(reportPath);

  console.log(`Student: ${args.student}`);
  console.log(`Week: ${period.from} -> ${period.to}`);

  if (!existsSync(reportPath)) {
    throw new Error(missingReportMessage(args.student, period.from, period.to, relativeReportPath));
  }

  const reportContent = await readFile(reportPath, "utf8");
  await copyToClipboard(reportContent);

  console.log(`Report path: ${relativeReportPath}`);
  console.log("Copied report to clipboard");
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
