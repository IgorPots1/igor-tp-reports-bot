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

type AutomationAttemptResult = {
  ok: boolean;
  reason?: string;
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

function isLikelyWorkoutFilesZip(filePath: string): boolean {
  const normalized = normalizeExportName(filePath);
  return normalized.includes("workoutfileexport") || normalized.includes("workoutfiles");
}

type ExportAssessment = {
  summaryZip?: string;
  workoutFilesZip?: string;
};

function assessExportFiles(zipFiles: string[]): ExportAssessment {
  return {
    summaryZip: zipFiles.find((filePath) => isLikelyWorkoutSummaryZip(filePath)),
    workoutFilesZip: zipFiles.find((filePath) => isLikelyWorkoutFilesZip(filePath))
  };
}

function logExportAssessment(assessment: ExportAssessment): void {
  if (assessment.summaryZip) {
    console.log("Workout Summary export found. Continuing.");
    console.log(`- ${assessment.summaryZip}`);
  } else {
    console.log("Workout Summary export was not found. This student cannot be parsed.");
  }

  if (assessment.workoutFilesZip) {
    console.log(`Workout Files export found: ${assessment.workoutFilesZip}`);
  } else {
    console.log("Workout Files export not found. Continuing because it is optional for weekly reports.");
  }
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

function formatForTrainingPeaksDateInput(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  return `${month}/${day}/${year}`;
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

function exportInstructionsLocator(page: Page): Locator {
  return page.getByText(/use the fields below to download your workout or metrics data to your computer\./i);
}

async function exportDataSectionReady(page: Page): Promise<boolean> {
  return anyVisible([
    page.getByRole("heading", { name: /^export data$/i }),
    exportInstructionsLocator(page)
  ], 700);
}

async function waitForSettingsModal(page: Page): Promise<boolean> {
  return anyVisible([
    page.getByRole("heading", { name: /^athlete account settings$/i }),
    page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: /^athlete account settings$/i })
    })
  ], 4000);
}

async function locateSettingsScope(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: /^athlete account settings$/i })
  });

  if (await isVisible(dialog, 700)) {
    return dialog.first();
  }

  return page.locator("body");
}

async function tryOpenExportData(page: Page): Promise<AutomationAttemptResult> {
  if (await exportDataSectionReady(page)) {
    return { ok: true };
  }

  const settingsVisible = await waitForSettingsModal(page);
  if (!settingsVisible) {
    const openedSettings = await clickFirstVisible([
      page.getByRole("link", { name: /^athlete account settings$/i }),
      page.getByRole("button", { name: /^athlete account settings$/i }),
      page.getByText(/^athlete account settings$/i),
      page.getByRole("link", { name: /account settings/i }),
      page.getByRole("button", { name: /account settings/i }),
      page.getByText(/account settings/i),
      page.getByRole("link", { name: /^settings$/i }),
      page.getByRole("button", { name: /^settings$/i }),
      page.getByText(/^settings$/i)
    ]);

    if (!openedSettings) {
      return { ok: false, reason: 'could not find an "Athlete Account Settings" control.' };
    }

    if (!(await waitForSettingsModal(page))) {
      return { ok: false, reason: 'clicked settings, but "Athlete Account Settings" did not appear.' };
    }
  }

  if (await exportDataSectionReady(page)) {
    return { ok: true };
  }

  const settingsScope = await locateSettingsScope(page);
  const openedExport = await clickFirstVisible([
    settingsScope.getByRole("tab", { name: /^export data$/i }),
    settingsScope.getByRole("link", { name: /^export data$/i }),
    settingsScope.getByRole("button", { name: /^export data$/i }),
    settingsScope.getByText(/^export data$/i)
  ], 700);

  if (!openedExport) {
    return { ok: false, reason: 'could not find the "Export Data" item inside Athlete Account Settings.' };
  }

  await page.waitForTimeout(500);

  if (!(await exportDataSectionReady(page))) {
    return { ok: false, reason: 'the "Export Data" section did not become ready after opening it.' };
  }

  return { ok: true };
}

async function locateExportSubsection(page: Page, headingText: string): Promise<Locator | null> {
  const headingCandidates = [
    page.getByRole("heading", { name: new RegExp(`^${headingText}$`, "i") }),
    page.getByText(new RegExp(`^${headingText}$`, "i"))
  ];

  for (const candidate of headingCandidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const heading = candidate.nth(index);
      if (!(await isVisible(heading, 500))) {
        continue;
      }

      const section = heading.locator(
        "xpath=ancestor::*[(self::section or self::div or self::form) and .//input[@name='startDate'] and .//input[@name='endDate']][1]"
      );

      if (await section.count().catch(() => 0)) {
        return section.first();
      }
    }
  }

  return null;
}

