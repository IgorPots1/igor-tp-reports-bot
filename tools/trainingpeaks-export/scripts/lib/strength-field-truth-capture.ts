import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { BrowserContext, Page, Request, Response } from "playwright";

import { profileDir, scriptsRoot, toolRoot } from "./paths.ts";
import { sanitizeAthleteUrl } from "./strength-workout-ui-writer.ts";

export const SAFE_ATHLETE_URL = "https://app.trainingpeaks.com/#calendar/athletes/3102415";
export const SAFE_DATE = "2026-06-06";
export const REQUIRED_SAVE_CONFIRMATION = "CAPTURE SAVE";
export const DEFAULT_DURATION_SECONDS = 900;
export const TARGET_EXERCISE_NAMES = ["Glute Bridge", "Forearm Plank", "Single Leg Calf Raise"];
export const TARGET_VALUE_TOKENS = ["TEST NOTE MANUAL CAPTURE", "2", "15", "3", "30"];

const RELEVANT_HOSTS = new Set(["tpapi.trainingpeaks.com", "api.peakswaresb.com"]);
const MAX_SHAPE_DEPTH = 5;
const MAX_TEXT_LENGTH = 220;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ParentNodeDebug = {
  depth: number;
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  dataTestId?: string;
  textSample?: string;
  rect?: Rect;
};

export type ControlDebug = {
  index: number;
  tag: string;
  type?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  nearbyText?: string;
  labelText?: string;
  rect?: Rect;
  parentChain?: ParentNodeDebug[];
};

export type ExerciseOccurrenceDebug = {
  name: string;
  source: "text" | "inputValue" | "textareaValue" | "ariaLabel" | "placeholder";
  value: string;
  rect?: Rect;
  parentChain?: ParentNodeDebug[];
  nearbyInputs?: ControlDebug[];
  nearbyButtons?: ControlDebug[];
};

export type PossibleExerciseCardDebug = {
  exactName: string;
  evidenceSource: string;
  rect?: Rect;
  textSample: string[];
  inputValues: string[];
  controls: ControlDebug[];
  parentChain?: ParentNodeDebug[];
};

export type DialogCaptureDebug = {
  index: number;
  rect: Rect;
  textSample: string[];
  inputs: ControlDebug[];
  textareas: ControlDebug[];
  buttons: ControlDebug[];
  exactExerciseNameOccurrences: ExerciseOccurrenceDebug[];
  exactValueTokenOccurrences: ExerciseOccurrenceDebug[];
  possibleExerciseCards: PossibleExerciseCardDebug[];
};

export type ActiveElementDebug = {
  tag?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  textSample?: string;
  rect?: Rect;
  parentChain?: ParentNodeDebug[];
};

export type DomCaptureArtifact = {
  checkpoint: string;
  url: string;
  timestamp: string;
  targetExerciseNames: string[];
  dialogFound: boolean;
  dialogs: DialogCaptureDebug[];
  activeElement?: ActiveElementDebug;
  focusedControl?: ControlDebug;
  valueSignalControls: ControlDebug[];
};

export type NetworkEvent = {
  checkpoint: string;
  timestamp: string;
  method: string;
  urlRedacted: string;
  resourceType: string;
  status?: number;
  requestPostDataShape?: unknown;
  responseJsonShape?: unknown;
  responseTextSnippet?: string;
  headersRedacted: true;
};

export type TruthCaptureArgs = {
  athleteUrl: string;
  date: string;
  headless: boolean;
  manual: boolean;
  durationSeconds: number;
  allowSaveCapture: boolean;
  help: boolean;
};

export type CheckpointSpec = {
  id: string;
  prompt: string;
  screenshotName: string;
  domFileName: string;
  optional?: boolean;
};

export type RunArtifacts = {
  runDir: string;
  screenshotsDir: string;
  domDir: string;
  networkDir: string;
  summaryPath: string;
  logPath: string;
  networkEventsPath: string;
};

export type CheckpointCaptureRecord = {
  id: string;
  prompt: string;
  startedAt: string;
  completedAt?: string;
  action?: "captured" | "skipped" | "quit";
  attemptCount?: number;
  skipped?: boolean;
  required?: boolean;
  optional?: boolean;
  dialogFound?: boolean;
  exerciseOccurrenceCount?: number;
  inputControlCount?: number;
  networkEventCount?: number;
  screenshotPath?: string;
  domPath?: string;
  domStatus?: "captured" | "failed" | "not_attempted";
  errors?: string[];
};

