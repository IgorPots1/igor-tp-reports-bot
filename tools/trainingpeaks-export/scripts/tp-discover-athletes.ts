import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, type Page, type Request, type Response } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { redactUnknown } from "./lib/trainingpeaks-api-move.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_URL = "https://app.trainingpeaks.com/";
const ARTIFACTS_ROOT = path.join(toolRoot, "debug", "athletes-api-discovery");
const RESPONSE_BODY_MAX_CHARS = 120_000;
const MANUAL_CAPTURE_MS = 90_000;
const INITIAL_LOAD_MS = 8_000;
const DOM_POLL_INTERVAL_MS = 5_000;

const ATHLETE_ID_KEYS = ["athleteid", "athlete_id", "personid", "person_id"] as const;
const NAME_KEYS = ["firstname", "first_name", "lastname", "last_name", "fullname", "full_name", "name", "displayname", "display_name"] as const;
const ATHLETE_SIGNAL_KEYS = [...ATHLETE_ID_KEYS, ...NAME_KEYS] as const;

const CANDIDATE_URL_PATTERN = /(athlete|athletes|client|clients|roster|coach|coached|people|person)/i;
const USERS_V3_USER_URL_PATTERN = /\/users\/v3\/user(?:\?|$|\/)/i;
const USERS_V3_ROSTER_ITEM_PATH = "user.athletes";

type CliArgs = {
  headless: boolean;
};

type NormalizedAthlete = {
  athleteId: number;
  displayName: string;
  trainingpeaksAthleteUrl: string;
  source: "api" | "dom";
};

type RosterAthlete = {
  athleteId: number;
  displayName: string;
  trainingpeaksAthleteUrl: string;
  source: "users_v3_user";
};

type UsersV3CapturedBody = {
  responseId: number;
  url: string;
  parsed: unknown;
};

type CapturedGetResponse = {
  id: number;
  method: string;
  url: string;
  endpointPattern: string;
  status: number | null;
  ok: boolean | null;
  athleteLikeFieldHits: string[];
  athleteLikeScore: number;
  extractedAthleteCount: number;
  isAthleteRosterCandidate: boolean;
  responseBodyPreview: unknown;
  parseError: string | null;
  failedText: string | null;
};

type EndpointCandidate = {
  id: number;
  url: string;
  endpointPattern: string;
  status: number | null;
  athleteLikeFieldHits: string[];
  athleteLikeScore: number;
  extractedAthleteCount: number;
  sampleAthletes: NormalizedAthlete[];
};

type RawCandidate = {
  sourceResponseId: number;
  endpointPattern: string;
  itemPath: string;
  itemCount: number;
  sampleItems: unknown[];
};

function printHelp(): void {
  console.log(`Usage: npm run tp-discover-athletes -- [options]

Read-only local discovery for coached athlete roster endpoints.

Options:
  --headed     Run Chromium with UI (default)
  --headless   Run Chromium headless
  --help       Show this help

Safety:
  - GET capture only from tpapi.trainingpeaks.com
  - No Supabase writes, no TrainingPeaks mutations
`);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { headless: false };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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

  return parsed;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildAthleteUrl(athleteId: number): string {
  return `https://app.trainingpeaks.com/#calendar/athletes/${athleteId}`;
}

function buildEndpointPattern(inputUrl: string): string {
  return inputUrl
    .replace(/\/athletes\/\d+/gi, "/athletes/{athleteId}")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "{date}")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi, "{dateTime}")
    .replace(/\b\d{10,}\b/g, "{id}");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksTextualResponse(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("application/json") ||
    normalized.includes("application/javascript") ||
    normalized.includes("application/xml") ||
    normalized.includes("text/")
  );
}

function collectAthleteLikeFieldHits(input: unknown): string[] {
  const wanted = new Set(ATHLETE_SIGNAL_KEYS);
  const hits = new Set<string>();
  const seen = new Set<unknown>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const normalized = normalizeKey(key);
      if (wanted.has(normalized)) {
        hits.add(key);
      }
      visit(value);
    }
  }

  visit(input);
  return [...hits];
}

