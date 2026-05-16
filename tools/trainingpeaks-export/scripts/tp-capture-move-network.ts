import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { chromium, type Request, type Response } from "playwright";

const DEFAULT_ATHLETE_URL = "https://app.trainingpeaks.com/#calendar/athletes/3102415";
const DEFAULT_SOURCE_DATE = "2026-05-16";
const DEFAULT_TARGET_DATE = "2026-05-17";
const RESPONSE_BODY_MAX_CHARS = 40_000;
const TOP_MUTATION_CANDIDATES_LIMIT = 15;
const WAIT_AFTER_ENTER_MS = 2_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const profileDir = path.join(toolRoot, ".playwright-profile", "trainingpeaks");
const artifactsRoot = path.join(toolRoot, "action-artifacts", "network-capture");

type CliArgs = {
  athleteUrl: string;
  sourceDate: string;
  targetDate: string;
};

type CapturedRequest = {
  id: number;
  method: string;
  url: string;
  startedAt: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  durationMs: number | null;
  score: number;
  scoreReasons: string[];
  failedText?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteUrl: DEFAULT_ATHLETE_URL,
    sourceDate: DEFAULT_SOURCE_DATE,
    targetDate: DEFAULT_TARGET_DATE,
  };

  for (const arg of argv) {
    if (arg.startsWith("--athlete-url=")) {
      parsed.athleteUrl = arg.slice("--athlete-url=".length).trim() || DEFAULT_ATHLETE_URL;
      continue;
    }
    if (arg.startsWith("--source-date=")) {
      parsed.sourceDate = arg.slice("--source-date=".length).trim() || DEFAULT_SOURCE_DATE;
      continue;
    }
    if (arg.startsWith("--target-date=")) {
      parsed.targetDate = arg.slice("--target-date=".length).trim() || DEFAULT_TARGET_DATE;
    }
  }

  return parsed;
}

function timestampForFileSystem(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function runIdFromDate(date: Date): string {
  return `capture-${timestampForFileSystem(date)}`;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactByKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return false;
  }
  const sensitiveMarkers = [
    "authorization",
    "cookie",
    "setcookie",
    "token",
    "accesstoken",
    "refreshtoken",
    "session",
    "signature",
    "sig",
    "apikey",
  ];
  return sensitiveMarkers.some((marker) => normalized.includes(marker));
}

