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
type SegmentCoverage = "full" | "partial" | "missing" | "unsupported";
type WorkoutSegmentAnalysisReason =
  | "computed"
  | "no_planned_segments"
  | "fit_not_matched"
  | "fit_parse_failed"
  | "timer_time_unavailable"
  | "unsupported_segments"
  | "unsupported_repeats";

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

type SegmentType =
  | "warmup"
  | "main"
  | "cooldown"
  | "interval"
  | "recovery"
  | "easy"
  | "long_run_finish"
  | "unknown";

type PlannedSegmentTargets = {
  hr_bpm: HrbpmTarget | null;
  pace_min_per_km: PaceTarget | null;
  pace_ranges: PaceRangeTarget[];
  source: "workout_description" | null;
  confidence: TargetConfidence | null;
};

type PlannedSegment = {
  order: number;
  segment_type: SegmentType;
  is_rest: boolean;
  repeat_count: number;
  repeat_group_id: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  label: string | null;
  raw_text: string;
  targets: PlannedSegmentTargets;
  confidence: TargetConfidence;
  data_quality_flags: string[];
};

type PlannedSegmentsParse = {
  status: "parsed" | "partial" | "not_available" | "unsupported";
  source: "workout_description";
  confidence: TargetConfidence | null;
  flags: string[];
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
  segments: PlannedSegment[];
  segments_parse: PlannedSegmentsParse;
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
  data_quality_flags?: string[];
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
    whole_workout_pace_comparison_suppressed: boolean;
    no_athlete_comment: boolean;
    no_completion_status_column: boolean;
    unclear_classification: boolean;
  };
};

type WorkoutSegmentAnalysis = {
  available: boolean;
  reason: WorkoutSegmentAnalysisReason;
  axis?: "timer_time";
  match_confidence?: "high" | "medium" | "low" | "none";
  planned_segments_count?: number;
  expanded_segments_count?: number;
  comparable_segments_count?: number;
  compared_segments_count?: number;
  extra_after_plan_seconds?: number;
  data_quality_flags?: string[];
};

type SegmentComparisonEntry = {
  order: number;
  planned_segment_order: number;
  repeat_iteration: number | null;
  repeat_group_id: string | null;
  segment_type: string;
  is_rest: boolean;
  label: string | null;
  planned_duration_minutes: number | null;
  planned_targets: {
    pace_min_per_km: PaceTarget | null;
    pace_text: string | null;
    hr_bpm: HrbpmTarget | null;
  };
  actual: {
    duration_minutes: number | null;
    distance_km: number | null;
    avg_pace_min_per_km: number | null;
    avg_pace_text: string | null;
    avg_hr: number | null;
    avg_cadence: number | null;
    avg_power: number | null;
  };
  coverage: SegmentCoverage;
  coverage_ratio: number | null;
  pace_vs_target: {
    status: PaceComparisonStatus;
    outside_by_min_per_km: number | null;
  };
  hr_vs_target: {
    status: HrComparisonStatus;
    outside_by_bpm: number | null;
  };
  data_quality_flags: string[];
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
  segment_analysis: WorkoutSegmentAnalysis;
  segment_comparison: SegmentComparisonEntry[];
  source_file: string;
  raw: RawRow;
};

