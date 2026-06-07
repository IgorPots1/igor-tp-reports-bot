import type { TrainingPeaksStudentOperationalSignal } from "../../../../src/features/trainingpeaks/repository.ts";
import {
  getNextProgressionCandidates,
  getQualityWorkoutCatalogEntry,
  type QualityWorkoutKey,
} from "./plan-quality-methodology-catalog.ts";
import {
  addDaysIso,
  type EstimatedQualityType,
  type WorkoutDiagnosticRow,
} from "./recent-workout-quality-diagnostic.ts";

export type DetectedContext =
  | "vo2_block"
  | "threshold_or_controlled_block"
  | "race_specific_context"
  | "taper_context"
  | "post_race_recovery"
  | "return_after_illness"
  | "base_or_low_consistency"
  | "general_development"
  | "schedule_constrained"
  | "manual_review_unknown";

export type PhaseConfidence = "high" | "medium" | "low";

export type ReviewLevel = "none" | "info" | "coach_review" | "hard_block";

export type AthletePhaseFlags = {
  manual_review_required: boolean;
  possible_deload_recommended: boolean;
  possible_overload_risk: boolean;
  possible_undertraining_or_low_consistency: boolean;
  illness_return_week: boolean;
  active_illness: boolean;
  race_context_needs_confirmation: boolean;
  quality_progression_known: boolean;
  quality_progression_unknown: boolean;
  marathon_specific_requires_review: boolean;
};

export type AthletePhaseRecommendation = {
  summary: string;
  do_not_do: string[];
  suggested_next_step: string;
};

export type RecentTrainingSummary = {
  weeks_analyzed: number;
  completed_runs: number;
  completed_quality_sessions: number;
  last_quality_date: string | null;
  last_quality_type: string | null;
  last_quality_key: string | null;
  consecutive_quality_weeks: number | null;
  recent_4w_frequency: number | null;
};

export type AthletePhaseSnapshot = {
  athlete_id: number | null;
  student_id: string | null;
  name: string;
  detected_context: DetectedContext;
  confidence: PhaseConfidence;
  review_level: ReviewLevel;
  review_reasons: string[];
  evidence: string[];
  recent_training_summary: RecentTrainingSummary;
  race_context: {
    upcoming_race_detected: boolean;
    upcoming_races_count: number;
    next_race_date: string | null;
    next_race_name: string | null;
    next_race_distance: string | null;
    next_race_type: "road" | "trail" | "unknown" | null;
    weeks_to_next_race: number | null;
    race_confidence: "high" | "medium" | "low" | null;
    race_context_needs_confirmation: boolean;
    all_upcoming_races_preview: Array<{
      date: string;
      name: string | null;
      distance: string | null;
      type: string | null;
      confidence: string | null;
    }>;
  };
  data_visibility_status: "normal" | "no_completed_data" | "device_upload_issue_suspected" | "unknown";
  flags: AthletePhaseFlags;
  recommendation: AthletePhaseRecommendation;
};

export type RaceContextCandidate = {
  date: string | null;
  estimated_distance: string | null;
  confidence: string | null;
  event_name?: string | null;
  source_type?: string | null;
  event_type?: string | null;
  distance_km?: number | null;
};

export type PhaseDetectorBaselineContext = {
  confidence: "low" | "medium" | "high" | null;
  needs_review: boolean;
  frequency_cap: number | null;
  quality_count_cap: number | null;
  recent_4w_frequency: number | null;
  context_flags: string[];
};

export type PhaseDetectorInput = {
  week_start: string;
  name: string;
  athlete_id: number | null;
  student_id: string | null;
  workouts: WorkoutDiagnosticRow[];
  operational_signals: TrainingPeaksStudentOperationalSignal[];
  baseline: PhaseDetectorBaselineContext | null;
  race_context: { candidates: RaceContextCandidate[] } | null;
  schedule_constrained: boolean;
};

function qualityKeyToProgressionPattern(key: QualityWorkoutKey): string {
  return key.replace(/^vo2_/, "");
}

const WORKOUT_PATTERN_ALIASES: Record<string, QualityWorkoutKey> = {
  "20x1": "vo2_20x1",
  "24x1": "vo2_24x1",
  "15x400": "vo2_15x400",
  "20x1:30": "vo2_20x90sec",
  "20x90sec": "vo2_20x90sec",
  "10x2": "vo2_10x2",
  "12x2": "vo2_12x2",
  "6x3": "vo2_6x3",
  "7x3": "vo2_7x3",
  "4x4": "vo2_4x4",
};

