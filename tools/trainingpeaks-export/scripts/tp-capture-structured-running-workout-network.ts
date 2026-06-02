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
const DEFAULT_MAX_WAIT_SECONDS = 240;
const DEFAULT_SETTLE_MS = 5_000;
const RESPONSE_BODY_MAX_CHARS = 120_000;
const STRING_SAMPLE_MAX = 180;
const SHAPE_DEPTH_LIMIT = 6;
const EVENT_TEXT_SCAN_LIMIT = 6_000;

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

const SAFE_TEXT_MARKERS = [
  "api structure test",
  "do not use",
  "desc_marker_easy_pace",
  "desc_marker_easy_hr",
  "desc_marker_interval_pace",
  "desc_marker_interval_hr",
  "step_note_easy_pace",
  "step_note_easy_hr",
  "step_note_warmup_pace",
  "step_note_work_pace",
  "step_note_recovery_pace",
  "step_note_cooldown_pace",
  "step_note_warmup_hr",
  "step_note_work_hr",
  "step_note_recovery_hr",
  "step_note_cooldown_hr",
] as const;

type CaseId = "easy-pace" | "easy-hr" | "interval-pace" | "interval-hr";
type EventMethod = "POST" | "PUT" | "GET";
type WaitReason = "auto_detected" | "manual_enter" | "timeout";

type CaseDefinition = {
  id: CaseId;
  label: string;
  titleMarker: string;
  descriptionMarker: string;
  stepNoteMarkers: string[];
  targetMetricLabel: "Threshold Pace" | "Threshold Heart Rate";
  targetMetricKey: "percentOfThresholdPace" | "percentOfThresholdHr";
  expectRepeatBlock: boolean;
  expectedRange: {
    min: number;
    max: number;
  };
  fixtureFileName: string;
};

type CliArgs = {
  athleteUrl: string;
  athleteId: number;
  headless: boolean;
  caseIds: CaseId[];
  maxWaitSeconds: number;
  settleMs: number;
};

type CapturedEvent = {
  id: number;
  observedAt: string;
  method: EventMethod;
  endpointKind: "create" | "update" | "list" | "detail";
  urlPath: string;
  endpointPattern: string;
  athleteId: number | null;
  workoutId: number | null;
  request: {
    headerKeys: string[];
    selectedHeaders: Record<string, string>;
    bodyTopLevelKeys: string[];
    bodyShape: unknown;
    bodyFieldSamples: Record<string, unknown>;
    structureShape: unknown;
    structureSamples: unknown;
    structureSerializedInfo: {
      isString: boolean;
      parseableJson: boolean | null;
      rawLength: number;
      rawStored: false;
      sourceType: "stringified-json" | "object" | "missing" | "string-non-json";
    };
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
    structureShape: unknown;
    structureSamples: unknown;
    parseNote: string | null;
    failedText: string | null;
  };
  signals: {
    titleMatched: boolean;
    descriptionMarkerMatched: boolean;
    stepMarkerMatched: boolean;
    structurePresent: boolean;
    targetMetricObserved: string | null;
    targetRangeObserved: string | null;
    repeatBlockObserved: boolean;
  };
};

type CaseRunState = {
  definition: CaseDefinition;
  startedAt: string;
  endedAt: string | null;
  waitReason: WaitReason | null;
  events: CapturedEvent[];
  detectedMutationEventId: number | null;
};

const CASES: CaseDefinition[] = [
  {
    id: "easy-pace",
    label: "A. Easy run by pace",
    titleMarker: "API STRUCTURE TEST EASY PACE DO NOT USE",
    descriptionMarker: "DESC_MARKER_EASY_PACE",
    stepNoteMarkers: ["STEP_NOTE_EASY_PACE"],
    targetMetricLabel: "Threshold Pace",
    targetMetricKey: "percentOfThresholdPace",
    expectRepeatBlock: false,
    expectedRange: { min: 75, max: 85 },
    fixtureFileName: "running-workout-structured-easy-pace.network-truth.fixture.json",
  },
  {
    id: "easy-hr",
    label: "B. Easy run by heart rate",
    titleMarker: "API STRUCTURE TEST EASY HR DO NOT USE",
    descriptionMarker: "DESC_MARKER_EASY_HR",
    stepNoteMarkers: ["STEP_NOTE_EASY_HR"],
    targetMetricLabel: "Threshold Heart Rate",
    targetMetricKey: "percentOfThresholdHr",
    expectRepeatBlock: false,
    expectedRange: { min: 70, max: 80 },
    fixtureFileName: "running-workout-structured-easy-hr.network-truth.fixture.json",
  },
  {
    id: "interval-pace",
    label: "C. Interval workout by pace",
    titleMarker: "API STRUCTURE TEST INTERVAL PACE DO NOT USE",
    descriptionMarker: "DESC_MARKER_INTERVAL_PACE",
    stepNoteMarkers: [
      "STEP_NOTE_WARMUP_PACE",
      "STEP_NOTE_WORK_PACE",
      "STEP_NOTE_RECOVERY_PACE",
      "STEP_NOTE_COOLDOWN_PACE",
    ],
    targetMetricLabel: "Threshold Pace",
    targetMetricKey: "percentOfThresholdPace",
    expectRepeatBlock: true,
    expectedRange: { min: 105, max: 115 },
    fixtureFileName: "running-workout-structured-interval-pace.network-truth.fixture.json",
  },
  {
    id: "interval-hr",
    label: "D. Interval workout by heart rate",
    titleMarker: "API STRUCTURE TEST INTERVAL HR DO NOT USE",
    descriptionMarker: "DESC_MARKER_INTERVAL_HR",
    stepNoteMarkers: [
      "STEP_NOTE_WARMUP_HR",
      "STEP_NOTE_WORK_HR",
      "STEP_NOTE_RECOVERY_HR",
      "STEP_NOTE_COOLDOWN_HR",
    ],
    targetMetricLabel: "Threshold Heart Rate",
    targetMetricKey: "percentOfThresholdHr",
    expectRepeatBlock: true,
    expectedRange: { min: 90, max: 95 },
    fixtureFileName: "running-workout-structured-interval-hr.network-truth.fixture.json",
  },
];

const CASES_BY_ID = new Map(CASES.map((entry) => [entry.id, entry]));

const repoRoot = path.resolve(toolRoot, "..", "..");
const fixturesDir = path.join(toolRoot, "scripts", "fixtures");
const reportsRoot = path.join(repoRoot, "reports", "tp-network-truth-capture", "structured-running-workouts");

