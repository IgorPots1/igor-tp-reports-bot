import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Locator, type Page } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import {
  assertVisualFieldEvidenceBrowserScriptIsSafe,
  collectVisualFieldEvidence,
} from "./lib/strength-visual-field-evidence-scrape.ts";
import { redactUnknown } from "./lib/trainingpeaks-api-move.ts";
import {
  buildCatalogPreflight,
  buildStrengthWorkoutSummaryMarkdown,
  flattenWorkoutExercises,
  isWrittenFieldStatus,
  normalizeVisibleText,
  parseStrengthWorkoutTemplate,
  relativizeArtifactPath,
  sanitizeAthleteUrl,
  type ExactVisibleResultDecision,
  type FieldWriteResult,
  type FieldWriteStatus,
  type StrengthWorkoutExerciseSpec,
  type StrengthWorkoutRunSummary,
  type StrengthWorkoutTemplate,
} from "./lib/strength-workout-ui-writer.ts";

const TP_APP_HOST = "https://app.trainingpeaks.com";
const repoRoot = path.resolve(toolRoot, "..", "..");
const defaultFixturePath = path.join(toolRoot, "scripts", "fixtures", "strength-workout-template.fixture.json");
const minimalFixturePath = path.join(
  toolRoot,
  "scripts",
  "fixtures",
  "strength-workout-template.minimal-strength.fixture.json"
);
const runnerStrengthFieldsProbeFixturePath = path.join(
  toolRoot,
  "scripts",
  "fixtures",
  "strength-workout-template.runner-strength-fields-probe.fixture.json"
);
const visualFieldProbeFixturePath = path.join(
  toolRoot,
  "scripts",
  "fixtures",
  "strength-workout-template.visual-field-probe.fixture.json"
);
const renderedCatalogPath = path.join(repoRoot, "reports", "strength-builder-ai-audit-input", "raw-rendered-exercises.json");
const defaultOutDir = path.join(repoRoot, "reports", "strength-builder-create-test-workout");
const summaryPath = path.join(defaultOutDir, "CREATE_TEST_WORKOUT_SUMMARY.md");
const logPath = path.join(defaultOutDir, "create-test-workout-log.json");
const screenshotDir = path.join(defaultOutDir, "screenshots");
const fieldDebugDir = path.join(defaultOutDir, "field-debug");
const REQUIRED_CONFIRMATION = "CREATE TEST STRENGTH WORKOUT";

type CliArgs = {
  athleteUrl: string;
  date: string;
  headless: boolean;
  mode: "dry-run" | "apply";
  manualBuilder: boolean;
  template: "default" | "minimal-strength" | "runner-strength-fields-probe" | "visual-field-probe";
  visualConfirmBeforeSave: boolean;
  nonInteractive: boolean;
  manualBuilderTimeoutSeconds: number;
  applyConfirmation?: string;
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
  selectionStatus: ExactVisibleResultDecision["status"] | "not_run";
  clicked: boolean;
  wouldClick?: boolean;
  exactMatchClicked?: string;
  added: boolean;
  visibleExactMatches: string[];
  visibleTextsSample: string[];
  inputValueAfterTyping?: string;
  candidateRows?: string[];
  fields: {
    sets: FieldWriteResult;
    reps: FieldWriteResult;
    duration: FieldWriteResult;
    coachNote: FieldWriteResult;
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
  visualFieldVerification?: StrengthWorkoutRunSummary["visualFieldVerification"];
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
  console.log(
    "  --template <name>      default | minimal-strength | runner-strength-fields-probe | visual-field-probe"
  );
  console.log("  --visual-confirm-before-save  Pause before Save and wait for typed confirmation");
  console.log("  --pause-before-save           Alias for --visual-confirm-before-save");
  console.log("  --non-interactive      Do not wait for Enter/typed prompt");
  console.log("  --manual-builder-timeout-seconds <n>  Wait window for manual builder open (default: 120)");
  console.log(`  --apply-confirmation   Required with --apply --non-interactive; exact value: ${REQUIRED_CONFIRMATION}`);
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
    template: "default",
    visualConfirmBeforeSave: false,
    nonInteractive: false,
    manualBuilderTimeoutSeconds: 120,
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
    if (arg === "--visual-confirm-before-save" || arg === "--pause-before-save") {
      parsed.visualConfirmBeforeSave = true;
      continue;
    }
    if (arg === "--non-interactive") {
      parsed.nonInteractive = true;
      continue;
    }
    if (arg.startsWith("--manual-builder-timeout-seconds=")) {
      const raw = arg.slice("--manual-builder-timeout-seconds=".length).trim();
      const parsedSeconds = Number(raw);
      if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
        throw new Error(`Invalid --manual-builder-timeout-seconds value "${raw}". Use a positive number.`);
      }
      parsed.manualBuilderTimeoutSeconds = Math.floor(parsedSeconds);
      continue;
    }
    if (arg === "--manual-builder-timeout-seconds") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --manual-builder-timeout-seconds");
      const parsedSeconds = Number(next.trim());
      if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
        throw new Error(`Invalid --manual-builder-timeout-seconds value "${next}". Use a positive number.`);
      }
      parsed.manualBuilderTimeoutSeconds = Math.floor(parsedSeconds);
      index += 1;
      continue;
    }
    if (arg.startsWith("--apply-confirmation=")) {
      parsed.applyConfirmation = arg.slice("--apply-confirmation=".length).trim();
      continue;
    }
    if (arg === "--apply-confirmation") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --apply-confirmation");
      parsed.applyConfirmation = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--template=")) {
      const value = arg.slice("--template=".length).trim();
      if (
        value !== "default" &&
        value !== "minimal-strength" &&
        value !== "runner-strength-fields-probe" &&
        value !== "visual-field-probe"
      ) {
        throw new Error(`Unsupported --template value "${value}".`);
      }
      parsed.template = value;
      continue;
    }
    if (arg === "--template") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --template");
      const value = next.trim();
      if (
        value !== "default" &&
        value !== "minimal-strength" &&
        value !== "runner-strength-fields-probe" &&
        value !== "visual-field-probe"
      ) {
        throw new Error(`Unsupported --template value "${value}".`);
      }
      parsed.template = value;
      index += 1;
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
  if (parsed.mode === "apply" && parsed.nonInteractive && parsed.applyConfirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `--apply --non-interactive requires --apply-confirmation "${REQUIRED_CONFIRMATION}" (exact match).`
    );
  }

  return parsed as CliArgs;
}

