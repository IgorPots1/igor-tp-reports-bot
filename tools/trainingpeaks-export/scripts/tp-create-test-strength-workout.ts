import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Locator, type Page } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { redactUnknown } from "./lib/trainingpeaks-api-move.ts";
import {
  buildCatalogPreflight,
  buildStrengthWorkoutSummaryMarkdown,
  decideExactVisibleResult,
  flattenWorkoutExercises,
  parseStrengthWorkoutTemplate,
  relativizeArtifactPath,
  sanitizeAthleteUrl,
  type ExactVisibleResultDecision,
  type StrengthWorkoutExerciseSpec,
  type StrengthWorkoutMetricType,
  type StrengthWorkoutRunSummary,
  type StrengthWorkoutTemplate,
} from "./lib/strength-workout-ui-writer.ts";

const TP_APP_HOST = "https://app.trainingpeaks.com";
const repoRoot = path.resolve(toolRoot, "..", "..");
const fixturePath = path.join(toolRoot, "scripts", "fixtures", "strength-workout-template.fixture.json");
const renderedCatalogPath = path.join(repoRoot, "reports", "strength-builder-ai-audit-input", "raw-rendered-exercises.json");
const defaultOutDir = path.join(repoRoot, "reports", "strength-builder-create-test-workout");
const summaryPath = path.join(defaultOutDir, "CREATE_TEST_WORKOUT_SUMMARY.md");
const logPath = path.join(defaultOutDir, "create-test-workout-log.json");
const screenshotDir = path.join(defaultOutDir, "screenshots");
const REQUIRED_CONFIRMATION = "CREATE TEST STRENGTH WORKOUT";

type CliArgs = {
  athleteUrl: string;
  date: string;
  headless: boolean;
  mode: "dry-run" | "apply";
  manualBuilder: boolean;
  help: boolean;
};

type VisibleExerciseSnapshot = {
  texts: string[];
  count: number;
};

type ExerciseAttempt = {
  blockName: string;
  name: string;
  sets: string;
  metricType: StrengthWorkoutMetricType;
  metricValue: string;
  notes?: string;
  selectionStatus: ExactVisibleResultDecision["status"] | "not_run";
  clicked: boolean;
  added: boolean;
  visibleExactMatches: string[];
  visibleTextsSample: string[];
  fieldWrite: {
    sets: "yes" | "no" | "not_attempted";
    metric: "yes" | "no" | "not_attempted";
    notes: "yes" | "no" | "not_attempted";
  };
};

type RunState = {
  warnings: string[];
  errors: string[];
  screenshots: string[];
  attemptedExercises: ExerciseAttempt[];
  builderOpened: boolean;
  addBlockButtonFound: boolean;
  pickerSearchFound: boolean;
  saveClicked: boolean;
};

