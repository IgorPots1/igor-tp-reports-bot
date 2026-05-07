import { createReadStream, existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";
import * as unzipper from "unzipper";

type CliArgs = {
  student: string;
  from: string;
  to: string;
};

type RawRow = Record<string, string>;

type TargetSource = "workout_description" | "coach_comments" | "workout_description+coach_comments";
type TargetConfidence = "high" | "medium" | "low";
type ClassificationType =
  | "planned_completed"
  | "planned_skipped"
  | "extra_completed"
  | "day_off"
  | "unclear";
type HrComparisonStatus = "above" | "below" | "within" | "unknown";
type PaceComparisonStatus = "too_fast" | "too_slow" | "within" | "unknown";

type HrbpmTarget = {
  min: number;
  max: number;
};

type PaceTarget = {
  fast_min_per_km: number;
  slow_min_per_km: number;
};

type PaceRangeTarget = PaceTarget & {
  source: "workout_description" | "coach_comments";
  confidence: TargetConfidence;
  text?: string;
};

type ZoneMinutes = {
  z1: number | null;
  z2: number | null;
  z3: number | null;
  z4: number | null;
  z5: number | null;
  z6: number | null;
  z7: number | null;
  z8: number | null;
  z9: number | null;
  z10: number | null;
};

type PlannedTargets = {
  hr_bpm: HrbpmTarget | null;
  pace_min_per_km: PaceTarget | null;
  pace_ranges: PaceRangeTarget[];
  source: TargetSource | null;
  confidence: TargetConfidence | null;
};

type Classification = {
  type: ClassificationType;
  is_planned: boolean;
  is_completed: boolean;
  is_skipped: boolean;
  is_extra: boolean;
  is_day_off: boolean;
};

type PlannedSection = {
  duration_minutes: number | null;
  distance_km: number | null;
  description: string | null;
  coach_comments: string | null;
  targets: PlannedTargets;
};

type CompletedSection = {
  duration_minutes: number | null;
  distance_km: number | null;
  avg_pace_min_per_km: number | null;
  avg_speed_mps: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  rpe: number | null;
  feeling: number | null;
  if: number | null;
  tss: number | null;
  energy_kj: number | null;
  power_avg: number | null;
  power_max: number | null;
  cadence_avg: number | null;
  cadence_max: number | null;
  hr_zone_minutes: ZoneMinutes;
  power_zone_minutes: ZoneMinutes;
  athlete_comments: string | null;
};

type Comparison = {
  duration_delta_minutes: number | null;
  duration_delta_percent: number | null;
  distance_delta_km: number | null;
  distance_delta_percent: number | null;
  hr_vs_target: {
    status: HrComparisonStatus;
    avg_hr: number | null;
    target_min: number | null;
    target_max: number | null;
    delta_from_range: number | null;
  };
  pace_vs_target: {
    status: PaceComparisonStatus;
    actual_avg_pace_min_per_km: number | null;
    target_fast_min_per_km: number | null;
    target_slow_min_per_km: number | null;
  };
  mismatch_flags: {
    skipped: boolean;
    extra_workout: boolean;
    duration_shorter: boolean;
    duration_longer: boolean;
    distance_shorter: boolean;
    distance_longer: boolean;
    hr_above_target: boolean;
    hr_below_target: boolean;
    pace_too_fast: boolean;
    pace_too_slow: boolean;
    missing_hr_data: boolean;
    missing_planned_target: boolean;
  };
  coach_attention_flags: {
    suspicious_if: boolean;
    suspicious_tss: boolean;
    high_hr_on_easy_run: boolean;
  };
  data_quality_flags: {
    planned_distance_missing_in_export: boolean;
    planned_targets_text_only: boolean;
    multiple_pace_targets_found: boolean;
    pace_target_text_only: boolean;
    pace_target_unparsed: boolean;
    no_athlete_comment: boolean;
    no_completion_status_column: boolean;
    unclear_classification: boolean;
  };
};

type ParsedWorkout = {
  date: string | null;
  title: string | null;
  sport: string | null;
  planned_duration_minutes: number | null;
  completed_duration_minutes: number | null;
  distance_km: number | null;
  planned_distance_km: number | null;
  tss: number | null;
  if: number | null;
  rpe: number | null;
  description: string | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_min_per_km: number | null;
  avg_pace_text: string | null;
  duration_text: string | null;
  planned_duration_text: string | null;
  distance_text: string | null;
  intensity_flags: string[];
  data_warnings: string[];
  athlete_comments: string | null;
  coach_comments: string | null;
  classification: Classification;
  planned: PlannedSection;
  completed: CompletedSection;
  comparison: Comparison;
  source_file: string;
  raw: RawRow;
};

type WeeklySummary = {
  schema_version: "weekly-summary.v2";
  student_id: string;
  week: {
    from: string;
    to: string;
  };
  source_files: string[];
  totals: {
    workouts_count: number;
    completed_workouts_count: number;
    total_distance_km: number | null;
    planned_duration_minutes: number | null;
    completed_duration_minutes: number | null;
    total_completed_duration_text: string | null;
    total_planned_duration_text: string | null;
    total_distance_text: string | null;
    data_warnings_count: number;
    intensity_flags_count: number;
  };
  week_metrics: {
    planned: {
      workouts_count: number;
      duration_minutes: number | null;
      distance_km: number | null;
    };
    completed: {
      workouts_count: number;
      duration_minutes: number | null;
      distance_km: number | null;
    };
    plan_vs_fact: {
      completion_rate: number | null;
      duration_delta_minutes: number | null;
      duration_delta_percent: number | null;
      distance_delta_km: number | null;
      distance_delta_percent: number | null;
    };
    counts: {
      planned_completed: number;
      planned_skipped: number;
      extra_completed: number;
      day_off: number;
      unclear: number;
    };
    data_quality: {
      planned_distance_available: boolean;
      planned_hr_targets_found: number;
      planned_pace_targets_found: number;
      planned_pace_ranges_found: number;
      workouts_with_multiple_pace_ranges: number;
      warnings: string[];
    };
  };
  workouts: ParsedWorkout[];
};

type CsvCandidate = {
  csvPath: string;
  sourceFile: string;
};

type FieldMatch = {
  key: string;
  normalizedKey: string;
  value: string;
};

type ParsedCsv = {
  workouts: ParsedWorkout[];
  sourceFiles: string[];
  completionStatusColumnAvailable: boolean;
};

type CandidateMatch<T> = {
  value: T;
  source: "workout_description" | "coach_comments";
  text?: string;
};

type ParsedTargetsMeta = {
  targets: PlannedTargets;
  hasTargetLikeText: boolean;
  hasPaceTargetLikeText: boolean;
  parsedAnyTarget: boolean;
};

type NormalizedCompletedMetrics = {
  duration_minutes: number | null;
  distance_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed_mps: number | null;
  tss: number | null;
  if_value: number | null;
  rpe: number | null;
  feeling: number | null;
  energy_kj: number | null;
  power_avg: number | null;
  power_max: number | null;
  cadence_avg: number | null;
  cadence_max: number | null;
  hr_zone_minutes: ZoneMinutes;
  power_zone_minutes: ZoneMinutes;
  athlete_comments: string | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const exportsRoot = path.join(toolRoot, "exports");
const parsedRoot = path.join(toolRoot, "parsed");
const DEBUG = process.env.TP_DEBUG === "1";
const DURATION_DELTA_ABSOLUTE_THRESHOLD_MINUTES = 10;
const DISTANCE_DELTA_ABSOLUTE_THRESHOLD_KM = 1;
const DELTA_PERCENT_THRESHOLD = 20;
const HR_DELTA_THRESHOLD_BPM = 3;
const PACE_DELTA_THRESHOLD_MINUTES = 10 / 60;

function debugLog(...args: unknown[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}

const FIELD_ALIASES = {
  date: [
    "date",
    "workoutdate",
    "workoutday",
    "calendardate",
    "completeddate",
    "activitydate",
    "scheduleddate"
  ],
  title: [
    "title",
    "name",
    "workouttitle",
    "workoutname",
    "workout",
    "sessionname",
    "activityname"
  ],
  sport: [
    "sport",
    "workouttype",
    "sporttype",
    "type",
    "activitytype",
    "discipline"
  ],
  planned_duration: [
    "plannedduration",
    "planneddurationinhours",
    "plannedtime",
    "durationplanned",
    "scheduledduration",
    "totalplannedtime"
  ],
  completed_duration: [
    "duration",
    "completedduration",
    "actualduration",
    "movingtime",
    "elapsedtime",
    "totaltime",
    "completedtime",
    "timetotalinhours"
  ],
  distance: [
    "distance",
    "distanceinmeters",
    "actualdistance",
    "completeddistance",
    "totaldistance"
  ],
  planned_distance: [
    "planneddistance",
    "planneddistanceinmeters",
    "distanceplanned",
    "scheduleddistance"
  ],
  tss: [
    "tss",
    "actualtss",
    "completedtss",
    "trainingstressscore",
    "workouttss",
    "plannedtss"
  ],
  if: [
    "if",
    "intensityfactor",
    "actualif",
    "completedif",
    "plannedif"
  ],
  rpe: [
    "rpe",
    "sessionrpe",
    "perceivedexertion"
  ],
  feeling: [
    "feeling",
    "sessionfeeling",
    "wellnessfeeling"
  ],
  description: [
    "workoutdescription",
    "description",
    "details",
    "workoutdetails",
    "sessiondescription"
  ],
  avg_hr: [
    "heartrateaverage",
    "averageheartrate",
    "avghr",
    "hraverage"
  ],
  max_hr: [
    "heartratemax",
    "maxheartrate",
    "maxhr",
    "hrmax"
  ],
  avg_speed: [
    "velocityaverage",
    "averagespeed",
    "speedaverage",
    "avgspeed"
  ],
  energy: [
    "energy",
    "energykj",
    "workenergy",
    "calories"
  ],
  power_avg: [
    "poweraverage",
    "averagepower",
    "avgpower"
  ],
  power_max: [
    "powermax",
    "maxpower"
  ],
  cadence_avg: [
    "cadenceaverage",
    "averagecadence",
    "avgcadence"
  ],
  cadence_max: [
    "cadencemax",
    "maxcadence"
  ],
  athlete_comments: [
    "athletecomments",
    "postactivitycomments",
    "postworkoutcomments",
    "comments",
    "athletenotes",
    "notes"
  ],
  coach_comments: [
    "coachcomments",
    "coachnote",
    "coachnotes",
    "plannedcomments",
    "plannednotes",
    "instructions"
  ],
  completion_status: [
    "completed",
    "completionstatus",
    "status",
    "compliance"
  ]
} as const;

function usage(): string {
  return [
    "Usage:",
    "  npm run tp-parse-week -- --student=Olga --from=2026-04-27 --to=2026-05-03"
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "student" || rawKey === "from" || rawKey === "to") {
      values[rawKey] = value;
    }
  }

  if (!values.student || !values.from || !values.to) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDatePattern.test(values.from) || !isoDatePattern.test(values.to)) {
    throw new Error("`--from` and `--to` must use YYYY-MM-DD format.");
  }

  return values as CliArgs;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function relativeToToolRoot(filePath: string): string {
  return toPosixPath(path.relative(toolRoot, filePath));
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function sanitizeForFileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "file";
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function detectDelimiter(content: string): string {
  const firstDataLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstDataLine) {
    return ",";
  }

  const candidates = [",", ";", "\t"];
  let bestDelimiter = ",";
  let bestScore = -1;

  for (const delimiter of candidates) {
    const score = firstDataLine.split(delimiter).length - 1;
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
    }
  }

  return bestDelimiter;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\r/g, "").trim();
  return normalized ? normalized : null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  const slashMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseFlexibleNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationMinutes(field: FieldMatch | null): number | null {
  if (!field) {
    return null;
  }

  const compact = field.value.trim();
  const hhmmss = compact.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hhmmss) {
    const hours = Number.parseInt(hhmmss[1], 10);
    const minutes = Number.parseInt(hhmmss[2], 10);
    const seconds = Number.parseInt(hhmmss[3] ?? "0", 10);
    return Math.round((hours * 3600 + minutes * 60 + seconds) / 60);
  }

  const unitMatches = [...compact.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/g)];
  if (unitMatches.length > 0) {
    let totalMinutes = 0;

    for (const [, rawAmount, rawUnit] of unitMatches) {
      const amount = Number.parseFloat(rawAmount.replace(",", "."));
      const unit = rawUnit.toLowerCase();

      if (!Number.isFinite(amount)) {
        continue;
      }

      if (unit.startsWith("h")) {
        totalMinutes += amount * 60;
        continue;
      }

      if (unit.startsWith("m")) {
        totalMinutes += amount;
        continue;
      }

      if (unit.startsWith("s")) {
        totalMinutes += amount / 60;
      }
    }

    if (totalMinutes > 0) {
      return Math.round(totalMinutes);
    }
  }

  const numeric = parseFlexibleNumber(compact);
  if (numeric === null) {
    return null;
  }

  if (
    field.normalizedKey === "plannedduration" ||
    field.normalizedKey.endsWith("inhours") ||
    /(^|[^a-z])hour|(^|[^a-z])hr/i.test(field.key)
  ) {
    return Math.round(numeric * 60);
  }

  if (/sec|second/i.test(compact)) {
    return Math.round(numeric / 60);
  }

  if (/hour|hr/i.test(compact)) {
    return Math.round(numeric * 60);
  }

  return Math.round(numeric);
}

