import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, type Request, type Response } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth, performApiJsonRequest, redactUnknown } from "./lib/trainingpeaks-api-move.ts";
import {
  normalizeTrainingPeaksWorkoutItems,
  type TrainingPeaksWorkoutRaw,
} from "./lib/trainingpeaks-workout-normalization.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";
const ARTIFACTS_ROOT = path.join(toolRoot, "debug", "workouts-api-discovery");
const RESPONSE_BODY_MAX_CHARS = 80_000;
const LARGE_JSON_PARSE_MAX_CHARS = 2_000_000;
const SAMPLE_TEXT_MAX = 240;
const SAMPLE_ARRAY_MAX = 3;
const SAMPLE_OBJECT_KEYS_MAX = 20;
const WORKOUT_ITEM_SAMPLE_LIMIT = 3;
const WORKOUT_ITEM_SCAN_LIMIT = 10;
const NESTED_KEY_SUMMARY_LIMIT = 12;
const DISTINCT_WORKOUT_DAY_SAMPLE_LIMIT = 14;
const SEMANTIC_SAMPLE_ROWS_PER_GROUP = 10;
const STATUS_LIKE_KEY_PATTERN = /(completed|status|compliance|progress|done|result)/i;
const SAMPLE_TITLE_MAX = 120;
const SAMPLE_STATUS_TEXT_MAX = 80;

const CANDIDATE_PATTERN_MATCHERS: RegExp[] = [
  /workout/i,
  /workouts/i,
  /calendar/i,
  /day/i,
  /fitness\/v6/i,
  /athletes\/\d+/i,
];

const SENSITIVE_TEXT_KEYWORDS = [
  "note",
  "notes",
  "comment",
  "comments",
  "description",
  "coachcomments",
  "workoutcomments",
] as const;

type CliArgs = {
  athleteId: number | null;
  athleteUrl: string | null;
  from: string;
  to: string;
  headless: boolean;
};

type CapturedGetCandidate = {
  id: number;
  method: "GET";
  url: string;
  endpointPattern: string;
  status: number | null;
  ok: boolean | null;
  contentType: string | null;
  topLevelJsonType: string;
  topLevelKeys: string[];
  sampleSnippet: unknown;
  analysisBody: unknown;
  hasWorkoutIdField: boolean;
  hasWorkoutDateField: boolean;
  hasPlannedIndicator: boolean;
  hasCompletedIndicator: boolean;
  parseError: string | null;
  workoutsSchemaSample: WorkoutSchemaSample | null;
};

type IgnoredNonGetSummary = {
  totalIgnored: number;
  byMethod: Record<string, number>;
  topEndpointPatterns: Array<{ endpointPattern: string; count: number }>;
};

type ShapeEntry = {
  endpointPattern: string;
  urls: string[];
  hitCount: number;
  statuses: number[];
  topLevelJsonType: string;
  topLevelKeys: string[];
  itemTopLevelKeys: string[];
  sampleSnippet: unknown;
  hasWorkoutIdField: boolean;
  hasWorkoutDateField: boolean;
  hasPlannedIndicator: boolean;
  hasCompletedIndicator: boolean;
};

type FieldDetectionStatus = "confirmed" | "ambiguous" | "missing";

type CandidateFieldSet = {
  status: FieldDetectionStatus;
  hasField: boolean;
  candidates: string[];
};

type WorkoutFieldDetection = {
  hasWorkoutIdField: boolean;
  candidateWorkoutIdFields: string[];
  workoutIdFieldStatus: FieldDetectionStatus;
  hasDateField: boolean;
  candidateDateFields: string[];
  dateFieldStatus: FieldDetectionStatus;
  hasTitleField: boolean;
  candidateTitleFields: string[];
  titleFieldStatus: FieldDetectionStatus;
  hasSportOrTypeField: boolean;
  candidateSportOrTypeFields: string[];
  sportOrTypeFieldStatus: FieldDetectionStatus;
  hasPlannedDurationField: boolean;
  candidatePlannedDurationFields: string[];
  plannedDurationFieldStatus: FieldDetectionStatus;
  hasCompletedDurationField: boolean;
  candidateCompletedDurationFields: string[];
  completedDurationFieldStatus: FieldDetectionStatus;
  hasPlannedDistanceField: boolean;
  candidatePlannedDistanceFields: string[];
  plannedDistanceFieldStatus: FieldDetectionStatus;
  hasCompletedDistanceField: boolean;
  candidateCompletedDistanceFields: string[];
  completedDistanceFieldStatus: FieldDetectionStatus;
  hasExplicitCompletedFlag: boolean;
  candidateCompletedFlagFields: string[];
  completedFlagFieldStatus: FieldDetectionStatus;
};

type WorkoutSchemaSample = {
  endpointUrlPattern: string;
  method: "GET";
  responseStatus: number | null;
  topLevelJsonType: string;
  topLevelKeys: string[];
  arrayLength: number | null;
  detectedWorkoutItemPath: string | null;
  workoutItemCount: number;
  unionFirstLevelKeys: string[];
  sampleWorkoutItems: unknown[];
  fieldDetection: WorkoutFieldDetection;
  dateRangeSanity: WorkoutDateRangeSanity;
  normalizationContractSufficient: boolean;
  normalizationNotes: string[];
  parseError: string | null;
};

type DateRangeHonorStatus = boolean | "ambiguous";

type DistinctWorkoutDaySummary = {
  totalCount: number;
  sample: string[];
  truncated: boolean;
};

type PlannedIndicatorSummary = {
  totalTimePlannedGtZeroCount: number;
  distancePlannedGtZeroCount: number;
  eitherPlannedDurationOrDistanceCount: number;
};

type CompletedIndicatorSummary = {
  completedTrueCount: number;
  totalTimeGtZeroCount: number;
  distanceGtZeroCount: number;
};

type WorkoutDateRangeSanity = {
  requestedFrom: string;
  requestedTo: string;
  totalItems: number;
  detectedDateField: string | null;
  minWorkoutDay: string | null;
  maxWorkoutDay: string | null;
  distinctWorkoutDays: DistinctWorkoutDaySummary;
  itemsInsideRequestedRange: number;
  itemsBeforeRequestedRange: number;
  itemsAfterRequestedRange: number;
  itemsWithUnknownWorkoutDay: number;
  endpointHonorsRequestedRange: DateRangeHonorStatus;
  completedTrueCount: number;
  completedFalseCount: number;
  completedUnknownCount: number;
  plannedIndicatorSummary: PlannedIndicatorSummary;
  completedIndicatorSummary: CompletedIndicatorSummary;
};

type WorkoutSchemaArtifact = {
  found: boolean;
  endpointPattern: string | null;
  method: "GET" | null;
  responseStatus: number | null;
  topLevelJsonType: string | null;
  topLevelKeys: string[];
  arrayLength: number | null;
  detectedWorkoutItemPath: string | null;
  workoutItemCount: number;
  unionFirstLevelKeys: string[];
  sampleWorkoutItems: unknown[];
  fieldDetection: WorkoutFieldDetection | null;
  dateRangeSanity: WorkoutDateRangeSanity | null;
  normalizationContractSufficient: boolean;
  normalizationNotes: string[];
  artifactPath: string;
  parseError: string | null;
};

type CompletionStatusPrimitive = string | number | boolean | null;

type SemanticSampleRow = {
  workoutId: string | number | null;
  workoutDay: string | null;
  title: string | null;
  code: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  totalTimePlanned: number | null;
  totalTime: number | null;
  distancePlanned: number | null;
  distance: number | null;
  complianceDurationPercent: number | null;
  complianceDistancePercent: number | null;
  startTimePlanned: string | null;
  startTime: string | null;
  lastModifiedDate: string | null;
  orderOnDay: number | null;
  explicitStatusLikeFields: Record<string, CompletionStatusPrimitive>;
};

type SemanticSampleGroup = {
  count: number;
  rows: SemanticSampleRow[];
};

type FieldSemanticsHypothesis = {
  likelyPlannedDurationField: string | null;
  likelyCompletedDurationField: string | null;
  likelyPlannedDistanceField: string | null;
  likelyCompletedDistanceField: string | null;
  likelyCompletionIndicator: string | null;
  confidence: "high" | "medium" | "low";
  blockersForNormalization: string[];
};

type WorkoutSemanticSamplesArtifact = {
  found: boolean;
  endpointPattern: string | null;
  requestedFrom: string;
  requestedTo: string;
  totalWorkoutItems: number;
  sampleRowsPerGroup: number;
  plannedCandidates: SemanticSampleGroup;
  completedCandidates: SemanticSampleGroup;
  plannedButNotCompletedCandidates: SemanticSampleGroup;
  plannedAndCompletedCandidates: SemanticSampleGroup;
  recentWindowSamples: SemanticSampleGroup;
  futureSamples: SemanticSampleGroup;
  fieldSemanticsHypothesis: FieldSemanticsHypothesis;
  firstPassNormalizationContract: "safe" | "blocked";
  artifactPath: string;
};

type DirectGetValidationArtifact = {
  endpoint: string;
  method: "GET";
  statusCode: number | null;
  ok: boolean;
  requestedFrom: string;
  requestedTo: string;
  totalItems: number;
  detectedItemPath: string | null;
  minWorkoutDay: string | null;
  maxWorkoutDay: string | null;
  itemsInsideRequestedRange: number;
  itemsBeforeRequestedRange: number;
  itemsAfterRequestedRange: number;
  endpointHonorsRequestedRange: DateRangeHonorStatus;
  plannedCandidateCount: number;
  completedCandidateCount: number;
  plannedButNotCompletedCount: number;
  plannedAndCompletedCount: number;
  fieldSemanticsHypothesis: FieldSemanticsHypothesis;
  directGetSufficientForCache: boolean;
  blockers: string[];
};

