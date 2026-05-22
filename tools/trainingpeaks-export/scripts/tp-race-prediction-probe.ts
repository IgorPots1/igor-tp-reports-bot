import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";

import FitParser from "fit-file-parser";
import unzipper from "unzipper";

import {
  defaultAnalysisWeeksForDistance,
  loadEPredictorConstants,
  type ConfidenceBand,
} from "./lib/e-predictor-constants.ts";
import {
  computeTrainingImpliedHalfAnchor,
  isStrongHalfRaceAnchor,
  type TrainingImpliedHalfAnchor,
} from "./lib/e-predictor-training-implied-half.ts";
import { parsedRoot, toolRoot } from "./lib/paths.ts";
import {
  DISTANCE_PRESETS,
  formatDurationFromSeconds,
  formatDurationText,
  formatPaceText,
  isDistanceKey,
  paceMinPerKmToSeconds,
  parseDurationToSeconds,
  type DistanceKey,
} from "./lib/race-distance.ts";
import { readStudentsConfig, type StudentConfig } from "./lib/students.ts";
import {
  buildVdotStyleCheck,
  formatVdotStyleCheckMarkdown,
  type VdotStyleCheck,
} from "./lib/vdot-style/check-report.ts";

const gunzip = promisify(gunzipCallback);

const PROBE_STALE_DAYS = 14;

type ConfidenceLevel = "high" | "medium" | "low";

type WeeksCliValue = number | "auto";

type CliArgs = {
  student: string | null;
  athleteId: number | null;
  athleteUrl: string | null;
  raceDate: string;
  distance: DistanceKey;
  weeks: WeeksCliValue;
  from: string | null;
  to: string | null;
  raceName: string | null;
  targetTime: string | null;
  noAi: boolean;
  includeReviewAnchors: boolean;
  segmentAudit: boolean;
  segmentAuditJson: boolean;
};

type ResolvedTarget = {
  athleteId: number;
  athleteUrl: string;
  studentId: string;
  studentName: string;
};

type WeekRange = { from: string; to: string };

type WorkoutSegmentAnalysisAudit = {
  available?: boolean;
  reason?: string;
  match_confidence?: string;
  planned_segments_count?: number;
  expanded_segments_count?: number;
  comparable_segments_count?: number;
  compared_segments_count?: number;
  extra_after_plan_seconds?: number;
  data_quality_flags?: string[];
};

type SegmentPaceTargetAudit = {
  fast_min_per_km: number;
  slow_min_per_km: number;
};

type SegmentComparisonEntryAudit = {
  order?: number;
  planned_segment_order?: number;
  segment_type?: string;
  is_rest?: boolean;
  coverage?: string;
  coverage_ratio?: number | null;
  planned_duration_minutes?: number | null;
  repeat_iteration?: number | null;
  repeat_group_id?: string | null;
  planned_targets?: {
    pace_min_per_km?: SegmentPaceTargetAudit | null;
    pace_text?: string | null;
  };
  actual?: {
    duration_minutes?: number | null;
    distance_km?: number | null;
    avg_pace_min_per_km?: number | null;
    avg_pace_text?: string | null;
    avg_hr?: number | null;
  };
  pace_vs_target?: {
    status?: string;
    outside_by_min_per_km?: number | null;
  };
  data_quality_flags?: string[];
};

type PlannedSegmentSummary = {
  segment_type?: string;
  is_rest?: boolean;
  repeat_count?: number;
  repeat_group_id?: string | null;
  duration_minutes?: number | null;
  label?: string | null;
};

type SegmentKeyWorkoutEvidenceType = "segment_comparison" | "repeat_group_inferred" | "unavailable";

type SegmentKeyWorkoutVerdict = "positive" | "neutral" | "warning" | "unavailable";

type SegmentMatchingDiagnosticSeverity = "info" | "warning" | "critical";

type SegmentMatchingDiagnostic = {
  code: string;
  severity: SegmentMatchingDiagnosticSeverity;
  detail: string;
};

type SegmentMatchingOriginalTimerSliceComparison = {
  work_avg_pace: string | null;
  recovery_avg_pace: string | null;
  work_avg_hr: number | null;
  recovery_avg_hr: number | null;
  work_segments_count: number;
  recovery_segments_count: number;
  differs_from_selected: boolean;
};

type TargetProximityRescueRow = {
  order: number | null;
  segment_type: string | null;
  repeat_iteration: number | null;
  coverage: string | null;
  pace: string | null;
  avg_hr: number | null;
  duration_seconds: number | null;
  reason: string;
};

type TargetProximityRescueCandidate = {
  available: boolean;
  shadow_mode: true;
  prediction_eligible: false;
  confidence: "medium" | "low" | "none";
  reason: string;
  planned_work_target_pace_range: string | null;
  selected_segments_count: number;
  expected_work_reps_count: number | null;
  candidate_work_avg_pace: string | null;
  candidate_work_pace_range: string | null;
  candidate_work_avg_hr: number | null;
  selected_rows: TargetProximityRescueRow[];
  rejected_reason?: string;
};

type FitLapSelectedLap = {
  lap_index: number;
  lap_indices: number[];
  duration_seconds: number;
  distance_meters: number | null;
  pace: string | null;
  avg_hr: number | null;
  lap_trigger: string | null;
  reason: string;
};

type FitLapCandidate = {
  available: boolean;
  shadow_mode: boolean;
  prediction_eligible: boolean;
  confidence: "high" | "medium" | "low" | "none";
  strategy: "fit_lap_exact" | "fit_lap_fuzzy";
  selected_laps_count: number;
  expected_work_reps_count: number | null;
  candidate_work_avg_pace: string | null;
  candidate_work_pace_range: string | null;
  candidate_work_avg_hr: number | null;
  selected_laps: FitLapSelectedLap[];
  diagnostics: string[];
  rejected_reason?: string;
};

type SegmentMatchingDiagnostics = {
  strategy: "timer_slice";
  confidence: "low" | "medium";
  prediction_eligible: boolean;
  diagnostics: SegmentMatchingDiagnostic[];
  warnings: string[];
  original_timer_slice_comparison: SegmentMatchingOriginalTimerSliceComparison;
  target_proximity_rescue_candidate?: TargetProximityRescueCandidate;
  fit_lap_candidate?: FitLapCandidate;
};

type SegmentKeyWorkoutExtractionStrategy = "fit_lap_exact" | "fit_lap_fuzzy" | "timer_slice";

type SegmentKeyWorkoutEvidenceSource =
  | "fit_lap_candidate"
  | "segment_comparison"
  | "repeat_group_inferred";

type SegmentKeyWorkout = {
  date: string;
  title: string | null;
  role: string;
  segment_evidence_available: boolean;
  usable_for_prediction: boolean;
  evidence_type: SegmentKeyWorkoutEvidenceType;
  extraction_strategy?: SegmentKeyWorkoutExtractionStrategy;
  evidence_source?: SegmentKeyWorkoutEvidenceSource;
  original_timer_slice_work_avg_pace?: string | null;
  work_reps_compared: number | null;
  work_reps_planned: number | null;
  work_avg_pace: string | null;
  work_fastest_pace: string | null;
  work_slowest_pace: string | null;
  work_avg_hr: number | null;
  work_max_hr: number | null;
  rep_to_rep_fade_pct: number | null;
  last_rep_vs_first_rep_pct: number | null;
  completion_ratio: number | null;
  verdict: SegmentKeyWorkoutVerdict;
  takeaway: string;
  limitations: string[];
  segment_matching?: SegmentMatchingDiagnostics;
};

const PACE_SPREAD_WARNING_PCT = 18;
const WORK_RECOVERY_HR_INVERSION_BPM = 5;
const HIGH_WORK_PACE_CV_PCT = 8;
const WORK_TARGET_RECOVERY_PROXIMITY_MIN_PER_KM = 0.12;
const RESCUE_EXCLUDED_SEGMENT_TYPES = new Set(["warmup", "cooldown", "rest"]);
const RESCUE_MIN_DURATION_MINUTES = 3;
const RESCUE_MISALIGNED_RECOVERY_MIN_DURATION_MINUTES = 2;
const RESCUE_MIN_DURATION_RATIO_OF_REP = 0.55;
const RESCUE_TARGET_NEAR_BAND_MIN_PER_KM = 0.18;
const RESCUE_MEDIUM_REP_RATIO = 0.6;
const RESCUE_HR_SUPPORT_MARGIN_BPM = 2;
const FIT_LAP_RECOVERY_MAX_DURATION_S = 150;
const FIT_LAP_RECOVERY_PACE_BUFFER_MIN_PER_KM = 0.35;
const FIT_LAP_WORK_DURATION_TOLERANCE_RATIO = 0.18;
const FIT_LAP_MERGE_MAX_SECOND_LAP_S = 120;
const FIT_LAP_MIN_DISTANCE_LAP_S = 250;
const FIT_LAP_WARMUP_PACE_BUFFER_MIN_PER_KM = 0.75;
const FIT_LAP_MEDIUM_REP_RATIO = 0.8;
const FIT_LAP_HIGH_REP_RATIO = 0.95;
const FIT_LAP_PROMOTION_REP_RATIO = 0.75;
const FIT_LAP_PROMOTION_DIAGNOSTIC_NOTE =
  "Timer-slice work pace was rejected due to misalignment; FIT-lap candidate used as segment evidence.";
const SERIOUS_FIT_LAP_REJECTION_REASONS = new Set([
  "lap_records_not_available_in_parsed_data",
  "no_planned_work_target",
  "no_fit_lap_work_groups",
]);
const FIT_LAP_FIELD_PATHS = [
  "workouts[].completed.detail_source.zip_path",
  "workouts[].completed.detail_source.entry_name",
  "fit.parsed.laps[].total_timer_time",
  "fit.parsed.laps[].total_elapsed_time",
  "fit.parsed.laps[].total_distance",
  "fit.parsed.laps[].avg_heart_rate",
  "fit.parsed.laps[].avg_speed",
  "fit.parsed.laps[].enhanced_avg_speed",
  "fit.parsed.laps[].lap_trigger",
  "fit.parsed.laps[].event",
  "fit.parsed.laps[].event_type",
];
const SLOW_SEGMENT_VS_FASTEST_PCT = 25;
const WORK_AVG_SLOWER_THAN_WHOLE_WORKOUT_PCT = 8;
const CRITICAL_SEGMENT_DATA_QUALITY_FLAGS = new Set(["contains_missing_segments"]);

type WeeklySummaryWorkout = {
  date: string | null;
  title: string | null;
  sport: string | null;
  distance_km: number | null;
  completed_duration_minutes: number | null;
  avg_pace_min_per_km: number | null;
  avg_pace_text: string | null;
  intensity_flags: string[];
  data_warnings: string[];
  classification: {
    type: string;
    is_planned: boolean;
    is_completed: boolean;
    is_skipped: boolean;
  };
  planned: {
    description: string | null;
    coach_comments: string | null;
    segments?: unknown[];
  };
  completed: {
    detail_source: {
      type: string;
      match_status: string;
      match_confidence?: string;
      zip_path?: string;
      entry_name?: string;
    };
  };
  segment_analysis?: WorkoutSegmentAnalysisAudit;
  segment_comparison?: SegmentComparisonEntryAudit[];
};

type KeyWorkoutRole = "tempo_threshold" | "intervals" | "race_pace_like" | "long_run";

type RawKeyWorkoutCapture = {
  date: string;
  title: string | null;
  role: KeyWorkoutRole;
  week: WeekRange;
  workout: WeeklySummaryWorkout;
};

type SegmentAuditVerdict =
  | "usable"
  | "plan_only_no_actual_segments"
  | "no_segment_data"
  | "ambiguous";

type SegmentAuditReport = {
  enabled: true;
  summary: {
    key_workouts_count: number;
    segment_analysis_available_count: number;
    segment_comparison_available_count: number;
    interval_key_workouts_count: number;
    interval_key_workouts_with_segments_count: number;
    fit_or_workout_files_coverage_hint: string;
  };
  workouts: Array<{
    date: string;
    title: string | null;
    role: KeyWorkoutRole;
    completed: {
      distance_km: number | null;
      duration_text: string | null;
      pace_text: string | null;
    };
    has_segment_analysis: boolean;
    has_segment_comparison: boolean;
    segment_analysis: {
      available: boolean;
      reason: string | null;
      planned_segments_count: number;
      expanded_segments_count: number;
      comparable_segments_count: number;
      compared_segments_count: number;
      data_quality_flags: string[];
    };
    expanded_segments_count: number;
    compared_segments_count: number;
    segment_shape_summary: {
      segment_types: string[];
      coverage_counts: Record<string, number>;
      sample_keys: string[];
    };
    fit_detail_source: {
      type: string | null;
      match_status: string | null;
      match_confidence: string | null;
    };
    verdict: SegmentAuditVerdict;
    reason: string;
    raw_shape?: Record<string, unknown>;
  }>;
  recommendation: "segment_aware_ready" | "needs_fit_or_parser";
  recommendation_note: string;
};

type WeeklySummary = {
  schema_version: string;
  student_id: string;
  week: WeekRange;
  segment_analysis?: {
    available: boolean;
    reason: string;
    workouts_with_matched_fit: number;
  };
  totals: {
    completed_workouts_count: number;
    total_distance_km: number | null;
  };
  week_metrics: {
    plan_vs_fact: { completion_rate: number | null };
    counts: {
      planned_completed: number;
      planned_skipped: number;
      extra_completed: number;
    };
    data_quality: { warnings: string[] };
  };
  workouts: WeeklySummaryWorkout[];
};

type RaceResultCandidate = {
  workoutId: number;
  date: string;
  title: string | null;
  distance_bucket: DistanceKey;
  distance_km: number;
  duration_min: number;
  duration_text: string;
  pace_min_per_km: number;
  pace_text: string;
  display_class?: string;
  result_status?: string;
  data_quality_status?: string;
  warnings?: string[];
  same_day_event?: boolean;
  event_name?: string | null;
};

type RaceResultsProbeReport = {
  run_at: string;
  athlete: {
    athlete_id: number;
    student_id: string | null;
    student_name: string | null;
  };
  distance_results: Partial<
    Record<
      DistanceKey,
      {
        official_best: RaceResultCandidate | null;
        official_flagged: RaceResultCandidate | null;
        probable_best: RaceResultCandidate | null;
        clean_training_best: RaceResultCandidate | null;
        candidates: RaceResultCandidate[];
      }
    >
  >;
  manual_review_candidates?: Array<{
    distance_bucket: DistanceKey;
    date: string;
    workoutId: number;
    display_class?: string;
    result_status?: string;
    data_quality_status?: string;
    pace_text: string;
    duration_text: string;
    title: string | null;
  }>;
};

type ProgressEvidenceReport = {
  run_at: string;
  easy_run_progress: {
    status: string;
    confidence: ConfidenceLevel;
    interpretation: string;
    summary: string;
    delta: { pace_change_sec_per_km: number | null; hr_change_bpm: number | null } | null;
  };
  long_run_progress: {
    status: string;
    confidence: ConfidenceLevel;
    interpretation: string;
    summary: string;
    delta: { pace_change_sec_per_km: number | null } | null;
  };
  limitations: string[];
};

type AnchorKind =
  | "official_best"
  | "official_flagged"
  | "probable_best"
  | "clean_training_best"
  | "needs_coach_review";

type SelectedAnchor = {
  kind: AnchorKind;
  candidate: RaceResultCandidate;
  confidence_weight: number;
};

type PredictionScenario = {
  time_text: string;
  pace_text: string;
  seconds: number;
};

type ReadinessScores = {
  anchor_quality_score: number;
  interval_specificity_score: number;
  threshold_readiness_score: number;
  endurance_score: number;
  consistency_score: number;
  taper_score: number;
  data_quality_score: number;
  overall_confidence_score: number;
  confidence: ConfidenceLevel;
  notes: string[];
};

type RacePredictionReport = {
  schema_version: "race-prediction.v1";
  run_at: string;
  athlete: {
    student_id: string;
    student_name: string;
    athlete_id: number;
  };
  race: {
    date: string;
    distance: DistanceKey;
    distance_km: number;
    name: string | null;
    days_until_race: number;
  };
  window: {
    from: string;
    to: string;
    weeks_requested: number;
    weeks_found: number;
    weeks_missing: number;
    weeks_mode: "auto" | "manual";
    default_weeks_for_distance: number;
  };
  data_sources: {
    weekly_summaries: Array<{ from: string; to: string; path: string | null; found: boolean }>;
    race_results_probe: { path: string | null; run_at: string | null; stale: boolean };
    progress_evidence_probe: { path: string | null; run_at: string | null; stale: boolean };
    fit_weeks_count: number;
    workout_files_present_weeks: number;
  };
  features: {
    weekly_volume: Array<{ week: WeekRange; running_km: number | null; completed_workouts: number }>;
    long_runs: Array<{
      date: string;
      title: string | null;
      distance_km: number;
      duration_text: string;
      pace_text: string;
      week: WeekRange;
    }>;
    key_workouts: Array<{
      category: "tempo_threshold" | "intervals" | "race_pace_like" | "long_run";
      date: string;
      title: string | null;
      distance_km: number | null;
      duration_text: string | null;
      pace_text: string | null;
      week: WeekRange;
    }>;
    missed_workouts_count: number;
    taper: {
      last_days: number;
      recent_km: number | null;
      prior_3w_median_km: number | null;
      ratio: number | null;
      signal: "taper_detected" | "flat" | "volume_spike" | "insufficient_data";
    };
    data_quality: {
      warnings: string[];
      suspicious_weeks: number;
      fit_coverage_weeks: number;
    };
  };
  anchors: {
    target_distance: {
      primary: SelectedAnchor | null;
      alternates: SelectedAnchor[];
      excluded_for_review: SelectedAnchor[];
    };
    cross_distance: SelectedAnchor[];
  };
  training_implied_anchor?: TrainingImpliedHalfAnchor;
  readiness_scores: ReadinessScores;
  prediction: {
    conservative: PredictionScenario;
    likely: PredictionScenario;
    optimistic: PredictionScenario;
    confidence: ConfidenceLevel;
    confidence_score: number;
    confidence_reasons: string[];
    method: "deterministic_v2_segment_aware" | "deterministic_v3_training_implied_half";
    anchor_tier_used?: "race_anchor" | "training_implied";
    target_time_hint_used: boolean;
    anchor_implied_time: PredictionScenario | null;
    segment_adjustment_seconds: number;
    risk_adjustment_seconds: number;
    range_model_notes: string[];
    insufficient_data?: boolean;
  };
  limitations: string[];
  classification_diagnostics?: string[];
  output_paths: {
    report_json: string;
    report_md: string;
  };
  segment_audit?: SegmentAuditReport;
  segment_key_workouts?: SegmentKeyWorkout[];
  vdot_style_check: VdotStyleCheck;
};

const TEMPO_PATTERN =
  /\b(tempo|threshold|порог|темпов|темповая|темповый|темповой|lactate|lt\b|critical power)\b/i;
const INTERVAL_KEYWORD_PATTERN =
  /\b(interval|intervals|интерв|повтор|repeats?|fartlek|фартлек|vo2|ускорен|track)\b/i;
const INTERVAL_REPEAT_WITH_UNITS_PATTERN =
  /\d+\s*[x×хX]\s*\d+\s*(?:мин|min|сек|sec|(?:м|m)(?:\/|\b|\s)|(?:km|км)\b)/i;
const EASY_TITLE_PATTERN =
  /(?:^|\b)(?:легкий\s+бег|лёгкий\s+бег|easy\s+run|\beasy\b|\brecovery\b|восстановительн(?:ый|ая|ое|ые)?)(?:\b|$)/i;
const RACE_PACE_PATTERN =
  /\b(race pace|goal pace|целевой темп|темп старта|темп гонки|marathon pace|half marathon pace|10k pace|5k pace)\b/i;