export type FinishedReason = "completed_all_checkpoints" | "user_quit" | "duration_exceeded" | "fatal_error";

export type TruthCaptureLog = {
  runAt: string;
  runDir: string;
  athleteUrlRedacted: string;
  date: string;
  manual: boolean;
  allowSaveCapture: boolean;
  finishedReason: FinishedReason;
  liveCaptureRan: boolean;
  checkpoints: CheckpointCaptureRecord[];
  screenshots: string[];
  domArtifacts: string[];
  networkEventsPath: string;
  networkEventCount: number;
  networkEvents: NetworkEvent[];
  verdict: TruthCaptureVerdict;
  notes: string[];
  errors: string[];
};

export type TruthCaptureVerdict =
  | "continue_ui_writer_with_exact_selectors"
  | "pivot_to_network_payload_writer"
  | "pause_field_automation_do_catalog_enrichment"
  | "capture_incomplete";

export type BrowserDomCaptureInput = {
  checkpoint: string;
  targetExerciseNames: string[];
  targetValueTokens: string[];
};

let browserDomCaptureScriptPromise: Promise<string> | undefined;

async function loadBrowserDomCaptureScript(): Promise<string> {
  if (!browserDomCaptureScriptPromise) {
    const browserScriptPath = path.join(scriptsRoot, "lib", "strength-field-truth-dom-capture.browser.js");
    browserDomCaptureScriptPromise = readFile(browserScriptPath, "utf8").then((script) => {
      assert(!script.includes("__name("), "DOM browser script must not contain __name transform markers.");
      assert(
        script.includes("browserCaptureStrengthFieldTruthDom"),
        "DOM browser script must define browserCaptureStrengthFieldTruthDom."
      );
      return script;
    });
  }
  return browserDomCaptureScriptPromise;
}

type ShapeObject = {
  type: string;
  keys?: string[];
  fields?: Record<string, unknown>;
  length?: number;
  itemShape?: unknown;
};

function sanitizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\/athletes\/\d+/gi, "/athletes/<ATHLETE_ID>")
    .replace(/\/workouts\/\d+/gi, "/workouts/<WORKOUT_ID>")
    .replace(/\b\d{8,}\b/g, "<ID>")
    .slice(0, maxLength);
}

function sanitizeUrl(inputUrl: string): string {
  return sanitizeText(inputUrl, 400)
    .replace(/\/exercises\/\d+/gi, "/exercises/<EXERCISE_ID>")
    .replace(/\bathleteId=\d+\b/gi, "athleteId=<ATHLETE_ID>")
    .replace(/\bworkoutId=\d+\b/gi, "workoutId=<WORKOUT_ID>")
    .replace(/\bexerciseId=\d+\b/gi, "exerciseId=<EXERCISE_ID>");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toShape(value: unknown, depth = 0): unknown {
  if (depth > MAX_SHAPE_DEPTH) {
    return { type: "truncated" satisfies string };
  }
  if (value === null) return { type: "null" satisfies string };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      itemShape: value.length > 0 ? toShape(value[0], depth + 1) : { type: "empty" },
    } satisfies ShapeObject;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).slice(0, 24);
    const fields: Record<string, unknown> = {};
    for (const key of keys.slice(0, 12)) {
      fields[key] = toShape(value[key], depth + 1);
    }
    return {
      type: "object",
      keys,
      fields,
    } satisfies ShapeObject;
  }
  if (typeof value === "string") return { type: "string" satisfies string };
  if (typeof value === "number") return { type: "number" satisfies string };
  if (typeof value === "boolean") return { type: "boolean" satisfies string };
  return { type: typeof value satisfies string };
}

function parseBody(raw: string): { parsed: unknown; snippet?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { parsed: null };
  }
  try {
    return { parsed: JSON.parse(trimmed) as unknown };
  } catch {
    if (trimmed.includes("=") && trimmed.includes("&")) {
      const params = new URLSearchParams(trimmed);
      const record: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        record[key] = sanitizeText(value, 80);
      }
      return { parsed: record };
    }
    return { parsed: null, snippet: sanitizeText(trimmed, 180) };
  }
}

