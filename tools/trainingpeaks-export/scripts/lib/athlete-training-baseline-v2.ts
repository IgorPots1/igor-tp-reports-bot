import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";
import { classifyTrainingPeaksWorkoutActivity } from "../../../../src/features/trainingpeaks/workout-activity-classification.ts";
import { DISTANCE_KEYWORDS } from "../../src/quality/race-keywords.ts";

export type BaselineV2Confidence = "high" | "medium" | "low";
export type RaceCandidateConfidence = "high" | "medium" | "low";
export type RaceDistanceKey = "5k" | "10k" | "half" | "marathon" | "unknown";
export type BaselineMode = "normal_only" | "limited_clean" | "fallback_all_weeks";
export type BaselinePeriodType =
  | "full_window"
  | "active_since"
  | "injury_return"
  | "data_gap"
  | "insufficient_active_window";

export type ActiveTrainingWindowMetrics = {
  active_training_window_start: string | null;
  active_training_window_end: string | null;
  active_training_weeks_count: number;
  pre_active_gap_weeks_count: number;
  pre_active_inactive_weeks: string[];
  all_window_frequency: number | null;
  active_window_frequency: number | null;
  normal_week_frequency: number | null;
  recent_4w_frequency: number | null;
  recent_4w_completed_minutes: number | null;
  baseline_period_type: BaselinePeriodType;
};
export type RaceCandidateSourceType =
  | "race_type_duration"
  | "strong_event_keyword"
  | "strong_result_keyword"
  | "reliable_classifier_evidence"
  | "completed_race_like_distance"
  | "distance_window_context"
  | "distance_keyword_context"
  | "pace_or_training_context_only";
export type WeekTag =
  | "normal_training"
  | "race_week"
  | "taper_week"
  | "post_race_recovery"
  | "marathon_specific_block"
  | "illness_low_volume"
  | "low_data";
export type SecondaryWeekFlag = "manual_review";
export type RaceEvidenceDecision = "true_event_candidate" | "rejected_training_context" | "manual_review";

export type CurrentBaselineContext = {
  studentId: string;
  trainingPeaksAthleteId: number | null;
  contextFlags: string[];
  confidence: BaselineV2Confidence | null;
  familyLabelAdvisory: string | null;
};

export type BaselineWeekMetrics = {
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  interval_like_count: number | null;
};

export type RaceCandidate = {
  student_id: string;
  student_name: string;
  athlete_id: number;
  workout_id: number;
  date: string;
  week_start: string;
  title: string | null;
  estimated_distance: RaceDistanceKey;
  estimated_distance_km: number | null;
  score: number;
  confidence: RaceCandidateConfidence;
  source_signals: string[];
  source_types: RaceCandidateSourceType[];
  matched_reasons: string[];
  matched_text_snippet: string | null;
  completed_without_plan: boolean;
  exclusion_eligible: boolean;
  exclusion_decision_reason: string | null;
  caused_exclusion: boolean;
};

export type WeekTagReportRow = {
  student_id: string;
  student_name: string;
  athlete_id: number;
  week_start: string;
  week_end: string;
  tag: WeekTag;
  secondary_flags: SecondaryWeekFlag[];
  completed_running_workouts: number;
  planned_running_workouts: number;
  completed_running_distance_km: number;
  planned_running_minutes: number;
  completed_running_minutes: number;
  completed_only_running_workouts: number;
  planned_only_running_workouts: number;
  ambiguous_completed_activities: number;
  planned_not_completed_context: boolean;
  low_data_reasons: Array<"no_completed_running" | "very_low_completed_running" | "classification_ambiguous" | "cache_gap">;
  longest_run_minutes: number | null;
  quality_sessions: number;
  interval_like_sessions: number;
  race_candidate_count: number;
  race_candidates: Array<{
    date: string;
    estimated_distance: RaceDistanceKey;
    confidence: RaceCandidateConfidence;
    score: number;
    title: string | null;
  }>;
  notes: string[];
};

export type PerAthleteBaselineV2 = {
  student_name: string;
  student_id: string;
  athlete_id: number;
  analyzed_from: string;
  analyzed_to: string;
  normal_baseline: BaselineWeekMetrics;
  all_week_baseline: BaselineWeekMetrics;
  planned_context_baseline: BaselineWeekMetrics;
  baseline_mode: BaselineMode;
  normal_training_weeks_count: number;
  excluded_weeks_count: number;
  excluded_weeks_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  excluded_weeks_count_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  total_weeks_count: number;
  baseline_source: "normal_training" | "fallback_all_weeks";
  baseline_metric_source: "completed_actual_running";
  baseline_change_vs_planned_context: {
    frequency_delta: number | null;
    weekly_minutes_delta: number | null;
    long_run_delta: number | null;
    quality_delta: number | null;
    materially_changed: boolean;
  };
  completed_vs_planned_divergence: {
    weeks_with_workout_count_difference: number;
    weeks_with_minutes_difference: number;
    completed_only_running_workouts: number;
    planned_only_running_workouts: number;
    ambiguous_completed_activities: number;
    low_data_reason_counts: Record<"no_completed_running" | "very_low_completed_running" | "classification_ambiguous" | "cache_gap", number>;
  };
  race_candidate_count_by_confidence: Record<RaceCandidateConfidence, number>;
  race_candidate_count_by_source_type: Record<RaceCandidateSourceType, number>;
  race_detection_diagnostics: {
    raw_race_candidates_count: number;
    clustered_race_events_count: number;
    suppressed_duplicate_candidates_count: number;
    top_race_candidates: Array<{
      date: string;
      week_start: string;
      title: string | null;
      score: number;
      confidence: RaceCandidateConfidence;
      source_types: RaceCandidateSourceType[];
      matched_reasons: string[];
      caused_exclusion: boolean;
      exclusion_decision_reason: string | null;
    }>;
    top_excluded_weeks: Array<{
      week_start: string;
      tag: Exclude<WeekTag, "normal_training">;
      reason: string;
      source_race_candidate: {
        date: string;
        title: string | null;
        score: number;
        confidence: RaceCandidateConfidence;
      } | null;
    }>;
  };
  race_specific_context: {
    race_candidates: Array<{
      date: string;
      estimated_distance: RaceDistanceKey;
      confidence: RaceCandidateConfidence;
      score: number;
      title: string | null;
    }>;
    race_candidate_count: number;
    marathon_context_detected: boolean;
    excluded_weeks_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  };
  active_training_window: ActiveTrainingWindowMetrics;
  recent_current_status: {
    latest_week_start: string | null;
    latest_week_tag: WeekTag | null;
    latest_two_weeks: Array<{
      week_start: string;
      tag: WeekTag;
      planned_running_minutes: number;
      completed_running_minutes: number;
    }>;
    recent_4w_frequency: number | null;
    recent_4w_completed_minutes: number | null;
    run_walk_status: "run_walk_actual" | "possible_run_walk_signal" | "none";
  };
  current_baseline_context: {
    context_flags: string[];
    confidence: BaselineV2Confidence | null;
    family_label_advisory: string | null;
  };
  context_flags: string[];
  confidence: BaselineV2Confidence;
  needs_review: boolean;
  notes: string[];
};

export type ManualReviewEntry = {
  student_name: string;
  athlete_id: number;
  review_reason: string;
  active_training_window: ActiveTrainingWindowMetrics;
  all_week_vs_normal: {
    frequency: { all_weeks: number | null; normal_weeks: number | null };
    weekly_minutes: { all_weeks: number | null; normal_weeks: number | null };
    long_run: { all_weeks: number | null; normal_weeks: number | null };
    quality: { all_weeks: number | null; normal_weeks: number | null };
  };
  excluded_race_taper_recovery_weeks: {
    race_week: number;
    taper_week: number;
    post_race_recovery: number;
    marathon_specific_block: number;
  };
  baseline_mode: BaselineMode;
  normal_training_weeks_count: number;
  excluded_weeks_count_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  race_candidate_count_by_confidence: Record<RaceCandidateConfidence, number>;
  race_candidate_count_by_source_type: Record<RaceCandidateSourceType, number>;
  race_detection_diagnostics: {
    raw_race_candidates_count: number;
    clustered_race_events_count: number;
    suppressed_duplicate_candidates_count: number;
  };
  top_race_candidates: PerAthleteBaselineV2["race_detection_diagnostics"]["top_race_candidates"];
  top_excluded_weeks: PerAthleteBaselineV2["race_detection_diagnostics"]["top_excluded_weeks"];
  note: string;
};

export type BaselineV2Summary = {
  generated_at: string;
  date_range: { from: string; to: string };
  active_athletes_total: number;
  athletes_analyzed: number;
  athletes_with_enough_clean_normal_weeks: number;
  athletes_with_fallback_baseline: number;
  athletes_with_detected_race_candidates: number;
  race_candidate_counts_by_distance: Record<RaceDistanceKey, number>;
  race_candidate_counts_by_confidence: Record<RaceCandidateConfidence, number>;
  total_normal_weeks: number;
  completed_vs_planned_divergence_totals: {
    weeks_with_workout_count_difference: number;
    weeks_with_minutes_difference: number;
    completed_only_running_workouts: number;
    planned_only_running_workouts: number;
    ambiguous_completed_activities: number;
  };
  athletes_with_material_completed_vs_planned_change: number;
  total_excluded_weeks_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  confidence_distribution: Record<BaselineV2Confidence, number>;
  needs_review_count: number;
  athletes_with_active_since_window: number;
  athletes_with_insufficient_active_window: number;
  report_paths?: Record<string, string>;
};

export type DataGap = {
  label: string;
  value: number | string;
  note?: string;
};

export type BaselineV2Analysis = {
  summary: BaselineV2Summary;
  perAthlete: PerAthleteBaselineV2[];
  raceCandidates: RaceCandidate[];
  weekTags: WeekTagReportRow[];
  manualReviewShortlist: ManualReviewEntry[];
  dataGaps: DataGap[];
  raceEvidenceCalibration: RaceEvidenceCalibrationReport;
};

export type RaceEvidenceCalibrationExample = {
  student_id: string;
  athlete_id: number;
  athlete_name: string;
  date: string;
  title: string | null;
  completed: boolean;
  planned: boolean;
  estimated_distance_km: number | null;
  duration_minutes: number | null;
  raceTypeDuration: string | number | null;
  matched_positive_evidence: string[];
  matched_negative_training_context: string[];
  decision: RaceEvidenceDecision;
  would_drive_race_exclusions: boolean;
  notes: string[];
};

export type RaceEvidenceCalibrationReport = {
  generated_at: string;
  date_range: { from: string; to: string };
  totals: {
    considered_examples: number;
    true_event_candidate: number;
    rejected_training_context: number;
    manual_review: number;
  };
  potential_positive_examples: RaceEvidenceCalibrationExample[];
  rejected_training_context_examples: RaceEvidenceCalibrationExample[];
  manual_review_examples: RaceEvidenceCalibrationExample[];
};

type AthleteInput = {
  studentId: string;
  studentName: string;
  athleteId: number;
  rows: TrainingPeaksWorkoutCacheRow[];
  currentBaseline: CurrentBaselineContext | null;
};

type WorkoutInsight = {
  row: TrainingPeaksWorkoutCacheRow;
  text: string;
  title: string | null;
  activityFamily: string;
  activityConfidence: "high" | "medium" | "low";
  isRunning: boolean;
  isAmbiguousCompletedActivity: boolean;
  plannedMinutes: number | null;
  completedMinutes: number | null;
  completedDistanceKm: number | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  isCompleted: boolean;
  isPlanned: boolean;
  completedWithoutPlan: boolean;
  weekStart: string;
  weekEnd: string;
  qualityLike: boolean;
  intervalLike: boolean;
  longRunLike: boolean;
  explicitRunWalk: boolean;
  marathonSpecificCue: boolean;
};

type WeekAccumulator = {
  studentId: string;
  studentName: string;
  athleteId: number;
  weekStart: string;
  weekEnd: string;
  completedRunningWorkouts: number;
  plannedRunningWorkouts: number;
  completedRunningDistanceKm: number;
  plannedRunningMinutes: number;
  completedRunningMinutes: number;
  completedOnlyRunningWorkouts: number;
  plannedOnlyRunningWorkouts: number;
  ambiguousCompletedActivities: number;
  longestRunMinutes: number | null;
  qualitySessions: number;
  intervalLikeSessions: number;
  marathonSpecificCue: boolean;
  raceCandidates: RaceCandidate[];
  lowConfidenceRaceCandidates: RaceCandidate[];
  notes: string[];
};

type RaceWindow = {
  weekStart: string;
  distance: RaceDistanceKey;
  confidence: RaceCandidateConfidence;
  candidate: RaceCandidate;
};

const EXCLUDED_TAGS: Array<Exclude<WeekTag, "normal_training">> = [
  "race_week",
  "taper_week",
  "post_race_recovery",
  "marathon_specific_block",
  "illness_low_volume",
  "low_data",
];

const WEEK_PRIORITY: WeekTag[] = [
  "race_week",
  "post_race_recovery",
  "taper_week",
  "marathon_specific_block",
  "illness_low_volume",
  "low_data",
  "normal_training",
];

const QUALITY_PATTERN =
  /\b(interval|intervals|repeats?|fartlek|tempo|threshold|vo2|vo₂|hill|track|порог|темп|интерв|фартлек|горк|ускорен)\b/i;
const INTERVAL_PATTERN =
  /(\d{1,2})\s*[xх×*]\s*(\d{1,4}(?:[.,]\d+)?)\s*(мин|min|км|km|сек|sec|м|m)?/i;
const LONG_RUN_PATTERN = /(длительн|long run|\blong\b)/i;
const MARATHON_SPECIFIC_PATTERN =
  /(марафонск(?:ий|ого)?\s*темп|marathon pace|\bмт\b|\bмп\b|20\s*км\s*в\s*мт|25\s*км\s*в\s*мт|гели|питани)/i;