type ScriptSummary = {
  athleteId: string;
  athleteUrl: string;
  from: string;
  to: string;
  getCandidateCount: number;
  endpointPatternsFound: string[];
  stableWorkoutIdField: boolean;
  stableWorkoutDateField: boolean;
  plannedIndicatorsFound: boolean;
  completedIndicatorsFound: boolean;
  workoutsEndpointFound: boolean;
  workoutItemPath: string | null;
  workoutItemCount: number;
  candidateIdFields: string[];
  candidateDateFields: string[];
  candidateTitleFields: string[];
  candidateCompletedFlagFields: string[];
  dateRangeSanity: WorkoutDateRangeSanity | null;
  normalizationContractSufficient: boolean;
  workoutsArtifactPath: string;
  semanticSamplesArtifactPath: string;
  semanticSampleCounts: {
    plannedCandidates: number;
    completedCandidates: number;
    plannedButNotCompletedCandidates: number;
    plannedAndCompletedCandidates: number;
    recentWindowSamples: number;
    futureSamples: number;
  };
  normalizedSampleCounts: {
    normalizedCount: number;
    droppedCount: number;
    warningCount: number;
    warningsSample: string[];
  };
  fieldSemanticsHypothesis: FieldSemanticsHypothesis;
  firstPassNormalizationContract: "safe" | "blocked";
  directGetValidation: DirectGetValidationArtifact;
  directGetValidationArtifactPath: string;
  artifactDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteId: null,
    athleteUrl: null,
    from: "",
    to: "",
    headless: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--athlete-id=")) {
      const value = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --athlete-id value "${arg}".`);
      }
      parsed.athleteId = value;
      continue;
    }
    if (arg.startsWith("--athlete-url=")) {
      const value = arg.slice("--athlete-url=".length).trim();
      if (!value) {
        throw new Error("Empty --athlete-url value.");
      }
      parsed.athleteUrl = value;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
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

  if (!parsed.athleteId && !parsed.athleteUrl) {
    throw new Error("Missing athlete input. Provide --athlete-id=<id> or --athlete-url=<url>.");
  }
  if (parsed.athleteId && parsed.athleteUrl) {
    throw new Error("Provide only one athlete input: --athlete-id or --athlete-url.");
  }
  if (!isIsoDate(parsed.from)) {
    throw new Error(`Invalid --from date "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!isIsoDate(parsed.to)) {
    throw new Error(`Invalid --to date "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }
  return parsed;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function athleteIdFromUrl(url: string): number | null {
  const match = url.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function buildAthleteCalendarUrl(args: CliArgs): string {
  if (args.athleteUrl) {
    return args.athleteUrl;
  }
  return `${APP_HOST}/#calendar/athletes/${args.athleteId}`;
}

function buildAthleteRangeUrl(athleteId: number, from: string, to: string): string {
  return `${APP_HOST}/#calendar/athletes/${athleteId}?startDate=${from}&endDate=${to}`;
}

function buildEndpointPattern(inputUrl: string): string {
  return inputUrl
    .replace(/\/athletes\/\d+/gi, "/athletes/{athleteId}")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "{date}")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi, "{dateTime}")
    .replace(/\b\d{10,}\b/g, "{id}");
}

function isCandidateUrl(url: string, athleteId: number | null): boolean {
  const urlLower = url.toLowerCase();
  if (!urlLower.startsWith(`${TP_API_HOST}/`)) return false;
  const hasKeyword = CANDIDATE_PATTERN_MATCHERS.some((pattern) => pattern.test(url));
  const athleteMatch = athleteId ? new RegExp(`/athletes/${athleteId}(?:\\b|/)`, "i").test(url) : false;
  return hasKeyword || athleteMatch;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return SENSITIVE_TEXT_KEYWORDS.some((token) => normalized.includes(token));
}

function topLevelJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return typeof value;
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return "[truncated-depth]";
  if (Array.isArray(value)) {
    return value.slice(0, SAMPLE_ARRAY_MAX).map((item) => summarizeValue(item, depth + 1));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, SAMPLE_OBJECT_KEYS_MAX)) {
      if (isSensitiveKey(key)) {
        out[key] = "[REDACTED_TEXT_FIELD]";
      } else {
        out[key] = summarizeValue(item, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > SAMPLE_TEXT_MAX ? `${value.slice(0, SAMPLE_TEXT_MAX)}...[truncated]` : value;
  }
  return value;
}

function collectTopLevelKeys(input: unknown): string[] {
  if (isRecord(input)) {
    return Object.keys(input).slice(0, 80);
  }
  return [];
}

function collectItemTopLevelKeys(input: unknown): string[] {
  const keys = new Set<string>();
  const list = Array.isArray(input) ? input : isRecord(input) ? Object.values(input).filter(Array.isArray) : [];
  for (const maybeArray of list) {
    if (!Array.isArray(maybeArray)) continue;
    for (const item of maybeArray.slice(0, 8)) {
      if (!isRecord(item)) continue;
      for (const key of Object.keys(item)) {
        keys.add(key);
      }
    }
  }
  return [...keys].slice(0, 120);
}

function shouldTryJsonParse(contentType: string, text: string): boolean {
  const trimmed = text.trim();
  return contentType.toLowerCase().includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isPrimaryWorkoutsEndpointPattern(endpointPattern: string): boolean {
  return /\/fitness\/v6\/athletes\/\{athleteId\}\/workouts\/\{date\}\/\{date\}$/i.test(endpointPattern);
}

function collectObjectKeysFromArrayItems(items: unknown[], limit = WORKOUT_ITEM_SCAN_LIMIT): string[] {
  const keys = new Set<string>();
  for (const item of items.slice(0, limit)) {
    if (!isRecord(item)) continue;
    for (const key of Object.keys(item)) {
      keys.add(key);
    }
  }
  return [...keys].slice(0, 200);
}

function summarizeNestedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const objectKeys = new Set<string>();
    const primitiveSample: Array<string | number | boolean | null> = [];
    for (const item of value.slice(0, SAMPLE_ARRAY_MAX)) {
      if (isRecord(item)) {
        for (const key of Object.keys(item).slice(0, NESTED_KEY_SUMMARY_LIMIT)) {
          objectKeys.add(key);
        }
      } else if (
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        if (typeof item === "string") {
          primitiveSample.push(item.length > SAMPLE_TEXT_MAX ? `${item.slice(0, SAMPLE_TEXT_MAX)}...[truncated]` : item);
        } else {
          primitiveSample.push(item);
        }
      }
    }
    return {
      _kind: "array-summary",
      length: value.length,
      objectKeys: [...objectKeys].slice(0, NESTED_KEY_SUMMARY_LIMIT),
      primitiveSample,
    };
  }

  if (isRecord(value)) {
    return {
      _kind: "object-summary",
      keys: Object.keys(value).slice(0, NESTED_KEY_SUMMARY_LIMIT),
      keyCount: Object.keys(value).length,
    };
  }

  if (typeof value === "string") {
    return value.length > SAMPLE_TEXT_MAX ? `${value.slice(0, SAMPLE_TEXT_MAX)}...[truncated]` : value;
  }

  return value;
}

function buildWorkoutItemSample(item: unknown): unknown {
  if (!isRecord(item)) {
    return summarizeNestedValue(item);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item).slice(0, 80)) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted-text]";
      continue;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "string"
    ) {
      out[key] = summarizeNestedValue(value);
      continue;
    }
    out[key] = summarizeNestedValue(value);
  }
  return out;
}

type WorkoutArrayCandidate = {
  path: string;
  arrayLength: number;
  items: unknown[];
  score: number;
};

function scoreWorkoutArrayCandidate(path: string, items: unknown[]): number {
  const keys = collectObjectKeysFromArrayItems(items, 5).map(normalizeKey);
  const lastPathPart = path === "root array" ? "root" : normalizeKey(path.split(".").at(-1) ?? "");
  let score = items.length > 0 ? 20 : 0;
  if (path === "root array") score += 6;
  if (lastPathPart === "workouts") score += 15;
  if (lastPathPart === "items") score += 11;
  if (lastPathPart === "data") score += 8;
  if (normalizeKey(path).includes("workout")) score += 12;
  if (keys.some((key) => key === "workoutid")) score += 15;
  if (keys.some((key) => key === "workoutday" || key === "date")) score += 12;
  if (keys.some((key) => key === "title" || key === "name")) score += 8;
  if (keys.some((key) => key.includes("planned"))) score += 4;
  if (keys.some((key) => key.includes("completed") || key.includes("actual"))) score += 4;
  return score;
}

function findWorkoutArrayCandidate(input: unknown): WorkoutArrayCandidate | null {
  const matches: WorkoutArrayCandidate[] = [];

  const visit = (node: unknown, pathParts: string[], depth: number): void => {
    if (depth > 4 || node === null) return;

    if (Array.isArray(node)) {
      const objectItems = node.filter((item) => isRecord(item));
      if (objectItems.length > 0) {
        const path = pathParts.length > 0 ? pathParts.join(".") : "root array";
        matches.push({
          path,
          arrayLength: node.length,
          items: objectItems,
          score: scoreWorkoutArrayCandidate(path, objectItems),
        });
      }
      return;
    }

    if (!isRecord(node)) return;

    for (const [key, value] of Object.entries(node)) {
      visit(value, [...pathParts, key], depth + 1);
    }
  };

  visit(input, [], 0);
  return matches.sort((a, b) => b.score - a.score || b.arrayLength - a.arrayLength)[0] ?? null;
}

type FieldDetector = {
  strong: (normalizedKey: string) => boolean;
  weak?: (normalizedKey: string) => boolean;
};

function detectFieldSet(keys: string[], detector: FieldDetector): CandidateFieldSet {
  const strongMatches = keys.filter((key) => detector.strong(normalizeKey(key)));
  const weakMatches = keys.filter((key) => !strongMatches.includes(key) && Boolean(detector.weak?.(normalizeKey(key))));
  const candidates = [...new Set([...strongMatches, ...weakMatches])].slice(0, 20);

  if (strongMatches.length === 1) {
    return {
      status: "confirmed",
      hasField: true,
      candidates,
    };
  }
  if (strongMatches.length > 1 || candidates.length > 0) {
    return {
      status: "ambiguous",
      hasField: candidates.length > 0,
      candidates,
    };
  }
  return {
    status: "missing",
    hasField: false,
    candidates: [],
  };
}