const LONG_RUN_PATTERN = /\b(long run|long\b|длительн|длинн|lsd|продолжительн)\b/i;
const RUNNING_SPORT_PATTERN = /\b(run|running|бег|jog)\b/i;
const NON_WORK_SEGMENT_TYPES = new Set(["recovery", "rest", "warmup", "cooldown"]);
const INTERVAL_TITLE_PATTERN =
  /(\d+)\s*[x×хX]\s*(\d+)\s*(?:мин|min|сек|sec|(?:м|m)(?:\/|\b|\s)|(?:km|км)\b)/i;

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function getWeekStartMonday(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(isoDate, diff);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
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

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    student: null,
    athleteId: null,
    athleteUrl: null,
    raceDate: "",
    distance: "10k",
    weeks: "auto",
    from: null,
    to: null,
    raceName: null,
    targetTime: null,
    noAi: true,
    includeReviewAnchors: false,
    segmentAudit: false,
    segmentAuditJson: false,
  };

  let targetCount = 0;

  for (const arg of argv) {
    if (arg.startsWith("--student=")) {
      parsed.student = arg.slice("--student=".length).trim();
      targetCount += 1;
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
    if (arg.startsWith("--race-date=")) {
      parsed.raceDate = arg.slice("--race-date=".length).trim();
      continue;
    }
    if (arg.startsWith("--distance=")) {
      const distance = arg.slice("--distance=".length).trim().toLowerCase();
      if (!isDistanceKey(distance)) {
        throw new Error(`Unknown --distance "${distance}". Supported: 5k, 10k, half, marathon`);
      }
      parsed.distance = distance;
      continue;
    }
    if (arg.startsWith("--weeks=")) {
      const rawWeeks = arg.slice("--weeks=".length).trim().toLowerCase();
      if (rawWeeks === "auto") {
        parsed.weeks = "auto";
      } else {
        const weeks = Number(rawWeeks);
        if (!Number.isInteger(weeks) || weeks <= 0) {
          throw new Error(`Invalid --weeks value: ${arg} (use a positive integer or auto)`);
        }
        parsed.weeks = weeks;
      }
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
    if (arg.startsWith("--race-name=")) {
      parsed.raceName = arg.slice("--race-name=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--target-time=")) {
      parsed.targetTime = arg.slice("--target-time=".length).trim() || null;
      continue;
    }
    if (arg === "--no-ai") {
      parsed.noAi = true;
      continue;
    }
    if (arg === "--ai") {
      parsed.noAi = false;
      continue;
    }
    if (arg === "--include-review-anchors") {
      parsed.includeReviewAnchors = true;
      continue;
    }
    if (arg === "--segment-audit") {
      parsed.segmentAudit = true;
      continue;
    }
    if (arg === "--segment-audit-json") {
      parsed.segmentAudit = true;
      parsed.segmentAuditJson = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (targetCount === 0) {
    throw new Error("Exactly one target is required: --student or --athlete-id (or --athlete-url).");
  }
  if (targetCount > 1) {
    throw new Error("Ambiguous target: provide only one of --student, --athlete-id, or --athlete-url.");
  }
  if (!isIsoDate(parsed.raceDate)) {
    throw new Error(`Missing or invalid --race-date: "${parsed.raceDate}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from && !isIsoDate(parsed.from)) {
    throw new Error(`Invalid --from date: "${parsed.from}".`);
  }
  if (parsed.to && !isIsoDate(parsed.to)) {
    throw new Error(`Invalid --to date: "${parsed.to}".`);
  }
  if (parsed.from && parsed.to && parsed.from > parsed.to) {
    throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }
  if (parsed.noAi === false) {
    throw new Error("AI mode is not implemented in Phase 1. Use --no-ai (default).");
  }

  return parsed;
}

function resolveTarget(args: CliArgs, students: StudentConfig[]): ResolvedTarget {
  const studentNeedle = args.student?.trim().toLowerCase() ?? null;
  const athleteIdFromUrl = args.athleteUrl ? parseAthleteIdFromUrl(args.athleteUrl) : null;
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl;
  const normalizedAthleteUrl = args.athleteUrl ? normalizeUrl(args.athleteUrl) : null;

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
    throw new Error(`Multiple students matched target. Matches: ${sample.join(", ")}`);
  }

  const matched = matchedStudents[0] ?? null;
  const athleteId = resolvedAthleteId ?? (matched ? parseAthleteIdFromUrl(matched.trainingpeaks_athlete_url) : null);
  if (!athleteId) {
    throw new Error("Could not resolve TrainingPeaks athlete id from target arguments.");
  }

  return {
    athleteId,
    athleteUrl: args.athleteUrl ?? matched?.trainingpeaks_athlete_url ?? "",
    studentId: matched?.student_id ?? args.student ?? `athlete-${athleteId}`,
    studentName: matched?.name ?? matched?.student_id ?? args.student ?? String(athleteId),
  };
}

function resolveAnalysisWeeks(distance: DistanceKey, weeksCli: WeeksCliValue): {
  weeks: number;
  weeksMode: "auto" | "manual";
  defaultWeeksForDistance: number;
} {
  const defaultWeeksForDistance = defaultAnalysisWeeksForDistance(distance);
  if (weeksCli === "auto") {
    return {
      weeks: defaultWeeksForDistance,
      weeksMode: "auto",
      defaultWeeksForDistance,
    };
  }
  return {
    weeks: weeksCli,
    weeksMode: "manual",
    defaultWeeksForDistance,
  };
}

function capConfidenceLevel(level: ConfidenceLevel, cap: ConfidenceBand): ConfidenceLevel {
  const order: ConfidenceLevel[] = ["low", "medium", "high"];
  const capIndex =
    cap === "medium_low"
      ? order.indexOf("medium")
      : order.indexOf(cap as ConfidenceLevel);
  const levelIndex = order.indexOf(level);
  if (capIndex < 0 || levelIndex < 0) return level;
  return order[Math.min(levelIndex, capIndex)]!;
}

function buildPrepWindow(input: {
  raceDate: string;
  weeks: number;
  fromOverride: string | null;
  toOverride: string | null;
}): { from: string; to: string; weekRanges: WeekRange[] } {
  if (input.fromOverride && input.toOverride) {
    const weekRanges: WeekRange[] = [];
    let weekEnd = input.toOverride;
    for (let index = 0; index < input.weeks; index += 1) {
      const weekStart = addDays(weekEnd, -6);
      if (weekEnd < input.fromOverride) break;
      weekRanges.unshift({ from: weekStart, to: weekEnd });
      weekEnd = addDays(weekStart, -1);
    }
    return { from: input.fromOverride, to: input.toOverride, weekRanges };
  }

  const raceWeekMonday = getWeekStartMonday(input.raceDate);
  const prepTo = addDays(raceWeekMonday, -1);
  const prepFrom = addDays(prepTo, -(input.weeks * 7 - 1));
  const weekRanges = enumerateWeeksEndingOn(prepTo, input.weeks);
  return { from: prepFrom, to: prepTo, weekRanges };
}

function enumerateWeeksEndingOn(weekEndingSunday: string, count: number): WeekRange[] {
  const weeks: WeekRange[] = [];
  let weekEnd = weekEndingSunday;
  for (let index = 0; index < count; index += 1) {
    const weekStart = addDays(weekEnd, -6);
    weeks.unshift({ from: weekStart, to: weekEnd });
    weekEnd = addDays(weekStart, -1);
  }
  return weeks;
}

function weeklySummaryPath(studentId: string, week: WeekRange): string {
  return path.join(parsedRoot, studentId, `${week.from}_${week.to}`, "weekly-summary.json");
}

async function loadWeeklySummary(studentId: string, week: WeekRange): Promise<WeeklySummary | null> {
  const summaryPath = weeklySummaryPath(studentId, week);
  if (!existsSync(summaryPath)) return null;
  const raw = await readFile(summaryPath, "utf8");
  return JSON.parse(raw) as WeeklySummary;
}

function isRunningWorkout(workout: WeeklySummaryWorkout): boolean {
  const sport = (workout.sport ?? "").toLowerCase();
  if (RUNNING_SPORT_PATTERN.test(sport)) return true;
  const title = (workout.title ?? "").toLowerCase();
  return RUNNING_SPORT_PATTERN.test(title);
}

function collectWorkoutText(workout: WeeklySummaryWorkout): string {
  return [
    workout.title,
    workout.planned.description,
    workout.planned.coach_comments,
  ]
    .filter(Boolean)
    .join(" ");
}

function isEasyRecoveryTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return EASY_TITLE_PATTERN.test(title);
}

function hasIntervalKeyword(text: string): boolean {
  return INTERVAL_KEYWORD_PATTERN.test(text);
}

function hasIntervalRepeatWithUnits(text: string): boolean {
  return INTERVAL_REPEAT_WITH_UNITS_PATTERN.test(text);
}

function hasExplicitNonEasyIntervalMainSet(workout: WeeklySummaryWorkout): boolean {
  return getPlannedSegments(workout).some((segment) => {
    if ((segment.repeat_count ?? 1) <= 1) return false;
    if (segment.is_rest) return false;
    if (segment.segment_type === "warmup" || segment.segment_type === "cooldown" || segment.segment_type === "recovery") {
      return false;
    }
    if (segment.segment_type === "interval") return true;
    return (segment.duration_minutes ?? 0) >= 3;
  });
}

function hasIntervalEvidence(text: string, title: string, workout: WeeklySummaryWorkout): boolean {
  if (hasIntervalKeyword(text)) return true;
  if (hasIntervalRepeatWithUnits(title)) return true;
  if (hasExplicitNonEasyIntervalMainSet(workout)) return true;
  if (!isEasyRecoveryTitle(title) && hasIntervalRepeatWithUnits(text)) return true;
  return false;
}

function wouldClassifyAsIntervalWithoutEasyGuard(text: string): boolean {
  if (hasIntervalKeyword(text)) return true;
  if (hasIntervalRepeatWithUnits(text)) return true;
  return false;
}

function getEasyTitleClassificationDiagnostic(
  workout: WeeklySummaryWorkout,
  role: KeyWorkoutRole | null,
): string | null {
  if (role !== null || !isEasyRecoveryTitle(workout.title)) return null;
  if (!wouldClassifyAsIntervalWithoutEasyGuard(collectWorkoutText(workout))) return null;
  return `easy_title_with_drills_ignored_for_interval_evidence: ${workout.date ?? "?"} · ${workout.title ?? "untitled"}`;
}

function classifyKeyWorkout(workout: WeeklySummaryWorkout): KeyWorkoutRole | null {
  if (!workout.classification.is_completed || !isRunningWorkout(workout)) return null;
  const text = collectWorkoutText(workout);
  const title = workout.title ?? "";
  if (workout.intensity_flags.includes("long_run") || LONG_RUN_PATTERN.test(text)) {
    return "long_run";
  }

  if (isEasyRecoveryTitle(title)) {
    if (hasIntervalEvidence(text, title, workout)) return "intervals";
    if (TEMPO_PATTERN.test(title)) return "tempo_threshold";
    if (RACE_PACE_PATTERN.test(title)) return "race_pace_like";
    return null;
  }

  if (hasIntervalEvidence(text, title, workout)) return "intervals";
  if (TEMPO_PATTERN.test(text)) return "tempo_threshold";
  if (RACE_PACE_PATTERN.test(text)) return "race_pace_like";
  return null;
}

function isLongRunWorkout(workout: WeeklySummaryWorkout): boolean {
  if (!workout.classification.is_completed || !isRunningWorkout(workout)) return false;
  if (workout.intensity_flags.includes("long_run")) return true;
  const distance = workout.distance_km ?? 0;
  const duration = workout.completed_duration_minutes ?? 0;
  if (distance >= 16 || duration >= 80) return true;
  return LONG_RUN_PATTERN.test(collectWorkoutText(workout));
}

function findLatestProbeReport<T>(baseDir: string, athleteId: number): {
  path: string | null;
  report: T | null;
  runAt: string | null;
  stale: boolean;
} {
  const athleteDir = path.join(baseDir, String(athleteId));
  if (!existsSync(athleteDir)) {
    return { path: null, report: null, runAt: null, stale: true };
  }

  const timestamps = readdirSync(athleteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const timestamp of timestamps) {
    const reportPath = path.join(athleteDir, timestamp, "report.json");
    if (!existsSync(reportPath)) continue;
    const raw = readTextFileSyncSafe(reportPath);
    if (!raw) continue;
    const report = JSON.parse(raw) as T & { run_at?: string };
    const runAt = typeof report.run_at === "string" ? report.run_at : null;
    const stale =
      runAt === null
        ? true
        : daysBetween(runAt.slice(0, 10), new Date().toISOString().slice(0, 10)) > PROBE_STALE_DAYS;
    return { path: reportPath, report, runAt, stale };
  }

  return { path: null, report: null, runAt: null, stale: true };
}

function anchorWeight(kind: AnchorKind): number {
  switch (kind) {
    case "official_best":
      return 1.0;
    case "official_flagged":
      return 0.9;
    case "probable_best":
      return 0.82;
    case "clean_training_best":
      return 0.55;
    case "needs_coach_review":
      return 0.45;
    default:
      return 0.5;
  }
}

function candidateToAnchor(kind: AnchorKind, candidate: RaceResultCandidate): SelectedAnchor {
  return {
    kind,
    candidate,
    confidence_weight: anchorWeight(kind),
  };
}

function isUsableAnchor(candidate: RaceResultCandidate, includeReview: boolean): boolean {
  if (candidate.data_quality_status === "excluded") return false;
  if (candidate.result_status === "excluded") return false;
  if (candidate.display_class === "excluded") return false;
  if (!includeReview) {
    if (candidate.result_status === "needs_coach_review") return false;
    if (candidate.display_class === "manual_review") return false;
  }
  return true;
}

function selectAnchorsFromRaceProbe(
  report: RaceResultsProbeReport | null,
  distance: DistanceKey,
  includeReviewAnchors: boolean,
): {
  primary: SelectedAnchor | null;
  alternates: SelectedAnchor[];
  excludedForReview: SelectedAnchor[];
  crossDistance: SelectedAnchor[];
} {
  if (!report) {
    return { primary: null, alternates: [], excludedForReview: [], crossDistance: [] };
  }

  const bucket = report.distance_results[distance];
  const excludedForReview: SelectedAnchor[] = [];
  const alternates: SelectedAnchor[] = [];

  const ordered: Array<{ kind: AnchorKind; candidate: RaceResultCandidate | null | undefined }> = [
    { kind: "official_best", candidate: bucket?.official_best },
    { kind: "official_flagged", candidate: bucket?.official_flagged },
    { kind: "probable_best", candidate: bucket?.probable_best },
    { kind: "clean_training_best", candidate: bucket?.clean_training_best },
  ];

  let primary: SelectedAnchor | null = null;
  for (const entry of ordered) {
    if (!entry.candidate) continue;
    if (!isUsableAnchor(entry.candidate, includeReviewAnchors)) {
      if (
        entry.candidate.result_status === "needs_coach_review" ||
        entry.candidate.display_class === "manual_review"
      ) {
        excludedForReview.push(candidateToAnchor("needs_coach_review", entry.candidate));
      }
      continue;
    }
    const anchor = candidateToAnchor(entry.kind, entry.candidate);
    if (!primary) {
      primary = anchor;
    } else {
      alternates.push(anchor);
    }
  }

  if (includeReviewAnchors) {
    for (const row of report.manual_review_candidates ?? []) {
      if (row.distance_bucket !== distance) continue;
      if (row.data_quality_status === "excluded") continue;
      const candidate: RaceResultCandidate = {
        workoutId: row.workoutId,
        date: row.date,
        title: row.title,
        distance_bucket: row.distance_bucket,
        distance_km: 0,
        duration_min: 0,
        duration_text: row.duration_text,
        pace_min_per_km: 0,
        pace_text: row.pace_text,
        display_class: row.display_class,
        result_status: row.result_status,
        data_quality_status: row.data_quality_status,
      };
      const paceMatch = row.pace_text.match(/(\d+):(\d+)/);
      if (paceMatch) {
        candidate.pace_min_per_km = Number(paceMatch[1]) + Number(paceMatch[2]) / 60;
      }
      const durationMatch = row.duration_text.match(/(?:(\d+):)?(\d+):(\d+)/) ?? row.duration_text.match(/(\d+):(\d+)/);
      if (durationMatch) {
        const seconds = parseDurationToSeconds(row.duration_text);
        if (seconds !== null) candidate.duration_min = seconds / 60;
      }
      excludedForReview.push(candidateToAnchor("needs_coach_review", candidate));
    }
  }

  const crossDistance: SelectedAnchor[] = [];
  for (const [key, otherBucket] of Object.entries(report.distance_results)) {
    if (key === distance || !otherBucket) continue;
    const candidate =
      otherBucket.official_best ??
      otherBucket.probable_best ??
      otherBucket.clean_training_best ??
      null;
    if (!candidate || !isUsableAnchor(candidate, includeReviewAnchors)) continue;
    const kind: AnchorKind = otherBucket.official_best
      ? "official_best"
      : otherBucket.probable_best
        ? "probable_best"
        : "clean_training_best";
    crossDistance.push(candidateToAnchor(kind, candidate));
  }

  return { primary, alternates, excludedForReview, crossDistance };
}

function parsePaceTextToMinPerKm(paceText: string | null): number | null {
  if (!paceText) return null;
  const match = paceText.match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function segmentRoleBucket(role: string): "interval_specific" | "threshold" | "sub_threshold" | "other" {
  const lower = role.toLowerCase();
  if (lower.includes("10k-specific") || lower.includes("vo2")) return "interval_specific";
  if (lower.includes("threshold support") || (lower.includes("threshold") && !lower.includes("sub"))) {
    return "threshold";
  }
  if (lower.includes("sub-threshold") || lower.includes("tempo / sub")) return "sub_threshold";
  return "other";
}

function computeAnchorImpliedSeconds(anchor: SelectedAnchor | null, distanceKm: number): number | null {
  if (!anchor || anchor.candidate.pace_min_per_km <= 0) return null;
  return paceMinPerKmToSeconds(anchor.candidate.pace_min_per_km, distanceKm);
}

function computeReadinessScores(input: {
  anchor: SelectedAnchor | null;
  trainingImpliedAnchor: TrainingImpliedHalfAnchor | null;
  raceDate: string;
  distance: DistanceKey;
  segmentKeyWorkouts: SegmentKeyWorkout[];
  progressReport: ProgressEvidenceReport | null;
  completionRates: number[];
  missedWorkouts: number;
  weeksFound: number;
  weeksRequested: number;
  longRuns: RacePredictionReport["features"]["long_runs"];
  weeklyVolume: RacePredictionReport["features"]["weekly_volume"];
  taperSignal: RacePredictionReport["features"]["taper"]["signal"];
  taperRatio: number | null;
  dataWarnings: string[];
  fitWeeks: number;
  suspiciousWeeks: number;
}): ReadinessScores {
  const notes: string[] = [];
  const preset = DISTANCE_PRESETS[input.distance];

  let anchorQuality = 15;
  if (input.anchor) {
    switch (input.anchor.kind) {
      case "official_best":
        anchorQuality = 88;
        break;
      case "official_flagged":
        anchorQuality = 78;
        break;
      case "probable_best":
        anchorQuality = 70;
        break;
      case "clean_training_best":
        anchorQuality = 48;
        break;
      default:
        anchorQuality = 40;
    }
    const anchorAgeDays = daysBetween(input.anchor.candidate.date, input.raceDate);
    if (anchorAgeDays <= 90) {
      anchorQuality += 8;
      notes.push(`Якорь свежий (${anchorAgeDays} дн. до старта).`);
    } else if (anchorAgeDays <= 180) {
      anchorQuality += 3;
    } else if (anchorAgeDays > 365) {
      anchorQuality -= 12;
      notes.push("Якорь старше года — осторожнее с экстраполяцией.");
    } else {
      anchorQuality -= 4;
    }
    if (input.anchor.candidate.data_quality_status === "suspicious") {
      anchorQuality -= 12;
      notes.push("Якорь помечен suspicious в race-results probe.");
    }
    if (input.anchor.kind === "clean_training_best") {
      notes.push("Якорь — тренировочный ориентир, не официальный старт.");
    }
  } else if (input.trainingImpliedAnchor?.available) {
    anchorQuality = 48;
    anchorQuality += Math.min(22, input.trainingImpliedAnchor.evidence_workouts.length * 5);
    if (input.trainingImpliedAnchor.endurance_gate.status === "cleared") {
      anchorQuality += 8;
    } else if (input.trainingImpliedAnchor.endurance_gate.status === "partial") {
      anchorQuality += 4;
    }
    notes.push("Официального half anchor нет; используется training-implied anchor (не официальный старт).");
  } else {
    notes.push("Нет надёжного результата на целевой дистанции.");
  }
  anchorQuality = clampScore(anchorQuality);

  const usableSegments = input.segmentKeyWorkouts.filter((workout) => workout.usable_for_prediction);
  const intervalWorkouts = usableSegments.filter(
    (workout) => segmentRoleBucket(workout.role) === "interval_specific",
  );
  const thresholdWorkouts = usableSegments.filter(
    (workout) => segmentRoleBucket(workout.role) === "threshold",
  );
  const subThresholdWorkouts = usableSegments.filter(
    (workout) => segmentRoleBucket(workout.role) === "sub_threshold",
  );

  let intervalSpecificity = 18;
  if (intervalWorkouts.length > 0) {
    intervalSpecificity = 35;
    for (const workout of intervalWorkouts) {
      let workoutScore = 22;
      if (workout.verdict === "positive") workoutScore += 8;
      if (workout.completion_ratio !== null && workout.completion_ratio >= 0.95) workoutScore += 6;
      if (workout.rep_to_rep_fade_pct !== null && workout.rep_to_rep_fade_pct <= 3) workoutScore += 4;
      intervalSpecificity += workoutScore;
    }
    intervalSpecificity = Math.min(100, intervalSpecificity);
    notes.push(
      `${intervalWorkouts.length} пригодных 10K-specific интервалов с segment evidence.`,
    );
  } else {
    notes.push("Нет пригодных 3–6 мин интервалов для прямой 10K-специфики.");
  }
  intervalSpecificity = clampScore(intervalSpecificity);

  let thresholdReadiness = 20;
  for (const workout of thresholdWorkouts) {
    let workoutScore = 18;
    if (workout.verdict === "positive") workoutScore += 10;
    if (workout.completion_ratio !== null && workout.completion_ratio >= 0.9) workoutScore += 8;
    if (workout.rep_to_rep_fade_pct !== null && workout.rep_to_rep_fade_pct <= 4) workoutScore += 4;
    thresholdReadiness += workoutScore;
  }
  if (input.distance === "half" && input.trainingImpliedAnchor?.available) {
    const preferredBlocks = input.trainingImpliedAnchor.evidence_workouts.filter(
      (workout) =>
        workout.block_minutes !== null &&
        workout.block_minutes >= 14 &&
        workout.block_minutes <= 30,
    );
    thresholdReadiness = 40 + Math.min(45, input.trainingImpliedAnchor.evidence_workouts.length * 10);
    if (preferredBlocks.length > 0) {
      thresholdReadiness += Math.min(15, preferredBlocks.length * 5);
    }
    notes.push(
      `${input.trainingImpliedAnchor.evidence_workouts.length} темповых блоков для training-implied half (${preferredBlocks.length} по 14–30 мин).`,
    );
  } else if (thresholdWorkouts.length > 0) {
    notes.push(`${thresholdWorkouts.length} пригодных threshold/tempo отрезков 8–18 мин.`);
  }
  thresholdReadiness = clampScore(thresholdReadiness);

  const longestRunKm =
    input.longRuns.length > 0 ? Math.max(...input.longRuns.map((run) => run.distance_km)) : 0;
  const volumeValues = input.weeklyVolume
    .map((week) => week.running_km)
    .filter((value): value is number => value !== null);
  const medianVolume = median(volumeValues);

  const longRunTarget =
    input.distance === "5k" ? 8 : input.distance === "10k" ? 12 : input.distance === "half" ? 18 : 28;
  const volumeTarget =
    input.distance === "5k" ? 25 : input.distance === "10k" ? 35 : input.distance === "half" ? 45 : 55;

  let endurance = 25;
  if (longestRunKm >= longRunTarget) endurance += 28;
  else if (longestRunKm >= longRunTarget * 0.75) endurance += 14;
  else notes.push(`Длинная тренировка ${longestRunKm.toFixed(1)} км — ниже типичного для ${preset.label}.`);

  if (medianVolume !== null) {
    if (medianVolume >= volumeTarget) endurance += 22;
    else if (medianVolume >= volumeTarget * 0.7) endurance += 10;
  }
  if (subThresholdWorkouts.length > 0) endurance += Math.min(15, subThresholdWorkouts.length * 6);

  if (input.distance === "half" && input.trainingImpliedAnchor?.available) {
    switch (input.trainingImpliedAnchor.endurance_gate.status) {
      case "cleared":
        endurance += 28;
        break;
      case "partial":
        endurance += 16;
        break;
      default:
        endurance += 6;
        break;
    }
    for (const gateNote of input.trainingImpliedAnchor.endurance_gate.notes.slice(0, 1)) {
      notes.push(gateNote);
    }
  }

  if (input.progressReport?.long_run_progress.status === "found") {
    if (input.progressReport.long_run_progress.confidence === "high") endurance += 10;
    else if (input.progressReport.long_run_progress.confidence === "medium") endurance += 6;
    notes.push("Progress-evidence: положительный тренд длинного бега.");
  }
  endurance = clampScore(endurance);

  const weekCoverage = input.weeksRequested > 0 ? input.weeksFound / input.weeksRequested : 0;
  const completionMedian = median(input.completionRates);
  let consistency = weekCoverage * 45;
  if (completionMedian !== null) {
    consistency += completionMedian * 40;
    if (completionMedian >= 0.85) notes.push(`Выполнение плана ~${Math.round(completionMedian * 100)}%.`);
  }
  consistency -= Math.min(25, input.missedWorkouts * 3);
  if (input.weeksFound < input.weeksRequested) {
    notes.push(`Найдено ${input.weeksFound}/${input.weeksRequested} недель подготовки.`);
  }
  consistency = clampScore(consistency);

  let taperScore = 50;
  switch (input.taperSignal) {
    case "taper_detected":
      taperScore = 82;
      notes.push("Тейпер: объём последних дней ниже 3-недельной медианы.");
      break;
    case "flat":
      taperScore = 58;
      break;
    case "volume_spike":
      taperScore = 32;
      notes.push("Перед стартом объём не снижался — риск недотейпера.");
      break;
    default:
      taperScore = 48;
      notes.push("Тейпер оценён приблизительно — мало данных.");
  }
  if (input.taperRatio !== null && input.taperRatio >= 0.95) taperScore -= 8;
  taperScore = clampScore(taperScore);

  let dataQuality = 30 + weekCoverage * 25;
  if (input.weeksFound > 0) {
    dataQuality += (input.fitWeeks / input.weeksFound) * 20;
  }
  const segmentCoverage =
    input.segmentKeyWorkouts.length > 0
      ? usableSegments.length / input.segmentKeyWorkouts.length
      : 0;
  dataQuality += segmentCoverage * 20;
  dataQuality += Math.min(18, usableSegments.length * 6);
  dataQuality -= Math.min(20, input.dataWarnings.length * 2);
  dataQuality -= Math.min(10, input.suspiciousWeeks * 2);
  if (usableSegments.length === 0 && input.segmentKeyWorkouts.some((w) => w.segment_evidence_available)) {
    notes.push("Segment evidence есть, но пригодных для прогноза тренировок нет.");
  }
  dataQuality = clampScore(dataQuality);

  const componentAvg =
    (intervalSpecificity + thresholdReadiness + endurance + consistency + taperScore) / 5;
  const overall = clampScore(
    Math.min(100, Math.min(anchorQuality, dataQuality) * 0.55 + componentAvg * 0.45),
  );

  let confidence: ConfidenceLevel = "medium";
  if (overall >= 72) confidence = "high";
  if (overall <= 44) confidence = "low";
  if (input.trainingImpliedAnchor?.available) {
    confidence = capConfidenceLevel(confidence, input.trainingImpliedAnchor.confidence_cap);
    if (confidence === "high") confidence = "medium";
  }

  return {
    anchor_quality_score: anchorQuality,
    interval_specificity_score: intervalSpecificity,
    threshold_readiness_score: thresholdReadiness,
    endurance_score: endurance,
    consistency_score: consistency,
    taper_score: taperScore,
    data_quality_score: dataQuality,
    overall_confidence_score: overall,
    confidence,
    notes,
  };
}

function computePredictionV2(input: {
  distance: DistanceKey;
  anchor: SelectedAnchor | null;
  targetTimeSeconds: number | null;
  readinessScores: ReadinessScores;
  segmentKeyWorkouts: SegmentKeyWorkout[];
  progressReport: ProgressEvidenceReport | null;
  taperSignal: RacePredictionReport["features"]["taper"]["signal"];
  missedWorkouts: number;
  raceDate: string;
}): {
  prediction: RacePredictionReport["prediction"];
  limitations: string[];
} {
  const preset = DISTANCE_PRESETS[input.distance];
  const limitations: string[] = [];
  const rangeModelNotes: string[] = [];
  const confidenceReasons: string[] = [];

  const anchorImpliedSeconds = computeAnchorImpliedSeconds(input.anchor, preset.target_km);
  const anchorPaceMin =
    input.anchor && input.anchor.candidate.pace_min_per_km > 0
      ? input.anchor.candidate.pace_min_per_km
      : null;

  const insufficientData =
    anchorImpliedSeconds === null ||
    (input.readinessScores.data_quality_score < 40 && input.readinessScores.anchor_quality_score < 55);

  if (insufficientData) {
    rangeModelNotes.push("Недостаточно данных для уточнения прогноза.");
    limitations.push("Недостаточно данных для узкого прогноза — широкий ориентир.");
  }

  let baseSeconds: number;
  if (anchorImpliedSeconds !== null) {
    baseSeconds = anchorImpliedSeconds;
    confidenceReasons.push(
      `Опорный результат: ${input.anchor!.kind} (${input.anchor!.candidate.date}, ${input.anchor!.candidate.pace_text}).`,
    );
    rangeModelNotes.push(
      `Якорь: ${input.anchor!.candidate.duration_text} (${input.anchor!.candidate.pace_text}) → ${formatDurationFromSeconds(anchorImpliedSeconds)} на ${preset.target_km} км.`,
    );
  } else if (input.anchor?.kind === "clean_training_best" && anchorImpliedSeconds === null) {
    baseSeconds = paceMinPerKmToSeconds(6.0, preset.target_km);
    limitations.push("Слабый якорь — широкий базовый ориентир.");
  } else {
    baseSeconds = paceMinPerKmToSeconds(
      input.distance === "5k" ? 5.5 : input.distance === "10k" ? 6.0 : input.distance === "half" ? 6.2 : 6.5,
      preset.target_km,
    );
    confidenceReasons.push("Опорный результат на целевой дистанции не найден.");
  }

  if (input.targetTimeSeconds !== null) {
    baseSeconds = Math.round(baseSeconds * 0.85 + input.targetTimeSeconds * 0.15);
    confidenceReasons.push("Учтён --target-time как мягкая подсказка (15% веса).");
  }

  const usableSegments = input.segmentKeyWorkouts.filter((workout) => workout.usable_for_prediction);
  const intervalWorkouts = usableSegments.filter(
    (workout) => segmentRoleBucket(workout.role) === "interval_specific",
  );
  const thresholdWorkouts = usableSegments.filter(
    (workout) => segmentRoleBucket(workout.role) === "threshold",
  );

  let segmentAdjustmentSeconds = 0;
  const maxTotalSegmentAdj = Math.round(baseSeconds * 0.02);
  const maxPerWorkoutAdj = Math.round(baseSeconds * 0.012);

  if (anchorPaceMin !== null && intervalWorkouts.length > 0) {
    for (const workout of intervalWorkouts) {
      const workPace = parsePaceTextToMinPerKm(workout.work_avg_pace ?? workout.work_fastest_pace);
      if (workPace === null) continue;
      const paceDeltaPct = ((workPace - anchorPaceMin) / anchorPaceMin) * 100;
      let workoutAdj = 0;
      if (paceDeltaPct <= -1 && paceDeltaPct >= -4) {
        workoutAdj = -Math.min(maxPerWorkoutAdj, Math.round(Math.abs(paceDeltaPct) * baseSeconds * 0.004));
        rangeModelNotes.push(
          `${workout.date} ${workout.title ?? ""}: рабочий темп ${workout.work_avg_pace} быстрее якоря → небольшое улучшение.`,
        );
      } else if (Math.abs(paceDeltaPct) <= 3) {
        workoutAdj = 0;
        rangeModelNotes.push(
          `${workout.date}: ${workout.work_avg_pace} близок к якорю — подтверждает опору.`,
        );
      } else if (paceDeltaPct > 3) {
        workoutAdj = Math.min(maxPerWorkoutAdj, Math.round(paceDeltaPct * baseSeconds * 0.002));
        rangeModelNotes.push(
          `${workout.date}: интервалы медленнее якоря — без улучшения likely.`,
        );
      }
      segmentAdjustmentSeconds += workoutAdj;
    }
    segmentAdjustmentSeconds = Math.max(
      -maxTotalSegmentAdj,
      Math.min(maxTotalSegmentAdj, segmentAdjustmentSeconds),
    );
  } else if (intervalWorkouts.length > 0) {
    rangeModelNotes.push("Интервальные тренировки учтены для уверенности, без сдвига якоря.");
  }

  if (thresholdWorkouts.length > 0 && anchorPaceMin !== null) {
    for (const workout of thresholdWorkouts) {
      const workPace = parsePaceTextToMinPerKm(workout.work_avg_pace);
      if (workPace === null) continue;
      const slowerPct = ((workPace - anchorPaceMin) / anchorPaceMin) * 100;
      if (slowerPct >= 2 && slowerPct <= 12) {
        rangeModelNotes.push(
          `${workout.date}: threshold ${workout.work_avg_pace} — ожидаемо медленнее 10K, поддерживает выносливость.`,
        );
      }
    }
  }

  const warningOnlySegments = input.segmentKeyWorkouts.filter(
    (workout) => workout.segment_evidence_available && !workout.usable_for_prediction,
  );
  if (warningOnlySegments.length > 0) {
    rangeModelNotes.push(
      `${warningOnlySegments.length} segment-тренировок с warning/unusable — не улучшают прогноз.`,
    );
  }

  let progressAdj = 0;
  if (input.progressReport && progressEvidencePositive(input.progressReport)) {
    progressAdj = -Math.min(Math.round(baseSeconds * 0.008), 20);
    confidenceReasons.push("Progress-evidence: положительный тренд лёгкого/длинного бега.");
    rangeModelNotes.push("Progress-evidence: лёгкий/длинный бег улучшился — небольшой оптимизм.");
  }
  segmentAdjustmentSeconds = Math.max(
    -maxTotalSegmentAdj,
    Math.min(maxTotalSegmentAdj, segmentAdjustmentSeconds + progressAdj),
  );

  let riskAdjustmentSeconds = 0;
  if (input.taperSignal === "volume_spike") {
    riskAdjustmentSeconds += Math.round(baseSeconds * 0.008);
    limitations.push("Перед стартом объём не снижался (возможен недотейпер).");
  }
  if (input.missedWorkouts >= 3) {
    riskAdjustmentSeconds += Math.min(Math.round(baseSeconds * 0.012), 35);
    limitations.push(`Пропущено ${input.missedWorkouts} запланированных тренировок.`);
  }

  const likelySeconds = Math.round(baseSeconds + segmentAdjustmentSeconds + riskAdjustmentSeconds * 0.25);

  let spreadConservative: number;
  let spreadOptimistic: number;
  switch (input.readinessScores.confidence) {
    case "high":
      spreadConservative = 0.02;
      spreadOptimistic = 0.015;
      break;
    case "medium":
      spreadConservative = 0.035;
      spreadOptimistic = 0.025;
      break;
    default:
      spreadConservative = 0.065;
      spreadOptimistic = 0.045;
  }

  if (insufficientData) {
    spreadConservative = Math.max(spreadConservative, 0.08);
    spreadOptimistic = Math.max(spreadOptimistic, 0.06);
  }

  if (input.readinessScores.taper_score < 45) spreadConservative += 0.012;
  if (input.readinessScores.consistency_score < 50) spreadConservative += 0.01;
  if (warningOnlySegments.length > 0) spreadConservative += 0.008;

  let conservativeSeconds = Math.round(likelySeconds * (1 + spreadConservative));
  let optimisticSeconds = Math.round(likelySeconds * (1 - spreadOptimistic));

  let evidenceCeilingSeconds: number | null = null;
  if (intervalWorkouts.length > 0) {
    const fastestPaces = intervalWorkouts
      .map((workout) => parsePaceTextToMinPerKm(workout.work_fastest_pace ?? workout.work_avg_pace))
      .filter((pace): pace is number => pace !== null);
    if (fastestPaces.length > 0) {
      evidenceCeilingSeconds = paceMinPerKmToSeconds(Math.min(...fastestPaces), preset.target_km);
      if (optimisticSeconds < evidenceCeilingSeconds) {
        rangeModelNotes.push(
          `Оптимистичный сценарий ограничен fastest segment evidence (~${formatDurationFromSeconds(evidenceCeilingSeconds)}).`,
        );
      }
      optimisticSeconds = Math.max(optimisticSeconds, evidenceCeilingSeconds);
    }
  }

  if (optimisticSeconds >= likelySeconds) {
    const targetOptimistic = Math.round(likelySeconds * (1 - spreadOptimistic));
    optimisticSeconds =
      evidenceCeilingSeconds !== null
        ? Math.max(evidenceCeilingSeconds, Math.min(targetOptimistic, likelySeconds - 1))
        : Math.min(targetOptimistic, likelySeconds - 1);
  }

  const ordered = [conservativeSeconds, likelySeconds, optimisticSeconds].sort((a, b) => a - b);
  conservativeSeconds = ordered[2]!;
  optimisticSeconds = ordered[0]!;

  rangeModelNotes.push(
    `Spread: conservative +${Math.round(spreadConservative * 1000) / 10}%, optimistic -${Math.round(spreadOptimistic * 1000) / 10}% (${input.readinessScores.confidence} confidence).`,
  );

  for (const note of input.readinessScores.notes.slice(0, 4)) {
    if (!confidenceReasons.includes(note)) confidenceReasons.push(note);
  }

  const anchorImpliedTime =
    anchorImpliedSeconds !== null ? buildScenario(anchorImpliedSeconds, preset.target_km) : null;

  return {
    prediction: {
      conservative: buildScenario(conservativeSeconds, preset.target_km),
      likely: buildScenario(likelySeconds, preset.target_km),
      optimistic: buildScenario(optimisticSeconds, preset.target_km),
      confidence: insufficientData ? "low" : input.readinessScores.confidence,
      confidence_score: insufficientData
        ? Math.min(input.readinessScores.overall_confidence_score, 35)
        : input.readinessScores.overall_confidence_score,
      confidence_reasons: confidenceReasons,
      method: "deterministic_v2_segment_aware",
      target_time_hint_used: input.targetTimeSeconds !== null,
      anchor_implied_time: anchorImpliedTime,
      segment_adjustment_seconds: segmentAdjustmentSeconds,
      risk_adjustment_seconds: riskAdjustmentSeconds,
      range_model_notes: rangeModelNotes,
      ...(insufficientData ? { insufficient_data: true } : {}),
    },
    limitations,
  };
}

function computePredictionV3TrainingImpliedHalf(input: {
  distance: DistanceKey;
  targetTimeSeconds: number | null;
  readinessScores: ReadinessScores;
  trainingImpliedAnchor: TrainingImpliedHalfAnchor;
  taperSignal: RacePredictionReport["features"]["taper"]["signal"];
  missedWorkouts: number;
}): {
  prediction: RacePredictionReport["prediction"];
  limitations: string[];
} {
  const preset = DISTANCE_PRESETS[input.distance];
  const limitations: string[] = [
    "Нет официального half anchor — уверенность ограничена; training-implied anchor уточняет диапазон.",
  ];
  const rangeModelNotes: string[] = [];
  const confidenceReasons: string[] = [
    "Training-implied half anchor из темповых блоков и длительных (не официальный старт).",
  ];

  const impliedSeconds = input.trainingImpliedAnchor.implied_half_time_s!;
  let baseSeconds = impliedSeconds;
  if (input.targetTimeSeconds !== null) {
    baseSeconds = Math.round(baseSeconds * 0.85 + input.targetTimeSeconds * 0.15);
    confidenceReasons.push("Учтён --target-time как мягкая подсказка (15% веса).");
  }

  let riskAdjustmentSeconds = 0;
  if (input.taperSignal === "volume_spike") {
    riskAdjustmentSeconds += Math.round(baseSeconds * 0.008);
    limitations.push("Перед стартом объём не снижался (возможен недотейпер).");
  }
  if (input.missedWorkouts >= 3) {
    riskAdjustmentSeconds += Math.min(Math.round(baseSeconds * 0.012), 35);
    limitations.push(`Пропущено ${input.missedWorkouts} запланированных тренировок.`);
  }

  const likelySeconds = Math.round(baseSeconds + riskAdjustmentSeconds * 0.25);

  const spreadKey: ConfidenceBand =
    input.trainingImpliedAnchor.evidence_workouts.length >=
    loadEPredictorConstants().half_marathon.training_implied_anchor.preferred_usable_threshold_workouts
      ? input.trainingImpliedAnchor.confidence_cap
      : "medium_low";
  const spread = loadEPredictorConstants().range_spread[spreadKey];
  let spreadConservative = spread.conservative_pct;
  const spreadOptimistic = spread.optimistic_pct;

  if (input.readinessScores.taper_score < 45) spreadConservative += 0.012;
  if (input.readinessScores.consistency_score < 50) spreadConservative += 0.01;

  let conservativeSeconds = Math.round(likelySeconds * (1 + spreadConservative));
  let optimisticSeconds = Math.round(likelySeconds * (1 - spreadOptimistic));

  const thresholdPaceSPerKm = input.trainingImpliedAnchor.threshold_pace_s_per_km;
  const halfOffset = input.trainingImpliedAnchor.half_pace_offset_s_per_km ?? 0;
  if (thresholdPaceSPerKm !== null) {
    const optimisticCeilingPaceSPerKm = thresholdPaceSPerKm + halfOffset;
    const optimisticCeilingSeconds = Math.round(optimisticCeilingPaceSPerKm * preset.target_km);
    if (optimisticSeconds < optimisticCeilingSeconds) {
      rangeModelNotes.push(
        `Оптимистичный сценарий ограничен threshold evidence (~${formatDurationFromSeconds(optimisticCeilingSeconds)}).`,
      );
    }
    optimisticSeconds = Math.max(optimisticSeconds, optimisticCeilingSeconds);
  }

  if (optimisticSeconds >= likelySeconds) {
    optimisticSeconds = Math.max(likelySeconds - 1, Math.round(likelySeconds * (1 - spreadOptimistic)));
  }

  const ordered = [conservativeSeconds, likelySeconds, optimisticSeconds].sort((a, b) => a - b);
  conservativeSeconds = ordered[2]!;
  optimisticSeconds = ordered[0]!;

  rangeModelNotes.push(
    `Training-implied: threshold ${input.trainingImpliedAnchor.threshold_pace_s_per_km}s/km + offset ${input.trainingImpliedAnchor.half_pace_offset_s_per_km}s/km + durability ${input.trainingImpliedAnchor.durability_penalty_s_per_km}s/km + no-race-anchor safety ${input.trainingImpliedAnchor.no_race_anchor_safety_penalty_s_per_km ?? 0}s/km.`,
  );
  rangeModelNotes.push(
    `Spread (${spreadKey}): conservative +${Math.round(spreadConservative * 1000) / 10}%, optimistic -${Math.round(spreadOptimistic * 1000) / 10}%.`,
  );
  for (const note of input.trainingImpliedAnchor.notes.slice(0, 3)) {
    rangeModelNotes.push(note);
  }
  for (const note of input.readinessScores.notes.slice(0, 3)) {
    if (!confidenceReasons.includes(note)) confidenceReasons.push(note);
  }

  let confidence = capConfidenceLevel(
    input.readinessScores.confidence,
    input.trainingImpliedAnchor.confidence_cap,
  );
  if (confidence === "high") confidence = "medium";

  const anchorImpliedTime = buildScenario(impliedSeconds, preset.target_km);

  return {
    prediction: {
      conservative: buildScenario(conservativeSeconds, preset.target_km),
      likely: buildScenario(likelySeconds, preset.target_km),
      optimistic: buildScenario(optimisticSeconds, preset.target_km),
      confidence,
      confidence_score: Math.min(
        input.readinessScores.overall_confidence_score,
        confidence === "medium" ? 62 : 48,
      ),
      confidence_reasons: confidenceReasons,
      method: "deterministic_v3_training_implied_half",
      anchor_tier_used: "training_implied",
      target_time_hint_used: input.targetTimeSeconds !== null,
      anchor_implied_time: anchorImpliedTime,
      segment_adjustment_seconds: 0,
      risk_adjustment_seconds: riskAdjustmentSeconds,
      range_model_notes: rangeModelNotes,
    },
    limitations,
  };
}

function computePrediction(input: {
  distance: DistanceKey;
  anchor: SelectedAnchor | null;
  targetTimeSeconds: number | null;
  readinessScores: ReadinessScores;
  segmentKeyWorkouts: SegmentKeyWorkout[];
  progressReport: ProgressEvidenceReport | null;
  trainingImpliedAnchor: TrainingImpliedHalfAnchor | null;
  taperSignal: RacePredictionReport["features"]["taper"]["signal"];
  missedWorkouts: number;
  raceDate: string;
}): {
  prediction: RacePredictionReport["prediction"];
  limitations: string[];
} {
  if (
    input.distance === "half" &&
    !isStrongHalfRaceAnchor(input.anchor?.kind) &&
    input.trainingImpliedAnchor?.available
  ) {
    return computePredictionV3TrainingImpliedHalf({
      distance: input.distance,
      targetTimeSeconds: input.targetTimeSeconds,
      readinessScores: input.readinessScores,
      trainingImpliedAnchor: input.trainingImpliedAnchor,
      taperSignal: input.taperSignal,
      missedWorkouts: input.missedWorkouts,
    });
  }

  const v2 = computePredictionV2({
    distance: input.distance,
    anchor: input.anchor,
    targetTimeSeconds: input.targetTimeSeconds,
    readinessScores: input.readinessScores,
    segmentKeyWorkouts: input.segmentKeyWorkouts,
    progressReport: input.progressReport,
    taperSignal: input.taperSignal,
    missedWorkouts: input.missedWorkouts,
    raceDate: input.raceDate,
  });
  return {
    prediction: {
      ...v2.prediction,
      anchor_tier_used: input.anchor ? "race_anchor" : undefined,
    },
    limitations: v2.limitations,
  };
}

function buildScenario(seconds: number, distanceKm: number): PredictionScenario {
  const paceMinPerKm = seconds / 60 / distanceKm;
  return {
    seconds,
    time_text: formatDurationFromSeconds(seconds),
    pace_text: formatPaceText(paceMinPerKm),
  };
}

function asSegmentAnalysis(workout: WeeklySummaryWorkout): WorkoutSegmentAnalysisAudit {
  return workout.segment_analysis ?? {};
}

function asSegmentComparison(workout: WeeklySummaryWorkout): SegmentComparisonEntryAudit[] {
  return workout.segment_comparison ?? [];
}

function buildSegmentShapeSummary(workout: WeeklySummaryWorkout): SegmentAuditReport["workouts"][number]["segment_shape_summary"] {
  const segments = asSegmentComparison(workout);
  const segmentTypes = [...new Set(segments.map((segment) => segment.segment_type).filter(Boolean))] as string[];
  const coverageCounts: Record<string, number> = {};
  for (const segment of segments) {
    const key = segment.coverage ?? "unknown";
    coverageCounts[key] = (coverageCounts[key] ?? 0) + 1;
  }
  const sampleKeys = segments.slice(0, 6).map((segment, index) => {
    const parts = [
      `#${index + 1}`,
      segment.segment_type ?? "unknown",
      segment.is_rest ? "rest" : "work",
      segment.coverage ?? "n/a",
    ];
    if (segment.repeat_group_id) parts.push(segment.repeat_group_id);
    if (segment.repeat_iteration !== null && segment.repeat_iteration !== undefined) {
      parts.push(`iter${segment.repeat_iteration}`);
    }
    return parts.join(":");
  });
  return { segment_types: segmentTypes, coverage_counts: coverageCounts, sample_keys: sampleKeys };
}

function deriveSegmentVerdict(workout: WeeklySummaryWorkout): { verdict: SegmentAuditVerdict; reason: string } {
  const analysis = asSegmentAnalysis(workout);
  const comparison = asSegmentComparison(workout);
  const plannedSegmentsCount = analysis.planned_segments_count ?? workout.planned.segments?.length ?? 0;
  const comparedCount = analysis.compared_segments_count ?? 0;
  const comparableCount = analysis.comparable_segments_count ?? 0;
  const hasComparison = comparison.length > 0;
  const nonRestCompared = comparison.filter((segment) => !segment.is_rest && segment.coverage !== "unsupported");
  const usableNonRest = nonRestCompared.filter(
    (segment) => segment.coverage === "full" || segment.coverage === "partial",
  );

  if (analysis.available === true && comparedCount > 0 && usableNonRest.length > 0) {
    const partialCount = nonRestCompared.filter((segment) => segment.coverage === "partial").length;
    const missingCount = comparison.filter((segment) => segment.coverage === "missing").length;
    const ratio = comparableCount > 0 ? comparedCount / comparableCount : 1;
    if (
      missingCount > 0 ||
      partialCount > 0 ||
      ratio < 0.75 ||
      (analysis.data_quality_flags ?? []).includes("contains_missing_segments")
    ) {
      return {
        verdict: "usable",
        reason: `Частично пригодно: ${usableNonRest.length} рабочих сегментов full/partial, ${comparedCount}/${comparableCount || comparedCount} compared.`,
      };
    }
    return {
      verdict: "usable",
      reason: `Пригодно: ${usableNonRest.length} рабочих сегментов full/partial, ${comparedCount} compared.`,
    };
  }

  if (plannedSegmentsCount === 0 && !hasComparison) {
    return {
      verdict: "no_segment_data",
      reason: "Нет planned segments и segment_comparison в weekly-summary.",
    };
  }

  if (plannedSegmentsCount > 0 && (analysis.available !== true || comparedCount === 0)) {
    const fitType = workout.completed.detail_source?.type ?? "unknown";
    if (analysis.reason === "unsupported_repeats") {
      return {
        verdict: "plan_only_no_actual_segments",
        reason: `План есть (${plannedSegmentsCount} сегм.), FIT matched (${fitType}), но парсер: unsupported_repeats.`,
      };
    }
    if (fitType !== "workout_file_fit") {
      return {
        verdict: "plan_only_no_actual_segments",
        reason: `План есть (${plannedSegmentsCount} сегм.), но нет matched FIT (${fitType}).`,
      };
    }
    return {
      verdict: "plan_only_no_actual_segments",
      reason: `План есть (${plannedSegmentsCount} сегм.), segment analysis: ${analysis.reason ?? "unavailable"}.`,
    };
  }

  const partialCount = comparison.filter((segment) => segment.coverage === "partial").length;
  const missingCount = comparison.filter((segment) => segment.coverage === "missing").length;
  const ratio = comparableCount > 0 ? comparedCount / comparableCount : 0;
  return {
    verdict: "ambiguous",
    reason: `Неоднозначно: compared ${comparedCount}/${comparableCount || "?"}, partial ${partialCount}, missing ${missingCount}, ratio ${ratio.toFixed(2)}.`,
  };
}

function buildRawShape(workout: WeeklySummaryWorkout): Record<string, unknown> {
  const analysis = asSegmentAnalysis(workout);
  const comparison = asSegmentComparison(workout);
  return {
    segment_analysis: analysis,
    segment_comparison_sample: comparison.slice(0, 4).map((segment) => ({
      segment_type: segment.segment_type,
      is_rest: segment.is_rest,
      coverage: segment.coverage,
      coverage_ratio: segment.coverage_ratio,
      repeat_group_id: segment.repeat_group_id,
      repeat_iteration: segment.repeat_iteration,
    })),
    planned_segments_count: workout.planned.segments?.length ?? 0,
    detail_source: workout.completed.detail_source,
  };
}

function buildSegmentAudit(
  captures: RawKeyWorkoutCapture[],
  includeRawShape: boolean,
): SegmentAuditReport {
  const workouts = captures.map((capture) => {
    const workout = capture.workout;
    const analysis = asSegmentAnalysis(workout);
    const comparison = asSegmentComparison(workout);
    const { verdict, reason } = deriveSegmentVerdict(workout);
    const segmentAnalysisBlock = {
      available: analysis.available === true,
      reason: analysis.reason ?? null,
      planned_segments_count: analysis.planned_segments_count ?? workout.planned.segments?.length ?? 0,
      expanded_segments_count: analysis.expanded_segments_count ?? 0,
      comparable_segments_count: analysis.comparable_segments_count ?? 0,
      compared_segments_count: analysis.compared_segments_count ?? 0,
      data_quality_flags: analysis.data_quality_flags ?? [],
    };

    const entry: SegmentAuditReport["workouts"][number] = {
      date: capture.date,
      title: capture.title,
      role: capture.role,
      completed: {
        distance_km: workout.distance_km,
        duration_text:
          workout.completed_duration_minutes !== null
            ? formatDurationText(workout.completed_duration_minutes)
            : null,
        pace_text:
          workout.avg_pace_text ??
          (workout.avg_pace_min_per_km ? formatPaceText(workout.avg_pace_min_per_km) : null),
      },
      has_segment_analysis: analysis.available === true,
      has_segment_comparison: comparison.length > 0,
      segment_analysis: segmentAnalysisBlock,
      expanded_segments_count: segmentAnalysisBlock.expanded_segments_count,
      compared_segments_count: segmentAnalysisBlock.compared_segments_count,
      segment_shape_summary: buildSegmentShapeSummary(workout),
      fit_detail_source: {
        type: workout.completed.detail_source?.type ?? null,
        match_status: workout.completed.detail_source?.match_status ?? null,
        match_confidence: workout.completed.detail_source?.match_confidence ?? null,
      },
      verdict,
      reason,
    };
    if (includeRawShape) {
      entry.raw_shape = buildRawShape(workout);
    }
    return entry;
  });

  const segmentAnalysisAvailableCount = workouts.filter((workout) => workout.has_segment_analysis).length;
  const segmentComparisonAvailableCount = workouts.filter((workout) => workout.has_segment_comparison).length;
  const isIntervalLike = (workout: SegmentAuditReport["workouts"][number]): boolean =>
    workout.role === "intervals" ||
    hasIntervalKeyword(workout.title ?? "") ||
    hasIntervalRepeatWithUnits(workout.title ?? "");

  const intervalWorkouts = workouts.filter((workout) => workout.role === "intervals");
  const intervalLikeWorkouts = workouts.filter(isIntervalLike);
  const intervalWithSegments = intervalWorkouts.filter(
    (workout) => workout.has_segment_analysis || workout.has_segment_comparison || workout.segment_analysis.planned_segments_count > 0,
  );
  const usableIntervalCount = intervalLikeWorkouts.filter((workout) => workout.verdict === "usable").length;
  const fitMatchedCount = workouts.filter(
    (workout) => workout.fit_detail_source.type === "workout_file_fit" && workout.fit_detail_source.match_status === "matched",
  ).length;

  const segmentAwareReady = usableIntervalCount >= 2;
  const recommendation: SegmentAuditReport["recommendation"] = segmentAwareReady
    ? "segment_aware_ready"
    : "needs_fit_or_parser";
  const recommendationNote = segmentAwareReady
    ? "Можно переходить к segment-aware анализу интервалов: есть минимум 2 пригодные interval key workouts."
    : "Нужны Workout Files/FIT или доработка парсера: недостаточно пригодных interval key workouts с сегментами.";

  return {
    enabled: true,
    summary: {
      key_workouts_count: workouts.length,
      segment_analysis_available_count: segmentAnalysisAvailableCount,
      segment_comparison_available_count: segmentComparisonAvailableCount,
      interval_key_workouts_count: intervalWorkouts.length,
      interval_key_workouts_with_segments_count: intervalWithSegments.length,
      fit_or_workout_files_coverage_hint: `${fitMatchedCount}/${workouts.length} key workouts with matched FIT`,
    },
    workouts: workouts.sort((a, b) => b.date.localeCompare(a.date)),
    recommendation,
    recommendation_note: recommendationNote,
  };
}

function isWorkCoverage(coverage: string | undefined): boolean {
  return coverage === "full" || coverage === "partial";
}

function segmentHasUsablePace(segment: SegmentComparisonEntryAudit): boolean {
  return (
    segment.actual?.avg_pace_text != null ||
    (segment.actual?.avg_pace_min_per_km != null && segment.actual.avg_pace_min_per_km > 0)
  );
}

function segmentPaceMinPerKm(segment: SegmentComparisonEntryAudit): number | null {
  const pace = segment.actual?.avg_pace_min_per_km;
  if (pace != null && pace > 0) return pace;
  const text = segment.actual?.avg_pace_text;
  if (!text) return null;
  const match = text.match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

function getPlannedSegments(workout: WeeklySummaryWorkout): PlannedSegmentSummary[] {
  return (workout.planned.segments ?? []) as PlannedSegmentSummary[];
}

function getPlannedRepeatBlocks(workout: WeeklySummaryWorkout): PlannedSegmentSummary[] {
  return getPlannedSegments(workout).filter(
    (segment) => (segment.repeat_count ?? 1) > 1 && (segment.duration_minutes ?? 0) >= 3,
  );
}

function parseIntervalRepsFromTitle(title: string | null): { reps: number | null; repDurationMin: number | null } {
  if (!title) return { reps: null, repDurationMin: null };
  const match = title.match(INTERVAL_TITLE_PATTERN);
  if (!match) return { reps: null, repDurationMin: null };
  return { reps: Number(match[1]), repDurationMin: Number(match[2]) };
}

function countPlannedWorkReps(workout: WeeklySummaryWorkout): number | null {
  const fromTitle = parseIntervalRepsFromTitle(workout.title);
  if (fromTitle.reps !== null) return fromTitle.reps;

  const repeatBlock = getPlannedRepeatBlocks(workout).find(
    (segment) => segment.segment_type === "interval" || (segment.duration_minutes ?? 0) >= 8,
  );
  return repeatBlock?.repeat_count ?? null;
}

function sortWorkSegments(segments: SegmentComparisonEntryAudit[]): SegmentComparisonEntryAudit[] {
  return [...segments].sort((left, right) => {
    const leftRepeat = left.repeat_iteration ?? Number.MAX_SAFE_INTEGER;
    const rightRepeat = right.repeat_iteration ?? Number.MAX_SAFE_INTEGER;
    if (leftRepeat !== rightRepeat) return leftRepeat - rightRepeat;
    return (left.order ?? 0) - (right.order ?? 0);
  });
}

function isStrictWorkSegment(segment: SegmentComparisonEntryAudit): boolean {
  if (segment.is_rest === true) return false;
  if (NON_WORK_SEGMENT_TYPES.has(segment.segment_type ?? "")) return false;
  if (!isWorkCoverage(segment.coverage)) return false;
  return segmentHasUsablePace(segment);
}

function isRepeatBlockWorkSegment(
  segment: SegmentComparisonEntryAudit,
  plannedBlocks: PlannedSegmentSummary[],
): boolean {
  if (!isWorkCoverage(segment.coverage)) return false;
  if (!segmentHasUsablePace(segment)) return false;
  if (segment.repeat_iteration == null || !segment.repeat_group_id) return false;

  const block = plannedBlocks.find((entry) => entry.repeat_group_id === segment.repeat_group_id);
  if (!block) return false;

  const duration = segment.planned_duration_minutes ?? block.duration_minutes ?? 0;
  if (segment.segment_type === "warmup" || segment.segment_type === "cooldown") return false;
  if (duration <= 3 && segment.segment_type !== "interval") return false;
  if (segment.segment_type === "interval") return true;
  if (duration >= 8 && Math.abs(duration - (block.duration_minutes ?? 0)) < 1) return true;
  return false;
}

function filterToRepDuration(
  segments: SegmentComparisonEntryAudit[],
  repDurationMin: number | null,
): SegmentComparisonEntryAudit[] {
  if (repDurationMin === null) return segments;
  return segments.filter((segment) => {
    if (segment.segment_type === "interval") return true;
    const duration = segment.planned_duration_minutes ?? 0;
    return Math.abs(duration - repDurationMin) < 2;
  });
}

function scoreWorkSegmentCandidate(
  segments: SegmentComparisonEntryAudit[],
  titleParsed: { reps: number | null; repDurationMin: number | null },
): number {
  if (!segments.length) return -1;
  let score = segments.length;
  if (titleParsed.reps !== null && titleParsed.reps > 0) {
    const repRatio = segments.length / titleParsed.reps;
    if (repRatio >= 0.75 && repRatio <= 1.1) score += 12;
    else if (repRatio < 0.5) score -= 8;
  }
  if (titleParsed.repDurationMin !== null) {
    const durationMatches = segments.filter((segment) => {
      const duration = segment.planned_duration_minutes ?? 0;
      return Math.abs(duration - titleParsed.repDurationMin!) < 2;
    }).length;
    score += durationMatches * 3;
  }
  if (segments.every((segment) => segment.segment_type === "interval")) {
    score += 5;
  }
  return score;
}

function identifyWorkSegments(workout: WeeklySummaryWorkout): {
  segments: SegmentComparisonEntryAudit[];
  evidenceType: SegmentKeyWorkoutEvidenceType;
} {
  const comparison = asSegmentComparison(workout);
  const plannedBlocks = getPlannedRepeatBlocks(workout);
  const titleParsed = parseIntervalRepsFromTitle(workout.title);

  const inferred = comparison.filter((segment) => isRepeatBlockWorkSegment(segment, plannedBlocks));
  const strictIntervals = comparison.filter(
    (segment) => isStrictWorkSegment(segment) && segment.segment_type === "interval",
  );
  const strictWork = filterToRepDuration(
    comparison.filter(isStrictWorkSegment),
    titleParsed.repDurationMin,
  );

  const candidates: Array<{
    segments: SegmentComparisonEntryAudit[];
    evidenceType: SegmentKeyWorkoutEvidenceType;
    score: number;
  }> = [];

  if (inferred.length > 0) {
    candidates.push({
      segments: sortWorkSegments(inferred),
      evidenceType: "repeat_group_inferred",
      score: scoreWorkSegmentCandidate(inferred, titleParsed),
    });
  }
  if (strictIntervals.length > 0) {
    candidates.push({
      segments: sortWorkSegments(strictIntervals),
      evidenceType: "segment_comparison",
      score: scoreWorkSegmentCandidate(strictIntervals, titleParsed),
    });
  }
  if (strictWork.length > 0) {
    candidates.push({
      segments: sortWorkSegments(strictWork),
      evidenceType: "segment_comparison",
      score: scoreWorkSegmentCandidate(strictWork, titleParsed),
    });
  }

  if (!candidates.length) {
    return { segments: [], evidenceType: "unavailable" };
  }

  const best = candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.evidenceType === "segment_comparison" && right.evidenceType === "repeat_group_inferred") {
      return -1;
    }
    if (right.evidenceType === "segment_comparison" && left.evidenceType === "repeat_group_inferred") {
      return 1;
    }
    return 0;
  })[0]!;
  return { segments: best.segments, evidenceType: best.evidenceType };
}