function scoreAthleteFieldHits(fieldHits: string[]): number {
  const normalized = new Set(fieldHits.map(normalizeKey));
  let score = 0;
  if (normalized.has("athleteid")) score += 8;
  if (normalized.has("personid")) score += 7;
  if (normalized.has("firstname")) score += 4;
  if (normalized.has("lastname")) score += 4;
  if (normalized.has("fullname")) score += 5;
  if (normalized.has("name")) score += 2;
  return score;
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickAthleteId(record: Record<string, unknown>): number | null {
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeKey(key);
    if (ATHLETE_ID_KEYS.includes(normalized as (typeof ATHLETE_ID_KEYS)[number])) {
      const parsed = readPositiveInt(value);
      if (parsed) return parsed;
    }
  }
  return null;
}

function pickDisplayName(record: Record<string, unknown>): string | null {
  const firstName = readString(record.firstName ?? record.first_name ?? record.FirstName);
  const lastName = readString(record.lastName ?? record.last_name ?? record.LastName);
  if (firstName && lastName) return `${firstName} ${lastName}`.trim();
  const fullName = readString(record.fullName ?? record.full_name ?? record.FullName);
  if (fullName) return fullName;
  const name = readString(record.name ?? record.Name ?? record.displayName ?? record.display_name);
  if (name) return name;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return null;
}

function isUsersV3UserUrl(url: string): boolean {
  return USERS_V3_USER_URL_PATTERN.test(url);
}

function pickRosterDisplayName(record: Record<string, unknown>): { displayName: string; usedFallback: boolean } {
  const fullName = readString(record.fullName ?? record.full_name ?? record.FullName);
  if (fullName) {
    return { displayName: fullName, usedFallback: false };
  }

  const firstName = readString(record.firstName ?? record.first_name ?? record.FirstName);
  const lastName = readString(record.lastName ?? record.last_name ?? record.LastName);
  if (firstName && lastName) {
    return { displayName: `${firstName} ${lastName}`.trim(), usedFallback: false };
  }
  if (firstName) {
    return { displayName: firstName, usedFallback: false };
  }
  if (lastName) {
    return { displayName: lastName, usedFallback: false };
  }

  return { displayName: "", usedFallback: true };
}

function extractUsersV3Roster(body: unknown): {
  athletes: RosterAthlete[];
  fallbackNameCount: number;
  itemPath: string | null;
} {
  const user = isRecord(body) && isRecord(body.user) ? body.user : null;
  const athletesArray = user && Array.isArray(user.athletes) ? user.athletes : null;
  if (!athletesArray) {
    return { athletes: [], fallbackNameCount: 0, itemPath: null };
  }

  const byId = new Map<number, RosterAthlete>();
  let fallbackNameCount = 0;

  for (const item of athletesArray) {
    if (!isRecord(item)) continue;
    const athleteId = readPositiveInt(item.athleteId);
    if (!athleteId) continue;

    const { displayName, usedFallback } = pickRosterDisplayName(item);
    if (usedFallback) {
      fallbackNameCount += 1;
    }

    byId.set(athleteId, {
      athleteId,
      displayName: usedFallback ? `Athlete ${athleteId}` : displayName,
      trainingpeaksAthleteUrl: buildAthleteUrl(athleteId),
      source: "users_v3_user",
    });
  }

  const athletes = [...byId.values()].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.athleteId - b.athleteId,
  );

  return {
    athletes,
    fallbackNameCount,
    itemPath: USERS_V3_ROSTER_ITEM_PATH,
  };
}