function isRelevantNetworkUrl(inputUrl: string): boolean {
  try {
    const parsed = new URL(inputUrl);
    const pathname = parsed.pathname.toLowerCase();
    if (RELEVANT_HOSTS.has(parsed.hostname.toLowerCase())) {
      return true;
    }
    return (
      pathname.includes("/rx/activity/") ||
      pathname.includes("/fitness/") ||
      pathname.includes("/workouts/") ||
      pathname.includes("/structure/")
    );
  } catch {
    return false;
  }
}

function buildTimestampSlug(date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function buildHelpText(): string {
  return [
    "TrainingPeaks Strength Field Truth Capture (diagnostic-only)",
    "",
    "Usage:",
    `  npm run tp:capture-strength-field-truth -- --athlete-url "${SAFE_ATHLETE_URL}" --date ${SAFE_DATE} --headed --manual --duration ${DEFAULT_DURATION_SECONDS}`,
    "",
    "Options:",
    "  --athlete-url <url>       Safe test athlete calendar URL",
    "  --date <YYYY-MM-DD>       Safe test date",
    "  --headed | --headless     Browser mode (required)",
    "  --manual                  Required. Script only captures while Igor edits manually",
    "  --duration <seconds>      Overall run deadline in seconds",
    "  --allow-save-capture      Enable separate save-capture phase after typed confirmation",
    "  --help                    Show this help",
    "",
    "Checkpoint prompt controls:",
    "  - Enter: capture and continue",
    "  - r: retry current checkpoint",
    "  - s: skip optional checkpoint",
    "  - q: finish early and write summary",
    "",
    "Safety:",
    "  - No field writing by automation.",
    "  - No Save click by automation.",
    `  - Save capture requires typed confirmation: ${REQUIRED_SAVE_CONFIRMATION}`,
    `  - Only supported safe athlete/date: ${SAFE_ATHLETE_URL} on ${SAFE_DATE}`,
  ].join("\n");
}

export function parseTruthCaptureArgs(argv: string[]): TruthCaptureArgs {
  const parsed: Partial<TruthCaptureArgs> = {
    durationSeconds: DEFAULT_DURATION_SECONDS,
    allowSaveCapture: false,
    manual: false,
    help: false,
  };
  let browserModeProvided = false;

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
    if (arg === "--manual") {
      parsed.manual = true;
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
    if (arg === "--allow-save-capture") {
      parsed.allowSaveCapture = true;
      continue;
    }
    if (arg.startsWith("--duration=")) {
      const value = Number(arg.slice("--duration=".length).trim());
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --duration value "${arg}".`);
      }
      parsed.durationSeconds = Math.floor(value);
      continue;
    }
    if (arg === "--duration") {
      const next = argv[index + 1];
      if (!next) throw new Error("Missing value after --duration");
      const value = Number(next.trim());
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --duration value "${next}".`);
      }
      parsed.durationSeconds = Math.floor(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.help) {
    return parsed as TruthCaptureArgs;
  }
  if (!parsed.athleteUrl) {
    throw new Error("Missing required --athlete-url.");
  }
  if (!parsed.date) {
    throw new Error("Missing required --date.");
  }
  if (!browserModeProvided) {
    throw new Error("Missing required browser mode. Pass either --headed or --headless.");
  }
  if (!parsed.manual) {
    throw new Error("This diagnostic requires --manual because Igor must edit fields by hand.");
  }
  if (parsed.athleteUrl !== SAFE_ATHLETE_URL) {
    throw new Error(`Only safe athlete URL is allowed: ${SAFE_ATHLETE_URL}`);
  }
  if (parsed.date !== SAFE_DATE) {
    throw new Error(`Only safe date is allowed: ${SAFE_DATE}`);
  }
  return parsed as TruthCaptureArgs;
}

export function buildCheckpointPlan(allowSaveCapture: boolean): CheckpointSpec[] {
  const base: CheckpointSpec[] = [
    {
      id: "checkpoint-01-builder-open",
      prompt: "Checkpoint 1:\nOpen New Strength Builder with a TEST workout visible.\nPress Enter when ready.",
      screenshotName: "checkpoint-01-builder-open.png",
      domFileName: "checkpoint-01-builder-open.json",
    },
    {
      id: "checkpoint-02-glute-card-focused",
      prompt: "Checkpoint 2:\nManually add/select Glute Bridge and click into its exercise card.\nPress Enter when ready.",
      screenshotName: "checkpoint-02-glute-card-focused.png",
      domFileName: "checkpoint-02-glute-card-focused.json",
    },
    {
      id: "checkpoint-03-glute-sets-reps-set",
      prompt: "Checkpoint 3:\nManually set Glute Bridge sets=2 and reps=15.\nPress Enter when ready.",
      screenshotName: "checkpoint-03-glute-sets-reps-set.png",
      domFileName: "checkpoint-03-glute-sets-reps-set.json",
    },
    {
      id: "checkpoint-04-glute-note-set",
      prompt: "Checkpoint 4:\nOpen or add Coach Notes for Glute Bridge and type TEST NOTE MANUAL CAPTURE Glute Bridge.\nPress Enter when ready.",
      screenshotName: "checkpoint-04-glute-note-set.png",
      domFileName: "checkpoint-04-glute-note-set.json",
    },
    {
      id: "checkpoint-05-plank-duration-set",
      prompt: "Checkpoint 5:\nOptionally repeat with Forearm Plank, sets=3, duration/time=30 sec, note TEST NOTE MANUAL CAPTURE Forearm Plank.\nIf you skip the second exercise, just press Enter.\nPress Enter when ready.",
      screenshotName: "checkpoint-05-plank-duration-set.png",
      domFileName: "checkpoint-05-plank-duration-set.json",
      optional: true,
    },
    {
      id: "checkpoint-06-before-save",
      prompt: "Checkpoint 6:\nStop before Save. Do NOT click Save unless this run was started with --allow-save-capture.\nPress Enter when ready.",
      screenshotName: "checkpoint-06-before-save.png",
      domFileName: "checkpoint-06-before-save.json",
    },
  ];
  if (allowSaveCapture) {
    base.push({
      id: "checkpoint-07-after-save",
      prompt: "Checkpoint 7:\nOnly after typed confirmation, click Save manually and wait for the UI/network to settle.\nPress Enter when ready.",
      screenshotName: "checkpoint-07-after-save.png",
      domFileName: "checkpoint-07-after-save.json",
    });
  }
  return base;
}

export async function ensureRunArtifacts(): Promise<RunArtifacts> {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const runDir = path.join(repoRoot, "reports", "strength-field-truth-capture", buildTimestampSlug());
  const screenshotsDir = path.join(runDir, "screenshots");
  const domDir = path.join(runDir, "dom");
  const networkDir = path.join(runDir, "network");
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(domDir, { recursive: true });
  await mkdir(networkDir, { recursive: true });
  return {
    runDir,
    screenshotsDir,
    domDir,
    networkDir,
    summaryPath: path.join(runDir, "RUN_SUMMARY.md"),
    logPath: path.join(runDir, "capture-log.json"),
    networkEventsPath: path.join(networkDir, "network-events.json"),
  };
}

export function getRepoRelativePath(absolutePath: string): string {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const relative = path.relative(repoRoot, absolutePath);
  return relative.startsWith("..") ? absolutePath : relative;
}

export async function saveJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function saveText(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, `${value.endsWith("\n") ? value : `${value}\n`}`, "utf8");
}

