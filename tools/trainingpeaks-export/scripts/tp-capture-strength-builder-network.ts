import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Request, type Response } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";

const TP_APP_HOST = "https://app.trainingpeaks.com";
const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const DEFAULT_ATHLETE_URL = `${TP_APP_HOST}/#calendar/athletes/3102415`;
const DEFAULT_DURATION_SEC = 120;
const MAX_BODY_PARSE_CHARS = 600_000;
const MAX_STRING_KEEP_CHARS = 220;
const SHAPE_DEPTH_LIMIT = 5;

const repoRoot = path.resolve(toolRoot, "..", "..");
const defaultOutDir = path.join(repoRoot, "reports", "strength-builder-audit");

const INTEREST_KEYWORD_PATTERN =
  /\b(strength|exercise|exercises|circuit|superset|workouttypevalueid|structure|library|workout|search)\b/i;

type CliArgs = {
  help: boolean;
  durationSec: number;
  outDir: string;
  athleteUrl: string;
  headless: boolean;
};

type CapturedCall = {
  id: number;
  observedAt: string;
  method: string;
  endpointPattern: string;
  status: number | null;
  contentType: string | null;
  tags: string[];
  request: {
    headerKeys: string[];
    queryKeys: string[];
    bodyTopLevelKeys: string[];
    bodyShape: unknown;
    bodyParseNote: string | null;
  };
  response: {
    topLevelKeys: string[];
    bodyShape: unknown;
    bodyParseNote: string | null;
    hasStructure: boolean;
    hasExerciseLike: boolean;
  };
};

type StructureShapeEntry = {
  endpointPattern: string;
  method: string;
  direction: "request" | "response";
  shape: unknown;
  containsExerciseIds: boolean;
  containsSetsRepsRest: boolean;
  containsWarmupCooldown: boolean;
  containsCircuitSuperset: boolean;
  containsNotesLike: boolean;
};

type ExerciseSearchShapeEntry = {
  endpointPattern: string;
  method: string;
  requestShape: unknown;
  responseShape: unknown;
  queryKeys: string[];
  stableExerciseIdsVisible: boolean;
  videoFieldsVisible: boolean;
  instructionFieldsVisible: boolean;
  officialCustomSplitVisible: boolean;
};

type SavePayloadShapeEntry = {
  endpointPattern: string;
  method: string;
  likelyOperation: "create-or-save" | "update-or-save" | "unknown";
  payloadShape: unknown;
  exerciseIdsRequiredSignal: boolean;
  sendsStructureInline: boolean;
};

const SENSITIVE_HEADER_MARKERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "api-key",
  "x-api-key",
  "session",
] as const;

const LONG_TEXT_KEYWORDS = [
  "note",
  "notes",
  "comment",
  "comments",
  "description",
  "instructions",
  "content",
  "text",
  "markdown",
  "html",
  "summary",
] as const;

