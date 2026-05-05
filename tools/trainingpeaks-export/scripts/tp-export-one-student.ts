import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import type { Download } from "playwright";
import { chromium } from "playwright";

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
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const profileDir = path.join(toolRoot, ".playwright-profile", "trainingpeaks");
const configPath = path.join(toolRoot, "config", "students.json");
const exportsRoot = path.join(toolRoot, "exports");

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-export-one-student -- --student=nadezhda --from=2026-04-28 --to=2026-05-04"
  ].join("\n");
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

  if (!values.student || !values.from || !values.to) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDatePattern.test(values.from) || !isoDatePattern.test(values.to)) {
    throw new Error("`--from` and `--to` must use YYYY-MM-DD format.");
  }

  return values as CliArgs;
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

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "download";
  }

  return trimmed.replace(/[\\/]/g, "_");
}

function uniqueFilePath(directory: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;

  let attempt = path.join(directory, safeName);
  let counter = 1;

  while (existsSync(attempt)) {
    attempt = path.join(directory, `${base}-${counter}${ext}`);
    counter += 1;
  }

  return attempt;
}

async function saveDownload(download: Download, exportDir: string, savedFiles: string[]): Promise<void> {
  const failure = await download.failure();
  if (failure) {
    console.error(`Download failed: ${failure}`);
    return;
  }

  const filePath = uniqueFilePath(exportDir, download.suggestedFilename());
  await download.saveAs(filePath);
  savedFiles.push(filePath);
  console.log(`Saved download: ${filePath}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await readConfig();
  const student = config.students.find((entry) => entry.id === args.student);

  if (!student) {
    const knownStudents = config.students.map((entry) => entry.id).join(", ") || "(none)";
    throw new Error(`Student "${args.student}" was not found in config/students.json. Known ids: ${knownStudents}`);
  }

  const exportDir = path.join(exportsRoot, student.id, `${args.from}_${args.to}`);
  await mkdir(exportDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  console.log(`Using persistent browser profile: ${profileDir}`);
  console.log(`Export folder: ${exportDir}`);
  console.log(`Opening TrainingPeaks for student: ${student.id}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    acceptDownloads: true
  });

  const savedFiles: string[] = [];
  const pendingDownloads = new Set<Promise<void>>();

  const registerDownloadHandler = (pageForDownloads: { on(event: "download", listener: (download: Download) => void): void }) => {
    pageForDownloads.on("download", (download) => {
      console.log(`Download started: ${download.suggestedFilename()}`);

      const task = saveDownload(download, exportDir, savedFiles)
        .catch((error: unknown) => {
          console.error(`Failed to save download: ${download.suggestedFilename()}`);
          console.error(error);
        })
        .finally(() => {
          pendingDownloads.delete(task);
        });

      pendingDownloads.add(task);
    });
  };

  const page = context.pages()[0] ?? (await context.newPage());
  registerDownloadHandler(page);
  context.on("page", (newPage) => {
    registerDownloadHandler(newPage);
  });

  await page.goto(student.url, { waitUntil: "domcontentloaded" });
  await page.bringToFront();

  console.log("");
  console.log("Manual steps:");
  console.log(`1. Confirm you are on the correct student page for ${student.id}.`);
  console.log("2. Manually navigate to Export Data in TrainingPeaks.");
  console.log(`3. Download the files for the date window ${args.from} to ${args.to}.`);
  console.log("4. Return to this terminal and press Enter when all downloads have finished.");
  console.log("");

  await waitForEnter("Press Enter here after you finish the manual export flow.");

  if (pendingDownloads.size > 0) {
    console.log(`Waiting for ${pendingDownloads.size} download(s) to finish saving...`);
    await Promise.allSettled([...pendingDownloads]);
  }

  if (savedFiles.length === 0) {
    console.log("No downloads were captured.");
  } else {
    console.log("Saved files:");
    for (const filePath of savedFiles) {
      console.log(`- ${filePath}`);
    }
  }

  await context.close();
  console.log("Browser closed.");
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