function classifyWorkoutEvidenceRole(
  repDurationMin: number | null,
  title: string | null,
): { role: string; limitations: string[] } {
  const limitations: string[] = [];
  if (repDurationMin !== null) {
    if (repDurationMin >= 3 && repDurationMin <= 6) {
      return { role: "10K-specific / VO2 support", limitations };
    }
    if (repDurationMin >= 8 && repDurationMin <= 18) {
      return { role: "threshold support", limitations };
    }
    if (repDurationMin >= 20 && repDurationMin <= 40) {
      return { role: "tempo / sub-threshold support", limitations };
    }
  }

  const text = title ?? "";
  if (
    hasIntervalKeyword(text) ||
    hasIntervalRepeatWithUnits(text) ||
    INTERVAL_TITLE_PATTERN.test(text)
  ) {
    limitations.push("Длительность повтора выведена из названия — уверенность ниже.");
    return { role: "interval support (inferred from title)", limitations };
  }
  if (TEMPO_PATTERN.test(text)) {
    limitations.push("Тип выведен из названия — уверенность ниже.");
    return { role: "tempo / threshold support (inferred from title)", limitations };
  }
  limitations.push("Не удалось классифицировать по длительности рабочих отрезков.");
  return { role: "key workout", limitations };
}

function computeRepFadeMetrics(paces: number[]): {
  rep_to_rep_fade_pct: number | null;
  last_rep_vs_first_rep_pct: number | null;
} {
  if (paces.length < 2) {
    return { rep_to_rep_fade_pct: null, last_rep_vs_first_rep_pct: null };
  }
  const lastRepVsFirst = ((paces[paces.length - 1]! - paces[0]!) / paces[0]!) * 100;
  let totalStepFade = 0;
  for (let index = 1; index < paces.length; index += 1) {
    totalStepFade += ((paces[index]! - paces[index - 1]!) / paces[index - 1]!) * 100;
  }
  return {
    rep_to_rep_fade_pct: Math.round((totalStepFade / (paces.length - 1)) * 10) / 10,
    last_rep_vs_first_rep_pct: Math.round(lastRepVsFirst * 10) / 10,
  };
}

