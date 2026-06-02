import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Request, type Response } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";

const TP_APP_HOST = "https://app.trainingpeaks.com";
const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const DEFAULT_ATHLETE_ID = 3102415;
const DEFAULT_ATHLETE_URL = `${TP_APP_HOST}/#calendar/athletes/${DEFAULT_ATHLETE_ID}`;
const DEFAULT_TITLE = "API CAPTURE TEST RUN DO NOT USE";
const DEFAULT_COACH_NOTES = "API capture test. Safe to delete.";
const RESPONSE_BODY_MAX_CHARS = 120_000;
const STRING_SAMPLE_MAX = 180;
const SHAPE_DEPTH_LIMIT = 5;

const SAFE_TEXT_MARKERS = ["api capture test", "do not use", "safe to delete"];
const SENSITIVE_HEADER_MARKERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "session",
  "csrf",
  "jwt",
  "bearer",
  "x-csrf-token",
] as const;
const LONG_TEXT_KEYS = ["title", "name", "description", "note", "notes", "comment", "comments", "coachcomments"] as const;

const repoRoot = path.resolve(toolRoot, "..", "..");
const fixturesDir = path.join(toolRoot, "scripts", "fixtures");
const fixturePath = path.join(fixturesDir, "running-workout-create.network-truth.fixture.json");
const reportsRoot = path.join(repoRoot, "reports", "tp-network-truth-capture", "create-running-workout");

type CliArgs = {
  athleteUrl: string;
  athleteId: number;
  headless: boolean;
  expectedTitle: string;
  expectedCoachNotes: string;
};

type CapturedCandidate = {
  id: number;
  observedAt: string;
  method: "POST";
  urlPath: string;
  endpointPattern: string;
  athleteId: number | null;
  operationGuess: "create_running_workout";
  request: {
    headerKeys: string[];
    selectedHeaders: Record<string, string>;
    bodyTopLevelKeys: string[];
    bodyShape: unknown;
    bodyFieldSamples: Record<string, unknown>;
    parseNote: string | null;
  };
  response: {
    status: number | null;
    ok: boolean | null;
    headerKeys: string[];
    selectedHeaders: Record<string, string>;
    bodyTopLevelKeys: string[];
    bodyShape: unknown;
    bodyFieldSamples: Record<string, unknown>;
    parseNote: string | null;
    failedText: string | null;
  };
  bestCandidateScore: number;
  bestCandidateReasons: string[];
};

type CandidateSummary = {
  id: number;
  urlPath: string;
  responseStatus: number | null;
  score: number;
  reasons: string[];
};

function printHelp(): void {
  console.log("TrainingPeaks running workout create network capture (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp-capture-create-running-workout-network -- --athlete-url https://app.trainingpeaks.com/#calendar/athletes/3102415");
  console.log("");
  console.log("Options:");
  console.log(`  --athlete-url=<url>       Athlete calendar URL (default: ${DEFAULT_ATHLETE_URL})`);
  console.log(`  --expected-title=<text>   Expected workout title (default: ${DEFAULT_TITLE})`);
  console.log(`  --expected-coach-notes=<text> Expected coach notes (default: ${DEFAULT_COACH_NOTES})`);
  console.log("  --headless                Launch browser headless (default: headed)");
  console.log("  --headed                  Force headed browser mode");
  console.log("  --help                    Show this help");
  console.log("");
  console.log("Safety:");
  console.log("  - This script never clicks Save and never replays POST requests.");
  console.log("  - It only observes matching POST traffic while you create the workout manually.");
  console.log("  - Authorization/Cookie/session headers are redacted and never saved.");
}