async function fillAndVerifyDateInput(input: Locator, value: string): Promise<boolean> {
  try {
    await input.fill(value);
    await input.press("Tab").catch(() => {});
    return (await input.inputValue()) === value;
  } catch {
    return false;
  }
}

async function fillExportSubsectionDateRange(
  page: Page,
  headingText: string,
  from: string,
  to: string
): Promise<AutomationAttemptResult> {
  const section = await locateExportSubsection(page, headingText);
  if (!section) {
    return { ok: false, reason: `could not find the "${headingText}" export subsection.` };
  }

  const startInput = section.locator('input[name="startDate"]').first();
  const endInput = section.locator('input[name="endDate"]').first();

  if (!(await fillAndVerifyDateInput(startInput, from))) {
    return { ok: false, reason: `could not verify the "${headingText}" From date input.` };
  }

  if (!(await fillAndVerifyDateInput(endInput, to))) {
    return { ok: false, reason: `could not verify the "${headingText}" To date input.` };
  }

  return { ok: true };
}

async function tryFillExportDateRanges(page: Page, fromIso: string, toIso: string): Promise<AutomationAttemptResult> {
  if (!(await exportDataSectionReady(page))) {
    return { ok: false, reason: 'the "Export Data" section was not ready for date entry.' };
  }

  const from = formatForTrainingPeaksDateInput(fromIso);
  const to = formatForTrainingPeaksDateInput(toIso);

  const workoutFilesResult = await fillExportSubsectionDateRange(page, "Workout Files", from, to);
  if (!workoutFilesResult.ok) {
    return workoutFilesResult;
  }

  const workoutSummaryResult = await fillExportSubsectionDateRange(page, "Workout Summary", from, to);
  if (!workoutSummaryResult.ok) {
    return workoutSummaryResult;
  }

  return { ok: true };
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

    let exportDataOpened = false;
    let datesAutoFilled = false;

    console.log("Auto-export check: attempting to open Athlete Account Settings -> Export Data");
    if (pageAssessment.athletePageLikelyReachable) {
      const exportOpenResult = await tryOpenExportData(page);
      if (exportOpenResult.ok) {
        exportDataOpened = true;
        console.log("Auto-export check: Export Data is open.");
      } else {
        console.log(`Auto-export fallback: ${exportOpenResult.reason ?? 'could not open "Export Data" automatically.'}`);
      }
    } else {
      console.log("Auto-export fallback: athlete page state was uncertain, skipping Export Data automation.");
    }

    if (exportDataOpened) {
      console.log("Auto-export check: attempting to fill export date ranges");
      const fillDatesResult = await tryFillExportDateRanges(page, args.from, args.to);
      if (fillDatesResult.ok) {
        datesAutoFilled = true;
        console.log(
          `Auto-export check: date range filled automatically (${formatForTrainingPeaksDateInput(args.from)} — ${formatForTrainingPeaksDateInput(args.to)}).`
        );
      } else {
        console.log(`Auto-export fallback: ${fillDatesResult.reason ?? "could not fill export date fields automatically."}`);
      }
    }

    console.log("");
    if (datesAutoFilled) {
      console.log("Auto-export prepared:");
      console.log("- Export Data is open");
      console.log(`- Date range was filled: ${args.from} — ${args.to}`);
      console.log("");
      console.log("Manual final step:");
      console.log("1. Click Export in Workout Summary");
      console.log("2. Click Export in Workout Files");
      console.log("3. Wait until both ZIP files finish downloading");
      console.log("4. Return to terminal and press Enter");
    } else {
      console.log("Manual fallback:");
      console.log("1. Open Athlete Account Settings -> Export Data");
      console.log("2. Set date range manually");
      console.log("3. Download Workout Summary");
      console.log("4. Download Workout Files");
      console.log("5. Press Enter");
    }
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

      const zipFilesAfterDownload = await listZipFiles(exportDir);
      const exportAssessment = assessExportFiles(zipFilesAfterDownload);
      logExportAssessment(exportAssessment);

      if (!exportAssessment.summaryZip) {
        throw new Error("Workout Summary export was not found after the manual export step.");
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

    const exportAssessment = assessExportFiles(existingZipFiles);
    logExportAssessment(exportAssessment);
    if (!exportAssessment.summaryZip) {
      throw new Error("No new downloads were captured and no Workout Summary export was found in the existing ZIP files.");
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