function selectBestUsersV3Roster(
  bodies: UsersV3CapturedBody[],
): {
  athletes: RosterAthlete[];
  fallbackNameCount: number;
  itemPath: string | null;
  sourceUrl: string | null;
  sourceResponseId: number | null;
} {
  let best = {
    athletes: [] as RosterAthlete[],
    fallbackNameCount: 0,
    itemPath: null as string | null,
    sourceUrl: null as string | null,
    sourceResponseId: null as number | null,
  };

  for (const body of bodies) {
    const extracted = extractUsersV3Roster(body.parsed);
    if (extracted.athletes.length > best.athletes.length) {
      best = {
        athletes: extracted.athletes,
        fallbackNameCount: extracted.fallbackNameCount,
        itemPath: extracted.itemPath,
        sourceUrl: body.url,
        sourceResponseId: body.responseId,
      };
    }
  }

  return best;
}

function buildRosterWarnings(input: {
  rosterCount: number;
  fallbackNameCount: number;
  usersV3ResponseCount: number;
}): string[] {
  const warnings: string[] = [];
  if (input.usersV3ResponseCount === 0) {
    warnings.push("No GET /users/v3/user response captured; roster file will be empty.");
  }
  if (input.rosterCount === 0 && input.usersV3ResponseCount > 0) {
    warnings.push("users/v3/user was captured but user.athletes could not be parsed.");
  }
  if (input.fallbackNameCount > 0) {
    warnings.push(
      `${input.fallbackNameCount} roster row(s) used displayName fallback "Athlete {id}" (missing fullName/firstName/lastName).`,
    );
  }
  return warnings;
}

function isAthleteLikeRecord(record: Record<string, unknown>): boolean {
  const athleteId = pickAthleteId(record);
  if (!athleteId) return false;
  const displayName = pickDisplayName(record);
  if (displayName) return true;
  return collectAthleteLikeFieldHits(record).length >= 2;
}

function buildSample(input: unknown, depth = 0): unknown {
  if (depth >= 4) return "[truncated-depth]";
  if (Array.isArray(input)) {
    return input.slice(0, 8).map((item) => buildSample(item, depth + 1));
  }
  if (!isRecord(input)) {
    if (typeof input === "string" && input.length > 500) {
      return `${input.slice(0, 500)}...[truncated]`;
    }
    return input;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 40)) {
    out[key] = buildSample(value, depth + 1);
  }
  return out;
}

function extractAthletesFromNode(
  node: unknown,
  pathPrefix: string,
  out: Array<{ itemPath: string; athletes: NormalizedAthlete[]; sampleItems: unknown[] }>,
): void {
  if (!node) return;

  if (Array.isArray(node)) {
    const athletes: NormalizedAthlete[] = [];
    const sampleItems: unknown[] = [];
    for (const item of node) {
      if (!isRecord(item) || !isAthleteLikeRecord(item)) continue;
      const athleteId = pickAthleteId(item);
      if (!athleteId) continue;
      const displayName = pickDisplayName(item) ?? `Athlete ${athleteId}`;
      athletes.push({
        athleteId,
        displayName,
        trainingpeaksAthleteUrl: buildAthleteUrl(athleteId),
        source: "api",
      });
      if (sampleItems.length < 5) {
        sampleItems.push(buildSample(item));
      }
    }
    if (athletes.length >= 2) {
      out.push({ itemPath: pathPrefix || "root array", athletes, sampleItems });
    }
    node.forEach((item, index) => extractAthletesFromNode(item, `${pathPrefix}[${index}]`, out));
    return;
  }

  if (!isRecord(node)) return;

  for (const [key, value] of Object.entries(node)) {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    extractAthletesFromNode(value, nextPath, out);
  }
}

function extractAthletesFromJson(body: unknown): {
  athletes: NormalizedAthlete[];
  groups: Array<{ itemPath: string; athletes: NormalizedAthlete[]; sampleItems: unknown[] }>;
} {
  const groups: Array<{ itemPath: string; athletes: NormalizedAthlete[]; sampleItems: unknown[] }> = [];
  extractAthletesFromNode(body, "", groups);

  const byId = new Map<number, NormalizedAthlete>();
  for (const group of groups) {
    for (const athlete of group.athletes) {
      if (!byId.has(athlete.athleteId)) {
        byId.set(athlete.athleteId, athlete);
      }
    }
  }

  return { athletes: [...byId.values()], groups };
}