function printHelp(): void {
  console.log("TrainingPeaks structured running workout network truth capture (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp-capture-structured-running-workout-network -- --case easy-pace");
  console.log("  npm run tp-capture-structured-running-workout-network -- --case easy-hr");
  console.log("  npm run tp-capture-structured-running-workout-network -- --case interval-pace");
  console.log("  npm run tp-capture-structured-running-workout-network -- --case interval-hr");
  console.log("  npm run tp-capture-structured-running-workout-network -- --case all");
  console.log("");
  console.log("Options:");
  console.log(`  --athlete-url=<url>       Athlete calendar URL (default: ${DEFAULT_ATHLETE_URL})`);
  console.log("  --case=<id>               easy-pace | easy-hr | interval-pace | interval-hr | all");
  console.log(`  --max-wait-seconds=<n>    Wait budget per case (default: ${DEFAULT_MAX_WAIT_SECONDS})`);
  console.log(`  --settle-ms=<n>           Extra wait after detected mutation (default: ${DEFAULT_SETTLE_MS})`);
  console.log("  --headless                Launch browser headless (default: headed)");
  console.log("  --headed                  Force headed browser mode");
  console.log("  --help                    Show this help");
  console.log("");
  console.log("Safety:");
  console.log("  - Script only observes network; it never clicks Save.");
  console.log("  - Script never replays POST/PUT requests.");
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

function parseCaseList(value: string): CaseId[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return CASES.map((entry) => entry.id);
  }
  const selected = normalized
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (selected.length === 0) {
    throw new Error("No valid --case value provided.");
  }
  const caseIds: CaseId[] = [];
  for (const caseId of selected) {
    if (!CASES_BY_ID.has(caseId as CaseId)) {
      throw new Error(`Unknown case id: ${caseId}`);
    }
    caseIds.push(caseId as CaseId);
  }
  return caseIds;
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value: string, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteUrl: DEFAULT_ATHLETE_URL,
    athleteId: DEFAULT_ATHLETE_ID,
    headless: false,
    caseIds: CASES.map((entry) => entry.id),
    maxWaitSeconds: DEFAULT_MAX_WAIT_SECONDS,
    settleMs: DEFAULT_SETTLE_MS,
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
    if (arg.startsWith("--case=")) {
      parsed.caseIds = parseCaseList(arg.slice("--case=".length));
      continue;
    }
    if (arg === "--case") {
      parsed.caseIds = parseCaseList(readRequiredNextArg(argv, index, "--case"));
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-wait-seconds=")) {
      parsed.maxWaitSeconds = parsePositiveInteger(arg.slice("--max-wait-seconds=".length), "--max-wait-seconds");
      continue;
    }
    if (arg === "--max-wait-seconds") {
      parsed.maxWaitSeconds = parsePositiveInteger(readRequiredNextArg(argv, index, "--max-wait-seconds"), "--max-wait-seconds");
      index += 1;
      continue;
    }
    if (arg.startsWith("--settle-ms=")) {
      parsed.settleMs = parsePositiveInteger(arg.slice("--settle-ms=".length), "--settle-ms");
      continue;
    }
    if (arg === "--settle-ms") {
      parsed.settleMs = parsePositiveInteger(readRequiredNextArg(argv, index, "--settle-ms"), "--settle-ms");
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

function looksLikeSafeMarker(text: string): boolean {
  const lowered = text.toLowerCase();
  return SAFE_TEXT_MARKERS.some((marker) => lowered.includes(marker));
}

function sanitizeUrlPath(inputUrl: string): string {
  const url = new URL(inputUrl);
  return url.pathname.replace(/\/+$/, "") || "/";
}

function buildEndpointPattern(pathname: string): string {
  return pathname
    .replace(/\/athletes\/\d+/gi, "/athletes/{athleteId}")
    .replace(/\/workouts\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}/gi, "/workouts/{from}/{to}")
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

  if (parentKey && isSensitiveHeaderKey(parentKey)) {
    return "[REDACTED]";
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed)) {
    return "[REDACTED_EMAIL]";
  }
  if (/bearer\s+[a-z0-9\-._~+/]+=*/i.test(trimmed)) {
    return "[REDACTED_TOKEN]";
  }
  if (/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/.test(trimmed)) {
    return "[REDACTED_JWT]";
  }
  if (looksLikeSafeMarker(trimmed)) {
    return trimmed.slice(0, STRING_SAMPLE_MAX);
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
  return isRecord(value) ? Object.keys(value).slice(0, 100) : [];
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
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      fields[key] = describeShape(item, depth + 1);
    }
    return {
      type: "object",
      keys: Object.keys(value).slice(0, 100),
      fields,
    };
  }
  return { type: typeof value };
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

function getObservedAt(request: Request): string {
  const startTime = request.timing().startTime;
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return new Date().toISOString();
  }
  return new Date(startTime).toISOString();
}

function collectStrings(value: unknown, bucket: string[], limit = EVENT_TEXT_SCAN_LIMIT): void {
  if (bucket.length >= limit) return;
  if (typeof value === "string") {
    bucket.push(value.toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (bucket.length >= limit) break;
      collectStrings(item, bucket, limit);
    }
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (bucket.length >= limit) break;
      bucket.push(key.toLowerCase());
      collectStrings(item, bucket, limit);
    }
  }
}

function includesAnyMarker(value: unknown, markers: string[]): boolean {
  if (!markers.length) return false;
  const lowered = markers.map((marker) => marker.toLowerCase());
  const strings: string[] = [];
  collectStrings(value, strings);
  return lowered.some((marker) => strings.some((entry) => entry.includes(marker)));
}

function detectRange(value: unknown, min: number, max: number): string | null {
  const text = JSON.stringify(value).toLowerCase();
  if (text.includes(`${min}`) && text.includes(`${max}`)) {
    return `${min}-${max}`;
  }
  return null;
}

function findStructureCandidate(value: unknown, depth = 0): unknown {
  if (depth > SHAPE_DEPTH_LIMIT) return null;
  if (isRecord(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "structure")) {
      return value.structure;
    }
    for (const nested of Object.values(value)) {
      const candidate = findStructureCandidate(nested, depth + 1);
      if (candidate !== null) return candidate;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findStructureCandidate(item, depth + 1);
      if (candidate !== null) return candidate;
    }
  }
  return null;
}