function printHelp(): void {
  console.log("TrainingPeaks Strength Builder network capture (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp:capture-strength-builder -- --duration 120 --out reports/strength-builder-audit");
  console.log("");
  console.log("Options:");
  console.log(`  --duration=<seconds>   Capture window in seconds (default: ${DEFAULT_DURATION_SEC})`);
  console.log("  --out=<path>           Output directory (default: reports/strength-builder-audit)");
  console.log(`  --athlete-url=<url>    Athlete calendar URL (default: ${DEFAULT_ATHLETE_URL})`);
  console.log("  --headless             Launch browser headless (default: headed)");
  console.log("  --headed               Force headed browser mode");
  console.log("  --help                 Show this help");
  console.log("");
  console.log("Safety:");
  console.log("  - This script is read-only and does not trigger TrainingPeaks writes.");
  console.log("  - It only observes network traffic while you interact manually.");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    help: false,
    durationSec: DEFAULT_DURATION_SEC,
    outDir: defaultOutDir,
    athleteUrl: DEFAULT_ATHLETE_URL,
    headless: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--duration=")) {
      const value = Number(arg.slice("--duration=".length).trim());
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --duration value: "${arg}"`);
      }
      parsed.durationSec = Math.floor(value);
      continue;
    }
    if (arg === "--duration") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value after --duration");
      }
      const value = Number(next.trim());
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --duration value: "${next}"`);
      }
      parsed.durationSec = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length).trim();
      if (!value) {
        throw new Error("Empty --out value.");
      }
      parsed.outDir = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value after --out");
      }
      const value = next.trim();
      if (!value) {
        throw new Error("Empty --out value.");
      }
      parsed.outDir = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      index += 1;
      continue;
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
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value after --athlete-url");
      }
      const value = next.trim();
      if (!value.startsWith(TP_APP_HOST)) {
        throw new Error(`--athlete-url must start with ${TP_APP_HOST}`);
      }
      parsed.athleteUrl = value;
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

  return parsed;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksSensitiveHeaderKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_HEADER_MARKERS.some((marker) => normalized.includes(normalizeKey(marker)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeUrlLike(value: string): string {
  return value
    .replace(/\/athletes\/\d+/gi, "/athletes/<ATHLETE_ID>")
    .replace(/\/workouts\/\d+/gi, "/workouts/<WORKOUT_ID>")
    .replace(/\/exercises\/\d+/gi, "/exercises/<EXERCISE_ID>")
    .replace(/\bworkoutId=\d+\b/gi, "workoutId=<WORKOUT_ID>")
    .replace(/\bathleteId=\d+\b/gi, "athleteId=<ATHLETE_ID>")
    .replace(/\bexerciseId=\d+\b/gi, "exerciseId=<EXERCISE_ID>")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
    .replace(/\b\d{8,}\b/g, "<ID>");
}

function isLongTextField(key: string): boolean {
  const normalized = normalizeKey(key);
  return LONG_TEXT_KEYWORDS.some((token) => normalized.includes(normalizeKey(token)));
}

function isNameFieldKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized === "firstname" || normalized === "lastname" || normalized === "fullname") {
    return true;
  }
  return normalized.includes("athletename");
}

function idPlaceholderForKey(key: string): string {
  const normalized = normalizeKey(key);
  if (normalized.includes("athleteid")) return "<ATHLETE_ID>";
  if (normalized.includes("workoutid")) return "<WORKOUT_ID>";
  if (normalized.includes("exerciseid")) return "<EXERCISE_ID>";
  if (normalized.includes("setid")) return "<SET_ID>";
  if (normalized.includes("circuitid")) return "<CIRCUIT_ID>";
  if (normalized.includes("supersetid")) return "<SUPERSET_ID>";
  if (normalized.includes("id")) return "<ID>";
  return "<VALUE>";
}

function sanitizePrimitive(value: unknown, parentKey = ""): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  const parentNormalized = normalizeKey(parentKey);
  if (typeof value === "number") {
    if (parentNormalized.includes("id")) {
      return idPlaceholderForKey(parentKey);
    }
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  if (looksSensitiveHeaderKey(parentKey)) {
    return "[REDACTED_SECRET]";
  }
  if (isNameFieldKey(parentKey)) {
    return "[REDACTED_NAME]";
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) {
    return "[REDACTED_EMAIL]";
  }
  if (/^bearer\s+[a-z0-9\-._~+/]+=*$/i.test(value) || /eyJ[A-Za-z0-9_-]{8,}\./.test(value)) {
    return "[REDACTED_TOKEN]";
  }
  if (parentNormalized.includes("id") && /^\d+$/.test(value.trim())) {
    return idPlaceholderForKey(parentKey);
  }
  if (isLongTextField(parentKey)) {
    return `[REDACTED_TEXT:${value.length}]`;
  }
  if (value.length > MAX_STRING_KEEP_CHARS) {
    return `[REDACTED_LONG_TEXT:${value.length}]`;
  }
  if (value.includes("http://") || value.includes("https://")) {
    return sanitizeUrlLike(value);
  }
  return value;
}

function sanitizeUnknown(value: unknown, parentKey = "", depth = 0): unknown {
  if (depth > 7) {
    return "[TRUNCATED_DEPTH]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeUnknown(item, parentKey, depth + 1));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (looksSensitiveHeaderKey(key)) {
        out[key] = "[REDACTED_SECRET]";
        continue;
      }
      out[key] = sanitizeUnknown(inner, key, depth + 1);
    }
    return out;
  }
  return sanitizePrimitive(value, parentKey);
}