function weekStartIso(dateIso: string): string {
  const day = new Date(`${dateIso}T00:00:00Z`);
  const weekday = day.getUTCDay();
  const offset = (weekday + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  const a = new Date(`${left}T00:00:00Z`).getTime();
  const b = new Date(`${right}T00:00:00Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function normalizePattern(value: string): string {
  return value.trim().toLowerCase().replaceAll(" ", "").replaceAll("×", "x").replaceAll("м", "m");
}

const REVIEW_LEVEL_PRIORITY: Record<ReviewLevel, number> = {
  none: 0,
  info: 1,
  coach_review: 2,
  hard_block: 3,
};

function workoutTextBlob(workout: WorkoutDiagnosticRow): string {
  return `${workout.title} ${workout.notes_excerpt ?? ""} ${workout.estimated_structure ?? ""}`;
}

export function isEasyOrLightWorkout(workout: WorkoutDiagnosticRow): boolean {
  const text = workoutTextBlob(workout).toLowerCase();
  return /(легк|лёгк|easy|light|спокойн|ускорен|controlled|rpe\s*(low|moderate|1|2|3|4|5|6)\b)/i.test(
    text,
  );
}

export function isAmbiguous3MinPattern(workout: WorkoutDiagnosticRow): boolean {
  const structure = workout.interval_structure;
  if (structure?.repeat_count && structure.work_duration) {
    const is3min = /^3\s*min$/i.test(structure.work_duration.trim());
    if (is3min && structure.repeat_count >= 5 && structure.repeat_count <= 7) {
      return true;
    }
  }
  const text = `${workout.title} ${workout.estimated_structure ?? ""}`;
  return /\b[567][xх×]3\b/i.test(text);
}

export function hasStrongVo2IntensityEvidence(workout: WorkoutDiagnosticRow): boolean {
  const text = workoutTextBlob(workout);
  if (/(vo2|vo₂|мпк|mapk|интенсив|hard\s+interval|intervals?\s+hard)/i.test(text)) {
    return true;
  }

  const structure = workout.interval_structure;
  if (!structure?.repeat_count || !structure.work_duration) {
    return false;
  }

  const workDuration = structure.work_duration.trim();
  const repeatCount = structure.repeat_count;

  if (repeatCount >= 12 && /^[12]\s*min$/i.test(workDuration)) {
    return true;
  }
  if (repeatCount >= 15 && /^(400m|400\s*m)$/i.test(workDuration)) {
    return true;
  }
  if (repeatCount === 4 && /^4\s*min$/i.test(workDuration)) {
    return true;
  }
  if ((repeatCount === 6 || repeatCount === 7) && /^3\s*min$/i.test(workDuration)) {
    return /(vo2|vo₂|мпк|mapk|интенсив|hard)/i.test(text);
  }

  return false;
}

function isBeginnerOrLowConsistency(input: {
  summary: RecentTrainingSummary;
  baseline: PhaseDetectorBaselineContext | null;
  detectedContext: DetectedContext;
}): boolean {
  if (input.detectedContext === "base_or_low_consistency") {
    return true;
  }
  if (input.baseline?.recent_4w_frequency !== null && input.baseline.recent_4w_frequency < 2) {
    return true;
  }
  if (input.summary.recent_4w_frequency !== null && input.summary.recent_4w_frequency < 2) {
    return true;
  }
  return input.summary.completed_runs < 8;
}

function deriveManualReviewRequired(reviewLevel: ReviewLevel): boolean {
  return reviewLevel === "coach_review" || reviewLevel === "hard_block";
}

type ReviewReason = {
  level: ReviewLevel;
  reason: string;
};

function computeReviewLevel(input: {
  detectedContext: DetectedContext;
  flags: AthletePhaseFlags;
  baseline: PhaseDetectorBaselineContext | null;
  summary: RecentTrainingSummary;
  lastQuality: WorkoutDiagnosticRow | null;
  health: ReturnType<typeof extractOperationalHealthFlags>;
  vo2EndOfFamily: boolean;
  severeConflictingSignals: boolean;
  upcomingRaceOutsidePlanningWindow: boolean;
}): { review_level: ReviewLevel; review_reasons: string[] } {
  const reasons: ReviewReason[] = [];
  const hasQualityRecommendation =
    input.flags.quality_progression_known ||
    input.flags.quality_progression_unknown ||
    isQualityType(input.lastQuality?.estimated_quality_type ?? "unknown");

  if (input.health.has_active_illness) {
    reasons.push({ level: "hard_block", reason: "active_illness" });
  }
  if (input.health.has_active_pain_injury) {
    reasons.push({ level: "hard_block", reason: "active_pain_injury" });
  }
  if (input.summary.completed_runs === 0 && !input.flags.illness_return_week && !input.health.has_active_illness) {
    reasons.push({ level: "hard_block", reason: "no_completed_runs" });
  }
  if (
    input.detectedContext === "manual_review_unknown" &&
    input.summary.completed_runs === 0 &&
    !input.flags.illness_return_week
  ) {
    reasons.push({ level: "hard_block", reason: "manual_review_unknown_no_data" });
  }
  if (input.vo2EndOfFamily) {
    reasons.push({ level: "hard_block", reason: "vo2_end_of_family_no_safe_next_step" });
  }
  if (input.severeConflictingSignals) {
    reasons.push({ level: "hard_block", reason: "severe_conflicting_signals" });
  }

  if (input.detectedContext === "threshold_or_controlled_block") {
    reasons.push({ level: "coach_review", reason: "threshold_or_controlled_block_v0" });
  }
  if (input.detectedContext === "taper_context") {
    reasons.push({ level: "coach_review", reason: "taper_context_race_review" });
  }
  if (input.detectedContext === "race_specific_context") {
    reasons.push({ level: "coach_review", reason: "race_specific_context_review" });
  }
  if (input.flags.quality_progression_unknown) {
    reasons.push({ level: "coach_review", reason: "quality_progression_unknown" });
  }
  if (input.flags.possible_deload_recommended) {
    reasons.push({ level: "coach_review", reason: "possible_deload_recommended" });
  }
  if (input.flags.illness_return_week) {
    reasons.push({ level: "coach_review", reason: "illness_return_week" });
  }
  if (input.flags.race_context_needs_confirmation) {
    reasons.push({ level: "coach_review", reason: "race_context_unclear" });
  }
  if (input.health.has_requires_coach_close) {
    reasons.push({ level: "coach_review", reason: "requires_coach_close" });
  }
  if (input.flags.marathon_specific_requires_review) {
    reasons.push({ level: "coach_review", reason: "marathon_specific_context" });
  }
  if (input.baseline?.confidence === "low" && hasQualityRecommendation) {
    reasons.push({ level: "coach_review", reason: "baseline_confidence_low_with_quality" });
  }
  if (input.detectedContext === "post_race_recovery") {
    reasons.push({ level: "coach_review", reason: "post_race_recovery" });
  }
  if (input.detectedContext === "manual_review_unknown" && input.summary.completed_runs > 0) {
    reasons.push({ level: "coach_review", reason: "manual_review_unknown" });
  }

  if (input.baseline?.needs_review) {
    reasons.push({ level: "info", reason: "baseline_needs_review" });
  }
  if (input.upcomingRaceOutsidePlanningWindow) {
    reasons.push({ level: "info", reason: "upcoming_race_outside_planning_window" });
  }
  if (input.baseline?.confidence === "low" && !hasQualityRecommendation) {
    reasons.push({ level: "info", reason: "baseline_confidence_low" });
  }

  const review_level = reasons.reduce<ReviewLevel>((max, entry) => {
    return REVIEW_LEVEL_PRIORITY[entry.level] > REVIEW_LEVEL_PRIORITY[max] ? entry.level : max;
  }, "none");

  return {
    review_level,
    review_reasons: reasons.map((entry) => entry.reason),
  };
}

export function resolveVo2ProgressionKeyFromWorkout(workout: WorkoutDiagnosticRow): QualityWorkoutKey | null {
  const key = resolveQualityWorkoutKeyFromWorkout(workout);
  if (!key) return null;
  if (key === "vo2_6x3" || key === "vo2_7x3") {
    return hasStrongVo2IntensityEvidence(workout) ? key : null;
  }
  return key;
}

export function resolveQualityWorkoutKeyFromWorkout(workout: WorkoutDiagnosticRow): QualityWorkoutKey | null {
  const structure = workout.interval_structure;
  if (structure?.repeat_count && structure.work_duration) {
    const workToken = structure.work_duration.replace(/\s+/g, "").toLowerCase();
    const compact = `${structure.repeat_count}x${workToken.replace(/min|sec|km|m/g, "")}`;
    for (const [pattern, key] of Object.entries(WORKOUT_PATTERN_ALIASES)) {
      if (normalizePattern(compact).includes(normalizePattern(pattern))) {
        return key;
      }
    }
    if (structure.repeat_count === 20 && /^1\s*min$/i.test(structure.work_duration.trim())) return "vo2_20x1";
    if (structure.repeat_count === 24 && /^1\s*min$/i.test(structure.work_duration.trim())) return "vo2_24x1";
    if (structure.repeat_count === 10 && /^2\s*min$/i.test(structure.work_duration.trim())) return "vo2_10x2";
    if (structure.repeat_count === 12 && /^2\s*min$/i.test(structure.work_duration.trim())) return "vo2_12x2";
    if (structure.repeat_count === 6 && /^3\s*min$/i.test(structure.work_duration.trim())) return "vo2_6x3";
    if (structure.repeat_count === 7 && /^3\s*min$/i.test(structure.work_duration.trim())) return "vo2_7x3";
    if (structure.repeat_count === 4 && /^4\s*min$/i.test(structure.work_duration.trim())) return "vo2_4x4";
  }

  const text = `${workout.title} ${workout.estimated_structure ?? ""}`;
  for (const [pattern, key] of Object.entries(WORKOUT_PATTERN_ALIASES)) {
    if (new RegExp(`\\b${pattern.replace("x", "[xх×]")}\\b`, "i").test(text)) {
      return key;
    }
  }
  return null;
}

export function extractOperationalHealthFlags(signals: TrainingPeaksStudentOperationalSignal[]): {
  has_active_illness: boolean;
  has_active_pain_injury: boolean;
  has_return_monitoring: boolean;
  has_requires_coach_close: boolean;
} {
  const activeSignals = signals.filter((signal) => signal.status === "active");
  const hasActiveIllness = activeSignals.some(
    (signal) =>
      signal.signalType === "health_issue_started" ||
      signal.lifecycleState === "active_problem" ||
      signal.structuredPayload.health_state === "sick",
  );
  const hasActivePainInjury = activeSignals.some((signal) => signal.signalType === "pain_injury");
  const hasReturnMonitoring = activeSignals.some(
    (signal) =>
      signal.signalType === "health_issue_improving" ||
      signal.lifecycleState === "monitoring_after_return" ||
      signal.lifecycleState === "return_planned" ||
      signal.lifecycleState === "return_trial_completed",
  );
  const hasRequiresCoachClose = activeSignals.some((signal) => signal.requiresCoachClose === true);
  return {
    has_active_illness: hasActiveIllness,
    has_active_pain_injury: hasActivePainInjury,
    has_return_monitoring: hasReturnMonitoring,
    has_requires_coach_close: hasRequiresCoachClose,
  };
}

function isQualityType(type: EstimatedQualityType): boolean {
  return (
    type === "vo2max_intervals" ||
    type === "short_intervals" ||
    type === "controlled_sub_threshold" ||
    type === "threshold_tempo" ||
    type === "race_specific"
  );
}

function countQualityWeeks(workouts: WorkoutDiagnosticRow[], weekStart: string, weeks: number): {
  consecutive_from_recent: number;
  quality_weeks_in_window: number;
  quality_week_starts: string[];
} {
  const qualityByWeek = new Map<string, boolean>();
  for (const workout of workouts) {
    if (!workout.quality_like) continue;
    const ws = weekStartIso(workout.date);
    if (ws >= weekStartIso(addDaysIso(weekStart, -7 * (weeks - 1))) && ws < weekStart) {
      qualityByWeek.set(ws, true);
    }
  }

  const weekStarts: string[] = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    weekStarts.push(weekStartIso(addDaysIso(weekStart, -7 * index)));
  }

  let consecutive = 0;
  for (let index = weekStarts.length - 1; index >= 0; index -= 1) {
    const ws = weekStarts[index]!;
    if (qualityByWeek.get(ws)) {
      consecutive += 1;
    } else if (index < weekStarts.length - 1) {
      break;
    }
  }

  const qualityWeekStarts = weekStarts.filter((ws) => qualityByWeek.get(ws));
  return {
    consecutive_from_recent: consecutive,
    quality_weeks_in_window: qualityWeekStarts.length,
    quality_week_starts: qualityWeekStarts,
  };
}

function pickUpcomingRace(
  candidates: RaceContextCandidate[],
  weekStart: string,
): RaceContextCandidate | null {
  const future = candidates
    .filter((candidate) => candidate.date && candidate.date >= weekStart)
    .sort((left, right) => (left.date ?? "").localeCompare(right.date ?? ""));
  return future[0] ?? null;
}

function raceTypeFromCandidate(candidate: RaceContextCandidate): "road" | "trail" | "unknown" | null {
  const blob = `${candidate.event_name ?? ""} ${candidate.event_type ?? ""} ${candidate.source_type ?? ""}`.toLowerCase();
  if (/\btrail|тр[еэ]йл|trailrun\b/i.test(blob)) return "trail";
  if (
    /\broad|roadrun|marathon|half|10k|5k|race|run|забег|марафон|полумарафон|шоссе|старт\b/i.test(blob)
  ) {
    return "road";
  }
  return "unknown";
}

function normalizeDistanceLabel(candidate: RaceContextCandidate): string | null {
  const raw = (candidate.estimated_distance ?? "").trim().toLowerCase();
  if (!raw || raw === "unknown") {
    if (candidate.distance_km !== null && candidate.distance_km !== undefined) {
      return `${candidate.distance_km}km`;
    }
    return null;
  }
  return raw;
}

function planningWindowForCandidate(candidate: RaceContextCandidate): { minWeeks: number; maxWeeks: number } | null {
  const distance = (candidate.estimated_distance ?? "").toLowerCase();
  const raceType = raceTypeFromCandidate(candidate);
  if (distance === "10k") return { minWeeks: 4, maxWeeks: 10 };
  if (distance === "half") return { minWeeks: 6, maxWeeks: 14 };
  if (distance === "marathon" || distance === "ultra") return { minWeeks: 10, maxWeeks: 18 };
  if (raceType === "trail") return null;
  return null;
}

function taperThresholdDays(candidate: RaceContextCandidate): number {
  const distance = (candidate.estimated_distance ?? "").toLowerCase();
  const raceType = raceTypeFromCandidate(candidate);
  if (distance === "marathon" || distance === "ultra") return 21;
  if (distance === "half") return 14;
  if (raceType === "trail") return 14;
  if (distance === "10k") return 7;
  if (candidate.distance_km !== null && candidate.distance_km !== undefined) {
    if (candidate.distance_km >= 20) return 14;
    return 7;
  }
  return 14;
}

function raceConfidence(candidate: RaceContextCandidate): "high" | "medium" | "low" {
  const normalized = (candidate.confidence ?? "").toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function pickRecentPastRace(
  candidates: RaceContextCandidate[],
  weekStart: string,
): RaceContextCandidate | null {
  const past = candidates
    .filter((candidate) => candidate.date && candidate.date < weekStart)
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""));
  return past[0] ?? null;
}

function buildRecentTrainingSummary(input: {
  workouts: WorkoutDiagnosticRow[];
  week_start: string;
  weeks_analyzed: number;
  recent_4w_frequency: number | null;
}): RecentTrainingSummary {
  const qualityWorkouts = input.workouts.filter((workout) => workout.quality_like);
  const lastQuality = qualityWorkouts.length > 0 ? qualityWorkouts[qualityWorkouts.length - 1]! : null;
  const qualityWeeks = countQualityWeeks(input.workouts, input.week_start, input.weeks_analyzed);

  return {
    weeks_analyzed: input.weeks_analyzed,
    completed_runs: input.workouts.length,
    completed_quality_sessions: qualityWorkouts.length,
    last_quality_date: lastQuality?.date ?? null,
    last_quality_type: lastQuality?.estimated_quality_type ?? null,
    last_quality_key: lastQuality ? resolveQualityWorkoutKeyFromWorkout(lastQuality) : null,
    consecutive_quality_weeks: qualityWeeks.consecutive_from_recent,
    recent_4w_frequency: input.recent_4w_frequency,
  };
}

function defaultFlags(): AthletePhaseFlags {
  return {
    manual_review_required: false,
    possible_deload_recommended: false,
    possible_overload_risk: false,
    possible_undertraining_or_low_consistency: false,
    illness_return_week: false,
    active_illness: false,
    race_context_needs_confirmation: false,
    quality_progression_known: false,
    quality_progression_unknown: false,
    marathon_specific_requires_review: false,
  };
}

export function detectTrainingPhaseV0(input: PhaseDetectorInput): AthletePhaseSnapshot {
  const evidence: string[] = [];
  const flags = defaultFlags();
  let vo2EndOfFamily = false;
  let severeConflictingSignals = false;
  let upcomingRaceOutsidePlanningWindow = false;
  const weeksAnalyzed = 4;
  const windowFrom = addDaysIso(input.week_start, -7 * weeksAnalyzed);
  const windowWorkouts = input.workouts.filter(
    (workout) => workout.date >= windowFrom && workout.date < input.week_start,
  );
  const recent4wFrequency =
    input.baseline?.recent_4w_frequency ??
    (windowWorkouts.length > 0 ? Number((windowWorkouts.length / weeksAnalyzed).toFixed(2)) : null);

  const summary = buildRecentTrainingSummary({
    workouts: windowWorkouts,
    week_start: input.week_start,
    weeks_analyzed: weeksAnalyzed,
    recent_4w_frequency: recent4wFrequency,
  });

  const health = extractOperationalHealthFlags(input.operational_signals);
  const qualityWorkouts = windowWorkouts.filter((workout) => workout.quality_like);
  const lastQuality = qualityWorkouts.length > 0 ? qualityWorkouts[qualityWorkouts.length - 1]! : null;
  const qualityWeekStats = countQualityWeeks(windowWorkouts, input.week_start, weeksAnalyzed);
  const raceCandidates = input.race_context?.candidates ?? [];
  const upcomingRace = pickUpcomingRace(raceCandidates, input.week_start);
  const upcomingRaces = raceCandidates
    .filter((candidate) => candidate.date && candidate.date >= input.week_start)
    .sort((left, right) => (left.date ?? "").localeCompare(right.date ?? ""));
  const upcomingRacesCount = upcomingRaces.length;
  const multipleUpcomingRaces = upcomingRacesCount > 1;
  const nextRaceDate = upcomingRace?.date ?? null;
  const nextRaceDays =
    upcomingRace?.date !== undefined && upcomingRace?.date !== null
      ? daysBetween(upcomingRace.date, input.week_start)
      : null;
  const nextRaceType = upcomingRace ? raceTypeFromCandidate(upcomingRace) : null;
  const nextRaceConfidence = upcomingRace ? raceConfidence(upcomingRace) : null;
  const recentPastRace = pickRecentPastRace(raceCandidates, input.week_start);

  let detectedContext: DetectedContext = "general_development";
  let confidence: PhaseConfidence = "medium";

  if (health.has_active_illness || health.has_active_pain_injury) {
    flags.active_illness = health.has_active_illness;
    detectedContext = health.has_active_illness ? "return_after_illness" : "manual_review_unknown";
    confidence = health.has_active_illness ? "high" : "medium";
    evidence.push(
      health.has_active_illness
        ? "Active illness or health_issue_started signal detected."
        : "Active pain/injury operational signal detected.",
    );
  } else if (health.has_return_monitoring) {
    flags.illness_return_week = true;
    detectedContext = "return_after_illness";
    confidence = "high";
    evidence.push("Recent illness return / monitoring-after-return signal detected.");
  }

  if (input.schedule_constrained) {
    if (detectedContext === "general_development") {
      detectedContext = "schedule_constrained";
      evidence.push("Schedule constraint flagged from baseline context or memory.");
    } else {
      evidence.push("Schedule constraint also present.");
    }
  }

  if (
    detectedContext !== "return_after_illness" &&
    recentPastRace?.date &&
    daysBetween(input.week_start, recentPastRace.date) <= 14
  ) {
    detectedContext = "post_race_recovery";
    confidence = recentPastRace.confidence === "high" ? "high" : "medium";
    evidence.push(`Recent race on ${recentPastRace.date}; post-race recovery context likely.`);
  }

  if (upcomingRace?.date) {
    const daysToRace = daysBetween(upcomingRace.date, input.week_start);
    const confidenceTag = raceConfidence(upcomingRace);
    const taperDays = taperThresholdDays(upcomingRace);
    const window = planningWindowForCandidate(upcomingRace);
    const weeksToRace = Math.ceil(daysToRace / 7);
    const raceType = raceTypeFromCandidate(upcomingRace);
    const distanceLabel = normalizeDistanceLabel(upcomingRace);
    const unknownDistance = !upcomingRace.estimated_distance || upcomingRace.estimated_distance === "unknown";
    const insideTaper = daysToRace >= 0 && daysToRace <= taperDays;
    const insidePlanningWindow =
      window !== null &&
      weeksToRace >= window.minWeeks &&
      weeksToRace <= window.maxWeeks &&
      daysToRace > taperDays;

    if (confidenceTag !== "high" || unknownDistance) {
      flags.race_context_needs_confirmation = true;
      evidence.push(`Upcoming race candidate on ${upcomingRace.date} needs confirmation.`);
    }
    if (multipleUpcomingRaces) {
      flags.race_context_needs_confirmation = true;
      evidence.push(`Multiple upcoming races detected (${upcomingRacesCount}); A-race requires coach confirmation.`);
    }
    if (upcomingRace.estimated_distance === "marathon" || raceType === "trail") {
      flags.marathon_specific_requires_review = true;
      evidence.push(
        upcomingRace.estimated_distance === "marathon"
          ? "Marathon-specific race context requires coach review."
          : "Trail race context requires explicit coach review.",
      );
    }

    if (
      insideTaper &&
      detectedContext !== "return_after_illness" &&
      detectedContext !== "post_race_recovery" &&
      !health.has_active_illness &&
      !health.has_active_pain_injury
    ) {
      detectedContext = "taper_context";
      confidence = confidenceTag === "high" ? "high" : "medium";
      evidence.push(
        `Upcoming race in ${daysToRace} days (${upcomingRace.event_name ?? "unnamed event"}${distanceLabel ? `, ${distanceLabel}` : ""}); taper context.`,
      );
    } else if (
      (insidePlanningWindow || raceType === "trail" || unknownDistance) &&
      detectedContext !== "return_after_illness" &&
      detectedContext !== "post_race_recovery" &&
      !health.has_active_illness &&
      !health.has_active_pain_injury
    ) {
      if (detectedContext !== "taper_context") {
        detectedContext = "race_specific_context";
      }
      confidence = confidenceTag === "high" ? "high" : "medium";
      evidence.push(
        `Race-specific context for ${upcomingRace.date} (${weeksToRace} weeks out; ${upcomingRace.event_name ?? "unnamed event"}).`,
      );
    } else if (daysToRace > 0) {
      upcomingRaceOutsidePlanningWindow = true;
      evidence.push(
        `Upcoming race detected (${upcomingRace.date}), outside active planning window; context preserved for now.`,
      );
    }
  }

  if (lastQuality && detectedContext !== "return_after_illness" && detectedContext !== "post_race_recovery") {
    const qualityType = lastQuality.estimated_quality_type;
    if (qualityType === "vo2max_intervals" || qualityType === "short_intervals") {
      if (isEasyOrLightWorkout(lastQuality)) {
        evidence.push(
          `Easy/light workout context on ${lastQuality.date}: "${lastQuality.title}"; not classified as VO2 block.`,
        );
        if (detectedContext === "general_development" || detectedContext === "schedule_constrained") {
          detectedContext = "general_development";
        }
      } else if (
        isAmbiguous3MinPattern(lastQuality) &&
        !hasStrongVo2IntensityEvidence(lastQuality)
      ) {
        flags.quality_progression_unknown = true;
        const conservativeContext = isBeginnerOrLowConsistency({
          summary,
          baseline: input.baseline,
          detectedContext,
        });
        detectedContext = conservativeContext ? "general_development" : "threshold_or_controlled_block";
        confidence = "low";
        evidence.push(
          `Ambiguous 3-min repeat pattern on ${lastQuality.date}: "${lastQuality.title}" without strong VO2 intensity evidence; conservative classification.`,
        );
      } else {
        detectedContext = "vo2_block";
        confidence = lastQuality.confidence === "high" ? "high" : "medium";
        evidence.push(
          `Recent quality history is VO2-oriented (${qualityType}) on ${lastQuality.date}: "${lastQuality.title}".`,
        );
        const qualityKey = resolveVo2ProgressionKeyFromWorkout(lastQuality);
        if (qualityKey) {
          summary.last_quality_key = qualityKey;
          const progression = getNextProgressionCandidates(qualityKeyToProgressionPattern(qualityKey), {
            workout_completed: true,
            rpe: "moderate",
          });
          if (progression.decision === "progress" && progression.next_preferred_keys.length > 0) {
            flags.quality_progression_known = true;
            evidence.push(
              `VO2 progression selector resolves next candidates: ${progression.next_preferred_keys.join(", ")}.`,
            );
          } else if (progression.decision === "repeat") {
            flags.quality_progression_known = true;
            evidence.push(`VO2 progression selector recommends repeat of ${qualityKey}.`);
          } else {
            flags.quality_progression_unknown = true;
            evidence.push(`VO2 progression uncertain (${progression.rationale}).`);
          }
          const catalogEntry = getQualityWorkoutCatalogEntry(qualityKey);
          if ((catalogEntry.next_preferred_keys ?? []).length === 0) {
            vo2EndOfFamily = true;
            evidence.push(`At advanced/end-of-family VO2 stage (${qualityKey}); coach review required.`);
          }
        } else {
          flags.quality_progression_unknown = true;
          evidence.push("VO2-like session detected but quality workout key could not be resolved.");
        }
      }
    } else if (qualityType === "controlled_sub_threshold" || qualityType === "threshold_tempo") {
      detectedContext = "threshold_or_controlled_block";
      flags.quality_progression_unknown = true;
      confidence = lastQuality.confidence === "high" ? "medium" : "low";
      evidence.push(
        `Recent quality is threshold/controlled (${qualityType}) on ${lastQuality.date}; threshold progression not auto-selected in v0.`,
      );
    } else if (qualityType === "race_specific") {
      if (detectedContext === "general_development") {
        detectedContext = "race_specific_context";
      }
      evidence.push(`Recent race-specific quality session on ${lastQuality.date}.`);
    }
  }

  const lowRunVolume = summary.completed_runs < weeksAnalyzed * 2;
  const lowFrequency = recent4wFrequency !== null && recent4wFrequency < 2;
  if (
    (lowRunVolume || lowFrequency || summary.completed_quality_sessions === 0) &&
    (detectedContext === "general_development" || detectedContext === "schedule_constrained")
  ) {
    detectedContext = lowFrequency || lowRunVolume ? "base_or_low_consistency" : "general_development";
    flags.possible_undertraining_or_low_consistency = lowFrequency || lowRunVolume;
    if (summary.completed_runs === 0) {
      confidence = "low";
      detectedContext = "manual_review_unknown";
      evidence.push("Insufficient completed running data in analysis window.");
    } else {
      evidence.push(
        lowFrequency
          ? `Low recent frequency (${recent4wFrequency ?? "n/a"} runs/week).`
          : "No clear recent quality history; base/general development context.",
      );
    }
  }

  if (qualityWeekStats.consecutive_from_recent >= 3) {
    flags.possible_deload_recommended = true;
    flags.possible_overload_risk = true;
    evidence.push(
      `${qualityWeekStats.consecutive_from_recent} consecutive quality weeks detected; possible deload signal only (no auto-insert).`,
    );
  }

  if (input.baseline?.confidence === "low") {
    if (isQualityType(lastQuality?.estimated_quality_type ?? "unknown")) {
      detectedContext = "manual_review_unknown";
      confidence = "low";
      severeConflictingSignals = true;
      evidence.push("Baseline confidence is low while quality history exists; conflicting signals.");
    } else {
      confidence = confidence === "high" ? "medium" : "low";
      evidence.push("Baseline confidence is low.");
    }
  }

  if (input.baseline?.needs_review) {
    evidence.push("Baseline marked needs_review.");
  }

  if (health.has_requires_coach_close) {
    evidence.push("Operational signal requires coach close.");
  }

  if (flags.race_context_needs_confirmation && detectedContext === "general_development") {
    detectedContext = "manual_review_unknown";
    confidence = "low";
  }

  const recommendation = buildRecommendation({
    detected_context: detectedContext,
    flags,
    summary,
  });

  const review = computeReviewLevel({
    detectedContext,
    flags,
    baseline: input.baseline,
    summary,
    lastQuality,
    health,
    vo2EndOfFamily,
    severeConflictingSignals,
    upcomingRaceOutsidePlanningWindow,
  });
  flags.manual_review_required = deriveManualReviewRequired(review.review_level);

  return {
    athlete_id: input.athlete_id,
    student_id: input.student_id,
    name: input.name,
    detected_context: detectedContext,
    confidence,
    review_level: review.review_level,
    review_reasons: review.review_reasons,
    evidence,
    recent_training_summary: summary,
    race_context: {
      upcoming_race_detected: upcomingRace !== null,
      upcoming_races_count: upcomingRacesCount,
      next_race_date: nextRaceDate,
      next_race_name: upcomingRace?.event_name ?? null,
      next_race_distance: upcomingRace ? normalizeDistanceLabel(upcomingRace) : null,
      next_race_type: nextRaceType,
      weeks_to_next_race: nextRaceDays === null ? null : Math.ceil(nextRaceDays / 7),
      race_confidence: nextRaceConfidence,
      race_context_needs_confirmation: flags.race_context_needs_confirmation,
      all_upcoming_races_preview: upcomingRaces
        .filter((candidate): candidate is RaceContextCandidate & { date: string } => Boolean(candidate.date))
        .slice(0, 8)
        .map((candidate) => ({
          date: candidate.date,
          name: candidate.event_name ?? null,
          distance: normalizeDistanceLabel(candidate),
          type: raceTypeFromCandidate(candidate),
          confidence: candidate.confidence ?? null,
        })),
    },
    data_visibility_status: summary.completed_runs === 0 ? "no_completed_data" : "normal",
    flags,
    recommendation,
  };
}

function buildRecommendation(input: {
  detected_context: DetectedContext;
  flags: AthletePhaseFlags;
  summary: RecentTrainingSummary;
}): AthletePhaseRecommendation {
  const doNotDo: string[] = ["auto_insert_deload_week", "auto_generate_plan", "trainingpeaks_write"];

  if (input.flags.active_illness) {
    return {
      summary: "Active illness detected. No intervals or hard quality until coach clears return.",
      do_not_do: [...doNotDo, "intervals", "hard_quality", "normal_training_load"],
      suggested_next_step: "Coach review illness status before any quality or load progression.",
    };
  }

  if (input.flags.illness_return_week || input.detected_context === "return_after_illness") {
    return {
      summary: "Return-after-illness week: one week without intervals / no quality (not two automatic easy-only weeks).",
      do_not_do: [...doNotDo, "intervals", "hard_quality"],
      suggested_next_step:
        "Keep easy aerobic work only this week. Reassess next week; extend easy-only only if evidence or coach review requires.",
    };
  }

  if (input.flags.possible_deload_recommended) {
    return {
      summary: "Coach review: possible recovery/deload week. Do not auto-insert.",
      do_not_do: [...doNotDo, "auto_deload_insertion"],
      suggested_next_step: "Review load absorption and quality streak before adding another quality week.",
    };
  }

  if (input.detected_context === "vo2_block") {
    return {
      summary: "Athlete appears to be in a VO2-oriented quality block based on recent completed sessions.",
      do_not_do: [...doNotDo, "generic_threshold_default"],
      suggested_next_step: input.flags.quality_progression_known
        ? "Use VO2 progression selector output for next quality intent; coach confirms before any writer apply."
        : "Coach review VO2 progression manually; do not auto-select next workout.",
    };
  }

  if (input.detected_context === "threshold_or_controlled_block") {
    return {
      summary: "Threshold/controlled quality context detected; v0 does not auto-select next threshold workout.",
      do_not_do: [...doNotDo, "auto_threshold_progression"],
      suggested_next_step: "Coach selects next controlled/threshold session manually.",
    };
  }

  if (input.detected_context === "taper_context") {
    return {
      summary: "Taper/race-week context likely; quality should be race-appropriate and conservative.",
      do_not_do: [...doNotDo, "heavy_vo2_progression", "new_quality_stimulus"],
      suggested_next_step: "Confirm race priority and taper plan with coach before any quality insertion.",
    };
  }

  if (input.detected_context === "race_specific_context") {
    return {
      summary: "Race-specific training context detected.",
      do_not_do: [...doNotDo, "off_race_progression"],
      suggested_next_step: "Confirm race date/distance/priority before connecting automatic planning logic.",
    };
  }

  if (input.detected_context === "post_race_recovery") {
    return {
      summary: "Post-race recovery context; avoid new quality stimulus until absorption confirmed.",
      do_not_do: [...doNotDo, "intervals", "hard_quality"],
      suggested_next_step: "Coach confirms return-to-training timeline after recent race.",
    };
  }

  if (input.detected_context === "base_or_low_consistency") {
    return {
      summary: "Base or low-consistency context; do not auto-recommend quality.",
      do_not_do: [...doNotDo, "auto_quality_recommendation"],
      suggested_next_step: "Rebuild consistency with easy aerobic work before quality progression.",
    };
  }

  if (input.detected_context === "manual_review_unknown") {
    return {
      summary: "Insufficient or conflicting signals; manual coach review required.",
      do_not_do: [...doNotDo, "auto_quality_recommendation", "auto_context_assumption"],
      suggested_next_step: "Coach reviews athlete data before any planning automation.",
    };
  }

  return {
    summary: "General development context; no strong phase-specific signal.",
    do_not_do: doNotDo,
    suggested_next_step: "Continue monitoring; connect planning logic only after coach review of this snapshot.",
  };
}

export const PHASE_DETECTOR_SAFETY_MARKERS = {
  mode: "read_only" as const,
  no_trainingpeaks_mutations: true,
  no_db_writes: true,
  no_telegram_sends: true,
  no_plan_generation: true,
};
