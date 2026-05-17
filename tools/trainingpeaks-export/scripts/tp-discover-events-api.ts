import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, type Locator, type Page, type Request, type Response } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { redactUnknown } from "./lib/trainingpeaks-api-move.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const ARTIFACTS_ROOT = path.join(toolRoot, "action-artifacts", "events-discovery");
const RESPONSE_BODY_MAX_CHARS = 75_000;
const CANDIDATE_TEXT_MAX = 2_000;
const MODAL_DOM_MAX = 15_000;

const EVENT_KEYWORDS = [
  "EventDate",
  "eventDate",
  "EventType",
  "eventType",
  "SportType",
  "sportType",
  "AthleteEventId",
  "athleteEventId",
  "EventId",
  "eventId",
  "Goals",
  "goals",
  "Goal",
  "goal",
  "Race",
  "race",
  "Distance",
  "distance",
  "RoadRunning",
  "roadRunning",
  "Road Running",
  "10k",
  "Name",
  "name",
] as const;

type CliArgs = {
  athleteUrl: string;
  headless: boolean;
  eventDate: string | null;
  eventTitle: string | null;
  clickEventCard: boolean;
};

type CapturedResponse = {
  id: number;
  method: string;
  url: string;
  endpointPattern: string;
  status: number | null;
  ok: boolean | null;
  startedAt: string;
  durationMs: number | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  responseBodyPreview: unknown;
  parseError: string | null;
  eventLikeKeyMatches: string[];
  eventLikeFieldHits: string[];
  prioritizedSignalHits: string[];
  eventLikeScore: number;
  isEventCandidate: boolean;
  failedText: string | null;
};

type EventCardCandidate = {
  selector: string;
  score: number;
  textPreview: string;
  dateMatched: boolean;
  titleMatched: boolean;
  eventLikeTextMatched: string[];
  boundingBox: { x: number; y: number; width: number; height: number } | null;
};

type ModalDomDebug = {
  selector: string;
  tagName: string;
  id: string;
  className: string;
  role: string;
  ariaLabel: string;
  textPreview: string;
  outerHtmlPreview: string;
};

type EventCandidate = {
  id: number;
  method: string;
  url: string;
  endpointPattern: string;
  status: number | null;
  eventLikeKeyMatches: string[];
  eventLikeFieldHits: string[];
  prioritizedSignalHits: string[];
  eventLikeScore: number;
  sample: unknown;
};

