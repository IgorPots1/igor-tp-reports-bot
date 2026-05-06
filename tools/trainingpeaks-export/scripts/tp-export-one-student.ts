import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { Locator, Page } from "playwright";
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
  visibleCandidates?: string[];
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

type ExportDirSnapshot = {
  zipFiles: string[];
  summaryZipFiles: string[];
  summaryTempFiles: string[];
};

function isLikelyBrowserTempDownload(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName.endsWith(".crdownload") ||
    lowerName.endsWith(".download") ||
    lowerName.endsWith(".part") ||
    lowerName.endsWith(".tmp")
  );
}

function isLikelyWorkoutSummaryArtifact(fileName: string): boolean {
  if (isLikelyWorkoutSummaryZip(fileName)) {
    return true;
  }

  return fileName.toLowerCase().includes("workout summary");
}

async function inspectExportDir(exportDir: string): Promise<ExportDirSnapshot> {
  const entries = await readdir(exportDir, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const zipFiles = fileNames
    .filter((fileName) => path.extname(fileName).toLowerCase() === ".zip")
    .map((fileName) => path.join(exportDir, fileName))
    .sort((left, right) => left.localeCompare(right));

  return {
    zipFiles,
    summaryZipFiles: zipFiles.filter((filePath) => isLikelyWorkoutSummaryZip(filePath)),
    summaryTempFiles: fileNames.filter(
      (fileName) => isLikelyBrowserTempDownload(fileName) && isLikelyWorkoutSummaryArtifact(fileName)
    )
  };
}

async function waitForWorkoutSummaryZip(
  exportDir: string,
  knownSummaryZipFiles: string[],
  timeoutMs = 90_000
): Promise<AutomationAttemptResult & { summaryZip?: string }> {
  const knownSummaryZipSet = new Set(knownSummaryZipFiles);
  const startedAt = Date.now();
  let lastProgressLogAt = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    const snapshot = await inspectExportDir(exportDir);
    const newSummaryZip = snapshot.summaryZipFiles.find((filePath) => !knownSummaryZipSet.has(filePath));
    if (newSummaryZip) {
      return { ok: true, summaryZip: newSummaryZip };
    }

    const now = Date.now();
    if (now - lastProgressLogAt >= 5_000) {
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      if (snapshot.summaryTempFiles.length > 0) {
        console.log(
          `Auto-export: waiting for Workout Summary ZIP (${elapsedSeconds}s elapsed, temporary files: ${snapshot.summaryTempFiles.join(", ")})`
        );
      } else {
        console.log(`Auto-export: waiting for Workout Summary ZIP (${elapsedSeconds}s elapsed)`);
      }
      lastProgressLogAt = now;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    ok: false,
    reason: `did not detect a new Workout Summary ZIP in ${timeoutMs / 1000} seconds.`
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

function normalizeCandidateLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function listVisibleCandidateControls(page: Page): Promise<string[]> {
  const candidates = await page
    .locator('button, a, [role="button"], [role="link"], div')
    .evaluateAll((elements) => {
      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const normalizeWhitespace = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
      const compactClassName = (value: string): string => value.split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      const keywordPattern = /(settings|athlete settings|athlete account|account settings|export data|\baccount\b|\bexport\b)/i;

      const labels = new Set<string>();
      for (const element of elements) {
        if (!isVisible(element)) {
          continue;
        }

        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute("role") ?? "";
        const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
        const title = normalizeWhitespace(element.getAttribute("title"));
        const text = normalizeWhitespace(element.textContent);
        const dataTooltip = normalizeWhitespace(element.getAttribute("data-tooltip"));
        const onclick = normalizeWhitespace(element.getAttribute("onclick"));
        const className = normalizeWhitespace(element.getAttribute("class"));
        const computedCursor = window.getComputedStyle(element).cursor;
        const accessibleLabel = normalizeWhitespace(ariaLabel || title || dataTooltip || text);
        const keywordMatch = keywordPattern.test(`${accessibleLabel} ${className}`);
        const exactMoreMatch = /^(more|⋯|…)$/.test(accessibleLabel);
        const isClickableDiv =
          tagName === "div" &&
          (
            Boolean(dataTooltip) ||
            Boolean(onclick) ||
            computedCursor === "pointer" ||
            keywordPattern.test(className)
          );

        if (tagName === "div" && !isClickableDiv) {
          continue;
        }

        if (
          !exactMoreMatch &&
          !keywordMatch &&
          !keywordPattern.test(dataTooltip) &&
          !keywordPattern.test(onclick) &&
          !/openathletesettingsbutton/i.test(className)
        ) {
          continue;
        }

        if (
          accessibleLabel.length > 80 ||
          /^\d+\s+more\b/i.test(accessibleLabel)
        ) {
          continue;
        }

        const descriptionParts = [role || tagName];
        if (className) {
          descriptionParts.push(`class=.${compactClassName(className)}`);
        }
        if (dataTooltip) {
          descriptionParts.push(`tooltip="${dataTooltip}"`);
        }
        if (accessibleLabel) {
          descriptionParts.push(`label="${accessibleLabel}"`);
        }
        if (onclick) {
          descriptionParts.push("onclick");
        }
        if (computedCursor === "pointer") {
          descriptionParts.push("cursor:pointer");
        }

        labels.add(descriptionParts.join(" "));
        if (labels.size >= 12) {
          break;
        }
      }

      return [...labels];
    })
    .catch(() => []);

  return [...new Set(candidates.map(normalizeCandidateLabel))].slice(0, 12);
}

function logVisibleCandidateControls(candidates: string[]): void {
  console.log("Visible candidate controls:");
  if (candidates.length === 0) {
    console.log("- (none detected)");
    return;
  }

  for (const candidate of candidates) {
    console.log(`- ${candidate}`);
  }
}

function athleteAccountSettingsHeadingLocator(page: Page): Locator {
  return page.locator("h2").filter({ hasText: /^Athlete Account Settings$/i }).first();
}

function athleteSettingsModalLocator(page: Page): Locator {
  return page.locator("div.tabbedSettings.userSettings.overlayBox.modal").first();
}

function exportInstructionsLocator(scope: Page | Locator): Locator {
  return scope.getByText(/use the fields below to download your workout or metrics data to your computer\./i);
}

async function exportDataSectionReady(page: Page): Promise<boolean> {
  const settingsModal = athleteSettingsModalLocator(page);
  return anyVisible([
    page.getByRole("heading", { name: /^export data$/i }),
    exportInstructionsLocator(settingsModal),
    exportInstructionsLocator(page)
  ], 700);
}

async function waitForSettingsModal(page: Page): Promise<boolean> {
  if (!(await isVisible(athleteAccountSettingsHeadingLocator(page), 4000))) {
    return false;
  }

  return isVisible(athleteSettingsModalLocator(page), 4000);
}

async function locateSettingsScope(page: Page): Promise<Locator> {
  const dialog = athleteSettingsModalLocator(page);

  if (await isVisible(dialog, 700)) {
    return dialog.first();
  }

  return page.locator("body");
}

async function tryOpenAthleteAccountSettings(page: Page): Promise<AutomationAttemptResult> {
  if (await waitForSettingsModal(page)) {
    return { ok: true };
  }

  const triggerCandidates = [
    page.locator('div.groupAndAthleteSelector [data-tooltip*="Athlete Settings"]').first(),
    page.locator("div.groupAndAthleteSelector div.openAthleteSettingsButton").first()
  ];

  for (const trigger of triggerCandidates) {
    if (!(await isVisible(trigger, 700))) {
      continue;
    }

    try {
      await trigger.click({ timeout: 2000 });
    } catch {
      continue;
    }

    if (await waitForSettingsModal(page)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: "could not find Athlete Account Settings control.",
    visibleCandidates: await listVisibleCandidateControls(page)
  };
}

async function tryOpenExportData(page: Page): Promise<AutomationAttemptResult> {
  if (await exportDataSectionReady(page)) {
    return { ok: true };
  }

  const settingsVisible = await waitForSettingsModal(page);
  if (!settingsVisible) {
    const openedSettings = await tryOpenAthleteAccountSettings(page);
    if (!openedSettings.ok) {
      return openedSettings;
    }

    if (!(await waitForSettingsModal(page))) {
      return { ok: false, reason: 'clicked a likely settings control, but "Athlete Account Settings" did not appear.' };
    }
  }

  if (await exportDataSectionReady(page)) {
    return { ok: true };
  }

  const settingsScope = await locateSettingsScope(page);
  const openedExport = await clickFirstVisible([
    settingsScope.locator("li").filter({ hasText: /^export data$/i }),
    settingsScope.getByRole("tab", { name: /^export data$/i }),
    settingsScope.getByRole("link", { name: /^export data$/i }),
    settingsScope.getByRole("button", { name: /^export data$/i }),
    settingsScope.getByText(/^export data$/i)
  ], 700);

  if (!openedExport) {
    return { ok: false, reason: 'could not find the "Export Data" item inside Athlete Account Settings.' };
  }

  await page.waitForTimeout(500);

  if (!(await anyVisible([
    exportInstructionsLocator(settingsScope),
    exportInstructionsLocator(page)
  ], 1500))) {
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

async function tryFillWorkoutSummaryDateRange(
  page: Page,
  fromIso: string,
  toIso: string
): Promise<AutomationAttemptResult> {
  if (!(await exportDataSectionReady(page))) {
    return { ok: false, reason: 'the "Export Data" section was not ready for date entry.' };
  }

  const from = formatForTrainingPeaksDateInput(fromIso);
  const to = formatForTrainingPeaksDateInput(toIso);

  const workoutSummaryResult = await fillExportSubsectionDateRange(page, "Workout Summary", from, to);
  if (!workoutSummaryResult.ok) {
    return workoutSummaryResult;
  }

  return { ok: true };
}

async function tryClickWorkoutSummaryExport(page: Page): Promise<AutomationAttemptResult> {
  const section = await locateExportSubsection(page, "Workout Summary");
  if (!section) {
    return { ok: false, reason: 'could not find the "Workout Summary" export subsection.' };
  }

  const clicked = await clickFirstVisible(
    [
      section.getByRole("button", { name: /^export$/i }),
      section.getByRole("link", { name: /^export$/i }),
      section.locator("button").filter({ hasText: /^export$/i }),
      section.locator('[role="button"]').filter({ hasText: /^export$/i })
    ],
    700
  );

  if (!clicked) {
    return { ok: false, reason: 'could not find the "Export" button inside "Workout Summary".' };
  }

  return { ok: true };
}

function logManualFallbackInstructions(): void {
  console.log("Manual fallback:");
  console.log("1. Open Athlete Account Settings -> Export Data");
  console.log("2. Set date range manually");
  console.log("3. Download Workout Summary");
  console.log("4. Wait until the ZIP file finishes downloading");
  console.log("5. Return to terminal and press Enter");
  console.log("");
  console.log("Optional:");
  console.log("Workout Files can be downloaded too, but it is not required for the current weekly report.");
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

  const existingZipFilesBeforeRun = await listZipFiles(exportDir);
  const existingExportAssessment = assessExportFiles(existingZipFilesBeforeRun);
  if (existingExportAssessment.summaryZip) {
    console.log("Existing Workout Summary ZIP already present. Reusing export folder.");
    logExportAssessment(existingExportAssessment);
    return;
  }

  console.log(`Using persistent browser profile: ${profileDir}`);
  console.log(`Export folder: ${exportDir}`);
  console.log(`Opening TrainingPeaks for student: ${student.student_id}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    acceptDownloads: true,
    downloadsPath: exportDir
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded" });
    await page.bringToFront();

    console.log(`Auto-export: opening TrainingPeaks for ${student.student_id}`);
    console.log("Auto-export: verifying login/page state");

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
    let automaticSummaryExportCompleted = false;

    console.log("Auto-export: attempting to open Athlete Account Settings -> Export Data");
    if (pageAssessment.athletePageLikelyReachable) {
      const exportOpenResult = await tryOpenExportData(page);
      if (exportOpenResult.ok) {
        exportDataOpened = true;
        console.log("Auto-export: Export Data opened");
      } else {
        console.log(`Auto-export fallback: ${exportOpenResult.reason ?? 'could not open "Export Data" automatically.'}`);
        if (exportOpenResult.visibleCandidates) {
          logVisibleCandidateControls(exportOpenResult.visibleCandidates);
        }
      }
    } else {
      console.log("Auto-export fallback: athlete page state was uncertain, skipping Export Data automation.");
    }

    if (exportDataOpened) {
      const fillDatesResult = await tryFillWorkoutSummaryDateRange(page, args.from, args.to);
      if (fillDatesResult.ok) {
        datesAutoFilled = true;
        console.log("Auto-export: Summary date range filled");
      } else {
        console.log(`Auto-export fallback: ${fillDatesResult.reason ?? "could not fill export date fields automatically."}`);
      }
    }

    if (exportDataOpened && datesAutoFilled) {
      const summaryZipFilesBeforeClick = (await inspectExportDir(exportDir)).summaryZipFiles;
      console.log("Auto-export: clicking Workout Summary Export");
      const clickResult = await tryClickWorkoutSummaryExport(page);
      if (!clickResult.ok) {
        console.log(`Auto-export fallback: ${clickResult.reason ?? 'could not click "Workout Summary" export.'}`);
      } else {
        console.log("Auto-export: waiting for Workout Summary ZIP");
        const waitForZipResult = await waitForWorkoutSummaryZip(exportDir, summaryZipFilesBeforeClick);
        if (waitForZipResult.ok && waitForZipResult.summaryZip) {
          automaticSummaryExportCompleted = true;
          console.log(`Auto-export: Summary ZIP detected: ${path.basename(waitForZipResult.summaryZip)}`);
          console.log("Workout Summary export downloaded automatically.");
        } else {
          console.log("Auto-export did not detect Workout Summary ZIP. Switching to manual fallback.");
          console.log(
            `Auto-export fallback: ${waitForZipResult.reason ?? "did not detect Workout Summary ZIP after clicking Export."}`
          );
        }
      }
    }

    console.log("");
    if (!automaticSummaryExportCompleted) {
      logManualFallbackInstructions();
      console.log("If no files are downloaded and no existing ZIPs are found, this student will be skipped and the batch will continue.");
      console.log("");

      await waitForEnter("Press Enter here after you finish the manual export flow.");
    }

    const exportDirSnapshot = await inspectExportDir(exportDir);
    const exportAssessment = assessExportFiles(exportDirSnapshot.zipFiles);
    logExportAssessment(exportAssessment);

    if (!exportAssessment.summaryZip) {
      if (exportDirSnapshot.zipFiles.length === 0) {
        console.log("Status: no export files available.");
        throw new Error("No Workout Summary ZIP was found after automatic export attempt and manual fallback.");
      }

      console.log("Existing ZIP files found:");
      for (const filePath of exportDirSnapshot.zipFiles) {
        console.log(`- ${filePath}`);
      }

      throw new Error("Workout Summary export was not found after the export step.");
    }
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