function parseBody(raw: string): { value: unknown; note: string | null } {
  if (!raw.trim()) {
    return { value: null, note: null };
  }
  if (raw.length > MAX_BODY_PARSE_CHARS) {
    return { value: `[OMITTED_BODY_TOO_LARGE:${raw.length}]`, note: "body too large to parse safely" };
  }

  try {
    return { value: JSON.parse(raw), note: null };
  } catch {
    if (raw.includes("=") && raw.includes("&")) {
      const params = new URLSearchParams(raw);
      const out: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        out[key] = value;
      }
      return { value: out, note: "parsed as urlencoded form" };
    }
    return { value: raw, note: "non-json textual body" };
  }
}

function buildEndpointPattern(inputUrl: string): string {
  return sanitizeUrlLike(inputUrl).replace(/^https?:\/\/[^/]+/i, TP_API_HOST).replace(/\?.*$/, "");
}

function topLevelKeys(value: unknown): string[] {
  if (isRecord(value)) {
    return Object.keys(value).slice(0, 80);
  }
  return [];
}

function parseQueryKeys(inputUrl: string): string[] {
  try {
    const parsed = new URL(inputUrl);
    return [...new Set([...parsed.searchParams.keys()])].slice(0, 80);
  } catch {
    return [];
  }
}

function containsAnyTextMatch(value: unknown, pattern: RegExp): boolean {
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) continue;
    if (typeof current === "string") {
      if (pattern.test(current)) return true;
      continue;
    }
    if (typeof current === "number" || typeof current === "boolean") {
      continue;
    }
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (isRecord(current)) {
      for (const [key, nested] of Object.entries(current)) {
        if (pattern.test(key)) return true;
        stack.push(nested);
      }
    }
  }
  return false;
}

function extractNestedByKey(value: unknown, wantedKey: string): unknown[] {
  const out: unknown[] = [];
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  const normalizedWanted = normalizeKey(wantedKey);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (normalizeKey(key) === normalizedWanted) {
        out.push(nested);
      }
      stack.push(nested);
    }
  }
  return out;
}

function toShape(value: unknown, depth = 0): unknown {
  if (depth > SHAPE_DEPTH_LIMIT) {
    return { type: "truncated" };
  }
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      itemShape: value.length > 0 ? toShape(value[0], depth + 1) : { type: "empty" },
    };
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).slice(0, 80);
    const fields: Record<string, unknown> = {};
    for (const key of keys.slice(0, 20)) {
      fields[key] = toShape(value[key], depth + 1);
    }
    return { type: "object", keys, fields };
  }
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: typeof value };
}

function bodyIncludesInterest(url: string, requestBody: unknown, responseBody: unknown): boolean {
  return (
    INTEREST_KEYWORD_PATTERN.test(url) ||
    containsAnyTextMatch(requestBody, INTEREST_KEYWORD_PATTERN) ||
    containsAnyTextMatch(responseBody, INTEREST_KEYWORD_PATTERN)
  );
}

function tagsForCall(input: { url: string; method: string; requestBody: unknown; responseBody: unknown }): string[] {
  const tags = new Set<string>();
  const haystack = `${input.method} ${input.url}`.toLowerCase();
  if (haystack.includes("workout")) tags.add("workout");
  if (haystack.includes("strength")) tags.add("strength");
  if (haystack.includes("exercise") || haystack.includes("library")) tags.add("exercise");
  if (haystack.includes("search")) tags.add("search");
  if (haystack.includes("circuit")) tags.add("circuit");
  if (haystack.includes("superset")) tags.add("superset");
  if (/(post|put|patch)/i.test(input.method)) tags.add("mutation-observed");
  if (containsAnyTextMatch(input.requestBody, /\bstructure\b/i) || containsAnyTextMatch(input.responseBody, /\bstructure\b/i)) {
    tags.add("structure");
  }
  if (containsAnyTextMatch(input.requestBody, /\bexercise(s)?\b/i) || containsAnyTextMatch(input.responseBody, /\bexercise(s)?\b/i)) {
    tags.add("exercise");
  }
  return [...tags];
}

