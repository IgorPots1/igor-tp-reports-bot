import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Frame, type Locator, type Page } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import {
  assertStrengthWorkoutFieldWriterBrowserScriptIsSafe,
  browserIsValueVisibleInBlock,
  browserWriteSemanticField,
} from "./lib/strength-workout-field-writer-scrape.ts";
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

type PageLike = Page | Frame;

type BuilderFrameProbe = {
  url: string;
  title?: string;
  visibleTextSample: string[];
  hasAddBlock: boolean;
  hasSearchExercisesInput: boolean;
  hasWorkoutTitle: boolean;
  hasStrengthExerciseNames: boolean;
};

type BuilderFrameProbeReport = {
  selectedFrameUrl: string;
  selectedFrameTitle?: string;
  frames: BuilderFrameProbe[];
};

type CardFieldDebugEntry = {
  index: number;
  text?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
  rect?: { x: number; y: number; width: number; height: number };
};

type CardCandidateDebug = {
  index: number;
  exactNameFound: boolean;
  exactNameSource: "text" | "inputValue" | "textareaValue" | "selectValue" | "ariaLabel" | "placeholder" | "unknown";
  textSample: string[];
  inputValues: string[];
  rect: { x: number; y: number; width: number; height: number };
  inputs: CardFieldDebugEntry[];
  textareas: CardFieldDebugEntry[];
  buttons: CardFieldDebugEntry[];
  possibleLabels: string[];
  dataAttrs: string[];
  className?: string;
  rejectedReason?: string;
};

type CardCandidateInternal = CardCandidateDebug & {
  locatorIndex: number;
  signature: string;
};

type LocatorCandidateDebug = {
  name: string;
  selectorHint: string;
  count: number;
  visible: boolean;
  textSample?: string;
};

type ParentNodeDebug = {
  depth: number;
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  dataTestId?: string;
  textSample?: string;
  rect?: { x: number; y: number; width: number; height: number };
};