function printHelp(): void {
  console.log("TrainingPeaks TEST strength workout creator (attended local probe)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npm run tp:create-test-strength-workout -- --athlete-url https://app.trainingpeaks.com/#calendar/athletes/<ID> --date YYYY-MM-DD --headed --dry-run"
  );
  console.log(
    "  npm run tp:create-test-strength-workout -- --athlete-url https://app.trainingpeaks.com/#calendar/athletes/<ID> --date YYYY-MM-DD --headed --apply"
  );
  console.log("");
  console.log("Required flags:");
  console.log("  --athlete-url <url>    Safe test athlete calendar URL");
  console.log("  --date <YYYY-MM-DD>    Safe empty test date");
  console.log("  --headed | --headless  Browser mode");
  console.log("  --dry-run | --apply    Dry-run is default");
  console.log("  --manual-builder       Wait for manual builder open before checks");
  console.log("");
  console.log("Safety:");
  console.log("  - Dry-run is the default mode.");
  console.log(`  - Apply requires typed confirmation: ${REQUIRED_CONFIRMATION}`);
  console.log("  - Script is intended only for a safe test athlete/date.");
  console.log("  - Generated artifacts stay local under reports/strength-builder-create-test-workout/.");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Partial<CliArgs> = {
    headless: false,
    mode: "dry-run",
    manualBuilder: false,
    help: false,
  };
  let browserModeProvided = false;
  let explicitDryRun = false;
  let explicitApply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--athlete-url=")) {
      parsed.athleteUrl = arg.slice("--athlete-url=".length).trim();
      continue;
    }
    if (arg === "--athlete-url") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --athlete-url");
      parsed.athleteUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      parsed.date = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --date");
      parsed.date = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      browserModeProvided = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      browserModeProvided = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.mode = "dry-run";
      explicitDryRun = true;
      continue;
    }
    if (arg === "--apply") {
      parsed.mode = "apply";
      explicitApply = true;
      continue;
    }
    if (arg === "--manual-builder") {
      parsed.manualBuilder = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.help) {
    return parsed as CliArgs;
  }
  if (!parsed.athleteUrl) {
    throw new Error("Missing required --athlete-url.");
  }
  if (!parsed.athleteUrl.startsWith(TP_APP_HOST)) {
    throw new Error(`--athlete-url must start with ${TP_APP_HOST}`);
  }
  if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    throw new Error("Missing or invalid required --date. Expected YYYY-MM-DD.");
  }
  if (!browserModeProvided) {
    throw new Error("Missing required browser mode. Pass either --headed or --headless.");
  }
  if (explicitDryRun && explicitApply) {
    throw new Error("Choose only one mode: pass either --dry-run or --apply.");
  }

  return parsed as CliArgs;
}

function readWorkoutTemplate(): StrengthWorkoutTemplate {
  const raw = readFileSync(fixturePath, "utf8");
  return parseStrengthWorkoutTemplate(JSON.parse(raw) as unknown);
}

function readRenderedExerciseNames(): string[] {
  const raw = readFileSync(renderedCatalogPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || !("namesFirstSeenOrder" in parsed)) {
    throw new Error("Rendered exercise catalog is missing namesFirstSeenOrder.");
  }
  const names = (parsed as { namesFirstSeenOrder?: unknown }).namesFirstSeenOrder;
  if (!Array.isArray(names)) {
    throw new Error("Rendered exercise catalog namesFirstSeenOrder must be an array.");
  }
  return names.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

async function promptForConfirmation(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    console.log("");
    console.log("###############################################");
    console.log("# WARNING: this WILL modify TrainingPeaks.    #");
    console.log("# Use only a safe test athlete and safe date. #");
    console.log("###############################################");
    console.log("");
    const answer = await rl.question(`Type exactly "${REQUIRED_CONFIRMATION}" to continue:\n`);
    if (answer.trim() !== REQUIRED_CONFIRMATION) {
      throw new Error("Typed confirmation did not match. Aborting apply mode.");
    }
  } finally {
    rl.close();
  }
}

async function waitForEnter(promptText: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${promptText}\n`);
  } finally {
    rl.close();
  }
}

async function saveScreenshot(page: Page, state: RunState, label: string): Promise<string> {
  await mkdir(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, `${label}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  const relative = relativizeArtifactPath(repoRoot, filePath);
  state.screenshots.push(relative);
  return relative;
}

async function locateBuilderRoot(page: Page): Promise<Locator | null> {
  const candidates = [
    page.getByRole("dialog").filter({ hasText: /Strength|Add Block|Search Exercises/i }).first(),
    page.locator("[data-testid*='strength']").first(),
    page.locator("section, div").filter({ hasText: /Add Block/i }).first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.first().isVisible().catch(() => false))) {
      return candidate.first();
    }
  }
  return null;
}

async function locateAddBlockButton(page: Page): Promise<Locator | null> {
  const candidates = [
    page.getByRole("button", { name: /Add Block/i }).first(),
    page.getByText(/^Add Block$/i).first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }
  return null;
}

async function openExistingBuilderIfPresent(page: Page, state: RunState): Promise<boolean> {
  const root = await locateBuilderRoot(page);
  if (root) {
    state.builderOpened = true;
    return true;
  }
  return false;
}