async function promptWithDeadline(promptText: string, deadlineAtMs: number): Promise<string> {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw new Error("Truth capture timed out before the next checkpoint was completed.");
  }
  const rl = createInterface({ input, output });
  const timeoutPromise = new Promise<string>((_, reject) => {
    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      reject(new Error("Truth capture timed out while waiting for manual checkpoint input."));
    }, remainingMs);
  });
  try {
    const answerPromise = rl.question(`${promptText}\n`);
    return await Promise.race([answerPromise, timeoutPromise]);
  } finally {
    rl.close();
  }
}

function normalizeCheckpointAction(inputValue: string): "capture" | "retry" | "skip" | "quit" {
  const normalized = inputValue.trim().toLowerCase();
  if (normalized === "") return "capture";
  if (normalized === "r") return "retry";
  if (normalized === "s") return "skip";
  if (normalized === "q") return "quit";
  return "capture";
}

export async function waitForCheckpointEnter(promptText: string, deadlineAtMs: number): Promise<void> {
  await promptWithDeadline(promptText, deadlineAtMs);
}

export async function waitForCheckpointAction(
  checkpointPrompt: string,
  deadlineAtMs: number
): Promise<"capture" | "retry" | "skip" | "quit"> {
  const promptLines = [
    checkpointPrompt,
    "",
    "Actions:",
    "  Enter = capture and continue",
    "  r = retry current checkpoint",
    "  s = skip optional checkpoint",
    "  q = finish early and write summary",
    "Input:",
  ];
  const answer = await promptWithDeadline(promptLines.join("\n"), deadlineAtMs);
  return normalizeCheckpointAction(answer);
}