const RUN_WALK_STRONG_PATTERN =
  /(run[- ]?walk|run\s*\/\s*walk|бег\s*\/\s*шаг|бег\s*\/\s*ходьб|walk breaks?|чередован(?:ие)?\s*бег.*ходьб|ходьб.*бег)/i;
const STRONG_EVENT_RESULT_KEYWORDS =
  /\b(race day|official race|official event|event day|parkrun|park run|парк\s*ран|забег|соревнован|официальн(?:ый|ая)?\s*старт|official result|finisher|протокол|результат)\b/i;
const WEAK_CONTEXT_KEYWORDS =
  /\b(race pace|10k pace|5k pace|hm pace|half marathon pace|marathon pace|пейс\s*гонки|темп\s*гонки|темп\s*старта|5к\s*темп|10к\s*темп|марафонск(?:ий|ого)?\s*темп)\b/i;
const POSITIVE_EVENT_KEYWORDS =
  /(?:^|[^a-zа-яё0-9])(race day|official race|official event|event day|parkrun|park run|забег|соревнован|соревновал|гонк|протокол|полумарафон|марафон|официальн(?:ый|ая)?\s*(?:старт|забег|гонк)|5\s*верст)(?:$|[^a-zа-яё0-9])/iu;
const POSITIVE_RESULT_KEYWORDS =
  /(?:^|[^a-zа-яё0-9])(result|results|official result|finisher|podium|placing|place|time\s*result|результат|протокол|место|время\s*на\s*финише)(?:$|[^a-zа-яё0-9])/iu;
const POSITIVE_START_WORDS = /\b(started race|race started|стартовал|стартовала|на старте|в старте)\b/i;
const POSITIVE_FINISH_WORDS = /\b(finished|finish|finisher|финишировал|финишировала)\b/i;
const STRONG_EVENT_TITLE_PATTERN =
  /\b(official race|official event|parkrun|park run|забег|соревнован|полумарафон|марафон|5\s*верст)\b/i;
const NEGATIVE_TRAINING_CONTEXT_KEYWORDS =
  /\b(10k pace|5k pace|hm pace|half marathon pace|marathon pace|race pace|tempo|threshold|interval|intervals|workout|session|planned|plan|target pace|target hr|целевой темп|темпов|порог|интервал|фартлек|тренировк|подводящ|полумарафонск(?:ий|ого)?\s*темп|марафонск(?:ий|ого)?\s*темп)\b/i;
const NEGATIVE_COACH_WORKOUT_PATTERN = /\b(coach comments?|описани(?:е)? тренировки|цель тренировки|workout description)\b/i;
const DISTANCE_WINDOW_TOLERANCE = {
  marathon: [41.0, 43.5] as const,
  half: [20.5, 21.8] as const,
  "10k": [9.6, 10.6] as const,
  "5k": [4.8, 5.3] as const,
};
const OVERBROAD_JAN_JUN_CLUSTER_THRESHOLD = 5;
const OVERBROAD_JAN_JUN_EXCLUSION_THRESHOLD = 10;
const MIN_ACTIVE_COMPLETED_MINUTES = 45;
const MIN_ACTIVE_WINDOW_WEEKS = 3;

function normalizeText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseClockMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  return hours * 60 + minutes + seconds / 60;
}

function durationMinutesFromRaw(raw: unknown): number | null {
  if (typeof raw === "string") {
    const clock = parseClockMinutes(raw);
    if (clock !== null && clock > 0) return clock;
  }
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;
  if (value >= 300) return Number((value / 60).toFixed(1));
  if (value <= 6) return Number((value * 60).toFixed(1));
  return Number(value.toFixed(1));
}

function distanceKmFromRaw(raw: unknown): number | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;
  if (value > 1000) return Number((value / 1000).toFixed(2));
  if (value > 100 && value <= 1000) return Number((value / 1000).toFixed(2));
  return Number(value.toFixed(2));
}

function durationMinutesForRow(row: TrainingPeaksWorkoutCacheRow, mode: "planned" | "completed" | "best"): number | null {
  const snapshot = isRecord(row.sourceSnapshot) ? row.sourceSnapshot : null;
  if (mode === "planned") {
    const snapshotPlanned = durationMinutesFromRaw(snapshot?.totalTimePlanned);
    if (snapshotPlanned !== null) return snapshotPlanned;
    return durationMinutesFromRaw(row.plannedTimeRaw);
  }
  if (mode === "completed") {
    const snapshotCompleted = durationMinutesFromRaw(snapshot?.rawTotalTime);
    if (snapshotCompleted !== null) return snapshotCompleted;
    return durationMinutesFromRaw(row.completedTimeRaw);
  }
  return durationMinutesForRow(row, "planned") ?? durationMinutesForRow(row, "completed");
}

function distanceKmForRow(row: TrainingPeaksWorkoutCacheRow): number | null {
  const snapshot = isRecord(row.sourceSnapshot) ? row.sourceSnapshot : null;
  return (
    distanceKmFromRaw(row.completedDistanceRaw) ??
    distanceKmFromRaw(snapshot?.rawDistance) ??
    distanceKmFromRaw(row.plannedDistanceRaw) ??
    distanceKmFromRaw(snapshot?.totalDistancePlanned) ??
    distanceKmFromRaw(snapshot?.rawDistancePlanned)
  );
}

function completedDistanceKmForRow(row: TrainingPeaksWorkoutCacheRow): number | null {
  const snapshot = isRecord(row.sourceSnapshot) ? row.sourceSnapshot : null;
  return distanceKmFromRaw(row.completedDistanceRaw) ?? distanceKmFromRaw(snapshot?.rawDistance);
}

function weekStartIso(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + mondayOffset);
  return monday.toISOString().slice(0, 10);
}

function weekEndIso(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

function weekDistance(start: string, end: string): number {
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((endTime - startTime) / (7 * 24 * 60 * 60 * 1000));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2).toFixed(2));
  }
  return Number((sorted[middle] ?? 0).toFixed(2));
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const lower = sorted[base] ?? sorted[0]!;
  const upper = sorted[base + 1] ?? lower;
  return Number((lower + rest * (upper - lower)).toFixed(2));
}

function uniqueSorted<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function pickTextSnippet(text: string): string | null {
  if (!text.trim()) return null;
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
}

function extractRegexMatches(pattern: RegExp, text: string): string[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const values: string[] = [];
  for (const match of text.matchAll(regex)) {
    const raw = (match[0] ?? "")
      .trim()
      .toLowerCase()
      .replace(/^[^a-zа-яё0-9]+/iu, "")
      .replace(/[^a-zа-яё0-9]+$/iu, "");
    if (raw) values.push(raw);
  }
  return uniqueSorted(values);
}

function estimateRaceDistance(text: string, distanceKm: number | null): RaceDistanceKey {
  if (DISTANCE_KEYWORDS.marathon.test(text)) return "marathon";
  if (DISTANCE_KEYWORDS.half.test(text)) return "half";
  if (DISTANCE_KEYWORDS["10k"].test(text)) return "10k";
  if (DISTANCE_KEYWORDS["5k"].test(text)) return "5k";
  if (distanceKm !== null) {
    if (distanceKm >= 41.0 && distanceKm <= 43.5) return "marathon";
    if (distanceKm >= 20.5 && distanceKm <= 21.8) return "half";
    if (distanceKm >= 9.6 && distanceKm <= 10.6) return "10k";
    if (distanceKm >= 4.8 && distanceKm <= 5.3) return "5k";
  }
  return "unknown";
}

function isWithinRaceDistanceWindow(distance: RaceDistanceKey, distanceKm: number | null): boolean {
  if (distanceKm === null || distance === "unknown") return false;
  const bounds = DISTANCE_WINDOW_TOLERANCE[distance];
  if (!bounds) return false;
  return distanceKm >= bounds[0] && distanceKm <= bounds[1];
}

function emptyRaceByConfidence(): Record<RaceCandidateConfidence, number> {
  return { high: 0, medium: 0, low: 0 };
}

function emptyRaceBySourceType(): Record<RaceCandidateSourceType, number> {
  return {
    race_type_duration: 0,
    strong_event_keyword: 0,
    strong_result_keyword: 0,
    reliable_classifier_evidence: 0,
    completed_race_like_distance: 0,
    distance_window_context: 0,
    distance_keyword_context: 0,
    pace_or_training_context_only: 0,
  };
}

function raceTaperWeeks(distance: RaceDistanceKey): number {
  if (distance === "marathon") return 3;
  if (distance === "half") return 2;
  if (distance === "5k" || distance === "10k") return 1;
  return 1;
}

function raceRecoveryWeeks(distance: RaceDistanceKey): number {
  if (distance === "marathon") return 2;
  return 1;
}

function buildWorkoutInsight(row: TrainingPeaksWorkoutCacheRow): WorkoutInsight {
  const snapshot = isRecord(row.sourceSnapshot) ? row.sourceSnapshot : null;
  const text = normalizeText(row.title, String(snapshot?.description ?? ""), String(snapshot?.coachComments ?? ""));
  const activity = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    sourceSnapshot: row.sourceSnapshot,
  });
  const plannedMinutes = durationMinutesForRow(row, "planned");
  const completedMinutes = durationMinutesForRow(row, "completed");
  const durationMinutes = plannedMinutes ?? completedMinutes;
  const longRunLike = LONG_RUN_PATTERN.test(text) || ((durationMinutes ?? 0) >= 80 && activity.isRunning);
  const qualityLike = QUALITY_PATTERN.test(text) || INTERVAL_PATTERN.test(text) || MARATHON_SPECIFIC_PATTERN.test(text);
  const marathonSpecificCue = MARATHON_SPECIFIC_PATTERN.test(text);
  const isAmbiguousCompletedActivity =
    row.isCompleted &&
    !activity.isRunning &&
    (activity.family === "unknown" || (activity.family === "other" && activity.confidence === "low"));

  return {
    row,
    text,
    title: row.title,
    activityFamily: activity.family,
    activityConfidence: activity.confidence,
    isRunning: activity.isRunning,
    isAmbiguousCompletedActivity,
    plannedMinutes,
    completedMinutes,
    completedDistanceKm: completedDistanceKmForRow(row),
    durationMinutes,
    distanceKm: distanceKmForRow(row),
    isCompleted: row.isCompleted,
    isPlanned: row.isPlanned,
    completedWithoutPlan: row.isCompleted && !row.isPlanned,
    weekStart: weekStartIso(row.workoutDate),
    weekEnd: weekEndIso(weekStartIso(row.workoutDate)),
    qualityLike,
    intervalLike: INTERVAL_PATTERN.test(text) || /\b(vo2|vo₂|threshold|tempo|порог|интерв|фартлек|hill)\b/i.test(text),
    longRunLike,
    explicitRunWalk: RUN_WALK_STRONG_PATTERN.test(text),
    marathonSpecificCue,
  };
}