function isCandidateUrl(url: string): boolean {
  if (!url.startsWith(`${TP_API_HOST}/`)) return false;
  return CANDIDATE_URL_PATTERN.test(url);
}

function analyzeResponseBody(parsed: unknown): {
  responseBodyPreview: unknown;
  parseError: string | null;
  athleteLikeFieldHits: string[];
  extractedAthleteCount: number;
} {
  const redacted = redactUnknown(parsed);
  return {
    responseBodyPreview: buildSample(redacted),
    parseError: null,
    athleteLikeFieldHits: collectAthleteLikeFieldHits(redacted),
    extractedAthleteCount: extractAthletesFromJson(redacted).athletes.length,
  };
}

async function parseGetResponseBody(response: Response): Promise<{
  parsed: unknown;
  responseBodyPreview: unknown;
  parseError: string | null;
  athleteLikeFieldHits: string[];
  extractedAthleteCount: number;
}> {
  const contentType = String(response.headers()["content-type"] ?? "");
  if (!looksTextualResponse(contentType)) {
    return {
      parsed: null,
      responseBodyPreview: `[omitted: non-text content-type ${contentType || "unknown"}]`,
      parseError: null,
      athleteLikeFieldHits: [],
      extractedAthleteCount: 0,
    };
  }

  try {
    const bodyText = await response.text();
    if (bodyText.length > RESPONSE_BODY_MAX_CHARS) {
      return {
        parsed: null,
        responseBodyPreview: `[omitted: large textual body ${bodyText.length} chars]`,
        parseError: null,
        athleteLikeFieldHits: [],
        extractedAthleteCount: 0,
      };
    }

    let parsed: unknown = bodyText;
    let parseError: string | null = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch (jsonErr) {
      parseError = `JSON parse skipped: ${(jsonErr as Error).message}`;
      return {
        parsed: null,
        responseBodyPreview: bodyText.slice(0, 500),
        parseError,
        athleteLikeFieldHits: [],
        extractedAthleteCount: 0,
      };
    }

    const analysis = analyzeResponseBody(parsed);
    return { parsed, ...analysis };
  } catch (error) {
    return {
      parsed: null,
      responseBodyPreview: `[unavailable: ${(error as Error).message}]`,
      parseError: `response.text() failed: ${(error as Error).message}`,
      athleteLikeFieldHits: [],
      extractedAthleteCount: 0,
    };
  }
}

function buildCapturedGetResponse(input: {
  id: number;
  request: Request;
  response: Response | null;
  analysis?: {
    responseBodyPreview: unknown;
    parseError: string | null;
    athleteLikeFieldHits: string[];
    extractedAthleteCount: number;
  };
  failedText?: string;
}): CapturedGetResponse {
  const { id, request, response, analysis } = input;
  const responseBodyPreview = analysis?.responseBodyPreview ?? null;
  const parseError = analysis?.parseError ?? null;
  const athleteLikeFieldHits = analysis?.athleteLikeFieldHits ?? [];
  const extractedAthleteCount = analysis?.extractedAthleteCount ?? 0;

  const athleteLikeScore = scoreAthleteFieldHits(athleteLikeFieldHits) + Math.min(extractedAthleteCount, 200);

  return {
    id,
    method: request.method(),
    url: request.url(),
    endpointPattern: buildEndpointPattern(request.url()),
    status: response?.status() ?? null,
    ok: response?.ok() ?? null,
    athleteLikeFieldHits,
    athleteLikeScore,
    extractedAthleteCount,
    isAthleteRosterCandidate: extractedAthleteCount >= 2 || (extractedAthleteCount >= 1 && athleteLikeScore >= 10),
    responseBodyPreview,
    parseError,
    failedText: input.failedText ?? null,
  };
}