function buildWorkoutFieldDetection(keys: string[]): WorkoutFieldDetection {
  const workoutId = detectFieldSet(keys, {
    strong: (key) => key === "workoutid" || key === "id",
    weak: (key) => key.endsWith("id") || key.includes("workoutid"),
  });
  const dateField = detectFieldSet(keys, {
    strong: (key) => key === "workoutday" || key === "date" || key === "startdate",
    weak: (key) => key.includes("date") || key.endsWith("day") || key.endsWith("time"),
  });
  const titleField = detectFieldSet(keys, {
    strong: (key) => key === "title" || key === "name" || key === "workoutname",
    weak: (key) => key.includes("title") || key.endsWith("name"),
  });
  const sportOrTypeField = detectFieldSet(keys, {
    strong: (key) =>
      key === "sporttype" ||
      key === "sport" ||
      key === "type" ||
      key === "workouttype" ||
      key === "workouttypevalueid" ||
      key === "workoutsubtypeid",
    weak: (key) => key.includes("sport") || key.includes("type") || key.includes("discipline") || key.includes("code"),
  });
  const plannedDurationField = detectFieldSet(keys, {
    strong: (key) => key === "totaltimeplanned" || key === "plannedduration" || key === "durationplanned",
    weak: (key) => key.includes("planned") && (key.includes("duration") || key.includes("time")),
  });
  const completedDurationField = detectFieldSet(keys, {
    strong: (key) => key === "totaltime" || key === "duration" || key === "actualduration",
    weak: (key) =>
      !key.includes("planned") && (key.includes("duration") || key.includes("time") || key.includes("elapsed")),
  });
  const plannedDistanceField = detectFieldSet(keys, {
    strong: (key) => key === "distanceplanned" || key === "planneddistance",
    weak: (key) => key.includes("planned") && key.includes("distance"),
  });
  const completedDistanceField = detectFieldSet(keys, {
    strong: (key) => key === "distance" || key === "actualdistance" || key === "completeddistance",
    weak: (key) => !key.includes("planned") && key.includes("distance"),
  });
  const completedFlagField = detectFieldSet(keys, {
    strong: (key) => key === "completed" || key === "iscompleted",
    weak: (key) => key.includes("completed") || key === "status" || key === "completionstatus",
  });

  return {
    hasWorkoutIdField: workoutId.hasField,
    candidateWorkoutIdFields: workoutId.candidates,
    workoutIdFieldStatus: workoutId.status,
    hasDateField: dateField.hasField,
    candidateDateFields: dateField.candidates,
    dateFieldStatus: dateField.status,
    hasTitleField: titleField.hasField,
    candidateTitleFields: titleField.candidates,
    titleFieldStatus: titleField.status,
    hasSportOrTypeField: sportOrTypeField.hasField,
    candidateSportOrTypeFields: sportOrTypeField.candidates,
    sportOrTypeFieldStatus: sportOrTypeField.status,
    hasPlannedDurationField: plannedDurationField.hasField,
    candidatePlannedDurationFields: plannedDurationField.candidates,
    plannedDurationFieldStatus: plannedDurationField.status,
    hasCompletedDurationField: completedDurationField.hasField,
    candidateCompletedDurationFields: completedDurationField.candidates,
    completedDurationFieldStatus: completedDurationField.status,
    hasPlannedDistanceField: plannedDistanceField.hasField,
    candidatePlannedDistanceFields: plannedDistanceField.candidates,
    plannedDistanceFieldStatus: plannedDistanceField.status,
    hasCompletedDistanceField: completedDistanceField.hasField,
    candidateCompletedDistanceFields: completedDistanceField.candidates,
    completedDistanceFieldStatus: completedDistanceField.status,
    hasExplicitCompletedFlag: completedFlagField.hasField,
    candidateCompletedFlagFields: completedFlagField.candidates,
    completedFlagFieldStatus: completedFlagField.status,
  };
}

function readPositiveNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPrimitiveStatusValue(value: unknown): CompletionStatusPrimitive | null {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > SAMPLE_STATUS_TEXT_MAX ? `${trimmed.slice(0, SAMPLE_STATUS_TEXT_MAX)}...[truncated]` : trimmed;
  }
  return null;
}

