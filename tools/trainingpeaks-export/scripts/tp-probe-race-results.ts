import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { readStudentsConfig, type StudentConfig } from "./lib/students.ts";
import { captureSessionAuth, performApiJsonRequest } from "./lib/trainingpeaks-api-move.ts";
import {
  normalizeTrainingPeaksWorkoutItems,
  type TrainingPeaksWorkoutRaw,
} from "./lib/trainingpeaks-workout-normalization.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";
const RUNNING_WORKOUT_TYPE_VALUE_ID = 3;

const DISTANCE_PRESETS: Record<string, { minMeters: number; maxMeters: number }> = {
  "5k": { minMeters: 4600, maxMeters: 5600 },
};

const RACE_TEXT_PATTERN =
  /\b(race|start|забег|соревнование|5k|5\s*km|5\s*км|parkrun)\b/i;

type CliArgs = {
  from: string;
  to: string;
  athleteId: number | null;
  athleteUrl: string | null;
  student: string | null;
  distancePreset: string | null;
  minKm: number | null;
  maxKm: number | null;
  headed: boolean;
};

type ResolvedTarget = {
  athleteId: number;
  athleteUrl: string;
  studentId: string | null;
  studentName: string | null;
};

type ApiFetchResult = {
  endpoint: string;
  status: number;
  ok: boolean;
  count: number;
  error: string | null;
};

type Clean5kCandidate = {
  workoutId: number;
  date: string;
  title: string | null;
  distance_km: number;
  duration_min: number;
  pace_min_per_km: number;
  avg_hr: number | null;
  tssActual: number | null;
  if: number | null;
  personalRecordCount: number | null;
  raceTypeDuration: unknown | null;
  confidence: number;
  reasons: string[];
};

type RaceLike5kCandidate = Clean5kCandidate & {
  race_signals: string[];
};

type PlannedRaceCandidate = {
  event_date: string | null;
  event_title: string | null;
  sport_type: string | null;
  distance: string | null;
  goal: string | null;
  description: string | null;
  matching_workout_ids: number[];
  confidence: number;
  reasons: string[];
};

type ExcludedSummary = {
  below_min_km: number;
  above_max_km: number;
  non_running: number;
  not_completed: number;
  out_of_date_range: number;
};

type ProbeReport = {
  run_at: string;
  athlete: {
    athlete_id: number;
    athlete_url: string;
    student_id: string | null;
    student_name: string | null;
  };
  range: { from: string; to: string };
  target_distance: string | null;
  distance_window: { min_km: number; max_km: number; min_meters: number; max_meters: number };
  workouts_scanned: number;
  data_sources: {
    workouts: ApiFetchResult;
    events: ApiFetchResult;
  };
  fields_available: string[];
  fields_missing: string[];
  planned_race_candidates: PlannedRaceCandidate[];
  race_like_5k_candidates: RaceLike5kCandidate[];
  clean_5k_candidates: Clean5kCandidate[];
  excluded_summary: ExcludedSummary;
  notes: string[];
  output_paths: {
    report_json: string;
    report_md: string;
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
  if (!existsSync(dotEnvPath)) return;
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) return;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
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
  for (const envPath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ]) {
    loadDotEnvFile(envPath);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toIsoDatePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match?.[1] ?? null;
}

function pickFirstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
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

function formatDistanceKm(rawDistance: unknown): { distance: string | null; meters: number | null } {
  if (rawDistance === null || rawDistance === undefined) {
    return { distance: null, meters: null };
  }
  const raw = typeof rawDistance === "string" ? rawDistance.trim() : String(rawDistance);
  if (!raw) return { distance: null, meters: null };
  const numeric = Number(raw.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { distance: raw, meters: null };
  }
  const kilometers = numeric / 1000;
  const roundedOne = Math.round(kilometers * 10) / 10;
  const rendered = Number.isInteger(roundedOne) ? String(roundedOne) : roundedOne.toFixed(1);
  return { distance: `${rendered} km`, meters: numeric };
}