export async function waitForTypedConfirmation(
  promptText: string,
  expectedValue: string,
  deadlineAtMs: number
): Promise<void> {
  const answer = await promptWithDeadline(promptText, deadlineAtMs);
  if (answer.trim() !== expectedValue) {
    throw new Error(`Typed confirmation mismatch. Expected "${expectedValue}".`);
  }
}

export async function saveCheckpointScreenshot(page: Page, screenshotsDir: string, fileName: string): Promise<string> {
  const absolutePath = path.join(screenshotsDir, fileName);
  await page.screenshot({ path: absolutePath, fullPage: true });
  return absolutePath;
}

export async function captureDomArtifact(page: Page, checkpointId: string): Promise<DomCaptureArtifact> {
  const script = await loadBrowserDomCaptureScript();
  const evalInput: BrowserDomCaptureInput = {
    checkpoint: checkpointId,
    targetExerciseNames: TARGET_EXERCISE_NAMES,
    targetValueTokens: TARGET_VALUE_TOKENS,
  };
  return await page.evaluate(
    ({ scriptSource, input }) => {
      return new Function(
        "input",
        `${scriptSource}\nreturn browserCaptureStrengthFieldTruthDom(input);`
      )(input);
    },
    { scriptSource: script, input: evalInput }
  );
}

export async function saveDomArtifact(domDir: string, fileName: string, artifact: DomCaptureArtifact): Promise<string> {
  const absolutePath = path.join(domDir, fileName);
  await saveJson(absolutePath, artifact);
  return absolutePath;
}

export function attachNetworkCapture(
  context: BrowserContext,
  state: { currentCheckpoint: string; events: NetworkEvent[] }
): void {
  const handleFinished = async (request: Request, response: Response | null): Promise<void> => {
    const requestUrl = request.url();
    if (!isRelevantNetworkUrl(requestUrl)) return;

    const parsedRequest = parseBody(request.postData() ?? "");
    let responseJsonShape: unknown;
    let responseTextSnippet: string | undefined;
    let status: number | undefined;

    if (response) {
      status = response.status();
      const contentType = response.headers()["content-type"] ?? "";
      if (contentType.includes("json")) {
        try {
          responseJsonShape = toShape(JSON.parse(await response.text()) as unknown);
        } catch {
          responseTextSnippet = sanitizeText(await response.text(), 180);
        }
      } else if (contentType.includes("text") || contentType.includes("javascript")) {
        responseTextSnippet = sanitizeText(await response.text(), 180);
      }
    }

    state.events.push({
      checkpoint: state.currentCheckpoint,
      timestamp: new Date().toISOString(),
      method: request.method().toUpperCase(),
      urlRedacted: sanitizeUrl(requestUrl),
      resourceType: request.resourceType(),
      status,
      requestPostDataShape: parsedRequest.parsed === null ? undefined : toShape(parsedRequest.parsed),
      responseJsonShape,
      responseTextSnippet,
      headersRedacted: true,
    });
  };

  context.on("requestfinished", (request) => {
    handleFinished(request, request.response().catch(() => null)).catch(() => {});
  });
  context.on("requestfailed", (request) => {
    handleFinished(request, null).catch(() => {});
  });
}

function flattenDialogControls(artifact: DomCaptureArtifact): ControlDebug[] {
  return artifact.dialogs.flatMap((dialog) => [...dialog.inputs, ...dialog.textareas]);
}

