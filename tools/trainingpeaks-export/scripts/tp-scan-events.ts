import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import type { TrainingPeaksStudent } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { profileDir, reportsRoot, toolRoot } from "./lib/paths.ts";
import type { StudentConfig } from "./lib/students.ts";
import { captureSessionAuth, redactUnknown } from "./lib/trainingpeaks-api-move.ts";

const SCAN_ROOT = path.join(reportsRoot, "races-scan");
const APP_HOST = "https://app.trainingpeaks.com";
const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const EVENTS_ENDPOINT_TEMPLATE = "/fitness/v6/athletes/{athleteId}/events/{from}/{to}";
const DEFAULT_LIMIT = 15;
const DEFAULT_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;
const ATHLETE_REQUEST_TIMEOUT_MS = 30_000;

type CliArgs = {
  from: string;
  to: string;
  limit: number;
  concurrency: number;
  athleteId: number | null;
  student: string | null;
  headed: boolean;
  delayMs: number;
};

type RaceRow = {
  student_name: string;
  athlete_id: number | null;
  event_date: string | null;
  event_title: string | null;
  sport_type: string | null;
  distance: string | null;
  /** true when the event distance cannot be trusted (missing/zero, or ultra placeholder
   *  >100km as seen on backyard/last-one-standing). A MARK for review, not a drop — the
   *  event still counts as a race; only its distance value is flagged unreliable. */
  distance_suspect: boolean;
  distance_suspect_reason: string | null;
  goal: string | null;
  description: string | null;
  confidence: number;
  notes: string;
};

type ScanLogEntry = {
  student_id: string;
  student_name: string;
  athlete_id: number | null;
  selected: boolean;
  reason: string;
  request_url: string | null;
  request_status: number | null;
  http_status: number | null;
  request_ok: boolean | null;
  extracted_count: number;
  request_started_at: string | null;
  request_finished_at: string | null;
  request_ms: number | null;
  parse_ms: number;
  total_ms: number | null;
  attempts: number;
  timed_out: boolean;
  retry_reason: string | null;
  auth_refreshed_before_retry: boolean;
  error: string | null;
};

type ResponseShapeDebug = {
  top_level_type: "array" | "object" | "null" | "primitive";
  top_level_keys: string[];
  array_length: number | null;
  preview_items: unknown[];
  nested_keys_summary: string[];
};

type CandidateArrayDebug = {
  path: string;
  length: number;
  object_items: number;
  event_like_items: number;
  sample_item_keys: string[];
};

type ParserSkipDebug = {
  index: number;
  reason: string;
  event_date: string | null;
  event_title: string | null;
  keys: string[];
};

type ParserDebug = {
  raw_items_found: number;
  emitted_rows: number;
  candidate_event_arrays: CandidateArrayDebug[];
  skipped_items: ParserSkipDebug[];
};

type AthleteApiDebug = {
  student_id: string;
  student_name: string;
  athlete_id: number;
  endpoint_url_pattern: string;
  request_url: string;
  http_status: number | null;
  response_shape: ResponseShapeDebug;
  parser_debug: ParserDebug;
  contains_event_like_data: boolean;
};

type RepositoryCompat = {
  listTrainingPeaksActiveStudentsForEventScan?: () => Promise<TrainingPeaksStudent[]>;
  default?: {
    listTrainingPeaksActiveStudentsForEventScan?: () => Promise<TrainingPeaksStudent[]>;
  };
};

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];
  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function mapStudentForEventScan(student: TrainingPeaksStudent): StudentConfig {
  return {
    student_id: student.studentId,
    name: student.studentName,
    trainingpeaks_athlete_url: student.trainingPeaksAthleteUrl,
    is_active: student.isActive,
    weekly_report_enabled: student.weeklyReportEnabled,
    data_quality_status: student.dataQualityStatus ?? undefined,
    notes: student.notes ?? undefined,
  };
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function ensureIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${label} date "${value}". Expected YYYY-MM-DD.`);
  }
  return value;
}

function parseAthleteIdFromUrl(athleteUrl: string): number | null {
  const match = athleteUrl.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    athleteId: null,
    student: null,
    headed: false,
    delayMs: 0,
  };

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      out.from = ensureIsoDate(arg.slice("--from=".length).trim(), "--from");
      continue;
    }
    if (arg.startsWith("--to=")) {
      out.to = ensureIsoDate(arg.slice("--to=".length).trim(), "--to");
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length).trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      out.limit = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      const parsed = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --athlete-id value: ${arg}`);
      }
      out.athleteId = parsed;
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      const parsed = Number(arg.slice("--concurrency=".length).trim());
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid --concurrency value: ${arg}`);
      }
      out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.floor(parsed)));
      continue;
    }
    if (arg.startsWith("--delay-ms=")) {
      const parsed = Number(arg.slice("--delay-ms=".length).trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --delay-ms value: ${arg}`);
      }
      out.delayMs = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith("--student=")) {
      const value = arg.slice("--student=".length).trim();
      out.student = value || null;
      continue;
    }
    if (arg === "--headed") {
      out.headed = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!out.from || !out.to) {
    throw new Error("Missing required args --from=YYYY-MM-DD and --to=YYYY-MM-DD.");
  }
  if (out.from > out.to) {
    throw new Error("--from must be <= --to.");
  }

  return out as CliArgs;
}