function redactUnknown(inputValue: unknown, parentKey = ""): unknown {
  if (parentKey && shouldRedactByKey(parentKey)) {
    return "[REDACTED]";
  }

  if (Array.isArray(inputValue)) {
    return inputValue.map((item) => redactUnknown(item, parentKey));
  }

  if (inputValue && typeof inputValue === "object") {
    const outputObject: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputValue)) {
      outputObject[key] = redactUnknown(value, key);
    }
    return outputObject;
  }

  if (typeof inputValue !== "string") {
    return inputValue;
  }

  // Redact known token-like substrings in free text bodies.
  let text = inputValue;
  const tokenPatterns = [
    /(authorization\s*[:=]\s*)([^\s",;]+)/gi,
    /(access_token\s*[:=]\s*)([^\s",;]+)/gi,
    /(refresh_token\s*[:=]\s*)([^\s",;]+)/gi,
    /(api[_\s-]?key\s*[:=]\s*)([^\s",;]+)/gi,
    /("?(?:token|session|signature|sig)"?\s*[:=]\s*"?)([^"\s,;]+)("?)/gi,
  ];
  for (const pattern of tokenPatterns) {
    text = text.replace(pattern, "$1[REDACTED]$3");
  }
  return text;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const outputHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    outputHeaders[name] = shouldRedactByKey(name) ? "[REDACTED]" : String(redactUnknown(value, name));
  }
  return outputHeaders;
}

function parsePossiblyJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function redactBodyString(rawText: string): unknown {
  const parsed = parsePossiblyJson(rawText);
  return redactUnknown(parsed);
}

function looksTextualResponse(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("application/json")) return true;
  if (normalized.includes("application/javascript")) return true;
  if (normalized.includes("application/xml")) return true;
  if (normalized.includes("application/x-www-form-urlencoded")) return true;
  if (normalized.includes("text/")) return true;
  return false;
}

function getDateIsoFromEpochMs(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return new Date().toISOString();
  }
  return new Date(epochMs).toISOString();
}

function scoreMutationCandidate(input: {
  method: string;
  url: string;
  requestBody: unknown;
  sourceDate: string;
  targetDate: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const method = input.method.toUpperCase();
  const urlLower = input.url.toLowerCase();
  const bodyText = JSON.stringify(input.requestBody ?? "").toLowerCase();

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    score += 5;
    reasons.push(`method:${method}`);
  }
  if (/(workout|calendar|event|plan|schedule|move|update)/.test(urlLower)) {
    score += 4;
    reasons.push("url:workout/calendar/event/plan/schedule/move/update");
  }
  if (/(workout.?id|event.?id|athlete.?id)/.test(bodyText)) {
    score += 3;
    reasons.push("body:workoutId/eventId/athleteId");
  }
  if (input.sourceDate && bodyText.includes(input.sourceDate.toLowerCase())) {
    score += 3;
    reasons.push(`body:sourceDate:${input.sourceDate}`);
  }
  if (input.targetDate && bodyText.includes(input.targetDate.toLowerCase())) {
    score += 3;
    reasons.push(`body:targetDate:${input.targetDate}`);
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

async function buildCapturedRequest(inputArgs: {
  id: number;
  request: Request;
  response: Response | null;
  sourceDate: string;
  targetDate: string;
  failedText?: string;
}): Promise<CapturedRequest> {
  const request = inputArgs.request;
  const response = inputArgs.response;
  const timing = request.timing();
  const startedAt = getDateIsoFromEpochMs(timing.startTime);

  const requestHeaders = redactHeaders(request.headers());
  const rawRequestBody = request.postData();
  const requestBody = rawRequestBody ? redactBodyString(rawRequestBody) : null;

  let responseStatus: number | null = null;
  let responseHeaders: Record<string, string> = {};
  let responseBody: unknown = null;
  if (response) {
    responseStatus = response.status();
    responseHeaders = redactHeaders(response.headers());

    const contentType = response.headers()["content-type"] ?? "";
    if (looksTextualResponse(contentType)) {
      try {
        const bodyText = await response.text();
        if (bodyText.length <= RESPONSE_BODY_MAX_CHARS) {
          responseBody = redactBodyString(bodyText);
        } else {
          responseBody = `[omitted: response body too large (${bodyText.length} chars)]`;
        }
      } catch (error) {
        responseBody = `[unavailable: ${(error as Error).message}]`;
      }
    } else {
      responseBody = `[omitted: non-text response content-type "${contentType || "unknown"}"]`;
    }
  }

  const durationMs =
    Number.isFinite(timing.responseEnd) && Number.isFinite(timing.startTime) && timing.responseEnd >= timing.startTime
      ? Math.round(timing.responseEnd - timing.startTime)
      : null;

  const scored = scoreMutationCandidate({
    method: request.method(),
    url: request.url(),
    requestBody,
    sourceDate: inputArgs.sourceDate,
    targetDate: inputArgs.targetDate,
  });

  return {
    id: inputArgs.id,
    method: request.method(),
    url: request.url(),
    startedAt,
    requestHeaders,
    requestBody,
    responseStatus,
    responseHeaders,
    responseBody,
    durationMs,
    score: scored.score,
    scoreReasons: scored.reasons,
    failedText: inputArgs.failedText,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const runId = runIdFromDate(now);
  const artifactDir = path.join(artifactsRoot, timestampForFileSystem(now));
  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const beforePath = path.join(artifactDir, "before.png");
  const afterPath = path.join(artifactDir, "after.png");
  const harPath = path.join(artifactDir, "raw.har");
  const requestsPath = path.join(artifactDir, "requests.redacted.json");
  const summaryPath = path.join(artifactDir, "summary.redacted.json");

  console.log(`Run ID: ${runId}`);
  console.log(`Using persistent profile: ${profileDir}`);
  console.log(`Artifact directory: ${artifactDir}`);
  console.log(`Athlete URL: ${args.athleteUrl}`);
  console.log(`Source date: ${args.sourceDate}`);
  console.log(`Target date: ${args.targetDate}`);
  console.log("");
  console.log("Capture mode is SAFE and MANUAL ONLY:");
  console.log("- This script does not click, drag, save, or replay requests.");
  console.log("- It only captures network/HAR while you perform one manual move.");
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    recordHar: {
      path: harPath,
      mode: "full",
      content: "embed",
    },
  });

  const capturedRequests: CapturedRequest[] = [];
  const requestIds = new Map<Request, number>();
  let nextRequestId = 1;

  const assignId = (request: Request): number => {
    const existing = requestIds.get(request);
    if (typeof existing === "number") {
      return existing;
    }
    const id = nextRequestId++;
    requestIds.set(request, id);
    return id;
  };

  context.on("request", (request) => {
    assignId(request);
  });

  context.on("requestfinished", async (request) => {
    const id = assignId(request);
    const response = await request.response();
    const captured = await buildCapturedRequest({
      id,
      request,
      response,
      sourceDate: args.sourceDate,
      targetDate: args.targetDate,
    });
    capturedRequests.push(captured);
  });

  context.on("requestfailed", async (request) => {
    const id = assignId(request);
    const captured = await buildCapturedRequest({
      id,
      request,
      response: null,
      sourceDate: args.sourceDate,
      targetDate: args.targetDate,
      failedText: request.failure()?.errorText ?? "request failed",
    });
    capturedRequests.push(captured);
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.bringToFront();
    await page.screenshot({ path: beforePath, fullPage: true });

    console.log("Manual instructions:");
    console.log(`1) In TrainingPeaks, open one workout on source date ${args.sourceDate}.`);
    console.log(`2) Manually move it to target date ${args.targetDate}.`);
    console.log("3) Click Save / Save & Close manually if TrainingPeaks requires it.");
    console.log("4) Do exactly one move only.");
    console.log("5) Return to this terminal and press Enter.");
    console.log("");

    await waitForEnter("Press Enter after you finish the single manual move.");
    await page.waitForTimeout(WAIT_AFTER_ENTER_MS);
    await page.screenshot({ path: afterPath, fullPage: true });
  } finally {
    await context.close().catch(() => {});
  }

  capturedRequests.sort((a, b) => a.id - b.id);

  const mutationCandidates = [...capturedRequests]
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, TOP_MUTATION_CANDIDATES_LIMIT)
    .map((entry) => ({
      id: entry.id,
      score: entry.score,
      scoreReasons: entry.scoreReasons,
      method: entry.method,
      url: entry.url,
      startedAt: entry.startedAt,
      responseStatus: entry.responseStatus,
      durationMs: entry.durationMs,
    }));

  const summary = {
    runId,
    athleteUrl: args.athleteUrl,
    sourceDate: args.sourceDate,
    targetDate: args.targetDate,
    artifactDir,
    files: {
      before: beforePath,
      after: afterPath,
      rawHar: harPath,
      requestsRedacted: requestsPath,
      summaryRedacted: summaryPath,
    },
    totalRequests: capturedRequests.length,
    mutationCandidatesTop: mutationCandidates,
  };

  await writeFile(requestsPath, `${JSON.stringify(capturedRequests, null, 2)}\n`, "utf8");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("Capture complete.");
  console.log(`Saved before screenshot: ${beforePath}`);
  console.log(`Saved after screenshot: ${afterPath}`);
  console.log(`Saved HAR (local sensitive artifact): ${harPath}`);
  console.log(`Saved redacted requests: ${requestsPath}`);
  console.log(`Saved redacted summary: ${summaryPath}`);
  console.log(`Total requests captured: ${capturedRequests.length}`);
  console.log(`Top mutation candidates listed: ${mutationCandidates.length}`);
  console.log("HAR contents are not printed.");
}

main().catch((error: unknown) => {
  console.error("tp-capture-move-network failed.");
  console.error(error);
  process.exit(1);
});