function parseDistanceKm(field: FieldMatch | null): number | null {
  if (!field) {
    return null;
  }

  const numeric = parseFlexibleNumber(field.value);
  if (numeric === null) {
    return null;
  }

  if (field.normalizedKey.includes("meter")) {
    return roundNumber(numeric / 1000, 2);
  }

  const lower = field.value.toLowerCase();
  if (/\bmi\b|mile/.test(lower)) {
    return roundNumber(numeric * 1.60934, 2);
  }

  if (/\bm\b|meter/.test(lower) && !/\bkm\b/.test(lower)) {
    return roundNumber(numeric / 1000, 2);
  }

  return roundNumber(numeric, 2);
}

function parseIfValue(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numeric = parseFlexibleNumber(value);
  if (numeric === null) {
    return null;
  }

  if (value.includes("%") || numeric > 5) {
    return roundNumber(numeric / 100, 3);
  }

  return roundNumber(numeric, 3);
}

function roundNumber(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatDurationMinutes(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }

  const roundedMinutes = Math.round(minutes);
  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);
    const remainderMinutes = roundedMinutes % 60;
    return `${hours}:${String(remainderMinutes).padStart(2, "0")}`;
  }

  return `${roundedMinutes} min`;
}

function formatDistanceKm(distanceKm: number | null): string | null {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }

  return `${distanceKm.toFixed(2)} km`;
}