function toSampleText(value: unknown, maxLength = SAMPLE_STATUS_TEXT_MAX): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...[truncated]` : trimmed;
}

function parseIsoDateUtc(value: string): Date | null {
  if (!isIsoDate(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addUtcDays(date: Date, delta: number): Date {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + delta);
  return out;
}

function pickLikelyCandidateField(candidates: string[], preferred: string[]): string | null {
  if (candidates.length === 0) return null;
  const preferredNormalized = preferred.map((value) => normalizeKey(value));
  for (const preferredKey of preferredNormalized) {
    const hit = candidates.find((candidate) => normalizeKey(candidate) === preferredKey);
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

function pickStatusLikeFields(record: Record<string, unknown>): Record<string, CompletionStatusPrimitive> {
  const out: Record<string, CompletionStatusPrimitive> = {};
  const reservedKeys = new Set(
    [
      "workoutId",
      "workoutDay",
      "title",
      "code",
      "workoutTypeValueId",
      "workoutSubTypeId",
      "totalTimePlanned",
      "totalTime",
      "distancePlanned",
      "distance",
      "complianceDurationPercent",
      "complianceDistancePercent",
      "startTimePlanned",
      "startTime",
      "lastModifiedDate",
      "orderOnDay",
    ].map((value) => normalizeKey(value)),
  );

  for (const [key, value] of Object.entries(record)) {
    if (reservedKeys.has(normalizeKey(key))) continue;
    if (isSensitiveKey(key)) continue;
    if (!STATUS_LIKE_KEY_PATTERN.test(key)) continue;
    const primitive = readPrimitiveStatusValue(value);
    if (primitive !== null) {
      out[key] = primitive;
    }
  }

  return out;
}

function buildSemanticSampleRow(record: Record<string, unknown>, detectedDateField: string | null): SemanticSampleRow {
  const workoutDayRaw =
    (detectedDateField ? getRecordValueByCandidateKey(record, detectedDateField) : null) ??
    getRecordValueByCandidateKey(record, "workoutDay") ??
    getRecordValueByCandidateKey(record, "date") ??
    getRecordValueByCandidateKey(record, "startDate");

  return {
    workoutId:
      readPrimitiveStatusValue(getRecordValueByCandidateKey(record, "workoutId")) ??
      readPrimitiveStatusValue(getRecordValueByCandidateKey(record, "id")),
    workoutDay: extractIsoDatePart(workoutDayRaw),
    title: toSampleText(getRecordValueByCandidateKey(record, "title"), SAMPLE_TITLE_MAX),
    code: toSampleText(getRecordValueByCandidateKey(record, "code"), SAMPLE_STATUS_TEXT_MAX),
    workoutTypeValueId: readPositiveNumber(getRecordValueByCandidateKey(record, "workoutTypeValueId")),
    workoutSubTypeId: readPositiveNumber(getRecordValueByCandidateKey(record, "workoutSubTypeId")),
    totalTimePlanned: readPositiveNumber(getRecordValueByCandidateKey(record, "totalTimePlanned")),
    totalTime: readPositiveNumber(getRecordValueByCandidateKey(record, "totalTime")),
    distancePlanned: readPositiveNumber(getRecordValueByCandidateKey(record, "distancePlanned")),
    distance: readPositiveNumber(getRecordValueByCandidateKey(record, "distance")),
    complianceDurationPercent: readPositiveNumber(getRecordValueByCandidateKey(record, "complianceDurationPercent")),
    complianceDistancePercent: readPositiveNumber(getRecordValueByCandidateKey(record, "complianceDistancePercent")),
    startTimePlanned: toSampleText(getRecordValueByCandidateKey(record, "startTimePlanned"), SAMPLE_STATUS_TEXT_MAX),
    startTime: toSampleText(getRecordValueByCandidateKey(record, "startTime"), SAMPLE_STATUS_TEXT_MAX),
    lastModifiedDate: toSampleText(getRecordValueByCandidateKey(record, "lastModifiedDate"), SAMPLE_STATUS_TEXT_MAX),
    orderOnDay: readPositiveNumber(getRecordValueByCandidateKey(record, "orderOnDay")),
    explicitStatusLikeFields: pickStatusLikeFields(record),
  };
}

function buildSemanticSamplesArtifact(input: {
  endpointPattern: string | null;
  requestedFrom: string;
  requestedTo: string;
  workoutItems: unknown[];
  fieldDetection: WorkoutFieldDetection | null;
  dateRangeSanity: WorkoutDateRangeSanity | null;
  normalizationContractSufficient: boolean;
  artifactPath: string;
}): WorkoutSemanticSamplesArtifact {
  const items = input.workoutItems.filter((item): item is Record<string, unknown> => isRecord(item));
  const detectedDateField = input.dateRangeSanity?.detectedDateField ?? null;
  const requestedToDate = parseIsoDateUtc(input.requestedTo);
  const recentWindowStart = requestedToDate ? addUtcDays(requestedToDate, -13) : null;

  const plannedCandidatesAll: SemanticSampleRow[] = [];
  const completedCandidatesAll: SemanticSampleRow[] = [];
  const plannedButNotCompletedAll: SemanticSampleRow[] = [];
  const plannedAndCompletedAll: SemanticSampleRow[] = [];
  const recentWindowAll: SemanticSampleRow[] = [];
  const futureAll: SemanticSampleRow[] = [];

  for (const item of items) {
    const row = buildSemanticSampleRow(item, detectedDateField);
    const hasPlanned = Boolean((row.totalTimePlanned ?? 0) > 0 || (row.distancePlanned ?? 0) > 0);
    const hasCompleted = Boolean((row.totalTime ?? 0) > 0 || (row.distance ?? 0) > 0);

    if (hasPlanned) plannedCandidatesAll.push(row);
    if (hasCompleted) completedCandidatesAll.push(row);
    if (hasPlanned && !hasCompleted) plannedButNotCompletedAll.push(row);
    if (hasPlanned && hasCompleted) plannedAndCompletedAll.push(row);

    if (requestedToDate && row.workoutDay) {
      const workoutDayDate = parseIsoDateUtc(row.workoutDay);
      if (workoutDayDate && recentWindowStart && workoutDayDate >= recentWindowStart && workoutDayDate <= requestedToDate) {
        recentWindowAll.push(row);
      }
      if (workoutDayDate && workoutDayDate > requestedToDate) {
        futureAll.push(row);
      }
    }
  }

  const fieldDetection = input.fieldDetection;
  const likelyPlannedDurationField = pickLikelyCandidateField(fieldDetection?.candidatePlannedDurationFields ?? [], [
    "totalTimePlanned",
    "plannedDuration",
  ]);
  const likelyCompletedDurationField = pickLikelyCandidateField(fieldDetection?.candidateCompletedDurationFields ?? [], [
    "totalTime",
    "duration",
  ]);
  const likelyPlannedDistanceField = pickLikelyCandidateField(fieldDetection?.candidatePlannedDistanceFields ?? [], [
    "distancePlanned",
    "plannedDistance",
  ]);
  const likelyCompletedDistanceField = pickLikelyCandidateField(fieldDetection?.candidateCompletedDistanceFields ?? [], [
    "distance",
    "actualDistance",
  ]);
  const explicitCompletedField = pickLikelyCandidateField(fieldDetection?.candidateCompletedFlagFields ?? [], [
    "completed",
    "isCompleted",
    "status",
  ]);

  const blockersForNormalization: string[] = [];
  if (!likelyPlannedDurationField && !likelyPlannedDistanceField) {
    blockersForNormalization.push("No stable planned metric field is detected.");
  }
  if (!likelyCompletedDurationField && !likelyCompletedDistanceField) {
    blockersForNormalization.push("No stable completed metric field is detected.");
  }
  if (!fieldDetection?.hasWorkoutIdField) {
    blockersForNormalization.push("Workout id field remains ambiguous/missing.");
  }
  if (!fieldDetection?.hasDateField) {
    blockersForNormalization.push("Workout date field remains ambiguous/missing.");
  }
  if ((plannedAndCompletedAll.length === 0 || plannedButNotCompletedAll.length === 0) && items.length > 0) {
    blockersForNormalization.push("Insufficient semantic mix of planned-vs-completed rows for confident mapping.");
  }

  const confidence: "high" | "medium" | "low" =
    blockersForNormalization.length === 0
      ? "high"
      : blockersForNormalization.length <= 2 && (likelyPlannedDurationField || likelyPlannedDistanceField)
          ? "medium"
          : "low";

  const likelyCompletionIndicator =
    explicitCompletedField ?? (likelyCompletedDurationField || likelyCompletedDistanceField ? "derived: totalTime>0 OR distance>0" : null);

  const toGroup = (rows: SemanticSampleRow[]): SemanticSampleGroup => ({
    count: rows.length,
    rows: rows.slice(0, SEMANTIC_SAMPLE_ROWS_PER_GROUP),
  });

  return {
    found: items.length > 0,
    endpointPattern: input.endpointPattern,
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    totalWorkoutItems: items.length,
    sampleRowsPerGroup: SEMANTIC_SAMPLE_ROWS_PER_GROUP,
    plannedCandidates: toGroup(plannedCandidatesAll),
    completedCandidates: toGroup(completedCandidatesAll),
    plannedButNotCompletedCandidates: toGroup(plannedButNotCompletedAll),
    plannedAndCompletedCandidates: toGroup(plannedAndCompletedAll),
    recentWindowSamples: toGroup(recentWindowAll),
    futureSamples: toGroup(futureAll),
    fieldSemanticsHypothesis: {
      likelyPlannedDurationField,
      likelyCompletedDurationField,
      likelyPlannedDistanceField,
      likelyCompletedDistanceField,
      likelyCompletionIndicator,
      confidence,
      blockersForNormalization: blockersForNormalization.slice(0, 8),
    },
    firstPassNormalizationContract: input.normalizationContractSufficient && confidence !== "low" ? "safe" : "blocked",
    artifactPath: input.artifactPath,
  };
}

function extractIsoDatePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match?.[1] ?? null;
}

function getRecordValueByCandidateKey(record: Record<string, unknown>, candidateKey: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, candidateKey)) {
    return record[candidateKey];
  }

  const normalizedCandidate = normalizeKey(candidateKey);
  for (const [key, value] of Object.entries(record)) {
    if (normalizeKey(key) === normalizedCandidate) {
      return value;
    }
  }

  return null;
}

function chooseDetectedDateField(items: unknown[], fieldDetection: WorkoutFieldDetection): string | null {
  const preferredCandidates = ["workoutDay", ...fieldDetection.candidateDateFields, "date", "startDate"];
  const uniqueCandidates = [...new Set(preferredCandidates)];
  let bestField: string | null = null;
  let bestScore = -1;

  for (const field of uniqueCandidates) {
    let parseableCount = 0;
    for (const item of items) {
      if (!isRecord(item)) continue;
      if (extractIsoDatePart(getRecordValueByCandidateKey(item, field)) !== null) {
        parseableCount += 1;
      }
    }
    if (parseableCount > bestScore) {
      bestScore = parseableCount;
      bestField = field;
    }
  }

  return bestScore > 0 ? bestField : null;
}

function summarizeDistinctWorkoutDays(days: string[]): DistinctWorkoutDaySummary {
  const distinct = [...new Set(days)].sort();
  return {
    totalCount: distinct.length,
    sample: distinct.slice(0, DISTINCT_WORKOUT_DAY_SAMPLE_LIMIT),
    truncated: distinct.length > DISTINCT_WORKOUT_DAY_SAMPLE_LIMIT,
  };
}

function assessEndpointRangeBehavior(input: {
  parsedDateCount: number;
  outsideCount: number;
  unknownCount: number;
}): DateRangeHonorStatus {
  if (input.parsedDateCount === 0) return "ambiguous";
  if (input.unknownCount > Math.max(2, Math.floor(input.parsedDateCount * 0.1))) {
    return "ambiguous";
  }

  const outsideRatio = input.outsideCount / input.parsedDateCount;
  if (input.outsideCount === 0 || outsideRatio <= 0.05) {
    return true;
  }
  if (input.outsideCount >= 5 || outsideRatio >= 0.2) {
    return false;
  }
  return "ambiguous";
}

function buildWorkoutDateRangeSanity(input: {
  requestedFrom: string;
  requestedTo: string;
  workoutItems: unknown[];
  fieldDetection: WorkoutFieldDetection;
}): WorkoutDateRangeSanity {
  const detectedDateField = chooseDetectedDateField(input.workoutItems, input.fieldDetection);
  let itemsInsideRequestedRange = 0;
  let itemsBeforeRequestedRange = 0;
  let itemsAfterRequestedRange = 0;
  let itemsWithUnknownWorkoutDay = 0;
  let completedTrueCount = 0;
  let completedFalseCount = 0;
  let completedUnknownCount = 0;
  let totalTimePlannedGtZeroCount = 0;
  let distancePlannedGtZeroCount = 0;
  let eitherPlannedDurationOrDistanceCount = 0;
  let totalTimeGtZeroCount = 0;
  let distanceGtZeroCount = 0;
  const parsedWorkoutDays: string[] = [];

  for (const item of input.workoutItems) {
    if (!isRecord(item)) {
      itemsWithUnknownWorkoutDay += 1;
      completedUnknownCount += 1;
      continue;
    }

    const workoutDay = detectedDateField ? extractIsoDatePart(getRecordValueByCandidateKey(item, detectedDateField)) : null;
    if (!workoutDay) {
      itemsWithUnknownWorkoutDay += 1;
    } else {
      parsedWorkoutDays.push(workoutDay);
      if (workoutDay < input.requestedFrom) {
        itemsBeforeRequestedRange += 1;
      } else if (workoutDay > input.requestedTo) {
        itemsAfterRequestedRange += 1;
      } else {
        itemsInsideRequestedRange += 1;
      }
    }

    if (item.completed === true) {
      completedTrueCount += 1;
    } else if (item.completed === false) {
      completedFalseCount += 1;
    } else {
      completedUnknownCount += 1;
    }

    const totalTimePlanned = readPositiveNumber(item.totalTimePlanned);
    const distancePlanned = readPositiveNumber(item.distancePlanned);
    const totalTime = readPositiveNumber(item.totalTime);
    const distance = readPositiveNumber(item.distance);

    const hasPlannedDuration = Boolean(totalTimePlanned && totalTimePlanned > 0);
    const hasPlannedDistance = Boolean(distancePlanned && distancePlanned > 0);
    const hasCompletedDuration = Boolean(totalTime && totalTime > 0);
    const hasCompletedDistance = Boolean(distance && distance > 0);

    if (hasPlannedDuration) totalTimePlannedGtZeroCount += 1;
    if (hasPlannedDistance) distancePlannedGtZeroCount += 1;
    if (hasPlannedDuration || hasPlannedDistance) eitherPlannedDurationOrDistanceCount += 1;
    if (hasCompletedDuration) totalTimeGtZeroCount += 1;
    if (hasCompletedDistance) distanceGtZeroCount += 1;
  }

  const sortedWorkoutDays = [...parsedWorkoutDays].sort();
  const minWorkoutDay = sortedWorkoutDays[0] ?? null;
  const maxWorkoutDay = sortedWorkoutDays.at(-1) ?? null;
  const parsedDateCount = parsedWorkoutDays.length;
  const outsideCount = itemsBeforeRequestedRange + itemsAfterRequestedRange;

  return {
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    totalItems: input.workoutItems.length,
    detectedDateField,
    minWorkoutDay,
    maxWorkoutDay,
    distinctWorkoutDays: summarizeDistinctWorkoutDays(parsedWorkoutDays),
    itemsInsideRequestedRange,
    itemsBeforeRequestedRange,
    itemsAfterRequestedRange,
    itemsWithUnknownWorkoutDay,
    endpointHonorsRequestedRange: assessEndpointRangeBehavior({
      parsedDateCount,
      outsideCount,
      unknownCount: itemsWithUnknownWorkoutDay,
    }),
    completedTrueCount,
    completedFalseCount,
    completedUnknownCount,
    plannedIndicatorSummary: {
      totalTimePlannedGtZeroCount,
      distancePlannedGtZeroCount,
      eitherPlannedDurationOrDistanceCount,
    },
    completedIndicatorSummary: {
      completedTrueCount,
      totalTimeGtZeroCount,
      distanceGtZeroCount,
    },
  };
}

function buildNormalizationNotes(input: {
  workoutItemPath: string | null;
  workoutItemCount: number;
  fieldDetection: WorkoutFieldDetection;
}): { sufficient: boolean; notes: string[] } {
  const notes: string[] = [];
  if (input.workoutItemPath) {
    notes.push(`Workout item path detected at ${input.workoutItemPath}.`);
  } else {
    notes.push("No workout item array path detected.");
  }
  if (input.workoutItemCount > 0) {
    notes.push(`Workout item count observed: ${input.workoutItemCount}.`);
  } else {
    notes.push("Workout item count was zero.");
  }
  notes.push(
    `ID field status: ${input.fieldDetection.workoutIdFieldStatus} (${input.fieldDetection.candidateWorkoutIdFields.join(", ") || "none"}).`,
  );
  notes.push(
    `Date field status: ${input.fieldDetection.dateFieldStatus} (${input.fieldDetection.candidateDateFields.join(", ") || "none"}).`,
  );
  notes.push(
    `Completion flag status: ${input.fieldDetection.completedFlagFieldStatus} (${input.fieldDetection.candidateCompletedFlagFields.join(", ") || "none"}).`,
  );

  const sufficient =
    Boolean(input.workoutItemPath) &&
    input.workoutItemCount > 0 &&
    input.fieldDetection.hasWorkoutIdField &&
    input.fieldDetection.hasDateField &&
    (input.fieldDetection.hasTitleField ||
      input.fieldDetection.hasSportOrTypeField ||
      input.fieldDetection.hasPlannedDurationField ||
      input.fieldDetection.hasCompletedDurationField ||
      input.fieldDetection.hasPlannedDistanceField ||
      input.fieldDetection.hasCompletedDistanceField ||
      input.fieldDetection.hasExplicitCompletedFlag);

  notes.push(
    sufficient
      ? "Payload is sufficient for a first-pass Task 2 normalization contract."
      : "Payload is still missing enough confirmed signal for a first-pass Task 2 normalization contract.",
  );

  return { sufficient, notes };
}

function buildWorkoutSchemaSample(input: {
  endpointPattern: string;
  status: number | null;
  redactedBody: unknown;
  parseError: string | null;
  requestedFrom: string;
  requestedTo: string;
}): WorkoutSchemaSample {
  const candidate = findWorkoutArrayCandidate(input.redactedBody);
  const arrayLength = Array.isArray(input.redactedBody)
    ? input.redactedBody.length
    : candidate?.arrayLength ?? null;
  const workoutItems = candidate?.items ?? [];
  const unionFirstLevelKeys = collectObjectKeysFromArrayItems(workoutItems, WORKOUT_ITEM_SCAN_LIMIT);
  const fieldDetection = buildWorkoutFieldDetection(unionFirstLevelKeys);
  const dateRangeSanity = buildWorkoutDateRangeSanity({
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    workoutItems,
    fieldDetection,
  });
  const normalization = buildNormalizationNotes({
    workoutItemPath: candidate?.path ?? null,
    workoutItemCount: candidate?.arrayLength ?? 0,
    fieldDetection,
  });

  return {
    endpointUrlPattern: input.endpointPattern,
    method: "GET",
    responseStatus: input.status,
    topLevelJsonType: topLevelJsonType(input.redactedBody),
    topLevelKeys: collectTopLevelKeys(input.redactedBody),
    arrayLength,
    detectedWorkoutItemPath: candidate?.path ?? null,
    workoutItemCount: candidate?.arrayLength ?? 0,
    unionFirstLevelKeys,
    sampleWorkoutItems: workoutItems.slice(0, WORKOUT_ITEM_SAMPLE_LIMIT).map((item) => buildWorkoutItemSample(item)),
    fieldDetection,
    dateRangeSanity,
    normalizationContractSufficient: normalization.sufficient,
    normalizationNotes: normalization.notes,
    parseError: input.parseError,
  };
}

function hasAnyField(input: unknown, fieldMatchers: RegExp[]): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [input];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      if (fieldMatchers.some((matcher) => matcher.test(key))) return true;
      stack.push(value);
    }
  }
  return false;
}

function mergeUnique(values: string[][]): string[] {
  const out = new Set<string>();
  for (const arr of values) {
    for (const item of arr) out.add(item);
  }
  return [...out];
}

async function captureCandidateFromResponse(input: {
  id: number;
  request: Request;
  response: Response;
  requestedFrom: string;
  requestedTo: string;
}): Promise<CapturedGetCandidate> {
  const contentType = input.response.headers()["content-type"] ?? "";
  let parsedBody: unknown = null;
  let parseError: string | null = null;
  if (looksTextualResponse(contentType)) {
    try {
      const text = await input.response.text();
      const tryJsonParse = shouldTryJsonParse(contentType, text);
      if (tryJsonParse && text.length <= LARGE_JSON_PARSE_MAX_CHARS) {
        try {
          parsedBody = JSON.parse(text);
          if (text.length > RESPONSE_BODY_MAX_CHARS) {
            parseError = `Large JSON body parsed in-memory for compact schema extraction (${text.length} chars).`;
          }
        } catch (error) {
          if (text.length > RESPONSE_BODY_MAX_CHARS) {
            parseError = `Large JSON parse failed (${text.length} chars): ${(error as Error).message}`;
            parsedBody = `[omitted-large-body ${text.length} chars]`;
          } else {
            parsedBody = text;
          }
        }
      } else if (text.length > RESPONSE_BODY_MAX_CHARS) {
        parseError = `Body too large for safe parse (${text.length} chars).`;
        parsedBody = `[omitted-large-body ${text.length} chars]`;
      } else {
        try {
          parsedBody = JSON.parse(text);
        } catch {
          parsedBody = text;
        }
      }
    } catch (error) {
      parseError = `Failed reading response body: ${(error as Error).message}`;
      parsedBody = "[unavailable]";
    }
  } else {
    parseError = `Non-text content-type: ${contentType || "unknown"}`;
    parsedBody = "[omitted-non-text]";
  }

  const redactedBody = redactUnknown(parsedBody);
  const endpointPattern = buildEndpointPattern(input.request.url());
  const topLevelKeys = collectTopLevelKeys(redactedBody);
  const sampleSnippet = summarizeValue(redactedBody);
  const workoutsSchemaSample = isPrimaryWorkoutsEndpointPattern(endpointPattern)
    ? buildWorkoutSchemaSample({
        endpointPattern,
        status: input.response.status(),
        redactedBody,
        parseError,
        requestedFrom: input.requestedFrom,
        requestedTo: input.requestedTo,
      })
    : null;

  return {
    id: input.id,
    method: "GET",
    url: input.request.url(),
    endpointPattern,
    status: input.response.status(),
    ok: input.response.ok(),
    contentType: contentType || null,
    topLevelJsonType: topLevelJsonType(redactedBody),
    topLevelKeys,
    sampleSnippet,
    analysisBody: redactedBody,
    hasWorkoutIdField: hasAnyField(redactedBody, [/workoutid/i, /id$/i]),
    hasWorkoutDateField: hasAnyField(redactedBody, [/workoutday/i, /date/i, /day/i]),
    hasPlannedIndicator: hasAnyField(redactedBody, [/planned/i, /target/i]),
    hasCompletedIndicator: hasAnyField(redactedBody, [/completed/i, /actual/i]),
    parseError,
    workoutsSchemaSample,
  };
}

function buildIgnoredNonGetSummary(entries: Array<{ method: string; endpointPattern: string }>): IgnoredNonGetSummary {
  const byMethod = new Map<string, number>();
  const byEndpoint = new Map<string, number>();
  for (const entry of entries) {
    byMethod.set(entry.method, (byMethod.get(entry.method) ?? 0) + 1);
    byEndpoint.set(entry.endpointPattern, (byEndpoint.get(entry.endpointPattern) ?? 0) + 1);
  }
  return {
    totalIgnored: entries.length,
    byMethod: Object.fromEntries([...byMethod.entries()].sort((a, b) => b[1] - a[1])),
    topEndpointPatterns: [...byEndpoint.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([endpointPattern, count]) => ({ endpointPattern, count })),
  };
}

function buildShapeEntries(candidates: CapturedGetCandidate[]): ShapeEntry[] {
  const grouped = new Map<string, CapturedGetCandidate[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.endpointPattern) ?? [];
    list.push(candidate);
    grouped.set(candidate.endpointPattern, list);
  }

  const out: ShapeEntry[] = [];
  for (const [endpointPattern, entries] of grouped.entries()) {
    const first = entries[0];
    const parsedBody = first?.analysisBody;
    const parsedSample = first?.sampleSnippet;
    out.push({
      endpointPattern,
      urls: [...new Set(entries.map((entry) => entry.url))].slice(0, 5),
      hitCount: entries.length,
      statuses: [...new Set(entries.map((entry) => entry.status).filter((status): status is number => status !== null))],
      topLevelJsonType: first?.topLevelJsonType ?? "unknown",
      topLevelKeys: mergeUnique(entries.map((entry) => entry.topLevelKeys)).slice(0, 120),
      itemTopLevelKeys: collectItemTopLevelKeys(parsedBody),
      sampleSnippet: parsedSample,
      hasWorkoutIdField: entries.some((entry) => entry.hasWorkoutIdField),
      hasWorkoutDateField: entries.some((entry) => entry.hasWorkoutDateField),
      hasPlannedIndicator: entries.some((entry) => entry.hasPlannedIndicator),
      hasCompletedIndicator: entries.some((entry) => entry.hasCompletedIndicator),
    });
  }
  return out.sort((a, b) => b.hitCount - a.hitCount || a.endpointPattern.localeCompare(b.endpointPattern));
}

function buildWorkoutSchemaArtifact(candidates: CapturedGetCandidate[], artifactPath: string): WorkoutSchemaArtifact {
  const chosen =
    candidates
      .filter((candidate) => candidate.workoutsSchemaSample)
      .sort((a, b) => {
        const aCount = a.workoutsSchemaSample?.workoutItemCount ?? -1;
        const bCount = b.workoutsSchemaSample?.workoutItemCount ?? -1;
        return bCount - aCount || (b.status ?? -1) - (a.status ?? -1);
      })[0] ?? null;

  if (!chosen || !chosen.workoutsSchemaSample) {
    return {
      found: false,
      endpointPattern: null,
      method: null,
      responseStatus: null,
      topLevelJsonType: null,
      topLevelKeys: [],
      arrayLength: null,
      detectedWorkoutItemPath: null,
      workoutItemCount: 0,
      unionFirstLevelKeys: [],
      sampleWorkoutItems: [],
      fieldDetection: null,
      dateRangeSanity: null,
      normalizationContractSufficient: false,
      normalizationNotes: ["Primary workouts endpoint was not captured with a parsable JSON payload."],
      artifactPath,
      parseError: null,
    };
  }

  const sample = chosen.workoutsSchemaSample;
  return {
    found: true,
    endpointPattern: sample.endpointUrlPattern,
    method: sample.method,
    responseStatus: sample.responseStatus,
    topLevelJsonType: sample.topLevelJsonType,
    topLevelKeys: sample.topLevelKeys,
    arrayLength: sample.arrayLength,
    detectedWorkoutItemPath: sample.detectedWorkoutItemPath,
    workoutItemCount: sample.workoutItemCount,
    unionFirstLevelKeys: sample.unionFirstLevelKeys,
    sampleWorkoutItems: sample.sampleWorkoutItems,
    fieldDetection: sample.fieldDetection,
    dateRangeSanity: sample.dateRangeSanity,
    normalizationContractSufficient: sample.normalizationContractSufficient,
    normalizationNotes: sample.normalizationNotes,
    artifactPath,
    parseError: sample.parseError,
  };
}

function choosePrimaryWorkoutsCandidate(candidates: CapturedGetCandidate[]): CapturedGetCandidate | null {
  return (
    candidates
      .filter((candidate) => candidate.workoutsSchemaSample)
      .sort((a, b) => {
        const aCount = a.workoutsSchemaSample?.workoutItemCount ?? -1;
        const bCount = b.workoutsSchemaSample?.workoutItemCount ?? -1;
        return bCount - aCount || (b.status ?? -1) - (a.status ?? -1);
      })[0] ?? null
  );
}

function buildDirectGetValidation(input: {
  endpoint: string;
  requestedFrom: string;
  requestedTo: string;
  statusCode: number | null;
  ok: boolean;
  redactedBody: unknown;
}): DirectGetValidationArtifact {
  const endpointPattern = buildEndpointPattern(input.endpoint);
  const schemaSample = buildWorkoutSchemaSample({
    endpointPattern,
    status: input.statusCode,
    redactedBody: input.redactedBody,
    parseError: null,
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
  });
  const semanticSamples = buildSemanticSamplesArtifact({
    endpointPattern,
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    workoutItems: findWorkoutArrayCandidate(input.redactedBody)?.items ?? [],
    fieldDetection: schemaSample.fieldDetection,
    dateRangeSanity: schemaSample.dateRangeSanity,
    normalizationContractSufficient: schemaSample.normalizationContractSufficient,
    artifactPath: "[inline-direct-get-validation]",
  });

  const dateRangeSanity = schemaSample.dateRangeSanity;
  const endpointHonorsRequestedRange = dateRangeSanity?.endpointHonorsRequestedRange ?? "ambiguous";
  const rangeIsHonored = endpointHonorsRequestedRange === true;
  const blockers: string[] = [];
  if (!input.ok) {
    blockers.push(`Direct GET did not return ok response (status ${input.statusCode ?? "unknown"}).`);
  }
  if (!dateRangeSanity) {
    blockers.push("Could not detect workout array/date range sanity from direct GET payload.");
  }
  if (input.ok && dateRangeSanity && !rangeIsHonored) {
    blockers.push("Direct GET does not honor requested date range; another discovery pass is needed for calendar navigation behavior or a different endpoint.");
  }

  return {
    endpoint: input.endpoint,
    method: "GET",
    statusCode: input.statusCode,
    ok: input.ok,
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    totalItems: dateRangeSanity?.totalItems ?? 0,
    detectedItemPath: schemaSample.detectedWorkoutItemPath,
    minWorkoutDay: dateRangeSanity?.minWorkoutDay ?? null,
    maxWorkoutDay: dateRangeSanity?.maxWorkoutDay ?? null,
    itemsInsideRequestedRange: dateRangeSanity?.itemsInsideRequestedRange ?? 0,
    itemsBeforeRequestedRange: dateRangeSanity?.itemsBeforeRequestedRange ?? 0,
    itemsAfterRequestedRange: dateRangeSanity?.itemsAfterRequestedRange ?? 0,
    endpointHonorsRequestedRange,
    plannedCandidateCount: semanticSamples.plannedCandidates.count,
    completedCandidateCount: semanticSamples.completedCandidates.count,
    plannedButNotCompletedCount: semanticSamples.plannedButNotCompletedCandidates.count,
    plannedAndCompletedCount: semanticSamples.plannedAndCompletedCandidates.count,
    fieldSemanticsHypothesis: semanticSamples.fieldSemanticsHypothesis,
    directGetSufficientForCache: input.ok && rangeIsHonored,
    blockers,
  };
}

function createSummaryMarkdown(summary: ScriptSummary): string {
  return [
    "# TrainingPeaks Workouts API Discovery",
    "",
    `- athlete_id: \`${summary.athleteId}\``,
    `- athlete_url: \`${summary.athleteUrl}\``,
    `- date_range: \`${summary.from}\` to \`${summary.to}\``,
    `- get_candidate_endpoints: **${summary.getCandidateCount}**`,
    `- endpoint_patterns_found: ${summary.endpointPatternsFound.length ? summary.endpointPatternsFound.map((p) => `\`${p}\``).join(", ") : "none"}`,
    `- stable_workout_id_fields_present: **${summary.stableWorkoutIdField ? "yes" : "no"}**`,
    `- stable_workout_date_fields_present: **${summary.stableWorkoutDateField ? "yes" : "no"}**`,
    `- planned_indicators_present: **${summary.plannedIndicatorsFound ? "yes" : "no"}**`,
    `- completed_indicators_present: **${summary.completedIndicatorsFound ? "yes" : "no"}**`,
    `- workouts_endpoint_found: **${summary.workoutsEndpointFound ? "yes" : "no"}**`,
    `- workout_item_path: \`${summary.workoutItemPath ?? "none"}\``,
    `- workout_item_count: **${summary.workoutItemCount}**`,
    "",
    "## Observed UI candidates",
    `- detected_workout_date_field: \`${summary.dateRangeSanity?.detectedDateField ?? "none"}\``,
    `- workout_day_min_max: \`${summary.dateRangeSanity?.minWorkoutDay ?? "unknown"}\` -> \`${summary.dateRangeSanity?.maxWorkoutDay ?? "unknown"}\``,
    `- items_inside_requested_range: **${summary.dateRangeSanity?.itemsInsideRequestedRange ?? 0}**`,
    `- items_before_requested_range: **${summary.dateRangeSanity?.itemsBeforeRequestedRange ?? 0}**`,
    `- items_after_requested_range: **${summary.dateRangeSanity?.itemsAfterRequestedRange ?? 0}**`,
    `- items_with_unknown_workout_day: **${summary.dateRangeSanity?.itemsWithUnknownWorkoutDay ?? 0}**`,
    `- endpoint_honors_requested_range: **${String(summary.dateRangeSanity?.endpointHonorsRequestedRange ?? "ambiguous")}**`,
    `- distinct_workout_days: ${
      summary.dateRangeSanity
        ? `${summary.dateRangeSanity.distinctWorkoutDays.totalCount} total (${summary.dateRangeSanity.distinctWorkoutDays.sample.map((value) => `\`${value}\``).join(", ") || "none"}${summary.dateRangeSanity.distinctWorkoutDays.truncated ? ", ..." : ""})`
        : "none"
    }`,
    `- completed_counts: true=${summary.dateRangeSanity?.completedTrueCount ?? 0}, false=${summary.dateRangeSanity?.completedFalseCount ?? 0}, unknown=${summary.dateRangeSanity?.completedUnknownCount ?? 0}`,
    `- planned_indicator_counts: totalTimePlanned>0=${summary.dateRangeSanity?.plannedIndicatorSummary.totalTimePlannedGtZeroCount ?? 0}, distancePlanned>0=${summary.dateRangeSanity?.plannedIndicatorSummary.distancePlannedGtZeroCount ?? 0}, either=${summary.dateRangeSanity?.plannedIndicatorSummary.eitherPlannedDurationOrDistanceCount ?? 0}`,
    `- completed_indicator_counts: completed=true=${summary.dateRangeSanity?.completedIndicatorSummary.completedTrueCount ?? 0}, totalTime>0=${summary.dateRangeSanity?.completedIndicatorSummary.totalTimeGtZeroCount ?? 0}, distance>0=${summary.dateRangeSanity?.completedIndicatorSummary.distanceGtZeroCount ?? 0}`,
    `- candidate_id_fields: ${summary.candidateIdFields.length ? summary.candidateIdFields.map((value) => `\`${value}\``).join(", ") : "none"}`,
    `- candidate_date_fields: ${summary.candidateDateFields.length ? summary.candidateDateFields.map((value) => `\`${value}\``).join(", ") : "none"}`,
    `- candidate_title_fields: ${summary.candidateTitleFields.length ? summary.candidateTitleFields.map((value) => `\`${value}\``).join(", ") : "none"}`,
    `- candidate_completed_flag_fields: ${summary.candidateCompletedFlagFields.length ? summary.candidateCompletedFlagFields.map((value) => `\`${value}\``).join(", ") : "none"}`,
    `- semantic_sample_counts: planned=${summary.semanticSampleCounts.plannedCandidates}, completed=${summary.semanticSampleCounts.completedCandidates}, planned_not_completed=${summary.semanticSampleCounts.plannedButNotCompletedCandidates}, planned_and_completed=${summary.semanticSampleCounts.plannedAndCompletedCandidates}, recent14d=${summary.semanticSampleCounts.recentWindowSamples}, future=${summary.semanticSampleCounts.futureSamples}`,
    `- normalized_sample_counts: normalized=${summary.normalizedSampleCounts.normalizedCount}, dropped=${summary.normalizedSampleCounts.droppedCount}, warnings=${summary.normalizedSampleCounts.warningCount}`,
    `- normalized_warning_samples: ${summary.normalizedSampleCounts.warningsSample.length ? summary.normalizedSampleCounts.warningsSample.join("; ") : "none"}`,
    `- hypothesis_likely_fields: planned_duration=\`${summary.fieldSemanticsHypothesis.likelyPlannedDurationField ?? "none"}\`, completed_duration=\`${summary.fieldSemanticsHypothesis.likelyCompletedDurationField ?? "none"}\`, planned_distance=\`${summary.fieldSemanticsHypothesis.likelyPlannedDistanceField ?? "none"}\`, completed_distance=\`${summary.fieldSemanticsHypothesis.likelyCompletedDistanceField ?? "none"}\`, completion_indicator=\`${summary.fieldSemanticsHypothesis.likelyCompletionIndicator ?? "none"}\``,
    `- hypothesis_confidence: **${summary.fieldSemanticsHypothesis.confidence}**`,
    `- hypothesis_blockers: ${summary.fieldSemanticsHypothesis.blockersForNormalization.length ? summary.fieldSemanticsHypothesis.blockersForNormalization.join("; ") : "none"}`,
    `- first_pass_normalization_contract: **${summary.firstPassNormalizationContract}**`,
    `- normalization_contract_sufficient: **${summary.normalizationContractSufficient ? "yes" : "no"}**`,
    "",
    "## Direct GET validation result",
    `- endpoint: \`${summary.directGetValidation.endpoint}\``,
    `- method: \`${summary.directGetValidation.method}\``,
    `- status_code: **${summary.directGetValidation.statusCode ?? "unknown"}**`,
    `- ok: **${summary.directGetValidation.ok ? "true" : "false"}**`,
    `- requested_range: \`${summary.directGetValidation.requestedFrom}\` -> \`${summary.directGetValidation.requestedTo}\``,
    `- total_items: **${summary.directGetValidation.totalItems}**`,
    `- detected_item_path: \`${summary.directGetValidation.detectedItemPath ?? "none"}\``,
    `- workout_day_min_max: \`${summary.directGetValidation.minWorkoutDay ?? "unknown"}\` -> \`${summary.directGetValidation.maxWorkoutDay ?? "unknown"}\``,
    `- items_inside_requested_range: **${summary.directGetValidation.itemsInsideRequestedRange}**`,
    `- items_before_requested_range: **${summary.directGetValidation.itemsBeforeRequestedRange}**`,
    `- items_after_requested_range: **${summary.directGetValidation.itemsAfterRequestedRange}**`,
    `- endpoint_honors_requested_range: **${String(summary.directGetValidation.endpointHonorsRequestedRange)}**`,
    `- planned_completed_counts: planned=${summary.directGetValidation.plannedCandidateCount}, completed=${summary.directGetValidation.completedCandidateCount}, planned_not_completed=${summary.directGetValidation.plannedButNotCompletedCount}, planned_and_completed=${summary.directGetValidation.plannedAndCompletedCount}`,
    `- direct_field_semantics_hypothesis: plannedDuration=${summary.directGetValidation.fieldSemanticsHypothesis.likelyPlannedDurationField ?? "none"}, completedDuration=${summary.directGetValidation.fieldSemanticsHypothesis.likelyCompletedDurationField ?? "none"}, plannedDistance=${summary.directGetValidation.fieldSemanticsHypothesis.likelyPlannedDistanceField ?? "none"}, completedDistance=${summary.directGetValidation.fieldSemanticsHypothesis.likelyCompletedDistanceField ?? "none"}, completionIndicator=${summary.directGetValidation.fieldSemanticsHypothesis.likelyCompletionIndicator ?? "none"}, confidence=${summary.directGetValidation.fieldSemanticsHypothesis.confidence}`,
    `- direct_get_sufficient_for_cache: **${summary.directGetValidation.directGetSufficientForCache ? "true" : "false"}**`,
    `- direct_get_blockers: ${
      summary.directGetValidation.blockers.length ? summary.directGetValidation.blockers.join("; ") : "none"
    }`,
    `- workouts_schema_artifact: \`${summary.workoutsArtifactPath}\``,
    `- workouts_semantic_samples_artifact: \`${summary.semanticSamplesArtifactPath}\``,
    `- workouts_direct_get_validation_artifact: \`${summary.directGetValidationArtifactPath}\``,
    `- artifact_dir: \`${summary.artifactDir}\``,
    "",
    "## Safety",
    "- GET-only candidate analysis. Non-GET requests are only summarized as ignored.",
    "- No request replay and no TrainingPeaks mutations are executed by this script.",
    "- Artifacts are local and redacted (headers/tokens/cookies/sensitive text fields).",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const calendarUrl = buildAthleteCalendarUrl(args);
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl(calendarUrl);
  if (!resolvedAthleteId) {
    throw new Error("Could not resolve athlete id. Use --athlete-id or include /athletes/<id> in --athlete-url.");
  }

  const rangeUrl = buildAthleteRangeUrl(resolvedAthleteId, args.from, args.to);
  const artifactDir = path.join(ARTIFACTS_ROOT, timestampForPath(new Date()));
  const candidateEndpointsPath = path.join(artifactDir, "candidate-endpoints.json");
  const candidatePayloadShapesPath = path.join(artifactDir, "candidate-payload-shapes.json");
  const ignoredNonGetSummaryPath = path.join(artifactDir, "ignored-non-get-summary.json");
  const workoutsSchemaSamplesPath = path.join(artifactDir, "workouts-schema-samples.json");
  const workoutsSemanticSamplesPath = path.join(artifactDir, "workouts-semantic-samples.json");
  const workoutsDirectGetValidationPath = path.join(artifactDir, "workouts-direct-get-validation.json");
  const discoverySummaryPath = path.join(artifactDir, "discovery-summary.md");

  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  console.log("[tp-discover-workouts-api] read-only GET discovery started.");
  console.log(`[tp-discover-workouts-api] athleteId=${resolvedAthleteId}`);
  console.log(`[tp-discover-workouts-api] from=${args.from} to=${args.to}`);
  console.log(`[tp-discover-workouts-api] profile=${profileDir}`);
  console.log(`[tp-discover-workouts-api] artifactDir=${artifactDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  const requestIds = new Map<Request, number>();
  let nextId = 1;
  const getCandidates: CapturedGetCandidate[] = [];
  const ignoredNonGet: Array<{ method: string; endpointPattern: string }> = [];

  const assignId = (request: Request): number => {
    const existing = requestIds.get(request);
    if (existing) return existing;
    const id = nextId++;
    requestIds.set(request, id);
    return id;
  };

  context.on("request", (request) => {
    if (!isCandidateUrl(request.url(), resolvedAthleteId)) return;
    assignId(request);
    if (request.method().toUpperCase() !== "GET") {
      ignoredNonGet.push({
        method: request.method().toUpperCase(),
        endpointPattern: buildEndpointPattern(request.url()),
      });
    }
  });

  context.on("requestfinished", async (request) => {
    if (!isCandidateUrl(request.url(), resolvedAthleteId)) return;
    if (request.method().toUpperCase() !== "GET") return;
    const response = await request.response();
    if (!response) return;
    const captured = await captureCandidateFromResponse({
      id: assignId(request),
      request,
      response,
      requestedFrom: args.from,
      requestedTo: args.to,
    });
    getCandidates.push(captured);
  });

  let directGetValidation: DirectGetValidationArtifact = {
    endpoint: `${TP_API_HOST}/fitness/v6/athletes/${resolvedAthleteId}/workouts/${args.from}/${args.to}`,
    method: "GET",
    statusCode: null,
    ok: false,
    requestedFrom: args.from,
    requestedTo: args.to,
    totalItems: 0,
    detectedItemPath: null,
    minWorkoutDay: null,
    maxWorkoutDay: null,
    itemsInsideRequestedRange: 0,
    itemsBeforeRequestedRange: 0,
    itemsAfterRequestedRange: 0,
    endpointHonorsRequestedRange: "ambiguous",
    plannedCandidateCount: 0,
    completedCandidateCount: 0,
    plannedButNotCompletedCount: 0,
    plannedAndCompletedCount: 0,
    fieldSemanticsHypothesis: {
      likelyPlannedDurationField: null,
      likelyCompletedDurationField: null,
      likelyPlannedDistanceField: null,
      likelyCompletedDistanceField: null,
      likelyCompletionIndicator: null,
      confidence: "low",
      blockersForNormalization: ["Direct GET was not executed."],
    },
    directGetSufficientForCache: false,
    blockers: ["Direct GET was not executed."],
  };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const auth = await captureSessionAuth({
      context,
      page,
      athleteId: resolvedAthleteId,
    });
    const directEndpoint = `${TP_API_HOST}/fitness/v6/athletes/${resolvedAthleteId}/workouts/${args.from}/${args.to}`;
    const directHeaders: Record<string, string> = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
    };
    if (auth.authorizationHeader) {
      directHeaders.authorization = auth.authorizationHeader;
    }
    const referer = auth.sampleHeaders.referer;
    if (typeof referer === "string" && referer.trim()) {
      directHeaders.referer = referer;
    }
    const origin = auth.sampleHeaders.origin;
    if (typeof origin === "string" && origin.trim()) {
      directHeaders.origin = origin;
    }
    const directGetResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: directEndpoint,
      headers: directHeaders,
    });
    directGetValidation = buildDirectGetValidation({
      endpoint: directEndpoint,
      requestedFrom: args.from,
      requestedTo: args.to,
      statusCode: directGetResult.status,
      ok: directGetResult.ok,
      redactedBody: redactUnknown(directGetResult.body),
    });

    await page.goto(calendarUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5_000);
    await page.goto(rangeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(6_000);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3_000);
  } finally {
    await context.close().catch(() => {});
  }

  getCandidates.sort((a, b) => a.id - b.id);
  const shapeEntries = buildShapeEntries(getCandidates);
  const ignoredSummary = buildIgnoredNonGetSummary(ignoredNonGet);
  const workoutsSchemaArtifact = buildWorkoutSchemaArtifact(getCandidates, workoutsSchemaSamplesPath);
  const primaryWorkoutsCandidate = choosePrimaryWorkoutsCandidate(getCandidates);
  const semanticWorkoutItems = findWorkoutArrayCandidate(primaryWorkoutsCandidate?.analysisBody ?? null)?.items ?? [];
  const semanticSamplesArtifact = buildSemanticSamplesArtifact({
    endpointPattern: workoutsSchemaArtifact.endpointPattern,
    requestedFrom: args.from,
    requestedTo: args.to,
    workoutItems: semanticWorkoutItems,
    fieldDetection: workoutsSchemaArtifact.fieldDetection,
    dateRangeSanity: workoutsSchemaArtifact.dateRangeSanity,
    normalizationContractSufficient: workoutsSchemaArtifact.normalizationContractSufficient,
    artifactPath: workoutsSemanticSamplesPath,
  });
  const rawWorkoutItemsForNormalization = semanticWorkoutItems.filter(
    (item): item is TrainingPeaksWorkoutRaw => isRecord(item),
  );
  const normalizedWorkouts = normalizeTrainingPeaksWorkoutItems({
    athleteId: resolvedAthleteId,
    rawItems: rawWorkoutItemsForNormalization,
  });
  const warningSet = new Set<string>();
  for (const item of normalizedWorkouts) {
    for (const warning of item.normalizationWarnings) {
      warningSet.add(warning);
    }
  }

  const summary: ScriptSummary = {
    athleteId: String(resolvedAthleteId),
    athleteUrl: calendarUrl,
    from: args.from,
    to: args.to,
    getCandidateCount: getCandidates.length,
    endpointPatternsFound: shapeEntries.map((entry) => entry.endpointPattern),
    stableWorkoutIdField: shapeEntries.some((entry) => entry.hasWorkoutIdField),
    stableWorkoutDateField: shapeEntries.some((entry) => entry.hasWorkoutDateField),
    plannedIndicatorsFound: shapeEntries.some((entry) => entry.hasPlannedIndicator),
    completedIndicatorsFound: shapeEntries.some((entry) => entry.hasCompletedIndicator),
    workoutsEndpointFound: workoutsSchemaArtifact.found,
    workoutItemPath: workoutsSchemaArtifact.detectedWorkoutItemPath,
    workoutItemCount: workoutsSchemaArtifact.workoutItemCount,
    candidateIdFields: workoutsSchemaArtifact.fieldDetection?.candidateWorkoutIdFields ?? [],
    candidateDateFields: workoutsSchemaArtifact.fieldDetection?.candidateDateFields ?? [],
    candidateTitleFields: workoutsSchemaArtifact.fieldDetection?.candidateTitleFields ?? [],
    candidateCompletedFlagFields: workoutsSchemaArtifact.fieldDetection?.candidateCompletedFlagFields ?? [],
    dateRangeSanity: workoutsSchemaArtifact.dateRangeSanity,
    normalizationContractSufficient: workoutsSchemaArtifact.normalizationContractSufficient,
    workoutsArtifactPath: workoutsSchemaSamplesPath,
    semanticSamplesArtifactPath: workoutsSemanticSamplesPath,
    semanticSampleCounts: {
      plannedCandidates: semanticSamplesArtifact.plannedCandidates.count,
      completedCandidates: semanticSamplesArtifact.completedCandidates.count,
      plannedButNotCompletedCandidates: semanticSamplesArtifact.plannedButNotCompletedCandidates.count,
      plannedAndCompletedCandidates: semanticSamplesArtifact.plannedAndCompletedCandidates.count,
      recentWindowSamples: semanticSamplesArtifact.recentWindowSamples.count,
      futureSamples: semanticSamplesArtifact.futureSamples.count,
    },
    normalizedSampleCounts: {
      normalizedCount: normalizedWorkouts.length,
      droppedCount: rawWorkoutItemsForNormalization.length - normalizedWorkouts.length,
      warningCount: warningSet.size,
      warningsSample: [...warningSet].slice(0, 8),
    },
    fieldSemanticsHypothesis: semanticSamplesArtifact.fieldSemanticsHypothesis,
    firstPassNormalizationContract: semanticSamplesArtifact.firstPassNormalizationContract,
    directGetValidation,
    directGetValidationArtifactPath: workoutsDirectGetValidationPath,
    artifactDir,
  };

  await writeFile(
    candidateEndpointsPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: resolvedAthleteId,
        from: args.from,
        to: args.to,
        candidateCount: getCandidates.length,
        candidates: getCandidates.map((entry) => ({
          id: entry.id,
          method: entry.method,
          url: entry.url,
          endpointPattern: entry.endpointPattern,
          status: entry.status,
          ok: entry.ok,
          contentType: entry.contentType,
          topLevelJsonType: entry.topLevelJsonType,
          topLevelKeys: entry.topLevelKeys,
          hasWorkoutIdField: entry.hasWorkoutIdField,
          hasWorkoutDateField: entry.hasWorkoutDateField,
          hasPlannedIndicator: entry.hasPlannedIndicator,
          hasCompletedIndicator: entry.hasCompletedIndicator,
          parseError: entry.parseError,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    candidatePayloadShapesPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: resolvedAthleteId,
        from: args.from,
        to: args.to,
        endpointShapes: shapeEntries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    workoutsSchemaSamplesPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: resolvedAthleteId,
        from: args.from,
        to: args.to,
        workoutsEndpoint: workoutsSchemaArtifact,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    workoutsSemanticSamplesPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: resolvedAthleteId,
        from: args.from,
        to: args.to,
        workoutsEndpointSemanticSamples: semanticSamplesArtifact,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    workoutsDirectGetValidationPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: resolvedAthleteId,
        from: args.from,
        to: args.to,
        workoutsDirectGetValidation: directGetValidation,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    ignoredNonGetSummaryPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        athleteId: resolvedAthleteId,
        from: args.from,
        to: args.to,
        ...ignoredSummary,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(discoverySummaryPath, `${createSummaryMarkdown(summary)}\n`, "utf8");

  console.log("");
  console.log("[tp-discover-workouts-api] Summary");
  console.log(`athlete_id: ${summary.athleteId}`);
  console.log(`date_range: ${summary.from} -> ${summary.to}`);
  console.log("--- observed_ui_candidates ---");
  console.log(`get_candidate_endpoints: ${summary.getCandidateCount}`);
  console.log(
    `endpoint_patterns_found: ${
      summary.endpointPatternsFound.length ? summary.endpointPatternsFound.join(" | ") : "none"
    }`,
  );
  console.log(
    `stable_workout_id/date_fields: id=${summary.stableWorkoutIdField ? "yes" : "no"}, date=${
      summary.stableWorkoutDateField ? "yes" : "no"
    }`,
  );
  console.log(
    `planned_completed_indicators: planned=${summary.plannedIndicatorsFound ? "yes" : "no"}, completed=${
      summary.completedIndicatorsFound ? "yes" : "no"
    }`,
  );
  console.log(`workouts_endpoint_found: ${summary.workoutsEndpointFound ? "yes" : "no"}`);
  console.log(`workout_item_path: ${summary.workoutItemPath ?? "none"}`);
  console.log(`workout_item_count: ${summary.workoutItemCount}`);
  console.log(`detected_workout_date_field: ${summary.dateRangeSanity?.detectedDateField ?? "none"}`);
  console.log(
    `workout_day_min_max: ${summary.dateRangeSanity?.minWorkoutDay ?? "unknown"} -> ${
      summary.dateRangeSanity?.maxWorkoutDay ?? "unknown"
    }`,
  );
  console.log(
    `items_inside_outside_requested_range: inside=${summary.dateRangeSanity?.itemsInsideRequestedRange ?? 0}, before=${
      summary.dateRangeSanity?.itemsBeforeRequestedRange ?? 0
    }, after=${summary.dateRangeSanity?.itemsAfterRequestedRange ?? 0}, unknown=${
      summary.dateRangeSanity?.itemsWithUnknownWorkoutDay ?? 0
    }`,
  );
  console.log(
    `endpoint_honors_requested_range: ${String(summary.dateRangeSanity?.endpointHonorsRequestedRange ?? "ambiguous")}`,
  );
  console.log(
    `completed_counts: true=${summary.dateRangeSanity?.completedTrueCount ?? 0}, false=${
      summary.dateRangeSanity?.completedFalseCount ?? 0
    }, unknown=${summary.dateRangeSanity?.completedUnknownCount ?? 0}`,
  );
  console.log(
    `planned_counts: totalTimePlanned>0=${
      summary.dateRangeSanity?.plannedIndicatorSummary.totalTimePlannedGtZeroCount ?? 0
    }, distancePlanned>0=${summary.dateRangeSanity?.plannedIndicatorSummary.distancePlannedGtZeroCount ?? 0}, either=${
      summary.dateRangeSanity?.plannedIndicatorSummary.eitherPlannedDurationOrDistanceCount ?? 0
    }`,
  );
  console.log(
    `completed_indicator_counts: completed=true=${
      summary.dateRangeSanity?.completedIndicatorSummary.completedTrueCount ?? 0
    }, totalTime>0=${summary.dateRangeSanity?.completedIndicatorSummary.totalTimeGtZeroCount ?? 0}, distance>0=${
      summary.dateRangeSanity?.completedIndicatorSummary.distanceGtZeroCount ?? 0
    }`,
  );
  console.log(
    `candidate_fields: id=${summary.candidateIdFields.join(", ") || "none"} | date=${
      summary.candidateDateFields.join(", ") || "none"
    } | title=${summary.candidateTitleFields.join(", ") || "none"} | completed=${
      summary.candidateCompletedFlagFields.join(", ") || "none"
    }`,
  );
  console.log(
    `semantic_sample_counts: planned=${summary.semanticSampleCounts.plannedCandidates}, completed=${
      summary.semanticSampleCounts.completedCandidates
    }, planned_not_completed=${summary.semanticSampleCounts.plannedButNotCompletedCandidates}, planned_and_completed=${
      summary.semanticSampleCounts.plannedAndCompletedCandidates
    }, recent14d=${summary.semanticSampleCounts.recentWindowSamples}, future=${summary.semanticSampleCounts.futureSamples}`,
  );
  console.log(
    `normalized_sample_counts: normalized=${summary.normalizedSampleCounts.normalizedCount}, dropped=${summary.normalizedSampleCounts.droppedCount}, warnings=${summary.normalizedSampleCounts.warningCount}`,
  );
  console.log(
    `normalized_warning_samples: ${
      summary.normalizedSampleCounts.warningsSample.length ? summary.normalizedSampleCounts.warningsSample.join(" | ") : "none"
    }`,
  );
  console.log(
    `field_semantics_hypothesis: plannedDuration=${summary.fieldSemanticsHypothesis.likelyPlannedDurationField ?? "none"}, completedDuration=${
      summary.fieldSemanticsHypothesis.likelyCompletedDurationField ?? "none"
    }, plannedDistance=${summary.fieldSemanticsHypothesis.likelyPlannedDistanceField ?? "none"}, completedDistance=${
      summary.fieldSemanticsHypothesis.likelyCompletedDistanceField ?? "none"
    }, completionIndicator=${summary.fieldSemanticsHypothesis.likelyCompletionIndicator ?? "none"}, confidence=${
      summary.fieldSemanticsHypothesis.confidence
    }`,
  );
  console.log(
    `field_semantics_blockers: ${
      summary.fieldSemanticsHypothesis.blockersForNormalization.length
        ? summary.fieldSemanticsHypothesis.blockersForNormalization.join(" | ")
        : "none"
    }`,
  );
  console.log(`first_pass_normalization_contract: ${summary.firstPassNormalizationContract}`);
  console.log(`task2_normalization_contract_sufficient: ${summary.normalizationContractSufficient ? "yes" : "no"}`);
  console.log("--- direct_get_validation ---");
  console.log(`endpoint: ${summary.directGetValidation.endpoint}`);
  console.log(`method: ${summary.directGetValidation.method}`);
  console.log(`status_code: ${summary.directGetValidation.statusCode ?? "unknown"}`);
  console.log(`ok: ${summary.directGetValidation.ok ? "true" : "false"}`);
  console.log(`requested_range: ${summary.directGetValidation.requestedFrom} -> ${summary.directGetValidation.requestedTo}`);
  console.log(`total_items: ${summary.directGetValidation.totalItems}`);
  console.log(`detected_item_path: ${summary.directGetValidation.detectedItemPath ?? "none"}`);
  console.log(
    `workout_day_min_max: ${summary.directGetValidation.minWorkoutDay ?? "unknown"} -> ${
      summary.directGetValidation.maxWorkoutDay ?? "unknown"
    }`,
  );
  console.log(
    `items_inside_outside_requested_range: inside=${summary.directGetValidation.itemsInsideRequestedRange}, before=${summary.directGetValidation.itemsBeforeRequestedRange}, after=${summary.directGetValidation.itemsAfterRequestedRange}`,
  );
  console.log(`endpoint_honors_requested_range: ${String(summary.directGetValidation.endpointHonorsRequestedRange)}`);
  console.log(
    `direct_planned_completed_counts: planned=${summary.directGetValidation.plannedCandidateCount}, completed=${summary.directGetValidation.completedCandidateCount}, planned_not_completed=${summary.directGetValidation.plannedButNotCompletedCount}, planned_and_completed=${summary.directGetValidation.plannedAndCompletedCount}`,
  );
  console.log(
    `direct_field_semantics_hypothesis: plannedDuration=${summary.directGetValidation.fieldSemanticsHypothesis.likelyPlannedDurationField ?? "none"}, completedDuration=${
      summary.directGetValidation.fieldSemanticsHypothesis.likelyCompletedDurationField ?? "none"
    }, plannedDistance=${summary.directGetValidation.fieldSemanticsHypothesis.likelyPlannedDistanceField ?? "none"}, completedDistance=${
      summary.directGetValidation.fieldSemanticsHypothesis.likelyCompletedDistanceField ?? "none"
    }, completionIndicator=${summary.directGetValidation.fieldSemanticsHypothesis.likelyCompletionIndicator ?? "none"}, confidence=${
      summary.directGetValidation.fieldSemanticsHypothesis.confidence
    }`,
  );
  console.log(`direct_get_sufficient_for_cache: ${summary.directGetValidation.directGetSufficientForCache ? "true" : "false"}`);
  console.log(
    `direct_get_blockers: ${summary.directGetValidation.blockers.length ? summary.directGetValidation.blockers.join(" | ") : "none"}`,
  );
  console.log(`workouts_schema_artifact: ${summary.workoutsArtifactPath}`);
  console.log(`workouts_semantic_samples_artifact: ${summary.semanticSamplesArtifactPath}`);
  console.log(`workouts_direct_get_validation_artifact: ${summary.directGetValidationArtifactPath}`);
  console.log(`artifact_dir: ${summary.artifactDir}`);
}

main().catch((error: unknown) => {
  console.error("tp-discover-workouts-api failed.");
  console.error(error);
  process.exit(1);
});
