import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";
import { classifyTrainingPeaksWorkoutActivity } from "../../../../src/features/trainingpeaks/workout-activity-classification.ts";
import {
  containsStrongRaceKeyword,
  DISTANCE_KEYWORDS,
  RACE_KEYWORDS_PATTERN,
} from "../../src/quality/race-keywords.ts";

export type BaselineV2Confidence = "high" | "medium" | "low";
export type RaceCandidateConfidence = "high" | "medium" | "low";
export type RaceDistanceKey = "5k" | "10k" | "half" | "marathon" | "unknown";
export type WeekTag =
  | "normal_training"
  | "race_week"
  | "taper_week"
  | "post_race_recovery"
  | "marathon_specific_block"
  | "illness_low_volume"
  | "low_data";
export type SecondaryWeekFlag = "manual_review";

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
  matched_text_snippet: string | null;
  completed_without_plan: boolean;
};

export type WeekTagReportRow = {
  student_id: string;
  student_name: string;
  athlete_id: number;
  week_start: string;
  week_end: string;
  tag: WeekTag;
  secondary_flags: SecondaryWeekFlag[];
  planned_running_workouts: number;
  planned_running_minutes: number;
  completed_running_minutes: number;
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
  normal_training_weeks_count: number;
  excluded_weeks_count: number;
  excluded_weeks_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  total_weeks_count: number;
  baseline_source: "normal_training" | "fallback_all_weeks";
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
  recent_current_status: {
    latest_week_start: string | null;
    latest_week_tag: WeekTag | null;
    latest_two_weeks: Array<{
      week_start: string;
      tag: WeekTag;
      planned_running_minutes: number;
      completed_running_minutes: number;
    }>;
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
  total_excluded_weeks_by_tag: Record<Exclude<WeekTag, "normal_training">, number>;
  confidence_distribution: Record<BaselineV2Confidence, number>;
  needs_review_count: number;
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
  isRunning: boolean;
  plannedMinutes: number | null;
  completedMinutes: number | null;
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
  plannedRunningWorkouts: number;
  plannedRunningMinutes: number;
  completedRunningMinutes: number;
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

  return {
    row,
    text,
    title: row.title,
    isRunning: activity.isRunning,
    plannedMinutes,
    completedMinutes,
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

function buildRaceCandidate(insight: WorkoutInsight): RaceCandidate | null {
  if (!insight.isRunning) return null;
  const snapshot = isRecord(insight.row.sourceSnapshot) ? insight.row.sourceSnapshot : null;
  const sourceSignals: string[] = [];
  let score = 0;
  let hasExplicitRaceSignal = false;
  let hasDistanceWindowSignal = false;
  let hasEffortSupport = false;

  if (snapshot?.raceTypeDuration !== null && snapshot?.raceTypeDuration !== undefined) {
    score += 3;
    sourceSignals.push("explicit_raceTypeDuration");
    hasExplicitRaceSignal = true;
  }

  if (containsStrongRaceKeyword(insight.text) || RACE_KEYWORDS_PATTERN.test(insight.text)) {
    score += 3;
    sourceSignals.push("strong_race_keyword");
    hasExplicitRaceSignal = true;
  }

  const estimatedDistance = estimateRaceDistance(insight.text, insight.distanceKm);
  if (estimatedDistance !== "unknown" && DISTANCE_KEYWORDS[estimatedDistance].test(insight.text)) {
    score += 1;
    sourceSignals.push(`distance_keyword:${estimatedDistance}`);
    hasExplicitRaceSignal = true;
  }

  if (estimatedDistance !== "unknown" && insight.distanceKm !== null) {
    score += 1;
    sourceSignals.push(`distance_window:${estimatedDistance}`);
    hasDistanceWindowSignal = true;
  }

  const tssActual = toFiniteNumber(snapshot?.tssActual);
  const ifActual = toFiniteNumber(snapshot?.ifActual);
  const effortSupport =
    ((tssActual ?? 0) >= 50 || (ifActual ?? 0) >= 0.9) && ((insight.distanceKm ?? 0) >= 5 || (insight.durationMinutes ?? 0) >= 20);
  if (effortSupport) {
    score += 1;
    sourceSignals.push("effort_support");
    hasEffortSupport = true;
  }

  if (insight.completedWithoutPlan && estimatedDistance !== "unknown") {
    score += 1;
    sourceSignals.push("completed_without_plan");
    hasExplicitRaceSignal = true;
  }

  if (score <= 0) return null;

  let confidence: RaceCandidateConfidence = "low";
  if (score >= 4 && hasExplicitRaceSignal) {
    confidence = "high";
  } else if (
    hasExplicitRaceSignal &&
    (
      score >= 3 ||
      (hasDistanceWindowSignal && hasEffortSupport) ||
      (insight.completedWithoutPlan && hasDistanceWindowSignal)
    )
  ) {
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
    estimated_distance: estimatedDistance,
    estimated_distance_km: insight.distanceKm,
    score,
    confidence,
    source_signals: sourceSignals,
    matched_text_snippet: pickTextSnippet(insight.text),
    completed_without_plan: insight.completedWithoutPlan,
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

function computeWeekMetrics(weeks: WeekTagReportRow[]): BaselineWeekMetrics {
  return {
    frequency_cap: median(weeks.map((week) => week.planned_running_workouts)),
    weekly_minutes_cap: quantile(weeks.map((week) => week.planned_running_minutes), 0.75),
    long_run_cap_min: quantile(
      weeks.map((week) => week.longest_run_minutes).filter((value): value is number => value !== null),
      0.75,
    ),
    quality_count_cap: median(weeks.map((week) => week.quality_sessions)),
    interval_like_count: median(weeks.map((week) => week.interval_like_sessions)),
  };
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
      plannedRunningWorkouts: 0,
      plannedRunningMinutes: 0,
      completedRunningMinutes: 0,
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
      current.completedRunningMinutes += insight.completedMinutes ?? 0;
    }
    if (insight.longRunLike && insight.durationMinutes !== null) {
      current.longestRunMinutes =
        current.longestRunMinutes === null ? insight.durationMinutes : Math.max(current.longestRunMinutes, insight.durationMinutes);
    }
    if (insight.qualityLike) current.qualitySessions += 1;
    if (insight.intervalLike) current.intervalLikeSessions += 1;
    if (insight.marathonSpecificCue) current.marathonSpecificCue = true;
    if (insight.explicitRunWalk) current.notes.push("explicit_run_walk_signal");

    const raceCandidate = buildRaceCandidate(insight);
    if (raceCandidate) {
      if (raceCandidate.confidence === "low") current.lowConfidenceRaceCandidates.push(raceCandidate);
      else current.raceCandidates.push(raceCandidate);
    }

    weekMap.set(insight.weekStart, current);
  }

  const orderedWeeks = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const raceWindows: RaceWindow[] = orderedWeeks
    .filter((week) => week.raceCandidates.length > 0)
    .map((week) => {
      const raceDistances = week.raceCandidates.map((candidate) => candidate.estimated_distance);
      const distance =
        raceDistances.includes("marathon")
          ? "marathon"
          : raceDistances.includes("half")
            ? "half"
            : raceDistances.includes("10k")
              ? "10k"
              : raceDistances.includes("5k")
                ? "5k"
                : "unknown";
      const confidence = week.raceCandidates.some((candidate) => candidate.confidence === "high") ? "high" : "medium";
      return { weekStart: week.weekStart, distance, confidence };
    });

  const weekRows: WeekTagReportRow[] = [];
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
    if (week.raceCandidates.length > 0) {
      tags.add("race_week");
    }

    for (const raceWindow of raceWindows) {
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

    if (week.plannedRunningWorkouts < 2 && week.plannedRunningMinutes < 60) {
      tags.add("low_data");
    }

    if (!tags.has("race_week") && !tags.has("taper_week") && !tags.has("post_race_recovery")) {
      if (rollingMedian !== null && rollingMedian >= 90 && effectiveMinutes < rollingMedian * 0.3) {
        if (week.plannedRunningWorkouts >= 2 || week.plannedRunningMinutes >= 60) {
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

    weekRows.push({
      student_id: week.studentId,
      student_name: week.studentName,
      athlete_id: week.athleteId,
      week_start: week.weekStart,
      week_end: week.weekEnd,
      tag: finalTag,
      secondary_flags: buildSecondaryFlag(notes),
      planned_running_workouts: week.plannedRunningWorkouts,
      planned_running_minutes: Number(week.plannedRunningMinutes.toFixed(2)),
      completed_running_minutes: Number(week.completedRunningMinutes.toFixed(2)),
      longest_run_minutes: week.longestRunMinutes === null ? null : Number(week.longestRunMinutes.toFixed(2)),
      quality_sessions: week.qualitySessions,
      interval_like_sessions: week.intervalLikeSessions,
      race_candidate_count: week.raceCandidates.length + week.lowConfidenceRaceCandidates.length,
      race_candidates: [...week.raceCandidates, ...week.lowConfidenceRaceCandidates].map((candidate) => ({
        date: candidate.date,
        estimated_distance: candidate.estimated_distance,
        confidence: candidate.confidence,
        score: candidate.score,
        title: candidate.title,
      })),
      notes,
    });
  }

  const normalWeeks = weekRows.filter((week) => week.tag === "normal_training");
  const allWeeks = weekRows;
  const excludedCounts = emptyExcludedCounts();
  for (const week of weekRows) {
    if (week.tag !== "normal_training") excludedCounts[week.tag] += 1;
  }

  let baselineSource: "normal_training" | "fallback_all_weeks" = "normal_training";
  let confidence: BaselineV2Confidence = "high";
  let needsReview = false;
  const notes: string[] = [];

  if (normalWeeks.length >= input.minNormalWeeks) {
    confidence = normalWeeks.length >= input.minNormalWeeks + 2 ? "high" : "medium";
  } else if (normalWeeks.length >= 4) {
    confidence = "medium";
    needsReview = true;
    contextFlags.add("limited_clean_baseline");
    notes.push(`Only ${normalWeeks.length} clean normal weeks found.`);
  } else {
    confidence = "low";
    needsReview = true;
    baselineSource = "fallback_all_weeks";
    contextFlags.add("insufficient_clean_baseline");
    notes.push(`Fallback baseline used because only ${normalWeeks.length} clean normal weeks were found.`);
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

  const baselineWeeks = baselineSource === "normal_training" ? normalWeeks : allWeeks;
  const normalBaseline = computeWeekMetrics(baselineWeeks);
  const allWeekBaseline = computeWeekMetrics(allWeeks);
  const raceCandidates = weekRows.flatMap((week) =>
    week.race_candidates.map((candidate) => {
      const full = [...(weekMap.get(week.week_start)?.raceCandidates ?? []), ...(weekMap.get(week.week_start)?.lowConfidenceRaceCandidates ?? [])]
        .find((entry) => entry.date === candidate.date && entry.score === candidate.score && entry.title === candidate.title);
      return full!;
    }),
  );
  const raceCandidatesUnique = uniqueSorted(raceCandidates.map((candidate) => `${candidate.workout_id}`))
    .map((id) => raceCandidates.find((candidate) => `${candidate.workout_id}` === id))
    .filter((candidate): candidate is RaceCandidate => Boolean(candidate));

  if (raceCandidatesUnique.some((candidate) => candidate.estimated_distance === "marathon")) {
    notes.push("Marathon-context race candidate detected.");
  }

  const latestTwoWeeks = [...weekRows].sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, 2);
  const athleteOutput: PerAthleteBaselineV2 = {
    student_name: input.athlete.studentName,
    student_id: input.athlete.studentId,
    athlete_id: input.athlete.athleteId,
    analyzed_from: input.from,
    analyzed_to: input.to,
    normal_baseline: normalBaseline,
    all_week_baseline: allWeekBaseline,
    normal_training_weeks_count: normalWeeks.length,
    excluded_weeks_count: weekRows.length - normalWeeks.length,
    excluded_weeks_by_tag: excludedCounts,
    total_weeks_count: weekRows.length,
    baseline_source: baselineSource,
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
    recent_current_status: {
      latest_week_start: latestTwoWeeks[0]?.week_start ?? null,
      latest_week_tag: latestTwoWeeks[0]?.tag ?? null,
      latest_two_weeks: latestTwoWeeks.map((week) => ({
        week_start: week.week_start,
        tag: week.tag,
        planned_running_minutes: week.planned_running_minutes,
        completed_running_minutes: week.completed_running_minutes,
      })),
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
    total_excluded_weeks_by_tag: totalExcludedWeeksByTag,
    confidence_distribution: confidenceDistribution,
    needs_review_count: perAthlete.filter((athlete) => athlete.needs_review).length,
  };

  return {
    summary,
    perAthlete,
    raceCandidates,
    weekTags,
    manualReviewShortlist: buildManualReviewShortlist(perAthlete),
    dataGaps,
  };
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : String(value);
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
  lines.push(`- needs_review_count: ${summary.needs_review_count}`);
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
    lines.push(`- normal_training_weeks_count: ${athlete.normal_training_weeks_count}`);
    lines.push(`- excluded_weeks_count: ${athlete.excluded_weeks_count}`);
    lines.push(`- excluded_weeks_by_tag: ${JSON.stringify(athlete.excluded_weeks_by_tag)}`);
    lines.push(`- race_candidates: ${athlete.race_specific_context.race_candidate_count}`);
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
    lines.push(`- planned_running_minutes: ${week.planned_running_minutes}`);
    lines.push(`- completed_running_minutes: ${week.completed_running_minutes}`);
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

export function buildCombinedArtifactsMarkdown(input: {
  summaryMd: string;
  perAthleteMd: string;
  raceCandidatesMd: string;
  weekTagsMd: string;
  manualReviewMd: string;
  dataGapsMd: string;
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
  ];
  return `${parts.join("\n")}\n`;
}