function evaluateRaceEvidence(insight: WorkoutInsight): {
  decision: RaceEvidenceDecision;
  matchedPositiveEvidence: string[];
  matchedNegativeTrainingContext: string[];
  strongEvidence: boolean;
  exclusionEligible: boolean;
  hasRaceTypeDuration: boolean;
  hasReliableClassifierEvidence: boolean;
  hasStrongEventKeyword: boolean;
  hasStrongResultKeyword: boolean;
  hasCompletedRaceLikeDistance: boolean;
  distanceKeywordMatch: boolean;
  distanceWindowMatch: boolean;
  estimatedDistance: RaceDistanceKey;
  sourceSignals: string[];
  sourceTypes: Set<RaceCandidateSourceType>;
  matchedReasons: Set<string>;
  score: number;
  exclusionDecisionReason: string | null;
  notes: string[];
} {
  const snapshot = isRecord(insight.row.sourceSnapshot) ? insight.row.sourceSnapshot : null;
  const sourceSignals: string[] = [];
  const sourceTypes = new Set<RaceCandidateSourceType>();
  const matchedReasons = new Set<string>();
  const matchedPositiveEvidence: string[] = [];
  const matchedNegativeTrainingContext: string[] = [];
  const notes: string[] = [];
  let score = 0;
  const estimatedDistance = estimateRaceDistance(insight.text, insight.distanceKm);
  const distanceKeywordMatch = estimatedDistance !== "unknown" && DISTANCE_KEYWORDS[estimatedDistance].test(insight.text);
  const distanceWindowMatch = isWithinRaceDistanceWindow(estimatedDistance, insight.distanceKm);
  const tssActual = toFiniteNumber(snapshot?.tssActual);
  const ifActual = toFiniteNumber(snapshot?.ifActual);
  const effortSupport =
    ((tssActual ?? 0) >= 50 || (ifActual ?? 0) >= 0.9) && ((insight.distanceKm ?? 0) >= 5 || (insight.durationMinutes ?? 0) >= 20);
  const hasRaceTypeDuration = snapshot?.raceTypeDuration !== null && snapshot?.raceTypeDuration !== undefined;
  const hasStrongEventKeyword = STRONG_EVENT_RESULT_KEYWORDS.test(insight.text) || POSITIVE_EVENT_KEYWORDS.test(insight.text);
  const hasStrongResultKeyword = POSITIVE_RESULT_KEYWORDS.test(insight.text) || POSITIVE_FINISH_WORDS.test(insight.text);
  const hasStrongStartKeyword = POSITIVE_START_WORDS.test(insight.text);
  const classifierLabelRaw =
    typeof snapshot?.resultStatus === "string" ? snapshot.resultStatus : typeof snapshot?.result_status === "string" ? snapshot.result_status : null;
  const classifierConfidence = toFiniteNumber(snapshot?.eventConfidence ?? snapshot?.event_confidence);
  const classifierLabel = classifierLabelRaw?.toLowerCase().trim() ?? "";
  const hasReliableClassifierEvidence = Boolean(
    classifierLabel &&
      (classifierLabel.includes("official_event") || classifierLabel.includes("probable_result") || classifierLabel.includes("result")) &&
      (classifierConfidence ?? 0) >= 0.6,
  );
  const hasPaceOrTrainingOnlyCue = WEAK_CONTEXT_KEYWORDS.test(insight.text);
  const hasBroadTrainingContext = NEGATIVE_TRAINING_CONTEXT_KEYWORDS.test(insight.text) || NEGATIVE_COACH_WORKOUT_PATTERN.test(insight.text);
  const hasRaceRouteTrainingContext = /\b(маршрут[а-я]*\s+забега|course|route)\b/i.test(insight.text) && /\b(тренировк|подготов|workout|session)\b/i.test(insight.text);
  const hasCompletedRaceLikeDistance = insight.isCompleted && distanceWindowMatch;
  const positiveKeywordMatches = uniqueSorted([
    ...extractRegexMatches(POSITIVE_EVENT_KEYWORDS, insight.text),
    ...extractRegexMatches(POSITIVE_RESULT_KEYWORDS, insight.text),
    ...extractRegexMatches(POSITIVE_START_WORDS, insight.text),
    ...extractRegexMatches(POSITIVE_FINISH_WORDS, insight.text),
  ]);
  const negativeKeywordMatches = uniqueSorted([
    ...extractRegexMatches(WEAK_CONTEXT_KEYWORDS, insight.text),
    ...extractRegexMatches(NEGATIVE_TRAINING_CONTEXT_KEYWORDS, insight.text),
    ...extractRegexMatches(NEGATIVE_COACH_WORKOUT_PATTERN, insight.text),
  ]);
  matchedPositiveEvidence.push(...positiveKeywordMatches);
  matchedNegativeTrainingContext.push(...negativeKeywordMatches);
  const hasEventNameStyleTitle =
    Boolean(insight.title) &&
    STRONG_EVENT_TITLE_PATTERN.test(insight.title ?? "") &&
    !NEGATIVE_TRAINING_CONTEXT_KEYWORDS.test(insight.title ?? "");
  if (hasEventNameStyleTitle) {
    matchedPositiveEvidence.push("event_name_style_title");
    sourceSignals.push("event_name_style_title");
    sourceTypes.add("strong_event_keyword");
    matchedReasons.add("Event-like race name in title");
  }

  if (hasRaceTypeDuration) {
    score += 5;
    sourceSignals.push("explicit_raceTypeDuration");
    sourceTypes.add("race_type_duration");
    matchedReasons.add("TrainingPeaks raceTypeDuration present");
    matchedPositiveEvidence.push("raceTypeDuration");
  }
  if (hasStrongEventKeyword || hasStrongStartKeyword) {
    score += hasStrongResultKeyword ? 4 : 2;
    sourceSignals.push("strong_event_result_keyword");
    sourceTypes.add("strong_event_keyword");
    matchedReasons.add("Strong race/event keyword in workout text");
  }
  if (hasStrongResultKeyword) {
    sourceTypes.add("strong_result_keyword");
    matchedReasons.add("Strong result/finish keyword in workout text");
  }
  if (hasReliableClassifierEvidence) {
    score += 4;
    sourceSignals.push(`classifier:${classifierLabel || "result_like"}:${(classifierConfidence ?? 0).toFixed(2)}`);
    sourceTypes.add("reliable_classifier_evidence");
    matchedReasons.add("Reliable existing result/event classifier evidence");
    matchedPositiveEvidence.push(`classifier:${classifierLabel || "result_like"}`);
  }
  if (distanceKeywordMatch) {
    score += 1;
    sourceSignals.push(`distance_keyword:${estimatedDistance}`);
    sourceTypes.add("distance_keyword_context");
    matchedReasons.add(`Distance keyword context for ${estimatedDistance}`);
  }
  if (distanceWindowMatch) {
    score += 1;
    sourceSignals.push(`distance_window:${estimatedDistance}`);
    sourceTypes.add("distance_window_context");
    matchedReasons.add(`Distance window context for ${estimatedDistance}`);
  }
  if (hasCompletedRaceLikeDistance) {
    score += 1;
    sourceSignals.push("completed_race_like_distance");
    sourceTypes.add("completed_race_like_distance");
    matchedReasons.add("Completed activity in race-like distance window");
    matchedPositiveEvidence.push("completed_race_like_distance");
  }
  if (effortSupport) {
    score += 1;
    sourceSignals.push("effort_support");
  }
  if (insight.completedWithoutPlan) {
    sourceSignals.push("completed_without_plan");
  }
  if (hasPaceOrTrainingOnlyCue || hasBroadTrainingContext) {
    sourceTypes.add("pace_or_training_context_only");
    if (hasPaceOrTrainingOnlyCue) matchedNegativeTrainingContext.push("pace_context");
    if (hasBroadTrainingContext) matchedNegativeTrainingContext.push("training_session_context");
  }
  if (hasRaceRouteTrainingContext) {
    sourceTypes.add("pace_or_training_context_only");
    matchedNegativeTrainingContext.push("race_route_training_context");
  }

  const strongEvidence =
    hasRaceTypeDuration ||
    hasReliableClassifierEvidence ||
    hasEventNameStyleTitle ||
    ((hasStrongEventKeyword || hasStrongStartKeyword || hasStrongResultKeyword) &&
      insight.isCompleted &&
      !hasPaceOrTrainingOnlyCue &&
      !hasRaceRouteTrainingContext) ||
    (hasCompletedRaceLikeDistance && (hasStrongEventKeyword || hasStrongResultKeyword || hasReliableClassifierEvidence || hasRaceTypeDuration));

  const exclusionEligible =
    hasRaceTypeDuration ||
    hasReliableClassifierEvidence ||
    (hasEventNameStyleTitle && insight.isCompleted && (hasCompletedRaceLikeDistance || (insight.durationMinutes ?? 0) >= 45)) ||
    (hasStrongResultKeyword && insight.isCompleted && !hasPaceOrTrainingOnlyCue) ||
    ((hasStrongEventKeyword || hasStrongStartKeyword) &&
      insight.isCompleted &&
      !hasPaceOrTrainingOnlyCue &&
      !hasRaceRouteTrainingContext &&
      (hasCompletedRaceLikeDistance || (distanceKeywordMatch && effortSupport) || (distanceWindowMatch && effortSupport)));

  let decision: RaceEvidenceDecision = "rejected_training_context";
  if (!insight.isRunning) {
    decision = "rejected_training_context";
    notes.push("non_running_activity");
  } else if (strongEvidence && exclusionEligible) {
    decision = "true_event_candidate";
  } else if (
    (hasStrongEventKeyword || hasStrongResultKeyword || hasStrongStartKeyword || distanceWindowMatch || distanceKeywordMatch) &&
    !exclusionEligible
  ) {
    decision = "manual_review";
    notes.push("partial_evidence_not_enough_for_exclusion");
  } else {
    decision = "rejected_training_context";
  }

  if (!insight.isCompleted && (hasStrongEventKeyword || hasStrongResultKeyword || hasStrongStartKeyword)) {
    decision = "manual_review";
    notes.push("planned_or_uncompleted_event_like_text");
  }
  if ((hasPaceOrTrainingOnlyCue || hasBroadTrainingContext || hasRaceRouteTrainingContext) && !hasRaceTypeDuration && !hasReliableClassifierEvidence) {
    if (decision === "true_event_candidate") {
      decision = "manual_review";
      notes.push("training_context_present_requires_manual_check");
    } else {
      decision = "rejected_training_context";
    }
  }

  const exclusionDecisionReason =
    decision === "true_event_candidate"
      ? hasRaceTypeDuration
        ? "raceTypeDuration"
        : hasReliableClassifierEvidence
          ? "reliable_classifier_evidence"
          : hasStrongResultKeyword
            ? "strong_result_keyword"
            : "strong_event_keyword_plus_race_like_completion"
      : decision === "manual_review"
        ? "manual_review_partial_evidence"
        : "context_only_non_exclusion";

  return {
    decision,
    matchedPositiveEvidence: uniqueSorted(matchedPositiveEvidence),
    matchedNegativeTrainingContext: uniqueSorted(matchedNegativeTrainingContext),
    strongEvidence,
    exclusionEligible: decision === "true_event_candidate" && exclusionEligible,
    hasRaceTypeDuration,
    hasReliableClassifierEvidence,
    hasStrongEventKeyword: hasStrongEventKeyword || hasStrongStartKeyword,
    hasStrongResultKeyword,
    hasCompletedRaceLikeDistance,
    distanceKeywordMatch,
    distanceWindowMatch,
    estimatedDistance,
    sourceSignals,
    sourceTypes,
    matchedReasons,
    score,
    exclusionDecisionReason,
    notes,
  };
}

function buildRaceCandidate(insight: WorkoutInsight): RaceCandidate | null {
  if (!insight.isRunning) return null;
  const evidence = evaluateRaceEvidence(insight);
  if (evidence.decision !== "true_event_candidate") return null;

  let confidence: RaceCandidateConfidence = "low";
  if (
    evidence.hasRaceTypeDuration ||
    (evidence.hasReliableClassifierEvidence && (evidence.hasStrongEventKeyword || evidence.hasStrongResultKeyword))
  ) {
    confidence = "high";
  } else if (evidence.exclusionEligible || evidence.score >= 6) {
    confidence = "medium";
  }

  return {
    student_id: insight.row.studentId,
    student_name: insight.row.studentName,
    athlete_id: insight.row.trainingPeaksAthleteId,
    workout_id: insight.row.trainingPeaksWorkoutId,
    date: insight.row.workoutDate,
    week_start: insight.weekStart,
    title: insight.title,
    estimated_distance: evidence.estimatedDistance,
    estimated_distance_km: insight.distanceKm,
    score: evidence.score,
    confidence,
    source_signals: evidence.sourceSignals,
    source_types: sortSourceTypesForOutput([...evidence.sourceTypes]),
    matched_reasons: [...evidence.matchedReasons],
    matched_text_snippet: pickTextSnippet(insight.text),
    completed_without_plan: insight.completedWithoutPlan,
    exclusion_eligible: evidence.exclusionEligible,
    exclusion_decision_reason: evidence.exclusionDecisionReason,
    caused_exclusion: false,
  };
}

function emptyExcludedCounts(): Record<Exclude<WeekTag, "normal_training">, number> {
  return {
    race_week: 0,
    taper_week: 0,
    post_race_recovery: 0,
    marathon_specific_block: 0,
    illness_low_volume: 0,
    low_data: 0,
  };
}

function computeWeekMetrics(weeks: WeekTagReportRow[], source: "completed" | "planned"): BaselineWeekMetrics {
  const frequencyValues = weeks.map((week) =>
    source === "completed" ? week.completed_running_workouts : week.planned_running_workouts,
  );
  const minuteValues = weeks.map((week) =>
    source === "completed" ? week.completed_running_minutes : week.planned_running_minutes,
  );
  return {
    frequency_cap: median(frequencyValues),
    weekly_minutes_cap: quantile(minuteValues, 0.75),
    long_run_cap_min: quantile(
      weeks.map((week) => week.longest_run_minutes).filter((value): value is number => value !== null),
      0.75,
    ),
    quality_count_cap: median(weeks.map((week) => week.quality_sessions)),
    interval_like_count: median(weeks.map((week) => week.interval_like_sessions)),
  };
}

function isMeaningfulActiveRunningWeek(week: WeekTagReportRow): boolean {
  return week.completed_running_workouts >= 1 && week.completed_running_minutes >= MIN_ACTIVE_COMPLETED_MINUTES;
}

function hasThreeConsecutiveActiveWeeks(weeks: WeekTagReportRow[], startIndex: number): boolean {
  if (startIndex + 2 >= weeks.length) return false;
  return (
    isMeaningfulActiveRunningWeek(weeks[startIndex]!) &&
    isMeaningfulActiveRunningWeek(weeks[startIndex + 1]!) &&
    isMeaningfulActiveRunningWeek(weeks[startIndex + 2]!)
  );
}

function hasThreeOfFourActiveWeeks(weeks: WeekTagReportRow[], startIndex: number): boolean {
  const slice = weeks.slice(startIndex, startIndex + 4);
  if (slice.length < 4) return false;
  return slice.filter(isMeaningfulActiveRunningWeek).length >= 3;
}

function detectActiveTrainingWindowStart(weekRows: WeekTagReportRow[]): string | null {
  const sorted = [...weekRows].sort((a, b) => a.week_start.localeCompare(b.week_start));
  for (let index = 0; index < sorted.length; index += 1) {
    if (hasThreeConsecutiveActiveWeeks(sorted, index)) {
      return sorted[index]!.week_start;
    }
    if (hasThreeOfFourActiveWeeks(sorted, index)) {
      const slice = sorted.slice(index, index + 4);
      const firstActive = slice.find(isMeaningfulActiveRunningWeek);
      return firstActive?.week_start ?? sorted[index]!.week_start;
    }
  }
  return null;
}

function recentWeekSlice(weekRows: WeekTagReportRow[], count: number): WeekTagReportRow[] {
  return [...weekRows].sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, count);
}

