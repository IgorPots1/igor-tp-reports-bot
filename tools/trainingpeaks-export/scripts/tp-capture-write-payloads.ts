import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { chromium, type Request, type Response } from "playwright";

/**
 * PASSIVE network capture for two write payloads we can only learn by watching the
 * real UI request: (1) zone/threshold write, (2) event/race create. Igor performs
 * every mutation BY HAND on his own account; this script never clicks, saves, or
 * replays anything — it only observes traffic to the two TP API hosts and writes a
 * TOKEN-REDACTED transcript.
 *
 * Safety:
 *  - Uses a SEPARATE fresh profile (.playwright-profile/write-capture), NOT the
 *    persistent `trainingpeaks` profile that tp-actions-loop uses, and NOT
 *    ~/.tp-reports-bot. A different user-data-dir is a different Chromium instance,
 *    so there is no lock conflict with the running loop. Igor logs in manually here.
 *  - No HAR recording (a HAR embeds raw cookies/bearer). Only the redacted request
 *    transcript is written. Authorization/Cookie/token/session/etc. values are
 *    replaced with [REDACTED] in headers AND bodies before anything is written.
 *  - Captures only the two API hosts (tpapi.trainingpeaks.com, api.peakswaresb.com);
 *    static assets are ignored.
 *
 * Usage: npm run tp-capture-write-payloads -- [--athlete-url=...]
 */

const DEFAULT_ATHLETE_URL = "https://app.trainingpeaks.com/#calendar/athletes/3102415";
const API_HOSTS = ["tpapi.trainingpeaks.com", "api.peakswaresb.com"];
const RESPONSE_BODY_MAX_CHARS = 60_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
// SEPARATE profile — deliberately NOT ".playwright-profile/trainingpeaks".
const profileDir = path.join(toolRoot, ".playwright-profile", "write-capture");
const artifactsRoot = path.join(toolRoot, "action-artifacts", "write-payloads-capture");

type Phase = "login" | "zone-write" | "event-create";

type CapturedRequest = {
  id: number;
  phase: Phase;
  method: string;
  url: string;
  host: string;
  startedAt: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  failedText?: string;
};

