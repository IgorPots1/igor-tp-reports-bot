import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import {
  assessCandidateDataQuality,
  collectRaceSignals,
  collectWorkoutText,
  DISTANCE_KEYWORDS,
  isWeekday,
  matchSameDayEvent as matchSharedSameDayEvent,
  median,
  RACE_KEYWORDS_PATTERN,
  scoreEventForCandidate as scoreSharedEventForCandidate,
  type DataQualityStatus,
  type DataQualityWarning,
  type HeartRatePeerReference,
} from "../src/quality/index.ts";
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

const ALL_DISTANCE_KEYS = ["5k", "10k", "half", "marathon"] as const;
type DistanceKey = (typeof ALL_DISTANCE_KEYS)[number];

type DistancePreset = {
  label: string;
  target_km: number;
  min_km: number;
  max_km: number;
};

const DISTANCE_PRESETS: Record<DistanceKey, DistancePreset> = {
  "5k": { label: "5 км", target_km: 5, min_km: 4.6, max_km: 5.6 },
  "10k": { label: "10 км", target_km: 10, min_km: 9.6, max_km: 10.6 },
  half: { label: "21.1 км", target_km: 21.0975, min_km: 20.5, max_km: 22.5 },
  marathon: { label: "42.2 км", target_km: 42.195, min_km: 41.0, max_km: 43.0 },
};

/** Below this distance (km), add a short-course coach note in summaries. */
const SHORT_COURSE_NOTE_THRESHOLD_KM: Partial<Record<DistanceKey, number>> = {
  "5k": 4.85,
};