function pickFieldSamples(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const wantedKeys = [
    "athleteId",
    "workoutDay",
    "date",
    "workoutId",
    "title",
    "name",
    "workoutTypeValueId",
    "workoutSubTypeId",
    "description",
    "coachComments",
    "preActivityComments",
    "distancePlanned",
    "totalTimePlanned",
    "intensityFactorPlanned",
    "trainingStressScorePlanned",
    "structure",
  ];
  const out: Record<string, unknown> = {};
  for (const key of wantedKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out[key] = key === "structure" ? "[captured in structureSamples]" : redactUnknown(value[key], key);
    }
  }
  return out;
}

function pickStructureSamples(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((entry) => redactUnknown(entry));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 20)) {
      out[key] = redactUnknown(item, key);
    }
    return out;
  }
  return redactUnknown(value);
}

function mergeParseNotes(...notes: Array<string | null>): string | null {
  const filtered = notes.filter((note): note is string => typeof note === "string" && note.trim().length > 0);
  if (!filtered.length) return null;
  return filtered.join("; ");
}

function buildStructureSamplesWithParseStatus(
  parseStatus: "parsed" | "native" | "failed",
  value: unknown,
  reason?: string,
): unknown {
  if (parseStatus === "failed") {
    return {
      parseStatus,
      reason: reason ?? "failed to parse request structure string",
    };
  }
  const sample = pickStructureSamples(value);
  if (isRecord(sample)) {
    return {
      parseStatus,
      ...sample,
    };
  }
  return {
    parseStatus,
    sample,
  };
}

function extractRequestStructure(inputValue: unknown): {
  structureForSignals: unknown;
  structureShape: unknown;
  structureSamples: unknown;
  structureSerializedInfo: {
    isString: boolean;
    parseableJson: boolean | null;
    rawLength: number;
    rawStored: false;
    sourceType: "stringified-json" | "object" | "missing" | "string-non-json";
  };
  parseNote: string | null;
} {
  const structureCandidate = findStructureCandidate(inputValue);
  if (structureCandidate === null || structureCandidate === undefined) {
    return {
      structureForSignals: null,
      structureShape: describeShape(null),
      structureSamples: null,
      structureSerializedInfo: {
        isString: false,
        parseableJson: null,
        rawLength: 0,
        rawStored: false,
        sourceType: "missing",
      },
      parseNote: null,
    };
  }

  if (typeof structureCandidate === "string") {
    const rawLength = structureCandidate.length;
    try {
      const parsed = JSON.parse(structureCandidate);
      const sanitizedParsed = redactUnknown(parsed);
      return {
        structureForSignals: sanitizedParsed,
        structureShape: describeShape(sanitizedParsed),
        structureSamples: buildStructureSamplesWithParseStatus("parsed", sanitizedParsed),
        structureSerializedInfo: {
          isString: true,
          parseableJson: true,
          rawLength,
          rawStored: false,
          sourceType: "stringified-json",
        },
        parseNote: "request.structure parsed from JSON string",
      };
    } catch (error) {
      const reason = `request.structure parse failed: ${(error as Error).message}`;
      return {
        structureForSignals: null,
        structureShape: describeShape(null),
        structureSamples: buildStructureSamplesWithParseStatus("failed", null, reason),
        structureSerializedInfo: {
          isString: true,
          parseableJson: false,
          rawLength,
          rawStored: false,
          sourceType: "string-non-json",
        },
        parseNote: reason,
      };
    }
  }

  const sanitized = redactUnknown(structureCandidate);
  return {
    structureForSignals: sanitized,
    structureShape: describeShape(sanitized),
    structureSamples: buildStructureSamplesWithParseStatus("native", sanitized),
    structureSerializedInfo: {
      isString: false,
      parseableJson: null,
      rawLength: 0,
      rawStored: false,
      sourceType: "object",
    },
    parseNote: null,
  };
}

function findFieldValue(value: unknown, fieldName: string, depth = 0): unknown {
  if (depth > SHAPE_DEPTH_LIMIT) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFieldValue(item, fieldName, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, fieldName)) {
    return value[fieldName];
  }
  for (const nested of Object.values(value)) {
    const found = findFieldValue(nested, fieldName, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function extractPrimaryIntensityMetric(value: unknown): string | null {
  const direct = findFieldValue(value, "primaryIntensityMetric");
  return typeof direct === "string" && direct.trim().length > 0 ? direct.trim() : null;
}

function detectStructuredRange(value: unknown, min: number, max: number): string | null {
  const structure = findStructureCandidate(value);
  if (structure === null || structure === undefined) {
    return null;
  }
  const text = JSON.stringify(structure).toLowerCase();
  if (text.includes(`"minvalue":${min}`) && text.includes(`"maxvalue":${max}`)) {
    return `${min}-${max}`;
  }
  return detectRange(structure, min, max);
}

function hasRepetitionBlock(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasRepetitionBlock(entry));
  }
  if (!isRecord(value)) return false;
  if (value.type === "repetition") {
    return true;
  }
  return Object.values(value).some((nested) => hasRepetitionBlock(nested));
}

function collectStructureNotes(value: unknown, bucket: string[], limit = 200): void {
  if (bucket.length >= limit) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (bucket.length >= limit) break;
      collectStructureNotes(item, bucket, limit);
    }
    return;
  }
  if (!isRecord(value)) return;
  const noteValue = value.notes;
  if (typeof noteValue === "string" && noteValue.trim().length > 0) {
    bucket.push(noteValue.trim());
  }
  for (const nested of Object.values(value)) {
    if (bucket.length >= limit) break;
    collectStructureNotes(nested, bucket, limit);
  }
}

function evaluateStepNoteMarkers(markers: string[], structureSource: unknown): {
  expected: string[];
  observed: string[];
  missing: string[];
} {
  const notes: string[] = [];
  collectStructureNotes(structureSource, notes);
  const loweredNotes = notes.map((entry) => entry.toLowerCase());
  const expected = [...markers];
  const observed = expected.filter((marker) => loweredNotes.some((note) => note.includes(marker.toLowerCase())));
  const missing = expected.filter((marker) => !observed.includes(marker));
  return { expected, observed, missing };
}

function countRepetitionBlocks(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((acc, entry) => acc + countRepetitionBlocks(entry), 0);
  }
  if (!isRecord(value)) return 0;
  const current = value.type === "repetition" ? 1 : 0;
  return current + Object.values(value).reduce((acc, nested) => acc + countRepetitionBlocks(nested), 0);
}