function likelyOperationFromEndpoint(endpointPattern: string, method: string): "create-or-save" | "update-or-save" | "unknown" {
  if (!/(post|put|patch)/i.test(method)) {
    return "unknown";
  }
  if (/\/workouts\/<WORKOUT_ID>$/i.test(endpointPattern)) {
    return "update-or-save";
  }
  if (/\/workouts(?:$|\/)/i.test(endpointPattern) && !endpointPattern.includes("<WORKOUT_ID>")) {
    return "create-or-save";
  }
  return "unknown";
}

function buildSummaryMarkdown(input: {
  outDir: string;
  durationSec: number;
  totalObserved: number;
  totalIncluded: number;
  callsPath: string;
  structurePath: string | null;
  exercisePath: string | null;
  savePath: string | null;
  strengthGetFound: boolean;
  structureFound: boolean;
  exerciseSearchFound: boolean;
  saveObserved: boolean;
  strengthWorkoutType9Found: boolean;
  scenarioHints: string[];
}): string {
  const lines: string[] = [];
  lines.push("# TrainingPeaks Strength Builder network summary (sanitized)");
  lines.push("");
  lines.push("## Mode");
  lines.push("- Read-only capture mode: this script did not initiate any write action.");
  lines.push("- Browser actions must be performed manually by Igor.");
  lines.push(`- Capture duration configured: ${input.durationSec} seconds.`);
  lines.push("");
  lines.push("## Capture results");
  lines.push(`- Total observed tpapi requests: **${input.totalObserved}**`);
  lines.push(`- Included interesting calls in sanitized report: **${input.totalIncluded}**`);
  lines.push(`- Strength workout GET seen: **${input.strengthGetFound ? "yes" : "no"}**`);
  lines.push(`- workoutTypeValueId=9 seen: **${input.strengthWorkoutType9Found ? "yes" : "no"}**`);
  lines.push(`- ` + "`structure`" + ` field seen: **${input.structureFound ? "yes" : "no"}**`);
  lines.push(`- Exercise search endpoint seen: **${input.exerciseSearchFound ? "yes" : "no"}**`);
  lines.push(`- Save/create mutation request observed manually: **${input.saveObserved ? "yes" : "no"}**`);
  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- network-calls.sanitized.json: \`${input.callsPath}\``);
  lines.push(`- strength-structure-shape.sanitized.json: ${input.structurePath ? `\`${input.structurePath}\`` : "not created (no structure payload captured)"}`);
  lines.push(`- exercise-search-shape.sanitized.json: ${input.exercisePath ? `\`${input.exercisePath}\`` : "not created (no exercise search payload captured)"}`);
  lines.push(`- save-payload-shape.sanitized.json: ${input.savePath ? `\`${input.savePath}\`` : "not created (no manual save payload captured)"}`);
  lines.push("");
  lines.push("## What Igor should do during capture");
  lines.push("- Scenario A: open a New Strength Builder workout and wait for load.");
  lines.push("- Scenario B: in builder UI search exercises (e.g., Glute Bridge, Calf Raise, Step Up, Side Plank).");
  lines.push("- Scenario C (optional): edit a test workout and click Save manually to expose save payload shape.");
  if (input.scenarioHints.length > 0) {
    lines.push("");
    lines.push("## Scenario notes");
    for (const hint of input.scenarioHints) {
      lines.push(`- ${hint}`);
    }
  }
  lines.push("");
  lines.push(`- Output directory: \`${input.outDir}\``);
  return lines.join("\n");
}

async function waitForDurationOrEnter(durationSec: number): Promise<"timeout" | "enter"> {
  const rl = createInterface({ input, output });
  try {
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), durationSec * 1000);
    });
    const enterPromise = (async (): Promise<"enter"> => {
      await rl.question("Press Enter to stop early, or wait for automatic timeout.\n");
      return "enter";
    })();
    const done = await Promise.race([timeoutPromise, enterPromise]);
    return done;
  } finally {
    rl.close();
  }
}