function collectSegmentEvidenceWarnings(input: {
  completionRatio: number | null;
  fastestPace: number | null;
  slowestPace: number | null;
  workAvgPaceMin: number | null;
  wholeWorkoutPaceMin: number | null;
  paces: number[];
  fadePct: number | null;
  dataQualityFlags: string[];
}): string[] {
  const warnings: string[] = [];

  if (input.completionRatio !== null && input.completionRatio < 0.75) {
    warnings.push("incomplete_completion");
  }
  if (input.fastestPace !== null && input.slowestPace !== null && input.fastestPace > 0) {
    const spreadPct = ((input.slowestPace - input.fastestPace) / input.fastestPace) * 100;
    if (spreadPct > PACE_SPREAD_WARNING_PCT) {
      warnings.push("wide_pace_spread");
    }
  }
  if (input.fastestPace !== null && input.fastestPace > 0) {
    const hasExtremelySlowSegment = input.paces.some(
      (pace) => ((pace - input.fastestPace!) / input.fastestPace!) * 100 > SLOW_SEGMENT_VS_FASTEST_PCT,
    );
    if (hasExtremelySlowSegment) {
      warnings.push("extremely_slow_work_segment");
    }
  }
  if (input.workAvgPaceMin !== null && input.wholeWorkoutPaceMin !== null && input.wholeWorkoutPaceMin > 0) {
    const slowerThanWholePct =
      ((input.workAvgPaceMin - input.wholeWorkoutPaceMin) / input.wholeWorkoutPaceMin) * 100;
    if (slowerThanWholePct > WORK_AVG_SLOWER_THAN_WHOLE_WORKOUT_PCT) {
      warnings.push("work_avg_slower_than_whole_workout");
    }
  }
  if (input.dataQualityFlags.some((flag) => CRITICAL_SEGMENT_DATA_QUALITY_FLAGS.has(flag))) {
    warnings.push("missing_segments");
  }
  if (input.fadePct !== null && input.fadePct > 6) {
    warnings.push("high_fade");
  }

  return warnings;
}

function deriveSegmentKeyWorkoutVerdict(input: {
  segmentEvidenceAvailable: boolean;
  completionRatio: number | null;
  fadePct: number | null;
  evidenceWarnings: string[];
}): { verdict: SegmentKeyWorkoutVerdict; usable_for_prediction: boolean } {
  if (!input.segmentEvidenceAvailable) {
    return { verdict: "unavailable", usable_for_prediction: false };
  }
  if (input.evidenceWarnings.length > 0) {
    return { verdict: "warning", usable_for_prediction: false };
  }
  if (input.completionRatio === null) {
    return { verdict: "warning", usable_for_prediction: false };
  }
  if (input.completionRatio >= 0.9 && (input.fadePct === null || input.fadePct <= 3)) {
    return { verdict: "positive", usable_for_prediction: true };
  }
  if (input.completionRatio >= 0.75 && (input.fadePct === null || input.fadePct <= 6)) {
    return { verdict: "neutral", usable_for_prediction: true };
  }
  return { verdict: "warning", usable_for_prediction: false };
}

function isAnomalousSegmentEvidence(evidenceWarnings: string[]): boolean {
  return evidenceWarnings.some((warning) =>
    [
      "incomplete_completion",
      "wide_pace_spread",
      "extremely_slow_work_segment",
      "work_avg_slower_than_whole_workout",
      "missing_segments",
    ].includes(warning),
  );
}

function isTimerSliceRecoverySegment(segment: SegmentComparisonEntryAudit): boolean {
  if (!isWorkCoverage(segment.coverage)) return false;
  if (!segmentHasUsablePace(segment)) return false;
  if (segment.is_rest === true) return false;
  return segment.segment_type === "recovery";
}

function isTimerSliceIntervalSegment(segment: SegmentComparisonEntryAudit): boolean {
  if (!isWorkCoverage(segment.coverage)) return false;
  if (!segmentHasUsablePace(segment)) return false;
  if (segment.is_rest === true) return false;
  if (segment.segment_type === "recovery") return false;
  if (NON_WORK_SEGMENT_TYPES.has(segment.segment_type ?? "")) return false;
  return segment.segment_type === "interval";
}