function readRequiredNextArg(argv: string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`Missing value after ${flag}`);
  }
  const value = next.trim();
  if (!value) {
    throw new Error(`Empty ${flag} value.`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteUrl: DEFAULT_ATHLETE_URL,
    athleteId: DEFAULT_ATHLETE_ID,
    headless: false,
    expectedTitle: DEFAULT_TITLE,
    expectedCoachNotes: DEFAULT_COACH_NOTES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--athlete-url=")) {
      const value = arg.slice("--athlete-url=".length).trim();
      if (!value.startsWith(TP_APP_HOST)) {
        throw new Error(`--athlete-url must start with ${TP_APP_HOST}`);
      }
      parsed.athleteUrl = value;
      continue;
    }
    if (arg === "--athlete-url") {
      const value = readRequiredNextArg(argv, index, "--athlete-url");
      if (!value.startsWith(TP_APP_HOST)) {
        throw new Error(`--athlete-url must start with ${TP_APP_HOST}`);
      }
      parsed.athleteUrl = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--expected-title=")) {
      const value = arg.slice("--expected-title=".length).trim();
      if (!value) {
        throw new Error("Empty --expected-title value.");
      }
      parsed.expectedTitle = value;
      continue;
    }
    if (arg === "--expected-title") {
      parsed.expectedTitle = readRequiredNextArg(argv, index, "--expected-title");
      index += 1;
      continue;
    }
    if (arg.startsWith("--expected-coach-notes=")) {
      const value = arg.slice("--expected-coach-notes=".length).trim();
      if (!value) {
        throw new Error("Empty --expected-coach-notes value.");
      }
      parsed.expectedCoachNotes = value;
      continue;
    }
    if (arg === "--expected-coach-notes") {
      parsed.expectedCoachNotes = readRequiredNextArg(argv, index, "--expected-coach-notes");
      index += 1;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const athleteId = parseAthleteIdFromUrl(parsed.athleteUrl);
  if (!athleteId) {
    throw new Error("Could not parse athlete id from --athlete-url.");
  }
  parsed.athleteId = athleteId;
  return parsed;
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveHeaderKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_HEADER_MARKERS.some((marker) => normalized.includes(normalizeKey(marker)));
}

function isLongTextKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return LONG_TEXT_KEYS.some((marker) => normalized.includes(normalizeKey(marker)));
}

function isSafeTextValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return SAFE_TEXT_MARKERS.some((marker) => normalized.includes(marker));
}

function sanitizeUrlPath(inputUrl: string): string {
  const url = new URL(inputUrl);
  return url.pathname.replace(/\/+$/, "") || "/";
}

function buildEndpointPattern(pathname: string): string {
  return pathname
    .replace(/\/athletes\/\d+/gi, "/athletes/{athleteId}")
    .replace(/\/workouts\/\d+/gi, "/workouts/{workoutId}")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "{date}")
    .replace(/\b\d{10,}\b/g, "{id}");
}

function sanitizeScalar(value: unknown, parentKey = ""): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed)) {
    return "[REDACTED_EMAIL]";
  }

  if (/bearer\s+[a-z0-9\-._~+/]+=*/i.test(trimmed)) {
    return "[REDACTED_TOKEN]";
  }

  if (/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/.test(trimmed)) {
    return "[REDACTED_JWT]";
  }

  if (parentKey && isSensitiveHeaderKey(parentKey)) {
    return "[REDACTED]";
  }

  if (parentKey && isLongTextKey(parentKey)) {
    if (isSafeTextValue(trimmed)) {
      return trimmed.slice(0, STRING_SAMPLE_MAX);
    }
    return "[REDACTED_TEXT]";
  }

  if (/https?:\/\//i.test(trimmed)) {
    try {
      return sanitizeUrlPath(trimmed);
    } catch {
      return "[REDACTED_URL]";
    }
  }

  if (trimmed.length > 80 && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed)) {
    return "[REDACTED_LONG_STRING]";
  }

  return trimmed.length > STRING_SAMPLE_MAX ? `${trimmed.slice(0, STRING_SAMPLE_MAX)}...[truncated]` : trimmed;
}

function redactUnknown(inputValue: unknown, parentKey = ""): unknown {
  if (parentKey && isSensitiveHeaderKey(parentKey)) {
    return "[REDACTED]";
  }

  if (Array.isArray(inputValue)) {
    return inputValue.map((item) => redactUnknown(item, parentKey));
  }

  if (isRecord(inputValue)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputValue)) {
      out[key] = redactUnknown(value, key);
    }
    return out;
  }

  return sanitizeScalar(inputValue, parentKey);
}