function fixturePathForTemplate(template: CliArgs["template"]): string {
  if (template === "minimal-strength") return minimalFixturePath;
  if (template === "runner-strength-fields-probe") return runnerStrengthFieldsProbeFixturePath;
  if (template === "visual-field-probe") return visualFieldProbeFixturePath;
  return defaultFixturePath;
}

function readWorkoutTemplate(template: CliArgs["template"]): StrengthWorkoutTemplate {
  const raw = readFileSync(fixturePathForTemplate(template), "utf8");
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

async function promptForConfirmation(args: CliArgs): Promise<void> {
  if (args.nonInteractive) {
    if (args.applyConfirmation !== REQUIRED_CONFIRMATION) {
      throw new Error("Non-interactive apply confirmation mismatch. Aborting apply mode.");
    }
    return;
  }
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

async function waitForTypedYes(promptText: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${promptText}\n`);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function sanitizeDebugText(value: string | null | undefined, maxLength = 240): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function saveScreenshot(page: Page, state: RunState, label: string): Promise<string> {
  await mkdir(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, `${label}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  const relative = relativizeArtifactPath(repoRoot, filePath);
  state.screenshots.push(relative);
  return relative;
}

async function saveFieldDebug(page: Page, exerciseName: string, reason: string): Promise<string> {
  await mkdir(fieldDebugDir, { recursive: true });
  const filePath = path.join(fieldDebugDir, `${slugify(exerciseName)}-${slugify(reason)}.json`);
  const payload = await page.evaluate((targetExerciseName) => {
    const blocks = Array.from(
      document.querySelectorAll("section,article,div,li,tr,[role='row'],[role='group'],[data-testid]")
    );
    const matched = blocks.find((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim().includes(targetExerciseName));
    const host = matched ?? document.body;
    const textSample = ((host.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 1200);
    const possibleLabels = Array.from(host.querySelectorAll("label, [aria-label], [title], [data-testid], th, dt, strong"))
      .map((node) => {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        const aria = node.getAttribute("aria-label") ?? "";
        const title = node.getAttribute("title") ?? "";
        return `${text} ${aria} ${title}`.replace(/\s+/g, " ").trim();
      })
      .filter((entry) => entry.length >= 3)
      .slice(0, 40);
    const inputs = Array.from(host.querySelectorAll("input"))
      .slice(0, 40)
      .map((node) => {
        const el = node as HTMLElement;
        const inputEl = node as HTMLInputElement;
        const rect = el.getBoundingClientRect();
        return {
          index: -1,
          type: inputEl.type,
          ariaLabel: inputEl.getAttribute("aria-label") ?? undefined,
          placeholder: inputEl.getAttribute("placeholder") ?? undefined,
          title: inputEl.getAttribute("title") ?? undefined,
          value: "value" in inputEl ? String(inputEl.value ?? "").slice(0, 180) : undefined,
          nearbyText: ((el.closest("label, td, th, div, section, article")?.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 240),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    const textareas = Array.from(host.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']"))
      .slice(0, 20)
      .map((node) => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        const textareaEl = node as HTMLTextAreaElement;
        return {
          index: -1,
          ariaLabel: textareaEl.getAttribute("aria-label") ?? undefined,
          placeholder: textareaEl.getAttribute("placeholder") ?? undefined,
          title: textareaEl.getAttribute("title") ?? undefined,
          value: ("value" in textareaEl ? String(textareaEl.value ?? "") : String(textareaEl.textContent ?? "")).slice(0, 180),
          nearbyText: ((el.closest("label, td, th, div, section, article")?.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 240),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    const buttons = Array.from(host.querySelectorAll("button, [role='button']"))
      .slice(0, 20)
      .map((node) => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        return {
          index: -1,
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
          ariaLabel: el.getAttribute("aria-label") ?? undefined,
          title: el.getAttribute("title") ?? undefined,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    for (let index = 0; index < inputs.length; index += 1) inputs[index].index = index;
    for (let index = 0; index < textareas.length; index += 1) textareas[index].index = index;
    for (let index = 0; index < buttons.length; index += 1) buttons[index].index = index;
    return {
      exerciseName: targetExerciseName,
      blockTextSample: textSample ? textSample.split(" ").slice(0, 80) : [],
      inputs,
      textareas,
      buttons,
      possibleLabels,
    };
  }, exerciseName);
  await writeFile(filePath, `${JSON.stringify(redactUnknown(payload), null, 2)}\n`, "utf8");
  return relativizeArtifactPath(repoRoot, filePath);
}

function buildMissingAfterSaveVisual(
  beforeSave: NonNullable<StrengthWorkoutRunSummary["visualFieldVerification"]>["beforeSave"]
): NonNullable<StrengthWorkoutRunSummary["visualFieldVerification"]>["afterSave"] {
  return {
    fieldsVisible: false,
    notesVisible: false,
    details: beforeSave.details.map((entry) => ({
      ...entry,
      setsVisible: false,
      repsVisible: false,
      durationVisible: false,
      noteVisible: false,
    })),
  };
}

async function closeAndReopenWorkoutIfPossible(page: Page, title: string): Promise<boolean> {
  const closeButton = page.getByRole("button", { name: /Close|Done/i }).first();
  if ((await closeButton.count()) > 0 && (await closeButton.isVisible().catch(() => false))) {
    await closeButton.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  const openCandidates = [page.getByText(new RegExp(escapeRegex(title), "i")).first(), page.getByRole("button", { name: title }).first()];
  for (const candidate of openCandidates) {
    if ((await candidate.count()) === 0) continue;
    if (!(await candidate.isVisible().catch(() => false))) continue;
    await candidate.click().catch(() => {});
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
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
  if (args.nonInteractive) {
    console.log("[tp-create-test-strength-workout] non-interactive manual gate: continuing without Enter prompt.");
    return;
  }
  await waitForEnter("Press Enter once New Strength Builder is open.");
}

async function waitForManualBuilderOpen(page: Page, state: RunState, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await openExistingBuilderIfPresent(page, state)) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
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

async function collectCandidateRows(page: Page): Promise<string[]> {
  const optionRows = page.locator("[role='option']");
  const count = await optionRows.count();
  const rows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = optionRows.nth(index);
    const visible = await row.isVisible().catch(() => false);
    if (!visible) continue;
    const text = normalizeVisibleText(await row.innerText().catch(() => ""));
    if (!text || text.length > 140) continue;
    rows.push(text);
  }
  return rows.slice(0, 30);
}

type PickerSelectionResult = {
  decision: ExactVisibleResultDecision;
  clicked: boolean;
};

async function clickExactSearchResult(page: Page, requestedName: string, shouldClick: boolean): Promise<PickerSelectionResult> {
  const candidateRows = await collectCandidateRows(page);
  const normalizedRequested = normalizeVisibleText(requestedName);
  const matchingIndexes = candidateRows
    .map((text, index) => ({ text, index }))
    .filter((entry) => normalizeVisibleText(entry.text) === normalizedRequested);
  const exactVisibleMatches = matchingIndexes.map((entry) => entry.text);

  const decision: ExactVisibleResultDecision = {
    requestedName,
    exactVisibleMatches,
    visibleTexts: candidateRows,
    status: matchingIndexes.length === 1 ? "exact" : matchingIndexes.length > 1 ? "ambiguous" : "missing",
  };

  if (!shouldClick || decision.status !== "exact") {
    return { decision, clicked: false };
  }

  const targetIndex = matchingIndexes[0]?.index;
  if (targetIndex === undefined) {
    return { decision: { ...decision, status: "missing" }, clicked: false };
  }

  const targetRow = page.locator("[role='option']").nth(targetIndex);
  if (!(await targetRow.isVisible().catch(() => false))) {
    return { decision: { ...decision, status: "missing" }, clicked: false };
  }

  const textBeforeClick = normalizeVisibleText(await targetRow.innerText().catch(() => ""));
  if (textBeforeClick !== normalizedRequested) {
    return { decision: { ...decision, status: "missing" }, clicked: false };
  }

  await targetRow.click();
  return { decision, clicked: true };
}

async function writeFieldValueInScope(
  scope: Locator,
  options: { labels?: RegExp; placeholders?: RegExp; allowTextarea?: boolean; allowAnyInput?: boolean },
  value: string
): Promise<{ ok: boolean; readBack?: string; selectorHint?: string }> {
  const candidates: Array<{ locator: Locator; selectorHint: string }> = [];
  if (options.labels) {
    candidates.push({ locator: scope.getByLabel(options.labels), selectorHint: `label:${options.labels.source}` });
  }
  if (options.placeholders) {
    candidates.push({ locator: scope.getByPlaceholder(options.placeholders), selectorHint: `placeholder:${options.placeholders.source}` });
  }
  if (options.allowTextarea) {
    candidates.push({ locator: scope.locator("textarea"), selectorHint: "textarea" });
  }
  if (options.allowAnyInput) {
    candidates.push({ locator: scope.locator("input"), selectorHint: "input" });
  }

  for (const candidate of candidates) {
    const count = await candidate.locator.count();
    for (let index = 0; index < count; index += 1) {
      const target = candidate.locator.nth(index);
      if (!(await target.isVisible().catch(() => false))) continue;
      await target.click().catch(() => {});
      const writeOk = await target
        .fill(value)
        .then(() => true)
        .catch(async () => {
          await target.clear().catch(() => {});
          return target.type(value).then(() => true).catch(() => false);
        });
      if (!writeOk) continue;
      const readBack =
        (await target.inputValue().catch(async () => target.textContent().catch(() => "")))?.replace(/\s+/g, " ").trim() || undefined;
      return { ok: true, readBack, selectorHint: candidate.selectorHint };
    }
  }
  return { ok: false };
}

type SemanticFieldKind = "sets" | "reps" | "duration" | "coachNote";

type SemanticFieldWriteAttempt = {
  status: FieldWriteStatus;
  readBack?: string;
  selectorHint?: string;
  detail?: string;
};

type SemanticFieldOptions = {
  kind: SemanticFieldKind;
  value: string;
  labelTokens: string[];
  placeholderTokens: string[];
  ariaTokens: string[];
  inputTypeAllowList?: string[];
  allowTextarea?: boolean;
  allowContentEditable?: boolean;
};

function isTimePlaceholderLike(value: string | undefined): boolean {
  const normalized = sanitizeDebugText(value).toLowerCase();
  return (
    normalized === "hh:mm:ss" ||
    normalized === "mm:ss" ||
    normalized === "h:mm:ss" ||
    normalized.includes("hh:mm:ss")
  );
}

function normalizeDurationVariants(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return [value];
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return [
    `${seconds}`,
    `${seconds} sec`,
    `${seconds} secs`,
    `${seconds} second`,
    `${seconds} seconds`,
    `${seconds}s`,
    `${mm}:${String(ss).padStart(2, "0")}`,
    `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`,
    `00:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`,
  ];
}

async function isValueVisibleInBlock(
  block: Locator,
  kind: SemanticFieldKind,
  expected: string
): Promise<boolean> {
  const expectedVariants = kind === "duration" ? normalizeDurationVariants(expected) : [expected];
  return block.evaluate(
    (host, input) => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
      const haystackParts: string[] = [];
      const hostText = (host.textContent ?? "").replace(/\s+/g, " ").trim();
      if (hostText) haystackParts.push(hostText);
      const controls = Array.from(host.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']"));
      for (const node of controls) {
        const inputEl = node as HTMLInputElement;
        const value =
          "value" in inputEl
            ? String(inputEl.value ?? "")
            : String((node as HTMLElement).textContent ?? "");
        if (value.trim()) haystackParts.push(value);
      }
      const haystack = normalize(haystackParts.join(" | "));
      return input.expectedVariants.some((variant) => normalize(variant) && haystack.includes(normalize(variant)));
    },
    { expectedVariants }
  );
}

async function revealExercisePanel(block: Locator): Promise<void> {
  const toggles = [
    block.locator("button[aria-expanded='false']").first(),
    block.locator("[role='button'][aria-expanded='false']").first(),
    block.getByRole("button", { name: /Expand|Show More|More/i }).first(),
  ];
  for (const toggle of toggles) {
    if ((await toggle.count()) === 0) continue;
    if (!(await toggle.isVisible().catch(() => false))) continue;
    await toggle.click().catch(() => {});
    await block.page().waitForTimeout(250);
  }
}

async function revealCoachNotesEditor(block: Locator): Promise<void> {
  const candidates = [
    block.getByRole("button", { name: /Add Note|Coach Notes?|Notes?|Instructions?/i }).first(),
    block.getByText(/Add Note|Coach Notes?|Notes?|Instructions?/i).first(),
  ];
  for (const target of candidates) {
    if ((await target.count()) === 0) continue;
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click().catch(() => {});
    await block.page().waitForTimeout(250);
  }
}

async function writeSemanticFieldInExerciseBlock(
  block: Locator,
  options: SemanticFieldOptions
): Promise<SemanticFieldWriteAttempt> {
  const result = await block.evaluate(
    (host, input) => {
      const normalize = (value: unknown) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const compact = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
      const tokenMatch = (value: string, tokens: string[]) => {
        const normalizedValue = normalize(value);
        return tokens.some((token) => normalizedValue.includes(normalize(token)));
      };
      const controls = Array.from(
        host.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']")
      ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLElement>;
      const scored = controls
        .map((node, index) => {
          const tag = node.tagName.toLowerCase();
          const type = tag === "input" ? normalize((node as HTMLInputElement).type || "text") : "";
          if (input.inputTypeAllowList?.length && tag === "input" && !input.inputTypeAllowList.includes(type || "text")) {
            return null;
          }
          if (!input.allowTextarea && tag === "textarea") return null;
          if (!input.allowContentEditable && node.getAttribute("contenteditable") === "true") return null;
          const ariaLabel = compact(node.getAttribute("aria-label"));
          const placeholder = compact(node.getAttribute("placeholder"));
          const title = compact(node.getAttribute("title"));
          const ownValue =
            "value" in node ? compact((node as HTMLInputElement | HTMLTextAreaElement).value) : compact(node.textContent);
          const containerText = compact(node.closest("label, td, th, div, section, article, li, tr")?.textContent ?? "");
          const signatures = [ariaLabel, placeholder, title, containerText].filter(Boolean).join(" | ");
          let score = 0;
          if (tokenMatch(ariaLabel, input.ariaTokens)) score += 50;
          if (tokenMatch(placeholder, input.placeholderTokens)) score += 45;
          if (tokenMatch(signatures, input.labelTokens)) score += 35;
          if (tokenMatch(containerText, input.labelTokens)) score += 25;
          if (input.kind === "coachNote" && tag === "textarea") score += 20;
          if (input.kind !== "coachNote" && tag === "input") score += 10;
          if (ownValue && tokenMatch(ownValue, ["hh:mm:ss"]) && input.kind !== "duration") score -= 60;
          return {
            index,
            score,
            tag,
            type,
            ariaLabel,
            placeholder,
            title,
            containerText: containerText.slice(0, 220),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const top = scored[0];
      if (!top) {
        return { ok: false, detail: "No semantic field candidate found." };
      }
      const target = controls[top.index];
      const asInput = target as HTMLInputElement;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      (target as HTMLElement).focus();
      if ("value" in asInput) {
        asInput.value = "";
        asInput.dispatchEvent(new Event("input", { bubbles: true }));
        asInput.value = input.value;
        asInput.dispatchEvent(new Event("input", { bubbles: true }));
        asInput.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        (target as HTMLElement).textContent = input.value;
        target.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      (target as HTMLElement).blur();
      const readBack = "value" in asInput ? compact(asInput.value) : compact((target as HTMLElement).textContent);
      return {
        ok: true,
        readBack,
        selectorHint: `${top.tag}:${top.type || "n/a"}:${top.ariaLabel || top.placeholder || "no-label"}`,
      };
    },
    options
  );

  if (!result.ok) {
    return {
      status: "not_found",
      detail: result.detail ?? "Semantic field candidate not found in exercise block.",
    };
  }

  const readBack = sanitizeDebugText(result.readBack);
  if (options.kind !== "duration" && isTimePlaceholderLike(readBack)) {
    return {
      status: "wrong_field",
      readBack,
      selectorHint: result.selectorHint,
      detail: `Read-back looks like a time placeholder (${readBack}).`,
    };
  }

  const matchesExpected =
    options.kind === "duration"
      ? normalizeDurationVariants(options.value).some((variant) =>
          sanitizeDebugText(readBack).toLowerCase().includes(variant.toLowerCase())
        )
      : sanitizeDebugText(readBack).toLowerCase() === sanitizeDebugText(options.value).toLowerCase();
  if (!matchesExpected) {
    return {
      status: "failed",
      readBack,
      selectorHint: result.selectorHint,
      detail: `Read-back mismatch. Expected "${options.value}", got "${readBack || "<empty>"}".`,
    };
  }

  const visible = await isValueVisibleInBlock(block, options.kind, options.value);
  return {
    status: visible ? "written_visible" : "written_but_not_visible",
    readBack,
    selectorHint: result.selectorHint,
    detail: visible ? undefined : "Value read back but not visibly rendered in exercise block.",
  };
}

function emptyField(required: boolean, value?: string): FieldWriteResult {
  return { attempted: false, required, status: "not_attempted", value };
}

async function fillWorkoutTitle(page: Page, title: string): Promise<boolean> {
  const scope = page.locator("body").first();
  const result = await writeFieldValueInScope(scope, { labels: /Title/i, placeholders: /Title/i, allowAnyInput: true }, title);
  return result.ok;
}

async function fillWorkoutInstructions(page: Page, instructions: string): Promise<boolean> {
  const scope = page.locator("body").first();
  const result = await writeFieldValueInScope(
    scope,
    { labels: /Instructions|Description|Coach Notes/i, placeholders: /Instructions|Description|Coach Notes/i, allowTextarea: true },
    instructions
  );
  return result.ok;
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
    selectionStatus: "not_run",
    clicked: false,
    added: false,
    visibleExactMatches: [],
    visibleTextsSample: [],
    fields: {
      sets: emptyField(true, exercise.sets),
      reps: emptyField(Boolean(exercise.reps), exercise.reps),
      duration: emptyField(Boolean(exercise.durationSeconds), exercise.durationSeconds),
      coachNote: emptyField(Boolean(exercise.coachNote), exercise.coachNote),
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

async function locateExerciseBlock(page: Page, exerciseName: string): Promise<Locator | null> {
  const normalized = normalizeVisibleText(exerciseName);
  const candidates = [
    page
      .locator("section,article,li,tr,[role='row'],[role='group'],[data-testid],div")
      .filter({ hasText: new RegExp(`^\\s*${escapeRegex(normalized)}\\s*$`, "i") })
      .filter({ has: page.locator("input, textarea, [contenteditable='true'], [role='textbox'], button") }),
    page
      .locator("section,article,li,tr,[role='row'],[role='group'],[data-testid],div")
      .filter({ hasText: new RegExp(escapeRegex(normalized), "i") })
      .filter({ has: page.locator("input, textarea, [contenteditable='true'], [role='textbox'], button") }),
  ];
  for (const candidate of candidates) {
    const count = await candidate.count();
    let best: { index: number; textLength: number } | null = null;
    for (let index = 0; index < count; index += 1) {
      const item = candidate.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      const textLength = sanitizeDebugText(await item.innerText().catch(() => ""), 4000).length;
      if (!best || textLength < best.textLength) {
        best = { index, textLength };
      }
    }
    if (best) {
      const located = candidate.nth(best.index);
      await revealExercisePanel(located);
      return located;
    }
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markNotFound(field: FieldWriteResult, detail: string): void {
  field.attempted = true;
  field.status = "not_found";
  field.detail = detail;
}

async function populateExerciseCard(page: Page, exercise: StrengthWorkoutExerciseSpec, attempt: ExerciseAttempt): Promise<void> {
  const block = await locateExerciseBlock(page, attempt.name);
  if (!block) {
    markNotFound(attempt.fields.sets, "Exercise block not located.");
    if (attempt.fields.reps.required) markNotFound(attempt.fields.reps, "Exercise block not located.");
    if (attempt.fields.duration.required) markNotFound(attempt.fields.duration, "Exercise block not located.");
    if (attempt.fields.coachNote.required) markNotFound(attempt.fields.coachNote, "Exercise block not located.");
    return;
  }

  const setsResult = await writeSemanticFieldInExerciseBlock(block, {
    kind: "sets",
    value: attempt.sets,
    labelTokens: ["sets"],
    placeholderTokens: ["sets", "set"],
    ariaTokens: ["sets"],
    inputTypeAllowList: ["text", "number", "tel", "search"],
  });
  attempt.fields.sets.attempted = true;
  attempt.fields.sets.status = setsResult.status;
  attempt.fields.sets.readBack = setsResult.readBack;
  attempt.fields.sets.selectorHint = setsResult.selectorHint;
  attempt.fields.sets.detail = setsResult.detail;

  if (exercise.reps) {
    const repsResult = await writeSemanticFieldInExerciseBlock(block, {
      kind: "reps",
      value: exercise.reps,
      labelTokens: ["reps", "rep", "count"],
      placeholderTokens: ["reps", "rep", "count"],
      ariaTokens: ["reps", "rep", "count"],
      inputTypeAllowList: ["text", "number", "tel", "search"],
    });
    attempt.fields.reps.attempted = true;
    attempt.fields.reps.status = repsResult.status;
    attempt.fields.reps.readBack = repsResult.readBack;
    attempt.fields.reps.selectorHint = repsResult.selectorHint;
    attempt.fields.reps.detail = repsResult.detail;
  } else {
    attempt.fields.reps.status = "unsupported";
    attempt.fields.reps.detail = "Template does not require reps for this exercise.";
  }

  if (exercise.durationSeconds) {
    const durationResult = await writeSemanticFieldInExerciseBlock(block, {
      kind: "duration",
      value: exercise.durationSeconds,
      labelTokens: ["duration", "time", "seconds", "sec"],
      placeholderTokens: ["duration", "time", "sec", "hh:mm:ss", "mm:ss"],
      ariaTokens: ["duration", "time", "seconds", "sec"],
      inputTypeAllowList: ["text", "number", "tel", "search", "time"],
    });
    attempt.fields.duration.attempted = true;
    attempt.fields.duration.status = durationResult.status;
    attempt.fields.duration.readBack = durationResult.readBack;
    attempt.fields.duration.selectorHint = durationResult.selectorHint;
    attempt.fields.duration.detail = durationResult.detail;
  } else {
    attempt.fields.duration.status = "unsupported";
    attempt.fields.duration.detail = "Template does not require duration for this exercise.";
  }

  if (exercise.coachNote) {
    await revealCoachNotesEditor(block);
    const noteResult = await writeSemanticFieldInExerciseBlock(block, {
      kind: "coachNote",
      value: exercise.coachNote,
      labelTokens: ["coach note", "notes", "note", "instruction", "instructions"],
      placeholderTokens: ["coach note", "notes", "instruction"],
      ariaTokens: ["coach note", "notes", "instruction"],
      allowTextarea: true,
      allowContentEditable: true,
      inputTypeAllowList: ["text", "search"],
    });
    attempt.fields.coachNote.attempted = true;
    attempt.fields.coachNote.status = noteResult.status;
    attempt.fields.coachNote.readBack = noteResult.readBack;
    attempt.fields.coachNote.selectorHint = noteResult.selectorHint;
    attempt.fields.coachNote.detail = noteResult.detail;
  } else {
    attempt.fields.coachNote.status = "unsupported";
    attempt.fields.coachNote.detail = "Template does not require coach note for this exercise.";
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
  const opened = args.manualBuilder
    ? args.nonInteractive
      ? await waitForManualBuilderOpen(page, state, args.manualBuilderTimeoutSeconds * 1000)
      : await openExistingBuilderIfPresent(page, state)
    : await openBuilderFromCalendar(page, state);
  if (!opened) {
    if (args.manualBuilder && args.nonInteractive) {
      state.errors.push(
        `Manual builder was not detected within timeout (${args.manualBuilderTimeoutSeconds}s).`
      );
    }
    return;
  }
  await saveScreenshot(page, state, "dry-run-builder");

  const searchInput = await ensurePickerReady(page, state);
  if (!searchInput) {
    return;
  }
  const firstExerciseName = flattenWorkoutExercises(template)[0]?.name ?? "Glute Bridge";
  await searchInput.fill(firstExerciseName);
  await page.waitForTimeout(900);
  const typedValue = await searchInput.inputValue().catch(() => "");
  const pickerDecision = await clickExactSearchResult(page, firstExerciseName, false);
  state.attemptedExercises.push({
    blockName: template.blocks[1]?.name ?? "Activation",
    name: firstExerciseName,
    sets: flattenWorkoutExercises(template)[0]?.sets ?? "2",
    clicked: false,
    added: false,
    selectionStatus: pickerDecision.decision.status,
    wouldClick: pickerDecision.decision.status === "exact",
    visibleExactMatches: pickerDecision.decision.exactVisibleMatches,
    visibleTextsSample: pickerDecision.decision.visibleTexts.slice(0, 10),
    inputValueAfterTyping: typedValue,
    candidateRows: pickerDecision.decision.visibleTexts,
    fields: {
      sets: emptyField(true),
      reps: emptyField(false),
      duration: emptyField(false),
      coachNote: emptyField(false),
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
  const opened = args.manualBuilder
    ? args.nonInteractive
      ? await waitForManualBuilderOpen(page, state, args.manualBuilderTimeoutSeconds * 1000)
      : await openExistingBuilderIfPresent(page, state)
    : await openBuilderFromCalendar(page, state);
  if (!opened) {
    if (args.manualBuilder && args.nonInteractive) {
      state.errors.push(
        `Manual builder was not detected within timeout (${args.manualBuilderTimeoutSeconds}s).`
      );
    }
    return;
  }

  await fillWorkoutTitle(page, template.title).catch(() => {});
  await fillWorkoutInstructions(page, template.workoutInstructions).catch(() => {});
  await saveScreenshot(page, state, "apply-before-add");

  let requiredWriteFailure = false;
  const flatExercises = flattenWorkoutExercises(template);

  for (const exercise of flatExercises) {
    const attempt = buildAttempt(exercise);
    state.attemptedExercises.push(attempt);

    const searchInput = await ensurePickerReady(page, state);
    if (!searchInput) {
      break;
    }

    await searchInput.fill(exercise.name);
    await page.waitForTimeout(900);
    const typedValue = await searchInput.inputValue().catch(() => "");
    const selection = await clickExactSearchResult(page, exercise.name, args.mode === "apply");
    const decision = selection.decision;
    const candidateRows = decision.visibleTexts;
    attempt.selectionStatus = decision.status;
    attempt.visibleExactMatches = decision.exactVisibleMatches;
    attempt.visibleTextsSample = decision.visibleTexts.slice(0, 10);
    attempt.inputValueAfterTyping = typedValue;
    attempt.candidateRows = candidateRows;
    attempt.wouldClick = decision.status === "exact";

    if (decision.status !== "exact") {
      state.errors.push(`Exact visible result was not unique for "${exercise.name}" (status: ${decision.status}).`);
      await saveScreenshot(page, state, `apply-ambiguous-${slugify(exercise.name)}`);
      return;
    }

    if (!selection.clicked) {
      attempt.clicked = false;
      attempt.selectionStatus = "missing";
      state.errors.push(`Exact picker row changed before click for "${exercise.name}" (status: missing).`);
      await saveScreenshot(page, state, `apply-ambiguous-${slugify(exercise.name)}`);
      return;
    }

    attempt.clicked = true;
    attempt.exactMatchClicked = exercise.name;
    await page.waitForTimeout(700);
    await populateExerciseCard(page, exercise, attempt);
    if (!isWrittenFieldStatus(attempt.fields.sets.status)) {
      requiredWriteFailure = true;
      const debugPath = await saveFieldDebug(page, attempt.name, "sets-not-written");
      state.warnings.push(`Field debug captured for "${attempt.name}" sets: ${debugPath}`);
    }
    if (attempt.fields.reps.required && !isWrittenFieldStatus(attempt.fields.reps.status)) {
      requiredWriteFailure = true;
      const debugPath = await saveFieldDebug(page, attempt.name, "reps-not-written");
      state.warnings.push(`Field debug captured for "${attempt.name}" reps: ${debugPath}`);
    }
    if (attempt.fields.duration.required && !isWrittenFieldStatus(attempt.fields.duration.status)) {
      requiredWriteFailure = true;
      const debugPath = await saveFieldDebug(page, attempt.name, "duration-not-written");
      state.warnings.push(`Field debug captured for "${attempt.name}" duration: ${debugPath}`);
    }
    if (attempt.fields.coachNote.required && !isWrittenFieldStatus(attempt.fields.coachNote.status)) {
      requiredWriteFailure = true;
      const debugPath = await saveFieldDebug(page, attempt.name, "coach-note-not-written");
      state.warnings.push(`Field debug captured for "${attempt.name}" coachNote: ${debugPath}`);
    }
    attempt.added = true;
  }

  await saveScreenshot(page, state, "apply-before-save");
  const beforeSaveVisual = await collectVisualFieldEvidence(page, flatExercises);
  if (!beforeSaveVisual.fieldsVisible || !beforeSaveVisual.notesVisible) {
    state.errors.push("Before-save visual verification failed (fieldsVisible and notesVisible must both be yes). Save blocked.");
    state.visualFieldVerification = {
      beforeSave: beforeSaveVisual,
      afterSave: buildMissingAfterSaveVisual(beforeSaveVisual),
    };
    return;
  }
  if (requiredWriteFailure) {
    state.errors.push("One or more required fields were not written/read back. Save blocked for safety.");
    state.visualFieldVerification = {
      beforeSave: beforeSaveVisual,
      afterSave: buildMissingAfterSaveVisual(beforeSaveVisual),
    };
    return;
  }
  if (args.visualConfirmBeforeSave) {
    console.log("");
    console.log("[tp-create-test-strength-workout] visual confirm required before Save.");
    console.log("- Igor should verify sets, reps, duration/time, and coach notes in the UI.");
    if (args.nonInteractive) {
      state.errors.push("Visual confirm before save requires interactive mode. Remove --non-interactive.");
      state.visualFieldVerification = {
        beforeSave: beforeSaveVisual,
        afterSave: buildMissingAfterSaveVisual(beforeSaveVisual),
      };
      return;
    }
    const confirmed = await waitForTypedYes('Type "yes" after Igor visual confirmation');
    if (!confirmed) {
      state.errors.push('Visual confirmation rejected by operator (expected typed "yes"). Save blocked.');
      state.visualFieldVerification = {
        beforeSave: beforeSaveVisual,
        afterSave: buildMissingAfterSaveVisual(beforeSaveVisual),
      };
      return;
    }
  }
  const saveButton = page.getByRole("button", { name: /Save( and Close)?/i }).first();
  if ((await saveButton.count()) > 0 && (await saveButton.isVisible().catch(() => false))) {
    await saveButton.click();
    state.saveClicked = true;
    await page.waitForTimeout(1500);
    await saveScreenshot(page, state, "apply-after-save");
    await closeAndReopenWorkoutIfPossible(page, template.title).catch(() => {});
    const afterSaveVisual = await collectVisualFieldEvidence(page, flatExercises);
    state.visualFieldVerification = {
      beforeSave: beforeSaveVisual,
      afterSave: afterSaveVisual,
    };
  } else {
    state.errors.push("Save button was not found.");
    state.visualFieldVerification = {
      beforeSave: beforeSaveVisual,
      afterSave: buildMissingAfterSaveVisual(beforeSaveVisual),
    };
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
  assertVisualFieldEvidenceBrowserScriptIsSafe();
  if (args.help) {
    printHelp();
    return;
  }

  const template = readWorkoutTemplate(args.template);
  const renderedNames = readRenderedExerciseNames();
  const preflight = buildCatalogPreflight(template, renderedNames);
  const athleteUrlRedacted = sanitizeAthleteUrl(args.athleteUrl);

  console.log(`[tp-create-test-strength-workout] mode: ${args.mode}`);
  console.log(`[tp-create-test-strength-workout] athlete: ${athleteUrlRedacted}`);
  console.log(`[tp-create-test-strength-workout] date: ${args.date}`);
  console.log(`[tp-create-test-strength-workout] title: ${template.title}`);
  console.log(`[tp-create-test-strength-workout] manual-builder: ${args.manualBuilder ? "yes" : "no"}`);
  console.log(`[tp-create-test-strength-workout] template: ${args.template}`);
  console.log(
    `[tp-create-test-strength-workout] visual-confirm-before-save: ${args.visualConfirmBeforeSave ? "yes" : "no"}`
  );
  console.log(`[tp-create-test-strength-workout] exercises: ${preflight.requestedNames.join(", ")}`);
  console.log("[tp-create-test-strength-workout] WARNING: TrainingPeaks may be changed only in --apply mode after typed confirmation.");

  if (args.mode === "apply") {
    await promptForConfirmation(args);
  }

  await mkdir(profileDir, { recursive: true });
  await mkdir(defaultOutDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
  await mkdir(fieldDebugDir, { recursive: true });

  const state: RunState = {
    warnings: [],
    errors: [],
    screenshots: [],
    attemptedExercises: [],
    builderOpened: false,
    addBlockButtonFound: false,
    pickerSearchFound: false,
    saveClicked: false,
    visualFieldVerification: undefined,
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
    visualFieldVerification: state.visualFieldVerification,
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
