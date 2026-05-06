import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { Download, Locator, Page } from "playwright";
import { chromium } from "playwright";
import { exportsRoot, profileDir } from "./lib/paths.ts";
import { findStudentById, readStudentsConfig } from "./lib/students.ts";

type CliArgs = {
  student: string;
  from: string;
  to: string;
};

type PageAssessment = {
  loginRequired: boolean;
  athletePageLikelyReachable: boolean;
  fallbackReason?: string;
};

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

async function confirmYesNo(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function listZipFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".zip")
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function isVisible(locator: Locator, timeout = 700): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function anyVisible(locators: Locator[], timeout = 700): Promise<boolean> {
  for (const locator of locators) {
    if (await isVisible(locator, timeout)) {
      return true;
    }
  }

  return false;
}

async function getPageText(page: Page): Promise<string> {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return bodyText.replace(/\s+/g, " ").trim().toLowerCase();
}

async function assessTrainingPeaksPage(page: Page): Promise<PageAssessment> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

  const [title, bodyText] = await Promise.all([page.title().catch(() => ""), getPageText(page)]);
  const combinedText = `${title} ${bodyText}`.trim().toLowerCase();
  const currentUrl = page.url();

  const loginSignals = await Promise.all([
    isVisible(page.locator('input[type="password"]')),
    isVisible(page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]')),
    anyVisible([
      page.getByRole("button", { name: /sign in|log in|login/i }),
      page.getByRole("link", { name: /sign in|log in|login/i }),
      page.getByText(/sign in|log in|login/i)
    ])
  ]);

  const loginTextDetected = /sign in|log in|login|password|forgot password|remember me/.test(combinedText);
  if (/(login|signin|sign-in|auth)/i.test(currentUrl) || loginSignals.some(Boolean) || loginTextDetected) {
    return {
      loginRequired: true,
      athletePageLikelyReachable: false,
      fallbackReason: "login screen detected or session not ready."
    };
  }

  if (!combinedText) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      fallbackReason: "page content did not load clearly."
    };
  }

  if (/something went wrong|access denied|403|404|not found|unavailable|forbidden/.test(combinedText)) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      fallbackReason: "page appears to be unavailable or access is blocked."
    };
  }

  const trainingPeaksShellVisible = await anyVisible([
    page.getByText(/trainingpeaks/i),
    page.getByRole("link", { name: /calendar|workouts|settings/i }),
    page.getByRole("button", { name: /calendar|workouts|settings/i }),
    page.getByText(/athlete account settings|export data/i)
  ]);

  const shellTextDetected = /trainingpeaks|calendar|workout|athlete|account settings|export data/.test(combinedText);
  if (!currentUrl.includes("trainingpeaks") || (!trainingPeaksShellVisible && !shellTextDetected)) {
    return {
      loginRequired: false,
      athletePageLikelyReachable: false,
      fallbackReason: "could not confirm the athlete page loaded clearly."
    };
  }

  return {
    loginRequired: false,
    athletePageLikelyReachable: true
  };
}

