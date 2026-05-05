import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type StudentConfig = {
  id: string;
  name?: string;
  url: string;
};

type ConfigFile = {
  students: StudentConfig[];
};

type CliArgs = {
  student: string;
  from: string;
  to: string;
  skipExport: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const configPath = path.join(toolRoot, "config", "students.json");
const exportsRoot = path.join(toolRoot, "exports");
const parsedRoot = path.join(toolRoot, "parsed");
const reportsRoot = path.join(toolRoot, "reports");

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03",
    "  npm run tp-weekly-one -- --student=Olga --from=2026-04-27 --to=2026-05-03 --skip-export"
  ].join("\n");
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

async function readConfig(): Promise<ConfigFile> {
  if (!existsSync(configPath)) {
    throw new Error(
      "Missing config/students.json.\nCopy config/students.example.json to config/students.json and fill in your student URLs."
    );
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ConfigFile>;

  if (!Array.isArray(parsed.students)) {
    throw new Error("config/students.json must contain a `students` array.");
  }

  for (const student of parsed.students) {
    if (!student || typeof student.id !== "string" || typeof student.url !== "string") {
      throw new Error("Each student in config/students.json must have string `id` and `url` fields.");
    }
  }

  return parsed as ConfigFile;
}

async function runNodeScript(scriptName: string, args: CliArgs): Promise<void> {
  const scriptPath = path.join(toolRoot, "scripts", scriptName);
  const childArgs = [
    "--experimental-strip-types",
    scriptPath,
    `--student=${args.student}`,
    `--from=${args.from}`,
    `--to=${args.to}`
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: toolRoot,
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await readConfig();
  const student = config.students.find((entry) => entry.id === args.student);

  if (!student) {
    const knownStudents = config.students.map((entry) => entry.id).join(", ") || "(none)";
    throw new Error(`Student "${args.student}" was not found in config/students.json. Known ids: ${knownStudents}`);
  }

  const weekKey = `${args.from}_${args.to}`;
  const exportDir = path.join(exportsRoot, student.id, weekKey);
  const summaryPath = path.join(parsedRoot, student.id, weekKey, "weekly-summary.json");
  const reportMarkdownPath = path.join(reportsRoot, student.id, weekKey, "report-draft.md");
  const reportJsonPath = path.join(reportsRoot, student.id, weekKey, "report-draft.json");

  console.log(`Student: ${student.id}`);
  console.log(`TrainingPeaks URL: ${student.url}`);
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
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