function buildEventsUrl(athleteId: number, from: string, to: string): string {
  const endpoint = EVENTS_ENDPOINT_TEMPLATE
    .replace("{athleteId}", String(athleteId))
    .replace("{from}", from)
    .replace("{to}", to);
  return `${TP_API_HOST}${endpoint}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickFirstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return null;
}

function pickFirstNonEmpty(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}

function formatDistanceKm(rawDistance: unknown): { distance: string | null; raw: string | null; km: number | null } {
  if (rawDistance === null || rawDistance === undefined) {
    return { distance: null, raw: null, km: null };
  }
  const raw = typeof rawDistance === "string" ? rawDistance.trim() : String(rawDistance);
  if (!raw) {
    return { distance: null, raw: null, km: null };
  }
  const normalized = raw.replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    // km is 0 for an explicit "0" (a real, suspect zero); null when non-numeric.
    return { distance: raw, raw, km: Number.isFinite(numeric) ? numeric / 1000 : null };
  }
  const kilometers = numeric / 1000;
  const roundedOne = Math.round(kilometers * 10) / 10;
  const rendered = Number.isInteger(roundedOne) ? String(roundedOne) : roundedOne.toFixed(1);
  return { distance: `${rendered} км`, raw, km: kilometers };
}

/** Render one `written` goal entry. TP returns these as objects (e.g. { text, ... }),
 *  so String(item) produced "[object Object]". Pull a human field, else compact JSON. */
function renderWrittenGoal(item: unknown): string {
  if (item === null || item === undefined) return "";
  if (typeof item === "string") return item.trim();
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (isRecord(item)) {
    for (const key of ["text", "value", "note", "statement", "description", "goal", "content", "name"]) {
      const v = item[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    try {
      return JSON.stringify(item);
    } catch {
      return "";
    }
  }
  return "";
}

function sanitizeGoalValue(rawGoal: unknown): string | null {
  if (rawGoal === null || rawGoal === undefined) return null;

  let goalValue: unknown = rawGoal;
  if (typeof rawGoal === "string") {
    const trimmed = rawGoal.trim();
    if (!trimmed) return null;
    try {
      goalValue = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (typeof goalValue === "number" || typeof goalValue === "boolean") {
    return String(goalValue);
  }
  if (!isRecord(goalValue)) {
    return null;
  }

  const distance = goalValue.distance;
  const time = goalValue.time;
  const place = goalValue.place;
  const finish = goalValue.finish;
  const pr = goalValue.pr;
  const written = goalValue.written;

  const parts: string[] = [];
  if (typeof distance === "string" && distance.trim()) parts.push(`distance=${distance.trim()}`);
  else if (typeof distance === "number" && Number.isFinite(distance)) parts.push(`distance=${distance}`);
  if (typeof time === "string" && time.trim()) parts.push(`time=${time.trim()}`);
  if (typeof place === "string" && place.trim()) parts.push(`place=${place.trim()}`);
  if (typeof finish === "string" && finish.trim()) parts.push(`finish=${finish.trim()}`);
  if (typeof pr === "string" && pr.trim()) parts.push(`pr=${pr.trim()}`);
  if (typeof pr === "boolean") parts.push(`pr=${pr ? "yes" : "no"}`);
  if (Array.isArray(written) && written.length > 0) {
    const renderedWritten = written
      .map((item) => renderWrittenGoal(item))
      .filter((item) => item.length > 0)
      .join(" | ");
    if (renderedWritten) parts.push(`written=${renderedWritten}`);
  }

  return parts.length > 0 ? parts.join("; ") : null;
}

function pickEventDate(record: Record<string, unknown>): string | null {
  const raw = pickFirstString(record, ["EventDate", "eventDate", "Date", "date"]);
  if (!raw) return null;
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}/);
  return isoMatch ? isoMatch[0] : raw;
}

function summarizeShapeType(value: unknown): "array" | "object" | "null" | "primitive" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return "primitive";
}

function toPreview(value: unknown, depth = 0): unknown {
  if (depth >= 3) return "[truncated-depth]";
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => toPreview(item, depth + 1));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value).slice(0, 15)) {
      out[key] = toPreview(inner, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > 300 ? `${value.slice(0, 300)}...[truncated]` : value;
  }
  return value;
}

function collectNestedKeySummary(input: unknown, maxDepth = 3): string[] {
  const found = new Set<string>();
  const seen = new Set<unknown>();

  function visit(node: unknown, pathPrefix: string, depth: number): void {
    if (depth > maxDepth || node === null || node === undefined) return;
    if (typeof node === "object") {
      if (seen.has(node)) return;
      seen.add(node);
    }
    if (Array.isArray(node)) {
      found.add(`${pathPrefix || "$"}[]`);
      for (let index = 0; index < Math.min(node.length, 3); index += 1) {
        visit(node[index], `${pathPrefix || "$"}[]`, depth + 1);
      }
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      found.add(nextPath);
      visit(value, nextPath, depth + 1);
    }
  }

  visit(input, "", 0);
  return [...found].sort().slice(0, 150);
}

function summarizeResponseShape(payload: unknown): ResponseShapeDebug {
  const topLevelType = summarizeShapeType(payload);
  return {
    top_level_type: topLevelType,
    top_level_keys: isRecord(payload) ? Object.keys(payload).slice(0, 80) : [],
    array_length: Array.isArray(payload) ? payload.length : null,
    preview_items: Array.isArray(payload)
      ? payload.slice(0, 3).map((item) => toPreview(item))
      : isRecord(payload)
        ? [toPreview(payload)]
        : [toPreview(payload)],
    nested_keys_summary: collectNestedKeySummary(payload, 3),
  };
}

function looksLikeEventRecord(record: Record<string, unknown>): boolean {
  const keysLower = Object.keys(record).map((key) => key.toLowerCase());
  const eventHints = new Set([
    "eventdate",
    "eventtype",
    "sporttype",
    "distance",
    "goal",
    "goals",
    "description",
    "eventtitle",
    "eventname",
    "name",
    "title",
  ]);
  return keysLower.some((key) => eventHints.has(key));
}

function flattenEventCandidatesWithDebug(input: unknown): {
  eventObjects: Record<string, unknown>[];
  candidateArrays: CandidateArrayDebug[];
} {
  const found: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const dedupe = new Set<string>();
  const candidateArrays: CandidateArrayDebug[] = [];

  function visit(node: unknown, pathName: string): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      const objectItems = node.filter((item) => isRecord(item));
      if (objectItems.length > 0) {
        const eventLikeItems = objectItems.filter((item) => looksLikeEventRecord(item)).length;
        const sampleItem = objectItems[0] ?? null;
        candidateArrays.push({
          path: pathName || "$",
          length: node.length,
          object_items: objectItems.length,
          event_like_items: eventLikeItems,
          sample_item_keys: sampleItem ? Object.keys(sampleItem).slice(0, 20) : [],
        });
      }
      for (let index = 0; index < node.length; index += 1) {
        visit(node[index], `${pathName || "$"}[${index}]`);
      }
      return;
    }

    const record = node;
    if (isRecord(record) && looksLikeEventRecord(record)) {
      const eventDate = pickEventDate(record) ?? "";
      const eventTitle = pickFirstString(record, ["EventTitle", "eventTitle", "EventName", "eventName", "Name", "name", "Title", "title"]) ?? "";
      const eventType = pickFirstString(record, ["EventType", "eventType", "SportType", "sportType"]) ?? "";
      const key = [eventDate, eventTitle, eventType].join("|").toLowerCase();
      if (!dedupe.has(key)) {
        dedupe.add(key);
        found.push(record);
      }
    }

    for (const [key, value] of Object.entries(record)) {
      visit(value, pathName ? `${pathName}.${key}` : key);
    }
  }

  visit(input, "");
  return { eventObjects: found, candidateArrays };
}

function parseRacesFromPayload(input: {
  payload: unknown;
  student: StudentConfig;
  athleteId: number | null;
  from: string;
  to: string;
}): { rows: RaceRow[]; debug: ParserDebug } {
  const { eventObjects, candidateArrays } = flattenEventCandidatesWithDebug(input.payload);
  const rows: RaceRow[] = [];
  const skippedItems: ParserSkipDebug[] = [];

  for (const [index, eventObj] of eventObjects.entries()) {
    const eventDate = pickEventDate(eventObj);
    const title = pickFirstString(eventObj, ["EventTitle", "eventTitle", "EventName", "eventName", "Name", "name", "Title", "title"]);
    if (!eventDate && !title) {
      skippedItems.push({
        index,
        reason: "skipped_empty_event_like_item",
        event_date: null,
        event_title: null,
        keys: Object.keys(eventObj).slice(0, 20),
      });
      continue;
    }

    if (eventDate && (eventDate < input.from || eventDate > input.to)) {
      skippedItems.push({
        index,
        reason: `event_date_out_of_range (${eventDate})`,
        event_date: eventDate,
        event_title: title,
        keys: Object.keys(eventObj).slice(0, 20),
      });
      continue;
    }

    const sportType = pickFirstString(eventObj, ["SportType", "sportType", "EventType", "eventType"]);
    // Quality gate: the events feed also carries non-running starts (triathlon, walking,
    // bike/swim). Those are not running races and must not reach race_events. A present,
    // non-"Running*" sport type is dropped; a missing sport type is kept (ambiguous → do
    // not over-filter a real race). Running surfaces (RunningRoad/Trail/Track/Other/...) pass.
    if (sportType && !/^running/i.test(sportType.trim())) {
      skippedItems.push({
        index,
        reason: `non_running_event_type (${sportType})`,
        event_date: eventDate,
        event_title: title,
        keys: Object.keys(eventObj).slice(0, 20),
      });
      continue;
    }
    const distanceValue = pickFirstNonEmpty(eventObj, ["Distance", "distance"]);
    const goalValue = pickFirstNonEmpty(eventObj, ["Goals", "goals", "Goal", "goal"]);
    const descriptionValue = pickFirstNonEmpty(eventObj, ["Description", "description", "Notes", "notes"]);
    const description =
      descriptionValue === null
        ? null
        : typeof descriptionValue === "string"
          ? descriptionValue
          : JSON.stringify(descriptionValue);
    const distanceParsed = formatDistanceKm(distanceValue);
    // Distance sanity: TP's event distance is unreliable for ultra/backyard (a 50km
    // backyard stores "100000", a 33km walk stores "0"). Do NOT trust the value — MARK it.
    // The date is what drives race classification; distance is advisory, so we keep the
    // row but flag the number so no downstream reader (threshold tiers) trusts it blindly.
    let distanceSuspect = false;
    let distanceSuspectReason: string | null = null;
    if (distanceParsed.raw === null || distanceParsed.km === 0) {
      distanceSuspect = true;
      distanceSuspectReason = "zero_or_missing";
    } else if (distanceParsed.km !== null && distanceParsed.km > 100) {
      distanceSuspect = true;
      distanceSuspectReason = "ultra_verify_gt_100km";
    }
    const goal = sanitizeGoalValue(goalValue);
    const keyCount = ["eventdate", "eventtitle", "eventname", "name", "sporttype", "eventtype", "distance", "goal", "goals", "description"].filter((k) =>
      Object.keys(eventObj).some((actual) => actual.toLowerCase() === k),
    ).length;
    const confidence = Math.min(1, 0.25 + keyCount * 0.08);
    const notesParts = [`event_fields_matched=${keyCount}`];
    if (distanceParsed.raw !== null) {
      notesParts.push(`distance_raw=${distanceParsed.raw}`);
    }
    if (distanceSuspect) {
      notesParts.push(`distance_suspect=${distanceSuspectReason}`);
    }

    rows.push({
      student_name: input.student.name ?? input.student.student_id,
      athlete_id: input.athleteId,
      event_date: eventDate,
      event_title: title,
      sport_type: sportType,
      distance: distanceParsed.distance,
      distance_suspect: distanceSuspect,
      distance_suspect_reason: distanceSuspectReason,
      goal,
      description,
      confidence: Number(confidence.toFixed(2)),
      notes: notesParts.join("; "),
    });
  }

  return {
    rows,
    debug: {
      raw_items_found: eventObjects.length,
      emitted_rows: rows.length,
      candidate_event_arrays: candidateArrays,
      skipped_items: skippedItems,
    },
  };
}

function csvEscape(value: string): string {
  const needsQuotes = /[",\n]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: RaceRow[]): string {
  const headers: Array<keyof RaceRow> = [
    "student_name",
    "athlete_id",
    "event_date",
    "event_title",
    "sport_type",
    "distance",
    "distance_suspect",
    "distance_suspect_reason",
    "goal",
    "description",
    "confidence",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => {
          const raw = row[header];
          const rendered = raw === null || raw === undefined ? "" : String(raw);
          return csvEscape(rendered);
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function toMarkdownReport(input: {
  args: CliArgs;
  selectedCount: number;
  rows: RaceRow[];
  logs: ScanLogEntry[];
  outputDir: string;
}): string {
  const lines: string[] = [];
  lines.push("# TrainingPeaks races scan");
  lines.push("");
  lines.push(`- run_at: \`${new Date().toISOString()}\``);
  lines.push(`- from: \`${input.args.from}\``);
  lines.push(`- to: \`${input.args.to}\``);
  lines.push(`- selected_athletes: **${input.selectedCount}**`);
  lines.push(`- races_found: **${input.rows.length}**`);
  lines.push(`- endpoint: \`${EVENTS_ENDPOINT_TEMPLATE}\``);
  lines.push("- request_mode: GET only");
  lines.push("");
  lines.push("## Top rows");
  if (!input.rows.length) {
    lines.push("- No event rows found in selected range.");
  } else {
    for (const row of input.rows.slice(0, 10)) {
      const distSuspect = row.distance_suspect ? ` [!] distance_suspect=${row.distance_suspect_reason}` : "";
      lines.push(
        `- ${row.student_name} | ${row.event_date ?? "n/a"} | ${row.event_title ?? "untitled"} | ${row.distance ?? "n/a"}${distSuspect} | confidence=${row.confidence}`,
      );
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- GET-only scanner; no UI clicks.");
  lines.push(`- Output directory: \`${input.outputDir}\``);
  lines.push("");
  lines.push("## Per-athlete log");
  for (const log of input.logs) {
    lines.push(
      `- ${log.student_name} (${log.athlete_id ?? "n/a"}): status=${log.request_status ?? "n/a"} extracted=${log.extracted_count} ${log.error ? `error=${log.error}` : ""}`.trim(),
    );
  }
  return `${lines.join("\n")}\n`;
}

function studentMatchesFilter(student: StudentConfig, args: CliArgs, athleteId: number | null): { ok: boolean; reason: string } {
  if (args.student) {
    const wanted = args.student.toLowerCase();
    const idMatch = student.student_id.toLowerCase() === wanted;
    const nameMatch = (student.name ?? "").toLowerCase() === wanted;
    if (!idMatch && !nameMatch) {
      return { ok: false, reason: "filtered by --student" };
    }
  }
  if (args.athleteId && athleteId !== args.athleteId) {
    return { ok: false, reason: "filtered by --athlete-id" };
  }
  return { ok: true, reason: "selected" };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout/i.test(message);
}

function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /network|econn|socket|connect|fetch failed|dns|getaddrinfo|enotfound|eai_again/i.test(message);
}