function controlMatches(control: ControlDebug, ...needles: string[]): boolean {
  const haystack = sanitizeText(
    [control.value ?? "", control.placeholder ?? "", control.ariaLabel ?? "", control.labelText ?? "", control.nearbyText ?? ""].join(" "),
    600
  ).toLowerCase();
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function formatControl(control: ControlDebug | undefined): string {
  if (!control) return "not found";
  const parts = [
    `tag=${control.tag}`,
    control.type ? `type=${control.type}` : "",
    control.labelText ? `label=${control.labelText}` : "",
    control.placeholder ? `placeholder=${control.placeholder}` : "",
    control.ariaLabel ? `ariaLabel=${control.ariaLabel}` : "",
    control.nearbyText ? `nearbyText=${control.nearbyText}` : "",
    control.rect ? `rect=(${control.rect.x},${control.rect.y},${control.rect.width},${control.rect.height})` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

function dedupeLines(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH"].includes(method.toUpperCase());
}

function isSaveLikeEvent(event: NetworkEvent): boolean {
  const haystack = JSON.stringify({
    url: event.urlRedacted,
    method: event.method,
    requestPostDataShape: event.requestPostDataShape,
    responseJsonShape: event.responseJsonShape,
    responseTextSnippet: event.responseTextSnippet,
  }).toLowerCase();
  return /save|workout|structure|exercise|note|set|rep|duration/.test(haystack);
}

export function buildRunSummaryMarkdown(log: TruthCaptureLog, domArtifacts: DomCaptureArtifact[]): string {
  const dialogDetected = domArtifacts.some((artifact) => artifact.dialogFound);
  const allOccurrences = domArtifacts.flatMap((artifact) =>
    artifact.dialogs.flatMap((dialog) => dialog.exactExerciseNameOccurrences.map((occurrence) => `${occurrence.name}: ${occurrence.source}`))
  );
  const storedLocationLines = dedupeLines(allOccurrences).slice(0, 12);

  const checkpoint03 = domArtifacts.find((artifact) => artifact.checkpoint === "checkpoint-03-glute-sets-reps-set");
  const checkpoint04 = domArtifacts.find((artifact) => artifact.checkpoint === "checkpoint-04-glute-note-set");
  const checkpoint05 = domArtifacts.find((artifact) => artifact.checkpoint === "checkpoint-05-plank-duration-set");
  const checkpoint07 = domArtifacts.find((artifact) => artifact.checkpoint === "checkpoint-07-after-save");

  const controls03 = checkpoint03 ? flattenDialogControls(checkpoint03) : [];
  const controls04 = checkpoint04 ? flattenDialogControls(checkpoint04) : [];
  const controls05 = checkpoint05 ? flattenDialogControls(checkpoint05) : [];

  const setsControl = controls03.find((control) => controlMatches(control, "sets", "label sets", "nearbytext sets", " value 2"));
  const repsControl = controls03.find((control) => controlMatches(control, "reps", "rep", "15"));
  const durationControl = controls05.find((control) => controlMatches(control, "duration", "time", "sec", "30"));
  const noteControl = controls04.find((control) => controlMatches(control, "note", "coach", "instruction", "TEST NOTE"));

  const preSaveEvents = log.networkEvents.filter((event) => event.checkpoint !== "checkpoint-07-after-save");
  const saveEvents = log.networkEvents.filter((event) => event.checkpoint === "checkpoint-07-after-save");
  const preSaveMutationEvents = preSaveEvents.filter((event) => ["POST", "PUT", "PATCH"].includes(event.method));
  const saveMutationEvents = saveEvents.filter((event) => ["POST", "PUT", "PATCH"].includes(event.method));

  const uiFeasible = Boolean(dialogDetected && (setsControl || repsControl || durationControl || noteControl));
  const networkPromising = Boolean(
    preSaveMutationEvents.length > 0 ||
      saveMutationEvents.some((event) =>
        JSON.stringify(event.requestPostDataShape ?? {}).toLowerCase().match(/structure|exercise|workout|note|set|rep|duration/)
      )
  );

  const completedCheckpointCount = log.checkpoints.filter((entry) => entry.action === "captured").length;
  const missingCheckpointCount = log.checkpoints.length - completedCheckpointCount;
  const allDomFailed =
    log.checkpoints.length > 0 &&
    log.checkpoints.every(
      (entry) =>
        entry.action !== "captured" || entry.domStatus === "failed" || (!entry.domPath && Boolean(entry.screenshotPath))
    );
  const verdict: TruthCaptureVerdict =
    completedCheckpointCount < 3 || allDomFailed
      ? "capture_incomplete"
      : networkPromising
        ? "pivot_to_network_payload_writer"
        : uiFeasible
          ? "continue_ui_writer_with_exact_selectors"
          : "pause_field_automation_do_catalog_enrichment";

  const recommendation =
    verdict === "pivot_to_network_payload_writer"
      ? "Pivot to payload capture first: inspect save-phase request shapes and compare pre-save vs post-save event sequences before adding any more UI selector guesses."
      : verdict === "continue_ui_writer_with_exact_selectors"
        ? "Continue the UI writer, but only from dialog-scoped exact-name card anchors captured here and only against controls whose labels/placeholders/nearby text match the recorded evidence."
        : "Pause field automation for now. The current run did not expose stable enough dialog/card evidence or actionable payload structure.";

  const lines: string[] = [];
  lines.push("# TrainingPeaks Strength Field Truth Capture");
  lines.push("");
  lines.push("## Run");
  lines.push(`- Run at: ${log.runAt}`);
  lines.push(`- Athlete: \`${log.athleteUrlRedacted}\``);
  lines.push(`- Date: ${log.date}`);
  lines.push(`- Live truth capture ran: ${log.liveCaptureRan ? "yes" : "no"}`);
  lines.push(`- Save capture allowed: ${log.allowSaveCapture ? "yes" : "no"}`);
  lines.push(`- Finished reason: ${log.finishedReason}`);
  lines.push(`- Completed checkpoints: ${completedCheckpointCount}`);
  lines.push(`- Missing checkpoints: ${missingCheckpointCount}`);
  if (allDomFailed && log.screenshots.length > 0) {
    lines.push("- Screenshots captured, DOM capture failed.");
  }
  lines.push("");
  lines.push("## Checkpoints");
  for (const checkpoint of log.checkpoints) {
    lines.push(
      `- ${checkpoint.id}: action=${checkpoint.action ?? "unknown"}, dialogFound=${
        checkpoint.dialogFound === undefined ? "n/a" : checkpoint.dialogFound ? "yes" : "no"
      }, domStatus=${checkpoint.domStatus ?? "not_attempted"}, exerciseOccurrences=${checkpoint.exerciseOccurrenceCount ?? 0}, inputControls=${
        checkpoint.inputControlCount ?? 0
      }, networkEvents=${checkpoint.networkEventCount ?? 0}`
    );
    lines.push(`  - screenshot: ${checkpoint.screenshotPath ?? "n/a"}`);
    lines.push(`  - dom: ${checkpoint.domPath ?? "n/a"}`);
    if ((checkpoint.errors?.length ?? 0) > 0) {
      lines.push(`  - errors: ${checkpoint.errors?.join(" | ")}`);
    }
  }
  lines.push("");
  lines.push("## Findings");
  lines.push(`1. Was New Strength Builder dialog detected? ${dialogDetected ? "Yes." : "No."}`);
  lines.push("2. Where exactly is the exercise name stored?");
  if (storedLocationLines.length > 0) {
    for (const line of storedLocationLines) {
      lines.push(`- ${line}`);
    }
  } else {
    lines.push("- No exact exercise-name occurrence was captured inside a visible dialog.");
  }
  lines.push("3. Where are sets/reps/duration stored?");
  lines.push(`- Sets: ${formatControl(setsControl)}`);
  lines.push(`- Reps: ${formatControl(repsControl)}`);
  lines.push(`- Duration/time: ${formatControl(durationControl)}`);
  lines.push("4. Where are coach notes stored?");
  lines.push(`- Coach notes: ${formatControl(noteControl)}`);
  lines.push("5. Were there network calls when fields changed before Save?");
  lines.push(
    `- Relevant events before Save: ${preSaveEvents.length}; mutation-like events before Save: ${preSaveMutationEvents.length}.`
  );
  if (preSaveEvents.length > 0) {
    for (const event of preSaveEvents.slice(0, 8)) {
      lines.push(`- [${event.checkpoint}] ${event.method} ${event.urlRedacted} status=${event.status ?? "n/a"}`);
    }
  }
  lines.push("6. What changed on Save, if save-capture was allowed?");
  if (!log.allowSaveCapture) {
    lines.push("- Save capture was not enabled for this run.");
  } else if (saveEvents.length === 0) {
    lines.push("- Save capture was enabled, but no relevant post-save network event was captured.");
  } else {
    lines.push(`- Relevant events after Save: ${saveEvents.length}; mutation-like events after Save: ${saveMutationEvents.length}.`);
    for (const event of saveEvents.slice(0, 8)) {
      lines.push(`- [${event.checkpoint}] ${event.method} ${event.urlRedacted} status=${event.status ?? "n/a"}`);
    }
  }
  lines.push(`7. Is UI writer feasible? ${uiFeasible ? "Yes, with exact dialog-scoped selectors only." : "Not yet proven."}`);
  lines.push(`8. Is network/API writer more promising? ${networkPromising ? "Yes." : "Not from this run."}`);
  lines.push(`9. Exact next recommendation: ${recommendation}`);
  lines.push("");
  lines.push("## Network Summary");
  lines.push(`- Total relevant network events: ${log.networkEvents.length}`);
  const mutationEvents = log.networkEvents.filter((event) => isMutationMethod(event.method));
  lines.push(`- POST/PUT/PATCH observed: ${mutationEvents.length > 0 ? "yes" : "no"}`);
  const saveLikeEvents = log.networkEvents.filter((event) => isSaveLikeEvent(event));
  lines.push(`- Save-like endpoint observed: ${saveLikeEvents.length > 0 ? "yes" : "no"}`);
  const endpointsTouched = dedupeLines(log.networkEvents.map((event) => event.urlRedacted));
  lines.push("- Endpoints touched:");
  if (endpointsTouched.length === 0) {
    lines.push("  - none");
  } else {
    for (const endpoint of endpointsTouched.slice(0, 20)) {
      lines.push(`  - ${endpoint}`);
    }
  }
  lines.push("- Events per checkpoint interval:");
  const perCheckpoint = new Map<string, number>();
  for (const event of log.networkEvents) {
    perCheckpoint.set(event.checkpoint, (perCheckpoint.get(event.checkpoint) ?? 0) + 1);
  }
  if (perCheckpoint.size === 0) {
    lines.push("  - none");
  } else {
    for (const [checkpointId, count] of perCheckpoint.entries()) {
      lines.push(`  - ${checkpointId}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Artifacts");
  for (const screenshot of log.screenshots) {
    lines.push(`- Screenshot: \`${screenshot}\``);
  }
  for (const domPath of log.domArtifacts) {
    lines.push(`- DOM: \`${domPath}\``);
  }
  lines.push(`- Network: \`${log.networkEventsPath}\``);
  if (checkpoint07) {
    lines.push(`- Save-phase DOM captured at checkpoint: ${checkpoint07.checkpoint}`);
  }
  if (log.notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    for (const note of log.notes) {
      lines.push(`- ${note}`);
    }
  }
  if (log.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    for (const error of log.errors) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
  lines.push(`VERDICT: ${verdict}`);
  return `${lines.join("\n")}\n`;
}

export function deriveVerdict(log: TruthCaptureLog, domArtifacts: DomCaptureArtifact[]): TruthCaptureVerdict {
  const completedCheckpointCount = log.checkpoints.filter((entry) => entry.action === "captured").length;
  const allDomFailed =
    log.checkpoints.length > 0 &&
    log.checkpoints
      .filter((entry) => entry.action === "captured")
      .every((entry) => entry.domStatus === "failed");
  if (completedCheckpointCount < 3 || allDomFailed) {
    return "capture_incomplete";
  }
  const summary = buildRunSummaryMarkdown(log, domArtifacts);
  if (summary.includes("VERDICT: pivot_to_network_payload_writer")) {
    return "pivot_to_network_payload_writer";
  }
  if (summary.includes("VERDICT: continue_ui_writer_with_exact_selectors")) {
    return "continue_ui_writer_with_exact_selectors";
  }
  if (summary.includes("VERDICT: pause_field_automation_do_catalog_enrichment")) {
    return "pause_field_automation_do_catalog_enrichment";
  }
  return "capture_incomplete";
}

export { profileDir, sanitizeAthleteUrl };
