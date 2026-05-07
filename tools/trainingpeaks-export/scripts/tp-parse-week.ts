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
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";

import { parse } from "csv-parse/sync";
import FitParser from "fit-file-parser";
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

type CompletedDetailSource = {
  type: "workout_file_fit" | "summary_only";
  match_status: "matched" | "not_found" | "ambiguous" | "not_completed";
  match_confidence: "high" | "medium" | "low" | "none";
  zip_path?: string;
  entry_name?: string;
  fit_start_time?: string | null;
  fit_start_date_utc?: string | null;
  fit_sport?: string | null;
  fit_total_timer_time_s?: number | null;
  fit_total_elapsed_time_s?: number | null;
  fit_total_distance_m?: number | null;
  score?: number;
  reasons?: string[];
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
  detail_source: CompletedDetailSource;
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
  source?: {
    workout_summary_files: string[];
    workout_summary_columns: string[];
    workout_files: WorkoutFilesSource;
  };
  segment_analysis?: {
    available: false;
    reason: "workout_files_not_parsed_yet";
  };
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
  columns: string[];
  completionStatusColumnAvailable: boolean;
};

type WorkoutFileEntry = {
  zip_path: string;
  entry_name: string;
  format: "fit.gz" | "fit";
  compressed: boolean;
  size_bytes?: number;
};

type UnsupportedWorkoutFileEntry = {
  zip_path: string;
  entry_name: string;
  extension: string;
  size_bytes?: number;
};

type WorkoutFilesSource = {
  present: boolean;
  files: WorkoutFileEntry[];
  unsupported_files: UnsupportedWorkoutFileEntry[];
  fit_summaries: FitSummary[];
  fit_diagnostics: FitDiagnostics;
};

type FitRecordFieldsPresent = {
  distance: boolean;
  speed: boolean;
  enhanced_speed: boolean;
  heart_rate: boolean;
  cadence: boolean;
  power: boolean;
};

type FitRecordFieldCounts = {
  distance: number;
  speed: number;
  enhanced_speed: number;
  heart_rate: number;
  cadence: number;
  power: number;
};

type FitSampleRecord = {
  timestamp?: string | null;
  distance?: number | null;
  speed?: number | null;
  enhanced_speed?: number | null;
  heart_rate?: number | null;
  cadence?: number | null;
  power?: number | null;
};

type FitDiagnostics = {
  status: "parsed_sample" | "parse_failed" | "not_available";
  parser: "fit-file-parser";
  sample_strategy: "first_fit_gz_sorted";
  sampled_zip_path?: string;
  sampled_entry_name?: string;
  error?: string;
  session_count?: number;
  laps_count?: number;
  records_count?: number;
  sport?: string | null;
  session_start_time?: string | null;
  total_timer_time_s?: number | null;
  total_elapsed_time_s?: number | null;
  total_distance_m?: number | null;
  first_record_timestamp?: string | null;
  last_record_timestamp?: string | null;
  record_fields_present?: FitRecordFieldsPresent;
  record_field_counts?: FitRecordFieldCounts;
  sample_record?: FitSampleRecord;
};

type FitSummary = {
  status: "parsed" | "parse_failed";
  zip_path: string;
  entry_name: string;
  format: "fit.gz" | "fit";
  error?: string;
  start_time?: string | null;
  start_date_utc?: string | null;
  sport?: string | null;
  total_timer_time_s?: number | null;
  total_elapsed_time_s?: number | null;
  total_distance_m?: number | null;
  records_count?: number;
  laps_count?: number;
  session_count?: number;
};

type FitRecordLike = {
  timestamp?: string;
  distance?: number;
  speed?: number;
  enhanced_speed?: number;
  heart_rate?: number;
  cadence?: number;
  power?: number;
};

type FitSessionLike = {
  sport?: string;
  start_time?: string;
  total_timer_time?: number;
  total_elapsed_time?: number;
  total_distance?: number;
};

type ParsedFitLike = {
  sessions?: FitSessionLike[];
  laps?: unknown[];
  records?: FitRecordLike[];
};