async function openBuilderFromCalendar(page: Page, state: RunState): Promise<boolean> {
  if (await openExistingBuilderIfPresent(page, state)) {
    return true;
  }

  const openButtons = [
    page.getByRole("button", { name: /Strength/i }).first(),
    page.getByRole("button", { name: /New Workout/i }).first(),
    page.getByText(/Strength/i).first(),
  ];

  for (const candidate of openButtons) {
    if ((await candidate.count()) === 0) continue;
    if (!(await candidate.isVisible().catch(() => false))) continue;
    await candidate.click().catch(() => {});
    await page.waitForTimeout(1200);
    if (await openExistingBuilderIfPresent(page, state)) {
      return true;
    }
  }

  state.errors.push("Could not confirm Strength Builder UI. Open the strength workout builder manually and rerun.");
  return false;
}

async function runManualBuilderGate(args: CliArgs): Promise<void> {
  console.log("");
  console.log("[tp-create-test-strength-workout] manual-builder mode");
  console.log("1) Open safe athlete calendar manually.");
  console.log(`2) Open date ${args.date}.`);
  console.log("3) Create/open a Strength workout for that date.");
  console.log("4) Open New Strength Builder.");
  console.log("5) Do NOT click Save.");
  console.log("");
  await waitForEnter("Press Enter once New Strength Builder is open.");
}

async function locateSearchInput(page: Page): Promise<Locator | null> {
  const candidates = [
    page.getByPlaceholder(/Search Exercises, Circuits, or Saved Items/i).first(),
    page.getByRole("textbox", { name: /Search Exercises, Circuits, or Saved Items/i }).first(),
    page.locator("input[placeholder*='Search Exercises']").first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }
  return null;
}

async function collectVisibleSearchResults(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const scopes = Array.from(document.querySelectorAll("div, li, button, span"));
    const collected: string[] = [];
    for (const element of scopes) {
      const text = element.textContent?.replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) continue;
      const style = window.getComputedStyle(element as Element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = (element as HTMLElement).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      collected.push(text);
    }
    return Array.from(new Set(collected)).slice(0, 40);
  });
  return texts;
}