function deriveAveragePaceMinPerKm(
  distanceKm: number | null,
  durationMinutes: number | null
): number | null {
  if (
    distanceKm === null ||
    durationMinutes === null ||
    !Number.isFinite(distanceKm) ||
    !Number.isFinite(durationMinutes) ||
    distanceKm <= 0 ||
    durationMinutes <= 0
  ) {
    return null;
  }

  return roundNumber(durationMinutes / distanceKm, 2);
}

function formatPaceMinPerKm(paceMinPerKm: number | null): string | null {
  if (paceMinPerKm === null || !Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) {
    return null;
  }

  const totalSeconds = Math.round(paceMinPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

function formatPaceValue(paceMinPerKm: number): string {
  const totalSeconds = Math.round(paceMinPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parsePaceValueToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (seconds >= 60) {
    return null;
  }

  return roundNumber(minutes + seconds / 60, 2);
}

function buildEmptyZones(): ZoneMinutes {
  return {
    z1: null,
    z2: null,
    z3: null,
    z4: null,
    z5: null,
    z6: null,
    z7: null,
    z8: null,
    z9: null,
    z10: null
  };
}

function buildIntensityFlags(workout: {
  avg_hr: number | null;
  max_hr: number | null;
  rpe: number | null;
  distance_km: number | null;
  completed_duration_minutes: number | null;
}): string[] {
  const flags: string[] = [];

  if (workout.avg_hr !== null && workout.avg_hr >= 170) {
    flags.push("high_average_hr");
  }

  if (workout.max_hr !== null && workout.max_hr >= 190) {
    flags.push("high_max_hr");
  }

  if (workout.rpe !== null && workout.rpe >= 7) {
    flags.push("hard_rpe");
  }

  if (
    (workout.distance_km !== null && workout.distance_km >= 12) ||
    (workout.completed_duration_minutes !== null && workout.completed_duration_minutes >= 80)
  ) {
    flags.push("long_run");
  }

  return flags;
}

function buildDataWarnings(workout: {
  sport: string | null;
  if: number | null;
  tss: number | null;
  distance_km: number | null;
  completed_duration_minutes: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  description: string | null;
}): string[] {
  const warnings: string[] = [];
  const sportNormalized = normalizeHeader(workout.sport ?? "");

  if (workout.if !== null && workout.if > 1.15) {
    warnings.push("suspicious_if");
  }

  if (
    workout.tss !== null &&
    workout.tss > 150 &&
    (sportNormalized === "run" || sportNormalized === "")
  ) {
    warnings.push("suspicious_tss");
  }

  if (workout.completed_duration_minutes !== null && workout.distance_km === null) {
    warnings.push("missing_distance");
  }

  if (workout.avg_hr === null && workout.max_hr === null) {
    warnings.push("missing_hr");
  }

  if (workout.description === null) {
    warnings.push("missing_description");
  }

  return warnings;
}

function buildHeaderIndex(row: RawRow): Map<string, string> {
  const index = new Map<string, string>();

  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key);
    if (!normalized || index.has(normalized)) {
      continue;
    }

    index.set(normalized, key);
  }

  return index;
}

function pickField(
  row: RawRow,
  headerIndex: Map<string, string>,
  aliases: readonly string[]
): FieldMatch | null {
  for (const alias of aliases) {
    const originalKey = headerIndex.get(alias);
    if (!originalKey) {
      continue;
    }

    const value = cleanString(row[originalKey]);
    if (value !== null) {
      return {
        key: originalKey,
        normalizedKey: alias,
        value
      };
    }
  }

  return null;
}

function pickValue(
  row: RawRow,
  headerIndex: Map<string, string>,
  aliases: readonly string[]
): string | null {
  return pickField(row, headerIndex, aliases)?.value ?? null;
}

function hasAnyHeader(headerIndex: Map<string, string>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => headerIndex.has(alias));
}

function normalizeRawRow(record: Record<string, unknown>): RawRow {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, cleanString(value) ?? ""])
  );
}

function detectDayOffText(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();
  return /\bday\s*off\b|\brest\b|отдых|выходн/.test(lower);
}

function isDayOffRow(fields: {
  title: string | null;
  sport: string | null;
  description: string | null;
  coach_comments: string | null;
}): boolean {
  return [fields.title, fields.sport, fields.description, fields.coach_comments].some((value) =>
    detectDayOffText(value)
  );
}

function extractHrCandidates(
  text: string,
  source: "workout_description" | "coach_comments"
): CandidateMatch<HrbpmTarget>[] {
  const candidates: CandidateMatch<HrbpmTarget>[] = [];
  const prefixedPattern = /(?:пульс\p{L}*|чсс|hr)\s*(\d{2,3})\s*[–-]\s*(\d{2,3})/giu;
  const suffixedPattern = /(\d{2,3})\s*[–-]\s*(\d{2,3})\s*(?:уд\/?\s*мин|bpm)/giu;

  for (const match of text.matchAll(prefixedPattern)) {
    const min = Number.parseInt(match[1], 10);
    const max = Number.parseInt(match[2], 10);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      candidates.push({ value: { min, max }, source });
    }
  }

  for (const match of text.matchAll(suffixedPattern)) {
    const min = Number.parseInt(match[1], 10);
    const max = Number.parseInt(match[2], 10);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      candidates.push({ value: { min, max }, source });
    }
  }

  return candidates;
}