function sanitizeGoalValue(rawGoal: unknown): string | null {
  if (rawGoal === null || rawGoal === undefined) return null;
  if (typeof rawGoal === "string") {
    const trimmed = rawGoal.trim();
    if (!trimmed) return null;
    try {
      return sanitizeGoalValue(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (typeof rawGoal === "number" || typeof rawGoal === "boolean") return String(rawGoal);
  if (!isRecord(rawGoal)) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(rawGoal)) {
    if (value === null || value === undefined) continue;
    parts.push(`${key}=${typeof value === "string" ? value.trim() : String(value)}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function pickEventDate(record: Record<string, unknown>): string | null {
  const raw = pickFirstString(record, ["EventDate", "eventDate", "Date", "date"]);
  if (!raw) return null;
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}/);
  return isoMatch ? isoMatch[0] : null;
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

function flattenEventCandidates(input: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const dedupe = new Set<string>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = node as Record<string, unknown>;
    if (looksLikeEventRecord(record)) {
      const eventDate = pickEventDate(record) ?? "";
      const eventTitle =
        pickFirstString(record, ["EventTitle", "eventTitle", "EventName", "eventName", "Name", "name", "Title", "title"]) ??
        "";
      const key = [eventDate, eventTitle].join("|").toLowerCase();
      if (!dedupe.has(key)) {
        dedupe.add(key);
        found.push(record);
      }
    }

    for (const value of Object.values(record)) visit(value);
  }

  visit(input);
  return found;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: "",
    to: "",
    athleteId: null,
    athleteUrl: null,
    student: null,
    distancePreset: null,
    minKm: null,
    maxKm: null,
    headed: false,
  };

  let targetCount = 0;

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      const athleteId = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(athleteId) || athleteId <= 0) {
        throw new Error(`Invalid --athlete-id value: ${arg}`);
      }
      parsed.athleteId = athleteId;
      targetCount += 1;
      continue;
    }
    if (arg.startsWith("--athlete-url=")) {
      const athleteUrl = arg.slice("--athlete-url=".length).trim();
      if (!athleteUrl) throw new Error("Empty --athlete-url value.");
      parsed.athleteUrl = athleteUrl;
      targetCount += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      const student = arg.slice("--student=".length).trim();
      if (!student) throw new Error("Empty --student value.");
      parsed.student = student;
      targetCount += 1;
      continue;
    }
    if (arg.startsWith("--distance=")) {
      parsed.distancePreset = arg.slice("--distance=".length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith("--min-km=")) {
      const minKm = Number(arg.slice("--min-km=".length).trim());
      if (!Number.isFinite(minKm) || minKm <= 0) throw new Error(`Invalid --min-km value: ${arg}`);
      parsed.minKm = minKm;
      continue;
    }
    if (arg.startsWith("--max-km=")) {
      const maxKm = Number(arg.slice("--max-km=".length).trim());
      if (!Number.isFinite(maxKm) || maxKm <= 0) throw new Error(`Invalid --max-km value: ${arg}`);
      parsed.maxKm = maxKm;
      continue;
    }
    if (arg === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headed = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (targetCount === 0) {
    throw new Error("Exactly one target is required: --student, --athlete-id, or --athlete-url.");
  }
  if (targetCount > 1) {
    throw new Error("Ambiguous target: provide only one of --student, --athlete-id, or --athlete-url.");
  }

  if (!isIsoDate(parsed.from)) {
    throw new Error(`Missing or invalid --from date: "${parsed.from}". Expected YYYY-MM-DD.`);
  }
  if (!isIsoDate(parsed.to)) {
    throw new Error(`Missing or invalid --to date: "${parsed.to}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from > parsed.to) {
    throw new Error(`Invalid date range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }

  return parsed;
}

function resolveDistanceWindow(args: CliArgs): { minMeters: number; maxMeters: number; minKm: number; maxKm: number } {
  const preset = args.distancePreset ? DISTANCE_PRESETS[args.distancePreset] : null;
  if (args.distancePreset && !preset) {
    throw new Error(`Unknown --distance preset "${args.distancePreset}". Supported: ${Object.keys(DISTANCE_PRESETS).join(", ")}`);
  }

  const minKm = args.minKm ?? (preset ? preset.minMeters / 1000 : null);
  const maxKm = args.maxKm ?? (preset ? preset.maxMeters / 1000 : null);
  if (minKm === null || maxKm === null) {
    throw new Error("Provide --distance preset and/or both --min-km and --max-km.");
  }
  if (minKm >= maxKm) {
    throw new Error(`Invalid distance window: min (${minKm}) must be less than max (${maxKm}).`);
  }

  return {
    minKm,
    maxKm,
    minMeters: minKm * 1000,
    maxMeters: maxKm * 1000,
  };
}

function resolveTarget(args: CliArgs, students: StudentConfig[]): ResolvedTarget {
  const studentNeedle = args.student?.trim().toLowerCase() ?? null;
  const athleteIdFromUrl = args.athleteUrl ? parseAthleteIdFromUrl(args.athleteUrl) : null;
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl;
  const normalizedAthleteUrl = args.athleteUrl ? normalizeUrl(args.athleteUrl) : null;

  if (args.athleteUrl && !resolvedAthleteId) {
    throw new Error(`Could not parse athlete id from --athlete-url: ${args.athleteUrl}`);
  }

  const matchedStudents = students.filter((student) => {
    if (studentNeedle) {
      const idMatch = student.student_id.toLowerCase() === studentNeedle;
      const nameMatch = (student.name ?? "").toLowerCase() === studentNeedle;
      if (!idMatch && !nameMatch) return false;
    }
    const studentAthleteId = parseAthleteIdFromUrl(student.trainingpeaks_athlete_url);
    if (resolvedAthleteId && studentAthleteId !== resolvedAthleteId) {
      if (!normalizedAthleteUrl) return false;
      if (normalizeUrl(student.trainingpeaks_athlete_url) !== normalizedAthleteUrl) return false;
    }
    if (normalizedAthleteUrl && normalizeUrl(student.trainingpeaks_athlete_url) !== normalizedAthleteUrl) {
      if (!resolvedAthleteId || studentAthleteId !== resolvedAthleteId) return false;
    }
    return true;
  });

  if (studentNeedle && matchedStudents.length === 0) {
    throw new Error(`No student matched --student="${args.student}".`);
  }
  if (matchedStudents.length > 1) {
    const sample = matchedStudents.slice(0, 5).map((s) => `${s.name ?? s.student_id} (${s.student_id})`);
    throw new Error(`Multiple students matched target. Narrow input. Matches: ${sample.join(", ")}`);
  }

  const matched = matchedStudents[0] ?? null;
  const athleteId = resolvedAthleteId ?? (matched ? parseAthleteIdFromUrl(matched.trainingpeaks_athlete_url) : null);
  if (!athleteId) {
    throw new Error("Could not resolve TrainingPeaks athlete id from target arguments.");
  }

  return {
    athleteId,
    athleteUrl: args.athleteUrl ?? matched?.trainingpeaks_athlete_url ?? `${APP_HOST}/#calendar/athletes/${athleteId}`,
    studentId: matched?.student_id ?? null,
    studentName: matched?.name ?? matched?.student_id ?? null,
  };
}

function collectWorkoutText(raw: TrainingPeaksWorkoutRaw): string {
  const parts = [
    raw.title,
    raw.description,
    raw.coachComments,
    raw.workoutComments,
    raw.userTags,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => String(value));
  return parts.join(" ");
}

function isRunningWorkout(raw: TrainingPeaksWorkoutRaw): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const typeId = toFiniteNumber(raw.workoutTypeValueId);
  if (typeId === RUNNING_WORKOUT_TYPE_VALUE_ID) {
    reasons.push("workoutTypeValueId=3 (running)");
    return { ok: true, reasons };
  }

  const code = typeof raw.code === "string" ? raw.code.trim().toLowerCase() : "";
  if (code.includes("run")) {
    reasons.push(`code=${raw.code}`);
    return { ok: true, reasons };
  }

  const text = collectWorkoutText(raw).toLowerCase();
  if (/\b(run|running|бег|jog)\b/.test(text)) {
    reasons.push("title/tags/comments mention running");
    return { ok: true, reasons };
  }

  if (raw.poolLengthOptionId !== null && raw.poolLengthOptionId !== undefined) {
    reasons.push("poolLengthOptionId present (likely swim)");
  }
  if (raw.equipmentBikeId !== null && raw.equipmentBikeId !== undefined) {
    reasons.push("equipmentBikeId present (likely bike)");
  }

  return { ok: false, reasons: reasons.length ? reasons : ["not classified as running"] };
}

function isCompletedWorkout(raw: TrainingPeaksWorkoutRaw): boolean {
  const distance = toFiniteNumber(raw.distance) ?? 0;
  const durationHours = toFiniteNumber(raw.totalTime) ?? 0;
  if (distance > 0 && durationHours > 0) return true;
  return raw.completed === true;
}

function collectRaceSignals(raw: TrainingPeaksWorkoutRaw): string[] {
  const signals: string[] = [];
  const text = collectWorkoutText(raw);
  if (RACE_TEXT_PATTERN.test(text)) signals.push("race_keywords_in_text");

  const prCount = toFiniteNumber(raw.personalRecordCount);
  if (prCount !== null && prCount > 0) signals.push(`personalRecordCount=${prCount}`);

  if (raw.raceTypeDuration !== null && raw.raceTypeDuration !== undefined) {
    signals.push("raceTypeDuration_present");
  }

  const intensityFactor = toFiniteNumber(raw.if);
  if (intensityFactor !== null && intensityFactor >= 0.95) {
    signals.push(`high_if=${intensityFactor.toFixed(2)}`);
  }

  const tss = toFiniteNumber(raw.tssActual);
  if (tss !== null && tss >= 50) signals.push(`high_tss=${tss.toFixed(1)}`);

  return signals;
}

function looksLike5kEvent(record: Record<string, unknown>): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const title =
    pickFirstString(record, ["EventTitle", "eventTitle", "EventName", "eventName", "Name", "name", "Title", "title"]) ??
    "";
  const sport = pickFirstString(record, ["SportType", "sportType", "EventType", "eventType"]) ?? "";
  const description =
    pickFirstString(record, ["Description", "description", "Notes", "notes"]) ?? "";
  const blob = `${title} ${sport} ${description}`.toLowerCase();

  if (/\b(5k|5\s*km|5\s*км|5000)\b/.test(blob)) reasons.push("distance_label_5k");
  if (/\b(race|start|забег|соревнование|parkrun)\b/i.test(blob)) reasons.push("race_or_start_keywords");
  if (/road\s*run|roadrunning|running/i.test(sport)) reasons.push("running_sport_type");

  const distanceValue = pickFirstNonEmpty(record, ["Distance", "distance"]);
  const distanceParsed = formatDistanceKm(distanceValue);
  if (distanceParsed.meters !== null) {
    if (distanceParsed.meters >= 4600 && distanceParsed.meters <= 5600) {
      reasons.push(`event_distance_m=${distanceParsed.meters}`);
    }
  }

  return { ok: reasons.length > 0, reasons };
}

function buildCleanCandidate(input: {
  raw: TrainingPeaksWorkoutRaw;
  window: { minMeters: number; maxMeters: number };
}): Clean5kCandidate | null {
  const workoutId = toPositiveInt(input.raw.workoutId);
  const date = toIsoDatePart(input.raw.workoutDay);
  const distanceMeters = toFiniteNumber(input.raw.distance);
  const durationHours = toFiniteNumber(input.raw.totalTime);
  if (!workoutId || !date || distanceMeters === null || durationHours === null) return null;
  if (distanceMeters < input.window.minMeters || distanceMeters > input.window.maxMeters) return null;
  if (durationHours <= 0) return null;

  const distanceKm = distanceMeters / 1000;
  const durationMin = durationHours * 60;
  const paceMinPerKm = durationMin / distanceKm;

  const reasons: string[] = [
    `completed_distance_m=${Math.round(distanceMeters)}`,
    `duration_min=${durationMin.toFixed(1)}`,
    `pace_min_per_km=${paceMinPerKm.toFixed(2)}`,
  ];

  const centerDelta = Math.abs(distanceMeters - 5000);
  let confidence = 0.72;
  if (centerDelta <= 150) confidence = 0.95;
  else if (centerDelta <= 400) confidence = 0.85;
  if (distanceMeters >= input.window.minMeters + 100 && distanceMeters <= input.window.maxMeters - 100) {
    reasons.push("distance_within_clean_window");
  } else {
    reasons.push("distance_near_window_edge");
    confidence -= 0.08;
  }

  return {
    workoutId,
    date,
    title: typeof input.raw.title === "string" ? input.raw.title : null,
    distance_km: Math.round(distanceKm * 100) / 100,
    duration_min: Math.round(durationMin * 10) / 10,
    pace_min_per_km: Math.round(paceMinPerKm * 100) / 100,
    avg_hr: toFiniteNumber(input.raw.heartRateAverage),
    tssActual: toFiniteNumber(input.raw.tssActual),
    if: toFiniteNumber(input.raw.if),
    personalRecordCount: toFiniteNumber(input.raw.personalRecordCount),
    raceTypeDuration: input.raw.raceTypeDuration ?? null,
    confidence: Math.max(0.5, Math.min(0.99, Number(confidence.toFixed(2)))),
    reasons,
  };
}

function createMarkdown(report: ProbeReport): string {
  const lines: string[] = [];
  lines.push("# TrainingPeaks race results probe");
  lines.push("");
  lines.push("## Athlete / range");
  lines.push(`- athlete_id: **${report.athlete.athlete_id}**`);
  lines.push(`- athlete_url: \`${report.athlete.athlete_url}\``);
  if (report.athlete.student_id) {
    lines.push(`- student: ${report.athlete.student_name ?? report.athlete.student_id} (\`${report.athlete.student_id}\`)`);
  }
  lines.push(`- range: \`${report.range.from}\` -> \`${report.range.to}\``);
  lines.push(
    `- distance window: **${report.distance_window.min_km}–${report.distance_window.max_km} km** (${report.target_distance ?? "custom"})`,
  );
  lines.push("");
  lines.push("## API status / counts");
  lines.push(
    `- workouts: status=${report.data_sources.workouts.status}, count=${report.data_sources.workouts.count}${report.data_sources.workouts.error ? `, error=${report.data_sources.workouts.error}` : ""}`,
  );
  lines.push(
    `- events: status=${report.data_sources.events.status}, count=${report.data_sources.events.count}${report.data_sources.events.error ? `, error=${report.data_sources.events.error}` : ""}`,
  );
  lines.push(`- workouts scanned (in range): **${report.workouts_scanned}**`);
  lines.push(`- clean 5K candidates: **${report.clean_5k_candidates.length}**`);
  lines.push(`- race-like 5K candidates: **${report.race_like_5k_candidates.length}**`);
  lines.push(`- planned race candidates: **${report.planned_race_candidates.length}**`);
  lines.push("");

  lines.push("## Clean 5K candidates (top 20 by pace)");
  if (!report.clean_5k_candidates.length) {
    lines.push("- None");
  } else {
    lines.push("| date | title | distance_km | duration_min | pace_min_per_km | avg_hr | confidence |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
    for (const row of report.clean_5k_candidates.slice(0, 20)) {
      lines.push(
        `| ${row.date} | ${row.title ?? ""} | ${row.distance_km} | ${row.duration_min} | ${row.pace_min_per_km} | ${row.avg_hr ?? ""} | ${row.confidence} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Race-like 5K candidates");
  if (!report.race_like_5k_candidates.length) {
    lines.push("- None");
  } else {
    lines.push("| date | title | pace_min_per_km | signals | confidence |");
    lines.push("| --- | --- | ---: | --- | ---: |");
    for (const row of report.race_like_5k_candidates.slice(0, 20)) {
      lines.push(
        `| ${row.date} | ${row.title ?? ""} | ${row.pace_min_per_km} | ${row.race_signals.join(", ")} | ${row.confidence} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Planned races / events");
  if (!report.planned_race_candidates.length) {
    lines.push("- None");
  } else {
    lines.push("| event_date | title | distance | matching_workouts | confidence |");
    lines.push("| --- | --- | --- | ---: | ---: |");
    for (const row of report.planned_race_candidates.slice(0, 20)) {
      lines.push(
        `| ${row.event_date ?? ""} | ${row.event_title ?? ""} | ${row.distance ?? ""} | ${row.matching_workout_ids.length} | ${row.confidence} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Excluded summary");
  lines.push(`- below_min_km: ${report.excluded_summary.below_min_km}`);
  lines.push(`- above_max_km: ${report.excluded_summary.above_max_km}`);
  lines.push(`- non_running: ${report.excluded_summary.non_running}`);
  lines.push(`- not_completed: ${report.excluded_summary.not_completed}`);
  lines.push(`- out_of_date_range: ${report.excluded_summary.out_of_date_range}`);
  lines.push("");

  lines.push("## Notes / limitations");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");

  lines.push("## Feasibility summary");
  const best = report.clean_5k_candidates[0] ?? null;
  if (best) {
    lines.push(
      `- Clean standalone 5K results are discoverable from workouts API for this athlete (best pace ${best.pace_min_per_km} min/km on ${best.date}).`,
    );
  } else {
    lines.push("- No clean standalone 5K workouts found in the selected distance window.");
  }
  if (report.race_like_5k_candidates.length > 0) {
    lines.push("- Race-like heuristics (title/PR/IF/TSS) can flag likely race efforts among clean 5Ks.");
  }
  if (report.planned_race_candidates.length > 0) {
    lines.push("- Planned calendar events can be correlated with same-day workouts.");
  }
  lines.push("- Rolling/best segment 5K inside longer workouts is not included in this MVP; it requires FIT/lap/stream analysis from Workout Files.");
  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- report_json: \`${report.output_paths.report_json}\``);
  lines.push(`- report_md: \`${report.output_paths.report_md}\``);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const distanceWindow = resolveDistanceWindow(args);
  const students = await readStudentsConfig();
  const target = resolveTarget(args, students);
  const runAt = new Date().toISOString();

  const workoutsEndpoint = `${TP_API_HOST}/fitness/v6/athletes/${target.athleteId}/workouts/${args.from}/${args.to}`;
  const eventsEndpoint = `${TP_API_HOST}/fitness/v6/athletes/${target.athleteId}/events/${args.from}/${args.to}`;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const auth = await captureSessionAuth({ context, page, athleteId: target.athleteId });
    if (!auth.sampleRequestUrl && !auth.authorizationHeader) {
      throw new Error("Failed to capture TrainingPeaks auth/session (no API session context observed).");
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
    };
    if (auth.authorizationHeader) headers.authorization = auth.authorizationHeader;
    if (typeof auth.sampleHeaders.referer === "string" && auth.sampleHeaders.referer.trim()) {
      headers.referer = auth.sampleHeaders.referer;
    }
    if (typeof auth.sampleHeaders.origin === "string" && auth.sampleHeaders.origin.trim()) {
      headers.origin = auth.sampleHeaders.origin;
    }

    const workoutsResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: workoutsEndpoint,
      headers,
    });
    const eventsResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: eventsEndpoint,
      headers,
    });

    const workoutsApi: ApiFetchResult = {
      endpoint: workoutsEndpoint,
      status: workoutsResult.status,
      ok: workoutsResult.ok,
      count: Array.isArray(workoutsResult.body) ? workoutsResult.body.length : 0,
      error: workoutsResult.status === 200 ? null : `HTTP ${workoutsResult.status}`,
    };
    const eventsApi: ApiFetchResult = {
      endpoint: eventsEndpoint,
      status: eventsResult.status,
      ok: eventsResult.ok,
      count: 0,
      error: eventsResult.status === 200 ? null : `HTTP ${eventsResult.status}`,
    };

    if (workoutsResult.status !== 200 || !Array.isArray(workoutsResult.body)) {
      throw new Error(`TrainingPeaks workouts GET failed: status=${workoutsResult.status}`);
    }

    const rawItems = workoutsResult.body.filter((item): item is TrainingPeaksWorkoutRaw => isRecord(item));
    const normalizedItems = normalizeTrainingPeaksWorkoutItems({
      athleteId: target.athleteId,
      rawItems,
    });
    const inRangeItems = normalizedItems.filter(
      (item) => item.workoutDate >= args.from && item.workoutDate <= args.to,
    );

    const rawByWorkoutId = new Map<number, TrainingPeaksWorkoutRaw>();
    for (const raw of rawItems) {
      const workoutId = toPositiveInt(raw.workoutId);
      if (workoutId && !rawByWorkoutId.has(workoutId)) rawByWorkoutId.set(workoutId, raw);
    }

    const fieldPresence = new Map<string, number>();
    const trackField = (name: string, present: boolean): void => {
      if (!fieldPresence.has(name)) fieldPresence.set(name, 0);
      if (present) fieldPresence.set(name, (fieldPresence.get(name) ?? 0) + 1);
    };

    const excluded: ExcludedSummary = {
      below_min_km: 0,
      above_max_km: 0,
      non_running: 0,
      not_completed: 0,
      out_of_date_range: 0,
    };

    const cleanCandidates: Clean5kCandidate[] = [];

    for (const item of inRangeItems) {
      const raw = rawByWorkoutId.get(item.trainingPeaksWorkoutId);
      if (!raw) continue;

      trackField("distance", raw.distance !== null && raw.distance !== undefined);
      trackField("totalTime", raw.totalTime !== null && raw.totalTime !== undefined);
      trackField("heartRateAverage", raw.heartRateAverage !== null && raw.heartRateAverage !== undefined);
      trackField("tssActual", raw.tssActual !== null && raw.tssActual !== undefined);
      trackField("if", raw.if !== null && raw.if !== undefined);
      trackField("personalRecordCount", raw.personalRecordCount !== null && raw.personalRecordCount !== undefined);
      trackField("raceTypeDuration", raw.raceTypeDuration !== null && raw.raceTypeDuration !== undefined);
      trackField("description", typeof raw.description === "string" && Boolean(raw.description.trim()));
      trackField("coachComments", typeof raw.coachComments === "string" && Boolean(raw.coachComments.trim()));
      trackField("workoutComments", typeof raw.workoutComments === "string" && Boolean(raw.workoutComments.trim()));

      if (!isCompletedWorkout(raw)) {
        excluded.not_completed += 1;
        continue;
      }

      const running = isRunningWorkout(raw);
      if (!running.ok) {
        excluded.non_running += 1;
        continue;
      }

      const distanceMeters = toFiniteNumber(raw.distance) ?? 0;
      if (distanceMeters > 0 && distanceMeters < distanceWindow.minMeters) {
        excluded.below_min_km += 1;
        continue;
      }
      if (distanceMeters > distanceWindow.maxMeters) {
        excluded.above_max_km += 1;
        continue;
      }

      const candidate = buildCleanCandidate({ raw, window: distanceWindow });
      if (candidate) cleanCandidates.push(candidate);
    }

    cleanCandidates.sort((a, b) => a.pace_min_per_km - b.pace_min_per_km);

    const raceLikeCandidates: RaceLike5kCandidate[] = [];
    for (const clean of cleanCandidates) {
      const raw = rawByWorkoutId.get(clean.workoutId);
      if (!raw) continue;
      const raceSignals = collectRaceSignals(raw);
      if (raceSignals.length === 0) continue;
      raceLikeCandidates.push({
        ...clean,
        race_signals: raceSignals,
        confidence: Math.min(0.99, Number((clean.confidence + raceSignals.length * 0.04).toFixed(2))),
        reasons: [...clean.reasons, ...raceSignals.map((signal) => `race_signal:${signal}`)],
      });
    }

    const workoutsByDate = new Map<string, number[]>();
    for (const item of inRangeItems) {
      if (!item.isCompleted) continue;
      const list = workoutsByDate.get(item.workoutDate) ?? [];
      list.push(item.trainingPeaksWorkoutId);
      workoutsByDate.set(item.workoutDate, list);
    }

    const plannedRaceCandidates: PlannedRaceCandidate[] = [];
    if (eventsResult.status === 200) {
      const eventObjects = flattenEventCandidates(eventsResult.body);
      eventsApi.count = eventObjects.length;
      for (const eventObj of eventObjects) {
        const eventDate = pickEventDate(eventObj);
        if (eventDate && (eventDate < args.from || eventDate > args.to)) continue;

        const looks5k = looksLike5kEvent(eventObj);
        if (!looks5k.ok) continue;

        const title = pickFirstString(eventObj, [
          "EventTitle",
          "eventTitle",
          "EventName",
          "eventName",
          "Name",
          "name",
          "Title",
          "title",
        ]);
        const sportType = pickFirstString(eventObj, ["SportType", "sportType", "EventType", "eventType"]);
        const distanceValue = pickFirstNonEmpty(eventObj, ["Distance", "distance"]);
        const distanceParsed = formatDistanceKm(distanceValue);
        const goalValue = pickFirstNonEmpty(eventObj, ["Goals", "goals", "Goal", "goal"]);
        const descriptionValue = pickFirstNonEmpty(eventObj, ["Description", "description", "Notes", "notes"]);
        const description =
          descriptionValue === null
            ? null
            : typeof descriptionValue === "string"
              ? descriptionValue
              : JSON.stringify(descriptionValue);

        const matchingWorkoutIds = eventDate ? (workoutsByDate.get(eventDate) ?? []) : [];
        const confidence = Math.min(0.99, 0.55 + looks5k.reasons.length * 0.1 + (matchingWorkoutIds.length > 0 ? 0.15 : 0));

        plannedRaceCandidates.push({
          event_date: eventDate,
          event_title: title,
          sport_type: sportType,
          distance: distanceParsed.distance,
          goal: sanitizeGoalValue(goalValue),
          description,
          matching_workout_ids: matchingWorkoutIds,
          confidence: Number(confidence.toFixed(2)),
          reasons: [
            ...looks5k.reasons,
            matchingWorkoutIds.length > 0
              ? `same_day_workouts=${matchingWorkoutIds.length}`
              : "no_same_day_completed_workout",
          ],
        });
      }
    }

    excluded.out_of_date_range = normalizedItems.length - inRangeItems.length;

    const fieldsAvailable = [...fieldPresence.entries()]
      .filter(([, count]) => count > 0)
      .map(([key]) => key)
      .sort();
    const fieldsMissing = [...fieldPresence.entries()]
      .filter(([, count]) => count === 0)
      .map(([key]) => key)
      .sort();

    const timestamp = timestampForPath(new Date(runAt));
    const outputDir = path.join(toolRoot, "debug", "race-results-probe", String(target.athleteId), timestamp);
    await mkdir(outputDir, { recursive: true });
    const reportJsonPath = path.join(outputDir, "report.json");
    const reportMdPath = path.join(outputDir, "report.md");

    const report: ProbeReport = {
      run_at: runAt,
      athlete: {
        athlete_id: target.athleteId,
        athlete_url: target.athleteUrl,
        student_id: target.studentId,
        student_name: target.studentName,
      },
      range: { from: args.from, to: args.to },
      target_distance: args.distancePreset,
      distance_window: {
        min_km: distanceWindow.minKm,
        max_km: distanceWindow.maxKm,
        min_meters: distanceWindow.minMeters,
        max_meters: distanceWindow.maxMeters,
      },
      workouts_scanned: inRangeItems.length,
      data_sources: { workouts: workoutsApi, events: eventsApi },
      fields_available: fieldsAvailable,
      fields_missing: fieldsMissing,
      planned_race_candidates: plannedRaceCandidates,
      race_like_5k_candidates: raceLikeCandidates,
      clean_5k_candidates: cleanCandidates,
      excluded_summary: excluded,
      notes: [
        "Read-only probe; no Supabase writes, no Telegram, no weekly reports.",
        "Rolling/best segment 5K inside longer workouts is not included in this MVP; it requires FIT/lap/stream analysis from Workout Files.",
        "Clean 5K = completed running workout with total distance in configured window (excludes rolling segments).",
      ],
      output_paths: {
        report_json: reportJsonPath,
        report_md: reportMdPath,
      },
    };

    await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(reportMdPath, createMarkdown(report), "utf8");

    const best = cleanCandidates[0] ?? null;
    console.log("[tp-probe-race-results] Summary");
    console.log(`athlete_id: ${target.athleteId}`);
    console.log(`range: ${args.from} -> ${args.to}`);
    console.log(`workouts_scanned: ${report.workouts_scanned}`);
    console.log(`clean_5k_candidates: ${cleanCandidates.length}`);
    if (best) {
      console.log(
        `best_clean_5k: ${best.date} | ${best.title ?? "untitled"} | ${best.distance_km} km | pace ${best.pace_min_per_km} min/km`,
      );
    } else {
      console.log("best_clean_5k: none");
    }
    console.log(`race_like_5k_candidates: ${raceLikeCandidates.length}`);
    console.log(`planned_race_candidates: ${plannedRaceCandidates.length}`);
    console.log(`report_json: ${reportJsonPath}`);
    console.log(`report_md: ${reportMdPath}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-probe-race-results failed.");
  console.error(error);
  process.exit(1);
});