type CliArgs = {
  from: string;
  to: string;
  athleteId: number | null;
  athleteUrl: string | null;
  student: string | null;
  distancePreset: string | null;
  distances: string | null;
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

type DistanceWindow = {
  min_km: number;
  max_km: number;
  min_meters: number;
  max_meters: number;
  target_km: number;
  label: string;
};

type ResultCandidate = {
  workoutId: number;
  date: string;
  title: string | null;
  distance_bucket: DistanceKey;
  distance_km: number;
  duration_min: number;
  duration_text: string;
  pace_min_per_km: number;
  pace_text: string;
  avg_hr: number | null;
  tssActual: number | null;
  if: number | null;
  personalRecordCount: number | null;
  raceTypeDuration: unknown | null;
  confidence: number;
  reasons: string[];
  same_day_event: boolean;
  event_name: string | null;
  event_date: string | null;
  event_distance_km: number | null;
  event_id: string | null;
  event_source: "events_api" | "local_races_scan" | null;
  event_match_reason: string[];
  event_confidence: number;
  race_signals?: string[];
  day_of_week?: string;
  heart_rate_peer_reference?: HeartRatePeerReference;
  data_quality_status?: DataQualityStatus;
  data_quality_score?: number;
  warnings?: DataQualityWarning[];
  review_required?: boolean;
  can_be_official_best?: boolean;
  result_status?:
    | "official_event"
    | "probable_result"
    | "possible_result"
    | "training_candidate"
    | "needs_coach_review"
    | "excluded";
  result_confidence_score?: number;
  result_confidence_reasons?: string[];
  display_class?:
    | "official_best"
    | "official_flagged"
    | "probable_best"
    | "clean_training_best"
    | "manual_review"
    | "display_candidate"
    | "excluded";
  rationale?: string;
};

type CandidateResultSummary = {
  official_best: ResultCandidate | null;
  probable_or_possible_best: ResultCandidate | null;
  clean_training_best: ResultCandidate | null;
};

type DistanceBucketReport = {
  label: string;
  distance_window: DistanceWindow;
  candidates_count: number;
  official_best: ResultCandidate | null;
  official_flagged: ResultCandidate | null;
  probable_best: ResultCandidate | null;
  probable_or_possible_best: ResultCandidate | null;
  candidate_result_summary: CandidateResultSummary;
  clean_training_best: ResultCandidate | null;
  clean_training_best_needs_review: boolean;
  display_candidates: ResultCandidate[];
  best_result: ResultCandidate | null;
  best_candidate_needs_review: ResultCandidate | null;
  excluded_candidates_count: number;
  candidates: ResultCandidate[];
};

type PlannedEventByDate = {
  event_date: string;
  event_id: string | null;
  event_name: string | null;
  event_distance_km: number | null;
  sport_type: string | null;
  event_source: "events_api";
};

type EventWorkoutLink = {
  event_date: string;
  event_name: string | null;
  event_distance_km: number | null;
  event_id: string | null;
  workout_id: number;
  workout_title: string | null;
  distance_bucket: DistanceKey;
  distance_km: number;
  event_match_reason: string[];
  event_confidence: number;
};

type ExcludedSummary = {
  below_min_km: number;
  above_max_km: number;
  non_running: number;
  not_completed: number;
  out_of_date_range: number;
};

type ParsedEvent = {
  event_id: string | null;
  event_date: string;
  event_name: string | null;
  event_distance_km: number | null;
  sport_type: string | null;
  raw: Record<string, unknown>;
};

type ManualReviewCandidate = {
  distance_bucket: DistanceKey;
  distance_label: string;
  date: string;
  day_of_week: string | null;
  workoutId: number;
  title: string | null;
  distance_km: number;
  duration_text: string;
  pace_text: string;
  data_quality_status: DataQualityStatus;
  data_quality_score: number;
  warnings: DataQualityWarning[];
  review_required: boolean;
  can_be_official_best: boolean;
  same_day_event: boolean;
  event_name: string | null;
  event_distance_km: number | null;
  event_confidence: number;
  heartRateAverage: number | null;
  avg_hr: number | null;
  heart_rate_peer_reference: HeartRatePeerReference | null;
  result_status:
    | "official_event"
    | "probable_result"
    | "possible_result"
    | "training_candidate"
    | "needs_coach_review"
    | "excluded";
  result_confidence_score: number;
  result_confidence_reasons: string[];
  display_class: NonNullable<ResultCandidate["display_class"]>;
  rationale: string;
  short_review_reason: string;
};

type ManualReviewSummary = {
  total: number;
  by_distance: Record<string, number>;
  by_warning: Record<string, number>;
};

type ProbeReport = {
  run_at: string;
  mode: "single" | "multi";
  athlete: {
    athlete_id: number;
    athlete_url: string;
    student_id: string | null;
    student_name: string | null;
  };
  range: { from: string; to: string };
  target_distance: string | null;
  target_distances: DistanceKey[];
  distance_window?: DistanceWindow;
  distance_results: Partial<Record<DistanceKey, DistanceBucketReport>>;
  manual_review_candidates: ManualReviewCandidate[];
  manual_review_summary: ManualReviewSummary;
  workouts_scanned: number;
  events_scanned: number;
  data_sources: {
    workouts: ApiFetchResult;
    events: ApiFetchResult;
  };
  fields_available: string[];
  fields_missing: string[];
  planned_events_by_date: PlannedEventByDate[];
  event_workout_links: EventWorkoutLink[];
  excluded_summary_by_distance: Partial<Record<DistanceKey, ExcludedSummary>>;
  planned_race_candidates?: PlannedRaceCandidate[];
  race_like_5k_candidates?: RaceLike5kCandidate[];
  clean_5k_candidates?: Clean5kCandidate[];
  excluded_summary?: ExcludedSummary;
  notes: string[];
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

type Clean5kCandidate = Omit<
  ResultCandidate,
  | "distance_bucket"
  | "duration_text"
  | "pace_text"
  | "same_day_event"
  | "event_name"
  | "event_date"
  | "event_distance_km"
  | "event_id"
  | "event_source"
  | "event_match_reason"
  | "event_confidence"
>;

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

function parseDistanceMeters(rawDistance: unknown): number | null {
  if (rawDistance === null || rawDistance === undefined) return null;
  const raw = typeof rawDistance === "string" ? rawDistance.trim() : String(rawDistance);
  if (!raw) return null;
  const numeric = Number(raw.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric > 200) return numeric;
  return numeric * 1000;
}

function formatDistanceKm(rawDistance: unknown): { distance: string | null; meters: number | null } {
  const meters = parseDistanceMeters(rawDistance);
  if (meters === null) {
    if (rawDistance === null || rawDistance === undefined) return { distance: null, meters: null };
    const raw = typeof rawDistance === "string" ? rawDistance.trim() : String(rawDistance);
    return raw ? { distance: raw, meters: null } : { distance: null, meters: null };
  }
  const kilometers = meters / 1000;
  const roundedOne = Math.round(kilometers * 10) / 10;
  const rendered = Number.isInteger(roundedOne) ? String(roundedOne) : roundedOne.toFixed(1);
  return { distance: `${rendered} km`, meters };
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

function pickEventId(record: Record<string, unknown>): string | null {
  return pickFirstString(record, [
    "AthleteEventId",
    "athleteEventId",
    "EventId",
    "eventId",
    "Id",
    "id",
  ]);
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

function parseEventsFromApi(body: unknown, from: string, to: string): ParsedEvent[] {
  const eventObjects = flattenEventCandidates(body);
  const parsed: ParsedEvent[] = [];
  for (const eventObj of eventObjects) {
    const eventDate = pickEventDate(eventObj);
    if (!eventDate || eventDate < from || eventDate > to) continue;
    const distanceValue = pickFirstNonEmpty(eventObj, ["Distance", "distance"]);
    const distanceParsed = formatDistanceKm(distanceValue);
    parsed.push({
      event_id: pickEventId(eventObj),
      event_date: eventDate,
      event_name: pickFirstString(eventObj, [
        "EventTitle",
        "eventTitle",
        "EventName",
        "eventName",
        "Name",
        "name",
        "Title",
        "title",
      ]),
      event_distance_km:
        distanceParsed.meters !== null ? Math.round((distanceParsed.meters / 1000) * 1000) / 1000 : null,
      sport_type: pickFirstString(eventObj, ["SportType", "sportType", "EventType", "eventType"]),
      raw: eventObj,
    });
  }
  return parsed;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isDistanceKey(value: string): value is DistanceKey {
  return (ALL_DISTANCE_KEYS as readonly string[]).includes(value);
}

function parseDistanceKeysList(value: string): DistanceKey[] {
  const keys = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!keys.length) throw new Error("Empty --distances value.");
  const unique: DistanceKey[] = [];
  for (const key of keys) {
    if (!isDistanceKey(key)) {
      throw new Error(`Unknown distance "${key}" in --distances. Supported: ${ALL_DISTANCE_KEYS.join(", ")}`);
    }
    if (!unique.includes(key)) unique.push(key);
  }
  return unique;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: "",
    to: "",
    athleteId: null,
    athleteUrl: null,
    student: null,
    distancePreset: null,
    distances: null,
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
    if (arg.startsWith("--distances=")) {
      parsed.distances = arg.slice("--distances=".length).trim();
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

  if (parsed.distances && parsed.distancePreset) {
    throw new Error("Use either --distance or --distances, not both.");
  }

  return parsed;
}

type ResolvedRunMode = {
  mode: "single" | "multi";
  distanceKeys: DistanceKey[];
  singleDistanceKey: DistanceKey | null;
};

function resolveRunMode(args: CliArgs): ResolvedRunMode {
  if (args.distances) {
    if (args.minKm !== null || args.maxKm !== null) {
      throw new Error("--min-km and --max-km are only supported in single-distance mode.");
    }
    return { mode: "multi", distanceKeys: parseDistanceKeysList(args.distances), singleDistanceKey: null };
  }

  if (args.distancePreset === "all") {
    if (args.minKm !== null || args.maxKm !== null) {
      throw new Error("--min-km and --max-km are only supported in single-distance mode.");
    }
    return { mode: "multi", distanceKeys: [...ALL_DISTANCE_KEYS], singleDistanceKey: null };
  }

  const singleKey = args.distancePreset ?? "5k";
  if (!isDistanceKey(singleKey)) {
    throw new Error(
      `Unknown --distance "${singleKey}". Supported: ${ALL_DISTANCE_KEYS.join(", ")}, all`,
    );
  }

  return { mode: "single", distanceKeys: [singleKey], singleDistanceKey: singleKey };
}

function resolveDistanceWindow(
  args: CliArgs,
  distanceKey: DistanceKey,
  mode: ResolvedRunMode,
): DistanceWindow {
  const preset = DISTANCE_PRESETS[distanceKey];
  if (mode.mode === "multi") {
    return {
      label: preset.label,
      target_km: preset.target_km,
      min_km: preset.min_km,
      max_km: preset.max_km,
      min_meters: preset.min_km * 1000,
      max_meters: preset.max_km * 1000,
    };
  }

  const minKm = args.minKm ?? preset.min_km;
  const maxKm = args.maxKm ?? preset.max_km;
  if (minKm >= maxKm) {
    throw new Error(`Invalid distance window: min (${minKm}) must be less than max (${maxKm}).`);
  }

  return {
    label: preset.label,
    target_km: preset.target_km,
    min_km: minKm,
    max_km: maxKm,
    min_meters: minKm * 1000,
    max_meters: maxKm * 1000,
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

function formatPaceText(paceMinPerKm: number): string {
  const totalSec = Math.round(paceMinPerKm * 60);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}/км`;
}

function formatDurationText(durationMin: number): string {
  const totalSec = Math.round(durationMin * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

const DISPLAY_CANDIDATE_LIMIT = 10;

function candidateHasRaceKeyword(candidate: ResultCandidate): boolean {
  return (candidate.race_signals ?? []).some((signal) => signal === "race_keywords_in_text");
}

function candidateHasPersonalRecord(candidate: ResultCandidate): boolean {
  return (candidate.personalRecordCount ?? 0) > 0;
}

function candidateHasHardEffortHr(candidate: ResultCandidate): boolean {
  const hr = candidate.avg_hr;
  if (hr === null) return false;
  if (hr >= 178) return true;
  const peer = candidate.heart_rate_peer_reference;
  const baseline = peer?.next_best_hr ?? peer?.peer_median_hr ?? null;
  if (baseline === null) return hr >= 175;
  return hr >= baseline - 6;
}

function candidateHasStrongHrMismatch(candidate: ResultCandidate): boolean {
  const warnings = new Set(candidate.warnings ?? []);
  if (!warnings.has("heart_rate_mismatch")) return false;
  const ref = candidate.heart_rate_peer_reference;
  if (!ref) return false;
  const gap = Math.max(ref.hr_gap_vs_median, ref.hr_gap_vs_next_best ?? 0);
  return gap >= 20;
}

function candidateHasFastPeerPace(candidate: ResultCandidate): boolean {
  return (candidate.warnings ?? []).includes("pace_outlier");
}

function candidateHasBlockingQualityWarning(candidate: ResultCandidate): boolean {
  const warnings = new Set(candidate.warnings ?? []);
  return (
    warnings.has("gps_or_speed_anomaly") ||
    warnings.has("speed_summary_inconsistent") ||
    warnings.has("duration_distance_mismatch") ||
    warnings.has("normalized_speed_mismatch") ||
    warnings.has("impossible_summary_metrics") ||
    warnings.has("implausible_max_speed")
  );
}

function isWeekendDate(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function deriveResultModel(candidate: ResultCandidate): ResultCandidate {
  const dataQuality = candidate.data_quality_status ?? "clean";
  const warnings = new Set(candidate.warnings ?? []);
  const reasons: string[] = [];
  let score = 0;

  const sameDayEventCredible =
    candidate.same_day_event &&
    Boolean(candidate.event_name?.trim()) &&
    candidate.event_confidence >= 0.45;

  if (dataQuality === "excluded") {
    reasons.push("Excluded because summary metrics are not trustworthy.");
    return {
      ...candidate,
      result_status: "excluded",
      result_confidence_score: 0,
      result_confidence_reasons: reasons,
      display_class: "excluded",
      rationale: "Excluded: summary metrics contain impossible or unusable data.",
    };
  }

  if (sameDayEventCredible) {
    score += 100;
    reasons.push(`Same-day event match: ${candidate.event_name ?? "named event"} (${candidate.event_confidence}).`);
    if (dataQuality === "suspicious") {
      reasons.push("Event is present, but workout summary still has suspicious quality warnings.");
    } else {
      reasons.push("Workout summary metrics look internally plausible.");
    }
    return {
      ...candidate,
      result_status: "official_event",
      result_confidence_score: Math.min(100, score),
      result_confidence_reasons: reasons,
      display_class: dataQuality === "suspicious" ? "official_flagged" : "official_best",
      rationale:
        dataQuality === "suspicious"
          ? `Official event with suspicious data: ${candidate.event_name ?? "event"}; ${formatWarningsCell(candidate)}.`
          : `Official event result: ${candidate.event_name ?? "event"} with clean summary data.`,
    };
  }

  const weekend = isWeekendDate(candidate.date);
  const raceKeyword = candidateHasRaceKeyword(candidate);
  const pr = candidateHasPersonalRecord(candidate);
  const hardHr = candidateHasHardEffortHr(candidate);
  const fastPeerPace = candidateHasFastPeerPace(candidate);
  const blockingQuality = candidateHasBlockingQualityWarning(candidate);
  const strongHrMismatch = candidateHasStrongHrMismatch(candidate);
  const weekdayNoEventLowConfidence =
    isWeekday(candidate.date) && !candidate.same_day_event && warnings.has("low_confidence_race_result");
  const coreResultSignals = [weekend, raceKeyword, pr, fastPeerPace].filter(Boolean).length;
  const strongStandaloneResult =
    fastPeerPace && (weekend || raceKeyword || pr || hardHr);
  const reviewWorthyStandalone =
    fastPeerPace || (pr && (weekend || raceKeyword)) || (raceKeyword && hardHr);

  if (weekend) {
    score += 18;
    reasons.push("Weekend standalone effort.");
  }
  if (raceKeyword) {
    score += 22;
    reasons.push("Race-like title or text.");
  }
  if (pr) {
    score += 24;
    reasons.push(`Personal records logged (${candidate.personalRecordCount}).`);
  }
  if (hardHr) {
    score += 10;
    reasons.push("HR supports hard effort versus peers.");
  }
  if (fastPeerPace) {
    score += 14;
    reasons.push("Faster than nearby peer candidates.");
  }
  if (dataQuality === "clean") {
    score += 8;
    reasons.push("Clean summary data.");
  }
  if (warnings.has("distance_near_window_edge")) {
    score -= 4;
    reasons.push("Distance sits near the bucket edge.");
  }
  if (warnings.has("pace_outlier")) {
    reasons.push("Pace outlier remains visible for coach review.");
  }
  if (blockingQuality) {
    score -= 35;
    reasons.push("Blocking summary contradictions reduce result confidence.");
  }
  if (strongHrMismatch) {
    score -= 18;
    reasons.push("HR is much lower than peer efforts.");
  }
  if (weekdayNoEventLowConfidence) {
    score -= 16;
    reasons.push("Weekday fast standalone result without event confirmation.");
  }
  if (warnings.has("low_confidence_race_result") && !weekdayNoEventLowConfidence) {
    score -= 10;
    reasons.push("Standalone result lacks enough race context.");
  }
  if (dataQuality === "suspicious" && !blockingQuality) {
    score -= 10;
    reasons.push("Suspicious quality warnings need coach confirmation.");
  }

  score = Math.max(0, Math.min(100, score));

  let result_status: NonNullable<ResultCandidate["result_status"]>;
  if (blockingQuality) {
    result_status = "needs_coach_review";
  } else if (score >= 60 && strongStandaloneResult) {
    result_status = dataQuality === "clean" ? "probable_result" : "needs_coach_review";
  } else if (score >= 42 && reviewWorthyStandalone) {
    result_status = "needs_coach_review";
  } else if (score >= 32 && coreResultSignals >= 2 && (raceKeyword || pr || fastPeerPace)) {
    result_status = "possible_result";
  } else {
    result_status = "training_candidate";
  }

  let display_class: NonNullable<ResultCandidate["display_class"]>;
  if (result_status === "probable_result") display_class = "probable_best";
  else if (result_status === "excluded") display_class = "excluded";
  else if (result_status === "possible_result" || result_status === "needs_coach_review") display_class = "manual_review";
  else display_class = "display_candidate";

  const rationaleParts: string[] = [];
  if (result_status === "probable_result") rationaleParts.push("Fast probable result without event.");
  if (result_status === "needs_coach_review") rationaleParts.push("Plausible strong result that needs coach confirmation.");
  if (result_status === "possible_result") rationaleParts.push("Possible result signal, but weaker than probable.");
  if (result_status === "training_candidate") rationaleParts.push("Clean standalone distance workout used as training reference.");
  if (hardHr) rationaleParts.push("HR supports hard effort.");
  if (pr) rationaleParts.push(`personalRecordCount=${candidate.personalRecordCount}.`);
  if (warnings.has("pace_outlier") && !blockingQuality) rationaleParts.push("pace_outlier only.");
  if (warnings.size > 0 && !(warnings.has("pace_outlier") && warnings.size === 1)) {
    rationaleParts.push(`Warnings: ${formatWarningsCell(candidate)}.`);
  }

  return {
    ...candidate,
    result_status,
    result_confidence_score: score,
    result_confidence_reasons: reasons,
    display_class,
    rationale: rationaleParts.join(" ").trim() || "Standalone candidate.",
  };
}

function shouldIncludeInDisplay(candidate: ResultCandidate): boolean {
  return (
    candidate.display_class === "official_best" ||
    candidate.display_class === "official_flagged" ||
    candidate.display_class === "probable_best" ||
    candidate.display_class === "clean_training_best" ||
    candidate.result_status === "needs_coach_review" ||
    candidate.result_status === "possible_result" ||
    candidate.result_status === "excluded"
  );
}

function dedupeCandidates(candidates: ResultCandidate[]): ResultCandidate[] {
  const seen = new Set<number>();
  const unique: ResultCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.workoutId)) continue;
    seen.add(candidate.workoutId);
    unique.push(candidate);
  }
  return unique;
}

const GPS_SPEED_DATA_QUALITY_WARNINGS: DataQualityWarning[] = [
  "gps_or_speed_anomaly",
  "speed_summary_inconsistent",
  "duration_distance_mismatch",
  "normalized_speed_mismatch",
  "impossible_summary_metrics",
  "implausible_max_speed",
];

function hasGpsSpeedDataQualityWarning(candidate: ResultCandidate): boolean {
  const warnings = new Set(candidate.warnings ?? []);
  return GPS_SPEED_DATA_QUALITY_WARNINGS.some((warning) => warnings.has(warning));
}

function isEligibleCleanTrainingAnchor(candidate: ResultCandidate): boolean {
  if (candidate.result_status !== "training_candidate") return false;
  if (candidate.data_quality_status !== "clean") return false;
  if (candidate.same_day_event) return false;
  if (candidateHasRaceKeyword(candidate)) return false;
  if (hasGpsSpeedDataQualityWarning(candidate)) return false;
  return true;
}

function hasPerfectCleanTrainingProfile(candidate: ResultCandidate): boolean {
  const warnings = new Set(candidate.warnings ?? []);
  if (warnings.has("pace_outlier")) return false;
  if (warnings.has("heart_rate_mismatch")) return false;
  if (warnings.has("low_confidence_race_result")) return false;
  if (warnings.has("distance_near_window_edge")) return false;
  return true;
}

function selectPossibleResultBest(candidates: ResultCandidate[]): ResultCandidate | null {
  return (
    candidates.find(
      (candidate) =>
        candidate.result_status === "possible_result" && candidate.data_quality_status !== "excluded",
    ) ?? null
  );
}

function selectProbableOrPossibleBest(input: {
  probable_best: ResultCandidate | null;
  candidates: ResultCandidate[];
}): ResultCandidate | null {
  if (input.probable_best) return input.probable_best;
  return selectPossibleResultBest(input.candidates);
}

function displayCandidateRank(candidate: ResultCandidate): number {
  if (candidate.display_class === "official_best" || candidate.display_class === "official_flagged") {
    return 0;
  }
  if (
    candidate.result_status === "probable_result" ||
    candidate.result_status === "needs_coach_review" ||
    candidate.result_status === "possible_result"
  ) {
    return 1;
  }
  if (candidate.display_class === "clean_training_best") return 2;
  if (candidate.result_status === "excluded") return 4;
  return 3;
}

function sortDisplayCandidates(candidates: ResultCandidate[]): ResultCandidate[] {
  return [...candidates].sort((a, b) => {
    const rankDelta = displayCandidateRank(a) - displayCandidateRank(b);
    if (rankDelta !== 0) return rankDelta;
    const paceDelta = a.pace_min_per_km - b.pace_min_per_km;
    if (paceDelta !== 0) return paceDelta;
    return a.date.localeCompare(b.date) || a.workoutId - b.workoutId;
  });
}

function selectCleanTrainingBest(candidates: ResultCandidate[]): {
  best: ResultCandidate | null;
  needsReview: boolean;
} {
  const eligible = candidates.filter(isEligibleCleanTrainingAnchor);
  if (!eligible.length) return { best: null, needsReview: false };

  const withoutEdgeWarning = eligible.filter(
    (candidate) => !(candidate.warnings ?? []).includes("distance_near_window_edge"),
  );
  const edgePool = withoutEdgeWarning.length ? withoutEdgeWarning : eligible;

  const perfect = edgePool.filter(hasPerfectCleanTrainingProfile);
  if (perfect.length) {
    return { best: perfect[0]!, needsReview: false };
  }

  if (edgePool.length) {
    return { best: edgePool[0]!, needsReview: true };
  }

  return { best: eligible[0]!, needsReview: true };
}

function applyDataQualityToBucket(input: {
  candidates: ResultCandidate[];
  rawByWorkoutId: Map<number, TrainingPeaksWorkoutRaw>;
  window: DistanceWindow;
}): {
  candidates: ResultCandidate[];
  official_best: ResultCandidate | null;
  official_flagged: ResultCandidate | null;
  probable_best: ResultCandidate | null;
  probable_or_possible_best: ResultCandidate | null;
  clean_training_best: ResultCandidate | null;
  clean_training_best_needs_review: boolean;
  display_candidates: ResultCandidate[];
  best_result: ResultCandidate | null;
  best_candidate_needs_review: ResultCandidate | null;
  excluded_candidates_count: number;
} {
  const sorted = [...input.candidates].sort((a, b) => a.pace_min_per_km - b.pace_min_per_km);
  const paces = sorted.map((candidate) => candidate.pace_min_per_km);
  const medianPace = median(paces);

  const qualityEnriched = sorted.map((candidate, index) => {
    const peerCandidates = sorted.filter((_, peerIndex) => peerIndex !== index);
    const nextBestCandidate = sorted[index + 1] ?? null;
    const quality = assessCandidateDataQuality({
      candidate,
      raw: input.rawByWorkoutId.get(candidate.workoutId),
      window: input.window,
      rankByPace: index,
      peerCandidates,
      medianPace,
      nextBestPace: nextBestCandidate?.pace_min_per_km ?? null,
      nextBestCandidate,
      parseNumber: toFiniteNumber,
    });
    return { ...candidate, ...quality };
  });

  const enriched = qualityEnriched.map((candidate) => deriveResultModel(candidate));

  const official_best =
    enriched.find(
      (candidate) =>
        candidate.result_status === "official_event" && candidate.data_quality_status !== "excluded",
    ) ?? null;
  const official_flagged =
    enriched.find(
      (candidate) =>
        candidate.result_status === "official_event" && candidate.data_quality_status === "suspicious",
    ) ?? null;
  const probable_best =
    enriched.find(
      (candidate) =>
        (candidate.result_status === "probable_result" || candidate.result_status === "needs_coach_review") &&
        candidate.data_quality_status !== "excluded",
    ) ?? null;
  const probable_or_possible_best = selectProbableOrPossibleBest({
    probable_best,
    candidates: enriched,
  });
  const cleanTrainingSelection = selectCleanTrainingBest(enriched);
  const clean_training_best = cleanTrainingSelection.best;
  const clean_training_best_needs_review = cleanTrainingSelection.needsReview;

  const enrichedWithDisplayClass = enriched.map((candidate) => {
    if (
      clean_training_best &&
      candidate.workoutId === clean_training_best.workoutId &&
      candidate.result_status === "training_candidate"
    ) {
      return { ...candidate, display_class: "clean_training_best" as const };
    }
    if (candidate.display_class === "clean_training_best") {
      return { ...candidate, display_class: "display_candidate" as const };
    }
    return candidate;
  });

  const cleanTrainingBestForDisplay =
    clean_training_best
      ? enrichedWithDisplayClass.find(
          (candidate) => candidate.workoutId === clean_training_best.workoutId,
        ) ?? clean_training_best
      : null;

  const displayCandidates = sortDisplayCandidates(
    dedupeCandidates(
      [
        official_best,
        official_flagged,
        probable_best,
        probable_or_possible_best,
        cleanTrainingBestForDisplay,
        ...enrichedWithDisplayClass.filter((candidate) => shouldIncludeInDisplay(candidate)),
      ].filter((candidate): candidate is ResultCandidate => candidate !== null),
    ),
  ).slice(0, DISPLAY_CANDIDATE_LIMIT);

  const best_result = official_best ?? probable_best ?? clean_training_best ?? null;
  const best_candidate_needs_review =
    enrichedWithDisplayClass.find(
      (candidate) =>
        candidate.result_status === "needs_coach_review" || candidate.data_quality_status === "suspicious",
    ) ?? null;
  const excluded_candidates_count = enrichedWithDisplayClass.filter(
    (candidate) => candidate.data_quality_status === "excluded",
  ).length;

  return {
    candidates: enrichedWithDisplayClass,
    official_best,
    official_flagged,
    probable_best,
    probable_or_possible_best,
    clean_training_best: cleanTrainingBestForDisplay,
    clean_training_best_needs_review,
    display_candidates: displayCandidates,
    best_result,
    best_candidate_needs_review,
    excluded_candidates_count,
  };
}

function formatDataQualityStatusLabel(status: DataQualityStatus | undefined): string {
  switch (status) {
    case "clean":
      return "чистые данные";
    case "suspicious":
      return "есть предупреждения";
    case "excluded":
      return "исключено";
    default:
      return "неизвестно";
  }
}

function formatDataQualityStatus(candidate: ResultCandidate): string {
  return formatDataQualityStatusLabel(candidate.data_quality_status);
}

function formatResultStatus(candidate: ResultCandidate): string {
  switch (candidate.result_status) {
    case "official_event":
      return "официальный старт";
    case "probable_result":
      return "вероятный результат";
    case "possible_result":
      return "возможный результат";
    case "training_candidate":
      return "тренировка";
    case "needs_coach_review":
      return "проверить тренеру";
    case "excluded":
      return "исключено";
    default:
      return "неизвестно";
  }
}

function formatWarningsCell(candidate: ResultCandidate): string {
  const warnings = candidate.warnings ?? [];
  if (!warnings.length) return "—";

  const parts = [...warnings];
  const hrRef = candidate.heart_rate_peer_reference;
  if (
    warnings.includes("heart_rate_mismatch") &&
    candidate.avg_hr !== null &&
    hrRef
  ) {
    const peerLabel = hrRef.next_best_hr ?? hrRef.peer_median_hr;
    const extras: string[] = [`HR ${Math.round(candidate.avg_hr)} vs peer ~${peerLabel}`];
    if (!candidate.same_day_event) extras.push("no event");
    if (candidate.day_of_week && isWeekday(candidate.date)) extras.push("weekday");
    parts.push(`(${extras.join(", ")})`);
  }

  return parts.join(", ");
}

function shouldIncludeInManualReview(candidate: ResultCandidate): boolean {
  if (candidate.data_quality_status === "excluded") return true;
  if (candidate.data_quality_status === "suspicious") return true;
  if (candidate.result_status === "needs_coach_review") return true;
  return false;
}

function buildShortReviewReason(candidate: ResultCandidate): string {
  const status = candidate.data_quality_status ?? "unknown";
  const warnings = candidate.warnings ?? [];
  const warningText = warnings.length ? warnings.join(", ") : "no warnings";
  if (status === "excluded") {
    return `Excluded from bests (${warningText})`;
  }
  if (candidate.result_status === "needs_coach_review") {
    return candidate.rationale ?? `Needs coach review (${warningText})`;
  }
  if (status === "suspicious" || candidate.review_required) {
    return `Suspicious summary data (${warningText})`;
  }
  if (candidate.result_status === "possible_result") {
    return candidate.rationale ?? `Possible result (${warningText})`;
  }
  return candidate.rationale ?? "Flagged for manual review";
}

function toManualReviewCandidate(
  candidate: ResultCandidate,
  distanceLabel: string,
): ManualReviewCandidate {
  const hr = candidate.avg_hr ?? null;
  return {
    distance_bucket: candidate.distance_bucket,
    distance_label: distanceLabel,
    date: candidate.date,
    day_of_week: candidate.day_of_week ?? null,
    workoutId: candidate.workoutId,
    title: candidate.title,
    distance_km: candidate.distance_km,
    duration_text: candidate.duration_text,
    pace_text: candidate.pace_text,
    data_quality_status: candidate.data_quality_status ?? "suspicious",
    data_quality_score: candidate.data_quality_score ?? 0,
    warnings: candidate.warnings ?? [],
    review_required: candidate.review_required ?? false,
    can_be_official_best: candidate.can_be_official_best ?? false,
    same_day_event: candidate.same_day_event,
    event_name: candidate.event_name,
    event_distance_km: candidate.event_distance_km,
    event_confidence: candidate.event_confidence,
    heartRateAverage: hr,
    avg_hr: hr,
    heart_rate_peer_reference: candidate.heart_rate_peer_reference ?? null,
    result_status: candidate.result_status ?? "needs_coach_review",
    result_confidence_score: candidate.result_confidence_score ?? 0,
    result_confidence_reasons: candidate.result_confidence_reasons ?? [],
    display_class: candidate.display_class ?? "manual_review",
    rationale: candidate.rationale ?? buildShortReviewReason(candidate),
    short_review_reason: buildShortReviewReason(candidate),
  };
}

function manualReviewSeverityRank(status: DataQualityStatus | undefined): number {
  if (status === "excluded") return 0;
  if (status === "suspicious") return 1;
  return 2;
}

function sortManualReviewCandidatesByPace(
  candidates: ManualReviewCandidate[],
  distanceResults: Partial<Record<DistanceKey, DistanceBucketReport>>,
): ManualReviewCandidate[] {
  const paceByWorkoutId = new Map<number, number>();
  for (const bucket of Object.values(distanceResults)) {
    if (!bucket) continue;
    for (const row of bucket.candidates) {
      paceByWorkoutId.set(row.workoutId, row.pace_min_per_km);
    }
  }

  const distanceOrder = new Map(ALL_DISTANCE_KEYS.map((key, index) => [key, index]));
  return [...candidates].sort((a, b) => {
    const distanceDelta =
      (distanceOrder.get(a.distance_bucket) ?? 99) - (distanceOrder.get(b.distance_bucket) ?? 99);
    if (distanceDelta !== 0) return distanceDelta;

    const severityDelta =
      manualReviewSeverityRank(a.data_quality_status) -
      manualReviewSeverityRank(b.data_quality_status);
    if (severityDelta !== 0) return severityDelta;

    const paceA = paceByWorkoutId.get(a.workoutId) ?? Number.POSITIVE_INFINITY;
    const paceB = paceByWorkoutId.get(b.workoutId) ?? Number.POSITIVE_INFINITY;
    if (paceA !== paceB) return paceA - paceB;

    return a.date.localeCompare(b.date) || a.workoutId - b.workoutId;
  });
}

function buildManualReviewCandidates(input: {
  distanceKeys: DistanceKey[];
  distanceResults: Partial<Record<DistanceKey, DistanceBucketReport>>;
}): ManualReviewCandidate[] {
  const collected: ManualReviewCandidate[] = [];
  for (const key of input.distanceKeys) {
    const bucket = input.distanceResults[key];
    if (!bucket) continue;
    for (const candidate of bucket.candidates) {
      if (!shouldIncludeInManualReview(candidate)) continue;
      collected.push(toManualReviewCandidate(candidate, bucket.label));
    }
  }
  return sortManualReviewCandidatesByPace(collected, input.distanceResults);
}

function buildManualReviewSummary(candidates: ManualReviewCandidate[]): ManualReviewSummary {
  const by_distance: Record<string, number> = {};
  const by_warning: Record<string, number> = {};
  for (const candidate of candidates) {
    by_distance[candidate.distance_label] = (by_distance[candidate.distance_label] ?? 0) + 1;
    for (const warning of candidate.warnings) {
      by_warning[warning] = (by_warning[warning] ?? 0) + 1;
    }
  }
  return { total: candidates.length, by_distance, by_warning };
}

function formatManualReviewHrCheck(candidate: ManualReviewCandidate): string {
  const hr = candidate.avg_hr ?? candidate.heartRateAverage;
  const hrRef = candidate.heart_rate_peer_reference;
  if (hr === null || !hrRef) return "—";
  const peerLabel = hrRef.next_best_hr ?? hrRef.peer_median_hr;
  return `HR ${Math.round(hr)} vs peer ~${peerLabel}`;
}

function formatManualReviewEventCell(candidate: ManualReviewCandidate): string {
  if (!candidate.same_day_event || !candidate.event_name) return "нет старта";
  const distance =
    candidate.event_distance_km !== null ? ` (${candidate.event_distance_km} км)` : "";
  return `${candidate.event_name}${distance}`;
}

function mentionsTriathlonContext(candidate: ResultCandidate): boolean {
  const parts = [
    candidate.title,
    candidate.event_name,
    ...(candidate.race_signals ?? []),
    candidate.rationale,
  ];
  const blob = parts.filter(Boolean).join(" ").toLowerCase();
  return /\b(triathlon|триатлон)\b/i.test(blob);
}

function formatShortCourseNote(candidate: ResultCandidate): string | null {
  const thresholdKm = SHORT_COURSE_NOTE_THRESHOLD_KM[candidate.distance_bucket];
  if (thresholdKm === undefined || candidate.distance_km >= thresholdKm) return null;
  const targetLabel = DISTANCE_PRESETS[candidate.distance_bucket].label;
  const triathlonHint = mentionsTriathlonContext(candidate) ? " / триатлон" : "";
  return `дистанция короче ${targetLabel}, проверить контекст${triathlonHint}`;
}

function formatCandidateResultStatusNote(candidate: ResultCandidate): string | null {
  switch (candidate.result_status) {
    case "probable_result":
      return null;
    case "needs_coach_review":
      return "проверить";
    case "possible_result":
      return "возможный результат / проверить";
    default:
      return null;
  }
}

function formatSummaryCell(candidate: ResultCandidate | null | undefined, emptyLabel = "Нет данных"): string {
  if (!candidate) return emptyLabel;
  const base = `${candidate.date} — ${candidate.distance_km} км / ${candidate.duration_text} — ${candidate.pace_text}`;
  const notes = [
    formatCandidateResultStatusNote(candidate),
    formatShortCourseNote(candidate),
  ].filter((note): note is string => Boolean(note));
  if (!notes.length) return base;
  return `${base} — ${notes.join("; ")}`;
}

function formatSummaryNotes(bucket: DistanceBucketReport | undefined): string {
  if (!bucket) return "Нет данных";
  const notes: string[] = [];
  if (bucket.official_flagged) notes.push("Официальный старт с предупреждениями по данным");
  if (
    bucket.probable_or_possible_best?.result_status === "possible_result" &&
    !bucket.probable_best
  ) {
    notes.push("Возможный результат без официального старта");
  }
  if (bucket.probable_best?.result_status === "needs_coach_review") notes.push("Нужна проверка тренером");
  if (bucket.clean_training_best_needs_review) notes.push("Тренировочный ориентир требует проверки");
  const excludedCount = bucket.candidates.filter((candidate) => candidate.result_status === "excluded").length;
  if (excludedCount > 0) notes.push(`Исключено: ${excludedCount}`);
  return notes.join("; ") || "—";
}

function formatDisplayLabel(candidate: ResultCandidate): string {
  if (candidate.display_class === "clean_training_best") return "тренировочный ориентир";
  if (candidate.result_status === "official_event") {
    return candidate.data_quality_status === "suspicious"
      ? "официальный старт / есть предупреждения"
      : "официальный старт";
  }
  if (candidate.result_status === "probable_result") return "вероятный результат";
  if (candidate.result_status === "training_candidate") return "тренировка";
  if (candidate.result_status === "needs_coach_review") return "проверить тренеру";
  if (candidate.result_status === "possible_result") return "возможный результат";
  return "исключено";
}

function scoreEventForCandidate(event: ParsedEvent, distanceKey: DistanceKey, window: DistanceWindow): {
  score: number;
  reasons: string[];
} {
  return scoreSharedEventForCandidate({
    event,
    target_km: window.target_km,
    matchesDistanceKeyword: (blob) => DISTANCE_KEYWORDS[distanceKey].test(blob),
    matchesRaceKeyword: (blob) => RACE_KEYWORDS_PATTERN.test(blob),
  });
}

function matchSameDayEvent(input: {
  workoutDate: string;
  distanceKey: DistanceKey;
  window: DistanceWindow;
  eventsByDate: Map<string, ParsedEvent[]>;
}): {
  same_day_event: boolean;
  event_name: string | null;
  event_date: string | null;
  event_distance_km: number | null;
  event_id: string | null;
  event_source: "events_api" | null;
  event_match_reason: string[];
  event_confidence: number;
} {
  return matchSharedSameDayEvent({
    workoutDate: input.workoutDate,
    eventsByDate: input.eventsByDate,
    scoreEvent: (event) => scoreEventForCandidate(event, input.distanceKey, input.window),
  });
}

function buildCleanCandidate(input: {
  raw: TrainingPeaksWorkoutRaw;
  window: DistanceWindow;
  distanceKey: DistanceKey;
  eventsByDate: Map<string, ParsedEvent[]>;
}): ResultCandidate | null {
  const workoutId = toPositiveInt(input.raw.workoutId);
  const date = toIsoDatePart(input.raw.workoutDay);
  const distanceMeters = toFiniteNumber(input.raw.distance);
  const durationHours = toFiniteNumber(input.raw.totalTime);
  if (!workoutId || !date || distanceMeters === null || durationHours === null) return null;
  if (distanceMeters < input.window.min_meters || distanceMeters > input.window.max_meters) return null;
  if (durationHours <= 0) return null;

  const distanceKm = distanceMeters / 1000;
  const durationMin = durationHours * 60;
  const paceMinPerKm = durationMin / distanceKm;

  const reasons: string[] = [
    `completed_distance_m=${Math.round(distanceMeters)}`,
    `duration_min=${durationMin.toFixed(1)}`,
    `pace_min_per_km=${paceMinPerKm.toFixed(2)}`,
  ];

  const centerDelta = Math.abs(distanceMeters - input.window.target_km * 1000);
  let confidence = 0.72;
  const toleranceMeters = Math.max(400, (input.window.max_meters - input.window.min_meters) * 0.15);
  if (centerDelta <= toleranceMeters * 0.4) confidence = 0.95;
  else if (centerDelta <= toleranceMeters) confidence = 0.85;
  if (
    distanceMeters >= input.window.min_meters + 100 &&
    distanceMeters <= input.window.max_meters - 100
  ) {
    reasons.push("distance_within_clean_window");
  } else {
    reasons.push("distance_near_window_edge");
    confidence -= 0.08;
  }

  const eventMatch = matchSameDayEvent({
    workoutDate: date,
    distanceKey: input.distanceKey,
    window: input.window,
    eventsByDate: input.eventsByDate,
  });
  if (eventMatch.same_day_event) {
    reasons.push("same_day_event");
    confidence = Math.min(0.99, confidence + 0.05);
  }

  const raceSignals = collectRaceSignals(input.raw, input.distanceKey);
  if (raceSignals.length > 0) {
    reasons.push(...raceSignals.map((signal) => `race_signal:${signal}`));
    confidence = Math.min(0.99, confidence + raceSignals.length * 0.03);
  }

  return {
    workoutId,
    date,
    title: typeof input.raw.title === "string" ? input.raw.title : null,
    distance_bucket: input.distanceKey,
    distance_km: Math.round(distanceKm * 100) / 100,
    duration_min: Math.round(durationMin * 10) / 10,
    duration_text: formatDurationText(durationMin),
    pace_min_per_km: Math.round(paceMinPerKm * 100) / 100,
    pace_text: formatPaceText(paceMinPerKm),
    avg_hr: toFiniteNumber(input.raw.heartRateAverage),
    tssActual: toFiniteNumber(input.raw.tssActual),
    if: toFiniteNumber(input.raw.if),
    personalRecordCount: toFiniteNumber(input.raw.personalRecordCount),
    raceTypeDuration: input.raw.raceTypeDuration ?? null,
    confidence: Math.max(0.5, Math.min(0.99, Number(confidence.toFixed(2)))),
    reasons,
    ...eventMatch,
    race_signals: raceSignals.length > 0 ? raceSignals : undefined,
  };
}

function toLegacyClean5k(candidate: ResultCandidate): Clean5kCandidate {
  return {
    workoutId: candidate.workoutId,
    date: candidate.date,
    title: candidate.title,
    distance_km: candidate.distance_km,
    duration_min: candidate.duration_min,
    pace_min_per_km: candidate.pace_min_per_km,
    avg_hr: candidate.avg_hr,
    tssActual: candidate.tssActual,
    if: candidate.if,
    personalRecordCount: candidate.personalRecordCount,
    raceTypeDuration: candidate.raceTypeDuration,
    confidence: candidate.confidence,
    reasons: candidate.reasons,
  };
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

  if (DISTANCE_KEYWORDS["5k"].test(blob)) reasons.push("distance_label_5k");
  if (RACE_KEYWORDS_PATTERN.test(blob)) reasons.push("race_or_start_keywords");
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

function formatResultLine(candidate: ResultCandidate): string {
  return `${candidate.distance_km} км / ${candidate.duration_text}`;
}

function formatEventCell(candidate: ResultCandidate): string {
  if (!candidate.same_day_event || !candidate.event_name) return "нет старта";
  const distance =
    candidate.event_distance_km !== null ? ` (${candidate.event_distance_km} км)` : "";
  return `${candidate.event_name}${distance}`;
}

function createMarkdown(report: ProbeReport): string {
  const lines: string[] = [];
  lines.push("# Race Results Probe");
  lines.push("");
  lines.push("## Athlete / range");
  lines.push(`- Athlete: **${report.athlete.student_name ?? report.athlete.athlete_id}** (id ${report.athlete.athlete_id})`);
  lines.push(`- Range: \`${report.range.from}\` → \`${report.range.to}\``);
  lines.push(`- Workouts scanned: **${report.workouts_scanned}**`);
  lines.push(`- Events scanned: **${report.events_scanned}**`);
  lines.push("");

  lines.push("## Лучшие результаты по дистанциям");
  lines.push(
    "| Дистанция | Официальный старт | Кандидат на результат / проверить | Тренировочный ориентир | Заметки |",
  );
  lines.push("| --- | --- | --- | --- | --- |");
  for (const key of report.target_distances) {
    const bucket = report.distance_results[key];
    lines.push(
      `| ${bucket?.label ?? key} | ${formatSummaryCell(bucket?.official_best, "Нет данных")} | ${formatSummaryCell(bucket?.probable_or_possible_best, "Нет данных")} | ${formatSummaryCell(bucket?.clean_training_best, "Нет данных")} | ${formatSummaryNotes(bucket)} |`,
    );
  }
  lines.push("");
  lines.push("_Проверяемые кандидаты не скрываются под более медленными чистыми тренировками._");
  lines.push("");

  lines.push("## ⚠️ Требуют ручной проверки");
  if (!report.manual_review_candidates.length) {
    lines.push("Нет кандидатов для ручной проверки.");
  } else {
    lines.push(
      "| Дистанция | Дата | Результат | Темп | Тип | Качество данных | Старт | Пульс | Пояснение |",
    );
    lines.push("|---|---|---:|---:|---|---|---|---|---|");
    for (const row of report.manual_review_candidates) {
      const resultLine = `${row.distance_km} км / ${row.duration_text}`;
      lines.push(
        `| ${row.distance_label} | ${row.date} | ${resultLine} | ${row.pace_text} | ${formatResultStatus(row)} | ${formatDataQualityStatusLabel(row.data_quality_status)} | ${formatManualReviewEventCell(row)} | ${formatManualReviewHrCheck(row)} | ${row.rationale} |`,
      );
    }
    lines.push("");
    lines.push("Эти кандидаты остаются видимыми для тренера и не подменяются более медленными training-ориентирами.");
  }
  lines.push("");

  for (const key of report.target_distances) {
    const bucket = report.distance_results[key];
    if (!bucket) continue;
    lines.push(`## ${bucket.label}`);
    if (!bucket.display_candidates.length) {
      lines.push("- Нет подходящих кандидатов в этом диапазоне дистанции.");
    } else {
      lines.push("| Дата | День | Результат | Темп | Тип | Старт | Качество данных | Пояснение |");
      lines.push("| --- | --- | ---: | ---: | --- | --- | --- | --- |");
      for (const row of bucket.display_candidates) {
        const raceReasons = row.reasons.filter((reason) => reason.startsWith("race_signal:"));
        const noteParts = [row.rationale ?? (raceReasons.join(", ") || null), formatShortCourseNote(row)].filter(
          (part): part is string => Boolean(part),
        );
        const noteText = noteParts.length ? noteParts.join("; ") : "—";
        lines.push(
          `| ${row.date} | ${row.day_of_week ?? "—"} | ${formatResultLine(row)} | ${row.pace_text} | ${formatDisplayLabel(row)} | ${formatEventCell(row)} | ${formatDataQualityStatus(row)} | ${noteText} |`,
        );
      }
    }
    if (bucket.excluded_candidates_count > 0) {
      lines.push(
        `- Исключено по качеству данных: **${bucket.excluded_candidates_count}**`,
      );
    }
    lines.push("");
  }

  lines.push("## Planned events matched to workouts");
  if (!report.event_workout_links.length) {
    lines.push("- None");
  } else {
    lines.push("| Date | Event | Workout | Distance | Match confidence |");
    lines.push("| --- | --- | --- | ---: | ---: |");
    for (const link of report.event_workout_links) {
      lines.push(
        `| ${link.event_date} | ${link.event_name ?? ""} | ${link.workout_title ?? link.workout_id} | ${link.distance_km} km (${link.distance_bucket}) | ${link.event_confidence} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("- This report uses standalone workouts only.");
  lines.push("- Rolling/best segment inside longer workouts is not included.");
  lines.push("- Rolling analysis requires FIT/lap/stream data from Workout Files.");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- report_json: \`${report.output_paths.report_json}\``);
  lines.push(`- report_md: \`${report.output_paths.report_md}\``);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const runMode = resolveRunMode(args);
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

    const parsedEvents =
      eventsResult.status === 200 ? parseEventsFromApi(eventsResult.body, args.from, args.to) : [];
    eventsApi.count = parsedEvents.length;

    const eventsByDate = new Map<string, ParsedEvent[]>();
    for (const event of parsedEvents) {
      const list = eventsByDate.get(event.event_date) ?? [];
      list.push(event);
      eventsByDate.set(event.event_date, list);
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

    const distanceResults: Partial<Record<DistanceKey, DistanceBucketReport>> = {};
    const excludedSummaryByDistance: Partial<Record<DistanceKey, ExcludedSummary>> = {};
    const eventWorkoutLinks: EventWorkoutLink[] = [];

    for (const distanceKey of runMode.distanceKeys) {
      const window = resolveDistanceWindow(args, distanceKey, runMode);
      const excluded: ExcludedSummary = {
        below_min_km: 0,
        above_max_km: 0,
        non_running: 0,
        not_completed: 0,
        out_of_date_range: 0,
      };
      const candidates: ResultCandidate[] = [];

      for (const item of inRangeItems) {
        const raw = rawByWorkoutId.get(item.trainingPeaksWorkoutId);
        if (!raw) continue;

        trackField("distance", raw.distance !== null && raw.distance !== undefined);
        trackField("totalTime", raw.totalTime !== null && raw.totalTime !== undefined);
        trackField("velocityAverage", raw.velocityAverage !== null && raw.velocityAverage !== undefined);
        trackField("velocityMaximum", raw.velocityMaximum !== null && raw.velocityMaximum !== undefined);
        trackField(
          "normalizedSpeedActual",
          raw.normalizedSpeedActual !== null && raw.normalizedSpeedActual !== undefined,
        );
        trackField("heartRateAverage", raw.heartRateAverage !== null && raw.heartRateAverage !== undefined);
        trackField("heartRateMinimum", raw.heartRateMinimum !== null && raw.heartRateMinimum !== undefined);
        trackField("heartRateMaximum", raw.heartRateMaximum !== null && raw.heartRateMaximum !== undefined);
        trackField("cadenceAverage", raw.cadenceAverage !== null && raw.cadenceAverage !== undefined);
        trackField("cadenceMaximum", raw.cadenceMaximum !== null && raw.cadenceMaximum !== undefined);
        trackField("powerAverage", raw.powerAverage !== null && raw.powerAverage !== undefined);
        trackField("powerMaximum", raw.powerMaximum !== null && raw.powerMaximum !== undefined);
        trackField(
          "normalizedPowerActual",
          raw.normalizedPowerActual !== null && raw.normalizedPowerActual !== undefined,
        );
        trackField("tssActual", raw.tssActual !== null && raw.tssActual !== undefined);
        trackField("if", raw.if !== null && raw.if !== undefined);
        trackField("personalRecordCount", raw.personalRecordCount !== null && raw.personalRecordCount !== undefined);
        trackField("raceTypeDuration", raw.raceTypeDuration !== null && raw.raceTypeDuration !== undefined);
        trackField("description", typeof raw.description === "string" && Boolean(raw.description.trim()));
        trackField("coachComments", typeof raw.coachComments === "string" && Boolean(raw.coachComments.trim()));
        trackField("workoutComments", typeof raw.workoutComments === "string" && Boolean(raw.workoutComments.trim()));
        trackField("rpe", raw.rpe !== null && raw.rpe !== undefined);
        trackField("feeling", raw.feeling !== null && raw.feeling !== undefined);
        trackField(
          "workoutDeviceSource",
          raw.workoutDeviceSource !== null && raw.workoutDeviceSource !== undefined,
        );
        trackField("syncedTo", raw.syncedTo !== null && raw.syncedTo !== undefined);

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
        if (distanceMeters > 0 && distanceMeters < window.min_meters) {
          excluded.below_min_km += 1;
          continue;
        }
        if (distanceMeters > window.max_meters) {
          excluded.above_max_km += 1;
          continue;
        }

        const candidate = buildCleanCandidate({
          raw,
          window,
          distanceKey,
          eventsByDate,
        });
        if (candidate) candidates.push(candidate);
      }

      candidates.sort((a, b) => a.pace_min_per_km - b.pace_min_per_km);
      excluded.out_of_date_range = normalizedItems.length - inRangeItems.length;
      excludedSummaryByDistance[distanceKey] = excluded;

      const qualityBucket = applyDataQualityToBucket({
        candidates,
        rawByWorkoutId,
        window,
      });

      for (const candidate of qualityBucket.candidates) {
        if (!candidate.same_day_event || !candidate.event_name) continue;
        eventWorkoutLinks.push({
          event_date: candidate.event_date ?? candidate.date,
          event_name: candidate.event_name,
          event_distance_km: candidate.event_distance_km,
          event_id: candidate.event_id,
          workout_id: candidate.workoutId,
          workout_title: candidate.title,
          distance_bucket: candidate.distance_bucket,
          distance_km: candidate.distance_km,
          event_match_reason: candidate.event_match_reason,
          event_confidence: candidate.event_confidence,
        });
      }

      distanceResults[distanceKey] = {
        label: window.label,
        distance_window: window,
        candidates_count: qualityBucket.candidates.length,
        official_best: qualityBucket.official_best,
        official_flagged: qualityBucket.official_flagged,
        probable_best: qualityBucket.probable_best,
        probable_or_possible_best: qualityBucket.probable_or_possible_best,
        candidate_result_summary: {
          official_best: qualityBucket.official_best,
          probable_or_possible_best: qualityBucket.probable_or_possible_best,
          clean_training_best: qualityBucket.clean_training_best,
        },
        clean_training_best: qualityBucket.clean_training_best,
        clean_training_best_needs_review: qualityBucket.clean_training_best_needs_review,
        display_candidates: qualityBucket.display_candidates,
        best_result: qualityBucket.best_result,
        best_candidate_needs_review: qualityBucket.best_candidate_needs_review,
        excluded_candidates_count: qualityBucket.excluded_candidates_count,
        candidates: qualityBucket.candidates,
      };
    }

    const workoutsByDate = new Map<string, number[]>();
    for (const item of inRangeItems) {
      if (!item.isCompleted) continue;
      const list = workoutsByDate.get(item.workoutDate) ?? [];
      list.push(item.trainingPeaksWorkoutId);
      workoutsByDate.set(item.workoutDate, list);
    }

    const plannedRaceCandidates: PlannedRaceCandidate[] = [];
    for (const event of parsedEvents) {
      const looks5k = looksLike5kEvent(event.raw);
      if (!looks5k.ok) continue;
      const distanceValue = pickFirstNonEmpty(event.raw, ["Distance", "distance"]);
      const distanceParsed = formatDistanceKm(distanceValue);
      const goalValue = pickFirstNonEmpty(event.raw, ["Goals", "goals", "Goal", "goal"]);
      const descriptionValue = pickFirstNonEmpty(event.raw, ["Description", "description", "Notes", "notes"]);
      const description =
        descriptionValue === null
          ? null
          : typeof descriptionValue === "string"
            ? descriptionValue
            : JSON.stringify(descriptionValue);
      const matchingWorkoutIds = workoutsByDate.get(event.event_date) ?? [];
      plannedRaceCandidates.push({
        event_date: event.event_date,
        event_title: event.event_name,
        sport_type: event.sport_type,
        distance: distanceParsed.distance,
        goal: sanitizeGoalValue(goalValue),
        description,
        matching_workout_ids: matchingWorkoutIds,
        confidence: Number(
          Math.min(0.99, 0.55 + looks5k.reasons.length * 0.1 + (matchingWorkoutIds.length > 0 ? 0.15 : 0)).toFixed(2),
        ),
        reasons: [
          ...looks5k.reasons,
          matchingWorkoutIds.length > 0
            ? `same_day_workouts=${matchingWorkoutIds.length}`
            : "no_same_day_completed_workout",
        ],
      });
    }

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

    const singleWindow =
      runMode.mode === "single" && runMode.singleDistanceKey
        ? distanceResults[runMode.singleDistanceKey]?.distance_window
        : undefined;

    const fiveKCandidates = distanceResults["5k"]?.candidates ?? [];
    const clean5kLegacy = fiveKCandidates.map(toLegacyClean5k);
    const raceLike5kLegacy: RaceLike5kCandidate[] = fiveKCandidates
      .filter((candidate) => (candidate.race_signals?.length ?? 0) > 0)
      .map((candidate) => ({
        ...toLegacyClean5k(candidate),
        race_signals: candidate.race_signals ?? [],
        confidence: Math.min(
          0.99,
          Number((candidate.confidence + (candidate.race_signals?.length ?? 0) * 0.04).toFixed(2)),
        ),
      }));

    const manualReviewCandidates = buildManualReviewCandidates({
      distanceKeys: runMode.distanceKeys,
      distanceResults,
    });
    const manualReviewSummary = buildManualReviewSummary(manualReviewCandidates);

    const report: ProbeReport = {
      run_at: runAt,
      mode: runMode.mode,
      athlete: {
        athlete_id: target.athleteId,
        athlete_url: target.athleteUrl,
        student_id: target.studentId,
        student_name: target.studentName,
      },
      range: { from: args.from, to: args.to },
      target_distance:
        runMode.mode === "single"
          ? (args.distancePreset ?? runMode.singleDistanceKey)
          : args.distances
            ? args.distances
            : "all",
      target_distances: runMode.distanceKeys,
      distance_window: singleWindow,
      distance_results: distanceResults,
      manual_review_candidates: manualReviewCandidates,
      manual_review_summary: manualReviewSummary,
      workouts_scanned: inRangeItems.length,
      events_scanned: parsedEvents.length,
      data_sources: { workouts: workoutsApi, events: eventsApi },
      fields_available: fieldsAvailable,
      fields_missing: fieldsMissing,
      planned_events_by_date: parsedEvents.map((event) => ({
        event_date: event.event_date,
        event_id: event.event_id,
        event_name: event.event_name,
        event_distance_km: event.event_distance_km,
        sport_type: event.sport_type,
        event_source: "events_api",
      })),
      event_workout_links: eventWorkoutLinks,
      excluded_summary_by_distance: excludedSummaryByDistance,
      notes: [
        "Read-only probe; no Supabase writes, no Telegram, no weekly reports.",
        "Rolling/best segment inside longer workouts is not included; it requires FIT/lap/stream analysis from Workout Files.",
        "Clean result = completed running workout with total distance in configured window (excludes rolling segments).",
        "Bests are split into official event, probable/check, and clean training lanes.",
      ],
      output_paths: {
        report_json: reportJsonPath,
        report_md: reportMdPath,
      },
    };

    if (runMode.mode === "single" && runMode.singleDistanceKey === "5k") {
      report.clean_5k_candidates = clean5kLegacy;
      report.race_like_5k_candidates = raceLike5kLegacy;
      report.planned_race_candidates = plannedRaceCandidates;
      report.excluded_summary = excludedSummaryByDistance["5k"];
    }

    await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(reportMdPath, createMarkdown(report), "utf8");

    console.log("[tp-probe-race-results] Summary");
    console.log(`athlete_id: ${target.athleteId}`);
    console.log(`range: ${args.from} -> ${args.to}`);
    console.log(`mode: ${runMode.mode}`);
    console.log(`workouts_scanned: ${report.workouts_scanned}`);
    console.log(`events_scanned: ${report.events_scanned}`);
    for (const key of runMode.distanceKeys) {
      const bucket = distanceResults[key];
      if (bucket?.official_best) {
        console.log(
          `official_best_${key}: ${bucket.official_best.date} | ${bucket.official_best.title ?? "untitled"} | ${bucket.official_best.distance_km} km | pace ${bucket.official_best.pace_text} | event ${bucket.official_best.event_name ?? "none"} | quality ${bucket.official_best.data_quality_status}`,
        );
      } else {
        console.log(
          `official_best_${key}: none`,
        );
      }
      if (bucket?.probable_best) {
        console.log(
          `probable_best_${key}: ${bucket.probable_best.date} | ${bucket.probable_best.title ?? "untitled"} | ${bucket.probable_best.distance_km} km | pace ${bucket.probable_best.pace_text} | status ${bucket.probable_best.result_status} | quality ${bucket.probable_best.data_quality_status}`,
        );
      } else {
        console.log(`probable_best_${key}: none`);
      }
      if (bucket?.probable_or_possible_best) {
        console.log(
          `candidate_result_${key}: ${bucket.probable_or_possible_best.date} | ${bucket.probable_or_possible_best.title ?? "untitled"} | ${bucket.probable_or_possible_best.distance_km} km | pace ${bucket.probable_or_possible_best.pace_text} | status ${bucket.probable_or_possible_best.result_status} | ${formatSummaryCell(bucket.probable_or_possible_best)}`,
        );
      } else {
        console.log(`candidate_result_${key}: none`);
      }
      if (bucket?.clean_training_best) {
        console.log(
          `clean_training_best_${key}: ${bucket.clean_training_best.date} | ${bucket.clean_training_best.title ?? "untitled"} | ${bucket.clean_training_best.distance_km} km | pace ${bucket.clean_training_best.pace_text}`,
        );
      } else {
        console.log(`clean_training_best_${key}: none`);
      }
    }
    console.log(`manual_review_candidates: ${manualReviewCandidates.length}`);
    for (const row of manualReviewCandidates.slice(0, 5)) {
      console.log(
        `  manual_review: ${row.distance_label} | ${row.date} | ${row.distance_km} km | pace ${row.pace_text} | status ${row.data_quality_status} | warnings ${row.warnings.join(", ") || "none"}`,
      );
    }
    const aug13 = manualReviewCandidates.find((row) => row.date === "2025-08-13");
    if (aug13) {
      console.log(
        `manual_review_2025-08-13: status=${aug13.data_quality_status} | warnings=${aug13.warnings.join(", ")} | can_be_official_best=${aug13.can_be_official_best}`,
      );
    }
    console.log(`same_day_event_links: ${eventWorkoutLinks.length}`);
    if (runMode.mode === "single" && runMode.singleDistanceKey === "5k") {
      console.log(`clean_5k_candidates: ${clean5kLegacy.length}`);
      console.log(`race_like_5k_candidates: ${raceLike5kLegacy.length}`);
      console.log(`planned_race_candidates: ${plannedRaceCandidates.length}`);
    }
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