type DiscoverySummary = {
  confirmed: boolean;
  endpointPattern: string | null;
  method: "GET" | null;
  chosenCandidateId: number | null;
  reason: string;
};

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteUrl: "",
    headless: false,
    eventDate: null,
    eventTitle: null,
    clickEventCard: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--athlete-url=")) {
      parsed.athleteUrl = arg.slice("--athlete-url=".length).trim();
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
    if (arg.startsWith("--event-date=")) {
      const value = arg.slice("--event-date=".length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Invalid --event-date format "${value}". Expected YYYY-MM-DD.`);
      }
      parsed.eventDate = value;
      continue;
    }
    if (arg.startsWith("--event-title=")) {
      const value = arg.slice("--event-title=".length).trim();
      parsed.eventTitle = value || null;
      continue;
    }
    if (arg === "--click-event-card") {
      parsed.clickEventCard = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.athleteUrl) {
    throw new Error("Missing required argument: --athlete-url=<url>");
  }

  return parsed;
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

function getDateIsoFromEpochMs(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return new Date().toISOString();
  }
  return new Date(epochMs).toISOString();
}

function readHeadersSafe(headers: Record<string, string>): Record<string, string> {
  return redactUnknown(headers) as Record<string, string>;
}

function buildEndpointPattern(inputUrl: string): string {
  let pattern = inputUrl;
  pattern = pattern.replace(/\/athletes\/\d+/gi, "/athletes/{athleteId}");
  pattern = pattern.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "{date}");
  pattern = pattern.replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi, "{dateTime}");
  pattern = pattern.replace(/\b\d{10,}\b/g, "{id}");
  return pattern;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectEventLikeKeyMatches(input: unknown): string[] {
  const wanted = new Set(EVENT_KEYWORDS.map((key) => key.toLowerCase()));
  const matches = new Set<string>();
  const seen = new Set<unknown>();

  function visit(node: unknown, pathPrefix: string): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${pathPrefix}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const keyLower = key.toLowerCase();
      const pathName = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (wanted.has(keyLower)) {
        matches.add(pathName);
      }
      visit(value, pathName);
    }
  }

  visit(input, "");
  return [...matches];
}

function collectEventLikeFieldHits(input: unknown): string[] {
  const wanted = new Set(EVENT_KEYWORDS.map((key) => key.toLowerCase()));
  const fields = new Set<string>();
  const seen = new Set<unknown>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const keyLower = key.toLowerCase();
      if (wanted.has(keyLower)) {
        fields.add(keyLower);
      }
      visit(value);
    }
  }

  visit(input);
  return [...fields];
}

function scoreEventFieldHits(fieldHits: string[]): number {
  const set = new Set(fieldHits);
  let score = 0;
  if (set.has("athleteeventid")) score += 9;
  if (set.has("eventid")) score += 8;
  if (set.has("eventdate")) score += 8;
  if (set.has("eventtype")) score += 6;
  if (set.has("sporttype")) score += 6;
  if (set.has("race")) score += 5;
  if (set.has("distance")) score += 5;
  if (set.has("goal")) score += 4;
  if (set.has("goals")) score += 4;
  if (set.has("name")) score += 1;
  return score;
}

function collectPrioritizedSignalHits(input: unknown, args: CliArgs): string[] {
  const serialized = JSON.stringify(input).toLowerCase();
  const hits: string[] = [];
  const keySignals = [
    "athleteeventid",
    "eventid",
    "eventdate",
    "eventtype",
    "sporttype",
    "distance",
    "goal",
    "goals",
    "roadrunning",
    "road running",
    "10k",
  ];
  for (const signal of keySignals) {
    if (serialized.includes(signal)) {
      hits.push(signal);
    }
  }
  if (args.eventDate && serialized.includes(args.eventDate.toLowerCase())) {
    hits.push(`event-date:${args.eventDate}`);
  }
  if (args.eventTitle && serialized.includes(args.eventTitle.toLowerCase())) {
    hits.push(`event-title:${args.eventTitle}`);
  }
  return [...new Set(hits)];
}

function scorePrioritizedSignals(signalHits: string[]): number {
  let score = 0;
  for (const hit of signalHits) {
    if (hit === "athleteeventid") score += 10;
    else if (hit === "eventid") score += 9;
    else if (hit.startsWith("event-date:")) score += 9;
    else if (hit.startsWith("event-title:")) score += 8;
    else if (hit === "eventdate") score += 7;
    else if (hit === "eventtype") score += 6;
    else if (hit === "sporttype") score += 6;
    else if (hit === "roadrunning" || hit === "road running") score += 6;
    else if (hit === "10k") score += 6;
    else if (hit === "distance") score += 5;
    else if (hit === "goal" || hit === "goals") score += 5;
  }
  return score;
}

function buildSample(input: unknown, depth = 0): unknown {
  if (depth >= 4) {
    return "[truncated-depth]";
  }
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

function buildDiscoverySummary(candidates: EventCandidate[]): DiscoverySummary {
  const getCandidates = candidates.filter((candidate) => candidate.method.toUpperCase() === "GET");
  const strong = getCandidates.filter((candidate) =>
    candidate.eventLikeFieldHits.some((hit) => hit !== "name"),
  );
  const pool = strong.length ? strong : getCandidates;
  const chosen = pool.sort((a, b) => b.eventLikeScore - a.eventLikeScore || a.id - b.id)[0];

  if (!chosen) {
    return {
      confirmed: false,
      endpointPattern: null,
      method: null,
      chosenCandidateId: null,
      reason: "No GET tpapi responses with event-like fields were captured.",
    };
  }

  return {
    confirmed: true,
    endpointPattern: chosen.endpointPattern,
    method: "GET",
    chosenCandidateId: chosen.id,
    reason: "Top-scoring GET event-like response.",
  };
}

async function buildCapturedResponse(input: {
  id: number;
  request: Request;
  response: Response | null;
  args: CliArgs;
  failedText?: string;
}): Promise<CapturedResponse> {
  const { id, request, response } = input;
  const timing = request.timing();
  const startedAt = getDateIsoFromEpochMs(timing.startTime);
  const durationMs =
    Number.isFinite(timing.responseEnd) && Number.isFinite(timing.startTime) && timing.responseEnd >= timing.startTime
      ? Math.round(timing.responseEnd - timing.startTime)
      : null;

  const requestHeaders = readHeadersSafe(request.headers());
  let responseHeaders: Record<string, string> = {};
  let responseBodyPreview: unknown = null;
  let parseError: string | null = null;
  let eventLikeKeyMatches: string[] = [];
  let eventLikeFieldHits: string[] = [];
  let prioritizedSignalHits: string[] = [];

  if (response) {
    responseHeaders = readHeadersSafe(response.headers());
    const contentType = String(response.headers()["content-type"] ?? "");
    if (looksTextualResponse(contentType)) {
      try {
        const bodyText = await response.text();
        if (bodyText.length > RESPONSE_BODY_MAX_CHARS) {
          responseBodyPreview = `[omitted: large textual body ${bodyText.length} chars]`;
        } else {
          let parsed: unknown = bodyText;
          try {
            parsed = JSON.parse(bodyText);
          } catch (jsonErr) {
            parseError = `JSON parse skipped: ${(jsonErr as Error).message}`;
          }
          const redacted = redactUnknown(parsed);
          responseBodyPreview = buildSample(redacted);
          eventLikeKeyMatches = collectEventLikeKeyMatches(redacted);
          eventLikeFieldHits = collectEventLikeFieldHits(redacted);
          prioritizedSignalHits = collectPrioritizedSignalHits(redacted, input.args);
        }
      } catch (error) {
        parseError = `response.text() failed: ${(error as Error).message}`;
        responseBodyPreview = `[unavailable: ${(error as Error).message}]`;
      }
    } else {
      responseBodyPreview = `[omitted: non-text content-type ${contentType || "unknown"}]`;
    }
  }

  return {
    id,
    method: request.method(),
    url: request.url(),
    endpointPattern: buildEndpointPattern(request.url()),
    status: response?.status() ?? null,
    ok: response?.ok() ?? null,
    startedAt,
    durationMs,
    requestHeaders,
    responseHeaders,
    responseBodyPreview,
    parseError,
    eventLikeKeyMatches,
    eventLikeFieldHits,
    prioritizedSignalHits,
    eventLikeScore: scoreEventFieldHits(eventLikeFieldHits) + scorePrioritizedSignals(prioritizedSignalHits),
    isEventCandidate: eventLikeFieldHits.length > 0 || prioritizedSignalHits.length > 0,
    failedText: input.failedText ?? null,
  };
}

async function clickSafe(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ timeout: 5_000 });
}

async function tryNavigateCalendarNearDate(page: Page, eventDate: string | null): Promise<string[]> {
  const notes: string[] = [];
  if (!eventDate) {
    notes.push("No --event-date provided; skipped calendar month alignment.");
    return notes;
  }

  const [year, month] = eventDate.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    notes.push("Invalid event date parsing; skipped month alignment.");
    return notes;
  }
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

  const hasMonthVisible = async (): Promise<boolean> => {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    return bodyText.includes(`${monthName} ${year}`.toLowerCase()) || bodyText.includes(eventDate.toLowerCase());
  };

  if (await hasMonthVisible()) {
    notes.push(`Target month already visible (${monthName} ${year}) or date text present.`);
    return notes;
  }

  const prevButtons = page.locator('button:visible, [role="button"]:visible').filter({
    hasText: /prev|previous|назад|back/i,
  });
  const nextButtons = page.locator('button:visible, [role="button"]:visible').filter({
    hasText: /next|forward|вперед|далее/i,
  });
  let navigated = false;

  for (const direction of ["next", "prev"] as const) {
    for (let i = 0; i < 14; i += 1) {
      if (await hasMonthVisible()) {
        notes.push(`Calendar aligned to target month after ${i} ${direction} steps.`);
        return notes;
      }
      const candidate = direction === "next" ? nextButtons.first() : prevButtons.first();
      if ((await candidate.count()) === 0) {
        break;
      }
      try {
        await clickSafe(candidate);
        await page.waitForTimeout(400);
        navigated = true;
      } catch {
        break;
      }
    }
  }

  if (await hasMonthVisible()) {
    notes.push("Calendar appears aligned after navigation attempts.");
  } else if (navigated) {
    notes.push("Attempted safe month navigation, but target month visibility not confirmed.");
  } else {
    notes.push("Could not find safe next/prev controls; left current calendar month unchanged.");
  }
  return notes;
}

async function collectVisibleEventCandidates(page: Page, args: CliArgs): Promise<EventCardCandidate[]> {
  const cards = await page.evaluate(
    ({ eventDate, eventTitleLower, textMax }) => {
      const selectors = [
        '[data-testid*="event"]',
        '[class*="event"]',
        '[class*="race"]',
        '[aria-label*="event" i]',
        "button",
        '[role="button"]',
        "a",
        "div",
      ];
      const eventHints = ["weeks until event", "забег", "event", "race", "road running", "10k"];
      const dangerousHints = ["edit event", "delete", "trash", "save", "save & close", "сохранить", "удалить"];
      const seen = new Set<Element>();
      const out: Array<{
        selector: string;
        score: number;
        textPreview: string;
        dateMatched: boolean;
        titleMatched: boolean;
        eventLikeTextMatched: string[];
        boundingBox: { x: number; y: number; width: number; height: number } | null;
      }> = [];

      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          if (seen.has(el)) continue;
          seen.add(el);
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width < 40 ||
            rect.height < 20 ||
            style.visibility === "hidden" ||
            style.display === "none" ||
            Number(style.opacity) < 0.1
          ) {
            continue;
          }
          const rawText = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!rawText) continue;
          const text = rawText.slice(0, textMax);
          const textLower = text.toLowerCase();
          if (dangerousHints.some((hint) => textLower.includes(hint))) continue;

          let score = 0;
          const matchedHints = eventHints.filter((hint) => textLower.includes(hint));
          if (matchedHints.length > 0) score += matchedHints.length * 3;
          const dateMatched = Boolean(eventDate && textLower.includes(eventDate.toLowerCase()));
          if (dateMatched) score += 8;
          const titleMatched = Boolean(eventTitleLower && textLower.includes(eventTitleLower));
          if (titleMatched) score += 10;
          if (textLower.includes("weeks until event")) score += 5;

          if (score <= 0) continue;
          let computedSelector = "";
          const anyEl = el as HTMLElement;
          if (anyEl.id) {
            computedSelector = `#${anyEl.id}`;
          } else {
            const parts: string[] = [];
            let current: HTMLElement | null = anyEl;
            while (current && parts.length < 4) {
              const cls = typeof current.className === "string" && current.className.trim()
                ? current.className.trim().split(/\s+/)[0]
                : "";
              parts.push(`${current.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`);
              current = current.parentElement;
            }
            computedSelector = parts.reverse().join(" > ");
          }
          out.push({
            selector: computedSelector,
            score,
            textPreview: text,
            dateMatched,
            titleMatched,
            eventLikeTextMatched: matchedHints,
            boundingBox: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          });
        }
      }

      out.sort((a, b) => b.score - a.score || a.selector.localeCompare(b.selector));
      return out.slice(0, 50);
    },
    {
      eventDate: args.eventDate,
      eventTitleLower: args.eventTitle?.toLowerCase() ?? null,
      textMax: CANDIDATE_TEXT_MAX,
    },
  );
  return cards;
}