async function clickFirstVisible(locators: Locator[], timeout = 500): Promise<boolean> {
  for (const locator of locators) {
    if (!(await isVisible(locator, timeout))) {
      continue;
    }

    try {
      await locator.first().click({ timeout: 2000 });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function probeExportArea(page: Page): Promise<boolean> {
  const exportIndicators = [
    page.getByText(/export data/i),
    page.getByRole("heading", { name: /export data/i }),
    page.getByRole("link", { name: /export data/i }),
    page.getByRole("button", { name: /export data/i })
  ];

  if (await anyVisible(exportIndicators, 500)) {
    return true;
  }

  const openedSettings = await clickFirstVisible([
    page.getByRole("link", { name: /athlete account settings/i }),
    page.getByRole("button", { name: /athlete account settings/i }),
    page.getByText(/athlete account settings/i),
    page.getByRole("link", { name: /^settings$/i }),
    page.getByRole("button", { name: /^settings$/i }),
    page.getByText(/^settings$/i)
  ]);

  if (openedSettings) {
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  if (await anyVisible(exportIndicators, 500)) {
    return true;
  }

  const openedExport = await clickFirstVisible([
    page.getByRole("link", { name: /export data/i }),
    page.getByRole("button", { name: /export data/i }),
    page.getByText(/export data/i)
  ]);

  if (openedExport) {
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  return anyVisible(exportIndicators, 500);
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
  const students = await readStudentsConfig();
  const student = findStudentById(students, args.student);

  if (!student) {
    const knownStudents = students.map((entry) => entry.student_id).join(", ") || "(none)";
    throw new Error(`Student "${args.student}" was not found in config/students.json. Known ids: ${knownStudents}`);
  }

  const exportDir = path.join(exportsRoot, student.student_id, `${args.from}_${args.to}`);
  await mkdir(exportDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  console.log(`Using persistent browser profile: ${profileDir}`);
  console.log(`Export folder: ${exportDir}`);
  console.log(`Opening TrainingPeaks for student: ${student.student_id}`);

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

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    registerDownloadHandler(page);
    context.on("page", (newPage) => {
      registerDownloadHandler(newPage);
    });

    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded" });
    await page.bringToFront();

    console.log(`Auto-export check: opening TrainingPeaks for ${student.student_id}`);
    console.log("Auto-export check: verifying login/page state");

    let pageAssessment = await assessTrainingPeaksPage(page);
    if (pageAssessment.loginRequired) {
      console.log("TrainingPeaks login is required. Please sign in in the opened browser, then press Enter to continue.");
      await waitForEnter("Press Enter after the TrainingPeaks login is complete.");
      await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.bringToFront();
      pageAssessment = await assessTrainingPeaksPage(page);
    }

    if (!pageAssessment.athletePageLikelyReachable) {
      console.log(`Auto-export fallback: ${pageAssessment.fallbackReason ?? "athlete page was not reachable automatically."}`);
    }

    console.log("Auto-export check: attempting to locate export/settings area");
    if (pageAssessment.athletePageLikelyReachable) {
      const exportAreaReachable = await probeExportArea(page);
      if (exportAreaReachable) {
        console.log("Auto-export check: Export Data area appears reachable.");
      } else {
        console.log("Auto-export fallback: export/settings UI was not found automatically.");
      }
    } else {
      console.log("Auto-export fallback: athlete page state was uncertain, skipping export/settings probe.");
    }

    console.log("");
    console.log("Manual fallback:");
    console.log(`1. In the opened TrainingPeaks browser, make sure this is the correct athlete: ${student.student_id}`);
    console.log("2. Open Athlete Account Settings -> Export Data");
    console.log(`3. Set date range: ${args.from} — ${args.to}`);
    console.log("4. Download Workout Summary");
    console.log("5. Download Workout Files");
    console.log("6. Wait until both files finish downloading");
    console.log("7. Return to terminal and press Enter");
    console.log("If no files are downloaded and no existing ZIPs are found, this student will be skipped and the batch will continue.");
    console.log("");

    await waitForEnter("Press Enter here after you finish the manual export flow.");

    if (pendingDownloads.size > 0) {
      console.log(`Waiting for ${pendingDownloads.size} download(s) to finish saving...`);
      await Promise.allSettled([...pendingDownloads]);
    }

    const downloadsCaptured = savedFiles.length;

    if (downloadsCaptured > 0) {
      console.log(`Status: new downloads captured (${downloadsCaptured}).`);
      console.log("Saved files:");
      for (const filePath of savedFiles) {
        console.log(`- ${filePath}`);
      }
      return;
    }

    console.log("No downloads were captured in this run.");

    const existingZipFiles = await listZipFiles(exportDir);
    if (existingZipFiles.length === 0) {
      console.log("Status: no export files available.");
      throw new Error("No downloads captured and no existing export files found.");
    }

    console.log("Existing ZIP files found:");
    for (const filePath of existingZipFiles) {
      console.log(`- ${filePath}`);
    }

    const shouldContinue = await confirmYesNo(
      "No new downloads were captured. Existing export files were found. Continue using existing files? y/N"
    );

    if (!shouldContinue) {
      console.log("Status: no export files available.");
      throw new Error("Workflow stopped because no new downloads were captured and existing files were not approved.");
    }

    console.log("Status: using existing export files.");
  } finally {
    await context.close();
    console.log("Browser closed.");
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