function extractPaceCandidates(
  text: string,
  source: "workout_description" | "coach_comments"
): CandidateMatch<PaceTarget>[] {
  const candidates: CandidateMatch<PaceTarget>[] = [];
  const prefixedPattern = /(?:темп(?:е)?|pace)\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/giu;
  const atPattern = /@\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s*(?:\/\s*(?:км|km)|(?:км|km))/giu;
  const suffixedPattern = /(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s*\/\s*(?:км|km)/giu;

  for (const pattern of [prefixedPattern, atPattern, suffixedPattern]) {
    for (const match of text.matchAll(pattern)) {
      const first = parsePaceValueToMinutes(match[1]);
      const second = parsePaceValueToMinutes(match[2]);
      if (first === null || second === null) {
        continue;
      }

      candidates.push({
        value: {
          fast_min_per_km: Math.min(first, second),
          slow_min_per_km: Math.max(first, second)
        },
        source,
        text: `${formatPaceValue(Math.min(first, second))}–${formatPaceValue(Math.max(first, second))}/км`
      });
    }
  }

  return candidates;
}

function getUniqueCandidates<T>(
  candidates: CandidateMatch<T>[],
  serialize: (value: T) => string
): CandidateMatch<T>[] {
  const unique = new Map<string, CandidateMatch<T>>();

  for (const candidate of candidates) {
    const key = serialize(candidate.value);
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }

  return [...unique.values()];
}

function getUniqueCandidate<T>(
  candidates: CandidateMatch<T>[],
  serialize: (value: T) => string
): CandidateMatch<T> | null {
  const unique = getUniqueCandidates(candidates, serialize);
  if (unique.length !== 1) {
    return null;
  }

  return unique[0];
}

function hasPaceTargetLikeText(value: string): boolean {
  return /(?:темп|pace|\/\s*(?:км|km)|мин\/км|min\/km|@\s*\d{1,2}:\d{2})/iu.test(value);
}

function resolveTargetSource(
  hr: CandidateMatch<HrbpmTarget> | null,
  pace: CandidateMatch<PaceTarget> | null
): TargetSource | null {
  const sources = new Set<string>();

  if (hr) {
    sources.add(hr.source);
  }

  if (pace) {
    sources.add(pace.source);
  }

  if (sources.size === 0) {
    return null;
  }

  if (sources.size === 1) {
    return [...sources][0] as TargetSource;
  }

  return "workout_description+coach_comments";
}

function parsePlannedTargets(params: {
  description: string | null;
  coachComments: string | null;
}): ParsedTargetsMeta {
  const textSources = [
    { key: "workout_description" as const, text: params.description },
    { key: "coach_comments" as const, text: params.coachComments }
  ].filter(
    (entry): entry is { key: "workout_description" | "coach_comments"; text: string } =>
      Boolean(entry.text)
  );

  const hrCandidates = textSources.flatMap((entry) => extractHrCandidates(entry.text, entry.key));
  const paceCandidates = textSources.flatMap((entry) =>
    extractPaceCandidates(entry.text, entry.key)
  );
  const uniquePaceCandidates = getUniqueCandidates(
    paceCandidates,
    (value) => `${value.fast_min_per_km}-${value.slow_min_per_km}`
  );
  const uniqueHr = getUniqueCandidate(hrCandidates, (value) => `${value.min}-${value.max}`);
  const uniquePace = uniquePaceCandidates.length === 1 ? uniquePaceCandidates[0] : null;
  const parsedAnyTarget = hrCandidates.length > 0 || uniquePaceCandidates.length > 0;
  const hasPaceLikeText = textSources.some((entry) => hasPaceTargetLikeText(entry.text));

  return {
    targets: {
      hr_bpm: uniqueHr?.value ?? null,
      pace_min_per_km: uniquePace?.value ?? null,
      pace_ranges: uniquePaceCandidates.map((candidate) => ({
        ...candidate.value,
        source: candidate.source,
        confidence: "high",
        text: candidate.text
      })),
      source: resolveTargetSource(uniqueHr, uniquePace),
      confidence: uniqueHr || uniquePace ? "high" : null
    },
    hasTargetLikeText: hrCandidates.length > 0 || hasPaceLikeText,
    hasPaceTargetLikeText: hasPaceLikeText,
    parsedAnyTarget
  };
}

function buildZones(
  row: RawRow,
  headerIndex: Map<string, string>,
  prefixes: string[]
): ZoneMinutes {
  const zones = buildEmptyZones();

  for (let index = 1; index <= 10; index += 1) {
    const originalKey = prefixes
      .map((prefix) => headerIndex.get(`${prefix}${index}minutes`))
      .find((value): value is string => Boolean(value));

    zones[`z${index}` as keyof ZoneMinutes] = originalKey
      ? parseFlexibleNumber(cleanString(row[originalKey]))
      : null;
  }

  return zones;
}

function buildCompletedMetrics(params: {
  row: RawRow;
  headerIndex: Map<string, string>;
  completedDurationField: FieldMatch | null;
  distanceField: FieldMatch | null;
  statusIndicatesSkipped: boolean;
}): NormalizedCompletedMetrics {
  if (params.statusIndicatesSkipped) {
    return {
      duration_minutes: null,
      distance_km: null,
      avg_hr: null,
      max_hr: null,
      avg_speed_mps: null,
      tss: null,
      if_value: null,
      rpe: null,
      feeling: null,
      energy_kj: null,
      power_avg: null,
      power_max: null,
      cadence_avg: null,
      cadence_max: null,
      hr_zone_minutes: buildEmptyZones(),
      power_zone_minutes: buildEmptyZones(),
      athlete_comments: null
    };
  }

  return {
    duration_minutes: parseDurationMinutes(params.completedDurationField),
    distance_km: parseDistanceKm(params.distanceField),
    avg_hr: parseFlexibleNumber(pickValue(params.row, params.headerIndex, FIELD_ALIASES.avg_hr)),
    max_hr: parseFlexibleNumber(pickValue(params.row, params.headerIndex, FIELD_ALIASES.max_hr)),
    avg_speed_mps: parseFlexibleNumber(
      pickValue(params.row, params.headerIndex, FIELD_ALIASES.avg_speed)
    ),
    tss: parseFlexibleNumber(pickValue(params.row, params.headerIndex, FIELD_ALIASES.tss)),
    if_value: parseIfValue(pickValue(params.row, params.headerIndex, FIELD_ALIASES.if)),
    rpe: parseFlexibleNumber(pickValue(params.row, params.headerIndex, FIELD_ALIASES.rpe)),
    feeling: parseFlexibleNumber(pickValue(params.row, params.headerIndex, FIELD_ALIASES.feeling)),
    energy_kj: parseFlexibleNumber(pickValue(params.row, params.headerIndex, FIELD_ALIASES.energy)),
    power_avg: parseFlexibleNumber(
      pickValue(params.row, params.headerIndex, FIELD_ALIASES.power_avg)
    ),
    power_max: parseFlexibleNumber(
      pickValue(params.row, params.headerIndex, FIELD_ALIASES.power_max)
    ),
    cadence_avg: parseFlexibleNumber(
      pickValue(params.row, params.headerIndex, FIELD_ALIASES.cadence_avg)
    ),
    cadence_max: parseFlexibleNumber(
      pickValue(params.row, params.headerIndex, FIELD_ALIASES.cadence_max)
    ),
    hr_zone_minutes: buildZones(params.row, params.headerIndex, ["hrzone"]),
    power_zone_minutes: buildZones(params.row, params.headerIndex, ["pwrzone", "powerzone"]),
    athlete_comments: pickValue(params.row, params.headerIndex, FIELD_ALIASES.athlete_comments)
  };
}

function buildClassification(params: {
  title: string | null;
  sport: string | null;
  description: string | null;
  coachComments: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  completedMetrics: NormalizedCompletedMetrics;
}): Classification {
  const isPlanned = Boolean(
    params.plannedDurationMinutes !== null ||
      params.plannedDistanceKm !== null ||
      params.description !== null ||
      params.coachComments !== null
  );
  const isCompleted = [
    params.completedMetrics.duration_minutes,
    params.completedMetrics.distance_km,
    params.completedMetrics.avg_hr,
    params.completedMetrics.tss,
    params.completedMetrics.if_value
  ].some((value) => value !== null);
  const isDayOff =
    !isCompleted &&
    isDayOffRow({
      title: params.title,
      sport: params.sport,
      description: params.description,
      coach_comments: params.coachComments
    });

  let type: ClassificationType = "unclear";
  if (isDayOff) {
    type = "day_off";
  } else if (isPlanned && isCompleted) {
    type = "planned_completed";
  } else if (isPlanned && !isCompleted) {
    type = "planned_skipped";
  } else if (!isPlanned && isCompleted) {
    type = "extra_completed";
  }

  return {
    type,
    is_planned: isPlanned,
    is_completed: isCompleted,
    is_skipped: type === "planned_skipped",
    is_extra: type === "extra_completed",
    is_day_off: type === "day_off"
  };
}

function computeDelta(actual: number | null, planned: number | null, digits: number): number | null {
  if (actual === null || planned === null) {
    return null;
  }

  return roundNumber(actual - planned, digits);
}

function computeDeltaPercent(actual: number | null, planned: number | null): number | null {
  if (actual === null || planned === null || planned === 0) {
    return null;
  }

  return roundNumber(((actual - planned) / planned) * 100, 1);
}

function buildComparison(params: {
  workout: Pick<
    ParsedWorkout,
    "title" | "description" | "data_warnings" | "classification" | "planned" | "completed"
  >;
  parsedTargetsMeta: ParsedTargetsMeta;
  completionStatusColumnAvailable: boolean;
}): Comparison {
  const durationDeltaMinutes = computeDelta(
    params.workout.completed.duration_minutes,
    params.workout.planned.duration_minutes,
    0
  );
  const durationDeltaPercent = computeDeltaPercent(
    params.workout.completed.duration_minutes,
    params.workout.planned.duration_minutes
  );
  const distanceDeltaKm = computeDelta(
    params.workout.completed.distance_km,
    params.workout.planned.distance_km,
    2
  );
  const distanceDeltaPercent = computeDeltaPercent(
    params.workout.completed.distance_km,
    params.workout.planned.distance_km
  );

  const hrTarget = params.workout.planned.targets.hr_bpm;
  const avgHr = params.workout.completed.avg_hr;
  let hrStatus: HrComparisonStatus = "unknown";
  let hrDeltaFromRange: number | null = null;

  if (hrTarget && avgHr !== null) {
    if (avgHr < hrTarget.min) {
      hrStatus = "below";
      hrDeltaFromRange = hrTarget.min - avgHr;
    } else if (avgHr > hrTarget.max) {
      hrStatus = "above";
      hrDeltaFromRange = avgHr - hrTarget.max;
    } else {
      hrStatus = "within";
      hrDeltaFromRange = 0;
    }
  }

  const paceTarget = params.workout.planned.targets.pace_min_per_km;
  const paceRanges = params.workout.planned.targets.pace_ranges;
  const actualPace = params.workout.completed.avg_pace_min_per_km;
  let paceStatus: PaceComparisonStatus = "unknown";

  if (paceTarget && actualPace !== null) {
    if (actualPace < paceTarget.fast_min_per_km) {
      paceStatus = "too_fast";
    } else if (actualPace > paceTarget.slow_min_per_km) {
      paceStatus = "too_slow";
    } else {
      paceStatus = "within";
    }
  }

  const durationDeltaAbsolute = durationDeltaMinutes === null ? null : Math.abs(durationDeltaMinutes);
  const durationDeltaPercentAbsolute =
    durationDeltaPercent === null ? null : Math.abs(durationDeltaPercent);
  const distanceDeltaAbsolute = distanceDeltaKm === null ? null : Math.abs(distanceDeltaKm);
  const distanceDeltaPercentAbsolute =
    distanceDeltaPercent === null ? null : Math.abs(distanceDeltaPercent);
  const hrOutsideBy = hrDeltaFromRange ?? 0;
  const paceTooFastBy =
    paceTarget && actualPace !== null && actualPace < paceTarget.fast_min_per_km
      ? roundNumber(paceTarget.fast_min_per_km - actualPace, 2)
      : 0;
  const paceTooSlowBy =
    paceTarget && actualPace !== null && actualPace > paceTarget.slow_min_per_km
      ? roundNumber(actualPace - paceTarget.slow_min_per_km, 2)
      : 0;
  const easyRunMarker = [params.workout.title, params.workout.description]
    .filter((value): value is string => Boolean(value))
    .some((value) => /\beasy\b|легк|восстанов/i.test(value));

  return {
    duration_delta_minutes: durationDeltaMinutes,
    duration_delta_percent: durationDeltaPercent,
    distance_delta_km: distanceDeltaKm,
    distance_delta_percent: distanceDeltaPercent,
    hr_vs_target: {
      status: hrStatus,
      avg_hr: avgHr,
      target_min: hrTarget?.min ?? null,
      target_max: hrTarget?.max ?? null,
      delta_from_range: hrDeltaFromRange
    },
    pace_vs_target: {
      status: paceStatus,
      actual_avg_pace_min_per_km: actualPace,
      target_fast_min_per_km: paceTarget?.fast_min_per_km ?? null,
      target_slow_min_per_km: paceTarget?.slow_min_per_km ?? null
    },
    mismatch_flags: {
      skipped: params.workout.classification.is_skipped,
      extra_workout: params.workout.classification.is_extra,
      duration_shorter:
        durationDeltaMinutes !== null &&
        durationDeltaMinutes < 0 &&
        ((durationDeltaAbsolute !== null &&
          durationDeltaAbsolute >= DURATION_DELTA_ABSOLUTE_THRESHOLD_MINUTES) ||
          (durationDeltaPercentAbsolute !== null &&
            durationDeltaPercentAbsolute >= DELTA_PERCENT_THRESHOLD)),
      duration_longer:
        durationDeltaMinutes !== null &&
        durationDeltaMinutes > 0 &&
        ((durationDeltaAbsolute !== null &&
          durationDeltaAbsolute >= DURATION_DELTA_ABSOLUTE_THRESHOLD_MINUTES) ||
          (durationDeltaPercentAbsolute !== null &&
            durationDeltaPercentAbsolute >= DELTA_PERCENT_THRESHOLD)),
      distance_shorter:
        distanceDeltaKm !== null &&
        distanceDeltaKm < 0 &&
        params.workout.planned.distance_km !== null &&
        ((distanceDeltaAbsolute !== null &&
          distanceDeltaAbsolute >= DISTANCE_DELTA_ABSOLUTE_THRESHOLD_KM) ||
          (distanceDeltaPercentAbsolute !== null &&
            distanceDeltaPercentAbsolute >= DELTA_PERCENT_THRESHOLD)),
      distance_longer:
        distanceDeltaKm !== null &&
        distanceDeltaKm > 0 &&
        params.workout.planned.distance_km !== null &&
        ((distanceDeltaAbsolute !== null &&
          distanceDeltaAbsolute >= DISTANCE_DELTA_ABSOLUTE_THRESHOLD_KM) ||
          (distanceDeltaPercentAbsolute !== null &&
            distanceDeltaPercentAbsolute >= DELTA_PERCENT_THRESHOLD)),
      hr_above_target: hrStatus === "above" && hrOutsideBy >= HR_DELTA_THRESHOLD_BPM,
      hr_below_target: hrStatus === "below" && hrOutsideBy >= HR_DELTA_THRESHOLD_BPM,
      pace_too_fast: paceStatus === "too_fast" && paceTooFastBy >= PACE_DELTA_THRESHOLD_MINUTES,
      pace_too_slow: paceStatus === "too_slow" && paceTooSlowBy >= PACE_DELTA_THRESHOLD_MINUTES,
      missing_hr_data:
        params.workout.classification.is_completed && params.workout.completed.avg_hr === null,
      missing_planned_target:
        params.workout.classification.is_planned &&
        params.parsedTargetsMeta.hasTargetLikeText &&
        !params.parsedTargetsMeta.parsedAnyTarget
    },
    coach_attention_flags: {
      suspicious_if: params.workout.data_warnings.includes("suspicious_if"),
      suspicious_tss: params.workout.data_warnings.includes("suspicious_tss"),
      high_hr_on_easy_run:
        easyRunMarker && hrStatus === "above" && hrOutsideBy >= HR_DELTA_THRESHOLD_BPM
    },
    data_quality_flags: {
      planned_distance_missing_in_export:
        params.workout.classification.is_planned && params.workout.planned.distance_km === null,
      planned_targets_text_only:
        params.parsedTargetsMeta.hasTargetLikeText && !params.parsedTargetsMeta.parsedAnyTarget,
      multiple_pace_targets_found: paceRanges.length > 1,
      pace_target_text_only:
        params.parsedTargetsMeta.hasPaceTargetLikeText && params.workout.planned.targets.pace_min_per_km === null,
      pace_target_unparsed:
        params.parsedTargetsMeta.hasPaceTargetLikeText && params.workout.planned.targets.pace_ranges.length === 0,
      no_athlete_comment:
        params.workout.classification.is_completed &&
        params.workout.completed.athlete_comments === null,
      no_completion_status_column: !params.completionStatusColumnAvailable,
      unclear_classification: params.workout.classification.type === "unclear"
    }
  };
}

function looksLikeWorkout(row: ParsedWorkout): boolean {
  return [
    row.date,
    row.title,
    row.sport,
    row.planned_duration_minutes,
    row.completed_duration_minutes,
    row.distance_km,
    row.planned_distance_km,
    row.tss,
    row.if,
    row.rpe,
    row.description,
    row.avg_hr,
    row.max_hr,
    row.athlete_comments,
    row.coach_comments
  ].some((value) => value !== null);
}

function isCompletedWorkout(row: ParsedWorkout): boolean {
  return row.classification.is_completed;
}

async function extractZip(zipPath: string, tempRoot: string): Promise<string> {
  const targetDir = path.join(
    tempRoot,
    path.basename(zipPath, path.extname(zipPath)),
    sanitizeForFileName(path.basename(zipPath))
  );
  await mkdir(targetDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .on("close", resolve)
      .on("error", reject);
  });

  return targetDir;
}