type WeeklySegmentAnalysis = {
  available: boolean;
  reason: "computed" | "no_workout_files" | "no_matches" | "not_computed";
  workouts_with_planned_segments: number;
  workouts_with_matched_fit: number;
  workouts_analyzed: number;
  workouts_partial: number;
  workouts_unsupported: number;
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
  segment_analysis: WeeklySegmentAnalysis;
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

type FitParseMode = "strict" | "force_fallback";

type FitDiagnostics = {
  status: "parsed_sample" | "parse_failed" | "not_available";
  parser: "fit-file-parser";
  sample_strategy: "first_fit_gz_sorted";
  sampled_zip_path?: string;
  sampled_entry_name?: string;
  error?: string;
  fit_parse_mode?: FitParseMode;
  fit_parse_recovered?: boolean;
  fit_parse_strict_error?: string;
  data_quality_flags?: string[];
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
  fit_parse_mode?: FitParseMode;
  fit_parse_recovered?: boolean;
  fit_parse_strict_error?: string;
  data_quality_flags?: string[];
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
  timer_time?: number;
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

type ParsedFitWithFallback = {
  parsed_fit: ParsedFitLike;
  fit_parse_mode: FitParseMode;
  fit_parse_recovered: boolean;
  fit_parse_strict_error?: string;
  data_quality_flags: string[];
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
  hasHrTargetLikeText: boolean;
  hasPaceTargetLikeText: boolean;
  parsedAnyTarget: boolean;
};

type TextTargetSource = {
  key: "workout_description" | "coach_comments";
  text: string;
};

type SegmentDraft = Omit<PlannedSegment, "order">;

type DurationParseResult = {
  minutes: number | null;
  isRange: boolean;
  zeroDurationText: boolean;
};

type SplitSegmentLabel = {
  label: string | null;
  body: string;
  mappedType: SegmentType | null;
};

type RepeatMatch = {
  repeatCount: number;
  durationMinutes: number | null;
  durationIsRange: boolean;
  zeroDurationText: boolean;
  body: string;
};

type PlannedSegmentsParseResult = {
  segments: PlannedSegment[];
  segments_parse: PlannedSegmentsParse;
};

type ExpandedPlannedSegment = {
  order: number;
  planned_segment_order: number;
  repeat_iteration: number | null;
  repeat_group_id: string | null;
  segment_type: SegmentType;
  is_rest: boolean;
  label: string | null;
  duration_minutes: number | null;
  targets: PlannedSegmentTargets;
  data_quality_flags: string[];
};

type ExpandedSegmentsResult = {
  expanded_segments: ExpandedPlannedSegment[];
  unsupported_repeats: boolean;
  data_quality_flags: string[];
};

type TimerFitRecord = {
  timer_time: number;
  distance: number | null;
  speed: number | null;
  enhanced_speed: number | null;
  heart_rate: number | null;
  cadence: number | null;
  power: number | null;
};

type SegmentSliceMetrics = {
  coverage_seconds: number;
  distance_m: number | null;
  avg_hr: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
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
const SEGMENT_FULL_COVERAGE_THRESHOLD = 0.9;
const SEGMENT_PARTIAL_COVERAGE_THRESHOLD = 0.2;
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

function formatPaceMinPerKm(paceMinPerKm: number | null, suffix = "/km"): string | null {
  if (paceMinPerKm === null || !Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) {
    return null;
  }

  const totalSeconds = Math.round(paceMinPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}${suffix}`;
}

function formatPaceValue(paceMinPerKm: number): string {
  const totalSeconds = Math.round(paceMinPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPaceTargetRange(target: PaceTarget | null, suffix = "/km"): string | null {
  if (target === null) {
    return null;
  }

  return `${formatPaceValue(target.fast_min_per_km)}–${formatPaceValue(target.slow_min_per_km)}${suffix}`;
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

function hasHrTargetLikeText(value: string): boolean {
  return /(?:пульс|чсс|\bhr\b|\d{2,3}\s*[-–]\s*\d{2,3}\s*(?:уд\/?\s*мин|bpm))/iu.test(value);
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

function parseTargetsFromTextSources(textSources: TextTargetSource[]): ParsedTargetsMeta {
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
  const hasHrLikeText = textSources.some((entry) => hasHrTargetLikeText(entry.text));

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
    hasTargetLikeText: hasHrLikeText || hasPaceLikeText,
    hasHrTargetLikeText: hasHrLikeText,
    hasPaceTargetLikeText: hasPaceLikeText,
    parsedAnyTarget
  };
}

function parsePlannedTargets(params: {
  description: string | null;
  coachComments: string | null;
}): ParsedTargetsMeta {
  const textSources = [
    { key: "workout_description" as const, text: params.description },
    { key: "coach_comments" as const, text: params.coachComments }
  ].filter((entry): entry is TextTargetSource => Boolean(entry.text));

  return parseTargetsFromTextSources(textSources);
}

function buildEmptyPlannedSegmentsParse(status: PlannedSegmentsParse["status"]): PlannedSegmentsParse {
  return {
    status,
    source: "workout_description",
    confidence: null,
    flags: []
  };
}

function normalizeWorkoutDescriptionForSegments(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[⏸⏯⏹⏺]\s*/g, "")
    .replace(/[•●▪◦·]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeSegmentCandidate(value: string): boolean {
  return (
    countMinuteDurations(value) > 0 ||
    /^\s*(?:разминка|основная часть|заминка|л[её]гкий бег)(?=\s|$|[-:])/iu.test(value) ||
    /^\s*\d+\s*(?:повтор(?:а|ов|ения|ений)?|[xх×])\b/iu.test(value)
  );
}

function splitNormalizedDescriptionIntoLines(value: string): string[] {
  const withInlineBreaks = value
    .replace(
      /\s+(?=(?:разминка|основная часть|заминка|л[её]гкий бег)(?:\s*[-:]|\s+\d))/giu,
      "\n"
    )
    .replace(/\s+(?=(?:пауза\s+)?пауза\s*-)/giu, "\n");

  const expandInlineDurationBullets = (line: string): string[] => {
    const labeled = splitSegmentLabel(line);
    if (!labeled.label || !labeled.mappedType) {
      return [line];
    }

    if (parseRepeatMatch(labeled.body)) {
      return [line];
    }

    const expandedBody = labeled.body
      .replace(
        /\s+(?=-\s*(?:\d{1,3}(?:[.,]\d+)?(?:\s*-\s*\d{1,3}(?:[.,]\d+)?)?\s*мин(?:ут(?:а|ы)?|\.?)|\d{1,4}\s*сек(?:унд(?:а|ы)?|\.?)?|\d{1,2}:\d{2})(?=\s|$|[.,;:]))/giu,
        "\n"
      )
      .replace(/\s+(?=(?:пауза\s+)?пауза\s*-)/giu, "\n");
    const parts = expandedBody
      .split(/\n+/)
      .map((part) => part.replace(/^-\s*/, "").trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      return [line];
    }

    return parts.map((part, index) =>
      index === 0 ? `${labeled.label} - ${part}` : part
    );
  };

  return withInlineBreaks
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return [];
      }

      const semicolonParts = trimmed.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean);
      if (semicolonParts.length > 1 && semicolonParts.every(looksLikeSegmentCandidate)) {
        return semicolonParts;
      }

      return expandInlineDurationBullets(trimmed);
    })
    .map((line) => line.replace(/^(?:[-*]\s+|\d+[.)]\s+)/, "").trim())
    .filter(Boolean);
}

function parseDurationNumber(value: string): number | null {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type DurationMatch = DurationParseResult & {
  index: number;
};

function collectDurationMatches(value: string): DurationMatch[] {
  const matches: DurationMatch[] = [];

  for (const match of value.matchAll(
    /(?<![\d:])(?<first>\d{1,3}(?:[.,]\d+)?)(?:\s*-\s*(?<second>\d{1,3}(?:[.,]\d+)?))?\s*мин(?:ут(?:а|ы)?|\.?)(?=\s|$|[.,;:!?])/giu
  )) {
    if (match.index === undefined || !match.groups) {
      continue;
    }

    const first = parseDurationNumber(match.groups.first);
    const second = match.groups.second ? parseDurationNumber(match.groups.second) : null;
    const zeroDurationText = first === 0 || second === 0;
    const minutes =
      first !== null && first > 0
        ? second !== null && second > 0
          ? Math.min(first, second)
          : first
        : null;

    matches.push({
      index: match.index,
      minutes,
      isRange: second !== null,
      zeroDurationText
    });
  }

  for (const match of value.matchAll(
    /(?<![\d:])(?<minutes>[0-4]|0[0-4]):(?<seconds>[0-5]\d)(?!\s*-\s*\d{1,2}:\d{2})(?=\s|$|[.,;:!?])/giu
  )) {
    if (match.index === undefined || !match.groups) {
      continue;
    }

    const minutesPart = Number.parseInt(match.groups.minutes, 10);
    const secondsPart = Number.parseInt(match.groups.seconds, 10);
    const totalSeconds = minutesPart * 60 + secondsPart;

    matches.push({
      index: match.index,
      minutes: totalSeconds > 0 ? roundNumber(totalSeconds / 60, 2) : null,
      isRange: false,
      zeroDurationText: totalSeconds === 0
    });
  }

  for (const match of value.matchAll(
    /(?<![\d:])(?<seconds>\d{1,4})\s*сек(?:унд(?:а|ы)?|\.?)?(?=\s|$|[.,;:!?])/giu
  )) {
    if (match.index === undefined || !match.groups) {
      continue;
    }

    const seconds = Number.parseInt(match.groups.seconds, 10);
    matches.push({
      index: match.index,
      minutes: seconds > 0 ? roundNumber(seconds / 60, 2) : null,
      isRange: false,
      zeroDurationText: seconds === 0
    });
  }

  return matches.sort((left, right) => left.index - right.index);
}

function countMinuteDurations(value: string): number {
  return collectDurationMatches(value).length;
}

function getDurationMatchLength(value: string, match: DurationMatch): number {
  const slice = value.slice(match.index);
  const minuteMatch = slice.match(
    /^(?<first>\d{1,3}(?:[.,]\d+)?)(?:\s*-\s*(?<second>\d{1,3}(?:[.,]\d+)?))?\s*мин(?:ут(?:а|ы)?|\.?)/iu
  );
  if (minuteMatch?.[0]) {
    return minuteMatch[0].length;
  }

  const clockMatch = slice.match(/^(?<minutes>[0-4]|0[0-4]):(?<seconds>[0-5]\d)/u);
  if (clockMatch?.[0]) {
    return clockMatch[0].length;
  }

  const secondsMatch = slice.match(/^(?<seconds>\d{1,4})\s*сек(?:унд(?:а|ы)?|\.?)?/iu);
  if (secondsMatch?.[0]) {
    return secondsMatch[0].length;
  }

  return 0;
}

function isMinutesDurationMatch(value: string, match: DurationMatch): boolean {
  const slice = value.slice(match.index, match.index + 24);
  return /\d\s*мин(?:ут(?:а|ы)?|\.?)/iu.test(slice);
}

function isSecondsDurationMatch(value: string, match: DurationMatch): boolean {
  const slice = value.slice(match.index, match.index + 24);
  return /\d\s*сек(?:унд(?:а|ы)?|\.?)?/iu.test(slice) || /^[0-4]?\d:[0-5]\d/u.test(slice);
}

function parseAdjacentMinSecDuration(value: string, matches: DurationMatch[]): DurationParseResult | null {
  if (matches.length < 2) {
    return null;
  }

  const [first, second] = matches;
  if (!isMinutesDurationMatch(value, first) || !isSecondsDurationMatch(value, second)) {
    return null;
  }

  const between = value
    .slice(first.index + getDurationMatchLength(value, first), second.index)
    .trim();
  if (between.length > 0) {
    return null;
  }

  if (first.minutes === null || second.minutes === null) {
    return null;
  }

  return {
    minutes: roundNumber(first.minutes + second.minutes, 2),
    isRange: first.isRange,
    zeroDurationText: first.zeroDurationText || second.zeroDurationText
  };
}

function hasSingleEffectiveDuration(value: string): boolean {
  const matches = collectDurationMatches(value);
  if (matches.length === 0) {
    return false;
  }

  if (parseAdjacentMinSecDuration(value, matches)) {
    return matches.length <= 2;
  }

  return matches.length === 1;
}

function parseMinuteDuration(value: string): DurationParseResult {
  const matches = collectDurationMatches(value);
  if (matches.length === 0) {
    return {
      minutes: null,
      isRange: false,
      zeroDurationText: false
    };
  }

  const adjacent = parseAdjacentMinSecDuration(value, matches);
  if (adjacent) {
    return adjacent;
  }

  const match = matches[0];
  return {
    minutes: match.minutes,
    isRange: match.isRange,
    zeroDurationText: match.zeroDurationText
  };
}

function mapSegmentLabelToType(label: string): SegmentType | null {
  const normalizedLabel = label.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

  if (normalizedLabel.includes("разминка")) {
    return "warmup";
  }

  if (normalizedLabel.includes("основная часть")) {
    return "main";
  }

  if (normalizedLabel.includes("заминка")) {
    return "cooldown";
  }

  if (normalizedLabel.includes("легкий бег")) {
    return "easy";
  }

  return null;
}

function splitSegmentLabel(value: string): SplitSegmentLabel {
  const match = value.match(/^(?<label>[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s]{1,60})\s*[-:]\s*(?<body>.+)$/u);
  if (match?.groups) {
    const label = match.groups.label.trim();
    return {
      label,
      body: match.groups.body.trim(),
      mappedType: mapSegmentLabelToType(label)
    };
  }

  const implicitLabelMatch = value.match(
    /^(?<label>разминка|основная часть|заминка|л[её]гкий бег)\s+(?<body>.+)$/iu
  );
  if (implicitLabelMatch?.groups) {
    const label = implicitLabelMatch.groups.label.trim();
    return {
      label,
      body: implicitLabelMatch.groups.body.trim(),
      mappedType: mapSegmentLabelToType(label)
    };
  }

  return {
    label: null,
    body: value.trim(),
    mappedType: null
  };
}

function isRestSegmentText(value: string): boolean {
  return /(?:пауза|полный отдых|отдых|спокойного?\s+шага|шаг(?:а)?|пешком)/iu.test(value);
}

function isRecoverySegmentText(value: string): boolean {
  return /(?:восстанов|очень легко бегом|легк(?:о|ое|ий)\s+бегом)/iu.test(value);
}

function isEasySegmentText(value: string): boolean {
  return /л[её]гк(?:ий|ая|ое)?\s+бег/iu.test(value);
}

function parseRepeatMatch(value: string): RepeatMatch | null {
  const wordMatch = value.match(
    /^(?<count>\d+)\s*(?:повтор(?:а|ов|ения|ений)?)\s*:?\s*(?<body>.+)$/iu
  );
  if (wordMatch?.groups) {
    const repeatCount = Number.parseInt(wordMatch.groups.count, 10);
    if (repeatCount < 2) {
      return null;
    }

    const duration = parseMinuteDuration(wordMatch.groups.body);
    return {
      repeatCount,
      durationMinutes: duration.minutes,
      durationIsRange: duration.isRange,
      zeroDurationText: duration.zeroDurationText,
      body: wordMatch.groups.body.trim()
    };
  }

  const compactMatch = value.match(
    /^(?<count>\d+)\s*[xх×]\s*(?<first>\d{1,3})(?:\s*-\s*(?<second>\d{1,3}))?\s*мин(?:ут[аы]?|\.?)?\s*(?<body>.*)$/iu
  );
  if (!compactMatch?.groups) {
    return null;
  }

  const repeatCount = Number.parseInt(compactMatch.groups.count, 10);
  if (repeatCount < 2) {
    return null;
  }

  const first = Number.parseInt(compactMatch.groups.first, 10);
  const second = compactMatch.groups.second
    ? Number.parseInt(compactMatch.groups.second, 10)
    : null;

  return {
    repeatCount,
    durationMinutes: first > 0 ? (second !== null && second > 0 ? Math.min(first, second) : first) : null,
    durationIsRange: second !== null,
    zeroDurationText: first === 0 || second === 0,
    body: `${compactMatch.groups.first}${compactMatch.groups.second ? `-${compactMatch.groups.second}` : ""} минут ${compactMatch.groups.body}`.trim()
  };
}

function stripRecoveryTrailingProse(value: string): string {
  return value
    .replace(/\s+(?:полное\s+)?восстановлен(?:ие|ия)\s*\.?\s*$/iu, "")
    .replace(/\s+(?:можно\s+шаг(?:ом|а)?)\s*\.?\s*$/iu, "")
    .replace(/\s+(?:Сбрось|сбрось)\s+[^\n.]+(?:\.|$)/giu, "")
    .trim();
}

function stripRepeatBlockCoachingProse(value: string): string {
  return value
    .replace(
      /\s*(?:Ощущения|RPE|усил(?:ие|ия))\s*-\s*\d+\s*-\s*\d+\s*из\s*10\.?\s*/giu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function splitInlineRepeatRecovery(value: string): {
  intervalText: string;
  recoveryText: string | null;
} {
  const afterEachMatch = value.match(
    /^(?<interval>.+?)\s+после\s+каждого\s*[-:]?\s*(?<recovery>.+)$/iu
  );
  if (!afterEachMatch?.groups) {
    return {
      intervalText: value.trim(),
      recoveryText: null
    };
  }

  return {
    intervalText: afterEachMatch.groups.interval.trim(),
    recoveryText: stripRecoveryTrailingProse(afterEachMatch.groups.recovery.trim())
  };
}

function splitTrailingRecoveryFromRepeatText(value: string): {
  intervalText: string;
  recoveryText: string | null;
} {
  const inlineSplit = splitInlineRepeatRecovery(value);
  if (inlineSplit.recoveryText) {
    return inlineSplit;
  }

  const recoverySuffix =
    /(\d{1,3}\s*мин(?:ут(?:а|ы)?|\.?)?\s+\d{1,2}\s*сек(?:унд(?:а|ы)?|\.?)?|\d{1,2}:\d{2}|\d{1,3}(?:[.,]\d+)?\s*мин(?:ут(?:а|ы)?|\.?)|\d{1,4}\s*сек(?:унд(?:а|ы)?|\.?)?)\s+(?:(?:очень\s+)?легк(?:о|ое|ий)\s+бег(?:ом)?|восстановление|полный отдых|отдых|спокойного?\s+шага|шаг(?:а)?|пешком)(?:\s+(?:полное\s+)?восстановлен(?:ие|ия)?)?/giu;

  let lastMatch: RegExpExecArray | null = null;
  for (const match of value.matchAll(recoverySuffix)) {
    if (match.index !== undefined && match.index > 0) {
      lastMatch = match;
    }
  }

  if (!lastMatch || lastMatch.index === undefined || lastMatch.index === 0) {
    return {
      intervalText: value.trim(),
      recoveryText: null
    };
  }

  return {
    intervalText: value.slice(0, lastMatch.index).trim(),
    recoveryText: stripRecoveryTrailingProse(value.slice(lastMatch.index).trim())
  };
}

function recoverySegmentLooksRecoverable(recoveryText: string, recoveryDuration: DurationParseResult): boolean {
  return (
    recoveryDuration.minutes !== null &&
    !parseRepeatMatch(recoveryText) &&
    (isRecoverySegmentText(recoveryText) ||
      isEasySegmentText(recoveryText) ||
      isRestSegmentText(recoveryText))
  );
}

function parseSimpleRepeatBlock(value: string): {
  intervalText: string;
  intervalDuration: DurationParseResult;
  recoveryText: string;
  recoveryDuration: DurationParseResult;
} | null {
  const normalized = stripRepeatBlockCoachingProse(value.replace(/^\s*-\s*/, "").trim());
  if (!normalized) {
    return null;
  }

  const tryRepeatPair = (
    intervalText: string,
    recoveryText: string
  ): {
    intervalText: string;
    intervalDuration: DurationParseResult;
    recoveryText: string;
    recoveryDuration: DurationParseResult;
  } | null => {
    const intervalDuration = parseMinuteDuration(intervalText);
    const recoveryDuration = parseMinuteDuration(recoveryText);
    const recoveryLooksRecoverable = recoverySegmentLooksRecoverable(recoveryText, recoveryDuration);

    if (
      intervalDuration.minutes === null ||
      !recoveryLooksRecoverable ||
      !hasSingleEffectiveDuration(intervalText) ||
      !hasSingleEffectiveDuration(recoveryText)
    ) {
      return null;
    }

    return {
      intervalText,
      intervalDuration,
      recoveryText,
      recoveryDuration
    };
  };

  const slashMatch = normalized.match(/^(?<interval>.+?)\s*\/\s*(?<recovery>.+)$/u);
  if (slashMatch?.groups) {
    const slashPair = tryRepeatPair(
      slashMatch.groups.interval.trim(),
      slashMatch.groups.recovery.trim()
    );
    if (slashPair) {
      return slashPair;
    }
  }

  const bulletParts = normalized
    .split(/\s+-\s+/)
    .map((part, index) => (index === 0 ? part.replace(/^\s*-\s*/, "").trim() : part.trim()))
    .filter(Boolean);

  if (bulletParts.length === 2) {
    const slashPair = tryRepeatPair(bulletParts[0], bulletParts[1]);
    if (slashPair) {
      return slashPair;
    }
  }

  const splitRepeatText = splitTrailingRecoveryFromRepeatText(normalized);
  if (!splitRepeatText.recoveryText) {
    return null;
  }

  return tryRepeatPair(splitRepeatText.intervalText, splitRepeatText.recoveryText);
}

function buildSegmentTargetsMetaFromDescription(text: string): ParsedTargetsMeta {
  return parseTargetsFromTextSources([
    {
      key: "workout_description",
      text
    }
  ]);
}

function toPlannedSegmentTargets(meta: ParsedTargetsMeta): PlannedSegmentTargets {
  return {
    hr_bpm: meta.targets.hr_bpm,
    pace_min_per_km: meta.targets.pace_min_per_km,
    pace_ranges: meta.targets.pace_ranges,
    source: meta.targets.source === "workout_description" ? "workout_description" : null,
    confidence: meta.targets.confidence
  };
}

function buildSegmentType(params: {
  labelType: SegmentType | null;
  text: string;
  isRepeat: boolean;
  defaultRecovery: boolean;
}): { segmentType: SegmentType; isRest: boolean } {
  const text = params.text.toLowerCase();
  const isRest = isRestSegmentText(text);

  if (params.labelType === "recovery" || params.defaultRecovery) {
    return {
      segmentType: "recovery",
      isRest: false
    };
  }

  if (params.isRepeat) {
    return {
      segmentType: "interval",
      isRest: false
    };
  }

  if (isRest) {
    return {
      segmentType: "recovery",
      isRest: true
    };
  }

  if (params.labelType) {
    if (params.labelType === "main" && isRecoverySegmentText(text)) {
      return {
        segmentType: "recovery",
        isRest
      };
    }

    return {
      segmentType: params.labelType,
      isRest
    };
  }

  if (isRecoverySegmentText(text)) {
    return {
      segmentType: "recovery",
      isRest: false
    };
  }

  if (isEasySegmentText(text)) {
    return {
      segmentType: "easy",
      isRest: false
    };
  }

  return {
    segmentType: "unknown",
    isRest: false
  };
}

function buildSegmentConfidence(segmentType: SegmentType, flags: string[]): TargetConfidence {
  if (segmentType === "unknown" || flags.includes("boundary_ambiguous")) {
    return "low";
  }

  if (flags.length > 0) {
    return "medium";
  }

  return "high";
}

function createSegmentDraft(params: {
  label: string | null;
  rawText: string;
  durationMinutes: number | null;
  repeatCount: number;
  repeatGroupId: string | null;
  distanceKm?: number | null;
  labelType: SegmentType | null;
  defaultRecovery?: boolean;
  extraFlags?: string[];
}): SegmentDraft {
  const targetsMeta = buildSegmentTargetsMetaFromDescription(params.rawText);
  const segmentFlags = [...(params.extraFlags ?? [])];
  const { segmentType, isRest } = buildSegmentType({
    labelType: params.labelType,
    text: params.rawText,
    isRepeat: params.repeatCount > 1 && params.labelType !== "recovery",
    defaultRecovery: params.defaultRecovery ?? false
  });

  if (params.durationMinutes === null) {
    segmentFlags.push("duration_missing");
  }

  if (targetsMeta.hasPaceTargetLikeText && targetsMeta.targets.pace_ranges.length === 0) {
    segmentFlags.push("pace_target_unparsed");
  }

  if (targetsMeta.hasHrTargetLikeText && targetsMeta.targets.hr_bpm === null) {
    segmentFlags.push("hr_target_unparsed");
  }

  if (/[,:;]/.test(params.rawText) && /(если|затем|по желанию|последн|ускорен)/iu.test(params.rawText)) {
    segmentFlags.push("contains_free_text");
  }

  const uniqueFlags = [...new Set(segmentFlags)];

  return {
    segment_type: segmentType,
    is_rest: isRest,
    repeat_count: params.repeatCount,
    repeat_group_id: params.repeatGroupId,
    duration_minutes: params.durationMinutes,
    distance_km: params.distanceKm ?? null,
    label: params.label,
    raw_text: params.rawText,
    targets: toPlannedSegmentTargets(targetsMeta),
    confidence: buildSegmentConfidence(segmentType, uniqueFlags),
    data_quality_flags: uniqueFlags
  };
}

function detectWorkoutLevelSegmentFlags(description: string): string[] {
  const flags: string[] = [];

  if (/(если чувству|по желанию|если самочув)/iu.test(description)) {
    flags.push("unsupported_nested_instructions");
  }

  if (/\bпоследн(?:ие|их|яя)\b/iu.test(description)) {
    flags.push("unsupported_finish_clause");
  }

  if (/\bзатем\b|\bпотом\b/iu.test(description)) {
    flags.push("unsupported_then_clause");
  }

  if (/\bускорен|strides?\b|ускориться/iu.test(description)) {
    flags.push("unsupported_accelerations_inline");
  }

  if (/(?:^|[^\d])0+\s*мин(?:ут[аы]?|\.?)(?=\s|$|[.,;:])/iu.test(description)) {
    flags.push("zero_duration_text");
  }

  return flags;
}

function parsePlannedSegments(params: {
  description: string | null;
  plannedDurationMinutes: number | null;
}): PlannedSegmentsParseResult {
  if (!params.description) {
    return {
      segments: [],
      segments_parse: buildEmptyPlannedSegmentsParse("not_available")
    };
  }

  const normalizedDescription = normalizeWorkoutDescriptionForSegments(params.description);
  if (!normalizedDescription) {
    return {
      segments: [],
      segments_parse: buildEmptyPlannedSegmentsParse("not_available")
    };
  }

  const lines = splitNormalizedDescriptionIntoLines(normalizedDescription);
  const flags = new Set<string>(detectWorkoutLevelSegmentFlags(normalizedDescription));
  const drafts: SegmentDraft[] = [];
  let repeatGroupIndex = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labeled = splitSegmentLabel(line);
    const repeatMatch = parseRepeatMatch(labeled.body);

    if (!repeatMatch && countMinuteDurations(labeled.body) > 1) {
      flags.add("ambiguous_segment_boundaries");
      continue;
    }

    if (repeatMatch) {
      const repeatGroupId = `r${repeatGroupIndex}`;
      repeatGroupIndex += 1;
      const extraFlags: string[] = [];
      const repeatBlock = parseSimpleRepeatBlock(repeatMatch.body);

      if (repeatMatch.zeroDurationText) {
        flags.add("zero_duration_text");
      }

      if ((repeatBlock?.intervalDuration.isRange ?? repeatMatch.durationIsRange) || repeatMatch.durationIsRange) {
        extraFlags.push("contains_free_text");
      }

      const intervalTextForDraft = repeatBlock?.intervalText ?? repeatMatch.body;
      const totalDurationsInRepeatLine = countMinuteDurations(intervalTextForDraft);
      if (!repeatBlock && totalDurationsInRepeatLine > 1) {
        flags.add("repeat_block_partial");
      }

      const intervalRawText = labeled.label
        ? `${labeled.label} - ${intervalTextForDraft}`
        : intervalTextForDraft;
      drafts.push(
        createSegmentDraft({
          label: labeled.label,
          rawText: intervalRawText,
          durationMinutes: repeatBlock?.intervalDuration.minutes ?? repeatMatch.durationMinutes,
          repeatCount: repeatMatch.repeatCount,
          repeatGroupId,
          labelType: labeled.mappedType === "main" ? "interval" : labeled.mappedType,
          extraFlags
        })
      );

      if (repeatBlock) {
        if (repeatBlock.recoveryDuration.zeroDurationText) {
          flags.add("zero_duration_text");
        }

        drafts.push(
          createSegmentDraft({
            label: null,
            rawText: repeatBlock.recoveryText,
            durationMinutes: repeatBlock.recoveryDuration.minutes,
            repeatCount: repeatMatch.repeatCount,
            repeatGroupId,
            labelType: null,
            defaultRecovery: true,
            extraFlags: [
              "repeat_inferred",
              ...(repeatBlock.recoveryDuration.isRange ? ["contains_free_text"] : [])
            ]
          })
        );
        continue;
      }

      const nextLine = lines[index + 1];
      if (nextLine) {
        const nextLabeled = splitSegmentLabel(nextLine);
        const nextDuration = parseMinuteDuration(nextLabeled.body);
        const nextLooksRecoverable =
          nextDuration.minutes !== null &&
          !parseRepeatMatch(nextLabeled.body) &&
          (isRecoverySegmentText(nextLabeled.body) ||
            isEasySegmentText(nextLabeled.body) ||
            isRestSegmentText(nextLabeled.body));

        if (nextLooksRecoverable) {
          if (nextDuration.zeroDurationText) {
            flags.add("zero_duration_text");
          }

          const recoveryFlags = ["repeat_inferred"];
          if (nextDuration.isRange) {
            recoveryFlags.push("contains_free_text");
          }

          drafts.push(
            createSegmentDraft({
              label: nextLabeled.label,
              rawText: nextLine,
              durationMinutes: nextDuration.minutes,
              repeatCount: repeatMatch.repeatCount,
              repeatGroupId,
              labelType: nextLabeled.mappedType,
              defaultRecovery: true,
              extraFlags: recoveryFlags
            })
          );
          index += 1;
        }
      }

      continue;
    }

    const duration = parseMinuteDuration(labeled.body);
    const extraFlags: string[] = [];

    if (duration.zeroDurationText) {
      flags.add("zero_duration_text");
    }

    if (duration.isRange) {
      extraFlags.push("contains_free_text");
    }

    const canInferWholeWorkoutDuration =
      lines.length === 1 &&
      duration.minutes === null &&
      params.plannedDurationMinutes !== null &&
      !flags.has("unsupported_nested_instructions") &&
      !flags.has("unsupported_then_clause") &&
      !flags.has("unsupported_finish_clause");

    const durationMinutes = canInferWholeWorkoutDuration
      ? params.plannedDurationMinutes
      : duration.minutes;

    if (canInferWholeWorkoutDuration) {
      extraFlags.push("duration_inferred_from_workout_total");
      flags.add("segment_duration_from_workout_total");
    }

    const draft = createSegmentDraft({
      label: labeled.label,
      rawText: line,
      durationMinutes,
      repeatCount: 1,
      repeatGroupId: null,
      labelType: labeled.mappedType,
      extraFlags
    });

    const safeToKeep =
      draft.segment_type !== "unknown" ||
      draft.duration_minutes !== null ||
      draft.targets.hr_bpm !== null ||
      draft.targets.pace_ranges.length > 0 ||
      lines.length === 1;

    if (
      draft.is_rest &&
      draft.duration_minutes === null &&
      isRestSegmentText(labeled.body) &&
      countMinuteDurations(labeled.body) === 0
    ) {
      continue;
    }

    if (!safeToKeep) {
      continue;
    }

    if (draft.data_quality_flags.includes("pace_target_unparsed")) {
      flags.add("segment_target_unparsed");
    }

    if (draft.data_quality_flags.includes("hr_target_unparsed")) {
      flags.add("segment_target_unparsed");
    }

    if (draft.data_quality_flags.includes("boundary_ambiguous")) {
      flags.add("ambiguous_segment_boundaries");
    }

    if (draft.is_rest) {
      flags.add("rest_segment_detected");
    }

    drafts.push(draft);
  }

  drafts.forEach((draft) => {
    if (draft.data_quality_flags.includes("pace_target_unparsed")) {
      flags.add("segment_target_unparsed");
    }
    if (draft.data_quality_flags.includes("hr_target_unparsed")) {
      flags.add("segment_target_unparsed");
    }
    if (draft.data_quality_flags.includes("duration_inferred_from_workout_total")) {
      flags.add("segment_duration_from_workout_total");
    }
    if (draft.is_rest) {
      flags.add("rest_segment_detected");
    }
  });

  const segments = drafts.map((draft, order) => ({
    order: order + 1,
    ...draft
  }));

  const durationSumComparable =
    params.plannedDurationMinutes !== null &&
    segments.length > 0 &&
    segments.every(
      (segment) => segment.is_rest || segment.duration_minutes !== null
    );
  if (durationSumComparable) {
    const summedMinutes = segments.reduce((total, segment) => {
      if (segment.is_rest || segment.duration_minutes === null) {
        return total;
      }

      return total + segment.duration_minutes * segment.repeat_count;
    }, 0);
    const delta = Math.abs(summedMinutes - params.plannedDurationMinutes);
    const threshold = Math.max(10, Math.round(params.plannedDurationMinutes * 0.2));
    if (delta >= threshold) {
      flags.add("segment_duration_sum_mismatch");
    }
  }

  let status: PlannedSegmentsParse["status"];
  if (segments.length === 0) {
    status = "unsupported";
  } else if (flags.size > 0) {
    flags.add("segments_partial");
    status = "partial";
  } else {
    status = "parsed";
  }

  const confidence: TargetConfidence | null =
    segments.length === 0
      ? null
      : segments.some((segment) => segment.confidence === "low")
        ? "low"
        : segments.some((segment) => segment.confidence === "medium")
          ? "medium"
          : flags.size > 0
            ? "medium"
            : "high";

  return {
    segments,
    segments_parse: {
      status,
      source: "workout_description",
      confidence,
      flags: [...flags]
    }
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

  const suppressWholeWorkoutPaceComparison = shouldSuppressWholeWorkoutPaceComparison(
    params.workout
  );
  const paceTarget = suppressWholeWorkoutPaceComparison
    ? null
    : params.workout.planned.targets.pace_min_per_km;
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
      whole_workout_pace_comparison_suppressed: suppressWholeWorkoutPaceComparison,
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

function createFitParser(force = false): FitParser {
  return new FitParser({
    mode: "list",
    lengthUnit: "m",
    speedUnit: "m/s",
    elapsedRecordField: true,
    force
  });
}

function isRecoverableFitParseError(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    trimFitErrorMessage(error).includes("Offset is outside the bounds of the DataView")
  );
}

async function parseFitWithFallback(
  fitBuffer: Buffer<ArrayBufferLike>
): Promise<ParsedFitWithFallback> {
  try {
    const parsedFit = await createFitParser(false).parseAsync(fitBuffer);
    return {
      parsed_fit: parsedFit as ParsedFitLike,
      fit_parse_mode: "strict",
      fit_parse_recovered: false,
      data_quality_flags: []
    };
  } catch (strictError: unknown) {
    if (!isRecoverableFitParseError(strictError)) {
      throw strictError;
    }

    const trimmedStrictError = trimFitErrorMessage(strictError);

    try {
      const parsedFit = await createFitParser(true).parseAsync(fitBuffer);
      return {
        parsed_fit: parsedFit as ParsedFitLike,
        fit_parse_mode: "force_fallback",
        fit_parse_recovered: true,
        fit_parse_strict_error: trimmedStrictError,
        data_quality_flags: ["fit_parse_force_fallback", "fit_parse_strict_failed"]
      };
    } catch {
      throw strictError;
    }
  }
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
  fitResult: ParsedFitWithFallback,
  sampledFile: WorkoutFileEntry
): FitDiagnostics {
  const parsedFit = fitResult.parsed_fit;
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
    ...(fitResult.fit_parse_recovered
      ? {
          fit_parse_mode: fitResult.fit_parse_mode,
          fit_parse_recovered: fitResult.fit_parse_recovered,
          fit_parse_strict_error: fitResult.fit_parse_strict_error,
          data_quality_flags: [...fitResult.data_quality_flags]
        }
      : {}),
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

function summarizeFitForMatching(
  fitResult: ParsedFitWithFallback,
  fitFile: WorkoutFileEntry
): FitSummary {
  const parsedFit = fitResult.parsed_fit;
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
    fit_parse_mode: fitResult.fit_parse_mode,
    fit_parse_recovered: fitResult.fit_parse_recovered,
    ...(fitResult.fit_parse_strict_error
      ? { fit_parse_strict_error: fitResult.fit_parse_strict_error }
      : {}),
    ...(fitResult.data_quality_flags.length > 0
      ? { data_quality_flags: [...fitResult.data_quality_flags] }
      : {}),
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

function createDefaultWorkoutSegmentAnalysis(workout: Pick<ParsedWorkout, "planned" | "completed">): WorkoutSegmentAnalysis {
  const hasPlannedSegments = workout.planned.segments.length > 0;
  return {
    available: false,
    reason: hasPlannedSegments ? "fit_not_matched" : "no_planned_segments",
    match_confidence: workout.completed.detail_source.match_confidence,
    planned_segments_count: workout.planned.segments.length,
    expanded_segments_count: 0,
    comparable_segments_count: 0,
    compared_segments_count: 0,
    data_quality_flags: []
  };
}

function buildUnsupportedSegmentComparisonEntry(
  segment: ExpandedPlannedSegment,
  flags: string[]
): SegmentComparisonEntry {
  const comparablePaceTarget = getComparablePaceTarget(segment.targets);

  return {
    order: segment.order,
    planned_segment_order: segment.planned_segment_order,
    repeat_iteration: segment.repeat_iteration,
    repeat_group_id: segment.repeat_group_id,
    segment_type: segment.segment_type,
    is_rest: segment.is_rest,
    label: segment.label,
    planned_duration_minutes: segment.duration_minutes,
    planned_targets: {
      pace_min_per_km: segment.targets.pace_min_per_km,
      pace_text: formatPaceTargetRange(comparablePaceTarget, "/км"),
      hr_bpm: segment.targets.hr_bpm
    },
    actual: {
      duration_minutes: null,
      distance_km: null,
      avg_pace_min_per_km: null,
      avg_pace_text: null,
      avg_hr: null,
      avg_cadence: null,
      avg_power: null
    },
    coverage: "unsupported",
    coverage_ratio: null,
    pace_vs_target: {
      status: "unknown",
      outside_by_min_per_km: null
    },
    hr_vs_target: {
      status: "unknown",
      outside_by_bpm: null
    },
    data_quality_flags: [...new Set([...segment.data_quality_flags, ...flags])]
  };
}

function shouldSuppressWholeWorkoutPaceComparison(
  workout: Pick<ParsedWorkout, "planned">
): boolean {
  const segments = workout.planned.segments;
  const hasRepeatOrIntervalStructure = segments.some(
    (segment) =>
      segment.repeat_count > 1 || segment.repeat_group_id !== null || segment.segment_type === "interval"
  );
  if (!hasRepeatOrIntervalStructure) {
    return false;
  }

  return segments.some((segment) => {
    const comparablePaceTarget = getComparablePaceTarget(segment.targets);
    if (comparablePaceTarget === null) {
      return false;
    }

    return (
      segment.repeat_count > 1 ||
      segment.repeat_group_id !== null ||
      segment.segment_type === "interval"
    );
  });
}

function getComparablePaceTarget(targets: PlannedSegmentTargets): PaceTarget | null {
  if (targets.pace_min_per_km !== null) {
    return targets.pace_min_per_km;
  }

  if (targets.pace_ranges.length === 1) {
    return {
      fast_min_per_km: targets.pace_ranges[0].fast_min_per_km,
      slow_min_per_km: targets.pace_ranges[0].slow_min_per_km
    };
  }

  return null;
}

function compareSegmentPaceAgainstTarget(
  actualPace: number | null,
  target: PaceTarget | null
): SegmentComparisonEntry["pace_vs_target"] {
  if (actualPace === null || target === null) {
    return {
      status: "unknown",
      outside_by_min_per_km: null
    };
  }

  if (actualPace < target.fast_min_per_km - PACE_DELTA_THRESHOLD_MINUTES) {
    return {
      status: "too_fast",
      outside_by_min_per_km: roundNumber(target.fast_min_per_km - actualPace, 2)
    };
  }

  if (actualPace > target.slow_min_per_km + PACE_DELTA_THRESHOLD_MINUTES) {
    return {
      status: "too_slow",
      outside_by_min_per_km: roundNumber(actualPace - target.slow_min_per_km, 2)
    };
  }

  return {
    status: "within",
    outside_by_min_per_km: 0
  };
}

function compareSegmentHrAgainstTarget(
  actualHr: number | null,
  target: HrbpmTarget | null
): SegmentComparisonEntry["hr_vs_target"] {
  if (actualHr === null || target === null) {
    return {
      status: "unknown",
      outside_by_bpm: null
    };
  }

  if (actualHr < target.min - HR_DELTA_THRESHOLD_BPM) {
    return {
      status: "below",
      outside_by_bpm: roundNumber(target.min - actualHr, 1)
    };
  }

  if (actualHr > target.max + HR_DELTA_THRESHOLD_BPM) {
    return {
      status: "above",
      outside_by_bpm: roundNumber(actualHr - target.max, 1)
    };
  }

  return {
    status: "within",
    outside_by_bpm: 0
  };
}

function normalizeTimerFitRecords(records: FitRecordLike[]): TimerFitRecord[] {
  const sortedRecords = records
    .flatMap((record) =>
      isFiniteNumber(record.timer_time)
        ? [
            {
              timer_time: record.timer_time,
              distance: isFiniteNumber(record.distance) ? record.distance : null,
              speed: isFiniteNumber(record.speed) ? record.speed : null,
              enhanced_speed: isFiniteNumber(record.enhanced_speed) ? record.enhanced_speed : null,
              heart_rate: isFiniteNumber(record.heart_rate) ? record.heart_rate : null,
              cadence: isFiniteNumber(record.cadence) ? record.cadence : null,
              power: isFiniteNumber(record.power) ? record.power : null
            } satisfies TimerFitRecord
          ]
        : []
    )
    .sort((left, right) => left.timer_time - right.timer_time);

  const normalized: TimerFitRecord[] = [];
  for (const record of sortedRecords) {
    const previous = normalized.at(-1);
    if (previous && previous.timer_time === record.timer_time) {
      normalized[normalized.length - 1] = {
        timer_time: record.timer_time,
        distance: record.distance ?? previous.distance,
        speed: record.speed ?? previous.speed,
        enhanced_speed: record.enhanced_speed ?? previous.enhanced_speed,
        heart_rate: record.heart_rate ?? previous.heart_rate,
        cadence: record.cadence ?? previous.cadence,
        power: record.power ?? previous.power
      };
      continue;
    }

    normalized.push(record);
  }

  return normalized;
}

function expandPlannedSegmentsForAnalysis(workout: ParsedWorkout): ExpandedSegmentsResult {
  const expandedSegments: ExpandedPlannedSegment[] = [];
  const flags = new Set<string>();
  let expandedOrder = 1;
  const canInferSingleSegmentDuration =
    workout.planned.segments.length === 1 && workout.planned.duration_minutes !== null;

  for (let index = 0; index < workout.planned.segments.length; index += 1) {
    const segment = workout.planned.segments[index];
    const repeatCount = segment.repeat_count;
    const repeatGroupId = segment.repeat_group_id;
    const segmentDurationMinutes =
      segment.duration_minutes === null && canInferSingleSegmentDuration
        ? workout.planned.duration_minutes
        : segment.duration_minutes;
    const segmentFlags =
      segment.duration_minutes === null && canInferSingleSegmentDuration
        ? [...segment.data_quality_flags, "duration_inferred_from_workout_total"]
        : [...segment.data_quality_flags];

    if (repeatCount <= 1 && repeatGroupId === null) {
      expandedSegments.push({
        order: expandedOrder,
        planned_segment_order: segment.order,
        repeat_iteration: null,
        repeat_group_id: null,
        segment_type: segment.segment_type,
        is_rest: segment.is_rest,
        label: segment.label,
        duration_minutes: segmentDurationMinutes,
        targets: segment.targets,
        data_quality_flags: segmentFlags
      });
      expandedOrder += 1;
      continue;
    }

    if (repeatCount <= 1 || !repeatGroupId) {
      return {
        expanded_segments: [],
        unsupported_repeats: true,
        data_quality_flags: ["repeat_group_structure_invalid"]
      };
    }

    const repeatGroupSegments = [segment];
    while (
      index + 1 < workout.planned.segments.length &&
      workout.planned.segments[index + 1].repeat_group_id === repeatGroupId
    ) {
      repeatGroupSegments.push(workout.planned.segments[index + 1]);
      index += 1;
    }

    const repeatCounts = new Set(repeatGroupSegments.map((entry) => entry.repeat_count));
    const groupIsAmbiguous =
      repeatCounts.size !== 1 ||
      workout.planned.segments_parse.flags.includes("repeat_block_partial") ||
      repeatGroupSegments.some(
        (entry) =>
          entry.duration_minutes === null ||
          entry.data_quality_flags.includes("duration_missing") ||
          entry.data_quality_flags.includes("boundary_ambiguous")
      );

    if (groupIsAmbiguous) {
      flags.add(`unsupported_repeat_group:${repeatGroupId}`);
      return {
        expanded_segments: [],
        unsupported_repeats: true,
        data_quality_flags: [...flags]
      };
    }

    for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
      for (const groupSegment of repeatGroupSegments) {
        expandedSegments.push({
          order: expandedOrder,
          planned_segment_order: groupSegment.order,
          repeat_iteration: iteration,
          repeat_group_id: repeatGroupId,
          segment_type: groupSegment.segment_type,
          is_rest: groupSegment.is_rest,
          label: groupSegment.label,
          duration_minutes: groupSegment.duration_minutes,
          targets: groupSegment.targets,
          data_quality_flags: [...groupSegment.data_quality_flags]
        });
        expandedOrder += 1;
      }
    }
  }

  return {
    expanded_segments: expandedSegments,
    unsupported_repeats: false,
    data_quality_flags: [...flags]
  };
}

function computeSliceMetrics(
  records: TimerFitRecord[],
  startSeconds: number,
  endSeconds: number
): SegmentSliceMetrics {
  let coverageSeconds = 0;
  let distanceMeters = 0;
  let hasDistance = false;
  let speedDistanceMeters = 0;
  let hasSpeedDistance = false;
  let weightedHr = 0;
  let hrSeconds = 0;
  let weightedCadence = 0;
  let cadenceSeconds = 0;
  let weightedPower = 0;
  let powerSeconds = 0;

  for (let index = 0; index < records.length - 1; index += 1) {
    const current = records[index];
    const next = records[index + 1];
    const deltaSeconds = next.timer_time - current.timer_time;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      continue;
    }

    const overlapStart = Math.max(startSeconds, current.timer_time);
    const overlapEnd = Math.min(endSeconds, next.timer_time);
    const overlapSeconds = overlapEnd - overlapStart;
    if (overlapSeconds <= 0) {
      continue;
    }

    coverageSeconds += overlapSeconds;
    const overlapRatio = overlapSeconds / deltaSeconds;

    if (current.distance !== null && next.distance !== null) {
      const deltaDistance = next.distance - current.distance;
      if (deltaDistance >= 0) {
        distanceMeters += deltaDistance * overlapRatio;
        hasDistance = true;
      }
    } else {
      const fallbackSpeed = current.enhanced_speed ?? current.speed;
      if (fallbackSpeed !== null && fallbackSpeed >= 0) {
        speedDistanceMeters += fallbackSpeed * overlapSeconds;
        hasSpeedDistance = true;
      }
    }

    if (current.heart_rate !== null) {
      weightedHr += current.heart_rate * overlapSeconds;
      hrSeconds += overlapSeconds;
    }

    if (current.cadence !== null) {
      weightedCadence += current.cadence * overlapSeconds;
      cadenceSeconds += overlapSeconds;
    }

    if (current.power !== null) {
      weightedPower += current.power * overlapSeconds;
      powerSeconds += overlapSeconds;
    }
  }

  return {
    coverage_seconds: roundNumber(coverageSeconds, 1),
    distance_m: hasDistance
      ? roundNumber(distanceMeters, 1)
      : hasSpeedDistance
        ? roundNumber(speedDistanceMeters, 1)
        : null,
    avg_hr: hrSeconds > 0 ? roundNumber(weightedHr / hrSeconds, 1) : null,
    avg_cadence: cadenceSeconds > 0 ? roundNumber(weightedCadence / cadenceSeconds, 1) : null,
    avg_power: powerSeconds > 0 ? roundNumber(weightedPower / powerSeconds, 1) : null
  };
}

function analyzeWorkoutSegmentComparisonFromFit(
  workout: ParsedWorkout,
  parsedFit: ParsedFitLike
): Pick<ParsedWorkout, "segment_analysis" | "segment_comparison"> {
  if (workout.planned.segments.length === 0) {
    return {
      segment_analysis: createDefaultWorkoutSegmentAnalysis(workout),
      segment_comparison: []
    };
  }

  const fitRecords = Array.isArray(parsedFit.records) ? parsedFit.records : [];
  const timerRecords = normalizeTimerFitRecords(fitRecords);
  if (timerRecords.length < 2) {
    return {
      segment_analysis: {
        available: false,
        reason: "timer_time_unavailable",
        match_confidence: workout.completed.detail_source.match_confidence,
        planned_segments_count: workout.planned.segments.length,
        expanded_segments_count: 0,
        comparable_segments_count: 0,
        compared_segments_count: 0,
        data_quality_flags: []
      },
      segment_comparison: []
    };
  }

  const expanded = expandPlannedSegmentsForAnalysis(workout);
  if (expanded.unsupported_repeats) {
    return {
      segment_analysis: {
        available: false,
        reason: "unsupported_repeats",
        match_confidence: workout.completed.detail_source.match_confidence,
        planned_segments_count: workout.planned.segments.length,
        expanded_segments_count: 0,
        comparable_segments_count: 0,
        compared_segments_count: 0,
        data_quality_flags: expanded.data_quality_flags
      },
      segment_comparison: []
    };
  }

  const segmentComparison: SegmentComparisonEntry[] = [];
  let comparableSegmentsCount = 0;
  let comparedSegmentsCount = 0;
  let cumulativeStartSeconds = 0;

  for (const segment of expanded.expanded_segments) {
    if (segment.duration_minutes === null) {
      segmentComparison.push(
        buildUnsupportedSegmentComparisonEntry(segment, ["duration_missing"])
      );
      continue;
    }

    comparableSegmentsCount += 1;
    const plannedDurationSeconds = segment.duration_minutes * 60;
    const sliceMetrics = computeSliceMetrics(
      timerRecords,
      cumulativeStartSeconds,
      cumulativeStartSeconds + plannedDurationSeconds
    );
    const coverageRatio =
      plannedDurationSeconds > 0
        ? roundNumber(sliceMetrics.coverage_seconds / plannedDurationSeconds, 3)
        : null;
    const coverage: SegmentCoverage =
      coverageRatio === null
        ? "unsupported"
        : coverageRatio >= SEGMENT_FULL_COVERAGE_THRESHOLD
          ? "full"
          : coverageRatio >= SEGMENT_PARTIAL_COVERAGE_THRESHOLD
            ? "partial"
            : "missing";
    const actualDurationMinutes =
      sliceMetrics.coverage_seconds > 0 ? roundNumber(sliceMetrics.coverage_seconds / 60, 2) : null;
    const actualDistanceKm =
      sliceMetrics.distance_m !== null && sliceMetrics.distance_m > 0
        ? roundNumber(sliceMetrics.distance_m / 1000, 2)
        : null;
    const actualPace = deriveAveragePaceMinPerKm(actualDistanceKm, actualDurationMinutes);
    const comparablePaceTarget = getComparablePaceTarget(segment.targets);
    const flags = [...segment.data_quality_flags];
    if (segment.targets.pace_min_per_km === null && segment.targets.pace_ranges.length > 1) {
      flags.push("pace_target_ambiguous");
    }
    if (sliceMetrics.distance_m === null) {
      flags.push("distance_unavailable");
    }
    if (coverage === "partial") {
      flags.push("partial_timer_coverage");
    }
    if (coverage === "missing") {
      flags.push("timer_coverage_missing");
    }
    if (coverage === "full" || coverage === "partial") {
      comparedSegmentsCount += 1;
    }

    segmentComparison.push({
      order: segment.order,
      planned_segment_order: segment.planned_segment_order,
      repeat_iteration: segment.repeat_iteration,
      repeat_group_id: segment.repeat_group_id,
      segment_type: segment.segment_type,
      is_rest: segment.is_rest,
      label: segment.label,
      planned_duration_minutes: segment.duration_minutes,
      planned_targets: {
        pace_min_per_km: segment.targets.pace_min_per_km,
        pace_text: formatPaceTargetRange(comparablePaceTarget, "/км"),
        hr_bpm: segment.targets.hr_bpm
      },
      actual: {
        duration_minutes: actualDurationMinutes,
        distance_km: actualDistanceKm,
        avg_pace_min_per_km: actualPace,
        avg_pace_text: formatPaceMinPerKm(actualPace, "/км"),
        avg_hr: sliceMetrics.avg_hr,
        avg_cadence: sliceMetrics.avg_cadence,
        avg_power: sliceMetrics.avg_power
      },
      coverage,
      coverage_ratio: coverageRatio,
      pace_vs_target: compareSegmentPaceAgainstTarget(actualPace, comparablePaceTarget),
      hr_vs_target: compareSegmentHrAgainstTarget(sliceMetrics.avg_hr, segment.targets.hr_bpm),
      data_quality_flags: [...new Set(flags)]
    });

    cumulativeStartSeconds += plannedDurationSeconds;
  }

  const analysisFlags = [...expanded.data_quality_flags];
  if (segmentComparison.some((segment) => segment.coverage === "unsupported")) {
    analysisFlags.push("contains_unsupported_segments");
  }
  if (segmentComparison.some((segment) => segment.coverage === "partial")) {
    analysisFlags.push("contains_partial_segments");
  }
  if (segmentComparison.some((segment) => segment.coverage === "missing")) {
    analysisFlags.push("contains_missing_segments");
  }

  if (comparableSegmentsCount === 0) {
    return {
      segment_analysis: {
        available: false,
        reason: "unsupported_segments",
        match_confidence: workout.completed.detail_source.match_confidence,
        planned_segments_count: workout.planned.segments.length,
        expanded_segments_count: expanded.expanded_segments.length,
        comparable_segments_count: 0,
        compared_segments_count: 0,
        data_quality_flags: [...new Set(analysisFlags)]
      },
      segment_comparison: segmentComparison
    };
  }

  const lastTimerTime = timerRecords.at(-1)?.timer_time ?? null;
  const extraAfterPlanSeconds =
    lastTimerTime !== null ? Math.max(0, roundNumber(lastTimerTime - cumulativeStartSeconds, 1)) : 0;
  if (extraAfterPlanSeconds > 0) {
    analysisFlags.push("extra_activity_after_planned_segments");
  }

  return {
    segment_analysis: {
      available: true,
      reason: "computed",
      axis: "timer_time",
      match_confidence: workout.completed.detail_source.match_confidence,
      planned_segments_count: workout.planned.segments.length,
      expanded_segments_count: expanded.expanded_segments.length,
      comparable_segments_count: comparableSegmentsCount,
      compared_segments_count: comparedSegmentsCount,
      extra_after_plan_seconds: extraAfterPlanSeconds,
      data_quality_flags: [...new Set(analysisFlags)]
    },
    segment_comparison: segmentComparison
  };
}

function buildWorkoutFileEntryFromDetailSource(detailSource: CompletedDetailSource): WorkoutFileEntry | null {
  if (!detailSource.zip_path || !detailSource.entry_name) {
    return null;
  }

  const entryName = detailSource.entry_name;
  const format = entryName.toLowerCase().endsWith(".fit.gz") ? "fit.gz" : "fit";
  return {
    zip_path: detailSource.zip_path,
    entry_name: entryName,
    format,
    compressed: format === "fit.gz"
  };
}

async function buildWorkoutSegmentComparisons(workouts: ParsedWorkout[]): Promise<ParsedWorkout[]> {
  const fitCache = new Map<string, Promise<ParsedFitWithFallback>>();

  const getParsedFit = async (
    detailSource: CompletedDetailSource
  ): Promise<ParsedFitWithFallback> => {
    const entry = buildWorkoutFileEntryFromDetailSource(detailSource);
    if (!entry) {
      throw new Error("matched FIT source is incomplete");
    }

    const cacheKey = `${entry.zip_path}::${entry.entry_name}`;
    if (!fitCache.has(cacheKey)) {
      fitCache.set(
        cacheKey,
        (async () => {
          const fitBuffer = await readWorkoutFileEntryBuffer(entry);
          return await parseFitWithFallback(fitBuffer);
        })()
      );
    }

    return await fitCache.get(cacheKey)!;
  };

  for (const workout of workouts) {
    workout.segment_analysis = createDefaultWorkoutSegmentAnalysis(workout);
    workout.segment_comparison = [];

    if (workout.planned.segments.length === 0) {
      continue;
    }

    if (workout.completed.detail_source.match_status !== "matched") {
      workout.segment_analysis = {
        ...workout.segment_analysis,
        match_confidence: workout.completed.detail_source.match_confidence
      };
      continue;
    }

    try {
      const fitResult = await getParsedFit(workout.completed.detail_source);
      const segmentResult = analyzeWorkoutSegmentComparisonFromFit(workout, fitResult.parsed_fit);
      const fitQualityFlags = [
        ...new Set([
          ...(workout.completed.detail_source.data_quality_flags ?? []),
          ...fitResult.data_quality_flags
        ])
      ];
      workout.segment_analysis = {
        ...segmentResult.segment_analysis,
        data_quality_flags: [
          ...new Set([...(segmentResult.segment_analysis.data_quality_flags ?? []), ...fitQualityFlags])
        ]
      };
      workout.segment_comparison = segmentResult.segment_comparison;
    } catch (error: unknown) {
      workout.segment_analysis = {
        available: false,
        reason: "fit_parse_failed",
        match_confidence: workout.completed.detail_source.match_confidence,
        planned_segments_count: workout.planned.segments.length,
        expanded_segments_count: 0,
        comparable_segments_count: 0,
        compared_segments_count: 0,
        data_quality_flags: [`fit_parse_failed:${trimFitErrorMessage(error)}`]
      };
      workout.segment_comparison = [];
    }
  }

  return workouts;
}

function buildWeeklySegmentAnalysis(
  workouts: ParsedWorkout[],
  workoutFilesSource: WorkoutFilesSource
): WeeklySegmentAnalysis {
  const workoutsWithPlannedSegments = workouts.filter((workout) => workout.planned.segments.length > 0);
  const workoutsWithMatchedFit = workoutsWithPlannedSegments.filter(
    (workout) => workout.completed.detail_source.match_status === "matched"
  );
  const workoutsAnalyzed = workoutsWithPlannedSegments.filter(
    (workout) => workout.segment_analysis.available && workout.segment_analysis.reason === "computed"
  );
  const workoutsPartial = workoutsAnalyzed.filter(
    (workout) =>
      workout.segment_comparison.some(
        (segment) => segment.coverage === "partial" || segment.coverage === "missing"
      ) ||
      (workout.segment_analysis.extra_after_plan_seconds ?? 0) > 0 ||
      (workout.segment_analysis.compared_segments_count ?? 0) <
        (workout.segment_analysis.comparable_segments_count ?? 0)
  );
  const workoutsUnsupported = workoutsWithPlannedSegments.filter(
    (workout) =>
      !workout.segment_analysis.available ||
      workout.segment_comparison.some((segment) => segment.coverage === "unsupported")
  );

  let reason: WeeklySegmentAnalysis["reason"] = "not_computed";
  let available = false;
  if (!workoutFilesSource.present) {
    reason = "no_workout_files";
  } else if (workoutsWithMatchedFit.length === 0) {
    reason = "no_matches";
  } else if (workoutsAnalyzed.length > 0) {
    reason = "computed";
    available = true;
  }

  return {
    available,
    reason,
    workouts_with_planned_segments: workoutsWithPlannedSegments.length,
    workouts_with_matched_fit: workoutsWithMatchedFit.length,
    workouts_analyzed: workoutsAnalyzed.length,
    workouts_partial: workoutsPartial.length,
    workouts_unsupported: workoutsUnsupported.length
  };
}

async function parseFitDiagnosticsSample(workoutFilesSource: WorkoutFilesSource): Promise<FitDiagnostics> {
  const sampledFile =
    workoutFilesSource.files.find((file) => file.format === "fit.gz") ?? workoutFilesSource.files[0];

  if (!sampledFile) {
    return buildNotAvailableFitDiagnostics();
  }

  try {
    const fitBuffer = await readWorkoutFileEntryBuffer(sampledFile);
    const fitResult = await parseFitWithFallback(fitBuffer);
    return summarizeParsedFit(fitResult, sampledFile);
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
      const fitResult = await parseFitWithFallback(fitBuffer);
      fitSummaries.push(summarizeFitForMatching(fitResult, fitFile));
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
    const parsedSegments = parsePlannedSegments({
      description,
      plannedDurationMinutes
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
        targets: parsedTargetsMeta.targets,
        segments: parsedSegments.segments,
        segments_parse: parsedSegments.segments_parse
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
          whole_workout_pace_comparison_suppressed: false,
          no_athlete_comment: false,
          no_completion_status_column: false,
          unclear_classification: false
        }
      },
      segment_analysis: {
        available: false,
        reason: parsedSegments.segments.length > 0 ? "fit_not_matched" : "no_planned_segments",
        match_confidence: "none",
        planned_segments_count: parsedSegments.segments.length,
        expanded_segments_count: 0,
        comparable_segments_count: 0,
        compared_segments_count: 0,
        data_quality_flags: []
      },
      segment_comparison: [],
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
    reasons: candidate.reasons,
    ...(fitSummary.data_quality_flags?.length
      ? { data_quality_flags: [...fitSummary.data_quality_flags] }
      : {})
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
    reasons: candidate.reasons,
    ...(fitSummary.data_quality_flags?.length
      ? { data_quality_flags: [...fitSummary.data_quality_flags] }
      : {})
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

    const workoutsWithFitMatches = buildWorkoutFitDetailSources(
      parsedFiles.flatMap((entry) => entry.workouts),
      workoutFilesSource.fit_summaries
    );
    const workouts = await buildWorkoutSegmentComparisons(workoutsWithFitMatches);
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
      segment_analysis: buildWeeklySegmentAnalysis(workouts, workoutFilesSource),
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

export { expandPlannedSegmentsForAnalysis, parsePlannedSegments };

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  });
}