async function buildCapturedCall(args: {
  id: number;
  request: Request;
  response: Response | null;
}): Promise<{ include: boolean; call: CapturedCall; isStrengthWorkoutGet: boolean; hasWorkoutType9: boolean }> {
  const method = args.request.method().toUpperCase();
  const originalUrl = args.request.url();
  const endpointPattern = buildEndpointPattern(originalUrl);
  const observedAt = new Date().toISOString();

  const rawRequestBody = args.request.postData() ?? "";
  const parsedRequest = rawRequestBody ? parseBody(rawRequestBody) : { value: null, note: null };
  const requestBodySanitized = sanitizeUnknown(parsedRequest.value);

  let responseStatus: number | null = null;
  let contentType: string | null = null;
  let parsedResponseNote: string | null = null;
  let responseBodySanitized: unknown = null;
  if (args.response) {
    responseStatus = args.response.status();
    contentType = args.response.headers()["content-type"] ?? null;
    const textual = Boolean(contentType?.includes("json") || contentType?.includes("text") || contentType?.includes("javascript"));
    if (textual) {
      try {
        const responseText = await args.response.text();
        const parsed = parseBody(responseText);
        parsedResponseNote = parsed.note;
        responseBodySanitized = sanitizeUnknown(parsed.value);
      } catch (error) {
        parsedResponseNote = `failed reading response body: ${(error as Error).message}`;
        responseBodySanitized = "[UNAVAILABLE_RESPONSE_BODY]";
      }
    } else {
      parsedResponseNote = `non-text content type: ${contentType ?? "unknown"}`;
      responseBodySanitized = "[NON_TEXT_RESPONSE_OMITTED]";
    }
  }

  const tags = tagsForCall({
    url: originalUrl,
    method,
    requestBody: requestBodySanitized,
    responseBody: responseBodySanitized,
  });

  const include = originalUrl.startsWith(`${TP_API_HOST}/`) && bodyIncludesInterest(originalUrl, requestBodySanitized, responseBodySanitized);
  const responseTopKeys = topLevelKeys(responseBodySanitized);
  const requestTopKeys = topLevelKeys(requestBodySanitized);
  const hasStructure = containsAnyTextMatch(responseBodySanitized, /\bstructure\b/i);
  const hasExerciseLike = containsAnyTextMatch(responseBodySanitized, /\bexercise(s)?\b/i);
  const hasWorkoutType9 =
    containsAnyTextMatch(responseBodySanitized, /\bworkouttypevalueid\b/i) &&
    containsAnyTextMatch(responseBodySanitized, /\b9\b/i);
  const isStrengthWorkoutGet = method === "GET" && tags.includes("workout") && (tags.includes("strength") || hasWorkoutType9);

  return {
    include,
    isStrengthWorkoutGet,
    hasWorkoutType9,
    call: {
      id: args.id,
      observedAt,
      method,
      endpointPattern,
      status: responseStatus,
      contentType,
      tags,
      request: {
        headerKeys: Object.keys(args.request.headers()).map((key) => (looksSensitiveHeaderKey(key) ? `${key}:[REDACTED]` : key)),
        queryKeys: parseQueryKeys(originalUrl),
        bodyTopLevelKeys: requestTopKeys,
        bodyShape: toShape(requestBodySanitized),
        bodyParseNote: parsedRequest.note,
      },
      response: {
        topLevelKeys: responseTopKeys,
        bodyShape: toShape(responseBodySanitized),
        bodyParseNote: parsedResponseNote,
        hasStructure,
        hasExerciseLike,
      },
    },
  };
}

function buildStructureEntries(calls: CapturedCall[]): StructureShapeEntry[] {
  const out: StructureShapeEntry[] = [];
  for (const call of calls) {
    const requestStructures = extractNestedByKey(call.request.bodyShape, "structure");
    const responseStructures = extractNestedByKey(call.response.bodyShape, "structure");

    for (const structure of requestStructures) {
      out.push({
        endpointPattern: call.endpointPattern,
        method: call.method,
        direction: "request",
        shape: toShape(structure),
        containsExerciseIds: containsAnyTextMatch(structure, /\bexerciseid\b/i),
        containsSetsRepsRest: containsAnyTextMatch(structure, /\b(set|sets|rep|reps|rest)\b/i),
        containsWarmupCooldown: containsAnyTextMatch(structure, /\b(warmup|cooldown)\b/i),
        containsCircuitSuperset: containsAnyTextMatch(structure, /\b(circuit|superset)\b/i),
        containsNotesLike: containsAnyTextMatch(structure, /\b(note|comment|description|instructions)\b/i),
      });
    }

    for (const structure of responseStructures) {
      out.push({
        endpointPattern: call.endpointPattern,
        method: call.method,
        direction: "response",
        shape: toShape(structure),
        containsExerciseIds: containsAnyTextMatch(structure, /\bexerciseid\b/i),
        containsSetsRepsRest: containsAnyTextMatch(structure, /\b(set|sets|rep|reps|rest)\b/i),
        containsWarmupCooldown: containsAnyTextMatch(structure, /\b(warmup|cooldown)\b/i),
        containsCircuitSuperset: containsAnyTextMatch(structure, /\b(circuit|superset)\b/i),
        containsNotesLike: containsAnyTextMatch(structure, /\b(note|comment|description|instructions)\b/i),
      });
    }
  }
  return out.slice(0, 40);
}