async function discoverCsvCandidates(exportDir: string, tempRoot: string): Promise<CsvCandidate[]> {
  const files = (await listFilesRecursively(exportDir)).sort((a, b) => a.localeCompare(b));

  debugLog(`Files found (${files.length}):`);
  if (files.length === 0) {
    debugLog("- none");
  } else {
    for (const filePath of files) {
      debugLog(`- ${relativeToToolRoot(filePath)}`);
    }
  }

  const zipFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".zip");
  const directCsvFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".csv");
  const csvCandidates: CsvCandidate[] = directCsvFiles.map((csvPath) => ({
    csvPath,
    sourceFile: relativeToToolRoot(csvPath)
  }));

  for (const zipFile of zipFiles) {
    debugLog(`Unzipping: ${relativeToToolRoot(zipFile)}`);
    const extractedDir = await extractZip(zipFile, tempRoot);
    const extractedFiles = await listFilesRecursively(extractedDir);

    for (const extractedFile of extractedFiles) {
      if (path.extname(extractedFile).toLowerCase() !== ".csv") {
        continue;
      }

      const zipRelativePath = toPosixPath(path.relative(extractedDir, extractedFile));
      csvCandidates.push({
        csvPath: extractedFile,
        sourceFile: `${relativeToToolRoot(zipFile)}::${zipRelativePath}`
      });
    }
  }

  csvCandidates.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));

  debugLog(`CSV files parsed (${csvCandidates.length}):`);
  if (csvCandidates.length === 0) {
    debugLog("- none");
  } else {
    for (const candidate of csvCandidates) {
      debugLog(`- ${candidate.sourceFile}`);
    }
  }

  return csvCandidates;
}

