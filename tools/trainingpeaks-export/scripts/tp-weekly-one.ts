import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exportsRoot, reportsRoot, scriptsRoot, parsedRoot } from "./lib/paths.ts";
import { findStudentById, readStudentsConfig } from "./lib/students.ts";

export type WeeklyCliArgs = {
  student: string;
  from: string;
  to: string;
  skipExport: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03",
    "  npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export"
  ].join("\n");
}

function parseArgs(argv: string[]): WeeklyCliArgs {
  const values: Partial<Omit<WeeklyCliArgs, "skipExport">> = {};
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
    skipExport
  };
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

export type WeeklyWorkflowResult = {
  summaryPath: string;
  reportMarkdownPath: string;
  reportJsonPath: string;
};

export async function runWeeklyWorkflow(args: WeeklyCliArgs): Promise<WeeklyWorkflowResult> {
  const students = await readStudentsConfig();
  const student = findStudentById(students, args.student);

  if (!student) {
    const knownStudents = students.map((entry) => entry.student_id).join(", ") || "(none)";
    throw new Error(`Student "${args.student}" was not found in config/students.json. Known ids: ${knownStudents}`);
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