async function tryOpenAthletePicker(page: Page): Promise<string[]> {
  const notes: string[] = [];
  const selectors = [
    '[data-testid*="athlete" i]',
    '[data-testid*="client" i]',
    '[aria-label*="athlete" i]',
    '[aria-label*="client" i]',
    'button:has-text("Athletes")',
    'button:has-text("Clients")',
    'button:has-text("Switch Athlete")',
    'button:has-text("Switch Client")',
    '[class*="athlete-switch" i]',
    '[class*="client-switch" i]',
    '[class*="athlete-picker" i]',
    '[class*="client-picker" i]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) === 0 || !(await locator.isVisible())) continue;
      await locator.click({ timeout: 3_000 });
      notes.push(`Clicked selector: ${selector}`);
      await page.waitForTimeout(1_500);
      return notes;
    } catch {
      continue;
    }
  }

  notes.push("Could not auto-open athlete/client picker; manual navigation required.");
  return notes;
}

async function collectDomAthletes(page: Page): Promise<NormalizedAthlete[]> {
  const matches = await page.evaluate(`
    (() => {
      const out = new Map();
      const remember = (athleteId, href, displayName) => {
        if (!Number.isInteger(athleteId) || athleteId <= 0) return;
        const existing = out.get(athleteId);
        const name = String(displayName || "").replace(/\\s+/g, " ").trim();
        if (!existing) {
          out.set(athleteId, {
            athleteId,
            displayName: name || ("Athlete " + athleteId),
            href,
          });
          return;
        }
        if (name && (existing.displayName.startsWith("Athlete ") || name.length > existing.displayName.length)) {
          out.set(athleteId, { athleteId, displayName: name, href });
        }
      };

      const scanHref = (href, text) => {
        const hashMatch = href.match(/#(?:calendar\\/)?athletes\\/(\\d+)/i);
        const pathMatch = href.match(/\\/athletes\\/(\\d+)/i);
        const idText = (hashMatch && hashMatch[1]) || (pathMatch && pathMatch[1]);
        if (!idText) return;
        remember(Number(idText), href, text);
      };

      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href") || "";
        const text = (anchor.textContent || "").replace(/\\s+/g, " ").trim();
        scanHref(href, text);
      }

      for (const element of document.querySelectorAll("[href], [data-href], [data-url]")) {
        const href =
          element.getAttribute("href") ||
          element.getAttribute("data-href") ||
          element.getAttribute("data-url") ||
          "";
        if (!href) continue;
        const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
        scanHref(href, text);
      }

      const locationHash = window.location.hash || "";
      const hashMatch = locationHash.match(/#(?:calendar\\/)?athletes\\/(\\d+)/i);
      if (hashMatch) {
        remember(Number(hashMatch[1]), locationHash, "");
      }

      return Array.from(out.values());
    })()
  `) as Array<{ athleteId: number; displayName: string; href: string }>;

  return matches.map((entry) => ({
    athleteId: entry.athleteId,
    displayName: entry.displayName,
    trainingpeaksAthleteUrl: buildAthleteUrl(entry.athleteId),
    source: "dom" as const,
  }));
}

function mergeAthletes(apiAthletes: NormalizedAthlete[], domAthletes: NormalizedAthlete[]): NormalizedAthlete[] {
  const byId = new Map<number, NormalizedAthlete>();
  for (const athlete of [...apiAthletes, ...domAthletes]) {
    const existing = byId.get(athlete.athleteId);
    if (!existing) {
      byId.set(athlete.athleteId, athlete);
      continue;
    }
    if (existing.source === "dom" && athlete.source === "api") {
      byId.set(athlete.athleteId, athlete);
      continue;
    }
    if (existing.displayName.startsWith("Athlete ") && !athlete.displayName.startsWith("Athlete ")) {
      byId.set(athlete.athleteId, { ...existing, displayName: athlete.displayName });
    }
  }
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.athleteId - b.athleteId);
}