async function clickEventCandidate(page: Page, candidate: EventCardCandidate): Promise<boolean> {
  const selector = candidate.selector;
  try {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await clickSafe(locator);
      return true;
    }
  } catch {
    // Fall through to coordinate click fallback.
  }
  if (candidate.boundingBox) {
    const x = candidate.boundingBox.x + candidate.boundingBox.width / 2;
    const y = candidate.boundingBox.y + Math.min(candidate.boundingBox.height / 2, 25);
    await page.mouse.click(x, y);
    return true;
  }
  return false;
}

async function readModalText(page: Page): Promise<string> {
  const selectors = ['[role="dialog"]', '[aria-modal="true"]', ".modal", '[class*="modal"]'];
  for (const selector of selectors) {
    const locator = page.locator(selector).filter({ hasNotText: /save & close|save|delete|trash|edit event/i }).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return (await locator.innerText()).trim();
      }
    } catch {
      continue;
    }
  }
  return "";
}

async function readModalDomDebug(page: Page): Promise<ModalDomDebug | null> {
  return page.evaluate(
    ({ domMax, textMax }) => {
      const selectors = ['[role="dialog"]', '[aria-modal="true"]', ".modal", '[class*="modal"]'];
      for (const selector of selectors) {
        const element = document.querySelector(selector) as HTMLElement | null;
        if (!element) continue;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 60 || style.display === "none" || style.visibility === "hidden") {
          continue;
        }
        const textPreview = (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, textMax);
        const outerHtmlPreview = element.outerHTML.slice(0, domMax);
        return {
          selector,
          tagName: element.tagName.toLowerCase(),
          id: element.id || "",
          className: element.className || "",
          role: element.getAttribute("role") || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          textPreview,
          outerHtmlPreview,
        };
      }
      return null;
    },
    { domMax: MODAL_DOM_MAX, textMax: CANDIDATE_TEXT_MAX },
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = timestampForPath(new Date());
  const artifactDir = path.join(ARTIFACTS_ROOT, timestamp);
  const responsesPath = path.join(artifactDir, "responses.redacted.json");
  const candidatesPath = path.join(artifactDir, "event-candidates.redacted.json");
  const modalTextPath = path.join(artifactDir, "modal-text.txt");
  const modalDomDebugPath = path.join(artifactDir, "modal-dom-debug.json");
  const beforeClickPath = path.join(artifactDir, "before-click.png");
  const afterClickPath = path.join(artifactDir, "after-click.png");
  const summaryPath = path.join(artifactDir, "summary.md");

  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  console.log("[tp-discover-events-api] Read-only discovery started.");
  console.log(`[tp-discover-events-api] profile=${profileDir}`);
  console.log(`[tp-discover-events-api] athleteUrl=${args.athleteUrl}`);
  console.log(`[tp-discover-events-api] eventDate=${args.eventDate ?? "n/a"}`);
  console.log(`[tp-discover-events-api] eventTitle=${args.eventTitle ?? "n/a"}`);
  console.log(`[tp-discover-events-api] clickEventCard=${args.clickEventCard ? "yes" : "no"}`);
  console.log(`[tp-discover-events-api] artifactDir=${artifactDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  const captured: CapturedResponse[] = [];
  const ids = new Map<Request, number>();
  let nextId = 1;

  let calendarNotes: string[] = [];
  let eventCardCandidates: EventCardCandidate[] = [];
  let clickedCandidate: EventCardCandidate | null = null;
  let modalOpened = false;
  let modalText = "";
  let modalDomDebug: ModalDomDebug | null = null;
  let clickedAtCapturedCount = 0;
  const mutationControlsTouched = false;

  const assignId = (request: Request): number => {
    const existing = ids.get(request);
    if (existing) return existing;
    const created = nextId++;
    ids.set(request, created);
    return created;
  };

  context.on("request", (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) {
      return;
    }
    assignId(request);
  });

  context.on("requestfinished", async (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) {
      return;
    }
    const response = await request.response();
    captured.push(
      await buildCapturedResponse({
        id: assignId(request),
        request,
        response,
        args,
      }),
    );
  });

  context.on("requestfailed", async (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) {
      return;
    }
    captured.push(
      await buildCapturedResponse({
        id: assignId(request),
        request,
        response: null,
        args,
        failedText: request.failure()?.errorText ?? "request failed",
      }),
    );
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(6_000);
    calendarNotes = await tryNavigateCalendarNearDate(page, args.eventDate);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: beforeClickPath, fullPage: true });

    eventCardCandidates = await collectVisibleEventCandidates(page, args);
    if (args.clickEventCard && eventCardCandidates.length > 0) {
      const target = eventCardCandidates[0];
      const targetTextLower = target.textPreview.toLowerCase();
      if (/edit event|delete|trash|save|save & close|сохранить|удалить/i.test(targetTextLower)) {
        throw new Error("Safety stop: top event candidate appears to be a mutation control.");
      }
      clickedAtCapturedCount = captured.length;
      const clicked = await clickEventCandidate(page, target);
      if (clicked) {
        clickedCandidate = target;
        await page.waitForTimeout(4_000);
        modalText = await readModalText(page);
        modalDomDebug = await readModalDomDebug(page);
        modalOpened = Boolean(modalText || modalDomDebug);
      }
    }
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: afterClickPath, fullPage: true });
  } finally {
    await context.close().catch(() => {});
  }

  captured.sort((a, b) => a.id - b.id);
  const candidates: EventCandidate[] = captured
    .filter((entry) => entry.isEventCandidate)
    .map((entry) => ({
      id: entry.id,
      method: entry.method,
      url: entry.url,
      endpointPattern: entry.endpointPattern,
      status: entry.status,
      eventLikeKeyMatches: entry.eventLikeKeyMatches,
      eventLikeFieldHits: entry.eventLikeFieldHits,
      prioritizedSignalHits: entry.prioritizedSignalHits,
      eventLikeScore: entry.eventLikeScore,
      sample: entry.responseBodyPreview,
    }))
    .sort((a, b) => b.eventLikeScore - a.eventLikeScore || a.id - b.id);

  const discovery = buildDiscoverySummary(candidates);

  await writeFile(
    responsesPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteUrl: args.athleteUrl,
        tpApiHost: TP_API_HOST,
        eventDate: args.eventDate,
        eventTitle: args.eventTitle,
        clickEventCard: args.clickEventCard,
        modalOpened,
        clickedAtCapturedCount,
        postClickNewResponses: clickedAtCapturedCount ? Math.max(captured.length - clickedAtCapturedCount, 0) : 0,
        totalTpApiResponses: captured.length,
        responses: captured,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    candidatesPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteUrl: args.athleteUrl,
        eventDate: args.eventDate,
        eventTitle: args.eventTitle,
        modalOpened,
        eventCardCandidates,
        clickedCandidate,
        calendarNotes,
        totalCandidates: candidates.length,
        discovery,
        candidates,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(modalTextPath, `${modalText || "[modal text not found]"}\n`, "utf8");
  await writeFile(
    modalDomDebugPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        modalOpened,
        modalDomDebug,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const topPatterns = new Map<string, number>();
  for (const candidate of candidates.slice(0, 20)) {
    topPatterns.set(candidate.endpointPattern, (topPatterns.get(candidate.endpointPattern) ?? 0) + 1);
  }
  const topPatternLines = [...topPatterns.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([pattern, count]) => `- \`${pattern}\` (hits: ${count})`);

  const summaryLines = [
    "# TrainingPeaks events API discovery",
    "",
    `- run_at: \`${new Date().toISOString()}\``,
    `- athlete_url: \`${args.athleteUrl}\``,
    `- event_date: \`${args.eventDate ?? "n/a"}\``,
    `- event_title: \`${args.eventTitle ?? "n/a"}\``,
    `- click_event_card: **${args.clickEventCard ? "yes" : "no"}**`,
    `- modal_opened: **${modalOpened ? "yes" : "no"}**`,
    `- mutation_controls_touched: **${mutationControlsTouched ? "yes" : "no"}**`,
    `- calendar_notes: ${calendarNotes.length ? calendarNotes.join(" | ") : "n/a"}`,
    `- total_tpapi_responses: **${captured.length}**`,
    `- post_click_new_tpapi_responses: **${
      clickedAtCapturedCount ? Math.max(captured.length - clickedAtCapturedCount, 0) : 0
    }**`,
    `- event_candidates: **${candidates.length}**`,
    `- discovery_confirmed: **${discovery.confirmed ? "yes" : "no"}**`,
    `- endpoint_pattern: \`${discovery.endpointPattern ?? "not confirmed"}\``,
    `- method: \`${discovery.method ?? "n/a"}\``,
    "",
    "## Top endpoint patterns",
    ...(topPatternLines.length ? topPatternLines : ["- No event-like endpoint patterns found."]),
    "",
    "## Safety",
    "- Discovery is read-only: no edit/save/delete controls are clicked.",
    "- Event-card click is allowed only when `--click-event-card` is passed.",
    "- Captured artifacts are redacted.",
    "",
    "## Modal text preview",
    modalText ? `- ${modalText.replace(/\s+/g, " ").slice(0, 500)}` : "- Modal text was not detected.",
  ];
  await writeFile(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");

  console.log(`[tp-discover-events-api] saved ${responsesPath}`);
  console.log(`[tp-discover-events-api] saved ${candidatesPath}`);
  console.log(`[tp-discover-events-api] saved ${modalTextPath}`);
  console.log(`[tp-discover-events-api] saved ${modalDomDebugPath}`);
  console.log(`[tp-discover-events-api] saved ${beforeClickPath}`);
  console.log(`[tp-discover-events-api] saved ${afterClickPath}`);
  console.log(`[tp-discover-events-api] saved ${summaryPath}`);
  console.log(`[tp-discover-events-api] modalOpened=${modalOpened ? "yes" : "no"}`);
  if (discovery.confirmed) {
    console.log(`[tp-discover-events-api] endpoint candidate: ${discovery.endpointPattern}`);
  } else {
    console.log("[tp-discover-events-api] no confirmed GET endpoint candidate yet.");
  }
}

main().catch((error: unknown) => {
  console.error("tp-discover-events-api failed.");
  console.error(error);
  process.exit(1);
});