function averageNumeric(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianNumeric(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function paceCoefficientOfVariationPct(paces: number[]): number | null {
  if (paces.length < 2) return null;
  const mean = averageNumeric(paces);
  if (mean === null || mean <= 0) return null;
  const variance =
    paces.reduce((sum, pace) => sum + (pace - mean) ** 2, 0) / (paces.length - 1);
  return (Math.sqrt(variance) / mean) * 100;
}

function extractIntervalWorkPaceTarget(
  segments: SegmentComparisonEntryAudit[],
): SegmentPaceTargetAudit | null {
  for (const segment of segments) {
    const target = segment.planned_targets?.pace_min_per_km;
    if (target && target.fast_min_per_km > 0 && target.slow_min_per_km > 0) {
      return target;
    }
  }
  return null;
}

function paceWithinTarget(pace: number, target: SegmentPaceTargetAudit): boolean {
  return pace >= target.fast_min_per_km && pace <= target.slow_min_per_km;
}

function distanceToTargetMid(pace: number, target: SegmentPaceTargetAudit): number {
  const mid = (target.fast_min_per_km + target.slow_min_per_km) / 2;
  return Math.abs(pace - mid);
}

function buildTimerSliceSegmentStats(segments: SegmentComparisonEntryAudit[]): {
  avgPaceMin: number | null;
  medianPaceMin: number | null;
  avgHr: number | null;
  paceCvPct: number | null;
  paceSpreadPct: number | null;
  count: number;
} {
  const paces = segments
    .map((segment) => segmentPaceMinPerKm(segment))
    .filter((pace): pace is number => pace !== null);
  const hrValues = segments
    .map((segment) => segment.actual?.avg_hr)
    .filter((hr): hr is number => hr != null && hr > 0);
  const avgPaceMin = averageNumeric(paces);
  const medianPaceMin = medianNumeric(paces);
  const fastestPace = paces.length > 0 ? Math.min(...paces) : null;
  const slowestPace = paces.length > 0 ? Math.max(...paces) : null;
  const paceSpreadPct =
    fastestPace !== null && slowestPace !== null && fastestPace > 0
      ? ((slowestPace - fastestPace) / fastestPace) * 100
      : null;

  return {
    avgPaceMin,
    medianPaceMin,
    avgHr: hrValues.length > 0 ? Math.round(averageNumeric(hrValues)!) : null,
    paceCvPct: paceCoefficientOfVariationPct(paces),
    paceSpreadPct,
    count: segments.length,
  };
}

function detectTimerSliceMisalignment(input: {
  timerSliceWork: SegmentComparisonEntryAudit[];
  timerSliceRecovery: SegmentComparisonEntryAudit[];
  selectedWorkAvgPaceMin: number | null;
}): {
  diagnostics: SegmentMatchingDiagnostic[];
  warnings: string[];
} {
  const diagnostics: SegmentMatchingDiagnostic[] = [];
  const warnings: string[] = [];

  const workStats = buildTimerSliceSegmentStats(input.timerSliceWork);
  const recoveryStats = buildTimerSliceSegmentStats(input.timerSliceRecovery);
  if (workStats.count === 0 || recoveryStats.count === 0) {
    return { diagnostics, warnings };
  }

  const workPaceForCompare = workStats.medianPaceMin ?? workStats.avgPaceMin;
  const recoveryPaceForCompare = recoveryStats.medianPaceMin ?? recoveryStats.avgPaceMin;

  if (
    workPaceForCompare !== null &&
    recoveryPaceForCompare !== null &&
    recoveryPaceForCompare < workPaceForCompare
  ) {
    const workPaceText = formatPaceText(workPaceForCompare);
    const recoveryPaceText = formatPaceText(recoveryPaceForCompare);
    diagnostics.push({
      code: "work_recovery_pace_inversion",
      severity: "warning",
      detail: `Recovery timer-slice pace (${recoveryPaceText}) is faster than work (${workPaceText}).`,
    });
    warnings.push(`recovery faster than work (${recoveryPaceText} vs ${workPaceText})`);
  }

  if (
    workStats.avgHr !== null &&
    recoveryStats.avgHr !== null &&
    recoveryStats.avgHr > workStats.avgHr + WORK_RECOVERY_HR_INVERSION_BPM
  ) {
    diagnostics.push({
      code: "work_recovery_hr_inversion",
      severity: "warning",
      detail: `Recovery avg HR (${recoveryStats.avgHr} bpm) exceeds work avg HR (${workStats.avgHr} bpm) by more than ${WORK_RECOVERY_HR_INVERSION_BPM} bpm.`,
    });
    warnings.push(
      `recovery avg HR higher than work (${recoveryStats.avgHr} vs ${workStats.avgHr} bpm)`,
    );
  }

  const workTarget = extractIntervalWorkPaceTarget(input.timerSliceWork);
  if (workTarget && workPaceForCompare !== null && recoveryPaceForCompare !== null) {
    const workMissesTarget =
      !paceWithinTarget(workPaceForCompare, workTarget) ||
      input.timerSliceWork.filter((segment) => segment.pace_vs_target?.status === "too_slow").length >=
        Math.ceil(input.timerSliceWork.length / 2);
    const recoveryCloserToWorkTarget =
      distanceToTargetMid(recoveryPaceForCompare, workTarget) + WORK_TARGET_RECOVERY_PROXIMITY_MIN_PER_KM <
      distanceToTargetMid(workPaceForCompare, workTarget);
    const recoveryHitsWorkTarget = paceWithinTarget(recoveryPaceForCompare, workTarget);

    if (workMissesTarget && (recoveryHitsWorkTarget || recoveryCloserToWorkTarget)) {
      diagnostics.push({
        code: "work_target_miss_recovery_target_hit",
        severity: "warning",
        detail: `Work timer-slice rows miss planned pace target (${formatPaceText(workTarget.fast_min_per_km)}–${formatPaceText(workTarget.slow_min_per_km)}), while recovery rows are closer to the work target.`,
      });
      warnings.push("work rows miss planned pace target while recovery rows match work target better");
    }
  }

  if (
    (workStats.paceSpreadPct !== null && workStats.paceSpreadPct > PACE_SPREAD_WARNING_PCT) ||
    (workStats.paceCvPct !== null && workStats.paceCvPct > HIGH_WORK_PACE_CV_PCT)
  ) {
    const spreadParts: string[] = [];
    if (workStats.paceSpreadPct !== null) {
      spreadParts.push(`spread ${workStats.paceSpreadPct.toFixed(1)}%`);
    }
    if (workStats.paceCvPct !== null) {
      spreadParts.push(`CV ${workStats.paceCvPct.toFixed(1)}%`);
    }
    diagnostics.push({
      code: "high_work_pace_spread",
      severity: "info",
      detail: `Work timer-slice pace dispersion is high (${spreadParts.join(", ")}).`,
    });
  }

  const strongSignals = new Set([
    "work_recovery_pace_inversion",
    "work_recovery_hr_inversion",
    "work_target_miss_recovery_target_hit",
  ]);
  const strongCount = diagnostics.filter((entry) => strongSignals.has(entry.code)).length;
  const hasPaceInversion = diagnostics.some((entry) => entry.code === "work_recovery_pace_inversion");
  const hasTargetMiss = diagnostics.some((entry) => entry.code === "work_target_miss_recovery_target_hit");

  if (strongCount >= 2 || (hasPaceInversion && hasTargetMiss)) {
    diagnostics.push({
      code: "possible_timer_slice_misalignment",
      severity: "critical",
      detail:
        "Multiple timer-slice inversions suggest work/recovery windows are likely misaligned; do not trust timer-slice work pace as final.",
    });
    warnings.push("possible_timer_slice_misalignment");
    if (input.selectedWorkAvgPaceMin !== null) {
      warnings.push(
        `do not trust ${formatPaceText(input.selectedWorkAvgPaceMin)} as final work pace — timer-slice misalignment likely`,
      );
    }
  }

  return { diagnostics, warnings };
}

function formatPaceTargetRange(target: SegmentPaceTargetAudit): string {
  return `${formatPaceText(target.fast_min_per_km)}–${formatPaceText(target.slow_min_per_km)}`;
}

function segmentDurationMinutes(segment: SegmentComparisonEntryAudit): number | null {
  const actualMinutes = segment.actual?.duration_minutes;
  if (actualMinutes != null && actualMinutes > 0) return actualMinutes;
  const plannedMinutes = segment.planned_duration_minutes;
  if (plannedMinutes != null && plannedMinutes > 0) return plannedMinutes;
  return null;
}

function segmentDurationSeconds(segment: SegmentComparisonEntryAudit): number | null {
  const minutes = segmentDurationMinutes(segment);
  return minutes !== null ? Math.round(minutes * 60) : null;
}

function paceCloseToTarget(pace: number, target: SegmentPaceTargetAudit): boolean {
  if (paceWithinTarget(pace, target)) return true;
  return (
    pace >= target.fast_min_per_km - RESCUE_TARGET_NEAR_BAND_MIN_PER_KM &&
    pace <= target.slow_min_per_km + RESCUE_TARGET_NEAR_BAND_MIN_PER_KM
  );
}

function rescueMinDurationMinutesForRow(
  segment: SegmentComparisonEntryAudit,
  defaultMinDurationMinutes: number,
): number {
  if (
    segment.segment_type === "recovery" &&
    segment.repeat_group_id &&
    segment.repeat_iteration != null
  ) {
    return Math.min(defaultMinDurationMinutes, RESCUE_MISALIGNED_RECOVERY_MIN_DURATION_MINUTES);
  }
  return defaultMinDurationMinutes;
}

function isRescueCandidateRow(segment: SegmentComparisonEntryAudit, minDurationMinutes: number): boolean {
  if (!isWorkCoverage(segment.coverage)) return false;
  if (!segmentHasUsablePace(segment)) return false;
  if (segment.is_rest === true) return false;
  if (RESCUE_EXCLUDED_SEGMENT_TYPES.has(segment.segment_type ?? "")) return false;
  const duration = segmentDurationMinutes(segment);
  const minForRow = rescueMinDurationMinutesForRow(segment, minDurationMinutes);
  if (duration !== null && duration < minForRow) return false;
  if (segment.repeat_group_id && segment.repeat_iteration != null) return true;
  if (segment.segment_type === "interval") return true;
  if (segment.segment_type === "recovery") return true;
  return false;
}

function scoreRescueCandidateRow(input: {
  segment: SegmentComparisonEntryAudit;
  target: SegmentPaceTargetAudit;
  baselineHr: number | null;
}): number {
  const pace = segmentPaceMinPerKm(input.segment);
  if (pace === null) return Number.POSITIVE_INFINITY;
  let score = distanceToTargetMid(pace, input.target);
  if (input.segment.coverage !== "full") score += 0.08;
  const hr = input.segment.actual?.avg_hr;
  if (hr != null && hr > 0 && input.baselineHr !== null && hr >= input.baselineHr + RESCUE_HR_SUPPORT_MARGIN_BPM) {
    score -= 0.04;
  }
  if (paceCloseToTarget(pace, input.target)) score -= 0.06;
  if (input.segment.segment_type === "recovery") score -= 0.02;
  return score;
}

function buildRescueRowReason(segment: SegmentComparisonEntryAudit, target: SegmentPaceTargetAudit): string {
  const pace = segmentPaceMinPerKm(segment);
  const parts: string[] = [];
  if (pace !== null && paceCloseToTarget(pace, target)) {
    parts.push("closest to planned work target");
  } else if (pace !== null) {
    parts.push("near planned work target");
  }
  if (segment.coverage === "full") parts.push("full coverage");
  if (segment.segment_type === "recovery") parts.push("recovery-labeled row");
  if (segment.segment_type === "interval") parts.push("interval-labeled row");
  return parts.length > 0 ? parts.join("; ") : "target-proximity candidate";
}

type FitLapLike = {
  total_timer_time?: number;
  total_elapsed_time?: number;
  total_distance?: number;
  avg_heart_rate?: number;
  avg_speed?: number;
  enhanced_avg_speed?: number;
  lap_trigger?: string;
  event?: string;
  event_type?: string;
};

type FitLapRecord = {
  lap_index: number;
  duration_seconds: number;
  distance_meters: number | null;
  pace_min_per_km: number | null;
  avg_hr: number | null;
  lap_trigger: string | null;
};

type FitLapGroupCandidate = {
  lap_indices: number[];
  duration_seconds: number;
  distance_meters: number | null;
  pace_min_per_km: number | null;
  avg_hr: number | null;
  lap_trigger: string | null;
  merge_strategy: "single" | "distance_plus_time";
};

const fitLapLoadCache = new Map<string, FitLapRecord[] | null>();

function createFitParser(): FitParser {
  return new FitParser({
    mode: "list",
    lengthUnit: "m",
    speedUnit: "m/s",
    elapsedRecordField: true,
  });
}

function fitLapDurationSeconds(lap: FitLapLike): number | null {
  if (typeof lap.total_timer_time === "number" && Number.isFinite(lap.total_timer_time) && lap.total_timer_time > 0) {
    return lap.total_timer_time;
  }
  if (
    typeof lap.total_elapsed_time === "number" &&
    Number.isFinite(lap.total_elapsed_time) &&
    lap.total_elapsed_time > 0
  ) {
    return lap.total_elapsed_time;
  }
  return null;
}

function fitLapPaceMinPerKm(lap: FitLapLike, durationSeconds: number): number | null {
  if (
    typeof lap.total_distance === "number" &&
    Number.isFinite(lap.total_distance) &&
    lap.total_distance > 0 &&
    durationSeconds > 0
  ) {
    return (durationSeconds / 60) / (lap.total_distance / 1000);
  }

  const speed =
    typeof lap.enhanced_avg_speed === "number" && Number.isFinite(lap.enhanced_avg_speed) && lap.enhanced_avg_speed > 0
      ? lap.enhanced_avg_speed
      : typeof lap.avg_speed === "number" && Number.isFinite(lap.avg_speed) && lap.avg_speed > 0
        ? lap.avg_speed
        : null;
  if (speed === null || speed <= 0) return null;
  return (1000 / speed) / 60;
}

function normalizeFitLaps(rawLaps: unknown[]): FitLapRecord[] {
  const normalized: FitLapRecord[] = [];
  rawLaps.forEach((rawLap, lapIndex) => {
    if (!rawLap || typeof rawLap !== "object") return;
    const lap = rawLap as FitLapLike;
    const durationSeconds = fitLapDurationSeconds(lap);
    if (durationSeconds === null || durationSeconds <= 0) return;
    normalized.push({
      lap_index: lapIndex,
      duration_seconds: durationSeconds,
      distance_meters:
        typeof lap.total_distance === "number" && Number.isFinite(lap.total_distance) && lap.total_distance > 0
          ? lap.total_distance
          : null,
      pace_min_per_km: fitLapPaceMinPerKm(lap, durationSeconds),
      avg_hr:
        typeof lap.avg_heart_rate === "number" && Number.isFinite(lap.avg_heart_rate) && lap.avg_heart_rate > 0
          ? lap.avg_heart_rate
          : null,
      lap_trigger: typeof lap.lap_trigger === "string" ? lap.lap_trigger : null,
    });
  });
  return normalized;
}

function getMatchedFitDetailSource(
  workout: WeeklySummaryWorkout,
): { zip_path: string; entry_name: string } | null {
  const detailSource = workout.completed?.detail_source;
  if (
    !detailSource ||
    detailSource.type !== "workout_file_fit" ||
    detailSource.match_status !== "matched" ||
    !detailSource.zip_path ||
    !detailSource.entry_name
  ) {
    return null;
  }
  return {
    zip_path: detailSource.zip_path,
    entry_name: detailSource.entry_name,
  };
}

async function readWorkoutFitEntryBuffer(input: {
  zip_path: string;
  entry_name: string;
}): Promise<Buffer> {
  const zipPath = path.join(toolRoot, input.zip_path);
  const directory = await unzipper.Open.file(zipPath);
  const entry = directory.files.find(
    (candidate) => candidate.type === "File" && candidate.path === input.entry_name,
  );
  if (!entry) {
    throw new Error(`ZIP entry not found: ${input.entry_name}`);
  }

  const entryBuffer = await entry.buffer();
  if (input.entry_name.toLowerCase().endsWith(".gz")) {
    return await gunzip(entryBuffer);
  }
  return entryBuffer;
}

async function loadWorkoutFitLaps(workout: WeeklySummaryWorkout): Promise<FitLapRecord[] | null> {
  const detailSource = getMatchedFitDetailSource(workout);
  if (!detailSource) return null;

  const cacheKey = `${detailSource.zip_path}::${detailSource.entry_name}`;
  if (fitLapLoadCache.has(cacheKey)) {
    return fitLapLoadCache.get(cacheKey) ?? null;
  }

  try {
    const fitBuffer = await readWorkoutFitEntryBuffer(detailSource);
    const parsedFit = (await createFitParser().parseAsync(fitBuffer)) as { laps?: unknown[] };
    const rawLaps = Array.isArray(parsedFit.laps) ? parsedFit.laps : [];
    const normalized = normalizeFitLaps(rawLaps);
    fitLapLoadCache.set(cacheKey, normalized);
    return normalized;
  } catch {
    fitLapLoadCache.set(cacheKey, null);
    return null;
  }
}

function durationMatchesRepDuration(durationSeconds: number, repDurationMin: number | null): boolean {
  if (repDurationMin === null || repDurationMin <= 0) return durationSeconds >= 240;
  const targetSeconds = repDurationMin * 60;
  const tolerance = Math.max(45, targetSeconds * FIT_LAP_WORK_DURATION_TOLERANCE_RATIO);
  return Math.abs(durationSeconds - targetSeconds) <= tolerance;
}

function isFitLapRecoveryCandidate(
  group: FitLapGroupCandidate,
  workTarget: SegmentPaceTargetAudit | null,
): boolean {
  if (group.duration_seconds > FIT_LAP_RECOVERY_MAX_DURATION_S) return false;
  if (group.pace_min_per_km === null || workTarget === null) {
    return group.duration_seconds <= FIT_LAP_RECOVERY_MAX_DURATION_S;
  }
  return group.pace_min_per_km > workTarget.slow_min_per_km + FIT_LAP_RECOVERY_PACE_BUFFER_MIN_PER_KM;
}

function isFitLapWarmupCandidate(
  group: FitLapGroupCandidate,
  workTarget: SegmentPaceTargetAudit | null,
): boolean {
  if (group.lap_indices[0] !== 0) return false;
  if (workTarget === null || group.pace_min_per_km === null) return group.duration_seconds >= 360;
  return group.pace_min_per_km > workTarget.slow_min_per_km + FIT_LAP_WARMUP_PACE_BUFFER_MIN_PER_KM;
}

function buildFitLapGroupCandidates(laps: FitLapRecord[], repDurationMin: number | null): FitLapGroupCandidate[] {
  const groups: FitLapGroupCandidate[] = [];

  for (let index = 0; index < laps.length; index += 1) {
    const lap = laps[index]!;
    if (lap.pace_min_per_km === null) continue;

    if (durationMatchesRepDuration(lap.duration_seconds, repDurationMin)) {
      groups.push({
        lap_indices: [lap.lap_index],
        duration_seconds: lap.duration_seconds,
        distance_meters: lap.distance_meters,
        pace_min_per_km: lap.pace_min_per_km,
        avg_hr: lap.avg_hr,
        lap_trigger: lap.lap_trigger,
        merge_strategy: "single",
      });
    }

    const nextLap = laps[index + 1];
    if (
      !nextLap ||
      lap.lap_trigger !== "distance" ||
      nextLap.lap_trigger !== "time" ||
      lap.duration_seconds < FIT_LAP_MIN_DISTANCE_LAP_S ||
      nextLap.duration_seconds <= 0 ||
      nextLap.duration_seconds > FIT_LAP_MERGE_MAX_SECOND_LAP_S ||
      lap.pace_min_per_km === null ||
      nextLap.pace_min_per_km === null
    ) {
      continue;
    }

    const combinedDuration = lap.duration_seconds + nextLap.duration_seconds;
    if (!durationMatchesRepDuration(combinedDuration, repDurationMin)) continue;

    const combinedDistance =
      (lap.distance_meters ?? 0) + (nextLap.distance_meters ?? 0) > 0
        ? (lap.distance_meters ?? 0) + (nextLap.distance_meters ?? 0)
        : null;
    const combinedPace =
      combinedDistance !== null && combinedDistance > 0
        ? (combinedDuration / 60) / (combinedDistance / 1000)
        : averageNumeric([lap.pace_min_per_km, nextLap.pace_min_per_km]);
    if (combinedPace === null) continue;

    const hrValues = [lap.avg_hr, nextLap.avg_hr].filter((hr): hr is number => hr != null && hr > 0);
    groups.push({
      lap_indices: [lap.lap_index, nextLap.lap_index],
      duration_seconds: combinedDuration,
      distance_meters: combinedDistance,
      pace_min_per_km: combinedPace,
      avg_hr: hrValues.length > 0 ? averageNumeric(hrValues) : null,
      lap_trigger: `${lap.lap_trigger}+${nextLap.lap_trigger}`,
      merge_strategy: "distance_plus_time",
    });
  }

  return groups;
}

function scoreFitLapGroupCandidate(
  group: FitLapGroupCandidate,
  workTarget: SegmentPaceTargetAudit,
  repDurationMin: number | null,
): number {
  if (group.pace_min_per_km === null) return Number.POSITIVE_INFINITY;
  let score = distanceToTargetMid(group.pace_min_per_km, workTarget);
  if (paceWithinTarget(group.pace_min_per_km, workTarget)) score -= 0.08;
  if (repDurationMin !== null) {
    score += Math.abs(group.duration_seconds - repDurationMin * 60) / 600;
  }
  if (group.merge_strategy === "distance_plus_time") score -= 0.03;
  return score;
}

function buildFitLapSelectedReason(
  group: FitLapGroupCandidate,
  workTarget: SegmentPaceTargetAudit,
): string {
  const parts: string[] = [];
  if (group.pace_min_per_km !== null && paceWithinTarget(group.pace_min_per_km, workTarget)) {
    parts.push("pace within planned work target");
  } else if (group.pace_min_per_km !== null) {
    parts.push("closest plausible work lap to planned target");
  }
  if (group.merge_strategy === "distance_plus_time") {
    parts.push("merged distance+time lap pair matches planned rep duration");
  } else {
    parts.push("single lap matches planned rep duration");
  }
  if (group.lap_trigger) parts.push(`lap_trigger=${group.lap_trigger}`);
  return parts.join("; ");
}

function parsePaceRangeSpreadPct(paceRange: string | null): number | null {
  if (!paceRange) return null;
  const parts = paceRange.split(/[–-]/).map((part) => part.trim());
  if (parts.length !== 2) return null;
  const fastest = parsePaceTextToMinPerKm(parts[0]!);
  const slowest = parsePaceTextToMinPerKm(parts[1]!);
  if (fastest === null || slowest === null || fastest <= 0) return null;
  return ((slowest - fastest) / fastest) * 100;
}

function selectedFitLapLapsHavePlausibleDuration(
  candidate: FitLapCandidate,
  repDurationMin: number | null,
): boolean {
  if (candidate.selected_laps.length === 0) return false;
  return candidate.selected_laps.every((lap) =>
    durationMatchesRepDuration(lap.duration_seconds, repDurationMin),
  );
}

function hasSeriousFitLapRejectionDiagnostics(candidate: FitLapCandidate): boolean {
  if (candidate.rejected_reason && SERIOUS_FIT_LAP_REJECTION_REASONS.has(candidate.rejected_reason)) {
    return true;
  }
  return candidate.diagnostics.some(
    (entry) =>
      entry.includes("no matched workout_file_fit") ||
      entry.includes("FIT file load/parse failed") ||
      entry.includes("fit.parsed.laps[] is empty"),
  );
}

function isFitLapCandidatePromotionEligible(input: {
  candidate: FitLapCandidate;
  hasMisalignment: boolean;
  repDurationMin: number | null;
}): boolean {
  const candidate = input.candidate;
  if (!input.hasMisalignment || !candidate.available) return false;
  if (candidate.confidence !== "medium" && candidate.confidence !== "high") return false;
  if (!candidate.candidate_work_avg_pace) return false;
  if (hasSeriousFitLapRejectionDiagnostics(candidate)) return false;
  if (!selectedFitLapLapsHavePlausibleDuration(candidate, input.repDurationMin)) return false;

  const spreadPct = parsePaceRangeSpreadPct(candidate.candidate_work_pace_range);
  if (spreadPct !== null && spreadPct > PACE_SPREAD_WARNING_PCT) return false;

  const expected = candidate.expected_work_reps_count;
  if (expected !== null && expected > 0) {
    return candidate.selected_laps_count >= expected * FIT_LAP_PROMOTION_REP_RATIO;
  }
  return candidate.selected_laps_count > 0;
}

function promoteSegmentKeyWorkoutWithFitLapCandidate(input: {
  workout: SegmentKeyWorkout;
  segmentMatching: SegmentMatchingDiagnostics;
  fitLap: FitLapCandidate;
  repDurationMin: number | null;
  wholeWorkoutPaceMin: number | null;
  dataQualityFlags: string[];
  roleLimitations: string[];
}): { workout: SegmentKeyWorkout; segmentMatching: SegmentMatchingDiagnostics } {
  const paces = input.fitLap.selected_laps
    .map((lap) => (lap.pace ? parsePaceTextToMinPerKm(lap.pace) : null))
    .filter((pace): pace is number => pace !== null);
  const hrValues = input.fitLap.selected_laps
    .map((lap) => lap.avg_hr)
    .filter((hr): hr is number => hr != null && hr > 0);

  const workAvgPaceMin =
    input.fitLap.candidate_work_avg_pace !== null
      ? parsePaceTextToMinPerKm(input.fitLap.candidate_work_avg_pace)
      : paces.length > 0
        ? averageNumeric(paces)
        : null;
  const rangeSpread = parsePaceRangeSpreadPct(input.fitLap.candidate_work_pace_range);
  const fastestPace =
    rangeSpread !== null && input.fitLap.candidate_work_pace_range
      ? parsePaceTextToMinPerKm(input.fitLap.candidate_work_pace_range.split(/[–-]/)[0]!.trim())
      : paces.length > 0
        ? Math.min(...paces)
        : null;
  const slowestPace =
    rangeSpread !== null && input.fitLap.candidate_work_pace_range
      ? parsePaceTextToMinPerKm(input.fitLap.candidate_work_pace_range.split(/[–-]/)[1]!.trim())
      : paces.length > 0
        ? Math.max(...paces)
        : null;
  const fadeMetrics = computeRepFadeMetrics(paces);

  const workRepsPlanned = input.fitLap.expected_work_reps_count ?? input.workout.work_reps_planned;
  const workRepsCompared = input.fitLap.selected_laps_count;
  const completionRatio =
    workRepsPlanned !== null && workRepsPlanned > 0
      ? Math.round((workRepsCompared / workRepsPlanned) * 100) / 100
      : null;

  const evidenceWarnings = collectSegmentEvidenceWarnings({
    completionRatio,
    fastestPace,
    slowestPace,
    workAvgPaceMin,
    wholeWorkoutPaceMin: input.wholeWorkoutPaceMin,
    paces,
    fadePct: fadeMetrics.last_rep_vs_first_rep_pct,
    dataQualityFlags: input.dataQualityFlags,
  });
  const { verdict, usable_for_prediction } = deriveSegmentKeyWorkoutVerdict({
    segmentEvidenceAvailable: true,
    completionRatio,
    fadePct: fadeMetrics.last_rep_vs_first_rep_pct,
    evidenceWarnings,
  });

  const workAvgPace = workAvgPaceMin !== null ? formatPaceText(workAvgPaceMin) : null;
  const limitations = [...input.roleLimitations];
  if (input.workout.evidence_type === "repeat_group_inferred") {
    limitations.push("Рабочие отрезки выведены из repeat-блока плана (mislabeled recovery в segment_comparison).");
  }
  if (input.dataQualityFlags.length > 0) {
    limitations.push(`Флаги качества: ${input.dataQualityFlags.join(", ")}.`);
  }
  limitations.push(FIT_LAP_PROMOTION_DIAGNOSTIC_NOTE);
  if (!usable_for_prediction) {
    limitations.push("Не использовать как позитивное evidence для прогноза.");
  }

  const promotedFitLap: FitLapCandidate = {
    ...input.fitLap,
    shadow_mode: false,
    prediction_eligible: true,
  };
  const segmentMatching: SegmentMatchingDiagnostics = {
    ...input.segmentMatching,
    prediction_eligible: usable_for_prediction,
    warnings: [
      ...input.segmentMatching.warnings.filter(
        (warning) => !warning.startsWith("do not trust ") && warning !== "timer-slice values are observation-only",
      ),
      "timer-slice values are observation-only",
      "timer_slice_misalignment_detected",
      FIT_LAP_PROMOTION_DIAGNOSTIC_NOTE,
    ],
    fit_lap_candidate: promotedFitLap,
  };

  return {
    workout: {
      ...input.workout,
      usable_for_prediction,
      extraction_strategy: input.fitLap.strategy,
      evidence_source: "fit_lap_candidate",
      original_timer_slice_work_avg_pace:
        input.segmentMatching.original_timer_slice_comparison.work_avg_pace,
      work_reps_compared: workRepsCompared,
      work_reps_planned: workRepsPlanned,
      work_avg_pace: workAvgPace,
      work_fastest_pace: fastestPace !== null ? formatPaceText(fastestPace) : null,
      work_slowest_pace: slowestPace !== null ? formatPaceText(slowestPace) : null,
      work_avg_hr:
        input.fitLap.candidate_work_avg_hr ??
        (hrValues.length > 0 ? Math.round(hrValues.reduce((sum, hr) => sum + hr, 0) / hrValues.length) : null),
      work_max_hr: hrValues.length > 0 ? Math.max(...hrValues) : null,
      rep_to_rep_fade_pct: fadeMetrics.rep_to_rep_fade_pct,
      last_rep_vs_first_rep_pct: fadeMetrics.last_rep_vs_first_rep_pct,
      completion_ratio: completionRatio,
      verdict,
      takeaway: buildSegmentKeyWorkoutTakeaway({
        verdict,
        role: input.workout.role,
        workAvgPace,
        workRepsCompared,
        workRepsPlanned,
        evidenceWarnings,
      }),
      limitations,
      segment_matching: segmentMatching,
    },
    segmentMatching,
  };
}

function buildFitLapCandidate(input: {
  workout: WeeklySummaryWorkout;
  fitLaps: FitLapRecord[] | null;
  hasMisalignment: boolean;
  workTarget: SegmentPaceTargetAudit | null;
  expectedWorkReps: number | null;
  repDurationMin: number | null;
}): FitLapCandidate | undefined {
  if (!input.hasMisalignment) return undefined;

  const detailSource = getMatchedFitDetailSource(input.workout);
  const diagnostics: string[] = [
    "weekly-summary does not embed lap arrays; FIT laps loaded from completed.detail_source zip entry",
    `field paths: ${FIT_LAP_FIELD_PATHS.join(", ")}`,
  ];

  if (!detailSource) {
    return {
      available: false,
      shadow_mode: true,
      prediction_eligible: false,
      confidence: "none",
      strategy: "fit_lap_fuzzy",
      selected_laps_count: 0,
      expected_work_reps_count: input.expectedWorkReps,
      candidate_work_avg_pace: null,
      candidate_work_pace_range: null,
      candidate_work_avg_hr: null,
      selected_laps: [],
      diagnostics: [
        ...diagnostics,
        "no matched workout_file_fit in workouts[].completed.detail_source",
      ],
      rejected_reason: "lap_records_not_available_in_parsed_data",
    };
  }

  diagnostics.push(`fit source: ${detailSource.zip_path}::${detailSource.entry_name}`);

  if (input.fitLaps === null) {
    return {
      available: false,
      shadow_mode: true,
      prediction_eligible: false,
      confidence: "none",
      strategy: "fit_lap_fuzzy",
      selected_laps_count: 0,
      expected_work_reps_count: input.expectedWorkReps,
      candidate_work_avg_pace: null,
      candidate_work_pace_range: null,
      candidate_work_avg_hr: null,
      selected_laps: [],
      diagnostics: [...diagnostics, "FIT file load/parse failed for matched detail_source entry"],
      rejected_reason: "lap_records_not_available_in_parsed_data",
    };
  }

  diagnostics.push(`parsed fit laps count: ${input.fitLaps.length}`);

  if (input.fitLaps.length === 0) {
    return {
      available: false,
      shadow_mode: true,
      prediction_eligible: false,
      confidence: "none",
      strategy: "fit_lap_fuzzy",
      selected_laps_count: 0,
      expected_work_reps_count: input.expectedWorkReps,
      candidate_work_avg_pace: null,
      candidate_work_pace_range: null,
      candidate_work_avg_hr: null,
      selected_laps: [],
      diagnostics: [...diagnostics, "fit.parsed.laps[] is empty"],
      rejected_reason: "lap_records_not_available_in_parsed_data",
    };
  }

  if (!input.workTarget) {
    return {
      available: false,
      shadow_mode: true,
      prediction_eligible: false,
      confidence: "none",
      strategy: "fit_lap_fuzzy",
      selected_laps_count: 0,
      expected_work_reps_count: input.expectedWorkReps,
      candidate_work_avg_pace: null,
      candidate_work_pace_range: null,
      candidate_work_avg_hr: null,
      selected_laps: [],
      diagnostics: [...diagnostics, "no planned work pace target in segment_comparison"],
      rejected_reason: "no_planned_work_target",
    };
  }

  const allGroups = buildFitLapGroupCandidates(input.fitLaps, input.repDurationMin);
  const workCandidates = allGroups.filter(
    (group) =>
      group.pace_min_per_km !== null &&
      !isFitLapRecoveryCandidate(group, input.workTarget) &&
      !isFitLapWarmupCandidate(group, input.workTarget),
  );

  diagnostics.push(`work-like lap groups after warmup/recovery exclusion: ${workCandidates.length}`);

  const sortedCandidates = [...workCandidates].sort(
    (left, right) =>
      scoreFitLapGroupCandidate(left, input.workTarget!, input.repDurationMin) -
      scoreFitLapGroupCandidate(right, input.workTarget!, input.repDurationMin),
  );

  const selected: FitLapGroupCandidate[] = [];
  const usedLapIndices = new Set<number>();
  for (const candidate of sortedCandidates) {
    if (candidate.lap_indices.some((lapIndex) => usedLapIndices.has(lapIndex))) continue;
    selected.push(candidate);
    for (const lapIndex of candidate.lap_indices) usedLapIndices.add(lapIndex);
    if (input.expectedWorkReps !== null && selected.length >= input.expectedWorkReps) break;
  }

  if (selected.length > 1) {
    selected.sort((left, right) => left.lap_indices[0]! - right.lap_indices[0]!);
  }

  const maxRows = input.expectedWorkReps ?? selected.length;
  const trimmed = selected.slice(0, maxRows > 0 ? maxRows : selected.length);
  const paces = trimmed
    .map((group) => group.pace_min_per_km)
    .filter((pace): pace is number => pace !== null);
  const hrValues = trimmed
    .map((group) => group.avg_hr)
    .filter((hr): hr is number => hr != null && hr > 0);
  const candidateAvgPaceMin = averageNumeric(paces);
  const fastestPace = paces.length > 0 ? Math.min(...paces) : null;
  const slowestPace = paces.length > 0 ? Math.max(...paces) : null;
  const spreadPct =
    fastestPace !== null && slowestPace !== null && fastestPace > 0
      ? ((slowestPace - fastestPace) / fastestPace) * 100
      : null;
  const candidateAvgHr = hrValues.length > 0 ? Math.round(averageNumeric(hrValues)!) : null;
  const repRatio =
    input.expectedWorkReps !== null && input.expectedWorkReps > 0
      ? trimmed.length / input.expectedWorkReps
      : null;
  const paceBandOk =
    candidateAvgPaceMin !== null && paceWithinTarget(candidateAvgPaceMin, input.workTarget);
  const spreadOk = spreadPct === null || spreadPct <= PACE_SPREAD_WARNING_PCT;
  const strategy: FitLapCandidate["strategy"] = trimmed.every(
    (group) => group.merge_strategy === "single",
  )
    ? "fit_lap_exact"
    : "fit_lap_fuzzy";

  const durationsPlausible = trimmed.every((group) =>
    durationMatchesRepDuration(group.duration_seconds, input.repDurationMin),
  );
  let confidence: FitLapCandidate["confidence"] = "none";
  if (trimmed.length > 0) {
    if (
      repRatio !== null &&
      repRatio >= FIT_LAP_HIGH_REP_RATIO &&
      paceBandOk &&
      spreadOk &&
      strategy === "fit_lap_exact" &&
      durationsPlausible
    ) {
      confidence = "high";
    } else if (
      repRatio !== null &&
      repRatio >= FIT_LAP_MEDIUM_REP_RATIO &&
      paceBandOk &&
      spreadOk &&
      durationsPlausible
    ) {
      confidence = "medium";
    } else {
      confidence = "low";
    }
  }

  const selectedLaps: FitLapSelectedLap[] = trimmed.map((group) => ({
    lap_index: group.lap_indices[0]!,
    lap_indices: group.lap_indices,
    duration_seconds: Math.round(group.duration_seconds),
    distance_meters:
      group.distance_meters !== null ? Math.round(group.distance_meters) : null,
    pace: group.pace_min_per_km !== null ? formatPaceText(group.pace_min_per_km) : null,
    avg_hr: group.avg_hr !== null ? Math.round(group.avg_hr) : null,
    lap_trigger: group.lap_trigger,
    reason: buildFitLapSelectedReason(group, input.workTarget!),
  }));

  if (trimmed.length === 0) {
    diagnostics.push("no plausible work lap groups matched planned rep duration and target pace");
  } else {
    diagnostics.push(`selected ${trimmed.length} lap group(s) using ${strategy}`);
  }

  return {
    available: trimmed.length > 0,
    shadow_mode: true,
    prediction_eligible: false,
    confidence,
    strategy,
    selected_laps_count: trimmed.length,
    expected_work_reps_count: input.expectedWorkReps,
    candidate_work_avg_pace:
      candidateAvgPaceMin !== null ? formatPaceText(candidateAvgPaceMin) : null,
    candidate_work_pace_range:
      fastestPace !== null && slowestPace !== null
        ? `${formatPaceText(fastestPace)}–${formatPaceText(slowestPace)}`
        : null,
    candidate_work_avg_hr: candidateAvgHr,
    selected_laps: selectedLaps,
    diagnostics,
    ...(trimmed.length === 0 ? { rejected_reason: "no_fit_lap_work_groups" } : {}),
  };
}

function buildTargetProximityRescueCandidate(input: {
  workout: WeeklySummaryWorkout;
  comparison: SegmentComparisonEntryAudit[];
  timerSliceWork: SegmentComparisonEntryAudit[];
  timerSliceRecovery: SegmentComparisonEntryAudit[];
  hasMisalignment: boolean;
}): TargetProximityRescueCandidate | undefined {
  if (!input.hasMisalignment) return undefined;

  const workTarget =
    extractIntervalWorkPaceTarget(input.timerSliceWork) ??
    extractIntervalWorkPaceTarget(input.comparison);
  if (!workTarget) {
    return {
      available: false,
      shadow_mode: true,
      prediction_eligible: false,
      confidence: "none",
      reason: "No planned work pace target in segment_comparison.",
      planned_work_target_pace_range: null,
      selected_segments_count: 0,
      expected_work_reps_count: countPlannedWorkReps(input.workout),
      candidate_work_avg_pace: null,
      candidate_work_pace_range: null,
      candidate_work_avg_hr: null,
      selected_rows: [],
      rejected_reason: "no_planned_work_target",
    };
  }

  const titleParsed = parseIntervalRepsFromTitle(input.workout.title);
  const minDurationMinutes = Math.max(
    RESCUE_MIN_DURATION_MINUTES,
    titleParsed.repDurationMin !== null
      ? titleParsed.repDurationMin * RESCUE_MIN_DURATION_RATIO_OF_REP
      : RESCUE_MIN_DURATION_MINUTES,
  );
  const expectedWorkReps = countPlannedWorkReps(input.workout);
  const recoveryStats = buildTimerSliceSegmentStats(input.timerSliceRecovery);
  const workStats = buildTimerSliceSegmentStats(input.timerSliceWork);
  const baselineHr = recoveryStats.avgHr ?? workStats.avgHr;

  const pool = input.comparison.filter((segment) => isRescueCandidateRow(segment, minDurationMinutes));
  const byIteration = new Map<number, SegmentComparisonEntryAudit[]>();
  for (const segment of pool) {
    const iteration = segment.repeat_iteration;
    if (iteration == null) continue;
    const bucket = byIteration.get(iteration) ?? [];
    bucket.push(segment);
    byIteration.set(iteration, bucket);
  }

  const selected: SegmentComparisonEntryAudit[] = [];
  const sortedIterations = [...byIteration.keys()].sort((left, right) => left - right);
  for (const iteration of sortedIterations) {
    const candidates = byIteration.get(iteration) ?? [];
    if (!candidates.length) continue;
    const best = [...candidates].sort(
      (left, right) =>
        scoreRescueCandidateRow({ segment: left, target: workTarget, baselineHr }) -
        scoreRescueCandidateRow({ segment: right, target: workTarget, baselineHr }),
    )[0]!;
    selected.push(best);
  }

  if (!selected.length) {
    const fallback = [...pool]
      .sort(
        (left, right) =>
          scoreRescueCandidateRow({ segment: left, target: workTarget, baselineHr }) -
          scoreRescueCandidateRow({ segment: right, target: workTarget, baselineHr }),
      )
      .slice(0, expectedWorkReps ?? pool.length);
    selected.push(...fallback);
  }

  const maxRows = expectedWorkReps ?? selected.length;
  const trimmed = selected.slice(0, maxRows > 0 ? maxRows : selected.length);
  const paces = trimmed
    .map((segment) => segmentPaceMinPerKm(segment))
    .filter((pace): pace is number => pace !== null);
  const hrValues = trimmed
    .map((segment) => segment.actual?.avg_hr)
    .filter((hr): hr is number => hr != null && hr > 0);

  const candidateAvgPaceMin = averageNumeric(paces);
  const fastestPace = paces.length > 0 ? Math.min(...paces) : null;
  const slowestPace = paces.length > 0 ? Math.max(...paces) : null;
  const spreadPct =
    fastestPace !== null && slowestPace !== null && fastestPace > 0
      ? ((slowestPace - fastestPace) / fastestPace) * 100
      : null;
  const candidateAvgHr = hrValues.length > 0 ? Math.round(averageNumeric(hrValues)!) : null;

  const repRatio =
    expectedWorkReps !== null && expectedWorkReps > 0 ? trimmed.length / expectedWorkReps : null;
  const paceBandOk =
    candidateAvgPaceMin !== null && paceCloseToTarget(candidateAvgPaceMin, workTarget);
  const spreadOk = spreadPct === null || spreadPct <= PACE_SPREAD_WARNING_PCT;
  const hrSupportsEffort =
    candidateAvgHr === null ||
    baselineHr === null ||
    candidateAvgHr >= baselineHr + RESCUE_HR_SUPPORT_MARGIN_BPM;

  let confidence: TargetProximityRescueCandidate["confidence"] = "none";
  let reason = "No target-proximity rescue rows matched planned work reps.";
  if (trimmed.length > 0) {
    if (
      repRatio !== null &&
      repRatio >= RESCUE_MEDIUM_REP_RATIO &&
      paceBandOk &&
      spreadOk &&
      hrSupportsEffort
    ) {
      confidence = "medium";
      reason =
        "Target-proximity rows cover most planned work reps with pace/HR consistent with harder work effort.";
    } else {
      confidence = "low";
      reason = "Some target-proximity rows found, but rep coverage, pace band, spread, or HR support is weak.";
    }
  }

  const selectedRows: TargetProximityRescueRow[] = trimmed.map((segment) => ({
    order: segment.order ?? null,
    segment_type: segment.segment_type ?? null,
    repeat_iteration: segment.repeat_iteration ?? null,
    coverage: segment.coverage ?? null,
    pace:
      segment.actual?.avg_pace_text ??
      (segmentPaceMinPerKm(segment) !== null ? formatPaceText(segmentPaceMinPerKm(segment)!) : null),
    avg_hr: segment.actual?.avg_hr ?? null,
    duration_seconds: segmentDurationSeconds(segment),
    reason: buildRescueRowReason(segment, workTarget),
  }));

  return {
    available: trimmed.length > 0,
    shadow_mode: true,
    prediction_eligible: false,
    confidence,
    reason,
    planned_work_target_pace_range: formatPaceTargetRange(workTarget),
    selected_segments_count: trimmed.length,
    expected_work_reps_count: expectedWorkReps,
    candidate_work_avg_pace:
      candidateAvgPaceMin !== null ? formatPaceText(candidateAvgPaceMin) : null,
    candidate_work_pace_range:
      fastestPace !== null && slowestPace !== null
        ? `${formatPaceText(fastestPace)}–${formatPaceText(slowestPace)}`
        : null,
    candidate_work_avg_hr: candidateAvgHr,
    selected_rows: selectedRows,
    ...(trimmed.length === 0 ? { rejected_reason: "no_target_proximity_rows" } : {}),
  };
}

function buildSegmentMatchingDiagnostics(input: {
  workout: WeeklySummaryWorkout;
  evidenceType: SegmentKeyWorkoutEvidenceType;
  selectedWorkSegments: SegmentComparisonEntryAudit[];
  selectedWorkAvgPaceMin: number | null;
  usableForPrediction: boolean;
  fitLaps: FitLapRecord[] | null;
}): SegmentMatchingDiagnostics | undefined {
  const comparison = asSegmentComparison(input.workout);
  if (!comparison.length) return undefined;

  const timerSliceWork = comparison.filter(isTimerSliceIntervalSegment);
  const timerSliceRecovery = comparison.filter(isTimerSliceRecoverySegment);
  const workStats = buildTimerSliceSegmentStats(timerSliceWork);
  const recoveryStats = buildTimerSliceSegmentStats(timerSliceRecovery);

  const selectedAvgPaceMin =
    input.selectedWorkAvgPaceMin ??
    averageNumeric(
      input.selectedWorkSegments
        .map((segment) => segmentPaceMinPerKm(segment))
        .filter((pace): pace is number => pace !== null),
    );

  const differsFromSelected =
    workStats.avgPaceMin !== null &&
    selectedAvgPaceMin !== null &&
    Math.abs(workStats.avgPaceMin - selectedAvgPaceMin) > 0.02;

  const originalTimerSliceComparison: SegmentMatchingOriginalTimerSliceComparison = {
    work_avg_pace: workStats.avgPaceMin !== null ? formatPaceText(workStats.avgPaceMin) : null,
    recovery_avg_pace:
      recoveryStats.avgPaceMin !== null ? formatPaceText(recoveryStats.avgPaceMin) : null,
    work_avg_hr: workStats.avgHr,
    recovery_avg_hr: recoveryStats.avgHr,
    work_segments_count: workStats.count,
    recovery_segments_count: recoveryStats.count,
    differs_from_selected: differsFromSelected,
  };

  const misalignment =
    input.evidenceType === "segment_comparison"
      ? detectTimerSliceMisalignment({
          timerSliceWork,
          timerSliceRecovery,
          selectedWorkAvgPaceMin: selectedAvgPaceMin,
        })
      : { diagnostics: [] as SegmentMatchingDiagnostic[], warnings: [] as string[] };

  const hasMisalignment = misalignment.diagnostics.some(
    (entry) => entry.code === "possible_timer_slice_misalignment",
  );

  const targetProximityRescueCandidate = buildTargetProximityRescueCandidate({
    workout: input.workout,
    comparison,
    timerSliceWork,
    timerSliceRecovery,
    hasMisalignment,
  });

  const titleParsed = parseIntervalRepsFromTitle(input.workout.title);
  const workTarget =
    extractIntervalWorkPaceTarget(timerSliceWork) ?? extractIntervalWorkPaceTarget(comparison);
  const fitLapCandidate = buildFitLapCandidate({
    workout: input.workout,
    fitLaps: input.fitLaps,
    hasMisalignment,
    workTarget,
    expectedWorkReps: countPlannedWorkReps(input.workout),
    repDurationMin: titleParsed.repDurationMin,
  });

  return {
    strategy: "timer_slice",
    confidence: hasMisalignment ? "low" : "medium",
    prediction_eligible: input.usableForPrediction,
    diagnostics: misalignment.diagnostics,
    warnings: [...misalignment.warnings, "timer-slice values are observation-only"],
    original_timer_slice_comparison: originalTimerSliceComparison,
    ...(targetProximityRescueCandidate
      ? { target_proximity_rescue_candidate: targetProximityRescueCandidate }
      : {}),
    ...(fitLapCandidate ? { fit_lap_candidate: fitLapCandidate } : {}),
  };
}

function buildSegmentKeyWorkoutTakeaway(input: {
  verdict: SegmentKeyWorkoutVerdict;
  role: string;
  workAvgPace: string | null;
  workRepsCompared: number | null;
  workRepsPlanned: number | null;
  evidenceWarnings: string[];
}): string {
  if (input.verdict === "warning" && isAnomalousSegmentEvidence(input.evidenceWarnings)) {
    return `частично/аномально: ${input.workRepsCompared ?? "?"}/${input.workRepsPlanned ?? "?"} рабочих отрезков, большой разброс темпа; нужна ручная проверка`;
  }
  switch (input.verdict) {
    case "positive":
      return `Рабочие отрезки (${input.role}) выполнены стабильно${input.workAvgPace ? `, ср. ${input.workAvgPace}` : ""} — поддерживает прогноз.`;
    case "neutral":
      return `Рабочие отрезки (${input.role}) в целом выполнены, есть умеренная просадка или неполный объём.`;
    case "warning":
      return `Рабочие отрезки (${input.role}) выполнены неполно или с заметной просадкой — осторожный сигнал.`;
    default:
      return "Нет пригодных segment/FIT данных для рабочих отрезков.";
  }
}

async function buildSegmentKeyWorkout(capture: RawKeyWorkoutCapture): Promise<SegmentKeyWorkout> {
  const workout = capture.workout;
  const fitLaps = await loadWorkoutFitLaps(workout);
  const segmentVerdict = deriveSegmentVerdict(workout);
  const { segments, evidenceType } = identifyWorkSegments(workout);
  const analysis = asSegmentAnalysis(workout);
  const dataQualityFlags = [
    ...(analysis.data_quality_flags ?? []),
    ...segments.flatMap((segment) => segment.data_quality_flags ?? []),
  ];
  const uniqueDataQualityFlags = [...new Set(dataQualityFlags)];

  const titleParsed = parseIntervalRepsFromTitle(capture.title);
  const repDurationMin =
    titleParsed.repDurationMin ??
    segments.find((segment) => segment.planned_duration_minutes != null)?.planned_duration_minutes ??
    null;
  const { role, limitations: roleLimitations } = classifyWorkoutEvidenceRole(repDurationMin, capture.title);

  if (segmentVerdict.verdict !== "usable" || segments.length === 0) {
    const segmentMatching =
      asSegmentComparison(workout).length > 0
        ? buildSegmentMatchingDiagnostics({
            workout,
            evidenceType: "unavailable",
            selectedWorkSegments: [],
            selectedWorkAvgPaceMin: null,
            usableForPrediction: false,
            fitLaps,
          })
        : undefined;

    return {
      date: capture.date,
      title: capture.title,
      role,
      segment_evidence_available: false,
      usable_for_prediction: false,
      evidence_type: "unavailable",
      work_reps_compared: null,
      work_reps_planned: countPlannedWorkReps(workout),
      work_avg_pace: null,
      work_fastest_pace: null,
      work_slowest_pace: null,
      work_avg_hr: null,
      work_max_hr: null,
      rep_to_rep_fade_pct: null,
      last_rep_vs_first_rep_pct: null,
      completion_ratio: null,
      verdict: "unavailable",
      takeaway: buildSegmentKeyWorkoutTakeaway({
        verdict: "unavailable",
        role,
        workAvgPace: null,
        workRepsCompared: null,
        workRepsPlanned: countPlannedWorkReps(workout),
        evidenceWarnings: [],
      }),
      limitations: [
        ...roleLimitations,
        segmentVerdict.reason,
        "Средний темп всей тренировки не используется как интервальное доказательство.",
      ],
      ...(segmentMatching ? { segment_matching: segmentMatching } : {}),
    };
  }

  const paces = segments
    .map((segment) => segmentPaceMinPerKm(segment))
    .filter((pace): pace is number => pace !== null);
  const hrValues = segments
    .map((segment) => segment.actual?.avg_hr)
    .filter((hr): hr is number => hr != null && hr > 0);

  const workAvgPaceMin =
    paces.length > 0 ? paces.reduce((sum, pace) => sum + pace, 0) / paces.length : null;
  const fastestPace = paces.length > 0 ? Math.min(...paces) : null;
  const slowestPace = paces.length > 0 ? Math.max(...paces) : null;
  const fadeMetrics = computeRepFadeMetrics(paces);

  const workRepsPlanned = countPlannedWorkReps(workout);
  const workRepsCompared = segments.length;
  const completionRatio =
    workRepsPlanned !== null && workRepsPlanned > 0
      ? Math.round((workRepsCompared / workRepsPlanned) * 100) / 100
      : null;

  const limitations = [...roleLimitations];
  if (evidenceType === "repeat_group_inferred") {
    limitations.push("Рабочие отрезки выведены из repeat-блока плана (mislabeled recovery в segment_comparison).");
  }
  if (uniqueDataQualityFlags.length > 0) {
    limitations.push(`Флаги качества: ${uniqueDataQualityFlags.join(", ")}.`);
  }

  const evidenceWarnings = collectSegmentEvidenceWarnings({
    completionRatio,
    fastestPace,
    slowestPace,
    workAvgPaceMin,
    wholeWorkoutPaceMin: workout.avg_pace_min_per_km,
    paces,
    fadePct: fadeMetrics.last_rep_vs_first_rep_pct,
    dataQualityFlags: uniqueDataQualityFlags,
  });
  const { verdict, usable_for_prediction } = deriveSegmentKeyWorkoutVerdict({
    segmentEvidenceAvailable: true,
    completionRatio,
    fadePct: fadeMetrics.last_rep_vs_first_rep_pct,
    evidenceWarnings,
  });
  const workAvgPace = workAvgPaceMin !== null ? formatPaceText(workAvgPaceMin) : null;
  if (!usable_for_prediction) {
    limitations.push("Не использовать как позитивное evidence для прогноза.");
  }

  let segmentMatching = buildSegmentMatchingDiagnostics({
    workout,
    evidenceType,
    selectedWorkSegments: segments,
    selectedWorkAvgPaceMin: workAvgPaceMin,
    usableForPrediction: usable_for_prediction,
    fitLaps,
  });

  let promotedWorkout: SegmentKeyWorkout = {
    date: capture.date,
    title: capture.title,
    role,
    segment_evidence_available: true,
    usable_for_prediction,
    evidence_type: evidenceType,
    work_reps_compared: workRepsCompared,
    work_reps_planned: workRepsPlanned,
    work_avg_pace: workAvgPace,
    work_fastest_pace: fastestPace !== null ? formatPaceText(fastestPace) : null,
    work_slowest_pace: slowestPace !== null ? formatPaceText(slowestPace) : null,
    work_avg_hr: hrValues.length > 0 ? Math.round(hrValues.reduce((sum, hr) => sum + hr, 0) / hrValues.length) : null,
    work_max_hr: hrValues.length > 0 ? Math.max(...hrValues) : null,
    rep_to_rep_fade_pct: fadeMetrics.rep_to_rep_fade_pct,
    last_rep_vs_first_rep_pct: fadeMetrics.last_rep_vs_first_rep_pct,
    completion_ratio: completionRatio,
    verdict,
    takeaway: buildSegmentKeyWorkoutTakeaway({
      verdict,
      role,
      workAvgPace,
      workRepsCompared,
      workRepsPlanned,
      evidenceWarnings,
    }),
    limitations,
    ...(segmentMatching ? { segment_matching: segmentMatching } : {}),
  };

  const hasMisalignment =
    segmentMatching?.diagnostics.some((entry) => entry.code === "possible_timer_slice_misalignment") ??
    false;
  const fitLapCandidate = segmentMatching?.fit_lap_candidate;
  if (
    segmentMatching &&
    fitLapCandidate &&
    isFitLapCandidatePromotionEligible({
      candidate: fitLapCandidate,
      hasMisalignment,
      repDurationMin: titleParsed.repDurationMin,
    })
  ) {
    const promoted = promoteSegmentKeyWorkoutWithFitLapCandidate({
      workout: promotedWorkout,
      segmentMatching,
      fitLap: fitLapCandidate,
      repDurationMin: titleParsed.repDurationMin,
      wholeWorkoutPaceMin: workout.avg_pace_min_per_km,
      dataQualityFlags: uniqueDataQualityFlags,
      roleLimitations: roleLimitations,
    });
    promotedWorkout = promoted.workout;
    segmentMatching = promoted.segmentMatching;
  }

  return promotedWorkout;
}

async function buildSegmentKeyWorkouts(captures: RawKeyWorkoutCapture[]): Promise<SegmentKeyWorkout[]> {
  const workouts = await Promise.all(captures.map((capture) => buildSegmentKeyWorkout(capture)));
  return workouts.sort((left, right) => right.date.localeCompare(left.date));
}

function formatSegmentKeyWorkoutVerdictLabel(workout: SegmentKeyWorkout): string {
  switch (workout.verdict) {
    case "positive":
      return "supports";
    case "neutral":
      return "neutral";
    case "warning":
      return workout.usable_for_prediction ? "warning" : "warning (unusable_for_prediction)";
    default:
      return "unavailable";
  }
}

function formatSegmentMatchingMarkdown(workout: SegmentKeyWorkout): string[] {
  const matching = workout.segment_matching;
  if (!matching?.diagnostics.length) return [];

  const lines: string[] = ["  - Диагностика сегментов:"];
  for (const diagnostic of matching.diagnostics) {
    if (diagnostic.code === "possible_timer_slice_misalignment") {
      lines.push("    - possible_timer_slice_misalignment");
    } else if (diagnostic.code === "work_recovery_pace_inversion") {
      lines.push("    - recovery faster than work");
    } else if (diagnostic.code === "work_recovery_hr_inversion") {
      lines.push("    - recovery higher HR than work");
    } else if (diagnostic.code === "work_target_miss_recovery_target_hit") {
      lines.push("    - work rows miss target while recovery rows fit work target better");
    } else if (diagnostic.code === "high_work_pace_spread") {
      lines.push("    - high work pace spread in timer-slice rows");
    }
  }
  lines.push("    - timer-slice values are observation-only");
  const timerSlice = matching.original_timer_slice_comparison;
  if (timerSlice.work_avg_pace) {
    lines.push(`    - Timer-slice work: avg ${timerSlice.work_avg_pace} (${timerSlice.work_segments_count} rows)`);
  }
  const hasMisalignment = matching.diagnostics.some(
    (entry) => entry.code === "possible_timer_slice_misalignment",
  );
  const timerSliceWorkPace =
    workout.original_timer_slice_work_avg_pace ?? timerSlice.work_avg_pace;
  if (hasMisalignment && timerSliceWorkPace && workout.evidence_source !== "fit_lap_candidate") {
    lines.push(
      `    - Не доверять ${timerSliceWorkPace} как финальному рабочему темпу — вероятное смещение timer-slice.`,
    );
  }
  const rescue = matching.target_proximity_rescue_candidate;
  if (rescue?.available) {
    const repLabel =
      rescue.expected_work_reps_count !== null
        ? `${rescue.selected_segments_count}/${rescue.expected_work_reps_count}`
        : `${rescue.selected_segments_count}`;
    const paceParts = [
      rescue.candidate_work_avg_pace ? `avg ${rescue.candidate_work_avg_pace}` : null,
      rescue.candidate_work_pace_range ? `range ${rescue.candidate_work_pace_range}` : null,
    ].filter(Boolean);
    lines.push("    - Shadow rescue candidate:");
    lines.push(
      `      - Target-proximity candidate: ${repLabel} rows${paceParts.length ? `, ${paceParts.join(", ")}` : ""}`,
    );
    lines.push(`      - confidence: ${rescue.confidence}`);
    lines.push("      - shadow mode / not used in prediction");
  } else if (rescue && !rescue.available && rescue.rejected_reason === "no_planned_work_target") {
    lines.push("    - Target-proximity candidate: нет planned work target (shadow only).");
  }
  if (matching.warnings.includes("timer_slice_misalignment_detected")) {
    lines.push("    - Диагностика: timer_slice_misalignment_detected");
  }
  const fitLap = matching.fit_lap_candidate;
  if (fitLap?.available) {
    const repLabel =
      fitLap.expected_work_reps_count !== null
        ? `${fitLap.selected_laps_count}/${fitLap.expected_work_reps_count}`
        : `${fitLap.selected_laps_count}`;
    const paceParts = [
      fitLap.candidate_work_avg_pace ? `avg ${fitLap.candidate_work_avg_pace}` : null,
      fitLap.candidate_work_pace_range ? `range ${fitLap.candidate_work_pace_range}` : null,
    ].filter(Boolean);
    if (fitLap.prediction_eligible) {
      lines.push("    - FIT-lap evidence (promoted):");
      lines.push(
        `      - FIT lap ${fitLap.strategy}: ${repLabel} lap group(s)${paceParts.length ? `, ${paceParts.join(", ")}` : ""}`,
      );
      lines.push(`      - confidence: ${fitLap.confidence}`);
      lines.push("      - used as segment evidence for prediction");
    } else {
      lines.push("    - Shadow FIT-lap candidate:");
      lines.push(
        `      - FIT lap ${fitLap.strategy}: ${repLabel} lap group(s)${paceParts.length ? `, ${paceParts.join(", ")}` : ""}`,
      );
      lines.push(`      - confidence: ${fitLap.confidence}`);
      lines.push("      - shadow mode / not used in prediction");
    }
  } else if (fitLap && !fitLap.available) {
    lines.push(
      `    - Shadow FIT-lap candidate: unavailable (${fitLap.rejected_reason ?? "no_match"}) — shadow only.`,
    );
  }
  return lines;
}

function formatSegmentKeyWorkoutsMarkdown(segmentKeyWorkouts: SegmentKeyWorkout[]): string[] {
  const lines: string[] = [];
  const segmentAware = segmentKeyWorkouts.filter((workout) => workout.segment_evidence_available);
  const withoutSegment = segmentKeyWorkouts.filter((workout) => !workout.segment_evidence_available);

  for (const workout of segmentAware) {
    lines.push(`- ${workout.date} · ${workout.title ?? "без названия"}`);
    lines.push(`  - Тип: ${workout.role}`);
    lines.push(
      `  - Рабочие отрезки: ${workout.work_reps_compared ?? "?"}/${workout.work_reps_planned ?? "?"}`,
    );
    if (workout.evidence_source === "fit_lap_candidate" && workout.extraction_strategy) {
      lines.push(`  - Источник: FIT laps / ${workout.extraction_strategy}`);
      if (workout.original_timer_slice_work_avg_pace) {
        lines.push(`  - Таймерная нарезка отклонена: ${workout.original_timer_slice_work_avg_pace}`);
      }
    }
    if (workout.work_avg_pace) {
      lines.push(`  - Ср. темп рабочих: ${workout.work_avg_pace}`);
    }
    if (workout.work_fastest_pace && workout.work_slowest_pace) {
      lines.push(`  - Разброс: ${workout.work_fastest_pace}–${workout.work_slowest_pace}`);
    }
    if (workout.last_rep_vs_first_rep_pct !== null) {
      lines.push(`  - Просадка: ${workout.last_rep_vs_first_rep_pct}%`);
    }
    if (workout.work_avg_hr !== null || workout.work_max_hr !== null) {
      const hrParts: string[] = [];
      if (workout.work_avg_hr !== null) hrParts.push(`avg ${workout.work_avg_hr}`);
      if (workout.work_max_hr !== null) hrParts.push(`max ${workout.work_max_hr}`);
      lines.push(`  - HR: ${hrParts.join(", ")}`);
    }
    lines.push(`  - Вывод: ${formatSegmentKeyWorkoutVerdictLabel(workout)}`);
    if (!workout.usable_for_prediction) {
      lines.push("  - Не использовать как позитивное evidence для прогноза");
    }
    if (workout.takeaway) {
      lines.push(`  - ${workout.takeaway}`);
    }
    if (workout.limitations.length > 0) {
      lines.push(`  - Ограничения: ${workout.limitations.join(" ")}`);
    }
    lines.push(...formatSegmentMatchingMarkdown(workout));
  }

  for (const workout of withoutSegment) {
    lines.push(
      `- ${workout.date} · ${workout.title ?? "без названия"} — нет segment/FIT данных; средний темп всей тренировки не используется для прогноза интервалов.`,
    );
  }

  return lines;
}

function formatSegmentDataCell(workout: SegmentAuditReport["workouts"][number]): string {
  const parts: string[] = [];
  if (workout.has_segment_analysis) parts.push("analysis");
  if (workout.has_segment_comparison) parts.push("comparison");
  return parts.length ? parts.join("+") : "—";
}

function progressEvidencePositive(report: ProgressEvidenceReport | null): boolean {
  if (!report) return false;
  const interpretations = new Set([
    report.easy_run_progress.interpretation,
    report.long_run_progress.interpretation,
  ]);
  return (
    interpretations.has("faster_at_same_or_lower_hr") ||
    interpretations.has("similar_pace_lower_hr")
  );
}

function readinessSystemLabel(key: keyof Omit<ReadinessScores, "overall_confidence_score" | "confidence" | "notes">): string {
  switch (key) {
    case "anchor_quality_score":
      return "Якорь результата";
    case "interval_specificity_score":
      return "10K-specific интервалы";
    case "threshold_readiness_score":
      return "Порог / темпо";
    case "endurance_score":
      return "Выносливость";
    case "consistency_score":
      return "Стабильность";
    case "taper_score":
      return "Тейпер";
    case "data_quality_score":
      return "Качество данных";
    default:
      return key;
  }
}

function readinessSystemMeaning(
  key: keyof Omit<ReadinessScores, "overall_confidence_score" | "confidence" | "notes">,
  score: number,
): string {
  if (score >= 75) {
    switch (key) {
      case "anchor_quality_score":
        return "Надёжная опора на целевой дистанции";
      case "interval_specificity_score":
        return "Есть пригодные короткие интервалы рядом с темпом гонки";
      case "threshold_readiness_score":
        return "Пороговая работа подтверждает форму";
      case "endurance_score":
        return "Объём и длинные поддерживают дистанцию";
      case "consistency_score":
        return "Стабильное выполнение плана";
      case "taper_score":
        return "Тейпер выглядит уместно";
      case "data_quality_score":
        return "Достаточно данных для segment-aware анализа";
      default:
        return "Сильная готовность";
    }
  }
  if (score >= 50) {
    switch (key) {
      case "anchor_quality_score":
        return "Опора есть, но с оговорками";
      case "interval_specificity_score":
        return "Частичная поддержка от интервалов";
      case "threshold_readiness_score":
        return "Пороговая работа умеренная";
      case "endurance_score":
        return "Базовая выносливость в норме";
      case "consistency_score":
        return "Есть пробелы в регулярности";
      case "taper_score":
        return "Тейпер нейтральный или неполный";
      case "data_quality_score":
        return "Данные частичные, но usable";
      default:
        return "Умеренная готовность";
    }
  }
  switch (key) {
    case "anchor_quality_score":
      return "Слабый или отсутствующий якорь";
    case "interval_specificity_score":
      return "Нет пригодных коротких интервалов";
    case "threshold_readiness_score":
      return "Мало пороговой работы";
    case "endurance_score":
      return "Объём/длинные ниже ожиданий";
    case "consistency_score":
      return "Много пропусков или дыр в данных";
    case "taper_score":
      return "Риск перегруза перед стартом";
    case "data_quality_score":
      return "Мало FIT/segment coverage";
    default:
      return "Слабая готовность";
  }
}

function formatReadinessScoresMarkdown(readiness: ReadinessScores, distance: DistanceKey): string[] {
  const lines: string[] = [];
  lines.push("## Готовность по системам");
  lines.push("");
  lines.push("| Система | Оценка | Что значит |");
  lines.push("|---|---:|---|");

  const keys: Array<keyof Omit<ReadinessScores, "overall_confidence_score" | "confidence" | "notes">> = [
    "anchor_quality_score",
    "interval_specificity_score",
    "threshold_readiness_score",
    "endurance_score",
    "consistency_score",
    "taper_score",
    "data_quality_score",
  ];

  for (const key of keys) {
    let label = readinessSystemLabel(key);
    if (key === "interval_specificity_score" && distance !== "10k") {
      label = "Интервалы race-specific";
    }
    lines.push(`| ${label} | ${readiness[key]}/100 | ${readinessSystemMeaning(key, readiness[key])} |`);
  }
  lines.push("");
  lines.push(
    `**Сводная уверенность:** ${readiness.confidence} (${readiness.overall_confidence_score}/100).`,
  );
  return lines;
}

function createMarkdown(report: RacePredictionReport): string {
  const lines: string[] = [];
  lines.push(`# Прогноз результата — ${report.athlete.student_name}`);
  lines.push(
    `- Старт: ${DISTANCE_PRESETS[report.race.distance].label}, ${report.race.date}${report.race.name ? `, ${report.race.name}` : ""}`,
  );
  lines.push(
    `- Окно анализа: ${report.window.from} → ${report.window.to} (${report.window.weeks_found}/${report.window.weeks_requested} нед., режим ${report.window.weeks_mode})`,
  );
  lines.push("");
  lines.push("## Прогноз");
  lines.push("| Сценарий | Время | Темп |");
  lines.push("|---|---:|---:|");
  lines.push(
    `| Консервативно | ${report.prediction.conservative.time_text} | ${report.prediction.conservative.pace_text} |`,
  );
  lines.push(
    `| Вероятно | ${report.prediction.likely.time_text} | ${report.prediction.likely.pace_text} |`,
  );
  lines.push(
    `| Оптимистично | ${report.prediction.optimistic.time_text} | ${report.prediction.optimistic.pace_text} |`,
  );
  lines.push("");
  let anchorNote =
    report.anchors.target_distance.primary?.kind === "official_best"
      ? `Прогноз основан на официальном ${DISTANCE_PRESETS[report.race.distance].label} + segment-aware анализе ключевых тренировок.`
      : report.prediction.insufficient_data
        ? "Недостаточно данных для уточнения прогноза — широкий ориентир."
        : "Прогноз основан на доступной опоре + segment-aware анализе ключевых тренировок.";
  if (report.training_implied_anchor?.available) {
    anchorNote =
      "Нет официального half anchor, поэтому уверенность ограничена; но training-implied anchor позволяет уточнить диапазон.";
  }
  lines.push(anchorNote);
  lines.push("");
  lines.push(
    `**Уверенность:** ${report.prediction.confidence} (${report.prediction.confidence_score}/100), метод ${report.prediction.method}.`,
  );
  if (report.prediction.confidence_reasons.length > 0) {
    lines.push(`Кратко: ${report.prediction.confidence_reasons.slice(0, 2).join(" ")}`);
  }
  lines.push("");
  lines.push(...formatReadinessScoresMarkdown(report.readiness_scores, report.race.distance));
  if (report.training_implied_anchor?.available) {
    const anchor = report.training_implied_anchor;
    lines.push("## Training-implied anchor");
    lines.push("");
    lines.push(
      "Официального результата на 21.1 км нет; прогноз построен от темповых блоков и длительных.",
    );
    lines.push("");
    if (anchor.threshold_pace_s_per_km !== null) {
      lines.push(
        `- Пороговый/темповый темп: **${formatPaceText(anchor.threshold_pace_s_per_km / 60)}**`,
      );
    }
    lines.push(`- Half pace offset: **+${anchor.half_pace_offset_s_per_km ?? 0} с/км**`);
    lines.push(`- Durability penalty: **+${anchor.durability_penalty_s_per_km ?? 0} с/км** (${anchor.endurance_gate.status})`);
    lines.push(
      `- No-race-anchor safety: **+${anchor.no_race_anchor_safety_penalty_s_per_km ?? 0} с/км**`,
    );
    if (anchor.implied_half_time_s !== null && anchor.implied_half_pace_s_per_km !== null) {
      lines.push(
        `- Implied half: **${formatDurationFromSeconds(anchor.implied_half_time_s)}** (${formatPaceText(anchor.implied_half_pace_s_per_km / 60)})`,
      );
    }
    lines.push(
      `- Long-run gate: ${anchor.endurance_gate.long_runs_14k_count}×≥14 км, longest ${anchor.endurance_gate.longest_run_km} км (${anchor.endurance_gate.status})`,
    );
    lines.push("- Evidence workouts:");
    for (const workout of anchor.evidence_workouts.slice(0, 8)) {
      const blockLabel =
        workout.block_minutes !== null ? `${workout.block_minutes} мин` : "блок";
      lines.push(
        `  - ${workout.date} · ${workout.title ?? "—"} — ${workout.work_avg_pace} (${blockLabel}, ${workout.role})`,
      );
    }
    for (const note of anchor.notes.slice(0, 4)) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  lines.push(...formatVdotStyleCheckMarkdown(report.vdot_style_check));
  lines.push("## Почему");
  for (const reason of report.prediction.confidence_reasons) {
    lines.push(`- ${reason}`);
  }
  if (report.anchors.target_distance.primary) {
    const anchor = report.anchors.target_distance.primary;
    lines.push(
      `- Опора: ${anchor.kind}, ${anchor.candidate.date}, ${anchor.candidate.distance_km} км за ${anchor.candidate.duration_text} (${anchor.candidate.pace_text}).`,
    );
  }
  lines.push(
    `- Недели: ${report.window.weeks_found}/${report.window.weeks_requested}; пропуски planned: ${report.features.missed_workouts_count}.`,
  );
  lines.push(
    `- Тейпер: ${report.features.taper.signal}${report.features.taper.ratio !== null ? ` (ratio ${report.features.taper.ratio.toFixed(2)})` : ""}.`,
  );
  lines.push("");
  lines.push("## Ключевые тренировки");
  if (!report.segment_key_workouts?.length && !report.features.key_workouts.length) {
    lines.push("- Ключевые тренировки в parsed weekly-summary не найдены.");
  } else if (report.segment_key_workouts?.length) {
    lines.push(...formatSegmentKeyWorkoutsMarkdown(report.segment_key_workouts));
  } else {
    for (const workout of report.features.key_workouts.slice(0, 12)) {
      lines.push(
        `- ${workout.date} · ${workout.title ?? "без названия"} — нет segment/FIT данных; средний темп всей тренировки не используется для прогноза интервалов.`,
      );
    }
  }
  lines.push("");
  lines.push("## Риски");
  if (report.features.missed_workouts_count >= 3) {
    lines.push(`- ${report.features.missed_workouts_count} пропущенных тренировок в окне.`);
  }
  if (report.features.taper.signal === "volume_spike") {
    lines.push("- Объём перед стартом не снижался — риск усталости.");
  }
  if (report.features.data_quality.warnings.length) {
    lines.push(`- Качество данных: ${report.features.data_quality.warnings.join(", ")}.`);
  }
  if (
    !report.features.missed_workouts_count &&
    !report.features.data_quality.warnings.length &&
    report.features.taper.signal !== "volume_spike"
  ) {
    lines.push("- Явных красных флагов по summary-данным нет; FIT-сегменты не проверялись.");
  }
  lines.push("");
  lines.push("## Пробелы в данных");
  for (const limitation of report.limitations) {
    lines.push(`- ${limitation}`);
  }
  if (!report.limitations.length) {
    lines.push("- Существенных пробелов не отмечено.");
  }
  lines.push("");
  lines.push("## Что проверить тренеру");
  if (report.anchors.target_distance.excluded_for_review.length) {
    lines.push("- Проверить кандидатов, исключённых из опоры (needs_coach_review / manual_review).");
  }
  if (report.data_sources.fit_weeks_count === 0) {
    lines.push("- Нет FIT в weekly-summary: прогноз по summary, без lap/segment анализа.");
  }
  if (report.data_sources.race_results_probe.path === null) {
    lines.push("- Нет кэша race-results probe — опора только по тренировкам.");
  }
  if (report.data_sources.progress_evidence_probe.path === null) {
    lines.push("- Нет кэша progress-evidence probe — тренд аэробной формы не подтверждён.");
  }
  if (
    !report.anchors.target_distance.excluded_for_review.length &&
    report.data_sources.fit_weeks_count > 0 &&
    report.data_sources.race_results_probe.path
  ) {
    lines.push("- Сверить прогноз с ощущениями спортсмена и планом старта.");
  }
  if (report.segment_audit) {
    const audit = report.segment_audit;
    lines.push("");
    lines.push("## Segment audit");
    lines.push("| Date | Workout | Role | Segment data | Compared | Verdict |");
    lines.push("|---|---|---|---:|---:|---|");
    for (const workout of audit.workouts) {
      lines.push(
        `| ${workout.date} | ${workout.title ?? "—"} | ${workout.role} | ${formatSegmentDataCell(workout)} | ${workout.compared_segments_count} | ${workout.verdict} |`,
      );
    }
    lines.push("");
    const recommendationText =
      audit.recommendation === "segment_aware_ready"
        ? "Можно переходить к segment-aware анализу интервалов"
        : "Нужны Workout Files/FIT или доработка парсера";
    lines.push(`**Рекомендация:** ${recommendationText}`);
    lines.push(`- ${audit.recommendation_note}`);
  }
  lines.push("");
  lines.push("## Рекомендация по тактике");
  if (report.prediction.confidence === "high") {
    lines.push(
      `- Стартовать ближе к **${report.prediction.likely.pace_text}** (${report.prediction.likely.time_text}); держать ровный темп первые 2–3 км.`,
    );
  } else if (report.prediction.confidence === "medium") {
    lines.push(
      `- Первые 2–3 км — **консервативно**, ближе к ${report.prediction.conservative.pace_text} или чуть медленнее likely; точка решения после 3 км.`,
    );
    lines.push(
      `- Если темп держится комфортно — можно сближаться с **${report.prediction.likely.pace_text}** (${report.prediction.likely.time_text}).`,
    );
  } else {
    lines.push(
      `- При низкой уверенности — старт **консервативно** (${report.prediction.conservative.pace_text}), без гонки за оптимистичным сценарием.`,
    );
    lines.push(
      `- Ориентир likely **${report.prediction.likely.time_text}** — только если самочувствие и темп подтверждаются после 3–5 км.`,
    );
  }
  lines.push(
    `- Верхняя граница дня — около **${report.prediction.optimistic.time_text}**, только если темп держится без «красной зоны»; не стартовать под optimistic.`,
  );
  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- report_json: \`${report.output_paths.report_json}\``);
  lines.push(`- report_md: \`${report.output_paths.report_md}\``);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const students = await readStudentsConfig();
  const target = resolveTarget(args, students);
  const runAt = new Date().toISOString();
  const today = runAt.slice(0, 10);
  const commandUsed = `npm run tp-race-prediction-probe -- ${process.argv.slice(2).join(" ")}`.trim();

  const analysisWeeks = resolveAnalysisWeeks(args.distance, args.weeks);

  const prepWindow = buildPrepWindow({
    raceDate: args.raceDate,
    weeks: analysisWeeks.weeks,
    fromOverride: args.from,
    toOverride: args.to,
  });

  const weeklySummaries: Array<{ week: WeekRange; summary: WeeklySummary | null; path: string | null }> = [];
  for (const week of prepWindow.weekRanges) {
    const summaryPath = weeklySummaryPath(target.studentId, week);
    const summary = await loadWeeklySummary(target.studentId, week);
    weeklySummaries.push({
      week,
      summary,
      path: summary ? summaryPath : null,
    });
  }

  const weeksFound = weeklySummaries.filter((entry) => entry.summary !== null).length;
  const weeksMissing = analysisWeeks.weeks - weeksFound;

  const raceResultsCached = findLatestProbeReport<RaceResultsProbeReport>(
    path.join(toolRoot, "debug", "race-results-probe"),
    target.athleteId,
  );
  const progressCached = findLatestProbeReport<ProgressEvidenceReport>(
    path.join(toolRoot, "debug", "progress-evidence"),
    target.athleteId,
  );

  const anchors = selectAnchorsFromRaceProbe(
    raceResultsCached.report,
    args.distance,
    args.includeReviewAnchors,
  );

  const weeklyVolume: RacePredictionReport["features"]["weekly_volume"] = [];
  const longRuns: RacePredictionReport["features"]["long_runs"] = [];
  const keyWorkouts: RacePredictionReport["features"]["key_workouts"] = [];
  const rawKeyWorkoutCaptures: RawKeyWorkoutCapture[] = [];
  const completionRates: number[] = [];
  const dataWarnings = new Set<string>();
  const classificationDiagnostics: string[] = [];
  let missedWorkouts = 0;
  let fitWeeks = 0;
  let workoutFilesWeeks = 0;
  let suspiciousWeeks = 0;

  const taperRecentDates = addDays(args.raceDate, -10);
  let taperRecentKm = 0;

  for (const entry of weeklySummaries) {
    const summary = entry.summary;
    if (!summary) continue;

    let runningKm = 0;
    let completedRunning = 0;
    for (const workout of summary.workouts) {
      if (!isRunningWorkout(workout) || !workout.classification.is_completed) continue;
      completedRunning += 1;
      runningKm += workout.distance_km ?? 0;
      for (const warning of workout.data_warnings) dataWarnings.add(warning);
      if (workout.date && workout.date >= taperRecentDates && workout.date < args.raceDate) {
        taperRecentKm += workout.distance_km ?? 0;
      }

      if (isLongRunWorkout(workout) && workout.date && workout.distance_km) {
        longRuns.push({
          date: workout.date,
          title: workout.title,
          distance_km: workout.distance_km,
          duration_text:
            workout.completed_duration_minutes !== null
              ? formatDurationText(workout.completed_duration_minutes)
              : "н/д",
          pace_text: workout.avg_pace_text ?? (workout.avg_pace_min_per_km ? formatPaceText(workout.avg_pace_min_per_km) : "н/д"),
          week: entry.week,
        });
      }

      const keyCategory = classifyKeyWorkout(workout);
      const easyTitleDiagnostic = getEasyTitleClassificationDiagnostic(workout, keyCategory);
      if (easyTitleDiagnostic) classificationDiagnostics.push(easyTitleDiagnostic);
      if (keyCategory && workout.date) {
        keyWorkouts.push({
          category: keyCategory,
          date: workout.date,
          title: workout.title,
          distance_km: workout.distance_km,
          duration_text:
            workout.completed_duration_minutes !== null
              ? formatDurationText(workout.completed_duration_minutes)
              : null,
          pace_text: workout.avg_pace_text ?? (workout.avg_pace_min_per_km ? formatPaceText(workout.avg_pace_min_per_km) : null),
          week: entry.week,
        });
        rawKeyWorkoutCaptures.push({
          date: workout.date,
          title: workout.title,
          role: keyCategory,
          week: entry.week,
          workout,
        });
      }
    }

    weeklyVolume.push({
      week: entry.week,
      running_km: runningKm > 0 ? Math.round(runningKm * 10) / 10 : null,
      completed_workouts: completedRunning,
    });

    const completion = summary.week_metrics.plan_vs_fact.completion_rate;
    if (completion !== null) completionRates.push(completion);
    missedWorkouts += summary.week_metrics.counts.planned_skipped;

    for (const warning of summary.week_metrics.data_quality.warnings) {
      dataWarnings.add(warning);
    }
    if (summary.week_metrics.data_quality.warnings.length > 0) suspiciousWeeks += 1;

    const workoutsWithMatchedFit = summary.segment_analysis?.workouts_with_matched_fit ?? 0;
    if (workoutsWithMatchedFit > 0) {
      fitWeeks += 1;
      workoutFilesWeeks += 1;
    } else if (summary.segment_analysis?.reason === "no_workout_files") {
      dataWarnings.add("no_workout_files");
    }
  }

  const volumeKmValues = weeklyVolume
    .map((week) => week.running_km)
    .filter((value): value is number => value !== null);
  const prior3w = volumeKmValues.slice(-4, -1);
  const prior3wMedian = median(prior3w);
  let taperSignal: RacePredictionReport["features"]["taper"]["signal"] = "insufficient_data";
  let taperRatio: number | null = null;
  if (prior3wMedian !== null && prior3wMedian > 0 && weeksFound > 0) {
    taperRatio = taperRecentKm / prior3wMedian;
    if (taperRatio <= 0.55) taperSignal = "taper_detected";
    else if (taperRatio >= 0.95) taperSignal = "volume_spike";
    else taperSignal = "flat";
  }

  const targetTimeSeconds = args.targetTime ? parseDurationToSeconds(args.targetTime) : null;
  if (args.targetTime && targetTimeSeconds === null) {
    throw new Error(`Could not parse --target-time: "${args.targetTime}"`);
  }

  const segmentKeyWorkouts = await buildSegmentKeyWorkouts(rawKeyWorkoutCaptures);

  const trainingImpliedAnchor =
    args.distance === "half" && !isStrongHalfRaceAnchor(anchors.primary?.kind)
      ? computeTrainingImpliedHalfAnchor({
          segmentKeyWorkouts,
          longRuns,
          weeksFound,
          raceDistanceKm: DISTANCE_PRESETS.half.target_km,
        })
      : null;

  const readinessScores = computeReadinessScores({
    anchor: anchors.primary,
    trainingImpliedAnchor,
    raceDate: args.raceDate,
    distance: args.distance,
    segmentKeyWorkouts,
    progressReport: progressCached.report,
    completionRates,
    missedWorkouts,
    weeksFound,
    weeksRequested: analysisWeeks.weeks,
    longRuns,
    weeklyVolume,
    taperSignal,
    taperRatio,
    dataWarnings: [...dataWarnings],
    fitWeeks,
    suspiciousWeeks,
  });

  const { prediction, limitations: predictionLimitations } = computePrediction({
    distance: args.distance,
    anchor: anchors.primary,
    targetTimeSeconds,
    readinessScores,
    segmentKeyWorkouts,
    progressReport: progressCached.report,
    trainingImpliedAnchor,
    taperSignal,
    missedWorkouts,
    raceDate: args.raceDate,
  });

  const limitations = [
    "Read-only local probe: без Supabase, Telegram, TrainingPeaks и AI.",
    ...predictionLimitations,
  ];
  if (raceResultsCached.path === null) {
    limitations.push("Кэш race-results probe не найден — рекомендуется `npm run tp-probe-race-results`.");
  } else if (raceResultsCached.stale) {
    limitations.push("Кэш race-results probe устарел (>14 дней).");
  }
  if (progressCached.path === null) {
    limitations.push("Кэш progress-evidence probe не найден — аэробный тренд не подтверждён.");
  } else if (progressCached.stale) {
    limitations.push("Кэш progress-evidence probe устарел (>14 дней).");
  }
  if (fitWeeks === 0) {
    limitations.push("FIT/workout files в weekly-summary не найдены — только summary-метрики.");
  }

  const timestamp = timestampForPath(new Date(runAt));
  const outputDir = path.join(
    toolRoot,
    "debug",
    "race-prediction",
    target.studentId,
    timestamp,
  );
  await mkdir(outputDir, { recursive: true });
  const reportJsonPath = path.join(outputDir, "report.json");
  const reportMdPath = path.join(outputDir, "report.md");

  const segmentAudit = args.segmentAudit
    ? buildSegmentAudit(rawKeyWorkoutCaptures, args.segmentAuditJson)
    : undefined;

  const vdotStyleCheck = buildVdotStyleCheck({
    targetDistance: args.distance,
    primaryAnchor: anchors.primary,
    trainingImpliedAnchor,
    ePredictorLikelySeconds: prediction.likely.seconds,
    segmentKeyWorkouts,
  });

  const report: RacePredictionReport = {
    schema_version: "race-prediction.v1",
    run_at: runAt,
    athlete: {
      student_id: target.studentId,
      student_name: target.studentName,
      athlete_id: target.athleteId,
    },
    race: {
      date: args.raceDate,
      distance: args.distance,
      distance_km: DISTANCE_PRESETS[args.distance].target_km,
      name: args.raceName,
      days_until_race: daysBetween(today, args.raceDate),
    },
    window: {
      from: prepWindow.from,
      to: prepWindow.to,
      weeks_requested: analysisWeeks.weeks,
      weeks_found: weeksFound,
      weeks_missing: weeksMissing,
      weeks_mode: analysisWeeks.weeksMode,
      default_weeks_for_distance: analysisWeeks.defaultWeeksForDistance,
    },
    data_sources: {
      weekly_summaries: weeklySummaries.map((entry) => ({
        from: entry.week.from,
        to: entry.week.to,
        path: entry.path,
        found: entry.summary !== null,
      })),
      race_results_probe: {
        path: raceResultsCached.path,
        run_at: raceResultsCached.runAt,
        stale: raceResultsCached.stale,
      },
      progress_evidence_probe: {
        path: progressCached.path,
        run_at: progressCached.runAt,
        stale: progressCached.stale,
      },
      fit_weeks_count: fitWeeks,
      workout_files_present_weeks: workoutFilesWeeks,
    },
    features: {
      weekly_volume: weeklyVolume,
      long_runs: longRuns.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
      key_workouts: keyWorkouts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 16),
      missed_workouts_count: missedWorkouts,
      taper: {
        last_days: 10,
        recent_km: taperRecentKm > 0 ? Math.round(taperRecentKm * 10) / 10 : null,
        prior_3w_median_km: prior3wMedian !== null ? Math.round(prior3wMedian * 10) / 10 : null,
        ratio: taperRatio !== null ? Math.round(taperRatio * 100) / 100 : null,
        signal: taperSignal,
      },
      data_quality: {
        warnings: [...dataWarnings].sort(),
        suspicious_weeks: suspiciousWeeks,
        fit_coverage_weeks: fitWeeks,
      },
    },
    anchors: {
      target_distance: {
        primary: anchors.primary,
        alternates: anchors.alternates,
        excluded_for_review: anchors.excludedForReview,
      },
      cross_distance: anchors.crossDistance,
    },
    readiness_scores: readinessScores,
    ...(trainingImpliedAnchor ? { training_implied_anchor: trainingImpliedAnchor } : {}),
    prediction,
    limitations,
    ...(classificationDiagnostics.length > 0 ? { classification_diagnostics: classificationDiagnostics } : {}),
    output_paths: {
      report_json: reportJsonPath,
      report_md: reportMdPath,
    },
    ...(segmentAudit ? { segment_audit: segmentAudit } : {}),
    segment_key_workouts: segmentKeyWorkouts,
    vdot_style_check: vdotStyleCheck,
  };

  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMdPath, createMarkdown(report), "utf8");

  console.log("[tp-race-prediction-probe] Summary");
  console.log(`command_used: ${commandUsed}`);
  console.log(`student_id: ${target.studentId}`);
  console.log(`athlete_id: ${target.athleteId}`);
  console.log(`race: ${args.distance} on ${args.raceDate}`);
  console.log(`window: ${prepWindow.from} -> ${prepWindow.to}`);
  console.log(`weeks_mode: ${analysisWeeks.weeksMode}`);
  console.log(`weeks_requested: ${analysisWeeks.weeks}`);
  console.log(`default_weeks_for_distance: ${analysisWeeks.defaultWeeksForDistance}`);
  console.log(`weeks_found: ${weeksFound}`);
  console.log(`weeks_missing: ${weeksMissing}`);
  if (trainingImpliedAnchor) {
    console.log(
      `training_implied_anchor: ${trainingImpliedAnchor.available ? "available" : "unavailable"}`,
    );
    if (trainingImpliedAnchor.available && trainingImpliedAnchor.implied_half_time_s !== null) {
      console.log(
        `training_implied_half: ${formatDurationFromSeconds(trainingImpliedAnchor.implied_half_time_s)} (${formatPaceText((trainingImpliedAnchor.implied_half_pace_s_per_km ?? 0) / 60)})`,
      );
    }
  }
  console.log(
    `selected_anchor: ${
      anchors.primary
        ? `${anchors.primary.kind} | ${anchors.primary.candidate.date} | ${anchors.primary.candidate.pace_text}`
        : "none"
    }`,
  );
  console.log(
    `prediction_range: conservative ${prediction.conservative.time_text} | likely ${prediction.likely.time_text} | optimistic ${prediction.optimistic.time_text}`,
  );
  console.log(`confidence: ${prediction.confidence} (${prediction.confidence_score}/100)`);
  console.log(
    `vdot_style_check: source=${vdotStyleCheck.source}, verdict=${
      vdotStyleCheck.comparison_to_e_predictor?.verdict ?? "no_anchor"
    }`,
  );
  if (segmentAudit) {
    console.log("[tp-race-prediction-probe] Segment audit");
    console.log(`key_workouts_count: ${segmentAudit.summary.key_workouts_count}`);
    console.log(`segment_analysis_available_count: ${segmentAudit.summary.segment_analysis_available_count}`);
    console.log(`segment_comparison_available_count: ${segmentAudit.summary.segment_comparison_available_count}`);
    console.log(`interval_key_workouts_count: ${segmentAudit.summary.interval_key_workouts_count}`);
    console.log(
      `interval_key_workouts_with_segments_count: ${segmentAudit.summary.interval_key_workouts_with_segments_count}`,
    );
    console.log(`recommendation: ${segmentAudit.recommendation}`);
    console.log(`recommendation_note: ${segmentAudit.recommendation_note}`);
  }
  const usableSegmentKeyWorkouts = segmentKeyWorkouts.filter((workout) => workout.usable_for_prediction);
  const segmentMatchingDiagnosticsCount = segmentKeyWorkouts.filter(
    (workout) => (workout.segment_matching?.diagnostics.length ?? 0) > 0,
  ).length;
  const timerSliceMisalignmentCount = segmentKeyWorkouts.filter((workout) =>
    workout.segment_matching?.diagnostics.some(
      (entry) => entry.code === "possible_timer_slice_misalignment",
    ),
  ).length;
  const targetProximityRescueCandidatesCount = segmentKeyWorkouts.filter(
    (workout) => workout.segment_matching?.target_proximity_rescue_candidate?.available === true,
  ).length;
  const targetProximityRescueMediumCount = segmentKeyWorkouts.filter(
    (workout) =>
      workout.segment_matching?.target_proximity_rescue_candidate?.available === true &&
      workout.segment_matching?.target_proximity_rescue_candidate?.confidence === "medium",
  ).length;
  const fitLapCandidatesCount = segmentKeyWorkouts.filter(
    (workout) => workout.segment_matching?.fit_lap_candidate?.available === true,
  ).length;
  const fitLapMediumCount = segmentKeyWorkouts.filter(
    (workout) =>
      workout.segment_matching?.fit_lap_candidate?.available === true &&
      workout.segment_matching?.fit_lap_candidate?.confidence === "medium",
  ).length;
  const fitLapPromotedCount = segmentKeyWorkouts.filter(
    (workout) => workout.segment_matching?.fit_lap_candidate?.prediction_eligible === true,
  ).length;
  if (segmentAudit || usableSegmentKeyWorkouts.length > 0) {
    console.log("[tp-race-prediction-probe] Segment key workouts");
    console.log(`segment_key_workouts_count: ${segmentKeyWorkouts.length}`);
    console.log(`usable_segment_key_workouts_count: ${usableSegmentKeyWorkouts.length}`);
  }
  if (
    segmentMatchingDiagnosticsCount > 0 ||
    timerSliceMisalignmentCount > 0 ||
    targetProximityRescueCandidatesCount > 0 ||
    fitLapCandidatesCount > 0
  ) {
    console.log("[tp-race-prediction-probe] Segment matching diagnostics");
    console.log(`segment_matching_diagnostics_count: ${segmentMatchingDiagnosticsCount}`);
    console.log(`timer_slice_misalignment_count: ${timerSliceMisalignmentCount}`);
    console.log(`target_proximity_rescue_candidates_count: ${targetProximityRescueCandidatesCount}`);
    console.log(`target_proximity_rescue_medium_count: ${targetProximityRescueMediumCount}`);
    console.log(`fit_lap_candidates_count: ${fitLapCandidatesCount}`);
    console.log(`fit_lap_medium_count: ${fitLapMediumCount}`);
    console.log(`fit_lap_promoted_count: ${fitLapPromotedCount}`);
  }
  if (classificationDiagnostics.length > 0) {
    console.log("[tp-race-prediction-probe] Classification diagnostics");
    console.log(`easy_title_drills_ignored_count: ${classificationDiagnostics.length}`);
  }
  console.log(`report_json: ${reportJsonPath}`);
  console.log(`report_md: ${reportMdPath}`);
}

main().catch((error: unknown) => {
  console.error("tp-race-prediction-probe failed.");
  console.error(error);
  process.exit(1);
});