function buildWarnings(input: {
  apiCount: number;
  domCount: number;
  total: number;
  rosterCandidates: EndpointCandidate[];
  autoOpenNotes: string[];
}): string[] {
  const warnings: string[] = [];
  if (input.total === 0) {
    warnings.push("No athletes discovered. Open the athlete/client list in the browser and rerun.");
  } else if (input.total < 10) {
    warnings.push(`Only ${input.total} athletes found; roster may be incomplete.`);
  }
  if (input.apiCount === 0 && input.domCount > 0) {
    warnings.push("Athletes were found via DOM only; no roster-sized API response was confirmed.");
  }
  if (input.domCount === 0 && input.apiCount > 0) {
    warnings.push("Athletes were found via API only; DOM links were not detected.");
  }
  if (input.rosterCandidates.length === 0) {
    warnings.push("No GET endpoint returned 2+ athlete-like records.");
  } else if (input.rosterCandidates.length > 1) {
    warnings.push("Multiple roster-like API endpoints were captured; review candidate-endpoints.json.");
  }
  if (input.autoOpenNotes.some((note) => note.includes("manual"))) {
    warnings.push("Athlete/client picker was not auto-opened.");
  }
  return warnings;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const artifactDir = path.join(ARTIFACTS_ROOT, timestampForPath(new Date()));
  const discoverySummaryPath = path.join(artifactDir, "discovery-summary.md");
  const candidateEndpointsPath = path.join(artifactDir, "candidate-endpoints.json");
  const athletesNormalizedPath = path.join(artifactDir, "athletes.normalized.json");
  const athletesUsersV3NormalizedPath = path.join(artifactDir, "athletes.users-v3.normalized.json");
  const rawCandidatesPath = path.join(artifactDir, "raw-candidates.redacted.json");

  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  console.log("[tp-discover-athletes] Read-only coached athletes discovery started.");
  console.log(`[tp-discover-athletes] profile=${profileDir}`);
  console.log(`[tp-discover-athletes] artifactDir=${artifactDir}`);
  console.log(`[tp-discover-athletes] headless=${args.headless ? "yes" : "no"}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  const captured: CapturedGetResponse[] = [];
  const rawCandidates: RawCandidate[] = [];
  const apiAthletes: NormalizedAthlete[] = [];
  const athletesByResponseId = new Map<number, NormalizedAthlete[]>();
  const usersV3Bodies: UsersV3CapturedBody[] = [];
  const domSnapshots: NormalizedAthlete[][] = [];
  const ids = new Map<Request, number>();
  let nextId = 1;
  let autoOpenNotes: string[] = [];

  const assignId = (request: Request): number => {
    const existing = ids.get(request);
    if (existing) return existing;
    const created = nextId++;
    ids.set(request, created);
    return created;
  };

  context.on("request", (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) return;
    assignId(request);
  });

  context.on("requestfinished", async (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) return;
    if (request.method().toUpperCase() !== "GET") return;
    const response = await request.response();
    const analysis = response ? await parseGetResponseBody(response) : undefined;
    const entry = buildCapturedGetResponse({
      id: assignId(request),
      request,
      response,
      analysis: analysis
        ? {
            responseBodyPreview: analysis.responseBodyPreview,
            parseError: analysis.parseError,
            athleteLikeFieldHits: analysis.athleteLikeFieldHits,
            extractedAthleteCount: analysis.extractedAthleteCount,
          }
        : undefined,
    });
    captured.push(entry);

    if (!analysis?.parsed) return;

    if (isUsersV3UserUrl(request.url())) {
      usersV3Bodies.push({
        responseId: entry.id,
        url: request.url(),
        parsed: analysis.parsed,
      });
    }

    const extraction = extractAthletesFromJson(analysis.parsed);
    if (extraction.athletes.length > 0) {
      athletesByResponseId.set(entry.id, extraction.athletes);
    }
    if (!isCandidateUrl(request.url())) return;
    for (const group of extraction.groups) {
      rawCandidates.push({
        sourceResponseId: entry.id,
        endpointPattern: entry.endpointPattern,
        itemPath: group.itemPath,
        itemCount: group.athletes.length,
        sampleItems: group.sampleItems,
      });
    }
    for (const athlete of extraction.athletes) {
      if (!apiAthletes.some((item) => item.athleteId === athlete.athleteId)) {
        apiAthletes.push(athlete);
      }
    }
  });

  context.on("requestfailed", async (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) return;
    if (request.method().toUpperCase() !== "GET") return;
    captured.push(
      buildCapturedGetResponse({
        id: assignId(request),
        request,
        response: null,
        failedText: request.failure()?.errorText ?? "request failed",
      }),
    );
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(INITIAL_LOAD_MS);
    autoOpenNotes = await tryOpenAthletePicker(page);
    domSnapshots.push(await collectDomAthletes(page));

    console.log("");
    console.log("Open the athlete/client list in the browser window now.");
    console.log(`Capturing tpapi GET traffic and DOM athlete links for ${MANUAL_CAPTURE_MS / 1000}s...`);
    console.log("");

    const startedAt = Date.now();
    while (Date.now() - startedAt < MANUAL_CAPTURE_MS) {
      await page.waitForTimeout(DOM_POLL_INTERVAL_MS);
      domSnapshots.push(await collectDomAthletes(page));
    }
  } finally {
    await context.close().catch(() => {});
  }

  captured.sort((a, b) => a.id - b.id);

  const endpointCandidates: EndpointCandidate[] = captured
    .filter((entry) => entry.isAthleteRosterCandidate)
    .map((entry) => {
      const sampleAthletes = (athletesByResponseId.get(entry.id) ?? []).slice(0, 10);
      return {
        id: entry.id,
        url: entry.url,
        endpointPattern: entry.endpointPattern,
        status: entry.status,
        athleteLikeFieldHits: entry.athleteLikeFieldHits,
        athleteLikeScore: entry.athleteLikeScore,
        extractedAthleteCount: entry.extractedAthleteCount,
        sampleAthletes,
      };
    })
    .sort((a, b) => b.athleteLikeScore - a.athleteLikeScore || b.extractedAthleteCount - a.extractedAthleteCount || a.id - b.id);

  const domAthletes = mergeAthletes([], domSnapshots.flat());
  const merged = mergeAthletes(apiAthletes, domAthletes);
  const apiIds = new Set(apiAthletes.map((athlete) => athlete.athleteId));
  const domOnlyIds = new Set(domAthletes.map((athlete) => athlete.athleteId).filter((id) => !apiIds.has(id)));
  const apiCount = apiIds.size;
  const domCount = domOnlyIds.size;
  const warnings = buildWarnings({
    apiCount,
    domCount,
    total: merged.length,
    rosterCandidates: endpointCandidates,
    autoOpenNotes,
  });

  const topEndpoint = endpointCandidates[0] ?? null;
  const roster = selectBestUsersV3Roster(usersV3Bodies);
  const rosterWarnings = buildRosterWarnings({
    rosterCount: roster.athletes.length,
    fallbackNameCount: roster.fallbackNameCount,
    usersV3ResponseCount: usersV3Bodies.length,
  });

  await writeFile(
    candidateEndpointsPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        appUrl: APP_URL,
        totalTpApiGetResponses: captured.length,
        rosterCandidateCount: endpointCandidates.length,
        topEndpointPattern: topEndpoint?.endpointPattern ?? null,
        autoOpenNotes,
        candidates: endpointCandidates,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    athletesNormalizedPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        totalAthletes: merged.length,
        apiCount,
        domCount,
        athletes: merged,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    athletesUsersV3NormalizedPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        endpoint: roster.sourceUrl ?? `${TP_API_HOST}/users/v3/user`,
        itemPath: roster.itemPath,
        sourceResponseId: roster.sourceResponseId,
        totalAthletes: roster.athletes.length,
        fallbackNameCount: roster.fallbackNameCount,
        athletes: roster.athletes,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    rawCandidatesPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        totalRawGroups: rawCandidates.length,
        groups: rawCandidates,
        capturedResponses: captured.map((entry) => ({
          id: entry.id,
          method: entry.method,
          url: entry.url,
          endpointPattern: entry.endpointPattern,
          status: entry.status,
          athleteLikeFieldHits: entry.athleteLikeFieldHits,
          extractedAthleteCount: entry.extractedAthleteCount,
          isAthleteRosterCandidate: entry.isAthleteRosterCandidate,
          responseBodyPreview: entry.responseBodyPreview,
          parseError: entry.parseError,
          failedText: entry.failedText,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const summaryLines = [
    "# TrainingPeaks coached athletes API discovery",
    "",
    `- run_at: \`${new Date().toISOString()}\``,
    `- app_url: \`${APP_URL}\``,
    `- total_athletes: **${merged.length}**`,
    `- api_athletes: **${apiCount}**`,
    `- dom_athletes: **${domCount}**`,
    `- tpapi_get_responses: **${captured.length}**`,
    `- roster_candidates: **${endpointCandidates.length}**`,
    `- top_endpoint_pattern: \`${topEndpoint?.endpointPattern ?? "not confirmed"}\``,
    `- auto_open_notes: ${autoOpenNotes.length ? autoOpenNotes.join(" | ") : "n/a"}`,
    "",
    "## Confirmed coached roster (users/v3/user)",
    `- roster_endpoint: \`${roster.sourceUrl ?? `${TP_API_HOST}/users/v3/user`}\``,
    `- roster_item_path: \`${roster.itemPath ?? "not found"}\``,
    `- roster_athlete_count: **${roster.athletes.length}**`,
    `- roster_fallback_name_count: **${roster.fallbackNameCount}**`,
    "",
    "## Import recommendation",
    "- **Use `athletes.users-v3.normalized.json` for import.**",
    "- **Do not use generic `athletes.normalized.json` for import** (it mixes calendar/event false positives).",
    "",
    "## Roster warnings",
    ...(rosterWarnings.length ? rosterWarnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
    "## Broad discovery warnings",
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
    "## Artifacts",
    `- discovery_summary: \`${discoverySummaryPath}\``,
    `- roster_normalized: \`${athletesUsersV3NormalizedPath}\``,
    `- candidate_endpoints: \`${candidateEndpointsPath}\``,
    `- athletes_normalized_debug: \`${athletesNormalizedPath}\``,
    `- raw_candidates: \`${rawCandidatesPath}\``,
    "",
    "## Safety",
    "- Read-only discovery: GET capture and DOM link scraping only.",
    "- No Supabase writes and no TrainingPeaks mutations.",
  ];
  await writeFile(discoverySummaryPath, `${summaryLines.join("\n")}\n`, "utf8");

  const rosterSampleRows = roster.athletes.slice(0, 15);
  const allWarnings = [...rosterWarnings, ...warnings];

  console.log("");
  console.log("[tp-discover-athletes] Roster summary (users/v3/user)");
  console.log(`roster_athletes: ${roster.athletes.length}`);
  console.log(`roster_fallback_name_rows: ${roster.fallbackNameCount}`);
  console.log(`roster_item_path: ${roster.itemPath ?? "not found"}`);
  console.log(`users_v3_user_responses: ${usersV3Bodies.length}`);
  console.log("");
  console.log("roster_sample_rows:");
  for (const row of rosterSampleRows) {
    console.log(`- ${row.athleteId} | ${row.displayName} | ${row.source} | ${row.trainingpeaksAthleteUrl}`);
  }
  if (allWarnings.length) {
    console.log("");
    console.log("warnings:");
    for (const warning of allWarnings) {
      console.log(`- ${warning}`);
    }
  }
  console.log("");
  console.log("artifact_paths:");
  console.log(`- ${athletesUsersV3NormalizedPath}`);
  console.log(`- ${discoverySummaryPath}`);
  console.log(`- ${candidateEndpointsPath}`);
  console.log(`- ${athletesNormalizedPath}`);
  console.log(`- ${rawCandidatesPath}`);
  console.log("");
  console.log(
    "import_recommendation: use athletes.users-v3.normalized.json for import; do not use athletes.normalized.json",
  );
}

main().catch((error: unknown) => {
  console.error("tp-discover-athletes failed.");
  console.error(error);
  process.exit(1);
});