async function clickExactSearchResult(page: Page, requestedName: string): Promise<ExactVisibleResultDecision> {
  const visibleTexts = await collectVisibleSearchResults(page);
  const decision = decideExactVisibleResult(requestedName, visibleTexts);
  if (decision.status !== "exact_one") {
    return decision;
  }

  const exactButton = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(requestedName)}$`, "i") }).first();
  if ((await exactButton.count()) > 0 && (await exactButton.isVisible().catch(() => false))) {
    await exactButton.click();
    return decision;
  }

  const exactText = page.getByText(new RegExp(`^${escapeRegExp(requestedName)}$`, "i")).first();
  if ((await exactText.count()) > 0 && (await exactText.isVisible().catch(() => false))) {
    await exactText.click();
    return decision;
  }

  return {
    ...decision,
    status: "missing",
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillFirstVisibleInput(candidates: Locator[], value: string): Promise<boolean> {
  for (const locator of candidates) {
    if ((await locator.count()) === 0) continue;
    const target = locator.first();
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click().catch(() => {});
    await target.fill(value).catch(async () => {
      await target.clear().catch(() => {});
      await target.type(value).catch(() => {});
    });
    return true;
  }
  return false;
}

async function fillMetricField(page: Page, metricType: StrengthWorkoutMetricType, metricValue: string): Promise<boolean> {
  const labelPattern = metricType === "duration" ? /Duration|Time|Seconds|Sec/i : /Reps|Count/i;
  const placeholderPattern = metricType === "duration" ? /sec|min|duration|time/i : /rep|count/i;
  return fillFirstVisibleInput(
    [
      page.getByLabel(labelPattern),
      page.getByPlaceholder(placeholderPattern),
      page.locator("input"),
    ],
    metricValue
  );
}

async function fillSetsField(page: Page, sets: string): Promise<boolean> {
  return fillFirstVisibleInput([page.getByLabel(/Sets/i), page.getByPlaceholder(/Sets/i)], sets);
}

async function fillNotesField(page: Page, notes: string): Promise<boolean> {
  return fillFirstVisibleInput(
    [page.getByLabel(/Notes|Coach Notes|Instructions/i), page.getByPlaceholder(/Notes|Coach Notes|Instructions/i), page.locator("textarea")],
    notes
  );
}

async function fillWorkoutTitle(page: Page, title: string): Promise<boolean> {
  return fillFirstVisibleInput(
    [page.getByLabel(/Title/i), page.getByPlaceholder(/Title/i), page.locator("input")],
    title
  );
}

async function fillWorkoutInstructions(page: Page, instructions: string): Promise<boolean> {
  return fillFirstVisibleInput(
    [page.getByLabel(/Instructions|Description|Coach Notes/i), page.getByPlaceholder(/Instructions|Description|Coach Notes/i), page.locator("textarea")],
    instructions
  );
}

async function readVisibleExerciseSnapshot(page: Page): Promise<VisibleExerciseSnapshot> {
  const texts = await page.evaluate(() => {
    const textNodes = Array.from(document.querySelectorAll("div, span, button, h1, h2, h3"));
    const values: string[] = [];
    for (const node of textNodes) {
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) continue;
      const rect = (node as HTMLElement).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      values.push(text);
    }
    return Array.from(new Set(values));
  });
  return { texts, count: texts.length };
}

function buildAttempt(exercise: StrengthWorkoutExerciseSpec & { blockName: string }): ExerciseAttempt {
  return {
    blockName: exercise.blockName,
    name: exercise.name,
    sets: exercise.sets,
    metricType: exercise.metricType,
    metricValue: exercise.metricValue,
    notes: exercise.notes,
    selectionStatus: "not_run",
    clicked: false,
    added: false,
    visibleExactMatches: [],
    visibleTextsSample: [],
    fieldWrite: {
      sets: "not_attempted",
      metric: "not_attempted",
      notes: exercise.notes ? "not_attempted" : "not_attempted",
    },
  };
}

async function ensurePickerReady(page: Page, state: RunState): Promise<Locator | null> {
  const addBlockButton = await locateAddBlockButton(page);
  if (!addBlockButton) {
    state.errors.push("Add Block button was not found.");
    return null;
  }
  state.addBlockButtonFound = true;
  await addBlockButton.click();
  await page.waitForTimeout(600);
  const searchInput = await locateSearchInput(page);
  if (!searchInput) {
    state.errors.push("Exercise picker search input was not found after Add Block.");
    return null;
  }
  state.pickerSearchFound = true;
  return searchInput;
}

async function populateExerciseCard(
  page: Page,
  attempt: ExerciseAttempt
): Promise<void> {
  const setsFilled = await fillSetsField(page, attempt.sets);
  attempt.fieldWrite.sets = setsFilled ? "yes" : "no";

  const metricFilled = await fillMetricField(page, attempt.metricType, attempt.metricValue);
  attempt.fieldWrite.metric = metricFilled ? "yes" : "no";

  if (attempt.notes) {
    const notesFilled = await fillNotesField(page, attempt.notes);
    attempt.fieldWrite.notes = notesFilled ? "yes" : "no";
  } else {
    attempt.fieldWrite.notes = "not_attempted";
  }
}

async function runDryRunFlow(
  page: Page,
  template: StrengthWorkoutTemplate,
  state: RunState,
  args: CliArgs
): Promise<void> {
  if (args.manualBuilder) {
    await runManualBuilderGate(args);
  }
  const opened = args.manualBuilder ? await openExistingBuilderIfPresent(page, state) : await openBuilderFromCalendar(page, state);
  if (!opened) {
    return;
  }
  await saveScreenshot(page, state, "dry-run-builder");

  const searchInput = await ensurePickerReady(page, state);
  if (!searchInput) {
    return;
  }
  await searchInput.fill("Glute Bridge");
  await page.waitForTimeout(900);
  const decision = decideExactVisibleResult("Glute Bridge", await collectVisibleSearchResults(page));
  state.attemptedExercises.push({
    blockName: template.blocks[1]?.name ?? "Activation",
    name: "Glute Bridge",
    sets: "2",
    metricType: "reps",
    metricValue: "15",
    selectionStatus: "not_run",
    clicked: false,
    added: false,
    visibleExactMatches: decision.exactVisibleMatches,
    visibleTextsSample: decision.visibleTexts.slice(0, 10),
    fieldWrite: {
      sets: "not_attempted",
      metric: "not_attempted",
      notes: "not_attempted",
    },
  });
  await saveScreenshot(page, state, "dry-run-picker");
}

async function runApplyFlow(
  page: Page,
  template: StrengthWorkoutTemplate,
  state: RunState,
  args: CliArgs
): Promise<void> {
  if (args.manualBuilder) {
    await runManualBuilderGate(args);
  }
  const opened = args.manualBuilder ? await openExistingBuilderIfPresent(page, state) : await openBuilderFromCalendar(page, state);
  if (!opened) {
    return;
  }

  await fillWorkoutTitle(page, template.title).catch(() => {});
  await fillWorkoutInstructions(page, template.workoutInstructions).catch(() => {});
  await saveScreenshot(page, state, "apply-before-add");

  for (const exercise of flattenWorkoutExercises(template)) {
    const attempt = buildAttempt(exercise);
    state.attemptedExercises.push(attempt);

    const searchInput = await ensurePickerReady(page, state);
    if (!searchInput) {
      break;
    }

    await searchInput.fill(exercise.name);
    await page.waitForTimeout(900);

    const decision = await clickExactSearchResult(page, exercise.name);
    attempt.selectionStatus = decision.status;
    attempt.visibleExactMatches = decision.exactVisibleMatches;
    attempt.visibleTextsSample = decision.visibleTexts.slice(0, 10);

    if (decision.status !== "exact_one") {
      state.errors.push(`Exact visible result was not unique for "${exercise.name}" (status: ${decision.status}).`);
      await saveScreenshot(page, state, `apply-ambiguous-${slugify(exercise.name)}`);
      return;
    }

    attempt.clicked = true;
    await page.waitForTimeout(700);
    await populateExerciseCard(page, attempt);
    attempt.added = true;
  }

  await saveScreenshot(page, state, "apply-before-save");
  const saveButton = page.getByRole("button", { name: /Save( and Close)?/i }).first();
  if ((await saveButton.count()) > 0 && (await saveButton.isVisible().catch(() => false))) {
    await saveButton.click();
    state.saveClicked = true;
    await page.waitForTimeout(1500);
    await saveScreenshot(page, state, "apply-after-save");
  } else {
    state.errors.push("Save button was not found.");
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item";
}

function buildVerification(
  template: StrengthWorkoutTemplate,
  snapshot: VisibleExerciseSnapshot,
  input: {
    mode: "dry-run" | "apply";
    manualBuilder: boolean;
    builderOpened: boolean;
    addBlockButtonFound: boolean;
    pickerSearchFound: boolean;
    hadErrors: boolean;
  }
): StrengthWorkoutRunSummary["verification"] {
  const expectedNames = flattenWorkoutExercises(template).map((entry) => entry.name);
  const expectedVisible = expectedNames.filter((name) => snapshot.texts.includes(name));
  const missingVisible = expectedNames.filter((name) => !snapshot.texts.includes(name));
  const titleVisible = snapshot.texts.includes(template.title);
  if (
    input.mode === "dry-run" &&
    input.manualBuilder &&
    input.builderOpened &&
    input.addBlockButtonFound &&
    input.pickerSearchFound &&
    !input.hadErrors
  ) {
    return {
      titleVisible,
      expectedExercisesVisible: expectedVisible,
      missingExercisesVisible: missingVisible,
      visibleExerciseCount: snapshot.count,
      unexpectedExerciseCheck: "Manual builder gate passed. UI is ready for apply probe.",
      status: "ready_for_apply",
    };
  }
  const status =
    titleVisible && missingVisible.length === 0
      ? "passed"
      : expectedVisible.length > 0 || titleVisible
        ? "partial"
        : "failed";

  return {
    titleVisible,
    expectedExercisesVisible: expectedVisible,
    missingExercisesVisible: missingVisible,
    visibleExerciseCount: snapshot.count,
    unexpectedExerciseCheck:
      missingVisible.length === 0
        ? "No missing expected names in visible text snapshot."
        : "Visible text snapshot is incomplete or some expected names are missing.",
    status,
  };
}

async function writeArtifacts(summary: StrengthWorkoutRunSummary): Promise<void> {
  await mkdir(defaultOutDir, { recursive: true });
  await writeFile(logPath, `${JSON.stringify(redactUnknown(summary), null, 2)}\n`, "utf8");
  await writeFile(summaryPath, buildStrengthWorkoutSummaryMarkdown(summary), "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const template = readWorkoutTemplate();
  const renderedNames = readRenderedExerciseNames();
  const preflight = buildCatalogPreflight(template, renderedNames);
  const athleteUrlRedacted = sanitizeAthleteUrl(args.athleteUrl);

  console.log(`[tp-create-test-strength-workout] mode: ${args.mode}`);
  console.log(`[tp-create-test-strength-workout] athlete: ${athleteUrlRedacted}`);
  console.log(`[tp-create-test-strength-workout] date: ${args.date}`);
  console.log(`[tp-create-test-strength-workout] title: ${template.title}`);
  console.log(`[tp-create-test-strength-workout] manual-builder: ${args.manualBuilder ? "yes" : "no"}`);
  console.log(`[tp-create-test-strength-workout] exercises: ${preflight.requestedNames.join(", ")}`);
  console.log("[tp-create-test-strength-workout] WARNING: TrainingPeaks may be changed only in --apply mode after typed confirmation.");

  if (args.mode === "apply") {
    await promptForConfirmation();
  }

  await mkdir(profileDir, { recursive: true });
  await mkdir(defaultOutDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });

  const state: RunState = {
    warnings: [],
    errors: [],
    screenshots: [],
    attemptedExercises: [],
    builderOpened: false,
    addBlockButtonFound: false,
    pickerSearchFound: false,
    saveClicked: false,
  };

  if (preflight.missingNames.length > 0) {
    state.errors.push(`Local rendered catalog missing exact exercise names: ${preflight.missingNames.join(", ")}`);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  let verificationSnapshot: VisibleExerciseSnapshot = { texts: [], count: 0 };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    await page.waitForTimeout(2000);
    await saveScreenshot(page, state, "calendar-home");

    if (args.mode === "dry-run") {
      await runDryRunFlow(page, template, state, args);
    } else if (state.errors.length === 0) {
      await runApplyFlow(page, template, state, args);
    }

    verificationSnapshot = await readVisibleExerciseSnapshot(page);
  } finally {
    await context.close().catch(() => {});
  }

  const summary: StrengthWorkoutRunSummary = {
    runAt: new Date().toISOString(),
    mode: args.mode,
    athleteUrlRedacted,
    targetDate: args.date,
    title: template.title,
    saveClicked: state.saveClicked,
    builderOpened: state.builderOpened,
    addBlockButtonFound: state.addBlockButtonFound,
    pickerSearchFound: state.pickerSearchFound,
    localCatalogPreflight: preflight,
    attemptedExercises: state.attemptedExercises,
    verification: buildVerification(template, verificationSnapshot, {
      mode: args.mode,
      manualBuilder: args.manualBuilder,
      builderOpened: state.builderOpened,
      addBlockButtonFound: state.addBlockButtonFound,
      pickerSearchFound: state.pickerSearchFound,
      hadErrors: state.errors.length > 0,
    }),
    screenshots: state.screenshots,
    warnings: state.warnings,
    errors: state.errors,
  };

  await writeArtifacts(summary);

  console.log("");
  console.log("[tp-create-test-strength-workout] complete.");
  console.log(`- summary: ${relativizeArtifactPath(repoRoot, summaryPath)}`);
  console.log(`- log: ${relativizeArtifactPath(repoRoot, logPath)}`);
  console.log(`- screenshots: ${relativizeArtifactPath(repoRoot, screenshotDir)}`);
  console.log(`- verification: ${summary.verification.status}`);
  console.log(`- save clicked: ${summary.saveClicked ? "yes" : "no"}`);
  if (summary.errors.length > 0) {
    console.log(`- errors: ${summary.errors.length}`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-create-test-strength-workout failed.");
  console.error(error);
  process.exit(1);
});