function findFirstRepetitionCount(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findFirstRepetitionCount(entry);
      if (nested !== null) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "repetition" && isRecord(value.length) && typeof value.length.value === "number") {
    return value.length.value;
  }
  for (const nested of Object.values(value)) {
    const found = findFirstRepetitionCount(nested);
    if (found !== null) return found;
  }
  return null;
}

function parseRelevantEndpoint(inputUrl: string): {
  methodPath: string;
  endpointKind: "create" | "update" | "list" | "detail";
  athleteId: number;
  workoutId: number | null;
} | null {
  const url = new URL(inputUrl);
  if (url.origin !== TP_API_HOST) {
    return null;
  }
  const pathname = sanitizeUrlPath(inputUrl);
  let match = pathname.match(/^\/fitness\/v6\/athletes\/(\d+)\/workouts$/i);
  if (match) {
    return {
      methodPath: pathname,
      endpointKind: "create",
      athleteId: Number(match[1]),
      workoutId: null,
    };
  }
  match = pathname.match(/^\/fitness\/v6\/athletes\/(\d+)\/workouts\/(\d+)$/i);
  if (match) {
    return {
      methodPath: pathname,
      endpointKind: "update",
      athleteId: Number(match[1]),
      workoutId: Number(match[2]),
    };
  }
  match = pathname.match(/^\/fitness\/v6\/athletes\/(\d+)\/workouts\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/i);
  if (match) {
    return {
      methodPath: pathname,
      endpointKind: "list",
      athleteId: Number(match[1]),
      workoutId: null,
    };
  }
  return null;
}

function isRelevantMethod(method: string): method is EventMethod {
  return method === "POST" || method === "PUT" || method === "GET";
}

async function buildCapturedEvent(input: {
  id: number;
  request: Request;
  response: Response | null;
  failedText: string | null;
  definition: CaseDefinition;
}): Promise<CapturedEvent | null> {
  const method = input.request.method().toUpperCase();
  if (!isRelevantMethod(method)) {
    return null;
  }
  const endpoint = parseRelevantEndpoint(input.request.url());
  if (!endpoint) {
    return null;
  }
  const requestHeaders = input.request.headers();
  const rawRequestBody = input.request.postData() ?? "";
  const parsedRequest = rawRequestBody ? parsePossiblyJson(rawRequestBody) : { value: null, note: null };
  const redactedRequestBody = redactUnknown(parsedRequest.value);
  const requestStructureData = extractRequestStructure(parsedRequest.value);
  const requestStructure = requestStructureData.structureForSignals;

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

  const responseStructure = findStructureCandidate(responseBody);
  const targetMetricObserved =
    extractPrimaryIntensityMetric(responseStructure) ?? extractPrimaryIntensityMetric(responseBody) ?? extractPrimaryIntensityMetric(requestStructure);
  const targetRangeObserved =
    detectStructuredRange(responseStructure, input.definition.expectedRange.min, input.definition.expectedRange.max) ??
    detectStructuredRange(responseBody, input.definition.expectedRange.min, input.definition.expectedRange.max) ??
    detectStructuredRange(requestStructure, input.definition.expectedRange.min, input.definition.expectedRange.max) ??
    detectRange(responseBody, input.definition.expectedRange.min, input.definition.expectedRange.max) ??
    detectRange(redactedRequestBody, input.definition.expectedRange.min, input.definition.expectedRange.max);
  const structurePresent = requestStructure !== null || responseStructure !== null;
  const repeatBlockObserved = hasRepetitionBlock(responseStructure) || hasRepetitionBlock(responseBody) || hasRepetitionBlock(requestStructure);

  const titleMatched = includesAnyMarker(redactedRequestBody, [input.definition.titleMarker]) || includesAnyMarker(responseBody, [input.definition.titleMarker]);
  const descriptionMarkerMatched =
    includesAnyMarker(redactedRequestBody, [input.definition.descriptionMarker]) ||
    includesAnyMarker(responseBody, [input.definition.descriptionMarker]);
  const stepMarkerMatched =
    includesAnyMarker(requestStructure, input.definition.stepNoteMarkers) ||
    includesAnyMarker(responseStructure, input.definition.stepNoteMarkers) ||
    includesAnyMarker(responseBody, input.definition.stepNoteMarkers);
  const responseWorkoutId = toPositiveNumber(findFieldValue(responseBody, "workoutId"));

  return {
    id: input.id,
    observedAt: getObservedAt(input.request),
    method,
    endpointKind: endpoint.endpointKind,
    urlPath: endpoint.methodPath,
    endpointPattern: buildEndpointPattern(endpoint.methodPath),
    athleteId: endpoint.athleteId,
    workoutId: endpoint.workoutId ?? responseWorkoutId,
    request: {
      headerKeys: Object.keys(requestHeaders).filter((key) => !isSensitiveHeaderKey(key)).sort(),
      selectedHeaders: selectHeaders(requestHeaders),
      bodyTopLevelKeys: collectTopLevelKeys(redactedRequestBody),
      bodyShape: describeShape(redactedRequestBody),
      bodyFieldSamples: pickFieldSamples(redactedRequestBody),
      structureShape: requestStructureData.structureShape,
      structureSamples: requestStructureData.structureSamples,
      structureSerializedInfo: requestStructureData.structureSerializedInfo,
      parseNote: mergeParseNotes(parsedRequest.note, requestStructureData.parseNote),
    },
    response: {
      status: responseStatus,
      ok: responseOk,
      headerKeys: Object.keys(responseHeaders).filter((key) => !isSensitiveHeaderKey(key)).sort(),
      selectedHeaders: selectHeaders(responseHeaders),
      bodyTopLevelKeys: collectTopLevelKeys(responseBody),
      bodyShape: describeShape(responseBody),
      bodyFieldSamples: pickFieldSamples(responseBody),
      structureShape: describeShape(responseStructure),
      structureSamples: pickStructureSamples(responseStructure),
      parseNote: responseParseNote,
      failedText: input.failedText,
    },
    signals: {
      titleMatched,
      descriptionMarkerMatched,
      stepMarkerMatched,
      structurePresent,
      targetMetricObserved,
      targetRangeObserved,
      repeatBlockObserved,
    },
  };
}