type FitMatchCandidate = {
  workout_index: number;
  fit_index: number;
  score: number;
  reasons: string[];
  exact_date_match: boolean;
  passes_weak_thresholds: boolean;
  match_confidence: "high" | "medium";
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
const gunzip = promisify(gunzipCallback);

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

function normalizeExportName(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyWorkoutFilesZip(filePath: string): boolean {
  const normalized = normalizeExportName(filePath);
  return normalized.includes("workoutfileexport") || normalized.includes("workoutfiles");
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

function createDefaultDetailSource(isCompleted: boolean): CompletedDetailSource {
  if (!isCompleted) {
    return {
      type: "summary_only",
      match_status: "not_completed",
      match_confidence: "none"
    };
  }

  return {
    type: "summary_only",
    match_status: "not_found",
    match_confidence: "none"
  };
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

  const zipFiles = files.filter(
    (filePath) =>
      path.extname(filePath).toLowerCase() === ".zip" && !isLikelyWorkoutFilesZip(filePath)
  );
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

function getWorkoutFileExtension(entryName: string): string {
  const lowerName = entryName.toLowerCase();

  if (lowerName.endsWith(".fit.gz")) {
    return "fit.gz";
  }

  if (lowerName.endsWith(".fit")) {
    return "fit";
  }

  if (lowerName.endsWith(".tcx")) {
    return "tcx";
  }

  if (lowerName.endsWith(".gpx")) {
    return "gpx";
  }

  if (lowerName.endsWith(".json")) {
    return "json";
  }

  if (lowerName.endsWith(".csv")) {
    return "csv";
  }

  return "other";
}

function buildNotAvailableFitDiagnostics(): FitDiagnostics {
  return {
    status: "not_available",
    parser: "fit-file-parser",
    sample_strategy: "first_fit_gz_sorted"
  };
}

function trimFitErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeIsoDateFromUtc(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toUtcDateString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
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

function createFitParser(): FitParser {
  return new FitParser({
    mode: "list",
    lengthUnit: "m",
    speedUnit: "m/s",
    force: false
  });
}

function createEmptyFitRecordFieldCounts(): FitRecordFieldCounts {
  return {
    distance: 0,
    speed: 0,
    enhanced_speed: 0,
    heart_rate: 0,
    cadence: 0,
    power: 0
  };
}

function createRecordFieldsPresent(counts: FitRecordFieldCounts): FitRecordFieldsPresent {
  return {
    distance: counts.distance > 0,
    speed: counts.speed > 0,
    enhanced_speed: counts.enhanced_speed > 0,
    heart_rate: counts.heart_rate > 0,
    cadence: counts.cadence > 0,
    power: counts.power > 0
  };
}

function buildFitSampleRecord(record: FitRecordLike | undefined): FitSampleRecord | undefined {
  if (!record) {
    return undefined;
  }

  return {
    timestamp: record.timestamp ?? null,
    distance: isFiniteNumber(record.distance) ? record.distance : null,
    speed: isFiniteNumber(record.speed) ? record.speed : null,
    enhanced_speed: isFiniteNumber(record.enhanced_speed) ? record.enhanced_speed : null,
    heart_rate: isFiniteNumber(record.heart_rate) ? record.heart_rate : null,
    cadence: isFiniteNumber(record.cadence) ? record.cadence : null,
    power: isFiniteNumber(record.power) ? record.power : null
  };
}

function pickRepresentativeFitRecord(records: FitRecordLike[]): FitRecordLike | undefined {
  return records.find(
    (record) =>
      isFiniteNumber(record.distance) ||
      isFiniteNumber(record.speed) ||
      isFiniteNumber(record.enhanced_speed) ||
      isFiniteNumber(record.heart_rate) ||
      isFiniteNumber(record.cadence) ||
      isFiniteNumber(record.power)
  ) ?? records[0];
}

function summarizeParsedFit(
  parsedFit: ParsedFitLike,
  sampledFile: WorkoutFileEntry
): FitDiagnostics {
  const sessions = Array.isArray(parsedFit.sessions) ? parsedFit.sessions : [];
  const laps = Array.isArray(parsedFit.laps) ? parsedFit.laps : [];
  const records = Array.isArray(parsedFit.records) ? parsedFit.records : [];
  const firstSession = sessions[0];
  const firstRecord = records[0];
  const lastRecord = records.at(-1);
  const fieldCounts = createEmptyFitRecordFieldCounts();

  for (const record of records) {
    if (isFiniteNumber(record.distance)) {
      fieldCounts.distance += 1;
    }
    if (isFiniteNumber(record.speed)) {
      fieldCounts.speed += 1;
    }
    if (isFiniteNumber(record.enhanced_speed)) {
      fieldCounts.enhanced_speed += 1;
    }
    if (isFiniteNumber(record.heart_rate)) {
      fieldCounts.heart_rate += 1;
    }
    if (isFiniteNumber(record.cadence)) {
      fieldCounts.cadence += 1;
    }
    if (isFiniteNumber(record.power)) {
      fieldCounts.power += 1;
    }
  }

  return {
    status: "parsed_sample",
    parser: "fit-file-parser",
    sample_strategy: "first_fit_gz_sorted",
    sampled_zip_path: sampledFile.zip_path,
    sampled_entry_name: sampledFile.entry_name,
    session_count: sessions.length,
    laps_count: laps.length,
    records_count: records.length,
    sport: firstSession?.sport ?? null,
    session_start_time: firstSession?.start_time ?? null,
    total_timer_time_s: isFiniteNumber(firstSession?.total_timer_time)
      ? firstSession.total_timer_time
      : null,
    total_elapsed_time_s: isFiniteNumber(firstSession?.total_elapsed_time)
      ? firstSession.total_elapsed_time
      : null,
    total_distance_m: isFiniteNumber(firstSession?.total_distance)
      ? firstSession.total_distance
      : null,
    first_record_timestamp: firstRecord?.timestamp ?? null,
    last_record_timestamp: lastRecord?.timestamp ?? null,
    record_fields_present: createRecordFieldsPresent(fieldCounts),
    record_field_counts: fieldCounts,
    sample_record: buildFitSampleRecord(pickRepresentativeFitRecord(records))
  };
}

function summarizeFitForMatching(parsedFit: ParsedFitLike, fitFile: WorkoutFileEntry): FitSummary {
  const sessions = Array.isArray(parsedFit.sessions) ? parsedFit.sessions : [];
  const laps = Array.isArray(parsedFit.laps) ? parsedFit.laps : [];
  const records = Array.isArray(parsedFit.records) ? parsedFit.records : [];
  const firstSession = sessions[0];
  const startTime = normalizeIsoDateFromUtc(firstSession?.start_time);

  return {
    status: "parsed",
    zip_path: fitFile.zip_path,
    entry_name: fitFile.entry_name,
    format: fitFile.format,
    start_time: startTime,
    start_date_utc: toUtcDateString(startTime),
    sport: firstSession?.sport ?? null,
    total_timer_time_s: isFiniteNumber(firstSession?.total_timer_time)
      ? firstSession.total_timer_time
      : null,
    total_elapsed_time_s: isFiniteNumber(firstSession?.total_elapsed_time)
      ? firstSession.total_elapsed_time
      : null,
    total_distance_m: isFiniteNumber(firstSession?.total_distance) ? firstSession.total_distance : null,
    records_count: records.length,
    laps_count: laps.length,
    session_count: sessions.length
  };
}

async function readWorkoutFileEntryBuffer(
  sampledFile: WorkoutFileEntry
): Promise<Buffer<ArrayBufferLike>> {
  const zipPath = path.join(toolRoot, sampledFile.zip_path);
  const directory = await unzipper.Open.file(zipPath);
  const entry = directory.files.find(
    (candidate) => candidate.type === "File" && toPosixPath(candidate.path) === sampledFile.entry_name
  );

  if (!entry) {
    throw new Error(`ZIP entry not found: ${sampledFile.entry_name}`);
  }

  const entryBuffer = await entry.buffer();
  if (sampledFile.compressed) {
    return await gunzip(entryBuffer);
  }

  return entryBuffer;
}

async function parseFitDiagnosticsSample(workoutFilesSource: WorkoutFilesSource): Promise<FitDiagnostics> {
  const sampledFile =
    workoutFilesSource.files.find((file) => file.format === "fit.gz") ?? workoutFilesSource.files[0];

  if (!sampledFile) {
    return buildNotAvailableFitDiagnostics();
  }

  try {
    const fitBuffer = await readWorkoutFileEntryBuffer(sampledFile);
    const fitParser = createFitParser();
    const parsedFit = await fitParser.parseAsync(fitBuffer);

    return summarizeParsedFit(parsedFit as ParsedFitLike, sampledFile);
  } catch (error: unknown) {
    return {
      status: "parse_failed",
      parser: "fit-file-parser",
      sample_strategy: "first_fit_gz_sorted",
      sampled_zip_path: sampledFile.zip_path,
      sampled_entry_name: sampledFile.entry_name,
      error: trimFitErrorMessage(error)
    };
  }
}

async function parseAllFitSummaries(workoutFilesSource: WorkoutFilesSource): Promise<FitSummary[]> {
  const fitSummaries: FitSummary[] = [];

  for (const fitFile of workoutFilesSource.files) {
    try {
      const fitBuffer = await readWorkoutFileEntryBuffer(fitFile);
      const fitParser = createFitParser();
      const parsedFit = await fitParser.parseAsync(fitBuffer);
      fitSummaries.push(summarizeFitForMatching(parsedFit as ParsedFitLike, fitFile));
    } catch (error: unknown) {
      fitSummaries.push({
        status: "parse_failed",
        zip_path: fitFile.zip_path,
        entry_name: fitFile.entry_name,
        format: fitFile.format,
        error: trimFitErrorMessage(error)
      });
    }
  }

  return fitSummaries;
}

async function discoverWorkoutFilesSource(exportDir: string): Promise<WorkoutFilesSource> {
  const files = (await listFilesRecursively(exportDir)).sort((a, b) => a.localeCompare(b));
  const workoutFilesZips = files.filter(
    (filePath) =>
      path.extname(filePath).toLowerCase() === ".zip" && isLikelyWorkoutFilesZip(filePath)
  );
  const source: WorkoutFilesSource = {
    present: workoutFilesZips.length > 0,
    files: [],
    unsupported_files: [],
    fit_summaries: [],
    fit_diagnostics: buildNotAvailableFitDiagnostics()
  };

  for (const zipPath of workoutFilesZips) {
    const zipRelativePath = relativeToToolRoot(zipPath);
    const directory = await unzipper.Open.file(zipPath);

    for (const entry of directory.files) {
      if (entry.type !== "File") {
        continue;
      }

      const entryName = toPosixPath(entry.path);
      const extension = getWorkoutFileExtension(entryName);
      const sizeBytes =
        typeof entry.uncompressedSize === "number" && Number.isFinite(entry.uncompressedSize)
          ? entry.uncompressedSize
          : undefined;

      if (extension === "fit.gz") {
        source.files.push({
          zip_path: zipRelativePath,
          entry_name: entryName,
          format: "fit.gz",
          compressed: true,
          ...(sizeBytes === undefined ? {} : { size_bytes: sizeBytes })
        });
        continue;
      }

      if (extension === "fit") {
        source.files.push({
          zip_path: zipRelativePath,
          entry_name: entryName,
          format: "fit",
          compressed: false,
          ...(sizeBytes === undefined ? {} : { size_bytes: sizeBytes })
        });
        continue;
      }

      source.unsupported_files.push({
        zip_path: zipRelativePath,
        entry_name: entryName,
        extension,
        ...(sizeBytes === undefined ? {} : { size_bytes: sizeBytes })
      });
    }
  }

  source.files.sort((a, b) =>
    a.zip_path === b.zip_path
      ? a.entry_name.localeCompare(b.entry_name)
      : a.zip_path.localeCompare(b.zip_path)
  );
  source.unsupported_files.sort((a, b) =>
    a.zip_path === b.zip_path
      ? a.entry_name.localeCompare(b.entry_name)
      : a.zip_path.localeCompare(b.zip_path)
  );
  source.fit_diagnostics = await parseFitDiagnosticsSample(source);
  source.fit_summaries = await parseAllFitSummaries(source);

  return source;
}

async function parseCsvFile(candidate: CsvCandidate): Promise<ParsedCsv> {
  const fileStats = await stat(candidate.csvPath);
  if (!fileStats.isFile()) {
    return {
      workouts: [],
      sourceFiles: [],
      columns: [],
      completionStatusColumnAvailable: false
    };
  }

  const content = await readFile(candidate.csvPath, "utf8");
  if (!content.trim()) {
    return {
      workouts: [],
      sourceFiles: [candidate.sourceFile],
      columns: [],
      completionStatusColumnAvailable: false
    };
  }

  const delimiter = detectDelimiter(content);
  let parsedColumns: string[] = [];
  const records = parse(content, {
    bom: true,
    columns: (header) => {
      parsedColumns = header
        .map((value) => cleanString(value) ?? "")
        .filter((value) => value.length > 0);
      return header;
    },
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
        athlete_comments: completedMetrics.athlete_comments,
        detail_source: createDefaultDetailSource(classification.is_completed)
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
    columns: parsedColumns,
    completionStatusColumnAvailable
  };
}

function normalizeSportForFitMatch(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "run" || normalized === "running") {
    return "run";
  }

  return normalized;
}

function getDateDifferenceDays(leftDate: string | null, rightDate: string | null): number | null {
  if (!leftDate || !rightDate) {
    return null;
  }

  const left = new Date(`${leftDate}T00:00:00.000Z`);
  const right = new Date(`${rightDate}T00:00:00.000Z`);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return null;
  }

  return Math.round((left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000));
}

function relativeDelta(delta: number, left: number, right: number): number {
  const baseline = Math.max(Math.abs(left), Math.abs(right));
  return baseline > 0 ? delta / baseline : 0;
}

function scoreDurationMatch(
  workout: ParsedWorkout,
  fitSummary: FitSummary,
  reasons: string[]
): { score: number; matched: boolean } {
  const workoutDurationSeconds =
    workout.completed.duration_minutes !== null ? workout.completed.duration_minutes * 60 : null;
  const fitDurationSeconds = fitSummary.total_timer_time_s ?? null;

  if (workoutDurationSeconds === null || fitDurationSeconds === null) {
    reasons.push("duration_missing");
    return { score: 0, matched: false };
  }

  const delta = Math.abs(workoutDurationSeconds - fitDurationSeconds);
  const relative = relativeDelta(delta, workoutDurationSeconds, fitDurationSeconds);
  if (delta <= 5 * 60 || relative <= 0.08) {
    reasons.push("duration_strong");
    return { score: 20, matched: true };
  }

  if (delta <= 10 * 60 || relative <= 0.15) {
    reasons.push("duration_weak");
    return { score: 10, matched: true };
  }

  return { score: 0, matched: false };
}

function scoreDistanceMatch(
  workout: ParsedWorkout,
  fitSummary: FitSummary,
  reasons: string[]
): { score: number; matched: boolean } {
  const workoutDistanceMeters =
    workout.completed.distance_km !== null ? workout.completed.distance_km * 1000 : null;
  const fitDistanceMeters = fitSummary.total_distance_m ?? null;

  if (workoutDistanceMeters === null || fitDistanceMeters === null) {
    reasons.push("distance_missing");
    return { score: 0, matched: false };
  }

  const delta = Math.abs(workoutDistanceMeters - fitDistanceMeters);
  const relative = relativeDelta(delta, workoutDistanceMeters, fitDistanceMeters);
  if (delta <= 500 || relative <= 0.08) {
    reasons.push("distance_strong");
    return { score: 20, matched: true };
  }

  if (delta <= 1000 || relative <= 0.15) {
    reasons.push("distance_weak");
    return { score: 10, matched: true };
  }

  return { score: 0, matched: false };
}

function buildFitMatchCandidate(
  workout: ParsedWorkout,
  workoutIndex: number,
  fitSummary: FitSummary,
  fitIndex: number,
  exactDateCandidatesCount: number
): FitMatchCandidate | null {
  const dateDifferenceDays = getDateDifferenceDays(workout.date, fitSummary.start_date_utc ?? null);
  const reasons: string[] = [];
  let score = 0;
  let exactDateMatch = false;

  if (dateDifferenceDays === 0) {
    score += 40;
    reasons.push("same_date");
    exactDateMatch = true;
  } else if (dateDifferenceDays !== null && Math.abs(dateDifferenceDays) === 1) {
    score += 15;
    reasons.push("timezone_off_by_one_day_candidate");
  } else {
    return null;
  }

  const workoutSport = normalizeSportForFitMatch(workout.sport);
  const fitSport = normalizeSportForFitMatch(fitSummary.sport ?? null);
  if (workoutSport !== null && fitSport !== null && workoutSport === fitSport) {
    score += 20;
    reasons.push("sport_match");
  }

  const durationMatch = scoreDurationMatch(workout, fitSummary, reasons);
  score += durationMatch.score;

  const distanceMatch = scoreDistanceMatch(workout, fitSummary, reasons);
  score += distanceMatch.score;

  if (exactDateMatch && exactDateCandidatesCount === 1) {
    score += 10;
    reasons.push("single_candidate_on_date");
  }

  const passesWeakThresholds = durationMatch.matched || distanceMatch.matched;
  if (!passesWeakThresholds || score < 60) {
    return {
      workout_index: workoutIndex,
      fit_index: fitIndex,
      score,
      reasons,
      exact_date_match: exactDateMatch,
      passes_weak_thresholds: passesWeakThresholds,
      match_confidence: "medium"
    };
  }

  return {
    workout_index: workoutIndex,
    fit_index: fitIndex,
    score,
    reasons,
    exact_date_match: exactDateMatch,
    passes_weak_thresholds: true,
    match_confidence: exactDateMatch && score >= 80 ? "high" : "medium"
  };
}

function createMatchedDetailSource(
  fitSummary: FitSummary,
  candidate: FitMatchCandidate
): CompletedDetailSource {
  return {
    type: "workout_file_fit",
    match_status: "matched",
    match_confidence: candidate.match_confidence,
    zip_path: fitSummary.zip_path,
    entry_name: fitSummary.entry_name,
    fit_start_time: fitSummary.start_time ?? null,
    fit_start_date_utc: fitSummary.start_date_utc ?? null,
    fit_sport: fitSummary.sport ?? null,
    fit_total_timer_time_s: fitSummary.total_timer_time_s ?? null,
    fit_total_elapsed_time_s: fitSummary.total_elapsed_time_s ?? null,
    fit_total_distance_m: fitSummary.total_distance_m ?? null,
    score: candidate.score,
    reasons: candidate.reasons
  };
}

function createAmbiguousDetailSource(
  fitSummary: FitSummary,
  candidate: FitMatchCandidate
): CompletedDetailSource {
  return {
    type: "summary_only",
    match_status: "ambiguous",
    match_confidence: "low",
    zip_path: fitSummary.zip_path,
    entry_name: fitSummary.entry_name,
    fit_start_time: fitSummary.start_time ?? null,
    fit_start_date_utc: fitSummary.start_date_utc ?? null,
    fit_sport: fitSummary.sport ?? null,
    fit_total_timer_time_s: fitSummary.total_timer_time_s ?? null,
    fit_total_elapsed_time_s: fitSummary.total_elapsed_time_s ?? null,
    fit_total_distance_m: fitSummary.total_distance_m ?? null,
    score: candidate.score,
    reasons: candidate.reasons
  };
}

function buildWorkoutFitDetailSources(
  workouts: ParsedWorkout[],
  fitSummaries: FitSummary[]
): ParsedWorkout[] {
  const parsedFitSummaries = fitSummaries.filter(
    (fitSummary): fitSummary is FitSummary & { status: "parsed" } => fitSummary.status === "parsed"
  );
  const parsedFitIndexes = fitSummaries.flatMap((fitSummary, fitIndex) =>
    fitSummary.status === "parsed" ? [fitIndex] : []
  );
  const candidateMatrix = new Map<number, FitMatchCandidate[]>();
  const ambiguousWorkouts = new Set<number>();
  const assignableCandidates: Array<FitMatchCandidate & { fit_summary: FitSummary }> = [];
  const usedWorkouts = new Set<number>();
  const usedFits = new Set<number>();

  workouts.forEach((workout, workoutIndex) => {
    if (!workout.classification.is_completed) {
      workout.completed.detail_source = createDefaultDetailSource(false);
      return;
    }

    workout.completed.detail_source = createDefaultDetailSource(true);
    const exactDateCandidatesCount = parsedFitSummaries.filter(
      (fitSummary) => fitSummary.start_date_utc !== null && fitSummary.start_date_utc === workout.date
    ).length;
    const candidates = parsedFitSummaries
      .map((fitSummary, parsedFitIndex) =>
        buildFitMatchCandidate(
          workout,
          workoutIndex,
          fitSummary,
          parsedFitIndexes[parsedFitIndex],
          exactDateCandidatesCount
        )
      )
      .filter((candidate): candidate is FitMatchCandidate => candidate !== null)
      .sort((left, right) => right.score - left.score);

    candidateMatrix.set(workoutIndex, candidates);

    const weakCandidates = candidates.filter((candidate) => candidate.passes_weak_thresholds);
    const bestCandidate = weakCandidates[0];
    const secondBestCandidate = weakCandidates[1];
    if (!bestCandidate) {
      return;
    }

    const requiredGap = bestCandidate.exact_date_match && bestCandidate.score >= 80 ? 20 : 15;
    const scoreGap = secondBestCandidate ? bestCandidate.score - secondBestCandidate.score : Infinity;
    if (secondBestCandidate && scoreGap < requiredGap) {
      ambiguousWorkouts.add(workoutIndex);
      return;
    }

    for (const candidate of candidates) {
      if (!candidate.passes_weak_thresholds || candidate.score < 60) {
        continue;
      }

      const fitSummary = fitSummaries[candidate.fit_index];
      assignableCandidates.push({
        ...candidate,
        fit_summary: fitSummary
      });
    }
  });

  assignableCandidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.match_confidence !== right.match_confidence) {
      return left.match_confidence === "high" ? -1 : 1;
    }

    if (left.workout_index !== right.workout_index) {
      return left.workout_index - right.workout_index;
    }

    return left.fit_index - right.fit_index;
  });

  for (const candidate of assignableCandidates) {
    if (ambiguousWorkouts.has(candidate.workout_index)) {
      continue;
    }

    if (usedWorkouts.has(candidate.workout_index) || usedFits.has(candidate.fit_index)) {
      continue;
    }

    workouts[candidate.workout_index].completed.detail_source = createMatchedDetailSource(
      candidate.fit_summary,
      candidate
    );
    usedWorkouts.add(candidate.workout_index);
    usedFits.add(candidate.fit_index);
  }

  workouts.forEach((workout, workoutIndex) => {
    if (!workout.classification.is_completed || usedWorkouts.has(workoutIndex)) {
      return;
    }

    const candidates = candidateMatrix.get(workoutIndex) ?? [];
    if (ambiguousWorkouts.has(workoutIndex)) {
      const bestCandidate = candidates.find((candidate) => candidate.passes_weak_thresholds);
      if (bestCandidate) {
        workout.completed.detail_source = createAmbiguousDetailSource(
          fitSummaries[bestCandidate.fit_index],
          bestCandidate
        );
      }
      return;
    }

    const conflictCandidate = candidates.find(
      (candidate) => candidate.passes_weak_thresholds && candidate.score >= 60 && usedFits.has(candidate.fit_index)
    );
    if (conflictCandidate) {
      workout.completed.detail_source = createAmbiguousDetailSource(
        fitSummaries[conflictCandidate.fit_index],
        conflictCandidate
      );
    }
  });

  return workouts;
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
    const workoutFilesSource = await discoverWorkoutFilesSource(exportDir);
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
            columns: [],
            completionStatusColumnAvailable: false
          } satisfies ParsedCsv;
        }
      })
    );

    const workouts = buildWorkoutFitDetailSources(
      parsedFiles.flatMap((entry) => entry.workouts),
      workoutFilesSource.fit_summaries
    );
    const sourceFiles = [...new Set(parsedFiles.flatMap((entry) => entry.sourceFiles))];
    const workoutSummaryColumns = [
      ...new Set(parsedFiles.flatMap((entry) => entry.columns).filter((column) => column.length > 0))
    ];
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
      source: {
        workout_summary_files: sourceFiles,
        workout_summary_columns: workoutSummaryColumns,
        workout_files: workoutFilesSource
      },
      ...(workoutFilesSource.present
        ? {
            segment_analysis: {
              available: false as const,
              reason: "workout_files_not_parsed_yet" as const
            }
          }
        : {}),
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
    if (workoutFilesSource.files.length > 0) {
      console.log(`Workout Files found: ${workoutFilesSource.files.length} FIT file(s)`);
      debugLog("Workout Files entries:", workoutFilesSource.files);
      if (workoutFilesSource.unsupported_files.length > 0) {
        debugLog("Workout Files unsupported entries:", workoutFilesSource.unsupported_files);
      }
    }
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