function parsePossiblyJson(text: string): { value: unknown; note: string | null } {
  try {
    return { value: JSON.parse(text), note: null };
  } catch {
    return { value: text, note: "body was not valid JSON; stored as sanitized text" };
  }
}

function collectTopLevelKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).slice(0, 80) : [];
}

function describeShape(value: unknown, depth = 0): unknown {
  if (depth >= SHAPE_DEPTH_LIMIT) {
    return { type: "truncated" };
  }
  if (value === null) {
    return { type: "null" };
  }
  if (Array.isArray(value)) {
    const firstDefined = value.find((item) => item !== undefined);
    return {
      type: "array",
      length: value.length,
      itemShape: firstDefined === undefined ? { type: "unknown" } : describeShape(firstDefined, depth + 1),
    };
  }
  if (isRecord(value)) {
    const fields: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      fields[key] = describeShape(item, depth + 1);
    }
    return {
      type: "object",
      keys: Object.keys(value).slice(0, 80),
      fields,
    };
  }
  return { type: typeof value };
}

function pickFieldSamples(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const wantedKeys = [
    "title",
    "name",
    "workoutDay",
    "date",
    "workoutTypeValueId",
    "workoutSubTypeId",
    "totalTimePlanned",
    "duration",
    "distancePlanned",
    "distance",
    "coachComments",
    "description",
    "workoutId",
    "athleteId",
  ];

  const out: Record<string, unknown> = {};
  for (const key of wantedKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out[key] = redactUnknown(value[key], key);
    }
  }
  return out;
}

function selectHeaders(headers: Record<string, string>): Record<string, string> {
  const preferred = ["accept", "content-type", "origin", "referer", "x-requested-with", "user-agent"];
  const out: Record<string, string> = {};
  for (const name of preferred) {
    const headerValue = headers[name];
    if (typeof headerValue === "string" && headerValue.trim()) {
      out[name] = String(redactUnknown(headerValue, name));
    }
  }
  return out;
}

function looksTextualResponse(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("application/json") ||
    normalized.includes("application/javascript") ||
    normalized.includes("application/xml") ||
    normalized.includes("application/x-www-form-urlencoded") ||
    normalized.includes("text/")
  );
}

function isCreateWorkoutPost(request: Request): boolean {
  if (request.method().toUpperCase() !== "POST") {
    return false;
  }
  const url = new URL(request.url());
  return (
    url.origin === TP_API_HOST &&
    /^\/fitness\/v6\/athletes\/\d+\/workouts\/?$/i.test(url.pathname)
  );
}

function getObservedAt(request: Request): string {
  const startTime = request.timing().startTime;
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return new Date().toISOString();
  }
  return new Date(startTime).toISOString();
}