type RootDiagnosticArtifact = {
  exerciseName: string;
  stage: "before-add" | "after-add";
  builderRootFound: boolean;
  addBlockCandidates: LocatorCandidateDebug[];
  pickerSearchCandidates: LocatorCandidateDebug[];
  exactResultCandidates?: LocatorCandidateDebug[];
  addBlockParentChain?: ParentNodeDebug[];
  searchInputParentChain?: ParentNodeDebug[];
  addedExerciseNameParentChain?: ParentNodeDebug[];
  addedExerciseNameRejectedReason?: string;
  selectedFrameUrl: string;
  selectedCardIndex?: number;
  candidateCardCount?: number;
  label?: string;
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

function getMainFrame(page: Page): Frame {
  return page.mainFrame();
}

function listFramesWithMainFirst(page: Page): Frame[] {
  const all = page.frames();
  const main = getMainFrame(page);
  const rest = all.filter((frame) => frame !== main);
  return [main, ...rest];
}

async function probeBuilderFrames(
  page: Page,
  expectedExerciseNames: string[],
  selectedFrame: Frame
): Promise<BuilderFrameProbeReport> {
  const frameReports: BuilderFrameProbe[] = [];
  const names = expectedExerciseNames.map((name) => name.trim()).filter(Boolean);
  const frames = listFramesWithMainFirst(page);
  for (const frame of frames) {
    const probe = await frame
      .evaluate((input) => {
        const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
        const textNodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,button,label,span,div,input,textarea"));
        const visibleTextSample: string[] = [];
        for (const node of textNodes) {
          if (visibleTextSample.length >= 18) break;
          const el = node as HTMLElement;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const text = normalize(
            node.tagName.toLowerCase() === "input"
              ? (node as HTMLInputElement).value || (node as HTMLInputElement).placeholder || ""
              : node.textContent
          );
          if (!text || text.length > 90) continue;
          if (!visibleTextSample.includes(text)) {
            visibleTextSample.push(text);
          }
        }
        const allText = normalize(document.body?.textContent ?? "");
        const hasAddBlock = Array.from(document.querySelectorAll("button,[role='button']")).some((node) => {
          const text = normalize(node.textContent);
          const aria = normalize((node as HTMLElement).getAttribute("aria-label"));
          return /add block/i.test(text) || /add block/i.test(aria);
        });
        const hasSearchExercisesInput = Array.from(document.querySelectorAll("input,textarea,[role='textbox']")).some((node) => {
          const aria = normalize((node as HTMLElement).getAttribute("aria-label"));
          const placeholder =
            node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
              ? normalize(node.placeholder)
              : "";
          return /search exercises|circuits|saved items/i.test(`${aria} ${placeholder}`);
        });
        const hasWorkoutTitle = Array.from(document.querySelectorAll("input,textarea,[role='textbox']")).some((node) => {
          const aria = normalize((node as HTMLElement).getAttribute("aria-label"));
          const placeholder =
            node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
              ? normalize(node.placeholder)
              : "";
          return /workout title|title/i.test(`${aria} ${placeholder}`);
        });
        const hasStrengthExerciseNames = input.names.some((name: string) => allText.includes(name));
        return {
          visibleTextSample,
          hasAddBlock,
          hasSearchExercisesInput,
          hasWorkoutTitle,
          hasStrengthExerciseNames,
          title: document.title ? normalize(document.title) : undefined,
        };
      }, { names })
      .catch(() => ({
        visibleTextSample: [],
        hasAddBlock: false,
        hasSearchExercisesInput: false,
        hasWorkoutTitle: false,
        hasStrengthExerciseNames: false,
        title: undefined,
      }));
    frameReports.push({
      url: frame.url(),
      title: probe.title,
      visibleTextSample: probe.visibleTextSample,
      hasAddBlock: probe.hasAddBlock,
      hasSearchExercisesInput: probe.hasSearchExercisesInput,
      hasWorkoutTitle: probe.hasWorkoutTitle,
      hasStrengthExerciseNames: probe.hasStrengthExerciseNames,
    });
  }
  return {
    selectedFrameUrl: selectedFrame.url(),
    selectedFrameTitle: frameReports.find((entry) => entry.url === selectedFrame.url())?.title,
    frames: frameReports,
  };
}

async function saveBuilderFrameProbeReport(
  report: BuilderFrameProbeReport,
  reason: string
): Promise<string> {
  await mkdir(fieldDebugDir, { recursive: true });
  const filePath = path.join(fieldDebugDir, `builder-frame-probe-${slugify(reason)}.json`);
  await writeFile(filePath, `${JSON.stringify(redactUnknown(report), null, 2)}\n`, "utf8");
  return relativizeArtifactPath(repoRoot, filePath);
}

function candidateSelectorEntries(scope: PageLike): Array<{ name: string; selectorHint: string; locator: Locator }> {
  return [
    {
      name: "addBlock_role_button",
      selectorHint: "getByRole(button, /Add Block/i)",
      locator: scope.getByRole("button", { name: /Add Block/i }).first(),
    },
    {
      name: "addBlock_text_exact",
      selectorHint: "getByText(/^Add Block$/i)",
      locator: scope.getByText(/^Add Block$/i).first(),
    },
    {
      name: "search_placeholder",
      selectorHint: "getByPlaceholder(/Search Exercises, Circuits, or Saved Items/i)",
      locator: scope.getByPlaceholder(/Search Exercises, Circuits, or Saved Items/i).first(),
    },
    {
      name: "search_role_textbox",
      selectorHint: "getByRole(textbox, /Search Exercises, Circuits, or Saved Items/i)",
      locator: scope.getByRole("textbox", { name: /Search Exercises, Circuits, or Saved Items/i }).first(),
    },
    {
      name: "search_css_placeholder",
      selectorHint: "input[placeholder*='Search Exercises']",
      locator: scope.locator("input[placeholder*='Search Exercises']").first(),
    },
  ];
}

async function collectLocatorCandidateDebug(
  entries: Array<{ name: string; selectorHint: string; locator: Locator }>
): Promise<LocatorCandidateDebug[]> {
  const results: LocatorCandidateDebug[] = [];
  for (const entry of entries) {
    const count = await entry.locator.count().catch(() => 0);
    const visible = count > 0 ? await entry.locator.isVisible().catch(() => false) : false;
    const textSample = count > 0 ? sanitizeDebugText(await entry.locator.innerText().catch(() => ""), 160) : "";
    results.push({
      name: entry.name,
      selectorHint: entry.selectorHint,
      count,
      visible,
      textSample: textSample || undefined,
    });
  }
  return results;
}

async function collectParentChain(locator: Locator, maxDepth = 12): Promise<ParentNodeDebug[] | undefined> {
  if ((await locator.count().catch(() => 0)) === 0) return undefined;
  if (!(await locator.isVisible().catch(() => false))) return undefined;
  const handle = await locator.elementHandle().catch(() => null);
  if (!handle) return undefined;
  const chain = await handle.evaluate((node, inputMaxDepth) => {
    const items: ParentNodeDebug[] = [];
    let depth = 0;
    let current: HTMLElement | null = node as HTMLElement;
    while (current && depth < inputMaxDepth) {
      const rect = current.getBoundingClientRect();
      const className = String(current.className ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      const textSample = String(current.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
      items.push({
        depth,
        tag: current.tagName.toLowerCase(),
        id: current.id || undefined,
        className: className || undefined,
        role: current.getAttribute("role") || undefined,
        ariaLabel: current.getAttribute("aria-label") || undefined,
        dataTestId: current.getAttribute("data-testid") || undefined,
        textSample: textSample || undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
      current = current.parentElement;
      depth += 1;
    }
    return items;
  }, maxDepth);
  return chain;
}

function parentChainSuggestsCalendarShell(chain: ParentNodeDebug[] | undefined): boolean {
  if (!chain || chain.length === 0) return false;
  const joined = chain
    .map((entry) =>
      [entry.tag, entry.id ?? "", entry.className ?? "", entry.role ?? "", entry.ariaLabel ?? "", entry.textSample ?? ""].join(" ")
    )
    .join(" ")
    .toLowerCase();
  const calendarSignals = [
    "activitycalendarcard",
    "activitycalendarcardblocktitle",
    "daycontainer",
    "daywidth",
    "duration",
    "distance",
    "tss",
    "el. gain",
    "work",
  ];
  return calendarSignals.some((signal) => joined.includes(signal));
}

function candidateSuggestsCalendarShell(candidate: CardCandidateInternal): boolean {
  const payload = [
    candidate.className ?? "",
    candidate.textSample.join(" "),
    candidate.possibleLabels.join(" "),
    candidate.inputValues.join(" "),
    candidate.buttons.map((entry) => `${entry.text ?? ""} ${entry.ariaLabel ?? ""}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const calendarSignals = [
    "activitycalendarcard",
    "activitycalendarcardblocktitle",
    "daycontainer",
    "daywidth",
    " duration ",
    " distance ",
    " tss ",
    " run ",
    "el. gain",
    " work ",
  ];
  return calendarSignals.some((signal) => payload.includes(signal.trim()));
}

async function resolveBuilderDialogRoot(scope: PageLike): Promise<Locator | null> {
  const dialogCandidates = [
    scope
      .locator('[role="dialog"]')
      .filter({ hasText: /Add Block|Workout Title|Type or select exercise|Exercise/i })
      .last(),
    scope.locator('[role="dialog"]').last(),
  ];
  for (const dialog of dialogCandidates) {
    const count = await dialog.count().catch(() => 0);
    if (count === 0) continue;
    if (!(await dialog.isVisible().catch(() => false))) continue;
    const strong = await dialog
      .evaluate((node) => {
        const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const root = node as HTMLElement;
        const text = normalize(root.textContent);
        const hasAddBlock = /add block/.test(text);
        const hasWorkoutTitle = /workout title/.test(text);
        const hasTypeOrSelect = /type or select exercise|exercise/.test(text);
        const cardLikeCount = Array.from(
          root.querySelectorAll("section,article,li,tr,[role='row'],[role='group'],[data-testid],div")
        ).filter((entry) => {
          const el = entry as HTMLElement;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const controls = el.querySelector("input,textarea,select,[role='textbox'],button,[role='button']");
          return Boolean(controls);
        }).length;
        return hasAddBlock || hasWorkoutTitle || hasTypeOrSelect || cardLikeCount > 0;
      })
      .catch(() => false);
    if (strong) {
      return dialog;
    }
  }
  return null;
}

async function closePickerPopover(dialogRoot: Locator): Promise<void> {
  const page = dialogRoot.page();
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(450);
  const body = page.locator("body").first();
  await body.click({ position: { x: 40, y: 40 } }).catch(() => {});
  await page.waitForTimeout(250);
}

async function locateVisibleExerciseName(scope: PageLike, exerciseName: string): Promise<Locator | null> {
  const dialog = await resolveBuilderDialogRoot(scope);
  if (!dialog) return null;
  const exact = dialog.getByText(new RegExp(`^\\s*${escapeRegex(exerciseName)}\\s*$`, "i")).first();
  if ((await exact.count().catch(() => 0)) > 0 && (await exact.isVisible().catch(() => false))) {
    return exact;
  }
  const contains = dialog.getByText(new RegExp(escapeRegex(exerciseName), "i")).first();
  if ((await contains.count().catch(() => 0)) > 0 && (await contains.isVisible().catch(() => false))) {
    return contains;
  }
  return null;
}

async function saveRootDiagnosticArtifact(payload: RootDiagnosticArtifact): Promise<string> {
  await mkdir(fieldDebugDir, { recursive: true });
  const filePath = path.join(
    fieldDebugDir,
    `${slugify(payload.exerciseName)}-root-diagnostic-${slugify(payload.stage)}${payload.label ? `-${slugify(payload.label)}` : ""}.json`
  );
  await writeFile(filePath, `${JSON.stringify(redactUnknown(payload), null, 2)}\n`, "utf8");
  return relativizeArtifactPath(repoRoot, filePath);
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

async function collectCardCandidates(scope: PageLike, exerciseName: string): Promise<CardCandidateInternal[]> {
  const normalizedName = normalizeVisibleText(exerciseName).toLowerCase();
  const dialog = await resolveBuilderDialogRoot(scope);
  if (!dialog) {
    return [];
  }
  const container = dialog.locator("section,article,li,tr,[role='row'],[role='group'],[data-testid],div");
  const count = await container.count();
  const candidates: CardCandidateInternal[] = [];
  for (let index = 0; index < count; index += 1) {
    const card = container.nth(index);
    if (!(await card.isVisible().catch(() => false))) continue;
    const snapshot = await card
      .evaluate((node, inputName) => {
        const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
        const compact = (value: unknown, max = 220) => normalize(value).slice(0, max);
        const root = node as HTMLElement;
        const text = compact(root.textContent, 1600);
        const lowered = text.toLowerCase();
        const rect = root.getBoundingClientRect();
        const matchSources: Array<{
          source: "text" | "inputValue" | "textareaValue" | "selectValue" | "ariaLabel" | "placeholder" | "unknown";
          value: string;
        }> = [];
        const pushMatchSource = (
          source: "text" | "inputValue" | "textareaValue" | "selectValue" | "ariaLabel" | "placeholder" | "unknown",
          value: unknown
        ) => {
          const normalized = normalize(value).toLowerCase();
          if (!normalized) return;
          matchSources.push({ source, value: normalized });
        };
        pushMatchSource("text", lowered);
        const readFields = (selector: string, maxItems: number) =>
          Array.from(root.querySelectorAll(selector))
            .slice(0, maxItems)
            .map((entry, fieldIndex) => {
              const el = entry as HTMLElement;
              const r = el.getBoundingClientRect();
              const value =
                entry instanceof HTMLInputElement || entry instanceof HTMLTextAreaElement
                  ? compact(entry.value, 120)
                  : compact(entry.textContent, 120);
              const placeholder =
                entry instanceof HTMLInputElement || entry instanceof HTMLTextAreaElement
                  ? compact(entry.placeholder, 80)
                  : undefined;
              const ariaLabel = compact(el.getAttribute("aria-label"), 80) || undefined;
              return {
                index: fieldIndex,
                type: entry instanceof HTMLInputElement ? entry.type : undefined,
                value,
                placeholder,
                ariaLabel,
                nearbyText: compact((el.closest("label, td, th, div, section, article, li")?.textContent ?? ""), 160),
                rect: {
                  x: Math.round(r.x),
                  y: Math.round(r.y),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                },
              };
            });
        const inputs = readFields("input", 24);
        const textareas = readFields("textarea,[contenteditable='true']", 12);
        const selectEntries = Array.from(root.querySelectorAll("select"))
          .slice(0, 12)
          .map((entry, fieldIndex) => {
            const el = entry as HTMLSelectElement;
            const rect = el.getBoundingClientRect();
            const value = compact(el.value, 120);
            const placeholder = compact(el.getAttribute("placeholder"), 80) || undefined;
            const ariaLabel = compact(el.getAttribute("aria-label"), 80) || undefined;
            const nearbyText = compact((el.closest("label, td, th, div, section, article, li")?.textContent ?? ""), 160);
            return {
              index: fieldIndex,
              type: "select",
              value,
              placeholder,
              ariaLabel,
              nearbyText,
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            };
          });
        const buttons = Array.from(root.querySelectorAll("button,[role='button']"))
          .slice(0, 18)
          .map((entry, buttonIndex) => {
            const el = entry as HTMLElement;
            const r = el.getBoundingClientRect();
            return {
              index: buttonIndex,
              text: compact(el.textContent, 100),
              ariaLabel: compact(el.getAttribute("aria-label"), 80) || undefined,
              nearbyText: compact((el.closest("label, td, th, div, section, article, li")?.textContent ?? ""), 120),
              rect: {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height),
              },
            };
          });
        for (const input of inputs) {
          pushMatchSource("inputValue", input.value);
          pushMatchSource("placeholder", input.placeholder);
          pushMatchSource("ariaLabel", input.ariaLabel);
        }
        for (const textarea of textareas) {
          pushMatchSource("textareaValue", textarea.value);
          pushMatchSource("placeholder", textarea.placeholder);
          pushMatchSource("ariaLabel", textarea.ariaLabel);
        }
        for (const selectEntry of selectEntries) {
          pushMatchSource("selectValue", selectEntry.value);
          pushMatchSource("placeholder", selectEntry.placeholder);
          pushMatchSource("ariaLabel", selectEntry.ariaLabel);
        }
        const possibleLabels = Array.from(root.querySelectorAll("label,[aria-label],[title],th,dt,strong"))
          .map((entry) => compact((entry as HTMLElement).textContent || (entry as HTMLElement).getAttribute("aria-label"), 90))
          .filter(Boolean)
          .slice(0, 24);
        for (const label of possibleLabels) {
          pushMatchSource("text", label);
        }
        const dataAttrs = Array.from(root.attributes)
          .filter((attr) => attr.name.startsWith("data-"))
          .slice(0, 8)
          .map((attr) => `${attr.name}=${attr.value.slice(0, 80)}`);
        const exactSource =
          matchSources.find((entry) => entry.source === "inputValue" && entry.value === inputName)?.source ??
          matchSources.find((entry) => entry.source === "textareaValue" && entry.value === inputName)?.source ??
          matchSources.find((entry) => entry.source === "selectValue" && entry.value === inputName)?.source ??
          matchSources.find((entry) => entry.source === "ariaLabel" && entry.value.includes(inputName))?.source ??
          matchSources.find((entry) => entry.source === "placeholder" && entry.value.includes(inputName))?.source ??
          matchSources.find((entry) => entry.source === "text" && entry.value.includes(inputName))?.source ??
          "unknown";
        const exactNameFound = exactSource !== "unknown";
        const inputValues = [...inputs.map((entry) => entry.value), ...textareas.map((entry) => entry.value), ...selectEntries.map((entry) => entry.value)]
          .filter(Boolean)
          .slice(0, 40) as string[];
        return {
          textSample: text ? text.split(" ").slice(0, 60) : [],
          exactNameFound,
          exactNameSource: exactSource,
          hasControls: inputs.length > 0 || textareas.length > 0 || selectEntries.length > 0 || buttons.length > 0,
          inputValues,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          inputs,
          textareas: [...textareas, ...selectEntries],
          buttons,
          possibleLabels,
          dataAttrs,
          className: compact(root.className, 120) || undefined,
          signature: `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${text.slice(0, 80)}`,
        };
      }, normalizedName)
      .catch(() => null);
    if (!snapshot) continue;
    if (!snapshot.hasControls) continue;
    const rootChain = await collectParentChain(card);
    const rejectedReason = parentChainSuggestsCalendarShell(rootChain) ? "calendar_shell_parent_chain" : undefined;
    candidates.push({
      index: candidates.length,
      exactNameFound: snapshot.exactNameFound,
      exactNameSource: snapshot.exactNameSource,
      textSample: snapshot.textSample,
      inputValues: snapshot.inputValues,
      rect: snapshot.rect,
      inputs: snapshot.inputs,
      textareas: snapshot.textareas,
      buttons: snapshot.buttons,
      possibleLabels: snapshot.possibleLabels,
      dataAttrs: snapshot.dataAttrs,
      className: snapshot.className,
      rejectedReason,
      locatorIndex: index,
      signature: snapshot.signature,
    });
  }
  return candidates.map((candidate) =>
    candidateSuggestsCalendarShell(candidate)
      ? {
          ...candidate,
          rejectedReason: candidate.rejectedReason ?? "calendar_shell_signature",
        }
      : candidate
  );
}

async function saveCardCandidatesDebug(
  exerciseName: string,
  builderRootFound: boolean,
  candidates: CardCandidateInternal[],
  selectedCardIndex?: number
): Promise<string> {
  await mkdir(fieldDebugDir, { recursive: true });
  const filePath = path.join(fieldDebugDir, `${slugify(exerciseName)}-card-candidates.json`);
  const payload = {
    exerciseName,
    builderRootFound,
    candidateCards: candidates.map((entry) => ({
      index: entry.index,
      exactNameFound: entry.exactNameFound,
      exactNameSource: entry.exactNameSource,
      textSample: entry.textSample,
      inputValues: entry.inputValues,
      rect: entry.rect,
      inputs: entry.inputs,
      textareas: entry.textareas,
      buttons: entry.buttons,
      possibleLabels: entry.possibleLabels,
      dataAttrs: entry.dataAttrs,
      className: entry.className,
      rejectedReason: entry.rejectedReason,
    })),
    selectedCardIndex,
  };
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

async function locateBuilderRoot(scope: PageLike): Promise<Locator | null> {
  const candidates = [
    scope.getByRole("dialog").filter({ hasText: /Strength|Add Block|Search Exercises/i }).first(),
    scope.locator("[data-testid*='strength']").first(),
    scope.locator("section, div").filter({ hasText: /Add Block/i }).first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.first().isVisible().catch(() => false))) {
      return candidate.first();
    }
  }
  return null;
}

async function locateAddBlockButton(scope: PageLike): Promise<Locator | null> {
  const candidates = [
    scope.getByRole("button", { name: /Add Block/i }).first(),
    scope.getByText(/^Add Block$/i).first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }
  return null;
}

async function openExistingBuilderIfPresent(page: Page, state: RunState): Promise<boolean> {
  const resolved = await resolveBuilderScope(page);
  if (resolved) {
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

async function resolveBuilderScope(page: Page): Promise<{ scope: PageLike; frame: Frame } | null> {
  const hasWorkoutTitle = async (scope: PageLike): Promise<boolean> => {
    const candidates = [
      scope.getByPlaceholder(/Workout Title/i).first(),
      scope.getByRole("textbox", { name: /Workout Title|Title/i }).first(),
      scope.locator("input[placeholder*='Workout Title']").first(),
    ];
    for (const candidate of candidates) {
      if ((await candidate.count().catch(() => 0)) > 0 && (await candidate.isVisible().catch(() => false))) {
        return true;
      }
    }
    return false;
  };
  const cardLikeCount = async (scope: PageLike): Promise<number> =>
    scope
      .evaluate(() => {
        const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const nodes = Array.from(
          document.querySelectorAll("section,article,li,tr,[role='row'],[role='group'],[data-testid],div")
        );
        let count = 0;
        for (const node of nodes) {
          const el = node as HTMLElement;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const hasControl = Boolean(
            el.querySelector("input,textarea,[contenteditable='true'],[role='textbox'],button,[role='button']")
          );
          if (!hasControl) continue;
          const text = normalize(el.textContent);
          if (/(sets|reps|duration|type or select exercise|exercise|workout title)/i.test(text)) {
            count += 1;
          }
        }
        return count;
      })
      .catch(() => 0);
  const frameCandidates = listFramesWithMainFirst(page);
  for (const frame of frameCandidates) {
    const dialogInFrame = await resolveBuilderDialogRoot(frame);
    const addBlock = await locateAddBlockButton(frame);
    const hasAddBlock = Boolean(
      addBlock && (await addBlock.count().catch(() => 0)) > 0 && (await addBlock.isVisible().catch(() => false))
    );
    if (dialogInFrame && (hasAddBlock || (await hasWorkoutTitle(frame)) || (await cardLikeCount(frame)) > 0)) {
      return { scope: frame, frame };
    }
  }
  const pageDialog = await resolveBuilderDialogRoot(page);
  const addBlockPage = await locateAddBlockButton(page);
  const hasAddBlockOnPage = Boolean(
    addBlockPage && (await addBlockPage.count().catch(() => 0)) > 0 && (await addBlockPage.isVisible().catch(() => false))
  );
  if (pageDialog && (hasAddBlockOnPage || (await hasWorkoutTitle(page)) || (await cardLikeCount(page)) > 0)) {
    return { scope: page, frame: getMainFrame(page) };
  }
  return null;
}

async function locateSearchInput(scope: PageLike): Promise<Locator | null> {
  const candidates = [
    scope.getByPlaceholder(/Search Exercises, Circuits, or Saved Items/i).first(),
    scope.getByRole("textbox", { name: /Search Exercises, Circuits, or Saved Items/i }).first(),
    scope.locator("input[placeholder*='Search Exercises']").first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }
  return null;
}

async function collectCandidateRows(scope: PageLike): Promise<string[]> {
  const optionRows = scope.locator("[role='option']");
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
  exactResultCandidates: LocatorCandidateDebug[];
  exactResultParentChain?: ParentNodeDebug[];
};

async function clickExactSearchResult(
  scope: PageLike,
  requestedName: string,
  shouldClick: boolean
): Promise<PickerSelectionResult> {
  const candidateRows = await collectCandidateRows(scope);
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
  const exactResultCandidates: LocatorCandidateDebug[] = [];
  for (const entry of matchingIndexes) {
    const row = scope.locator("[role='option']").nth(entry.index);
    const visible = await row.isVisible().catch(() => false);
    const textSample = sanitizeDebugText(await row.innerText().catch(() => ""), 160);
    exactResultCandidates.push({
      name: `exact_option_${entry.index}`,
      selectorHint: "[role='option'] exact text match",
      count: 1,
      visible,
      textSample: textSample || undefined,
    });
  }

  if (!shouldClick || decision.status !== "exact") {
    return { decision, clicked: false, exactResultCandidates };
  }

  const targetIndex = matchingIndexes[0]?.index;
  if (targetIndex === undefined) {
    return { decision: { ...decision, status: "missing" }, clicked: false, exactResultCandidates };
  }

  const targetRow = scope.locator("[role='option']").nth(targetIndex);
  if (!(await targetRow.isVisible().catch(() => false))) {
    return { decision: { ...decision, status: "missing" }, clicked: false, exactResultCandidates };
  }

  const textBeforeClick = normalizeVisibleText(await targetRow.innerText().catch(() => ""));
  if (textBeforeClick !== normalizedRequested) {
    return { decision: { ...decision, status: "missing" }, clicked: false, exactResultCandidates };
  }
  const exactResultParentChain = await collectParentChain(targetRow);
  await targetRow.click();
  return { decision, clicked: true, exactResultCandidates, exactResultParentChain };
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
  return browserIsValueVisibleInBlock(block, expectedVariants);
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
  const result = await browserWriteSemanticField(block, options);

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

async function fillWorkoutTitle(scope: PageLike, title: string): Promise<boolean> {
  const root = scope.locator("body").first();
  const result = await writeFieldValueInScope(root, { labels: /Title/i, placeholders: /Title/i, allowAnyInput: true }, title);
  return result.ok;
}

async function fillWorkoutInstructions(scope: PageLike, instructions: string): Promise<boolean> {
  const root = scope.locator("body").first();
  const result = await writeFieldValueInScope(
    root,
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

async function ensurePickerReady(scope: PageLike, state: RunState): Promise<Locator | null> {
  const addBlockButton = await locateAddBlockButton(scope);
  if (!addBlockButton) {
    state.errors.push("Add Block button was not found.");
    return null;
  }
  state.addBlockButtonFound = true;
  await addBlockButton.click();
  await addBlockButton.page().waitForTimeout(600);
  const searchInput = await locateSearchInput(scope);
  if (!searchInput) {
    state.errors.push("Exercise picker search input was not found after Add Block.");
    return null;
  }
  state.pickerSearchFound = true;
  return searchInput;
}

async function ensurePickerReadyWithDebug(
  scope: PageLike,
  state: RunState,
  exerciseName: string,
  stage: "before-add" | "after-add",
  selectedFrameUrl: string
): Promise<{ searchInput: Locator | null; artifactPath?: string; addBlockLocator?: Locator }> {
  const candidates = candidateSelectorEntries(scope);
  const addBlockCandidates = (await collectLocatorCandidateDebug(candidates)).filter((entry) => entry.name.startsWith("addBlock_"));
  const searchCandidates = (await collectLocatorCandidateDebug(candidates)).filter((entry) => entry.name.startsWith("search_"));
  const addBlockButton = await locateAddBlockButton(scope);
  if (!addBlockButton) {
    const artifactPath = await saveRootDiagnosticArtifact({
      exerciseName,
      stage,
      builderRootFound: false,
      addBlockCandidates,
      pickerSearchCandidates: searchCandidates,
      selectedFrameUrl,
    });
    state.errors.push("Add Block button was not found.");
    return { searchInput: null, artifactPath };
  }
  const addBlockChain = await collectParentChain(addBlockButton);
  state.addBlockButtonFound = true;
  let searchInput = await locateSearchInput(scope);
  if (!searchInput) {
    const clickAddBlockSafely = async (): Promise<void> => {
      try {
        await addBlockButton.click({ timeout: 5000 });
      } catch (error) {
        const message = String(error ?? "");
        if (!/intercepts pointer events|Timeout/i.test(message)) {
          throw error;
        }
        // A popover backdrop can temporarily intercept clicks; close overlays and retry once.
        await addBlockButton.page().keyboard.press("Escape").catch(() => {});
        await addBlockButton.page().waitForTimeout(200);
        await addBlockButton.click({ timeout: 5000 });
      }
    };
    await clickAddBlockSafely();
    await addBlockButton.page().waitForTimeout(600);
    searchInput = await locateSearchInput(scope);
    if (!searchInput) {
      await addBlockButton.page().keyboard.press("Escape").catch(() => {});
      await addBlockButton.page().waitForTimeout(200);
      await clickAddBlockSafely();
      await addBlockButton.page().waitForTimeout(600);
      searchInput = await locateSearchInput(scope);
    }
  }
  const searchInputChain = searchInput ? await collectParentChain(searchInput) : undefined;
  if (!searchInput) {
    const artifactPath = await saveRootDiagnosticArtifact({
      exerciseName,
      stage,
      builderRootFound: false,
      addBlockCandidates,
      pickerSearchCandidates: searchCandidates,
      addBlockParentChain: addBlockChain,
      searchInputParentChain: searchInputChain,
      selectedFrameUrl,
    });
    state.errors.push("Exercise picker search input was not found after Add Block.");
    return { searchInput: null, artifactPath, addBlockLocator: addBlockButton };
  }
  state.pickerSearchFound = true;
  const artifactPath = await saveRootDiagnosticArtifact({
    exerciseName,
    stage,
    builderRootFound: true,
    addBlockCandidates,
    pickerSearchCandidates: searchCandidates,
    addBlockParentChain: addBlockChain,
    searchInputParentChain: searchInputChain,
    selectedFrameUrl,
  });
  return { searchInput, artifactPath, addBlockLocator: addBlockButton };
}

function selectCardCandidate(
  before: CardCandidateInternal[],
  after: CardCandidateInternal[]
): CardCandidateInternal | null {
  const beforeSignatures = new Set(before.filter((entry) => !entry.rejectedReason).map((entry) => entry.signature));
  const validAfter = after.filter((entry) => !entry.rejectedReason);
  const exactNew = validAfter.filter((entry) => entry.exactNameFound && !beforeSignatures.has(entry.signature));
  if (exactNew.length > 0) {
    return exactNew.sort((left, right) => right.rect.y - left.rect.y)[0];
  }
  const exactAny = validAfter.filter((entry) => entry.exactNameFound);
  if (exactAny.length > 0) {
    return exactAny.sort((left, right) => right.rect.y - left.rect.y)[0];
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

async function locateSelectedExerciseCard(
  scope: PageLike,
  exerciseName: string,
  beforeCandidates: CardCandidateInternal[]
): Promise<{ locator: Locator | null; candidates: CardCandidateInternal[]; selectedCandidateIndex?: number }> {
  const afterCandidates = await collectCardCandidates(scope, exerciseName);
  const selected = selectCardCandidate(beforeCandidates, afterCandidates);
  if (!selected) {
    return { locator: null, candidates: afterCandidates };
  }
  const dialog = await resolveBuilderDialogRoot(scope);
  if (!dialog) {
    return { locator: null, candidates: afterCandidates };
  }
  const locator = dialog.locator("section,article,li,tr,[role='row'],[role='group'],[data-testid],div").nth(selected.locatorIndex);
  await revealExercisePanel(locator);
  return { locator, candidates: afterCandidates, selectedCandidateIndex: selected.index };
}

function markExerciseCardNotFound(attempt: ExerciseAttempt): void {
  markNotFound(attempt.fields.sets, "Exercise card/root not found; field writing skipped.");
  if (attempt.fields.reps.required) markNotFound(attempt.fields.reps, "Exercise card/root not found; field writing skipped.");
  if (attempt.fields.duration.required) markNotFound(attempt.fields.duration, "Exercise card/root not found; field writing skipped.");
  if (attempt.fields.coachNote.required) markNotFound(attempt.fields.coachNote, "Exercise card/root not found; field writing skipped.");
}

async function populateExerciseCard(
  block: Locator,
  exercise: StrengthWorkoutExerciseSpec,
  attempt: ExerciseAttempt
): Promise<void> {
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
  const resolved = await resolveBuilderScope(page);
  if (!resolved) {
    state.errors.push("Could not resolve Strength Builder root/frame after opening builder.");
    const probe = await probeBuilderFrames(page, flattenWorkoutExercises(template).map((entry) => entry.name), getMainFrame(page));
    const probePath = await saveBuilderFrameProbeReport(probe, "dry-run-builder-not-found");
    state.warnings.push(`Builder frame probe saved: ${probePath}`);
    return;
  }
  const builderScope = resolved.scope;
  const builderFrame = resolved.frame;
  const builderDialog = await resolveBuilderDialogRoot(builderScope);
  if (!builderDialog) {
    state.errors.push("Strength Builder dialog [role='dialog'] was not found; diagnostic-only fail early.");
    return;
  }
  await saveScreenshot(page, state, "dry-run-builder");

  const searchInput = await ensurePickerReady(builderScope, state);
  if (!searchInput) {
    return;
  }
  const firstExerciseName = flattenWorkoutExercises(template)[0]?.name ?? "Glute Bridge";
  await searchInput.fill(firstExerciseName);
  await page.waitForTimeout(900);
  const typedValue = await searchInput.inputValue().catch(() => "");
  const pickerDecision = await clickExactSearchResult(builderScope, firstExerciseName, false);
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
  const frameProbe = await probeBuilderFrames(
    page,
    flattenWorkoutExercises(template).map((entry) => entry.name),
    builderFrame
  );
  const frameProbePath = await saveBuilderFrameProbeReport(frameProbe, "dry-run");
  state.warnings.push(`Builder frame probe saved: ${frameProbePath}`);
  const cardCandidates = await collectCardCandidates(builderScope, firstExerciseName);
  const dryRunRootFound = cardCandidates.length > 0 || Boolean(state.addBlockButtonFound || state.pickerSearchFound);
  const candidatesPath = await saveCardCandidatesDebug(firstExerciseName, dryRunRootFound, cardCandidates);
  state.warnings.push(`Card candidates saved (dry-run): ${candidatesPath}`);
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
  const resolved = await resolveBuilderScope(page);
  if (!resolved) {
    state.errors.push("Could not resolve Strength Builder root/frame after opening builder.");
    const probe = await probeBuilderFrames(page, flattenWorkoutExercises(template).map((entry) => entry.name), getMainFrame(page));
    const probePath = await saveBuilderFrameProbeReport(probe, "apply-builder-not-found");
    state.warnings.push(`Builder frame probe saved: ${probePath}`);
    return;
  }
  const builderScope = resolved.scope;
  const builderFrame = resolved.frame;
  const builderDialog = await resolveBuilderDialogRoot(builderScope);
  if (!builderDialog) {
    state.errors.push("Strength Builder dialog [role='dialog'] was not found; field writing skipped; Save blocked.");
    return;
  }

  await saveScreenshot(page, state, "apply-before-add");
  const frameProbe = await probeBuilderFrames(
    page,
    flattenWorkoutExercises(template).map((entry) => entry.name),
    builderFrame
  );
  const frameProbePath = await saveBuilderFrameProbeReport(frameProbe, "apply-before-add");
  state.warnings.push(`Builder frame probe saved: ${frameProbePath}`);

  const flatExercises = flattenWorkoutExercises(template);

  for (const exercise of flatExercises) {
    const attempt = buildAttempt(exercise);
    state.attemptedExercises.push(attempt);

    const pickerReadyBefore = await ensurePickerReadyWithDebug(
      builderScope,
      state,
      exercise.name,
      "before-add",
      builderFrame.url()
    );
    if (pickerReadyBefore.artifactPath) {
      state.warnings.push(`Root diagnostic (${exercise.name}, before-add): ${pickerReadyBefore.artifactPath}`);
    }
    const searchInput = pickerReadyBefore.searchInput;
    if (!searchInput) {
      break;
    }

    await searchInput.fill(exercise.name);
    await page.waitForTimeout(900);
    const typedValue = await searchInput.inputValue().catch(() => "");
    const selection = await clickExactSearchResult(builderScope, exercise.name, args.mode === "apply");
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
    attempt.added = true;
    await closePickerPopover(builderDialog);
    const afterAddBlockCandidates = (await collectLocatorCandidateDebug(candidateSelectorEntries(builderScope))).filter((entry) =>
      entry.name.startsWith("addBlock_")
    );
    const afterSearchCandidates = (await collectLocatorCandidateDebug(candidateSelectorEntries(builderScope))).filter((entry) =>
      entry.name.startsWith("search_")
    );
    const beforeCandidates = await collectCardCandidates(builderScope, exercise.name);
    const locatedCard = await locateSelectedExerciseCard(builderScope, exercise.name, beforeCandidates);
    const addedNameLocator = await locateVisibleExerciseName(builderScope, exercise.name);
    const addedExerciseNameParentChain = addedNameLocator ? await collectParentChain(addedNameLocator) : undefined;
    const builderRootFoundForCard = Boolean(
      builderDialog && (state.addBlockButtonFound || state.pickerSearchFound || locatedCard.candidates.length > 0)
    );
    const addedExerciseNameRejectedReason = parentChainSuggestsCalendarShell(addedExerciseNameParentChain)
      ? "calendar_shell_parent_chain"
      : undefined;
    if (addedExerciseNameRejectedReason) {
      state.warnings.push(`Rejected calendar-shell addedExerciseNameParentChain for "${exercise.name}".`);
    }
    const cardDebugPath = await saveCardCandidatesDebug(
      exercise.name,
      builderRootFoundForCard,
      locatedCard.candidates,
      locatedCard.selectedCandidateIndex
    );
    state.warnings.push(`Card candidates saved for "${attempt.name}": ${cardDebugPath}`);
    const afterArtifactPath = await saveRootDiagnosticArtifact({
      exerciseName: exercise.name,
      stage: "after-add",
      label: "exact-result",
      builderRootFound: builderRootFoundForCard,
      addBlockCandidates: afterAddBlockCandidates,
      pickerSearchCandidates: afterSearchCandidates,
      exactResultCandidates: selection.exactResultCandidates,
      addedExerciseNameParentChain: addedExerciseNameParentChain ?? selection.exactResultParentChain,
      addedExerciseNameRejectedReason,
      selectedFrameUrl: builderFrame.url(),
      selectedCardIndex: locatedCard.selectedCandidateIndex,
      candidateCardCount: locatedCard.candidates.length,
    });
    state.warnings.push(`Exact-result root diagnostic (${exercise.name}): ${afterArtifactPath}`);
    if (!builderRootFoundForCard) {
      state.errors.push(`Builder root not proven for "${exercise.name}"; diagnostic-only fail early.`);
      break;
    }
    markExerciseCardNotFound(attempt);
  }
  state.errors.push("Diagnostic-only mode: field writing skipped; Save blocked.");
  const beforeSaveVisual = await collectVisualFieldEvidence(page, flatExercises);
  state.visualFieldVerification = {
    beforeSave: beforeSaveVisual,
    afterSave: buildMissingAfterSaveVisual(beforeSaveVisual),
  };
  await saveScreenshot(page, state, "apply-diagnostic-only");
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
  assertStrengthWorkoutFieldWriterBrowserScriptIsSafe();
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