function buildExerciseEntries(calls: CapturedCall[]): ExerciseSearchShapeEntry[] {
  const out: ExerciseSearchShapeEntry[] = [];
  for (const call of calls) {
    const tags = new Set(call.tags);
    if (!tags.has("exercise") && !tags.has("search")) {
      continue;
    }
    const stableExerciseIdsVisible = containsAnyTextMatch(call.response.bodyShape, /\bexerciseid\b/i);
    const videoFieldsVisible = containsAnyTextMatch(call.response.bodyShape, /\b(video|youtube|thumbnail|media)\b/i);
    const instructionFieldsVisible = containsAnyTextMatch(call.response.bodyShape, /\b(instruction|cue|description|tips)\b/i);
    const officialCustomSplitVisible = containsAnyTextMatch(call.response.bodyShape, /\b(official|custom|source|ownedby)\b/i);

    out.push({
      endpointPattern: call.endpointPattern,
      method: call.method,
      requestShape: call.request.bodyShape,
      responseShape: call.response.bodyShape,
      queryKeys: call.request.queryKeys,
      stableExerciseIdsVisible,
      videoFieldsVisible,
      instructionFieldsVisible,
      officialCustomSplitVisible,
    });
  }
  return out.slice(0, 40);
}

function buildSaveEntries(calls: CapturedCall[]): SavePayloadShapeEntry[] {
  const out: SavePayloadShapeEntry[] = [];
  for (const call of calls) {
    if (!/(POST|PUT|PATCH)/.test(call.method)) {
      continue;
    }
    const signalsWorkoutRelated = call.tags.includes("workout") || call.tags.includes("strength") || call.tags.includes("structure");
    if (!signalsWorkoutRelated) {
      continue;
    }

    out.push({
      endpointPattern: call.endpointPattern,
      method: call.method,
      likelyOperation: likelyOperationFromEndpoint(call.endpointPattern, call.method),
      payloadShape: call.request.bodyShape,
      exerciseIdsRequiredSignal: containsAnyTextMatch(call.request.bodyShape, /\bexerciseid\b/i),
      sendsStructureInline: containsAnyTextMatch(call.request.bodyShape, /\bstructure\b/i),
    });
  }
  return out.slice(0, 40);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  await mkdir(args.outDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  const networkCallsPath = path.join(args.outDir, "network-calls.sanitized.json");
  const summaryPath = path.join(args.outDir, "network-summary.md");
  const structurePath = path.join(args.outDir, "strength-structure-shape.sanitized.json");
  const exercisePath = path.join(args.outDir, "exercise-search-shape.sanitized.json");
  const savePath = path.join(args.outDir, "save-payload-shape.sanitized.json");

  console.log("[tp-capture-strength-builder-network] mode: READ-ONLY capture");
  console.log(`[tp-capture-strength-builder-network] output: ${args.outDir}`);
  console.log(`[tp-capture-strength-builder-network] capture window: ${args.durationSec} seconds`);
  console.log("[tp-capture-strength-builder-network] script will NOT click save or send any write requests.");
  console.log("");
  console.log("Manual actions in browser:");
  console.log("A) Open an existing/test New Strength Builder workout and let it load.");
  console.log("B) Search exercises: Glute Bridge, Calf Raise, Step Up, Side Plank.");
  console.log("C) Optional: manually edit and save a TEST workout to observe save payload (script does not trigger save).");
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  const requestIds = new Map<Request, number>();
  let nextRequestId = 1;
  let totalObservedTpApi = 0;
  const captured: CapturedCall[] = [];
  let strengthGetFound = false;
  let workoutType9Found = false;
  const scenarioHints: string[] = [];

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
    if (!request.url().startsWith(`${TP_API_HOST}/`)) return;
    totalObservedTpApi += 1;
    assignId(request);
  });

  context.on("requestfinished", async (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) return;
    const response = await request.response();
    const built = await buildCapturedCall({
      id: assignId(request),
      request,
      response,
    });
    if (!built.include) {
      return;
    }
    if (built.isStrengthWorkoutGet) {
      strengthGetFound = true;
    }
    if (built.hasWorkoutType9) {
      workoutType9Found = true;
    }
    captured.push(built.call);
  });

  context.on("requestfailed", async (request) => {
    if (!request.url().startsWith(`${TP_API_HOST}/`)) return;
    const built = await buildCapturedCall({
      id: assignId(request),
      request,
      response: null,
    });
    if (built.include) {
      captured.push(built.call);
    }
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    const stopReason = await waitForDurationOrEnter(args.durationSec);
    scenarioHints.push(stopReason === "enter" ? "Capture was stopped manually with Enter." : "Capture ended by timeout window.");
    await page.waitForTimeout(1_500);
  } finally {
    await context.close().catch(() => {});
  }

  captured.sort((a, b) => a.id - b.id);

  const structureEntries = buildStructureEntries(captured);
  const exerciseEntries = buildExerciseEntries(captured);
  const saveEntries = buildSaveEntries(captured);

  const summaryPayload = {
    runAt: new Date().toISOString(),
    mode: "read-only-observer",
    outputDir: args.outDir,
    totalObservedTpApi,
    totalIncluded: captured.length,
    calls: captured,
  };
  await writeFile(networkCallsPath, `${JSON.stringify(summaryPayload, null, 2)}\n`, "utf8");

  let createdStructurePath: string | null = null;
  if (structureEntries.length > 0) {
    await writeFile(
      structurePath,
      `${JSON.stringify({ runAt: new Date().toISOString(), found: true, entries: structureEntries }, null, 2)}\n`,
      "utf8",
    );
    createdStructurePath = structurePath;
  }

  let createdExercisePath: string | null = null;
  if (exerciseEntries.length > 0) {
    await writeFile(
      exercisePath,
      `${JSON.stringify({ runAt: new Date().toISOString(), found: true, entries: exerciseEntries }, null, 2)}\n`,
      "utf8",
    );
    createdExercisePath = exercisePath;
  }

  let createdSavePath: string | null = null;
  if (saveEntries.length > 0) {
    await writeFile(savePath, `${JSON.stringify({ runAt: new Date().toISOString(), found: true, entries: saveEntries }, null, 2)}\n`, "utf8");
    createdSavePath = savePath;
  }

  const markdown = buildSummaryMarkdown({
    outDir: args.outDir,
    durationSec: args.durationSec,
    totalObserved: totalObservedTpApi,
    totalIncluded: captured.length,
    callsPath: networkCallsPath,
    structurePath: createdStructurePath,
    exercisePath: createdExercisePath,
    savePath: createdSavePath,
    strengthGetFound,
    structureFound: structureEntries.length > 0,
    exerciseSearchFound: exerciseEntries.length > 0,
    saveObserved: saveEntries.length > 0,
    strengthWorkoutType9Found: workoutType9Found,
    scenarioHints,
  });
  await writeFile(summaryPath, `${markdown}\n`, "utf8");

  console.log("");
  console.log("[tp-capture-strength-builder-network] capture complete.");
  console.log(`- network summary: ${summaryPath}`);
  console.log(`- sanitized calls: ${networkCallsPath}`);
  if (createdStructurePath) console.log(`- structure shape: ${createdStructurePath}`);
  if (createdExercisePath) console.log(`- exercise search shape: ${createdExercisePath}`);
  if (createdSavePath) console.log(`- save payload shape: ${createdSavePath}`);
  console.log("- no TrainingPeaks write request was initiated by this script.");
}

main().catch((error: unknown) => {
  console.error("tp-capture-strength-builder-network failed.");
  console.error(error);
  process.exit(1);
});