function scoreCandidate(event: CapturedEvent): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (event.method === "POST") {
    score += 10;
    reasons.push("POST create endpoint");
  }
  if (event.method === "PUT") {
    score += 8;
    reasons.push("PUT update endpoint");
  }
  if (event.signals.titleMatched) {
    score += 10;
    reasons.push("title marker matched");
  }
  if (event.signals.descriptionMarkerMatched) {
    score += 5;
    reasons.push("description marker matched");
  }
  if (event.signals.stepMarkerMatched) {
    score += 5;
    reasons.push("step note marker matched");
  }
  if (event.signals.structurePresent) {
    score += 6;
    reasons.push("structure present");
  }
  if (event.signals.targetMetricObserved) {
    score += 4;
    reasons.push(`target metric observed (${event.signals.targetMetricObserved})`);
  }
  if (event.signals.targetRangeObserved) {
    score += 4;
    reasons.push(`target range observed (${event.signals.targetRangeObserved})`);
  }
  if (event.signals.repeatBlockObserved) {
    score += 3;
    reasons.push("repeat block observed");
  }
  if (typeof event.response.status === "number" && event.response.status >= 200 && event.response.status < 300) {
    score += 3;
    reasons.push(`2xx response (${event.response.status})`);
  }
  return { score, reasons };
}

