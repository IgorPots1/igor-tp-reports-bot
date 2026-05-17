import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, reportsRoot } from "./lib/paths.ts";
import { readStudentsConfig, type StudentConfig } from "./lib/students.ts";
import { captureSessionAuth, redactUnknown } from "./lib/trainingpeaks-api-move.ts";

const SCAN_ROOT = path.join(reportsRoot, "races-scan");
const APP_HOST = "https://app.trainingpeaks.com";
const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const EVENTS_ENDPOINT_TEMPLATE = "/fitness/v6/athletes/{athleteId}/events/{from}/{to}";
const DEFAULT_LIMIT = 15;

type CliArgs = {
  from: string;
  to: string;
  limit: number;
  athleteId: number | null;
  student: string | null;
  headed: boolean;
};

type RaceRow = {
  student_name: string;
  athlete_id: number | null;
  event_date: string | null;
  event_title: string | null;
  sport_type: string | null;
  distance: string | null;
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
  request_ok: boolean | null;
  extracted_count: number;
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
    athleteId: null,
    student: null,
    headed: false,
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

function formatDistanceKm(rawDistance: unknown): { distance: string | null; raw: string | null } {
  if (rawDistance === null || rawDistance === undefined) {
    return { distance: null, raw: null };
  }
  const raw = typeof rawDistance === "string" ? rawDistance.trim() : String(rawDistance);
  if (!raw) {
    return { distance: null, raw: null };
  }
  const normalized = raw.replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { distance: raw, raw };
  }
  const kilometers = numeric / 1000;
  const roundedOne = Math.round(kilometers * 10) / 10;
  const rendered = Number.isInteger(roundedOne) ? String(roundedOne) : roundedOne.toFixed(1);
  return { distance: `${rendered} км`, raw };
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
      .map((item) => (typeof item === "string" ? item.trim() : String(item)))
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
    const goal = sanitizeGoalValue(goalValue);
    const keyCount = ["eventdate", "eventtitle", "eventname", "name", "sporttype", "eventtype", "distance", "goal", "goals", "description"].filter((k) =>
      Object.keys(eventObj).some((actual) => actual.toLowerCase() === k),
    ).length;
    const confidence = Math.min(1, 0.25 + keyCount * 0.08);
    const notesParts = [`event_fields_matched=${keyCount}`];
    if (distanceParsed.raw !== null) {
      notesParts.push(`distance_raw=${distanceParsed.raw}`);
    }

    rows.push({
      student_name: input.student.name ?? input.student.student_id,
      athlete_id: input.athleteId,
      event_date: eventDate,
      event_title: title,
      sport_type: sportType,
      distance: distanceParsed.distance,
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
      lines.push(
        `- ${row.student_name} | ${row.event_date ?? "n/a"} | ${row.event_title ?? "untitled"} | ${row.distance ?? "n/a"} | confidence=${row.confidence}`,
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const students = await readStudentsConfig();
  const activeOnly = students.filter((student) => student.is_active !== false);
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
        request_ok: null,
        extracted_count: 0,
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
      request_ok: null,
      extracted_count: 0,
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
        request_ok: null,
        extracted_count: 0,
        error: null,
      });
    }
  }

  const limitedStudents = selectedStudents.slice(0, args.limit);
  const timestamp = timestampForPath(new Date());
  const outputDir = path.join(SCAN_ROOT, timestamp);
  const racesJsonPath = path.join(outputDir, "races.json");
  const racesCsvPath = path.join(outputDir, "races.csv");
  const racesMdPath = path.join(outputDir, "races.md");
  const scanLogPath = path.join(outputDir, "scan-log.json");
  const eventsApiDebugPath = path.join(outputDir, "events-api-debug.json");
  await mkdir(profileDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });

  const races: RaceRow[] = [];
  const eventsApiDebug: AthleteApiDebug[] = [];
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    for (const item of limitedStudents) {
      const student = item.student;
      const athleteId = item.athleteId;
      const logEntry = logs.find((log) => log.student_id === student.student_id && log.selected);
      try {
        await page.goto(`${APP_HOST}/#calendar/athletes/${athleteId}`, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        const auth = await captureSessionAuth({ context, page, athleteId });

        const requestUrl = buildEventsUrl(athleteId, args.from, args.to);
        logEntry!.request_url = requestUrl;

        const response = await page.request.fetch(requestUrl, {
          method: "GET",
          headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            ...(auth.authorizationHeader ? { authorization: auth.authorizationHeader } : {}),
          },
          failOnStatusCode: false,
        });

        logEntry!.request_status = response.status();
        logEntry!.request_ok = response.ok();

        let parsed: unknown = null;
        try {
          parsed = await response.json();
        } catch {
          parsed = await response.text();
        }
        const redacted = redactUnknown(parsed);
        const shape = summarizeResponseShape(redacted);
        const parsedResult = parseRacesFromPayload({
          payload: redacted,
          student,
          athleteId,
          from: args.from,
          to: args.to,
        });
        const hasEventLikeKeys =
          shape.nested_keys_summary.some((key) => /event|sport|distance|goal|race|name/i.test(key)) ||
          parsedResult.debug.raw_items_found > 0;
        eventsApiDebug.push({
          student_id: student.student_id,
          student_name: student.name ?? student.student_id,
          athlete_id: athleteId,
          endpoint_url_pattern: EVENTS_ENDPOINT_TEMPLATE,
          request_url: requestUrl,
          http_status: response.status(),
          response_shape: shape,
          parser_debug: parsedResult.debug,
          contains_event_like_data: hasEventLikeKeys,
        });
        logEntry!.extracted_count = parsedResult.rows.length;
        races.push(...parsedResult.rows);
        // #region agent log
        fetch("http://127.0.0.1:7521/ingest/adcbf755-c5c9-4a78-9e7d-4a590fbeae5c", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "819926" },
          body: JSON.stringify({
            sessionId: "819926",
            runId: `${student.student_id}:${athleteId}:${args.from}:${args.to}`,
            hypothesisId: "H1_H4",
            location: "tp-scan-events.ts:response-shape",
            message: "Captured response shape for events endpoint",
            data: {
              athleteId,
              status: response.status(),
              topLevelType: shape.top_level_type,
              arrayLength: shape.array_length,
              topLevelKeys: shape.top_level_keys.slice(0, 20),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        // #region agent log
        fetch("http://127.0.0.1:7521/ingest/adcbf755-c5c9-4a78-9e7d-4a590fbeae5c", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "819926" },
          body: JSON.stringify({
            sessionId: "819926",
            runId: `${student.student_id}:${athleteId}:${args.from}:${args.to}`,
            hypothesisId: "H2_H3",
            location: "tp-scan-events.ts:parser-debug",
            message: "Parser candidate/skip summary",
            data: {
              athleteId,
              rawItemsFound: parsedResult.debug.raw_items_found,
              emittedRows: parsedResult.debug.emitted_rows,
              candidateArrays: parsedResult.debug.candidate_event_arrays.slice(0, 10).map((item) => ({
                path: item.path,
                length: item.length,
                eventLikeItems: item.event_like_items,
              })),
              skippedItems: parsedResult.debug.skipped_items.slice(0, 10).map((item) => ({
                index: item.index,
                reason: item.reason,
              })),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      } catch (error) {
        logEntry!.error = (error as Error).message;
        // #region agent log
        fetch("http://127.0.0.1:7521/ingest/adcbf755-c5c9-4a78-9e7d-4a590fbeae5c", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "819926" },
          body: JSON.stringify({
            sessionId: "819926",
            runId: `${student.student_id}:${athleteId}:${args.from}:${args.to}`,
            hypothesisId: "H4",
            location: "tp-scan-events.ts:request-error",
            message: "Events request failed before parser",
            data: {
              athleteId,
              error: (error as Error).message,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

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
}

main().catch((error: unknown) => {
  console.error("tp-scan-events failed.");
  console.error(error);
  process.exit(1);
});