async function parseCsvFile(candidate: CsvCandidate): Promise<ParsedCsv> {
  const fileStats = await stat(candidate.csvPath);
  if (!fileStats.isFile()) {
    return {
      workouts: [],
      sourceFiles: [],
      completionStatusColumnAvailable: false
    };
  }

  const content = await readFile(candidate.csvPath, "utf8");
  if (!content.trim()) {
    return {
      workouts: [],
      sourceFiles: [candidate.sourceFile],
      completionStatusColumnAvailable: false
    };
  }

  const delimiter = detectDelimiter(content);
  const records = parse(content, {
    bom: true,
    columns: true,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, unknown>[];

  const workouts: ParsedWorkout[] = [];
  let completionStatusColumnAvailable = false;

  for (const record of records) {
    const raw = normalizeRawRow(record);
    const headerIndex = buildHeaderIndex(raw);
    completionStatusColumnAvailable =
      completionStatusColumnAvailable || hasAnyHeader(headerIndex, FIELD_ALIASES.completion_status);
    const dateField = pickField(raw, headerIndex, FIELD_ALIASES.date);
    const plannedDurationField = pickField(raw, headerIndex, FIELD_ALIASES.planned_duration);
    const completedDurationField = pickField(raw, headerIndex, FIELD_ALIASES.completed_duration);
    const distanceField = pickField(raw, headerIndex, FIELD_ALIASES.distance);
    const plannedDistanceField = pickField(raw, headerIndex, FIELD_ALIASES.planned_distance);
    const title = pickValue(raw, headerIndex, FIELD_ALIASES.title);
    const sport = pickValue(raw, headerIndex, FIELD_ALIASES.sport);
    const description = pickValue(raw, headerIndex, FIELD_ALIASES.description);
    const coachComments = pickValue(raw, headerIndex, FIELD_ALIASES.coach_comments);
    const plannedDurationMinutes = parseDurationMinutes(plannedDurationField);
    const plannedDistanceKm = parseDistanceKm(plannedDistanceField);
    const completionStatus = pickValue(raw, headerIndex, FIELD_ALIASES.completion_status);
    const statusIndicatesSkipped = [
      "planned",
      "scheduled",
      "notcompleted",
      "incomplete",
      "missed",
      "skipped"
    ].includes(normalizeHeader(completionStatus ?? ""));
    const completedMetrics = buildCompletedMetrics({
      row: raw,
      headerIndex,
      completedDurationField,
      distanceField,
      statusIndicatesSkipped
    });
    const avgPaceMinPerKm = deriveAveragePaceMinPerKm(
      completedMetrics.distance_km,
      completedMetrics.duration_minutes
    );
    const parsedTargetsMeta = parsePlannedTargets({
      description,
      coachComments
    });
    const classification = buildClassification({
      title,
      sport,
      description,
      coachComments,
      plannedDurationMinutes,
      plannedDistanceKm,
      completedMetrics
    });

    const normalized: ParsedWorkout = {
      date: parseDate(dateField?.value ?? null),
      title,
      sport,
      planned_duration_minutes: plannedDurationMinutes,
      completed_duration_minutes: completedMetrics.duration_minutes,
      distance_km: completedMetrics.distance_km,
      planned_distance_km: plannedDistanceKm,
      tss: completedMetrics.tss,
      if: completedMetrics.if_value,
      rpe: completedMetrics.rpe,
      description,
      avg_hr: completedMetrics.avg_hr,
      max_hr: completedMetrics.max_hr,
      avg_pace_min_per_km: avgPaceMinPerKm,
      avg_pace_text: formatPaceMinPerKm(avgPaceMinPerKm),
      duration_text: formatDurationMinutes(completedMetrics.duration_minutes),
      planned_duration_text: formatDurationMinutes(plannedDurationMinutes),
      distance_text: formatDistanceKm(completedMetrics.distance_km),
      intensity_flags: [],
      data_warnings: [],
      athlete_comments: completedMetrics.athlete_comments,
      coach_comments: coachComments,
      classification,
      planned: {
        duration_minutes: plannedDurationMinutes,
        distance_km: plannedDistanceKm,
        description,
        coach_comments: coachComments,
        targets: parsedTargetsMeta.targets
      },
      completed: {
        duration_minutes: completedMetrics.duration_minutes,
        distance_km: completedMetrics.distance_km,
        avg_pace_min_per_km: avgPaceMinPerKm,
        avg_speed_mps: completedMetrics.avg_speed_mps,
        avg_hr: completedMetrics.avg_hr,
        max_hr: completedMetrics.max_hr,
        rpe: completedMetrics.rpe,
        feeling: completedMetrics.feeling,
        if: completedMetrics.if_value,
        tss: completedMetrics.tss,
        energy_kj: completedMetrics.energy_kj,
        power_avg: completedMetrics.power_avg,
        power_max: completedMetrics.power_max,
        cadence_avg: completedMetrics.cadence_avg,
        cadence_max: completedMetrics.cadence_max,
        hr_zone_minutes: completedMetrics.hr_zone_minutes,
        power_zone_minutes: completedMetrics.power_zone_minutes,
        athlete_comments: completedMetrics.athlete_comments
      },
      comparison: {
        duration_delta_minutes: null,
        duration_delta_percent: null,
        distance_delta_km: null,
        distance_delta_percent: null,
        hr_vs_target: {
          status: "unknown",
          avg_hr: completedMetrics.avg_hr,
          target_min: null,
          target_max: null,
          delta_from_range: null
        },
        pace_vs_target: {
          status: "unknown",
          actual_avg_pace_min_per_km: avgPaceMinPerKm,
          target_fast_min_per_km: null,
          target_slow_min_per_km: null
        },
        mismatch_flags: {
          skipped: false,
          extra_workout: false,
          duration_shorter: false,
          duration_longer: false,
          distance_shorter: false,
          distance_longer: false,
          hr_above_target: false,
          hr_below_target: false,
          pace_too_fast: false,
          pace_too_slow: false,
          missing_hr_data: false,
          missing_planned_target: false
        },
        coach_attention_flags: {
          suspicious_if: false,
          suspicious_tss: false,
          high_hr_on_easy_run: false
        },
        data_quality_flags: {
          planned_distance_missing_in_export: false,
          planned_targets_text_only: false,
          multiple_pace_targets_found: false,
          pace_target_text_only: false,
          pace_target_unparsed: false,
          no_athlete_comment: false,
          no_completion_status_column: false,
          unclear_classification: false
        }
      },
      source_file: candidate.sourceFile,
      raw
    };

    normalized.intensity_flags = buildIntensityFlags(normalized);
    normalized.data_warnings = buildDataWarnings(normalized);
    normalized.comparison = buildComparison({
      workout: normalized,
      parsedTargetsMeta,
      completionStatusColumnAvailable
    });

    if (looksLikeWorkout(normalized)) {
      workouts.push(normalized);
    }
  }

  return {
    workouts,
    sourceFiles: [candidate.sourceFile],
    completionStatusColumnAvailable
  };
}

function sumOrNull(values: Array<number | null>, digits: number): number | null {
  const numericValues = values.filter((value): value is number => value !== null);
  if (numericValues.length === 0) {
    return null;
  }

  const total = numericValues.reduce((sum, value) => sum + value, 0);
  return roundNumber(total, digits);
}

function countByClassification(workouts: ParsedWorkout[], type: ClassificationType): number {
  return workouts.filter((workout) => workout.classification.type === type).length;
}

function buildWeekMetrics(
  workouts: ParsedWorkout[],
  completionStatusColumnAvailable: boolean
): WeeklySummary["week_metrics"] {
  const plannedWorkouts = workouts.filter((workout) => workout.classification.is_planned);
  const completedWorkouts = workouts.filter((workout) => workout.classification.is_completed);
  const plannedCompletedCount = countByClassification(workouts, "planned_completed");
  const plannedDistanceAvailable =
    plannedWorkouts.length > 0 &&
    plannedWorkouts.every((workout) => workout.planned.distance_km !== null);

  const plannedDurationMinutes = sumOrNull(
    plannedWorkouts.map((workout) => workout.planned.duration_minutes),
    0
  );
  const plannedDistanceKm = plannedDistanceAvailable
    ? sumOrNull(plannedWorkouts.map((workout) => workout.planned.distance_km), 2)
    : null;
  const completedDurationMinutes = sumOrNull(
    completedWorkouts.map((workout) => workout.completed.duration_minutes),
    0
  );
  const completedDistanceKm = sumOrNull(
    completedWorkouts.map((workout) => workout.completed.distance_km),
    2
  );

  const warnings: string[] = [];
  const missingPlannedDistanceCount = plannedWorkouts.filter(
    (workout) => workout.comparison.data_quality_flags.planned_distance_missing_in_export
  ).length;
  const plannedTargetsTextOnlyCount = plannedWorkouts.filter(
    (workout) => workout.comparison.data_quality_flags.planned_targets_text_only
  ).length;
  const paceTargetUnparsedCount = plannedWorkouts.filter(
    (workout) => workout.comparison.data_quality_flags.pace_target_unparsed
  ).length;
  const workoutsWithMultiplePaceRanges = plannedWorkouts.filter(
    (workout) => workout.comparison.data_quality_flags.multiple_pace_targets_found
  ).length;
  const noAthleteCommentCount = completedWorkouts.filter(
    (workout) => workout.comparison.data_quality_flags.no_athlete_comment
  ).length;
  const unclearCount = countByClassification(workouts, "unclear");

  if (missingPlannedDistanceCount > 0) {
    warnings.push(
      `planned distance missing in export for ${missingPlannedDistanceCount} planned workout(s)`
    );
  }

  if (plannedTargetsTextOnlyCount > 0) {
    warnings.push(`planned targets not parsed for ${plannedTargetsTextOnlyCount} planned workout(s)`);
  }

  if (paceTargetUnparsedCount > 0) {
    warnings.push(`pace target text not normalized for ${paceTargetUnparsedCount} planned workout(s)`);
  }

  if (workoutsWithMultiplePaceRanges > 0) {
    warnings.push(
      `multiple pace ranges found for ${workoutsWithMultiplePaceRanges} planned workout(s)`
    );
  }

  if (noAthleteCommentCount > 0) {
    warnings.push(`athlete comments missing for ${noAthleteCommentCount} completed workout(s)`);
  }

  if (!completionStatusColumnAvailable) {
    warnings.push("completion status column missing in export");
  }

  if (unclearCount > 0) {
    warnings.push(`unclear classification for ${unclearCount} workout(s)`);
  }

  return {
    planned: {
      workouts_count: plannedWorkouts.length,
      duration_minutes: plannedDurationMinutes,
      distance_km: plannedDistanceKm
    },
    completed: {
      workouts_count: completedWorkouts.length,
      duration_minutes: completedDurationMinutes,
      distance_km: completedDistanceKm
    },
    plan_vs_fact: {
      completion_rate:
        plannedWorkouts.length > 0
          ? roundNumber(plannedCompletedCount / plannedWorkouts.length, 3)
          : null,
      duration_delta_minutes: computeDelta(completedDurationMinutes, plannedDurationMinutes, 0),
      duration_delta_percent: computeDeltaPercent(completedDurationMinutes, plannedDurationMinutes),
      distance_delta_km: computeDelta(completedDistanceKm, plannedDistanceKm, 2),
      distance_delta_percent: computeDeltaPercent(completedDistanceKm, plannedDistanceKm)
    },
    counts: {
      planned_completed: plannedCompletedCount,
      planned_skipped: countByClassification(workouts, "planned_skipped"),
      extra_completed: countByClassification(workouts, "extra_completed"),
      day_off: countByClassification(workouts, "day_off"),
      unclear: unclearCount
    },
    data_quality: {
      planned_distance_available: plannedDistanceAvailable,
      planned_hr_targets_found: plannedWorkouts.filter(
        (workout) => workout.planned.targets.hr_bpm !== null
      ).length,
      planned_pace_targets_found: plannedWorkouts.filter(
        (workout) => workout.planned.targets.pace_min_per_km !== null
      ).length,
      planned_pace_ranges_found: plannedWorkouts.reduce(
        (count, workout) => count + workout.planned.targets.pace_ranges.length,
        0
      ),
      workouts_with_multiple_pace_ranges: plannedWorkouts.filter(
        (workout) => workout.planned.targets.pace_ranges.length > 1
      ).length,
      warnings
    }
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const exportDir = path.join(exportsRoot, args.student, `${args.from}_${args.to}`);
  const outputDir = path.join(parsedRoot, args.student, `${args.from}_${args.to}`);
  const outputPath = path.join(outputDir, "weekly-summary.json");

  if (!existsSync(exportDir)) {
    throw new Error(`Export folder does not exist: ${exportDir}`);
  }

  await mkdir(outputDir, { recursive: true });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tp-parse-week-"));
  console.log(`Export folder used: ${exportDir}`);

  try {
    const csvCandidates = await discoverCsvCandidates(exportDir, tempRoot);
    const parsedFiles = await Promise.all(
      csvCandidates.map(async (candidate) => {
        try {
          return await parseCsvFile(candidate);
        } catch (error: unknown) {
          console.warn(`Skipping CSV due to parse error: ${candidate.sourceFile}`);
          console.warn(error);
          return {
            workouts: [],
            sourceFiles: [candidate.sourceFile],
            completionStatusColumnAvailable: false
          } satisfies ParsedCsv;
        }
      })
    );

    const workouts = parsedFiles.flatMap((entry) => entry.workouts);
    const sourceFiles = [...new Set(parsedFiles.flatMap((entry) => entry.sourceFiles))];
    const completionStatusColumnAvailable = parsedFiles.some(
      (entry) => entry.completionStatusColumnAvailable
    );
    const plannedDurationTotal = sumOrNull(
      workouts.map((workout) => workout.planned_duration_minutes),
      0
    );
    const completedDurationTotal = sumOrNull(
      workouts.map((workout) => workout.completed_duration_minutes),
      0
    );
    const completedDistanceTotal = sumOrNull(workouts.map((workout) => workout.distance_km), 2);

    const summary: WeeklySummary = {
      schema_version: "weekly-summary.v2",
      student_id: args.student,
      week: {
        from: args.from,
        to: args.to
      },
      source_files: sourceFiles,
      totals: {
        workouts_count: workouts.length,
        completed_workouts_count: workouts.filter(isCompletedWorkout).length,
        total_distance_km: completedDistanceTotal,
        planned_duration_minutes: plannedDurationTotal,
        completed_duration_minutes: completedDurationTotal,
        total_completed_duration_text: formatDurationMinutes(completedDurationTotal),
        total_planned_duration_text: formatDurationMinutes(plannedDurationTotal),
        total_distance_text: formatDistanceKm(completedDistanceTotal),
        data_warnings_count: workouts.reduce(
          (count, workout) => count + workout.data_warnings.length,
          0
        ),
        intensity_flags_count: workouts.reduce(
          (count, workout) => count + workout.intensity_flags.length,
          0
        )
      },
      week_metrics: buildWeekMetrics(workouts, completionStatusColumnAvailable),
      workouts
    };

    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log("Parser success.");
    console.log(`weekly-summary.json path: ${outputPath}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