function chooseBestCandidate(events: CapturedEvent[]): { best: CapturedEvent | null; scores: Record<number, { score: number; reasons: string[] }> } {
  const scores: Record<number, { score: number; reasons: string[] }> = {};
  for (const event of events) {
    scores[event.id] = scoreCandidate(event);
  }
  const sorted = [...events].sort((a, b) => {
    const scoreDiff = (scores[b.id]?.score ?? 0) - (scores[a.id]?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const statusDiff = (b.response.status ?? -1) - (a.response.status ?? -1);
    if (statusDiff !== 0) return statusDiff;
    return a.id - b.id;
  });
  return { best: sorted[0] ?? null, scores };
}

function detectSecretsInObject(value: unknown): boolean {
  const text = JSON.stringify(value).toLowerCase();
  return (
    text.includes("authorization") ||
    text.includes("cookie") ||
    text.includes("bearer ") ||
    text.includes("session") ||
    text.includes("csrf") ||
    text.includes("jwt")
  );
}

function buildMappingNotes(input: {
  event: CapturedEvent | null;
  stepNotes: { expected: string[]; observed: string[]; missing: string[] };
}): Record<string, unknown> {
  const event = input.event;
  if (!event) {
    return {
      title: "not observed",
      description: "not observed",
      coachComments: "not observed",
      preActivityComments: "not observed",
      stepNotes: {
        expected: input.stepNotes.expected,
        observed: [],
        missing: input.stepNotes.expected,
        status: "candidate not observed",
      },
    };
  }
  const request = event.request.bodyFieldSamples;
  const stepStatus =
    input.stepNotes.missing.length === 0
      ? "all expected step note markers observed"
      : `missing ${input.stepNotes.missing.length} expected marker(s)`;
  return {
    title: Object.prototype.hasOwnProperty.call(request, "title") ? "request.title observed" : "not observed in request sample",
    description: Object.prototype.hasOwnProperty.call(request, "description")
      ? "request.description observed"
      : "not observed in request sample",
    coachComments: Object.prototype.hasOwnProperty.call(request, "coachComments")
      ? "request.coachComments observed"
      : "not observed in request sample",
    preActivityComments: Object.prototype.hasOwnProperty.call(request, "preActivityComments")
      ? "request.preActivityComments observed"
      : "not observed in request sample",
    stepNotes: {
      ...input.stepNotes,
      status: stepStatus,
    },
  };
}

function buildValidation(input: {
  definition: CaseDefinition;
  event: CapturedEvent | null;
  workoutIdObserved: number | null;
  targetMetricObserved: string | null;
  targetRangeObserved: string | null;
  repeatBlockObserved: boolean;
  stepNotes: { expected: string[]; observed: string[]; missing: string[] };
  secretsFound: boolean;
  requestStructureSamples: unknown;
}): {
  status: "valid" | "invalid" | "partial";
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedRange = `${input.definition.expectedRange.min}-${input.definition.expectedRange.max}`;

  if (!input.event) {
    errors.push("no candidate event selected");
  } else {
    if (input.event.response.status !== 200) {
      errors.push(`response status expected 200, got ${input.event.response.status ?? "null"}`);
    }
    if (!input.event.signals.titleMatched) {
      errors.push("title marker not observed");
    }
    if (!input.event.signals.descriptionMarkerMatched) {
      errors.push("description marker not observed");
    }
  }

  if (input.workoutIdObserved === null) {
    errors.push("workoutId not observed in response");
  }
  if (input.targetMetricObserved !== input.definition.targetMetricKey) {
    errors.push(
      `primaryIntensityMetric mismatch: expected ${input.definition.targetMetricKey}, got ${input.targetMetricObserved ?? "null"}`,
    );
  }
  if (input.targetRangeObserved !== expectedRange) {
    errors.push(`target range mismatch: expected ${expectedRange}, got ${input.targetRangeObserved ?? "null"}`);
  }
  if (input.definition.expectRepeatBlock && !input.repeatBlockObserved) {
    errors.push("expected repetition block was not observed");
  }
  if (!input.definition.expectRepeatBlock && input.repeatBlockObserved) {
    warnings.push("unexpected repetition block observed for non-interval case");
  }
  if (input.stepNotes.missing.length > 0) {
    errors.push(`missing step note markers: ${input.stepNotes.missing.join(", ")}`);
  }
  if (input.secretsFound) {
    errors.push("secretsFound flag is true");
  }

  const parseStatus = isRecord(input.requestStructureSamples) ? input.requestStructureSamples.parseStatus : null;
  if (parseStatus !== "parsed" && parseStatus !== "native") {
    warnings.push("request.structureSamples not parsed; fixture is response-truth only");
  }

  const status: "valid" | "invalid" | "partial" = errors.length > 0 ? "invalid" : warnings.length > 0 ? "partial" : "valid";
  return { status, errors, warnings };
}

function buildRequestStructureValidation(input: {
  definition: CaseDefinition;
  event: CapturedEvent | null;
  targetMetricObserved: string | null;
  targetRangeObserved: string | null;
  stepNotes: { expected: string[]; observed: string[]; missing: string[] };
  requestStructureSamples: unknown;
  requestStructureInfo: {
    isString: boolean;
    parseableJson: boolean | null;
    rawLength: number;
    rawStored: false;
    sourceType: "stringified-json" | "object" | "missing" | "string-non-json";
  } | null;
  secretsFound: boolean;
}): {
  status: "valid" | "invalid" | "partial";
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parseStatus = isRecord(input.requestStructureSamples) ? input.requestStructureSamples.parseStatus : null;

  if (!input.event) {
    errors.push("no candidate event selected");
  }
  if (!input.requestStructureSamples) {
    errors.push("request.structureSamples missing");
  }
  if (parseStatus !== "parsed" && parseStatus !== "native") {
    errors.push(`request.structure parse status invalid: ${String(parseStatus)}`);
  }
  if (input.requestStructureInfo?.sourceType === "string-non-json") {
    errors.push("request.structure string is not parseable JSON");
  }
  if (input.targetMetricObserved !== input.definition.targetMetricKey) {
    errors.push(
      `request primaryIntensityMetric mismatch: expected ${input.definition.targetMetricKey}, got ${input.targetMetricObserved ?? "null"}`,
    );
  }
  const expectedRange = `${input.definition.expectedRange.min}-${input.definition.expectedRange.max}`;
  if (input.targetRangeObserved !== expectedRange) {
    errors.push(`request target range mismatch: expected ${expectedRange}, got ${input.targetRangeObserved ?? "null"}`);
  }

  const repetitionObserved = countRepetitionBlocks(input.requestStructureSamples) > 0;
  if (input.definition.expectRepeatBlock && !repetitionObserved) {
    errors.push("expected repetition block in request structure was not observed");
  }
  if (!input.definition.expectRepeatBlock && repetitionObserved) {
    warnings.push("unexpected repetition block observed for non-interval request structure");
  }
  if (input.definition.expectRepeatBlock) {
    const repeatCount = findFirstRepetitionCount(input.requestStructureSamples);
    if (repeatCount === null) {
      errors.push("request repetition repeatCount not found");
    } else if (repeatCount !== 4) {
      errors.push(`request repetition repeatCount mismatch: expected 4, got ${repeatCount}`);
    }
  }

  if (input.stepNotes.missing.length > 0) {
    errors.push(`missing request step note markers: ${input.stepNotes.missing.join(", ")}`);
  }
  if (input.secretsFound) {
    errors.push("secretsFound flag is true");
  }
  if (input.requestStructureInfo?.isString && input.requestStructureInfo.rawLength <= 0) {
    errors.push("request structure rawLength must be > 0 for string source");
  }
  if (input.requestStructureInfo?.rawStored !== false) {
    errors.push("request structure rawStored must be false");
  }

  const status: "valid" | "invalid" | "partial" = errors.length > 0 ? "invalid" : warnings.length > 0 ? "partial" : "valid";
  return { status, errors, warnings };
}

async function waitForCaseCapture(state: {
  caseRun: CaseRunState;
  maxWaitSeconds: number;
  settleMs: number;
  onCheck: () => number | null;
}): Promise<WaitReason> {
  const startedMs = Date.now();
  const timeoutMs = state.maxWaitSeconds * 1000;
  const rl = createInterface({ input, output });
  let settleAnchor: number | null = null;

  const autoPromise = new Promise<WaitReason>((resolve) => {
    const timer = setInterval(() => {
      const detectedEventId = state.onCheck();
      const now = Date.now();
      if (detectedEventId !== null) {
        if (!settleAnchor) {
          settleAnchor = now;
        }
        if (now - settleAnchor >= state.settleMs) {
          clearInterval(timer);
          resolve("auto_detected");
          return;
        }
      }
      if (now - startedMs >= timeoutMs) {
        clearInterval(timer);
        resolve("timeout");
      }
    }, 300);
  });

  const manualPromise = rl
    .question("Optional: press Enter to finish this case early.\n")
    .then(() => "manual_enter" as const)
    .catch(() => "timeout" as const);

  const reason = await Promise.race([autoPromise, manualPromise]);
  rl.close();
  return reason;
}

function buildRunSummaryMarkdown(input: {
  athleteId: number;
  athleteUrl: string;
  runDirRelative: string;
  caseResults: Array<{
    caseId: CaseId;
    waitReason: WaitReason | null;
    eventCount: number;
    bestEventId: number | null;
    status: number | null;
    structurePresent: boolean;
    targetMetricObserved: string | null;
    targetRangeObserved: string | null;
    repeatBlockObserved: boolean;
    fixturePathRelative: string;
  }>;
  networkEventsPathRelative: string;
}): string {
  const lines = [
    "# Structured Running Workout Network Truth Capture",
    "",
    `- athlete_id: \`${input.athleteId}\``,
    `- athlete_url: \`${input.athleteUrl}\``,
    `- run_dir: \`${input.runDirRelative}\``,
    `- network_events: \`${input.networkEventsPathRelative}\``,
    "",
    "## Cases",
  ];

  for (const caseResult of input.caseResults) {
    lines.push(`- case: \`${caseResult.caseId}\``);
    lines.push(`  - wait_reason: \`${caseResult.waitReason ?? "n/a"}\``);
    lines.push(`  - event_count: \`${caseResult.eventCount}\``);
    lines.push(`  - best_event_id: \`${caseResult.bestEventId ?? "none"}\``);
    lines.push(`  - status: \`${caseResult.status ?? "unknown"}\``);
    lines.push(`  - structure_present: **${caseResult.structurePresent ? "yes" : "no"}**`);
    lines.push(`  - target_metric_observed: \`${caseResult.targetMetricObserved ?? "no"}\``);
    lines.push(`  - target_range_observed: \`${caseResult.targetRangeObserved ?? "no"}\``);
    lines.push(`  - repeat_block_observed: **${caseResult.repeatBlockObserved ? "yes" : "no"}**`);
    lines.push(`  - fixture: \`${caseResult.fixturePathRelative}\``);
  }

  lines.push("");
  lines.push("## Safety");
  lines.push("- Manual attended capture only.");
  lines.push("- Script did not click Save and did not replay requests.");
  lines.push("- Authorization/Cookie/session-like material was redacted and not stored.");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runTimestamp = timestampForPath(new Date());
  const runDir = path.join(reportsRoot, runTimestamp);
  const casesDir = path.join(runDir, "cases");
  const networkEventsPath = path.join(runDir, "network-events.json");
  const summaryPath = path.join(runDir, "RUN_SUMMARY.md");

  await mkdir(profileDir, { recursive: true });
  await mkdir(fixturesDir, { recursive: true });
  await mkdir(runDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });

  const selectedCases = args.caseIds.map((caseId) => {
    const definition = CASES_BY_ID.get(caseId);
    if (!definition) {
      throw new Error(`Case not found: ${caseId}`);
    }
    return definition;
  });

  console.log("[tp-capture-structured-running-workout-network] mode: read-only attended capture");
  console.log(`[tp-capture-structured-running-workout-network] athlete: ${args.athleteUrl}`);
  console.log(`[tp-capture-structured-running-workout-network] profile: ${profileDir}`);
  console.log(`[tp-capture-structured-running-workout-network] run dir: ${runDir}`);
  console.log(`[tp-capture-structured-running-workout-network] cases: ${selectedCases.map((entry) => entry.id).join(", ")}`);
  console.log("");
  console.log("Capture mode: structured running workout network truth.");
  console.log("");
  console.log(`Create TEST workouts manually for athlete ${args.athleteId}:`);
  for (const definition of selectedCases) {
    console.log(`${definition.label}`);
    console.log(`- title: ${definition.titleMarker}`);
    console.log(`- description marker: ${definition.descriptionMarker}`);
    console.log(`- step note markers: ${definition.stepNoteMarkers.join(", ")}`);
  }
  console.log("");
  console.log("After each Save, wait until the script confirms case capture.");
  console.log("Do not use real athletes.");
  console.log("Do not add custom fields outside the requested structure.");
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  let activeCase: CaseRunState | null = null;
  const allEvents: CapturedEvent[] = [];
  let eventId = 1;

  const recordEvent = (event: CapturedEvent): void => {
    allEvents.push(event);
    if (activeCase && event.athleteId === args.athleteId) {
      activeCase.events.push(event);
    }
  };

  const handleRequestEvent = async (request: Request, response: Response | null, failedText: string | null): Promise<void> => {
    if (!activeCase) {
      return;
    }
    const event = await buildCapturedEvent({
      id: eventId++,
      request,
      response,
      failedText,
      definition: activeCase.definition,
    });
    if (!event) {
      return;
    }
    recordEvent(event);
    if (
      event.athleteId === args.athleteId &&
      (event.method === "POST" || event.method === "PUT") &&
      event.signals.titleMatched &&
      activeCase.detectedMutationEventId === null
    ) {
      activeCase.detectedMutationEventId = event.id;
      console.log(
        `[tp-capture-structured-running-workout-network] case=${activeCase.definition.id} detected candidate event #${event.id} (${event.method} ${event.urlPath})`,
      );
    }
  };

  context.on("requestfinished", async (request) => {
    await handleRequestEvent(request, await request.response(), null);
  });

  context.on("requestfailed", async (request) => {
    await handleRequestEvent(request, null, request.failure()?.errorText ?? "request failed");
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    await page.waitForTimeout(1000);

    const caseResults: Array<{
      caseId: CaseId;
      waitReason: WaitReason | null;
      eventCount: number;
      bestEventId: number | null;
      status: number | null;
      structurePresent: boolean;
      targetMetricObserved: string | null;
      targetRangeObserved: string | null;
      repeatBlockObserved: boolean;
      fixturePath: string;
      fixturePathRelative: string;
    }> = [];

    for (const definition of selectedCases) {
      activeCase = {
        definition,
        startedAt: new Date().toISOString(),
        endedAt: null,
        waitReason: null,
        events: [],
        detectedMutationEventId: null,
      };
      console.log("");
      console.log(`[tp-capture-structured-running-workout-network] case start: ${definition.id}`);
      console.log(`- expected title: ${definition.titleMarker}`);
      console.log(`- expected description marker: ${definition.descriptionMarker}`);
      console.log(`- expected target metric: ${definition.targetMetricLabel}`);
      console.log(
        `- expected target range: ${definition.expectedRange.min}-${definition.expectedRange.max} (% threshold scale in UI settings)`,
      );

      const waitReason = await waitForCaseCapture({
        caseRun: activeCase,
        maxWaitSeconds: args.maxWaitSeconds,
        settleMs: args.settleMs,
        onCheck: () => activeCase?.detectedMutationEventId ?? null,
      });
      activeCase.waitReason = waitReason;
      activeCase.endedAt = new Date().toISOString();

      const { best, scores } = chooseBestCandidate(activeCase.events);
      const fixturePath = path.join(fixturesDir, definition.fixtureFileName);
      const invalidFixturePath = fixturePath.replace(".network-truth.fixture.json", ".invalid.network-truth.fixture.json");
      const fixturePathRelative = path.relative(repoRoot, fixturePath);
      const invalidFixturePathRelative = path.relative(repoRoot, invalidFixturePath);
      const caseArtifactPath = path.join(casesDir, `${definition.id}.json`);

      const endpointConfirmed =
        best?.endpointPattern === "/fitness/v6/athletes/{athleteId}/workouts" ||
        best?.endpointPattern === "/fitness/v6/athletes/{athleteId}/workouts/{workoutId}";
      const secretsFound = detectSecretsInObject({
        best,
        allCandidates: activeCase.events,
      });
      const responseBodyFieldWorkoutId = toPositiveNumber(best?.response.bodyFieldSamples.workoutId);
      const workoutIdObserved = responseBodyFieldWorkoutId ?? toPositiveNumber(findFieldValue(best?.response.structureSamples ?? null, "workoutId")) ?? best?.workoutId ?? null;
      const requestTargetMetricObserved = extractPrimaryIntensityMetric(best?.request.structureSamples ?? null);
      const requestTargetRangeObserved = detectStructuredRange(
        best?.request.structureSamples ?? null,
        definition.expectedRange.min,
        definition.expectedRange.max,
      );
      const targetMetricObserved =
        extractPrimaryIntensityMetric(best?.response.structureSamples ?? null) ??
        extractPrimaryIntensityMetric(best?.response.bodyFieldSamples ?? null) ??
        requestTargetMetricObserved ??
        best?.signals.targetMetricObserved ??
        null;
      const targetRangeObserved =
        detectStructuredRange(best?.response.structureSamples ?? null, definition.expectedRange.min, definition.expectedRange.max) ??
        detectStructuredRange(best?.response.bodyFieldSamples ?? null, definition.expectedRange.min, definition.expectedRange.max) ??
        requestTargetRangeObserved ??
        best?.signals.targetRangeObserved ??
        null;
      const repeatBlockObserved =
        hasRepetitionBlock(best?.response.structureSamples ?? null) ||
        hasRepetitionBlock(best?.response.bodyFieldSamples ?? null) ||
        best?.signals.repeatBlockObserved ||
        false;
      const requestStepNotes = evaluateStepNoteMarkers(definition.stepNoteMarkers, best?.request.structureSamples ?? null);
      const stepNotes = evaluateStepNoteMarkers(definition.stepNoteMarkers, best?.response.structureSamples ?? null);
      const mappingNotes = buildMappingNotes({ event: best, stepNotes });
      const validation = buildValidation({
        definition,
        event: best,
        workoutIdObserved,
        targetMetricObserved,
        targetRangeObserved,
        repeatBlockObserved,
        stepNotes,
        secretsFound,
        requestStructureSamples: best?.request.structureSamples ?? null,
      });
      const requestStructureValidation = buildRequestStructureValidation({
        definition,
        event: best,
        targetMetricObserved: requestTargetMetricObserved,
        targetRangeObserved: requestTargetRangeObserved,
        stepNotes: requestStepNotes,
        requestStructureSamples: best?.request.structureSamples ?? null,
        requestStructureInfo: best?.request.structureSerializedInfo ?? null,
        secretsFound,
      });

      const fixturePayload = {
        runAt: new Date().toISOString(),
        caseId: definition.id,
        operationGuess: "create_structured_running_workout",
        endpointConfirmed: Boolean(endpointConfirmed),
        method: best?.method ?? null,
        athleteId: args.athleteId,
        titleMarker: definition.titleMarker,
        descriptionMarker: definition.descriptionMarker,
        stepNoteMarkers: definition.stepNoteMarkers,
        waitReason,
        selectedCandidateId: best?.id ?? null,
        selectedCandidateScore: best ? scores[best.id]?.score ?? null : null,
        selectedCandidateReasons: best ? scores[best.id]?.reasons ?? [] : [],
        request: best
          ? {
              urlPath: best.urlPath,
              endpointPattern: best.endpointPattern,
              bodyTopLevelKeys: best.request.bodyTopLevelKeys,
              bodyFieldSamples: best.request.bodyFieldSamples,
              structureShape: best.request.structureShape,
              structureSamples: best.request.structureSamples,
              structureSerializedInfo: best.request.structureSerializedInfo,
            }
          : null,
        response: best
          ? {
              status: best.response.status,
              bodyFieldSamples: best.response.bodyFieldSamples,
              structureShape: best.response.structureShape,
              structureSamples: best.response.structureSamples,
            }
          : null,
        observations: {
          workoutId: workoutIdObserved,
          structurePresent: best?.signals.structurePresent ?? false,
          targetMetricObserved,
          targetRangeObserved,
          repeatBlockObserved,
        },
        mappingNotes,
        validation,
        requestStructureValidation,
        redaction: {
          secretsFound,
          note: "Sensitive auth headers and tokens are redacted before writing fixtures.",
        },
      };

      const caseArtifactPayload = {
        runAt: new Date().toISOString(),
        caseId: definition.id,
        startedAt: activeCase.startedAt,
        endedAt: activeCase.endedAt,
        waitReason,
        candidateCount: activeCase.events.length,
        selectedCandidateId: best?.id ?? null,
        candidates: activeCase.events.map((event) => ({
          id: event.id,
          method: event.method,
          urlPath: event.urlPath,
          endpointPattern: event.endpointPattern,
          status: event.response.status,
          workoutId: event.workoutId,
          score: scores[event.id]?.score ?? 0,
          reasons: scores[event.id]?.reasons ?? [],
          signals: event.signals,
        })),
      };

      const targetFixturePath = validation.status === "valid" ? fixturePath : invalidFixturePath;
      await writeFile(targetFixturePath, `${JSON.stringify(fixturePayload, null, 2)}\n`, "utf8");
      await writeFile(caseArtifactPath, `${JSON.stringify(caseArtifactPayload, null, 2)}\n`, "utf8");

      caseResults.push({
        caseId: definition.id,
        waitReason,
        eventCount: activeCase.events.length,
        bestEventId: best?.id ?? null,
        status: best?.response.status ?? null,
        structurePresent: best?.signals.structurePresent ?? false,
        targetMetricObserved,
        targetRangeObserved,
        repeatBlockObserved,
        fixturePath: targetFixturePath,
        fixturePathRelative: validation.status === "valid" ? fixturePathRelative : invalidFixturePathRelative,
      });

      console.log(`[tp-capture-structured-running-workout-network] case complete: ${definition.id}`);
      console.log(`- wait reason: ${waitReason}`);
      console.log(`- candidates captured: ${activeCase.events.length}`);
      console.log(`- selected candidate: ${best?.id ?? "none"}`);
      console.log(`- validation: ${validation.status}`);
      if (validation.errors.length) {
        console.log(`- validation errors: ${validation.errors.join(" | ")}`);
      }
      if (validation.warnings.length) {
        console.log(`- validation warnings: ${validation.warnings.join(" | ")}`);
      }
      console.log(`- fixture: ${targetFixturePath}`);
    }

    await writeFile(
      networkEventsPath,
      `${JSON.stringify(
        {
          runAt: new Date().toISOString(),
          athleteId: args.athleteId,
          athleteUrl: args.athleteUrl,
          caseIds: selectedCases.map((entry) => entry.id),
          eventCount: allEvents.length,
          events: allEvents,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summaryMarkdown = buildRunSummaryMarkdown({
      athleteId: args.athleteId,
      athleteUrl: args.athleteUrl,
      runDirRelative: path.relative(repoRoot, runDir),
      caseResults,
      networkEventsPathRelative: path.relative(repoRoot, networkEventsPath),
    });
    await writeFile(summaryPath, `${summaryMarkdown}\n`, "utf8");

    console.log("");
    console.log("[tp-capture-structured-running-workout-network] complete.");
    console.log(`- summary: ${summaryPath}`);
    console.log(`- network events: ${networkEventsPath}`);
    for (const result of caseResults) {
      console.log(`- case ${result.caseId}: ${result.fixturePath}`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-capture-structured-running-workout-network failed.");
  console.error(error);
  process.exit(1);
});