function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await handler(items[idx]!);
    }
  });
  await Promise.all(workers);
}

async function loadStudentsForEventScan(): Promise<StudentConfig[]> {
  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn =
    repoCompat.listTrainingPeaksActiveStudentsForEventScan ??
    repoCompat.default?.listTrainingPeaksActiveStudentsForEventScan;

  if (!listStudentsFn) {
    throw new Error("TrainingPeaks repository helper listTrainingPeaksActiveStudentsForEventScan is unavailable.");
  }

  const students = await listStudentsFn();
  return students.map(mapStudentForEventScan);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const totalScanStartedAtMs = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const students = await loadStudentsForEventScan();
  const activeOnly = students.filter((student) => student.is_active !== false);
  const weeklyEnabledCount = activeOnly.filter((student) => student.weekly_report_enabled).length;
  const weeklyDisabledIncludedCount = activeOnly.length - weeklyEnabledCount;
  const selectedStudents: Array<{ student: StudentConfig; athleteId: number }> = [];
  const logs: ScanLogEntry[] = [];

  for (const student of activeOnly) {
    const athleteId = parseAthleteIdFromUrl(student.trainingpeaks_athlete_url);
    const matches = studentMatchesFilter(student, args, athleteId);
    if (!matches.ok || athleteId === null) {
      logs.push({
        student_id: student.student_id,
        student_name: student.name ?? student.student_id,
        athlete_id: athleteId,
        selected: false,
        reason: athleteId === null ? "missing athlete id in URL" : matches.reason,
        request_url: null,
        request_status: null,
        http_status: null,
        request_ok: null,
        extracted_count: 0,
        request_started_at: null,
        request_finished_at: null,
        request_ms: null,
        parse_ms: 0,
        total_ms: null,
        attempts: 0,
        timed_out: false,
        retry_reason: null,
        auth_refreshed_before_retry: false,
        error: athleteId === null ? "Cannot parse athlete id" : null,
      });
      continue;
    }

    selectedStudents.push({ student, athleteId });
    logs.push({
      student_id: student.student_id,
      student_name: student.name ?? student.student_id,
      athlete_id: athleteId,
      selected: true,
      reason: "selected",
      request_url: null,
      request_status: null,
      http_status: null,
      request_ok: null,
      extracted_count: 0,
      request_started_at: null,
      request_finished_at: null,
      request_ms: null,
      parse_ms: 0,
      total_ms: null,
      attempts: 0,
      timed_out: false,
      retry_reason: null,
      auth_refreshed_before_retry: false,
      error: null,
    });
  }

  if (args.athleteId) {
    const hasSelectedDirectAthlete = selectedStudents.some((entry) => entry.athleteId === args.athleteId);
    if (!hasSelectedDirectAthlete) {
      console.log(
        `[tp-scan-events] athlete-id ${args.athleteId} not found in config; scanning direct athlete id`,
      );
      const directAthleteStudent: StudentConfig = {
        student_id: `athlete-${args.athleteId}`,
        name: `Athlete ${args.athleteId}`,
        trainingpeaks_athlete_url: `${APP_HOST}/#calendar/athletes/${args.athleteId}`,
        is_active: true,
        weekly_report_enabled: false,
      };
      selectedStudents.push({ student: directAthleteStudent, athleteId: args.athleteId });
      logs.push({
        student_id: directAthleteStudent.student_id,
        student_name: directAthleteStudent.name ?? directAthleteStudent.student_id,
        athlete_id: args.athleteId,
        selected: true,
        reason: "selected (direct athlete-id fallback)",
        request_url: null,
        request_status: null,
        http_status: null,
        request_ok: null,
        extracted_count: 0,
        request_started_at: null,
        request_finished_at: null,
        request_ms: null,
        parse_ms: 0,
        total_ms: null,
        attempts: 0,
        timed_out: false,
        retry_reason: null,
        auth_refreshed_before_retry: false,
        error: null,
      });
    }
  }

  const limitedStudents = selectedStudents.slice(0, args.limit);
  console.log(`[tp-scan-events] selected_students=${selectedStudents.length}`);
  console.log(`[tp-scan-events] weekly_enabled_count=${weeklyEnabledCount}`);
  console.log(`[tp-scan-events] weekly_disabled_included_count=${weeklyDisabledIncludedCount}`);
  console.log(`[tp-scan-events] scan_limit=${args.limit} scanning=${limitedStudents.length}`);
  const timestamp = timestampForPath(new Date());
  const outputDir = path.join(SCAN_ROOT, timestamp);
  const racesJsonPath = path.join(outputDir, "races.json");
  const racesCsvPath = path.join(outputDir, "races.csv");
  const racesMdPath = path.join(outputDir, "races.md");
  const scanLogPath = path.join(outputDir, "scan-log.json");
  const eventsApiDebugPath = path.join(outputDir, "events-api-debug.json");
  await mkdir(profileDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const playwrightLaunchStartedAtMs = Date.now();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });
  const playwrightLaunchMs = Date.now() - playwrightLaunchStartedAtMs;

  const races: RaceRow[] = [];
  const eventsApiDebug: AthleteApiDebug[] = [];
  const selectedLogByKey = new Map<string, ScanLogEntry>();
  for (const log of logs) {
    if (log.selected && log.athlete_id !== null) {
      selectedLogByKey.set(`${log.student_id}:${log.athlete_id}`, log);
    }
  }
  let requestsTotalMs = 0;
  let parseTotalMs = 0;
  const requestDurationsMs: number[] = [];
  let authCaptureMs = 0;
  let authRefreshedGlobally = false;
  let authRefreshInFlight: Promise<void> | null = null;
  let authorizationHeader: string | null = null;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    if (limitedStudents.length > 0) {
      const authCaptureStartedAtMs = Date.now();
      const auth = await captureSessionAuth({
        context,
        page,
        athleteId: limitedStudents[0]!.athleteId,
      });
      authorizationHeader = auth.authorizationHeader;
      authCaptureMs = Date.now() - authCaptureStartedAtMs;
    }

    const refreshAuthOnceGlobal = async (athleteId: number): Promise<void> => {
      if (authRefreshedGlobally) return;
      if (authRefreshInFlight) {
        await authRefreshInFlight;
        return;
      }
      authRefreshInFlight = (async () => {
        const refreshed = await captureSessionAuth({ context, page, athleteId });
        authorizationHeader = refreshed.authorizationHeader;
        authRefreshedGlobally = true;
      })();
      try {
        await authRefreshInFlight;
      } finally {
        authRefreshInFlight = null;
      }
    };

    await runWithConcurrency(limitedStudents, args.concurrency, async (item) => {
      const student = item.student;
      const athleteId = item.athleteId;
      const logEntry = selectedLogByKey.get(`${student.student_id}:${athleteId}`);
      if (!logEntry) return;

      const requestUrl = buildEventsUrl(athleteId, args.from, args.to);
      logEntry.request_url = requestUrl;
      logEntry.request_started_at = new Date().toISOString();
      const athleteTotalStartedAtMs = Date.now();

      try {
        let finalParsedPayload: unknown = null;
        let finalStatus: number | null = null;
        let finalOk: boolean | null = null;
        let attempts = 0;
        let retryReason: string | null = null;
        let timedOut = false;
        let authRefreshedBeforeRetry = false;
        let requestMsAccumulated = 0;
        let parseMs = 0;

        while (attempts < 2) {
          attempts += 1;
          const requestAttemptStartedAtMs = Date.now();
          try {
            const response = await page.request.fetch(requestUrl, {
              method: "GET",
              headers: {
                accept: "application/json, text/javascript, */*; q=0.01",
                ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
              },
              failOnStatusCode: false,
              timeout: ATHLETE_REQUEST_TIMEOUT_MS,
            });
            requestMsAccumulated += Date.now() - requestAttemptStartedAtMs;
            finalStatus = response.status();
            finalOk = response.ok();

            if ((finalStatus === 401 || finalStatus === 403) && attempts === 1) {
              retryReason = `http_${finalStatus}_auth_refresh`;
              await refreshAuthOnceGlobal(athleteId);
              authRefreshedBeforeRetry = true;
              continue;
            }
            if (isTransientStatus(finalStatus) && attempts === 1) {
              retryReason = `http_${finalStatus}`;
              continue;
            }

            const parseResponseStartedAtMs = Date.now();
            try {
              finalParsedPayload = await response.json();
            } catch {
              finalParsedPayload = await response.text();
            }
            parseMs += Date.now() - parseResponseStartedAtMs;
            break;
          } catch (error) {
            requestMsAccumulated += Date.now() - requestAttemptStartedAtMs;
            timedOut = timedOut || isTimeoutError(error);
            const retryableError = timedOut || isNetworkError(error);
            if (attempts === 1 && retryableError) {
              retryReason = timedOut ? "timeout" : "network_error";
              continue;
            }
            throw error;
          }
        }

        const redacted = redactUnknown(finalParsedPayload);
        const shape = summarizeResponseShape(redacted);
        const parseScannerStartedAtMs = Date.now();
        const parsedResult = parseRacesFromPayload({
          payload: redacted,
          student,
          athleteId,
          from: args.from,
          to: args.to,
        });
        parseMs += Date.now() - parseScannerStartedAtMs;
        const hasEventLikeKeys =
          shape.nested_keys_summary.some((key) => /event|sport|distance|goal|race|name/i.test(key)) ||
          parsedResult.debug.raw_items_found > 0;
        eventsApiDebug.push({
          student_id: student.student_id,
          student_name: student.name ?? student.student_id,
          athlete_id: athleteId,
          endpoint_url_pattern: EVENTS_ENDPOINT_TEMPLATE,
          request_url: requestUrl,
          http_status: finalStatus,
          response_shape: shape,
          parser_debug: parsedResult.debug,
          contains_event_like_data: hasEventLikeKeys,
        });
        logEntry.request_status = finalStatus;
        logEntry.http_status = finalStatus;
        logEntry.request_ok = finalOk;
        logEntry.extracted_count = parsedResult.rows.length;
        logEntry.request_ms = requestMsAccumulated;
        logEntry.parse_ms = parseMs;
        logEntry.attempts = attempts;
        logEntry.timed_out = timedOut;
        logEntry.retry_reason = retryReason;
        logEntry.auth_refreshed_before_retry = authRefreshedBeforeRetry;
        logEntry.request_finished_at = new Date().toISOString();
        logEntry.total_ms = Date.now() - athleteTotalStartedAtMs;
        requestsTotalMs += requestMsAccumulated;
        parseTotalMs += parseMs;
        requestDurationsMs.push(requestMsAccumulated);
        races.push(...parsedResult.rows);
      } catch (error) {
        logEntry.error = (error as Error).message;
        logEntry.request_finished_at = new Date().toISOString();
        logEntry.total_ms = Date.now() - athleteTotalStartedAtMs;
      }
      // Throttle: space out requests so a large backward scan does not burst TP into
      // TLS socket disconnects (observed 62/113 failures at concurrency 3, 400-day window).
      // Default 0 → forward weekly scan behaves exactly as before.
      if (args.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, args.delayMs));
      }
    });
  } finally {
    await context.close().catch(() => {});
  }

  const artifactsWriteStartedAtMs = Date.now();
  await writeFile(
    racesJsonPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        args,
        endpoint: EVENTS_ENDPOINT_TEMPLATE,
        requestMethod: "GET",
        totalRows: races.length,
        rows: races,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(racesCsvPath, toCsv(races), "utf8");
  await writeFile(
    racesMdPath,
    toMarkdownReport({
      args,
      selectedCount: limitedStudents.length,
      rows: races,
      logs,
      outputDir,
    }),
    "utf8",
  );
  const artifactsWriteMs = Date.now() - artifactsWriteStartedAtMs;
  const totalScanMs = Date.now() - totalScanStartedAtMs;
  // Count ONLY athletes actually requested. `request_url` is set solely inside the request
  // loop, which iterates limitedStudents (selected sliced to --limit). The old filter counted
  // every SELECTED student incl. those sliced off and never fetched, so `scanned` reported the
  // whole roster (113) when only 15 were hit — a lie that caused a wrong read of the results.
  const attemptedLogs = logs.filter((entry) => entry.selected && entry.request_url !== null);
  const completedAthletes = attemptedLogs.filter((entry) => !entry.error).length;
  const failedAthletes = attemptedLogs.filter((entry) => Boolean(entry.error)).length;
  const p50RequestMs = Math.round(computePercentile(requestDurationsMs, 50));
  const p95RequestMs = Math.round(computePercentile(requestDurationsMs, 95));
  const maxRequestMs =
    requestDurationsMs.length > 0 ? Math.max(...requestDurationsMs.map((value) => Math.round(value))) : 0;
  await writeFile(
    scanLogPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        args,
        selectedStudents: limitedStudents.map((entry) => ({
          student_id: entry.student.student_id,
          student_name: entry.student.name ?? entry.student.student_id,
          athlete_id: entry.athleteId,
        })),
        timing: {
          total_scan_ms: totalScanMs,
          playwright_launch_ms: playwrightLaunchMs,
          auth_capture_ms: authCaptureMs,
          requests_total_ms: Math.round(requestsTotalMs),
          parse_total_ms: Math.round(parseTotalMs),
          artifacts_write_ms: artifactsWriteMs,
          concurrency: args.concurrency,
          selected_athletes: limitedStudents.length,
          completed_athletes: completedAthletes,
          failed_athletes: failedAthletes,
          p50_request_ms: p50RequestMs,
          p95_request_ms: p95RequestMs,
          max_request_ms: maxRequestMs,
        },
        logs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    eventsApiDebugPath,
    `${JSON.stringify(
      {
        runAt: new Date().toISOString(),
        args,
        endpoint: EVENTS_ENDPOINT_TEMPLATE,
        requestMethod: "GET",
        athletes: eventsApiDebug,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`[tp-scan-events] output=${outputDir}`);
  console.log(`[tp-scan-events] rows=${races.length}`);
  console.log(`[tp-scan-events] races.json=${racesJsonPath}`);
  console.log(`[tp-scan-events] races.csv=${racesCsvPath}`);
  console.log(`[tp-scan-events] races.md=${racesMdPath}`);
  console.log(`[tp-scan-events] scan-log.json=${scanLogPath}`);
  console.log(`[tp-scan-events] events-api-debug.json=${eventsApiDebugPath}`);
  console.log(
    `[tp-scan-events] selected=${selectedStudents.length} scanned=${completedAthletes + failedAthletes} rows=${races.length} total=${totalScanMs}ms auth=${authCaptureMs}ms p50=${p50RequestMs}ms p95=${p95RequestMs}ms concurrency=${args.concurrency}`,
  );
}

main().catch((error: unknown) => {
  console.error("tp-scan-events failed.");
  console.error(error);
  process.exit(1);
});