function buildActiveTrainingWindowMetrics(input: {
  weekRows: WeekTagReportRow[];
  analyzedFrom: string;
  normalBaselineFrequency: number | null;
  allWeekBaselineFrequency: number | null;
}): ActiveTrainingWindowMetrics {
  const sortedWeeks = [...input.weekRows].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const windowWeeks = sortedWeeks.filter((week) => week.week_start >= input.analyzedFrom);
  const activeStart = detectActiveTrainingWindowStart(windowWeeks.length > 0 ? windowWeeks : sortedWeeks);
  const activeEnd = (windowWeeks.length > 0 ? windowWeeks : sortedWeeks).at(-1)?.week_start ?? null;

  const weeksInScope = windowWeeks.length > 0 ? windowWeeks : sortedWeeks;
  const preActiveInactiveWeeks = activeStart
    ? weeksInScope.filter((week) => week.week_start < activeStart).map((week) => week.week_start)
    : [];

  const activeWindowWeeks = activeStart
    ? weeksInScope.filter((week) => week.week_start >= activeStart)
    : weeksInScope;
  const meaningfulActiveWeeks = activeWindowWeeks.filter(isMeaningfulActiveRunningWeek);
  const activeWindowFrequency = median(meaningfulActiveWeeks.map((week) => week.completed_running_workouts));

  const recentFour = recentWeekSlice(weeksInScope, 4);
  const recent4wFrequency = median(recentFour.map((week) => week.completed_running_workouts));
  const recent4wCompletedMinutes = median(recentFour.map((week) => week.completed_running_minutes));

  let baselinePeriodType: BaselinePeriodType = "full_window";
  if (!activeStart || meaningfulActiveWeeks.length < MIN_ACTIVE_WINDOW_WEEKS) {
    baselinePeriodType = "insufficient_active_window";
  } else if (preActiveInactiveWeeks.length > 0 && activeStart > input.analyzedFrom) {
    const preActiveCacheGaps = preActiveInactiveWeeks.filter((weekStart) => {
      const week = weeksInScope.find((candidate) => candidate.week_start === weekStart);
      return week?.low_data_reasons.includes("cache_gap") ?? false;
    }).length;
    if (preActiveCacheGaps >= Math.max(2, Math.floor(preActiveInactiveWeeks.length * 0.5))) {
      baselinePeriodType = "data_gap";
    } else {
      baselinePeriodType = "active_since";
    }
  } else if (
    input.normalBaselineFrequency !== null &&
    recent4wFrequency !== null &&
    input.normalBaselineFrequency - recent4wFrequency >= 1.5 &&
    recentFour.some((week) => week.tag === "illness_low_volume" || week.tag === "low_data")
  ) {
    baselinePeriodType = "injury_return";
  }

  return {
    active_training_window_start: activeStart,
    active_training_window_end: activeEnd,
    active_training_weeks_count: meaningfulActiveWeeks.length,
    pre_active_gap_weeks_count: preActiveInactiveWeeks.length,
    pre_active_inactive_weeks: preActiveInactiveWeeks,
    all_window_frequency: input.allWeekBaselineFrequency,
    active_window_frequency: activeWindowFrequency,
    normal_week_frequency: input.normalBaselineFrequency,
    recent_4w_frequency: recent4wFrequency,
    recent_4w_completed_minutes: recent4wCompletedMinutes,
    baseline_period_type: baselinePeriodType,
  };
}

function applyActiveTrainingWindowContext(input: {
  activeWindow: ActiveTrainingWindowMetrics;
  contextFlags: Set<string>;
  notes: string[];
  needsReview: boolean;
}): boolean {
  let needsReview = input.needsReview;
  const { activeWindow } = input;

  if (activeWindow.baseline_period_type === "active_since") {
    input.contextFlags.add("active_since");
    input.notes.push(
      `Active training window starts ${activeWindow.active_training_window_start}; ${activeWindow.pre_active_gap_weeks_count} pre-active weeks excluded from baseline context.`,
    );
  }
  if (activeWindow.pre_active_gap_weeks_count > 0) {
    input.contextFlags.add("pre_active_gap_excluded");
  }
  if (
    activeWindow.all_window_frequency !== null &&
    activeWindow.normal_week_frequency !== null &&
    activeWindow.normal_week_frequency - activeWindow.all_window_frequency >= 1
  ) {
    input.contextFlags.add("normal_vs_all_window_shift");
    needsReview = true;
    input.notes.push(
      `Normal-week frequency (${activeWindow.normal_week_frequency}) is higher than all-window (${activeWindow.all_window_frequency}); early inactive weeks should not lower planning baseline.`,
    );
  }
  if (
    activeWindow.normal_week_frequency !== null &&
    activeWindow.recent_4w_frequency !== null &&
    Math.abs(activeWindow.normal_week_frequency - activeWindow.recent_4w_frequency) >= 1.5
  ) {
    input.contextFlags.add("recent_status_differs_from_baseline");
    needsReview = true;
    input.notes.push(
      `Recent 4-week frequency (${activeWindow.recent_4w_frequency}) differs from normal baseline (${activeWindow.normal_week_frequency}); treat as recent-status overlay.`,
    );
  }
  if (activeWindow.baseline_period_type === "injury_return") {
    input.contextFlags.add("injury_break_context");
    input.contextFlags.add("healthy_baseline_vs_recent_status");
    needsReview = true;
    input.notes.push("Recent injury/break pattern detected; healthy baseline kept separate from recent status.");
  }
  if (activeWindow.baseline_period_type === "insufficient_active_window") {
    input.contextFlags.add("insufficient_active_window");
    needsReview = true;
    input.notes.push("Insufficient sustained active training window for confident baseline.");
  }

  return needsReview;
}

function baselineDiffScore(athlete: PerAthleteBaselineV2): number {
  const frequencyDiff = Math.abs((athlete.all_week_baseline.frequency_cap ?? 0) - (athlete.normal_baseline.frequency_cap ?? 0)) * 25;
  const minutesDiff = Math.abs((athlete.all_week_baseline.weekly_minutes_cap ?? 0) - (athlete.normal_baseline.weekly_minutes_cap ?? 0));
  const longRunDiff = Math.abs((athlete.all_week_baseline.long_run_cap_min ?? 0) - (athlete.normal_baseline.long_run_cap_min ?? 0)) * 1.5;
  const qualityDiff = Math.abs((athlete.all_week_baseline.quality_count_cap ?? 0) - (athlete.normal_baseline.quality_count_cap ?? 0)) * 20;
  return Number((frequencyDiff + minutesDiff + longRunDiff + qualityDiff).toFixed(2));
}

function buildManualReviewShortlist(perAthlete: PerAthleteBaselineV2[]): ManualReviewEntry[] {
  const athletesByName = new Map(perAthlete.map((athlete) => [athlete.student_name.toLowerCase(), athlete]));
  const picked = new Map<string, ManualReviewEntry>();

  function addByName(name: string, reason: string, note: string): void {
    const athlete = athletesByName.get(name.toLowerCase());
    if (!athlete) return;
    if (picked.has(athlete.student_id)) return;
    picked.set(athlete.student_id, makeEntry(athlete, reason, note));
  }

  function addAthlete(athlete: PerAthleteBaselineV2, reason: string, note: string): void {
    if (picked.has(athlete.student_id)) return;
    picked.set(athlete.student_id, makeEntry(athlete, reason, note));
  }

  function makeEntry(athlete: PerAthleteBaselineV2, reason: string, note: string): ManualReviewEntry {
    return {
      student_name: athlete.student_name,
      athlete_id: athlete.athlete_id,
      review_reason: reason,
      active_training_window: athlete.active_training_window,
      all_week_vs_normal: {
        frequency: {
          all_weeks: athlete.all_week_baseline.frequency_cap,
          normal_weeks: athlete.normal_baseline.frequency_cap,
        },
        weekly_minutes: {
          all_weeks: athlete.all_week_baseline.weekly_minutes_cap,
          normal_weeks: athlete.normal_baseline.weekly_minutes_cap,
        },
        long_run: {
          all_weeks: athlete.all_week_baseline.long_run_cap_min,
          normal_weeks: athlete.normal_baseline.long_run_cap_min,
        },
        quality: {
          all_weeks: athlete.all_week_baseline.quality_count_cap,
          normal_weeks: athlete.normal_baseline.quality_count_cap,
        },
      },
      excluded_race_taper_recovery_weeks: {
        race_week: athlete.excluded_weeks_by_tag.race_week,
        taper_week: athlete.excluded_weeks_by_tag.taper_week,
        post_race_recovery: athlete.excluded_weeks_by_tag.post_race_recovery,
        marathon_specific_block: athlete.excluded_weeks_by_tag.marathon_specific_block,
      },
      baseline_mode: athlete.baseline_mode,
      normal_training_weeks_count: athlete.normal_training_weeks_count,
      excluded_weeks_count_by_tag: athlete.excluded_weeks_count_by_tag,
      race_candidate_count_by_confidence: athlete.race_candidate_count_by_confidence,
      race_candidate_count_by_source_type: athlete.race_candidate_count_by_source_type,
      race_detection_diagnostics: {
        raw_race_candidates_count: athlete.race_detection_diagnostics.raw_race_candidates_count,
        clustered_race_events_count: athlete.race_detection_diagnostics.clustered_race_events_count,
        suppressed_duplicate_candidates_count: athlete.race_detection_diagnostics.suppressed_duplicate_candidates_count,
      },
      top_race_candidates: athlete.race_detection_diagnostics.top_race_candidates,
      top_excluded_weeks: athlete.race_detection_diagnostics.top_excluded_weeks,
      note,
    };
  }

  addByName("Alena Grill", "required_validation_case", "Check marathon prep, taper, race, and recovery exclusion behavior.");
  addByName(
    "Anna Kukushkina",
    "required_validation_case",
    "Confirm advisory beginner run-walk did not become run_walk_actual.",
  );
  addByName(
    "Alexander Lavrentyev",
    "required_validation_case",
    "Confirm advisory beginner run-walk did not become run_walk_actual.",
  );
  addByName("Oleg Matrosov", "required_validation_case", "Check whether explicit run-walk context remains visible.");
  addByName("Alena Kovaldova", "low_confidence_required", "Low-confidence athlete from prior baseline review.");
  addByName("Igor Potseluev", "low_confidence_required", "Low-confidence athlete from prior baseline review.");
  addByName("slava Taranec", "low_confidence_required", "Low-confidence athlete from prior baseline review.");
  addByName("Kristina Pamparaite", "high_load_required", "High-load athlete from previous report if present.");
  addByName("Valentin Shavkun", "high_load_required", "High-load athlete from previous report if present.");
  addByName(
    "Irina Melnikova",
    "active_since_validation_case",
    "Early inactive weeks should not lower normal baseline; active window should explain all-window vs normal-week shift.",
  );
  addByName(
    "Yulia Krylova",
    "injury_break_validation_case",
    "Healthy normal-week baseline should stay separate from recent injury/break status overlay.",
  );
  addByName(
    "Anastasia Abramova",
    "device_upload_validation_case",
    "Recent upload drop-off should remain manual_review, not a silent baseline downgrade.",
  );
  addByName(
    "Anna Chernysheva",
    "completed_only_validation_case",
    "Completed-only/GPS-heavy pattern should remain visible without zeroing baseline.",
  );

  const withRaceCandidates = perAthlete
    .filter((athlete) => athlete.race_specific_context.race_candidate_count > 0)
    .sort((a, b) => b.race_specific_context.race_candidate_count - a.race_specific_context.race_candidate_count);
  for (const athlete of withRaceCandidates.slice(0, 5)) {
    addAthlete(athlete, "race_candidates_top5", "Detected race candidates should be reviewed for week tagging accuracy.");
  }

  const byDiff = [...perAthlete].sort((a, b) => baselineDiffScore(b) - baselineDiffScore(a));
  for (const athlete of byDiff.slice(0, 5)) {
    addAthlete(athlete, "largest_baseline_shift_top5", "Large gap between all-week and normal-only baseline.");
  }

  const activeSinceAthletes = perAthlete
    .filter((athlete) => athlete.active_training_window.baseline_period_type === "active_since")
    .sort((a, b) => b.active_training_window.pre_active_gap_weeks_count - a.active_training_window.pre_active_gap_weeks_count);
  for (const athlete of activeSinceAthletes.slice(0, 5)) {
    addAthlete(
      athlete,
      "active_since_top5",
      `Active training starts ${athlete.active_training_window.active_training_window_start}; ${athlete.active_training_window.pre_active_gap_weeks_count} pre-active weeks excluded.`,
    );
  }

  const insufficient = perAthlete
    .filter((athlete) => athlete.context_flags.includes("insufficient_clean_baseline"))
    .sort((a, b) => a.normal_training_weeks_count - b.normal_training_weeks_count);
  for (const athlete of insufficient.slice(0, 5)) {
    addAthlete(athlete, "insufficient_clean_baseline_top5", "Fallback baseline used due to too few clean normal weeks.");
  }

  return [...picked.values()].sort((a, b) => a.student_name.localeCompare(b.student_name));
}

function buildSecondaryFlag(notes: string[]): SecondaryWeekFlag[] {
  return notes.length > 0 ? ["manual_review"] : [];
}

function buildRaceEvidenceCalibrationForAthletes(input: {
  athletes: AthleteInput[];
  from: string;
  to: string;
  generatedAt: string;
}): RaceEvidenceCalibrationReport {
  const allExamples: RaceEvidenceCalibrationExample[] = [];
  for (const athlete of input.athletes) {
    for (const row of athlete.rows) {
      const insight = buildWorkoutInsight(row);
      if (!insight.isRunning) continue;
      const evidence = evaluateRaceEvidence(insight);
      const snapshot = isRecord(row.sourceSnapshot) ? row.sourceSnapshot : null;
      const hasRaceLikeTextOrDistance =
        evidence.hasStrongEventKeyword ||
        evidence.hasStrongResultKeyword ||
        evidence.distanceKeywordMatch ||
        evidence.distanceWindowMatch ||
        evidence.hasRaceTypeDuration ||
        evidence.hasReliableClassifierEvidence;
      if (!hasRaceLikeTextOrDistance) continue;
      allExamples.push({
        student_id: athlete.studentId,
        athlete_id: athlete.athleteId,
        athlete_name: athlete.studentName,
        date: row.workoutDate,
        title: row.title,
        completed: row.isCompleted,
        planned: row.isPlanned,
        estimated_distance_km: insight.distanceKm,
        duration_minutes: insight.durationMinutes,
        raceTypeDuration: (snapshot?.raceTypeDuration as string | number | null | undefined) ?? null,
        matched_positive_evidence: evidence.matchedPositiveEvidence,
        matched_negative_training_context: evidence.matchedNegativeTrainingContext,
        decision: evidence.decision,
        would_drive_race_exclusions: evidence.decision === "true_event_candidate" && evidence.exclusionEligible,
        notes: evidence.notes,
      });
    }
  }

  allExamples.sort(
    (a, b) =>
      a.athlete_name.localeCompare(b.athlete_name) ||
      a.date.localeCompare(b.date) ||
      (a.title ?? "").localeCompare(b.title ?? ""),
  );

  const positives = allExamples.filter((example) => example.decision === "true_event_candidate");
  const rejected = allExamples.filter((example) => example.decision === "rejected_training_context");
  const manual = allExamples.filter((example) => example.decision === "manual_review");

  const sample = (items: RaceEvidenceCalibrationExample[], limit: number) => items.slice(0, limit);
  return {
    generated_at: input.generatedAt,
    date_range: { from: input.from, to: input.to },
    totals: {
      considered_examples: allExamples.length,
      true_event_candidate: positives.length,
      rejected_training_context: rejected.length,
      manual_review: manual.length,
    },
    potential_positive_examples: sample(positives, 300),
    rejected_training_context_examples: sample(rejected, 300),
    manual_review_examples: sample(manual, 300),
  };
}