// ── redaction (same markers as tp-capture-move-network.ts) ────────────────────

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function shouldRedactByKey(key: string): boolean {
  const n = normalizeKey(key);
  if (!n) return false;
  const markers = [
    "authorization", "cookie", "setcookie", "token", "accesstoken", "refreshtoken",
    "session", "signature", "sig", "apikey", "icalendar", "ical", "email", "secret", "password",
  ];
  return markers.some((m) => n.includes(m));
}
function redactUnknown(value: unknown, parentKey = ""): unknown {
  if (parentKey && shouldRedactByKey(parentKey)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((v) => redactUnknown(v, parentKey));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactUnknown(v, k);
    return out;
  }
  if (typeof value !== "string") return value;
  let text = value;
  const patterns = [
    /(authorization\s*[:=]\s*)([^\s",;]+)/gi,
    /(access_token\s*[:=]\s*)([^\s",;]+)/gi,
    /(refresh_token\s*[:=]\s*)([^\s",;]+)/gi,
    /(api[_\s-]?key\s*[:=]\s*)([^\s",;]+)/gi,
    /("?(?:token|session|signature|sig|bearer)"?\s*[:=]\s*"?)([^"\s,;]+)("?)/gi,
  ];
  for (const p of patterns) text = text.replace(p, "$1[REDACTED]$3");
  return text;
}
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = shouldRedactByKey(name) ? "[REDACTED]" : String(redactUnknown(value, name));
  }
  return out;
}
function parsePossiblyJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
function redactBodyString(raw: string): unknown {
  return redactUnknown(parsePossiblyJson(raw));
}
function looksTextual(contentType: string): boolean {
  const n = contentType.toLowerCase();
  return ["application/json", "application/javascript", "application/xml", "application/x-www-form-urlencoded", "text/"].some((m) => n.includes(m));
}
function hostOf(url: string): string { try { return new URL(url).host; } catch { return ""; } }

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try { await rl.question(`${message}\n`); } finally { rl.close(); }
}

async function buildCaptured(id: number, phase: Phase, request: Request, response: Response | null, failedText?: string): Promise<CapturedRequest> {
  const requestHeaders = redactHeaders(request.headers());
  const rawBody = request.postData();
  const requestBody = rawBody ? redactBodyString(rawBody) : null;

  let responseStatus: number | null = null;
  let responseHeaders: Record<string, string> = {};
  let responseBody: unknown = null;
  if (response) {
    responseStatus = response.status();
    responseHeaders = redactHeaders(response.headers());
    const contentType = response.headers()["content-type"] ?? "";
    if (looksTextual(contentType)) {
      try {
        const text = await response.text();
        responseBody = text.length <= RESPONSE_BODY_MAX_CHARS ? redactBodyString(text) : `[omitted: ${text.length} chars]`;
      } catch (error) {
        responseBody = `[unavailable: ${(error as Error).message}]`;
      }
    } else {
      responseBody = `[omitted: non-text content-type "${contentType || "unknown"}"]`;
    }
  }

  return {
    id, phase,
    method: request.method(),
    url: request.url(),
    host: hostOf(request.url()),
    startedAt: new Date(request.timing().startTime > 0 ? request.timing().startTime : Date.now()).toISOString(),
    requestHeaders, requestBody, responseStatus, responseHeaders, responseBody, failedText,
  };
}

function isMutation(r: CapturedRequest): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(r.method.toUpperCase());
}

async function main(): Promise<void> {
  const athleteUrl = process.argv.slice(2).find((a) => a.startsWith("--athlete-url="))?.slice("--athlete-url=".length).trim() || DEFAULT_ATHLETE_URL;
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const artifactDir = path.join(artifactsRoot, stamp);
  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  const requestsPath = path.join(artifactDir, "requests.redacted.json");
  const summaryPath = path.join(artifactDir, "summary.redacted.json");

  console.log("tp-capture-write-payloads — PASSIVE observation only. This script never");
  console.log("clicks, saves, or replays a request. You perform every change by hand.\n");
  console.log(`Separate fresh profile: ${profileDir}`);
  console.log(`(NOT the tp-actions-loop profile; no lock conflict.)`);
  console.log(`Artifacts (redacted, gitignored): ${artifactDir}\n`);

  const context = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: null });

  let phase: Phase = "login";
  const captured: CapturedRequest[] = [];
  const ids = new Map<Request, number>();
  let nextId = 1;
  const idOf = (r: Request): number => {
    const e = ids.get(r);
    if (typeof e === "number") return e;
    const id = nextId++; ids.set(r, id); return id;
  };

  const record = async (request: Request, response: Response | null, failedText?: string) => {
    if (!API_HOSTS.includes(hostOf(request.url()))) return; // only the two API hosts
    captured.push(await buildCaptured(idOf(request), phase, request, response, failedText));
  };
  context.on("requestfinished", async (r) => { await record(r, await r.response()); });
  context.on("requestfailed", async (r) => { await record(r, null, r.failure()?.errorText ?? "failed"); });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.bringToFront();

    console.log("STEP A — log in to TrainingPeaks in the opened browser if prompted.");
    await waitForEnter("Press Enter once you are logged in and on the athlete calendar.");

    phase = "zone-write";
    console.log("\nSTEP B (zone/threshold) — in the UI, change ONE threshold (e.g. threshold");
    console.log("pace) for athlete 3102415 and Save. Do exactly one change.");
    await waitForEnter("Press Enter after the threshold change is saved.");

    phase = "event-create";
    console.log("\nSTEP C (event/race) — add ONE race/event to the calendar and Save.");
    await waitForEnter("Press Enter after the event is saved.");
  } finally {
    await context.close().catch(() => {});
  }

  captured.sort((a, b) => a.id - b.id);
  const mutationsByPhase = (p: Phase) => captured.filter((r) => r.phase === p && isMutation(r)).map((r) => ({ id: r.id, method: r.method, url: r.url, status: r.responseStatus }));

  const summary = {
    athleteUrl,
    totalApiRequests: captured.length,
    zoneWriteMutations: mutationsByPhase("zone-write"),
    eventCreateMutations: mutationsByPhase("event-create"),
    note: "Full redacted request/response bodies are in requests.redacted.json. Tokens/cookies are [REDACTED].",
  };
  await writeFile(requestsPath, `${JSON.stringify(captured, null, 2)}\n`, "utf8");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log("\nCapture complete (redacted).");
  console.log(`Requests: ${requestsPath}`);
  console.log(`Summary:  ${summaryPath}`);
  console.log(`API requests captured: ${captured.length}`);
  console.log(`Zone-write mutations: ${summary.zoneWriteMutations.length}; Event-create mutations: ${summary.eventCreateMutations.length}`);
  console.log("No token/cookie values are written or printed.");
}

main().catch((error: unknown) => {
  console.error("tp-capture-write-payloads failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