function scoreCandidate(input: {
  candidate: Omit<CapturedCandidate, "bestCandidateScore" | "bestCandidateReasons">;
  expectedTitle: string;
  expectedCoachNotes: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const requestSamples = input.candidate.request.bodyFieldSamples;
  const responseStatus = input.candidate.response.status;

  if (input.candidate.urlPath === `/fitness/v6/athletes/${input.candidate.athleteId}/workouts`) {
    score += 10;
    reasons.push("exact create-workout endpoint path");
  }
  if (requestSamples.title === input.expectedTitle || requestSamples.name === input.expectedTitle) {
    score += 8;
    reasons.push("expected safe test title observed");
  }
  if (typeof requestSamples.workoutDay === "string" || typeof requestSamples.date === "string") {
    score += 5;
    reasons.push("workout date field observed");
  }
  if (typeof requestSamples.workoutTypeValueId === "number" || typeof requestSamples.workoutSubTypeId === "number") {
    score += 5;
    reasons.push("workout type identifiers observed");
  }
  if (typeof requestSamples.totalTimePlanned === "number" || typeof requestSamples.duration === "number") {
    score += 4;
    reasons.push("duration field observed");
  }
  if (requestSamples.coachComments === input.expectedCoachNotes || requestSamples.description === input.expectedCoachNotes) {
    score += 4;
    reasons.push("expected safe coach notes observed");
  }
  if (typeof responseStatus === "number" && responseStatus >= 200 && responseStatus < 300) {
    score += 3;
    reasons.push(`2xx response status (${responseStatus})`);
  }

  return { score, reasons };
}

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

async function buildCapturedCandidate(input: {
  id: number;
  request: Request;
  response: Response | null;
  failedText: string | null;
  expectedTitle: string;
  expectedCoachNotes: string;
}): Promise<CapturedCandidate> {
  const urlPath = sanitizeUrlPath(input.request.url());
  const requestHeaders = input.request.headers();
  const rawRequestBody = input.request.postData() ?? "";
  const parsedRequest = rawRequestBody ? parsePossiblyJson(rawRequestBody) : { value: null, note: null };
  const redactedRequestBody = redactUnknown(parsedRequest.value);

  let responseStatus: number | null = null;
  let responseOk: boolean | null = null;
  let responseHeaders: Record<string, string> = {};
  let responseBody: unknown = null;
  let responseParseNote: string | null = null;

  if (input.response) {
    responseStatus = input.response.status();
    responseOk = input.response.ok();
    responseHeaders = input.response.headers();
    const contentType = responseHeaders["content-type"] ?? "";
    if (looksTextualResponse(contentType)) {
      try {
        const rawText = await input.response.text();
        if (rawText.length <= RESPONSE_BODY_MAX_CHARS) {
          const parsed = parsePossiblyJson(rawText);
          responseBody = redactUnknown(parsed.value);
          responseParseNote = parsed.note;
        } else {
          responseBody = `[omitted large response body: ${rawText.length} chars]`;
          responseParseNote = "response body omitted because it exceeded safe size limit";
        }
      } catch (error) {
        responseBody = `[unavailable: ${(error as Error).message}]`;
        responseParseNote = "response body could not be read";
      }
    } else {
      responseBody = `[omitted non-text response: ${contentType || "unknown"}]`;
      responseParseNote = "non-text response body omitted";
    }
  }

  const baseCandidate = {
    id: input.id,
    observedAt: getObservedAt(input.request),
    method: "POST" as const,
    urlPath,
    endpointPattern: buildEndpointPattern(urlPath),
    athleteId: parseAthleteIdFromUrl(input.request.url()),
    operationGuess: "create_running_workout" as const,
    request: {
      headerKeys: Object.keys(requestHeaders).filter((key) => !isSensitiveHeaderKey(key)).sort(),
      selectedHeaders: selectHeaders(requestHeaders),
      bodyTopLevelKeys: collectTopLevelKeys(redactedRequestBody),
      bodyShape: describeShape(redactedRequestBody),
      bodyFieldSamples: pickFieldSamples(redactedRequestBody),
      parseNote: parsedRequest.note,
    },
    response: {
      status: responseStatus,
      ok: responseOk,
      headerKeys: Object.keys(responseHeaders).filter((key) => !isSensitiveHeaderKey(key)).sort(),
      selectedHeaders: selectHeaders(responseHeaders),
      bodyTopLevelKeys: collectTopLevelKeys(responseBody),
      bodyShape: describeShape(responseBody),
      bodyFieldSamples: pickFieldSamples(responseBody),
      parseNote: responseParseNote,
      failedText: input.failedText,
    },
  };

  const scored = scoreCandidate({
    candidate: baseCandidate,
    expectedTitle: input.expectedTitle,
    expectedCoachNotes: input.expectedCoachNotes,
  });

  return {
    ...baseCandidate,
    bestCandidateScore: scored.score,
    bestCandidateReasons: scored.reasons,
  };
}

function chooseBestCandidate(candidates: CapturedCandidate[]): CapturedCandidate | null {
  return [...candidates].sort((a, b) => {
    return b.bestCandidateScore - a.bestCandidateScore || (b.response.status ?? -1) - (a.response.status ?? -1) || a.id - b.id;
  })[0] ?? null;
}

function buildRunSummaryMarkdown(input: {
  athleteId: number;
  athleteUrl: string;
  runDir: string;
  fixturePathRelative: string;
  candidates: CapturedCandidate[];
  bestCandidate: CapturedCandidate | null;
  fixtureWritten: boolean;
}): string {
  const lines = [
    "# Create Running Workout Network Truth Capture",
    "",
    `- athlete_id: \`${input.athleteId}\``,
    `- athlete_url: \`${input.athleteUrl}\``,
    `- run_dir: \`${input.runDir}\``,
    `- candidate_count: **${input.candidates.length}**`,
    `- best_candidate_id: \`${input.bestCandidate?.id ?? "none"}\``,
    `- fixture_written: **${input.fixtureWritten ? "yes" : "no"}**`,
    `- fixture_path: \`${input.fixturePathRelative}\``,
    "",
    "## Safety",
    "- Manual attended capture only.",
    "- No Save click or request replay was performed by automation.",
    "- Authorization/Cookie/session-like material was redacted and not stored.",
    "",
    "## Best Candidate",
  ];

  if (input.bestCandidate) {
    lines.push(`- endpoint: \`${input.bestCandidate.endpointPattern}\``);
    lines.push(`- status: **${input.bestCandidate.response.status ?? "unknown"}**`);
    lines.push(
      `- reasons: ${input.bestCandidate.bestCandidateReasons.length ? input.bestCandidate.bestCandidateReasons.join("; ") : "none"}`,
    );
    lines.push(
      `- request_fields: ${Object.keys(input.bestCandidate.request.bodyFieldSamples).length ? Object.keys(input.bestCandidate.request.bodyFieldSamples).join(", ") : "none"}`,
    );
    lines.push(
      `- response_fields: ${Object.keys(input.bestCandidate.response.bodyFieldSamples).length ? Object.keys(input.bestCandidate.response.bodyFieldSamples).join(", ") : "none"}`,
    );
  } else {
    lines.push("- No matching create-workout POST was captured.");
  }

  lines.push("");
  lines.push("## Captured Candidates");
  if (input.candidates.length === 0) {
    lines.push("- none");
  } else {
    for (const candidate of input.candidates) {
      lines.push(
        `- #${candidate.id}: \`${candidate.urlPath}\` status=${candidate.response.status ?? "unknown"} score=${candidate.bestCandidateScore} reasons=${candidate.bestCandidateReasons.join("; ") || "none"}`,
      );
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runTimestamp = timestampForPath(new Date());
  const runDir = path.join(reportsRoot, runTimestamp);
  const networkEventsPath = path.join(runDir, "network-events.json");
  const summaryPath = path.join(runDir, "RUN_SUMMARY.md");
  const fixturePathRelative = path.relative(repoRoot, fixturePath);
  const runDirRelative = path.relative(repoRoot, runDir);

  await mkdir(profileDir, { recursive: true });
  await mkdir(fixturesDir, { recursive: true });
  await mkdir(runDir, { recursive: true });

  console.log("[tp-capture-create-running-workout-network] mode: read-only attended capture");
  console.log(`[tp-capture-create-running-workout-network] athlete: ${args.athleteUrl}`);
  console.log(`[tp-capture-create-running-workout-network] profile: ${profileDir}`);
  console.log(`[tp-capture-create-running-workout-network] run dir: ${runDir}`);
  console.log("[tp-capture-create-running-workout-network] automation will not click Save and will not replay POST requests.");
  console.log("");
  console.log("1. Open in the browser TrainingPeaks calendar for the safe test athlete.");
  console.log("2. Create a normal TEST running workout on a safe future date.");
  console.log(`3. Use title exactly: ${args.expectedTitle}`);
  console.log("4. Do not use real athletes.");
  console.log("5. After Save, return to the terminal and press Enter.");
  console.log("6. The script will save a sanitized network truth fixture.");
  console.log("");
  console.log("Recommended test workout values:");
  console.log(`- athleteId: ${args.athleteId}`);
  console.log("- type: Run");
  console.log("- duration: 00:20:00");
  console.log(`- coach notes: ${args.expectedCoachNotes}`);
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  const candidates: CapturedCandidate[] = [];
  const requestIds = new Map<Request, number>();
  let nextId = 1;

  const assignId = (request: Request): number => {
    const existing = requestIds.get(request);
    if (typeof existing === "number") {
      return existing;
    }
    const id = nextId++;
    requestIds.set(request, id);
    return id;
  };

  context.on("request", (request) => {
    if (isCreateWorkoutPost(request)) {
      assignId(request);
    }
  });

  context.on("requestfinished", async (request) => {
    if (!isCreateWorkoutPost(request)) {
      return;
    }
    const response = await request.response();
    const candidate = await buildCapturedCandidate({
      id: assignId(request),
      request,
      response,
      failedText: null,
      expectedTitle: args.expectedTitle,
      expectedCoachNotes: args.expectedCoachNotes,
    });
    candidates.push(candidate);
  });

  context.on("requestfailed", async (request) => {
    if (!isCreateWorkoutPost(request)) {
      return;
    }
    const candidate = await buildCapturedCandidate({
      id: assignId(request),
      request,
      response: null,
      failedText: request.failure()?.errorText ?? "request failed",
      expectedTitle: args.expectedTitle,
      expectedCoachNotes: args.expectedCoachNotes,
    });
    candidates.push(candidate);
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    await page.waitForTimeout(1500);
    await waitForEnter("Press Enter after you manually save the test running workout.");
    await page.waitForTimeout(2500);
  } finally {
    await context.close().catch(() => {});
  }

  candidates.sort((a, b) => a.id - b.id);
  const bestCandidate = chooseBestCandidate(candidates);
  const candidateSummaries: CandidateSummary[] = candidates.map((candidate) => ({
    id: candidate.id,
    urlPath: candidate.urlPath,
    responseStatus: candidate.response.status,
    score: candidate.bestCandidateScore,
    reasons: candidate.bestCandidateReasons,
  }));

  const fixturePayload = bestCandidate
    ? {
        runAt: new Date().toISOString(),
        captureMode: "read-only-attended-observer",
        operationGuess: "create_running_workout",
        endpointConfirmed: bestCandidate.endpointPattern === "/fitness/v6/athletes/{athleteId}/workouts",
        endpointPattern: bestCandidate.endpointPattern,
        method: bestCandidate.method,
        athleteId: bestCandidate.athleteId,
        bestCandidateSelection: {
          id: bestCandidate.id,
          score: bestCandidate.bestCandidateScore,
          reasons: bestCandidate.bestCandidateReasons,
          criteria:
            "Prefer exact POST /fitness/v6/athletes/{athleteId}/workouts with safe test title, workout date, workout type ids, duration fields, coach notes, and 2xx response.",
        },
        request: bestCandidate.request,
        response: bestCandidate.response,
        allCandidates: candidateSummaries,
      }
    : null;

  await writeFile(
    networkEventsPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: args.athleteId,
        athleteUrl: args.athleteUrl,
        operationGuess: "create_running_workout",
        bestCandidateId: bestCandidate?.id ?? null,
        bestCandidateCriteria:
          "Prefer exact POST /fitness/v6/athletes/{athleteId}/workouts with safe test title, workout date, workout type ids, duration fields, coach notes, and 2xx response.",
        candidates,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  let fixtureWritten = false;
  if (fixturePayload) {
    await writeFile(fixturePath, `${JSON.stringify(fixturePayload, null, 2)}\n`, "utf8");
    fixtureWritten = true;
  }

  const summaryMarkdown = buildRunSummaryMarkdown({
    athleteId: args.athleteId,
    athleteUrl: args.athleteUrl,
    runDir: runDirRelative,
    fixturePathRelative,
    candidates,
    bestCandidate,
    fixtureWritten,
  });
  await writeFile(summaryPath, `${summaryMarkdown}\n`, "utf8");

  console.log("");
  console.log("[tp-capture-create-running-workout-network] complete.");
  console.log(`- summary: ${summaryPath}`);
  console.log(`- network events: ${networkEventsPath}`);
  console.log(`- captured candidates: ${candidates.length}`);
  console.log(`- best candidate id: ${bestCandidate?.id ?? "none"}`);
  console.log(`- fixture written: ${fixtureWritten ? "yes" : "no"}`);
  if (fixtureWritten) {
    console.log(`- fixture: ${fixturePath}`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-capture-create-running-workout-network failed.");
  console.error(error);
  process.exit(1);
});