function dedupeAndClusterRaceCandidates(candidates: RaceCandidate[]): {
  rawCount: number;
  clustered: RaceCandidate[];
  suppressedDuplicateCount: number;
} {
  if (candidates.length === 0) {
    return { rawCount: 0, clustered: [], suppressedDuplicateCount: 0 };
  }
  const sorted = [...candidates].sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score || a.workout_id - b.workout_id);
  const clustered: RaceCandidate[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(i)) continue;
    const seed = sorted[i]!;
    const groupIndices: number[] = [i];
    used.add(i);
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (used.has(j)) continue;
      const candidate = sorted[j]!;
      const dayDiff = Math.abs(
        Math.round(
          (new Date(`${candidate.date}T00:00:00Z`).getTime() - new Date(`${seed.date}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000),
        ),
      );
      const nearDate = dayDiff <= 2;
      const sameWeek = candidate.week_start === seed.week_start;
      const sameDistance =
        candidate.estimated_distance === seed.estimated_distance ||
        candidate.estimated_distance === "unknown" ||
        seed.estimated_distance === "unknown";
      if (sameDistance && (nearDate || sameWeek)) {
        groupIndices.push(j);
        used.add(j);
      }
    }
    const group = groupIndices.map((index) => sorted[index]!);
    const representative = [...group].sort((a, b) => b.score - a.score || (a.confidence === "high" ? -1 : a.confidence === "medium" ? 0 : 1))[0]!;
    clustered.push({ ...representative });
  }

  return {
    rawCount: candidates.length,
    clustered: clustered.sort((a, b) => a.date.localeCompare(b.date) || a.workout_id - b.workout_id),
    suppressedDuplicateCount: Math.max(0, candidates.length - clustered.length),
  };
}

function analyzeAthlete(input: {
  athlete: AthleteInput;
  from: string;
  to: string;
  minNormalWeeks: number;
}): {
  athlete: PerAthleteBaselineV2;
  raceCandidates: RaceCandidate[];
  weekTags: WeekTagReportRow[];
  dataGaps: DataGap[];
} | null {
  if (input.athlete.rows.length === 0) return null;

  const insights = input.athlete.rows.map(buildWorkoutInsight);
  const runningInsights = insights.filter((insight) => insight.isRunning);
  const ambiguousCompletedInsights = insights.filter((insight) => insight.isAmbiguousCompletedActivity);
  if (runningInsights.length === 0) return null;

  const weekMap = new Map<string, WeekAccumulator>();
  const explicitRunWalkWorkouts = runningInsights.filter((insight) => insight.explicitRunWalk);
  const runWalkWeeks = uniqueSorted(explicitRunWalkWorkouts.map((insight) => insight.weekStart));
  const hasStrongRunWalkStructure = explicitRunWalkWorkouts.length >= 3 && runWalkWeeks.length >= 2;

  for (const insight of runningInsights) {
    const current = weekMap.get(insight.weekStart) ?? {
      studentId: insight.row.studentId,
      studentName: insight.row.studentName,
      athleteId: insight.row.trainingPeaksAthleteId,
      weekStart: insight.weekStart,
      weekEnd: insight.weekEnd,
      completedRunningWorkouts: 0,
      plannedRunningWorkouts: 0,
      completedRunningDistanceKm: 0,
      plannedRunningMinutes: 0,
      completedRunningMinutes: 0,
      completedOnlyRunningWorkouts: 0,
      plannedOnlyRunningWorkouts: 0,
      ambiguousCompletedActivities: 0,
      longestRunMinutes: null,
      qualitySessions: 0,
      intervalLikeSessions: 0,
      marathonSpecificCue: false,
      raceCandidates: [],
      lowConfidenceRaceCandidates: [],
      notes: [],
    };

    if (insight.isPlanned) {
      current.plannedRunningWorkouts += 1;
      current.plannedRunningMinutes += insight.plannedMinutes ?? 0;
    }
    if (insight.isCompleted) {
      current.completedRunningWorkouts += 1;
      current.completedRunningMinutes += insight.completedMinutes ?? 0;
      current.completedRunningDistanceKm += insight.completedDistanceKm ?? 0;
      if (insight.completedWithoutPlan) current.completedOnlyRunningWorkouts += 1;
    }
    if (insight.isPlanned && !insight.isCompleted) {
      current.plannedOnlyRunningWorkouts += 1;
    }
    if (insight.longRunLike && insight.isCompleted && insight.completedMinutes !== null) {
      current.longestRunMinutes =
        current.longestRunMinutes === null
          ? insight.completedMinutes
          : Math.max(current.longestRunMinutes, insight.completedMinutes);
    }
    if (insight.isCompleted && insight.qualityLike) current.qualitySessions += 1;
    if (insight.isCompleted && insight.intervalLike) current.intervalLikeSessions += 1;
    if (insight.marathonSpecificCue) current.marathonSpecificCue = true;
    if (insight.explicitRunWalk) current.notes.push("explicit_run_walk_signal");

    const raceCandidate = buildRaceCandidate(insight);
    if (raceCandidate) {
      if (raceCandidate.confidence === "low") current.lowConfidenceRaceCandidates.push(raceCandidate);
      else current.raceCandidates.push(raceCandidate);
    }

    weekMap.set(insight.weekStart, current);
  }

  for (const insight of ambiguousCompletedInsights) {
    const current = weekMap.get(insight.weekStart) ?? {
      studentId: insight.row.studentId,
      studentName: insight.row.studentName,
      athleteId: insight.row.trainingPeaksAthleteId,
      weekStart: insight.weekStart,
      weekEnd: insight.weekEnd,
      completedRunningWorkouts: 0,
      plannedRunningWorkouts: 0,
      completedRunningDistanceKm: 0,
      plannedRunningMinutes: 0,
      completedRunningMinutes: 0,
      completedOnlyRunningWorkouts: 0,
      plannedOnlyRunningWorkouts: 0,
      ambiguousCompletedActivities: 0,
      longestRunMinutes: null,
      qualitySessions: 0,
      intervalLikeSessions: 0,
      marathonSpecificCue: false,
      raceCandidates: [],
      lowConfidenceRaceCandidates: [],
      notes: [],
    };
    current.ambiguousCompletedActivities += 1;
    weekMap.set(insight.weekStart, current);
  }

  const orderedWeeks = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const rawRaceCandidates = orderedWeeks.flatMap((week) => [...week.raceCandidates, ...week.lowConfidenceRaceCandidates]);
  const dedupedRace = dedupeAndClusterRaceCandidates(rawRaceCandidates);
  const clusteredRaceCandidates = dedupedRace.clustered;
  const raceCandidateByWorkoutId = new Map(clusteredRaceCandidates.map((candidate) => [candidate.workout_id, candidate]));
  const eligibleCandidates = clusteredRaceCandidates.filter((candidate) => candidate.exclusion_eligible && candidate.confidence !== "low");

  function toRaceWindows(candidates: RaceCandidate[]): RaceWindow[] {
    return candidates
      .map((candidate) => ({
        weekStart: candidate.week_start,
        distance: candidate.estimated_distance,
        confidence: candidate.confidence,
        candidate,
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }

  const weekRows: WeekTagReportRow[] = [];
  const weekExclusionReasons = new Map<
    string,
    {
      tag: Exclude<WeekTag, "normal_training">;
      reason: string;
      sourceRaceCandidate: RaceCandidate | null;
    }
  >();
  const currentFlags = new Set(input.athlete.currentBaseline?.contextFlags ?? []);
  const contextFlags = new Set<string>(input.athlete.currentBaseline?.contextFlags ?? []);
  let runWalkStatus: "run_walk_actual" | "possible_run_walk_signal" | "none" = "none";

  if (currentFlags.has("run_walk_actual") || hasStrongRunWalkStructure) {
    runWalkStatus = "run_walk_actual";
    contextFlags.add("run_walk_actual");
  } else if (explicitRunWalkWorkouts.length > 0) {
    runWalkStatus = "possible_run_walk_signal";
    contextFlags.add("possible_run_walk_signal");
  }

  let missingDescriptionRows = 0;
  let missingTssRows = 0;
  let missingIfRows = 0;
  let missingRaceTypeRows = 0;
  for (const insight of runningInsights) {
    const snapshot = isRecord(insight.row.sourceSnapshot) ? insight.row.sourceSnapshot : null;
    const description = String(snapshot?.description ?? "").trim();
    if (!description) missingDescriptionRows += 1;
    if (toFiniteNumber(snapshot?.tssActual) === null) missingTssRows += 1;
    if (toFiniteNumber(snapshot?.ifActual) === null) missingIfRows += 1;
    if (snapshot?.raceTypeDuration === null || snapshot?.raceTypeDuration === undefined) missingRaceTypeRows += 1;
  }

  for (let index = 0; index < orderedWeeks.length; index += 1) {
    const week = orderedWeeks[index]!;
    const notes: string[] = [];
    const effectiveMinutes = week.completedRunningMinutes > 0 ? week.completedRunningMinutes : week.plannedRunningMinutes;
    const previousEffective = orderedWeeks
      .slice(Math.max(0, index - 4), index)
      .map((candidate) => (candidate.completedRunningMinutes > 0 ? candidate.completedRunningMinutes : candidate.plannedRunningMinutes))
      .filter((candidate) => candidate > 0);
    const rollingMedian = median(previousEffective);

    const tags = new Set<WeekTag>();
    const weekEligibleCandidates = [...week.raceCandidates, ...week.lowConfidenceRaceCandidates].filter((candidate) => {
      const clustered = raceCandidateByWorkoutId.get(candidate.workout_id);
      return Boolean(clustered && clustered.exclusion_eligible && clustered.confidence !== "low");
    });
    if (weekEligibleCandidates.length > 0) {
      tags.add("race_week");
    }

    for (const raceWindow of toRaceWindows(eligibleCandidates)) {
      const offset = weekDistance(week.weekStart, raceWindow.weekStart);
      if (offset > 0 && offset <= raceTaperWeeks(raceWindow.distance)) {
        tags.add("taper_week");
      }
      if (offset < 0 && Math.abs(offset) <= raceRecoveryWeeks(raceWindow.distance)) {
        tags.add("post_race_recovery");
      }
      if (
        raceWindow.distance === "marathon" &&
        offset > 0 &&
        offset >= 4 &&
        offset <= 6 &&
        (week.marathonSpecificCue || (week.longestRunMinutes ?? 0) >= 140)
      ) {
        tags.add("marathon_specific_block");
      }
    }

    const lowDataReasons: WeekTagReportRow["low_data_reasons"] = [];
    if (week.completedRunningWorkouts === 0) {
      if (week.ambiguousCompletedActivities > 0) lowDataReasons.push("classification_ambiguous");
      if (week.plannedRunningWorkouts > 0 || week.plannedRunningMinutes > 0) lowDataReasons.push("no_completed_running");
      if (week.plannedRunningWorkouts === 0 && week.plannedRunningMinutes === 0 && week.ambiguousCompletedActivities === 0) {
        lowDataReasons.push("cache_gap");
      }
    } else if (week.completedRunningMinutes > 0 && week.completedRunningMinutes < 45) {
      lowDataReasons.push("very_low_completed_running");
    }
    if (lowDataReasons.length > 0) {
      tags.add("low_data");
    }

    if (!tags.has("race_week") && !tags.has("taper_week") && !tags.has("post_race_recovery")) {
      if (rollingMedian !== null && rollingMedian >= 90 && effectiveMinutes < rollingMedian * 0.3) {
        if (week.completedRunningWorkouts >= 2 || week.completedRunningMinutes >= 60) {
          tags.add("illness_low_volume");
        } else {
          notes.push("possible_illness_low_volume_but_sparse_data");
        }
      } else if (rollingMedian !== null && rollingMedian >= 120 && effectiveMinutes < rollingMedian * 0.45 && effectiveMinutes > 0) {
        notes.push("possible_illness_low_volume");
      }
    }

    if (week.lowConfidenceRaceCandidates.length > 0) {
      notes.push("low_confidence_race_signal");
    }
    if (week.ambiguousCompletedActivities > 0) {
      notes.push("ambiguous_completed_activity_types");
    }
    if (week.plannedRunningWorkouts > 0 && week.completedRunningWorkouts === 0) {
      notes.push("planned_not_completed_context");
    }

    if (week.notes.includes("explicit_run_walk_signal") && runWalkStatus === "possible_run_walk_signal") {
      notes.push("possible_run_walk_signal");
    }

    let finalTag: WeekTag = "normal_training";
    for (const tag of WEEK_PRIORITY) {
      if (tags.has(tag)) {
        finalTag = tag;
        break;
      }
    }
    if (finalTag !== "normal_training") {
      if (finalTag === "race_week") {
        const top = weekEligibleCandidates.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))[0] ?? null;
        if (top) top.caused_exclusion = true;
        weekExclusionReasons.set(week.weekStart, {
          tag: finalTag,
          reason: top?.exclusion_decision_reason ?? "race_candidate_exclusion",
          sourceRaceCandidate: top,
        });
      } else if (finalTag === "taper_week" || finalTag === "post_race_recovery" || finalTag === "marathon_specific_block") {
        const driver = toRaceWindows(eligibleCandidates)
          .filter((raceWindow) => {
            const offset = weekDistance(week.weekStart, raceWindow.weekStart);
            if (finalTag === "taper_week") return offset > 0 && offset <= raceTaperWeeks(raceWindow.distance);
            if (finalTag === "post_race_recovery") return offset < 0 && Math.abs(offset) <= raceRecoveryWeeks(raceWindow.distance);
            return (
              finalTag === "marathon_specific_block" &&
              raceWindow.distance === "marathon" &&
              offset > 0 &&
              offset >= 4 &&
              offset <= 6 &&
              (week.marathonSpecificCue || (week.longestRunMinutes ?? 0) >= 140)
            );
          })
          .sort((a, b) => b.candidate.score - a.candidate.score)[0];
        if (driver?.candidate) driver.candidate.caused_exclusion = true;
        weekExclusionReasons.set(week.weekStart, {
          tag: finalTag,
          reason:
            finalTag === "taper_week"
              ? "pre_race_taper_window"
              : finalTag === "post_race_recovery"
                ? "post_race_recovery_window"
                : "marathon_specific_block_window",
          sourceRaceCandidate: driver?.candidate ?? null,
        });
      } else {
        weekExclusionReasons.set(week.weekStart, {
          tag: finalTag,
          reason: finalTag,
          sourceRaceCandidate: null,
        });
      }
    }

    weekRows.push({
      student_id: week.studentId,
      student_name: week.studentName,
      athlete_id: week.athleteId,
      week_start: week.weekStart,
      week_end: week.weekEnd,
      tag: finalTag,
      secondary_flags: buildSecondaryFlag(notes),
      completed_running_workouts: week.completedRunningWorkouts,
      planned_running_workouts: week.plannedRunningWorkouts,
      completed_running_distance_km: Number(week.completedRunningDistanceKm.toFixed(2)),
      planned_running_minutes: Number(week.plannedRunningMinutes.toFixed(2)),
      completed_running_minutes: Number(week.completedRunningMinutes.toFixed(2)),
      completed_only_running_workouts: week.completedOnlyRunningWorkouts,
      planned_only_running_workouts: week.plannedOnlyRunningWorkouts,
      ambiguous_completed_activities: week.ambiguousCompletedActivities,
      planned_not_completed_context: week.plannedRunningWorkouts > 0 && week.completedRunningWorkouts === 0,
      low_data_reasons: lowDataReasons,
      longest_run_minutes: week.longestRunMinutes === null ? null : Number(week.longestRunMinutes.toFixed(2)),
      quality_sessions: week.qualitySessions,
      interval_like_sessions: week.intervalLikeSessions,
      race_candidate_count: [...week.raceCandidates, ...week.lowConfidenceRaceCandidates].filter((candidate) =>
        raceCandidateByWorkoutId.has(candidate.workout_id),
      ).length,
      race_candidates: [...week.raceCandidates, ...week.lowConfidenceRaceCandidates]
        .filter((candidate) => raceCandidateByWorkoutId.has(candidate.workout_id))
        .map((candidate) => ({
        date: candidate.date,
        estimated_distance: candidate.estimated_distance,
        confidence: candidate.confidence,
        score: candidate.score,
        title: candidate.title,
      })),
      notes,
    });
  }

  const allWeeks = weekRows;
  let normalWeeks = weekRows.filter((week) => week.tag === "normal_training");
  const excludedCounts = emptyExcludedCounts();
  for (const week of weekRows) {
    if (week.tag !== "normal_training") excludedCounts[week.tag] += 1;
  }
  const raceByConfidence = emptyRaceByConfidence();
  const raceBySourceType = emptyRaceBySourceType();
  for (const candidate of clusteredRaceCandidates) {
    raceByConfidence[candidate.confidence] += 1;
    for (const sourceType of candidate.source_types) {
      raceBySourceType[sourceType] += 1;
    }
  }

  let baselineSource: "normal_training" | "fallback_all_weeks" = "normal_training";
  let baselineMode: BaselineMode = "normal_only";
  let confidence: BaselineV2Confidence = "high";
  let needsReview = false;
  const notes: string[] = [];

  if (normalWeeks.length >= input.minNormalWeeks) {
    confidence = normalWeeks.length >= input.minNormalWeeks + 2 ? "high" : "medium";
  } else if (normalWeeks.length >= 4) {
    confidence = "medium";
    baselineMode = "limited_clean";
    needsReview = true;
    contextFlags.add("limited_clean_baseline");
    notes.push(`Only ${normalWeeks.length} clean normal weeks found.`);
  } else {
    confidence = "low";
    needsReview = true;
    baselineSource = "fallback_all_weeks";
    baselineMode = "fallback_all_weeks";
    contextFlags.add("insufficient_clean_baseline");
    notes.push(`Fallback baseline used because only ${normalWeeks.length} clean normal weeks were found.`);
    notes.push("Fallback mode means normal metrics may equal all-week metrics because all weeks were used.");
  }

  if (weekRows.some((week) => week.secondary_flags.includes("manual_review"))) {
    needsReview = true;
  }
  if (runWalkStatus === "possible_run_walk_signal") {
    needsReview = true;
    notes.push("Possible run-walk signal found, but not strong enough to confirm run_walk_actual.");
  }
  if (weekRows.some((week) => week.tag === "race_week")) {
    notes.push("Race-aware exclusions applied before computing normal baseline.");
  }
  if (input.athlete.currentBaseline?.familyLabelAdvisory) {
    notes.push(`Ignored advisory family label: ${input.athlete.currentBaseline.familyLabelAdvisory}.`);
  }

  const preliminaryAllWeekBaseline = computeWeekMetrics(allWeeks, "completed");
  const preliminaryNormalBaseline = computeWeekMetrics(
    baselineSource === "normal_training" ? normalWeeks : allWeeks,
    "completed",
  );
  const activeTrainingWindow = buildActiveTrainingWindowMetrics({
    weekRows: weekRows,
    analyzedFrom: input.from,
    normalBaselineFrequency: preliminaryNormalBaseline.frequency_cap,
    allWeekBaselineFrequency: preliminaryAllWeekBaseline.frequency_cap,
  });

  if (
    activeTrainingWindow.baseline_period_type === "active_since" &&
    activeTrainingWindow.active_training_window_start
  ) {
    const activeNormalWeeks = normalWeeks.filter(
      (week) => week.week_start >= activeTrainingWindow.active_training_window_start!,
    );
    if (activeNormalWeeks.length >= Math.min(input.minNormalWeeks, 4)) {
      normalWeeks = activeNormalWeeks;
      notes.push(
        `Normal baseline restricted to active training window from ${activeTrainingWindow.active_training_window_start}.`,
      );
    }
  }

  const baselineWeeks = baselineSource === "normal_training" ? normalWeeks : allWeeks;
  const normalBaseline = computeWeekMetrics(baselineWeeks, "completed");
  const allWeekBaseline = preliminaryAllWeekBaseline;
  const plannedContextBaseline = computeWeekMetrics(baselineWeeks, "planned");
  activeTrainingWindow.normal_week_frequency = normalBaseline.frequency_cap;
  activeTrainingWindow.all_window_frequency = allWeekBaseline.frequency_cap;
  activeTrainingWindow.active_window_frequency = median(
    (activeTrainingWindow.active_training_window_start
      ? weekRows.filter((week) => week.week_start >= activeTrainingWindow.active_training_window_start!)
      : weekRows
    )
      .filter(isMeaningfulActiveRunningWeek)
      .map((week) => week.completed_running_workouts),
  );
  const raceCandidatesUnique = clusteredRaceCandidates;

  if (raceCandidatesUnique.some((candidate) => candidate.estimated_distance === "marathon")) {
    notes.push("Marathon-context race candidate detected.");
  }
  const janJunCandidates = raceCandidatesUnique.filter((candidate) => candidate.date >= "2026-01-01" && candidate.date <= "2026-06-30");
  const janJunRaceRelatedExclusions = weekRows.filter(
    (week) =>
      week.week_start >= "2026-01-01" &&
      week.week_start <= "2026-06-30" &&
      (week.tag === "race_week" || week.tag === "taper_week" || week.tag === "post_race_recovery" || week.tag === "marathon_specific_block"),
  ).length;
  if (
    janJunCandidates.length >= OVERBROAD_JAN_JUN_CLUSTER_THRESHOLD ||
    janJunRaceRelatedExclusions >= OVERBROAD_JAN_JUN_EXCLUSION_THRESHOLD ||
    excludedCounts.race_week >= OVERBROAD_JAN_JUN_CLUSTER_THRESHOLD
  ) {
    contextFlags.add("race_detection_overbroad_manual_review");
    needsReview = true;
    notes.push(
      `Race detection may be overbroad (Jan-Jun clusters=${janJunCandidates.length}, race-related exclusions=${janJunRaceRelatedExclusions}). Manual review required.`,
    );
  }
  if (orderedWeeks.some((week) => week.marathonSpecificCue)) {
    notes.push("Marathon-specific training context detected (kept visible as training context, not auto-race exclusion).");
  }

  const topRaceCandidates = [...raceCandidatesUnique]
    .sort((a, b) => b.score - a.score || (a.confidence === "high" ? -1 : a.confidence === "medium" ? 0 : 1))
    .slice(0, 8)
    .map((candidate) => ({
      date: candidate.date,
      week_start: candidate.week_start,
      title: candidate.title,
      score: candidate.score,
      confidence: candidate.confidence,
      source_types: candidate.source_types,
      matched_reasons: candidate.matched_reasons,
      caused_exclusion: candidate.caused_exclusion,
      exclusion_decision_reason: candidate.exclusion_decision_reason,
    }));
  const topExcludedWeeks = [...weekRows]
    .filter((week) => week.tag !== "normal_training")
    .map((week) => {
      const exclusion = weekExclusionReasons.get(week.week_start);
      return {
        week_start: week.week_start,
        tag: week.tag as Exclude<WeekTag, "normal_training">,
        reason: exclusion?.reason ?? "excluded",
        source_race_candidate: exclusion?.sourceRaceCandidate
          ? {
              date: exclusion.sourceRaceCandidate.date,
              title: exclusion.sourceRaceCandidate.title,
              score: exclusion.sourceRaceCandidate.score,
              confidence: exclusion.sourceRaceCandidate.confidence,
            }
          : null,
      };
    })
    .slice(0, 8);

  const latestTwoWeeks = [...weekRows].sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, 2);
  needsReview = applyActiveTrainingWindowContext({
    activeWindow: activeTrainingWindow,
    contextFlags,
    notes,
    needsReview,
  });
  const diffOrNull = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : Number((a - b).toFixed(2));
  const baselineChangeVsPlanned = {
    frequency_delta: diffOrNull(normalBaseline.frequency_cap, plannedContextBaseline.frequency_cap),
    weekly_minutes_delta: diffOrNull(normalBaseline.weekly_minutes_cap, plannedContextBaseline.weekly_minutes_cap),
    long_run_delta: diffOrNull(normalBaseline.long_run_cap_min, plannedContextBaseline.long_run_cap_min),
    quality_delta: diffOrNull(normalBaseline.quality_count_cap, plannedContextBaseline.quality_count_cap),
    materially_changed: false,
  };
  baselineChangeVsPlanned.materially_changed =
    Math.abs(baselineChangeVsPlanned.frequency_delta ?? 0) >= 1 ||
    Math.abs(baselineChangeVsPlanned.weekly_minutes_delta ?? 0) >= 30 ||
    Math.abs(baselineChangeVsPlanned.long_run_delta ?? 0) >= 20 ||
    Math.abs(baselineChangeVsPlanned.quality_delta ?? 0) >= 1;
  const lowDataReasonCounts: PerAthleteBaselineV2["completed_vs_planned_divergence"]["low_data_reason_counts"] = {
    no_completed_running: 0,
    very_low_completed_running: 0,
    classification_ambiguous: 0,
    cache_gap: 0,
  };
  for (const week of weekRows) {
    for (const reason of week.low_data_reasons) lowDataReasonCounts[reason] += 1;
  }
  const completedVsPlannedDivergence = {
    weeks_with_workout_count_difference: weekRows.filter(
      (week) => week.completed_running_workouts !== week.planned_running_workouts,
    ).length,
    weeks_with_minutes_difference: weekRows.filter(
      (week) => Math.abs(week.completed_running_minutes - week.planned_running_minutes) >= 1,
    ).length,
    completed_only_running_workouts: weekRows.reduce((sum, week) => sum + week.completed_only_running_workouts, 0),
    planned_only_running_workouts: weekRows.reduce((sum, week) => sum + week.planned_only_running_workouts, 0),
    ambiguous_completed_activities: weekRows.reduce((sum, week) => sum + week.ambiguous_completed_activities, 0),
    low_data_reason_counts: lowDataReasonCounts,
  };
  if (baselineChangeVsPlanned.materially_changed) {
    notes.push("completed_and_planned_diverge_materially");
  }
  if (completedVsPlannedDivergence.completed_only_running_workouts >= 8 || completedVsPlannedDivergence.planned_only_running_workouts >= 8) {
    notes.push("gps_only_or_completed_only_pattern");
    needsReview = true;
  }
  if (completedVsPlannedDivergence.ambiguous_completed_activities >= 5) {
    notes.push("too_many_ambiguous_activity_types");
    needsReview = true;
  }
  const athleteOutput: PerAthleteBaselineV2 = {
    student_name: input.athlete.studentName,
    student_id: input.athlete.studentId,
    athlete_id: input.athlete.athleteId,
    analyzed_from: input.from,
    analyzed_to: input.to,
    normal_baseline: normalBaseline,
    all_week_baseline: allWeekBaseline,
    planned_context_baseline: plannedContextBaseline,
    baseline_mode: baselineMode,
    normal_training_weeks_count: normalWeeks.length,
    excluded_weeks_count: weekRows.length - normalWeeks.length,
    excluded_weeks_by_tag: excludedCounts,
    excluded_weeks_count_by_tag: excludedCounts,
    total_weeks_count: weekRows.length,
    baseline_source: baselineSource,
    baseline_metric_source: "completed_actual_running",
    baseline_change_vs_planned_context: baselineChangeVsPlanned,
    completed_vs_planned_divergence: completedVsPlannedDivergence,
    race_candidate_count_by_confidence: raceByConfidence,
    race_candidate_count_by_source_type: raceBySourceType,
    race_detection_diagnostics: {
      raw_race_candidates_count: dedupedRace.rawCount,
      clustered_race_events_count: dedupedRace.clustered.length,
      suppressed_duplicate_candidates_count: dedupedRace.suppressedDuplicateCount,
      top_race_candidates: topRaceCandidates,
      top_excluded_weeks: topExcludedWeeks,
    },
    race_specific_context: {
      race_candidates: raceCandidatesUnique.map((candidate) => ({
        date: candidate.date,
        estimated_distance: candidate.estimated_distance,
        confidence: candidate.confidence,
        score: candidate.score,
        title: candidate.title,
      })),
      race_candidate_count: raceCandidatesUnique.length,
      marathon_context_detected: raceCandidatesUnique.some((candidate) => candidate.estimated_distance === "marathon"),
      excluded_weeks_by_tag: excludedCounts,
    },
    active_training_window: activeTrainingWindow,
    recent_current_status: {
      latest_week_start: latestTwoWeeks[0]?.week_start ?? null,
      latest_week_tag: latestTwoWeeks[0]?.tag ?? null,
      latest_two_weeks: latestTwoWeeks.map((week) => ({
        week_start: week.week_start,
        tag: week.tag,
        planned_running_minutes: week.planned_running_minutes,
        completed_running_minutes: week.completed_running_minutes,
      })),
      recent_4w_frequency: activeTrainingWindow.recent_4w_frequency,
      recent_4w_completed_minutes: activeTrainingWindow.recent_4w_completed_minutes,
      run_walk_status: runWalkStatus,
    },
    current_baseline_context: {
      context_flags: input.athlete.currentBaseline?.contextFlags ?? [],
      confidence: input.athlete.currentBaseline?.confidence ?? null,
      family_label_advisory: input.athlete.currentBaseline?.familyLabelAdvisory ?? null,
    },
    context_flags: [...contextFlags].sort(),
    confidence,
    needs_review: needsReview,
    notes,
  };

  const dataGaps: DataGap[] = [
    {
      label: `${input.athlete.studentName}:running_rows_missing_description`,
      value: missingDescriptionRows,
    },
    {
      label: `${input.athlete.studentName}:running_rows_missing_tss`,
      value: missingTssRows,
    },
    {
      label: `${input.athlete.studentName}:running_rows_missing_if`,
      value: missingIfRows,
    },
    {
      label: `${input.athlete.studentName}:running_rows_missing_raceTypeDuration`,
      value: missingRaceTypeRows,
    },
  ];

  return {
    athlete: athleteOutput,
    raceCandidates: raceCandidatesUnique.sort((a, b) => a.date.localeCompare(b.date) || a.workout_id - b.workout_id),
    weekTags: weekRows,
    dataGaps,
  };
}

export function analyzeAthleteTrainingBaselineV2(input: {
  athletes: AthleteInput[];
  from: string;
  to: string;
  minNormalWeeks: number;
  generatedAt: string;
  activeAthletesTotal: number;
}): BaselineV2Analysis {
  const perAthlete: PerAthleteBaselineV2[] = [];
  const raceCandidates: RaceCandidate[] = [];
  const weekTags: WeekTagReportRow[] = [];
  const dataGaps: DataGap[] = [];

  for (const athlete of input.athletes) {
    const analyzed = analyzeAthlete({
      athlete,
      from: input.from,
      to: input.to,
      minNormalWeeks: input.minNormalWeeks,
    });
    if (!analyzed) continue;
    perAthlete.push(analyzed.athlete);
    raceCandidates.push(...analyzed.raceCandidates);
    weekTags.push(...analyzed.weekTags);
    dataGaps.push(...analyzed.dataGaps);
  }

  perAthlete.sort((a, b) => a.student_name.localeCompare(b.student_name));
  raceCandidates.sort((a, b) => a.date.localeCompare(b.date) || a.student_name.localeCompare(b.student_name));
  weekTags.sort((a, b) => a.student_name.localeCompare(b.student_name) || a.week_start.localeCompare(b.week_start));

  const totalExcludedWeeksByTag = emptyExcludedCounts();
  const confidenceDistribution: Record<BaselineV2Confidence, number> = { high: 0, medium: 0, low: 0 };
  const raceByDistance: Record<RaceDistanceKey, number> = {
    "5k": 0,
    "10k": 0,
    half: 0,
    marathon: 0,
    unknown: 0,
  };
  const raceByConfidence: Record<RaceCandidateConfidence, number> = { high: 0, medium: 0, low: 0 };

  for (const athlete of perAthlete) {
    confidenceDistribution[athlete.confidence] += 1;
    for (const tag of EXCLUDED_TAGS) totalExcludedWeeksByTag[tag] += athlete.excluded_weeks_by_tag[tag];
  }
  for (const candidate of raceCandidates) {
    raceByDistance[candidate.estimated_distance] += 1;
    raceByConfidence[candidate.confidence] += 1;
  }

  const summary: BaselineV2Summary = {
    generated_at: input.generatedAt,
    date_range: { from: input.from, to: input.to },
    active_athletes_total: input.activeAthletesTotal,
    athletes_analyzed: perAthlete.length,
    athletes_with_enough_clean_normal_weeks: perAthlete.filter((athlete) => athlete.normal_training_weeks_count >= input.minNormalWeeks).length,
    athletes_with_fallback_baseline: perAthlete.filter((athlete) => athlete.baseline_source === "fallback_all_weeks").length,
    athletes_with_detected_race_candidates: perAthlete.filter((athlete) => athlete.race_specific_context.race_candidate_count > 0).length,
    race_candidate_counts_by_distance: raceByDistance,
    race_candidate_counts_by_confidence: raceByConfidence,
    total_normal_weeks: perAthlete.reduce((total, athlete) => total + athlete.normal_training_weeks_count, 0),
    completed_vs_planned_divergence_totals: {
      weeks_with_workout_count_difference: perAthlete.reduce(
        (total, athlete) => total + athlete.completed_vs_planned_divergence.weeks_with_workout_count_difference,
        0,
      ),
      weeks_with_minutes_difference: perAthlete.reduce(
        (total, athlete) => total + athlete.completed_vs_planned_divergence.weeks_with_minutes_difference,
        0,
      ),
      completed_only_running_workouts: perAthlete.reduce(
        (total, athlete) => total + athlete.completed_vs_planned_divergence.completed_only_running_workouts,
        0,
      ),
      planned_only_running_workouts: perAthlete.reduce(
        (total, athlete) => total + athlete.completed_vs_planned_divergence.planned_only_running_workouts,
        0,
      ),
      ambiguous_completed_activities: perAthlete.reduce(
        (total, athlete) => total + athlete.completed_vs_planned_divergence.ambiguous_completed_activities,
        0,
      ),
    },
    athletes_with_material_completed_vs_planned_change: perAthlete.filter(
      (athlete) => athlete.baseline_change_vs_planned_context.materially_changed,
    ).length,
    total_excluded_weeks_by_tag: totalExcludedWeeksByTag,
    confidence_distribution: confidenceDistribution,
    needs_review_count: perAthlete.filter((athlete) => athlete.needs_review).length,
    athletes_with_active_since_window: perAthlete.filter(
      (athlete) => athlete.active_training_window.baseline_period_type === "active_since",
    ).length,
    athletes_with_insufficient_active_window: perAthlete.filter(
      (athlete) => athlete.active_training_window.baseline_period_type === "insufficient_active_window",
    ).length,
  };

  const raceEvidenceCalibration = buildRaceEvidenceCalibrationForAthletes({
    athletes: input.athletes,
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt,
  });

  return {
    summary,
    perAthlete,
    raceCandidates,
    weekTags,
    manualReviewShortlist: buildManualReviewShortlist(perAthlete),
    dataGaps,
    raceEvidenceCalibration,
  };
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function sortSourceTypesForOutput(sourceTypes: RaceCandidateSourceType[]): RaceCandidateSourceType[] {
  const priority: Record<RaceCandidateSourceType, number> = {
    race_type_duration: 1,
    strong_result_keyword: 2,
    strong_event_keyword: 3,
    reliable_classifier_evidence: 4,
    completed_race_like_distance: 5,
    distance_window_context: 6,
    distance_keyword_context: 7,
    pace_or_training_context_only: 8,
  };
  return [...sourceTypes].sort((a, b) => priority[a] - priority[b]);
}

export function buildBaselineV2SummaryMarkdown(summary: BaselineV2Summary): string {
  const lines: string[] = ["# Athlete Training Baseline v2 Summary", ""];
  lines.push(`- date_range: ${summary.date_range.from}..${summary.date_range.to}`);
  lines.push(`- active_athletes_total: ${summary.active_athletes_total}`);
  lines.push(`- athletes_analyzed: ${summary.athletes_analyzed}`);
  lines.push(`- athletes_with_enough_clean_normal_weeks: ${summary.athletes_with_enough_clean_normal_weeks}`);
  lines.push(`- athletes_with_fallback_baseline: ${summary.athletes_with_fallback_baseline}`);
  lines.push(`- athletes_with_detected_race_candidates: ${summary.athletes_with_detected_race_candidates}`);
  lines.push(`- total_normal_weeks: ${summary.total_normal_weeks}`);
  lines.push(`- athletes_with_material_completed_vs_planned_change: ${summary.athletes_with_material_completed_vs_planned_change}`);
  lines.push(`- completed_vs_planned_divergence_totals: ${JSON.stringify(summary.completed_vs_planned_divergence_totals)}`);
  lines.push(`- needs_review_count: ${summary.needs_review_count}`);
  lines.push(`- athletes_with_active_since_window: ${summary.athletes_with_active_since_window}`);
  lines.push(`- athletes_with_insufficient_active_window: ${summary.athletes_with_insufficient_active_window}`);
  lines.push("");
  lines.push("## Race Candidates");
  lines.push(`- by_distance: ${JSON.stringify(summary.race_candidate_counts_by_distance)}`);
  lines.push(`- by_confidence: ${JSON.stringify(summary.race_candidate_counts_by_confidence)}`);
  lines.push("");
  lines.push("## Excluded Weeks");
  lines.push(`- by_tag: ${JSON.stringify(summary.total_excluded_weeks_by_tag)}`);
  lines.push("");
  lines.push("## Confidence Distribution");
  lines.push(`- ${JSON.stringify(summary.confidence_distribution)}`);
  return `${lines.join("\n")}\n`;
}

export function buildPerAthleteBaselineV2Markdown(athletes: PerAthleteBaselineV2[]): string {
  const lines: string[] = ["# Per-Athlete Baseline v2", ""];
  if (athletes.length === 0) {
    lines.push("- No athletes analyzed.");
    return `${lines.join("\n")}\n`;
  }
  for (const athlete of athletes) {
    lines.push(`## ${athlete.student_name}`);
    lines.push(`- athlete_id: ${athlete.athlete_id}`);
    lines.push(`- baseline_source: ${athlete.baseline_source}`);
    lines.push(`- baseline_metric_source: ${athlete.baseline_metric_source}`);
    lines.push(`- baseline_mode: ${athlete.baseline_mode}`);
    lines.push(`- confidence: ${athlete.confidence}`);
    lines.push(`- needs_review: ${athlete.needs_review}`);
    lines.push(
      `- normal_baseline: freq=${formatMetric(athlete.normal_baseline.frequency_cap)}, weekly_minutes=${formatMetric(
        athlete.normal_baseline.weekly_minutes_cap,
      )}, long_run=${formatMetric(athlete.normal_baseline.long_run_cap_min)}, quality=${formatMetric(
        athlete.normal_baseline.quality_count_cap,
      )}, interval_like=${formatMetric(athlete.normal_baseline.interval_like_count)}`,
    );
    lines.push(
      `- all_week_baseline: freq=${formatMetric(athlete.all_week_baseline.frequency_cap)}, weekly_minutes=${formatMetric(
        athlete.all_week_baseline.weekly_minutes_cap,
      )}, long_run=${formatMetric(athlete.all_week_baseline.long_run_cap_min)}, quality=${formatMetric(
        athlete.all_week_baseline.quality_count_cap,
      )}, interval_like=${formatMetric(athlete.all_week_baseline.interval_like_count)}`,
    );
    lines.push(
      `- planned_context_baseline: freq=${formatMetric(athlete.planned_context_baseline.frequency_cap)}, weekly_minutes=${formatMetric(
        athlete.planned_context_baseline.weekly_minutes_cap,
      )}, long_run=${formatMetric(athlete.planned_context_baseline.long_run_cap_min)}, quality=${formatMetric(
        athlete.planned_context_baseline.quality_count_cap,
      )}, interval_like=${formatMetric(athlete.planned_context_baseline.interval_like_count)}`,
    );
    lines.push(`- baseline_change_vs_planned_context: ${JSON.stringify(athlete.baseline_change_vs_planned_context)}`);
    lines.push(`- completed_vs_planned_divergence: ${JSON.stringify(athlete.completed_vs_planned_divergence)}`);
    lines.push(
      `- active_training_window: start=${athlete.active_training_window.active_training_window_start ?? "n/a"}, end=${athlete.active_training_window.active_training_window_end ?? "n/a"}, active_weeks=${athlete.active_training_window.active_training_weeks_count}, pre_active_gap=${athlete.active_training_window.pre_active_gap_weeks_count}, period_type=${athlete.active_training_window.baseline_period_type}`,
    );
    lines.push(
      `- frequency_layers: all_window=${formatMetric(athlete.active_training_window.all_window_frequency)}, active_window=${formatMetric(athlete.active_training_window.active_window_frequency)}, normal_week=${formatMetric(athlete.active_training_window.normal_week_frequency)}, recent_4w=${formatMetric(athlete.active_training_window.recent_4w_frequency)}`,
    );
    lines.push(
      `- recent_4w_completed_minutes: ${formatMetric(athlete.recent_current_status.recent_4w_completed_minutes)}`,
    );
    lines.push(`- normal_training_weeks_count: ${athlete.normal_training_weeks_count}`);
    lines.push(`- excluded_weeks_count: ${athlete.excluded_weeks_count}`);
    lines.push(`- excluded_weeks_count_by_tag: ${JSON.stringify(athlete.excluded_weeks_count_by_tag)}`);
    lines.push(`- excluded_weeks_by_tag: ${JSON.stringify(athlete.excluded_weeks_by_tag)}`);
    lines.push(`- race_candidate_count_by_confidence: ${JSON.stringify(athlete.race_candidate_count_by_confidence)}`);
    lines.push(`- race_candidate_count_by_source_type: ${JSON.stringify(athlete.race_candidate_count_by_source_type)}`);
    lines.push(
      `- race_detection_diagnostics: raw=${athlete.race_detection_diagnostics.raw_race_candidates_count}, clustered=${athlete.race_detection_diagnostics.clustered_race_events_count}, suppressed_duplicates=${athlete.race_detection_diagnostics.suppressed_duplicate_candidates_count}`,
    );
    lines.push("- top_race_candidates:");
    for (const candidate of athlete.race_detection_diagnostics.top_race_candidates) {
      lines.push(
        `  - ${candidate.date} (week ${candidate.week_start}) | ${candidate.title ?? "n/a"} | score=${candidate.score} | confidence=${candidate.confidence} | caused_exclusion=${candidate.caused_exclusion} | reason=${candidate.exclusion_decision_reason ?? "n/a"} | evidence=${candidate.matched_reasons.join("; ") || "none"}`,
      );
    }
    lines.push("- top_excluded_weeks:");
    for (const excludedWeek of athlete.race_detection_diagnostics.top_excluded_weeks) {
      lines.push(
        `  - ${excludedWeek.week_start} | tag=${excludedWeek.tag} | reason=${excludedWeek.reason} | source=${excludedWeek.source_race_candidate ? `${excludedWeek.source_race_candidate.date} / ${excludedWeek.source_race_candidate.title ?? "n/a"} / score=${excludedWeek.source_race_candidate.score}` : "n/a"}`,
      );
    }
    lines.push(`- race_candidates: ${athlete.race_specific_context.race_candidate_count}`);
    if (athlete.baseline_mode === "fallback_all_weeks") {
      lines.push("- fallback_explanation: normal metrics may equal all-week metrics because fallback_all_weeks mode used all weeks.");
    }
    lines.push(`- context_flags: ${athlete.context_flags.join(", ") || "none"}`);
    lines.push(`- notes: ${athlete.notes.join(" | ") || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildRaceCandidatesMarkdown(candidates: RaceCandidate[]): string {
  const lines: string[] = ["# Race Candidates", ""];
  if (candidates.length === 0) {
    lines.push("- No race candidates detected.");
    return `${lines.join("\n")}\n`;
  }
  for (const candidate of candidates) {
    lines.push(`## ${candidate.student_name} · ${candidate.date}`);
    lines.push(`- estimated_distance: ${candidate.estimated_distance}`);
    lines.push(`- score: ${candidate.score}`);
    lines.push(`- confidence: ${candidate.confidence}`);
    lines.push(`- title: ${candidate.title ?? "n/a"}`);
    lines.push(`- source_signals: ${candidate.source_signals.join(", ") || "none"}`);
    lines.push(`- snippet: ${candidate.matched_text_snippet ?? "n/a"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildWeekTagsMarkdown(weeks: WeekTagReportRow[]): string {
  const lines: string[] = ["# Week Tags", ""];
  if (weeks.length === 0) {
    lines.push("- No tagged weeks.");
    return `${lines.join("\n")}\n`;
  }
  for (const week of weeks) {
    lines.push(`## ${week.student_name} · ${week.week_start}`);
    lines.push(`- tag: ${week.tag}`);
    lines.push(`- secondary_flags: ${week.secondary_flags.join(", ") || "none"}`);
    lines.push(`- planned_running_workouts: ${week.planned_running_workouts}`);
    lines.push(`- completed_running_workouts: ${week.completed_running_workouts}`);
    lines.push(`- completed_running_distance_km: ${week.completed_running_distance_km}`);
    lines.push(`- planned_running_minutes: ${week.planned_running_minutes}`);
    lines.push(`- completed_running_minutes: ${week.completed_running_minutes}`);
    lines.push(`- completed_only_running_workouts: ${week.completed_only_running_workouts}`);
    lines.push(`- planned_only_running_workouts: ${week.planned_only_running_workouts}`);
    lines.push(`- ambiguous_completed_activities: ${week.ambiguous_completed_activities}`);
    lines.push(`- planned_not_completed_context: ${week.planned_not_completed_context}`);
    lines.push(`- low_data_reasons: ${week.low_data_reasons.join(", ") || "none"}`);
    lines.push(`- longest_run_minutes: ${formatMetric(week.longest_run_minutes)}`);
    lines.push(`- quality_sessions: ${week.quality_sessions}`);
    lines.push(`- interval_like_sessions: ${week.interval_like_sessions}`);
    lines.push(`- race_candidates: ${week.race_candidates.map((candidate) => `${candidate.estimated_distance}/${candidate.confidence}`).join(", ") || "none"}`);
    lines.push(`- notes: ${week.notes.join(" | ") || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildManualReviewShortlistMarkdown(entries: ManualReviewEntry[]): string {
  const lines: string[] = ["# Manual Review Shortlist", ""];
  if (entries.length === 0) {
    lines.push("- No manual review shortlist entries.");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of entries) {
    lines.push(`## ${entry.student_name}`);
    lines.push(`- reason: ${entry.review_reason}`);
    lines.push(`- baseline_period_type: ${entry.active_training_window.baseline_period_type}`);
    lines.push(
      `- active_training_window: start=${entry.active_training_window.active_training_window_start ?? "n/a"}, pre_active_gap=${entry.active_training_window.pre_active_gap_weeks_count}`,
    );
    lines.push(
      `- frequency_layers: all_window=${formatMetric(entry.active_training_window.all_window_frequency)}, active_window=${formatMetric(entry.active_training_window.active_window_frequency)}, normal_week=${formatMetric(entry.active_training_window.normal_week_frequency)}, recent_4w=${formatMetric(entry.active_training_window.recent_4w_frequency)}`,
    );
    lines.push(`- baseline_mode: ${entry.baseline_mode}`);
    lines.push(`- normal_training_weeks_count: ${entry.normal_training_weeks_count}`);
    lines.push(
      `- all_week_vs_normal: freq ${formatMetric(entry.all_week_vs_normal.frequency.all_weeks)} -> ${formatMetric(
        entry.all_week_vs_normal.frequency.normal_weeks,
      )}, weekly_minutes ${formatMetric(entry.all_week_vs_normal.weekly_minutes.all_weeks)} -> ${formatMetric(
        entry.all_week_vs_normal.weekly_minutes.normal_weeks,
      )}, long_run ${formatMetric(entry.all_week_vs_normal.long_run.all_weeks)} -> ${formatMetric(
        entry.all_week_vs_normal.long_run.normal_weeks,
      )}, quality ${formatMetric(entry.all_week_vs_normal.quality.all_weeks)} -> ${formatMetric(
        entry.all_week_vs_normal.quality.normal_weeks,
      )}`,
    );
    lines.push(
      `- excluded_race_taper_recovery_weeks: race=${entry.excluded_race_taper_recovery_weeks.race_week}, taper=${entry.excluded_race_taper_recovery_weeks.taper_week}, recovery=${entry.excluded_race_taper_recovery_weeks.post_race_recovery}, marathon_specific=${entry.excluded_race_taper_recovery_weeks.marathon_specific_block}`,
    );
    lines.push(`- excluded_weeks_count_by_tag: ${JSON.stringify(entry.excluded_weeks_count_by_tag)}`);
    lines.push(`- race_candidate_count_by_confidence: ${JSON.stringify(entry.race_candidate_count_by_confidence)}`);
    lines.push(`- race_candidate_count_by_source_type: ${JSON.stringify(entry.race_candidate_count_by_source_type)}`);
    lines.push(
      `- race_detection_diagnostics: raw=${entry.race_detection_diagnostics.raw_race_candidates_count}, clustered=${entry.race_detection_diagnostics.clustered_race_events_count}, suppressed_duplicates=${entry.race_detection_diagnostics.suppressed_duplicate_candidates_count}`,
    );
    lines.push("- top_race_candidates:");
    for (const candidate of entry.top_race_candidates) {
      lines.push(
        `  - ${candidate.date} (week ${candidate.week_start}) | ${candidate.title ?? "n/a"} | score=${candidate.score} | confidence=${candidate.confidence} | caused_exclusion=${candidate.caused_exclusion} | reason=${candidate.exclusion_decision_reason ?? "n/a"} | evidence=${candidate.matched_reasons.join("; ") || "none"}`,
      );
    }
    lines.push("- top_excluded_weeks:");
    for (const excludedWeek of entry.top_excluded_weeks) {
      lines.push(
        `  - ${excludedWeek.week_start} | tag=${excludedWeek.tag} | reason=${excludedWeek.reason} | source=${excludedWeek.source_race_candidate ? `${excludedWeek.source_race_candidate.date} / ${excludedWeek.source_race_candidate.title ?? "n/a"} / score=${excludedWeek.source_race_candidate.score}` : "n/a"}`,
      );
    }
    if (entry.baseline_mode === "fallback_all_weeks") {
      lines.push("- fallback_explanation: normal metrics may equal all-week metrics because fallback_all_weeks mode used all weeks.");
    }
    lines.push(`- note: ${entry.note}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildDataGapsMarkdown(dataGaps: DataGap[]): string {
  const lines: string[] = ["# Data Gaps", ""];
  if (dataGaps.length === 0) {
    lines.push("- No explicit data gaps detected.");
    return `${lines.join("\n")}\n`;
  }
  for (const gap of dataGaps) {
    lines.push(`- ${gap.label}: ${gap.value}${gap.note ? ` (${gap.note})` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildRaceEvidenceCalibrationMarkdown(report: RaceEvidenceCalibrationReport): string {
  const lines: string[] = ["# Race Evidence Calibration", ""];
  lines.push(`- date_range: ${report.date_range.from}..${report.date_range.to}`);
  lines.push(`- considered_examples: ${report.totals.considered_examples}`);
  lines.push(`- true_event_candidate: ${report.totals.true_event_candidate}`);
  lines.push(`- rejected_training_context: ${report.totals.rejected_training_context}`);
  lines.push(`- manual_review: ${report.totals.manual_review}`);
  lines.push("");

  function emitSection(title: string, rows: RaceEvidenceCalibrationExample[]): void {
    lines.push(`## ${title}`);
    if (rows.length === 0) {
      lines.push("- none");
      lines.push("");
      return;
    }
    for (const row of rows) {
      lines.push(`### ${row.athlete_name} · ${row.date}`);
      lines.push(`- title: ${row.title ?? "n/a"}`);
      lines.push(`- status: completed=${row.completed} planned=${row.planned}`);
      lines.push(`- distance_km: ${row.estimated_distance_km ?? "n/a"} | duration_min: ${row.duration_minutes ?? "n/a"}`);
      lines.push(`- raceTypeDuration: ${row.raceTypeDuration ?? "n/a"}`);
      lines.push(`- matched_positive_evidence: ${row.matched_positive_evidence.join(", ") || "none"}`);
      lines.push(`- matched_negative_training_context: ${row.matched_negative_training_context.join(", ") || "none"}`);
      lines.push(`- decision: ${row.decision}`);
      lines.push(`- would_drive_race_exclusions: ${row.would_drive_race_exclusions}`);
      lines.push(`- notes: ${row.notes.join(" | ") || "none"}`);
      lines.push("");
    }
  }

  emitSection("Potential Positive Race/Event Examples", report.potential_positive_examples);
  emitSection("Rejected Race-Like Training Context Examples", report.rejected_training_context_examples);
  emitSection("Unknown / Manual Review Examples", report.manual_review_examples);
  return `${lines.join("\n")}\n`;
}

export function buildCombinedArtifactsMarkdown(input: {
  summaryMd: string;
  perAthleteMd: string;
  raceCandidatesMd: string;
  weekTagsMd: string;
  manualReviewMd: string;
  dataGapsMd: string;
  raceEvidenceCalibrationMd?: string;
}): string {
  const parts = [
    "# COMBINED BASELINE V2 ARTIFACTS",
    "",
    input.summaryMd.trim(),
    "",
    input.perAthleteMd.trim(),
    "",
    input.raceCandidatesMd.trim(),
    "",
    input.weekTagsMd.trim(),
    "",
    input.manualReviewMd.trim(),
    "",
    input.dataGapsMd.trim(),
    "",
    input.raceEvidenceCalibrationMd?.trim() ?? "",
    "",
  ];
  return `${parts.join("\n")}\n`;
}
