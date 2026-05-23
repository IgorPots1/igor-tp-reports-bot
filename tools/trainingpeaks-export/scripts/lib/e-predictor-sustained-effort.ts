import { loadEPredictorConstants } from "./e-predictor-constants.ts";
import { isProbeTimingEnabled, logProbeTiming, probeTimingElapsedMs, probeTimingNowMs } from "./probe-timing.ts";
import { formatDurationFromSeconds, formatPaceText } from "./race-distance.ts";

const FIT_RECORD_WINDOW_MAX_RECORDS = 4_000;
const FIT_RECORD_WINDOW_DOWNSAMPLE_TARGET = 3_000;
const FIT_RECORD_WINDOW_MAX_ELAPSED_MS = 5_000;
const FIT_RECORD_WINDOW_START_STRIDE = 2;

export type SustainedEffortSource =
  | "fit_record_window"
  | "fit_lap"
  | "segment_comparison"
  | "whole_workout"
  | "manual_selection_unavailable"
  | "unmatched";

export type SustainedEffortEvidenceRole =
  | "half_specific_sustained"
  | "threshold_tempo_sustained"
  | "steady_support"
  | "long_run_endurance_support"
  | "easy_long_run_support"
  | "unknown_sustained";

const THRESHOLD_ANCHOR_EVIDENCE_ROLES: ReadonlySet<SustainedEffortEvidenceRole> = new Set([
  "half_specific_sustained",
  "threshold_tempo_sustained",
]);

export type SustainedEffortConfidence = "high" | "medium" | "low" | "none";

export type ExcludedFromTrainingImpliedReason =
  | "long_run_endurance_support_only"
  | "no_explicit_tempo_marker"
  | "near_distance_conflict"
  | "low_confidence"
  | "severe_quality_flags"
  | "insufficient_duration"
  | "missing_pace";

export type SustainedEffortCandidate = {
  available: boolean;
  source: SustainedEffortSource;
  shadow_mode: boolean;
  prediction_eligible: boolean;
  confidence: SustainedEffortConfidence;
  duration_seconds: number | null;
  distance_km: number | null;
  pace_seconds_per_km: number | null;
  pace_text: string | null;
  ngp_seconds_per_km?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  evidence_role: SustainedEffortEvidenceRole;
  half_pace_penalty_sec_per_km?: number | null;
  used_for_training_implied_anchor?: boolean;
  excluded_from_training_implied_reason?: ExcludedFromTrainingImpliedReason | null;
  threshold_eligible?: boolean;
  prediction_evidence_status?:
    | "supports_current_shape"
    | "report_only_until_coach_review"
    | "low_confidence";
  sanity_flags?: string[];
  notes: string[];
};

export type FitLapRecordLike = {
  lap_index: number;
  duration_seconds: number;
  distance_meters: number | null;
  pace_min_per_km: number | null;
  avg_hr: number | null;
};

export type FitRecordLike = {
  timer_time_seconds: number;
  distance_meters: number;
  heart_rate: number | null;
  speed_mps: number | null;
  altitude_meters: number | null;
};

export type SegmentComparisonEntryLike = {
  segment_type?: string | null;
  is_rest?: boolean | null;
  planned_duration_minutes?: number | null;
  coverage?: string | null;
  actual?: {
    duration_minutes?: number | null;
    distance_km?: number | null;
    avg_pace_min_per_km?: number | null;
    avg_pace_text?: string | null;
    avg_hr?: number | null;
    max_hr?: number | null;
  } | null;
  pace_vs_target?: {
    status?: string | null;
  } | null;
  data_quality_flags?: string[];
};

export type PlannedSegmentLike = {
  segment_type?: string | null;
  is_rest?: boolean | null;
  duration_minutes?: number | null;
  label?: string | null;
  targets?: {
    pace_min_per_km?: {
      fast_min_per_km?: number | null;
      slow_min_per_km?: number | null;
    } | null;
  } | null;
};

export type SustainedEffortWorkoutLike = {
  date: string;
  title: string | null;
  role: string;
  description?: string | null;
  avg_pace_min_per_km?: number | null;
  completed_duration_minutes?: number | null;
  distance_km?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  intensity_flags?: string[];
  planned?: {
    description?: string | null;
    segments?: PlannedSegmentLike[];
  } | null;
  segment_comparison?: SegmentComparisonEntryLike[];
  data_quality_flags?: string[];
};

const SUSTAINED_STANDALONE_TITLE_PATTERN = /^\s*(\d{2,3})\s*мин(?:$|\s|[·\-–—])/i;
const SUSTAINED_TEXT_PATTERN =
  /\b(40|50|60)\s*мин(?:ут(?:а|ы)?)?\b|\b\d+\s*[x×хX]\s*25\s*мин|\bтемп\b|\bпо\s*темпу\b|\bsteady\b|\btempo\b/i;
const LONG_RUN_TITLE_PATTERN = /\b(long run|long\b|длительн|длинн|lsd|продолжительн)\b/i;
const LONG_RUN_DURATION_RUN_TITLE_PATTERN = /^\s*(\d{2,3})\s*мин(?:ут(?:а|ы)?)?\s+(?:бег|run)\b/i;
const TEMPO_THRESHOLD_TEXT_PATTERN =
  /\d+\s*мин(?:ут(?:а|ы)?)?\s*темп|(?:^|[\s,.:;(\-–—])(?:tempo|threshold|порог|steady hard|hm pace|race pace|half marathon pace|по\s*темпу|темп(?:\s|$|[·\-–—]))/i;

function hasExplicitTempoThresholdMarker(title: string | null, text: string): boolean {
  const titleTrimmed = (title ?? "").trim();
  if (/\d+\s*мин(?:ут(?:а|ы)?)?\s*темп/i.test(titleTrimmed)) return true;
  if (/^\s*\d+\s*мин(?:\s|$|[·\-–—])/i.test(titleTrimmed) && /\sтемп(?:\s|$|[·\-–—])/i.test(titleTrimmed)) {
    return true;
  }
  return TEMPO_THRESHOLD_TEXT_PATTERN.test(text);
}
const PROGRESSIVE_LONG_RUN_PATTERN =
  /\b(progressive|fast finish|fast-finish|ускорени|прогресс|hm pace|race pace)\b/i;
const LONG_RUN_WORKOUT_MIN_MINUTES = 70;
const PLANNED_CONTINUOUS_SUSTAINED_MAX_EXTRA_MINUTES = 30;
const HARD_SUSTAINED_HR_BPM = 155;
const HARD_SUSTAINED_PACE_MAX_MIN_PER_KM = 5.5;
const GEL_TIMING_PATTERN = /\bгел(?:ь|я)\s+на\s+\d+\s*мин/i;
const EASY_RECOVERY_PATTERN =
  /\b(easy|recovery|лёгк|легк|восстанов|recovery run|легкий бег|лёгкий бег)\b/i;

const SEVERE_DATA_QUALITY_FLAGS = new Set([
  "contains_missing_segments",
  "missing_fit_records",
]);

function sustainedCfg() {
  return loadEPredictorConstants().half_marathon.sustained_effort;
}

function paceMinPerKmToSeconds(paceMinPerKm: number): number {
  return Math.round(paceMinPerKm * 60);
}

function formatPaceSecondsPerKm(secondsPerKm: number): string {
  const totalSeconds = Math.round(secondsPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/км`;
}

function parseMinutesFromTitle(title: string | null): number | null {
  if (!title) return null;
  const standalone = title.trim().match(SUSTAINED_STANDALONE_TITLE_PATTERN);
  if (standalone) {
    const minutes = Number(standalone[1]);
    return Number.isFinite(minutes) && minutes >= 20 ? minutes : null;
  }
  return null;
}

function isPlannedContinuousSustainedWorkoutContext(
  workout: SustainedEffortWorkoutLike,
  extractedBlockMinutes: number | null = null,
): boolean {
  const title = (workout.title ?? "").trim();
  const text = `${title} ${workout.planned?.description ?? workout.description ?? ""}`;

  if (LONG_RUN_TITLE_PATTERN.test(title)) return false;
  if (LONG_RUN_DURATION_RUN_TITLE_PATTERN.test(title)) return false;
  if (EASY_RECOVERY_PATTERN.test(text)) return false;
  if (PROGRESSIVE_LONG_RUN_PATTERN.test(text) && !hasExplicitTempoThresholdMarker(workout.title, text)) {
    return false;
  }

  let plannedMinutes: number | null = null;
  const titleMinutes = parseMinutesFromTitle(workout.title);
  if (
    titleMinutes !== null &&
    titleMinutes >= 35 &&
    titleMinutes <= 65 &&
    SUSTAINED_STANDALONE_TITLE_PATTERN.test(title)
  ) {
    plannedMinutes = titleMinutes;
  }

  if (plannedMinutes === null) {
    const segments = workout.planned?.segments ?? [];
    const mainSegments = segments.filter(
      (segment) =>
        segment.is_rest !== true &&
        segment.segment_type !== "warmup" &&
        segment.segment_type !== "cooldown" &&
        (segment.duration_minutes ?? 0) >= 35 &&
        (segment.duration_minutes ?? 0) <= 65,
    );
    if (mainSegments.length === 1) {
      plannedMinutes = mainSegments[0]!.duration_minutes ?? null;
    }
  }

  if (plannedMinutes === null) return false;

  const blockMinutes = extractedBlockMinutes ?? plannedMinutes;
  if (blockMinutes < 35 || blockMinutes > 65) return false;

  const completedMinutes = workout.completed_duration_minutes;
  if (completedMinutes != null) {
    const sustainedSpan = Math.max(plannedMinutes, blockMinutes);
    if (completedMinutes - sustainedSpan > PLANNED_CONTINUOUS_SUSTAINED_MAX_EXTRA_MINUTES) {
      if (
        completedMinutes >= LONG_RUN_WORKOUT_MIN_MINUTES &&
        !hasExplicitTempoThresholdMarker(workout.title, text)
      ) {
        return false;
      }
    }
  }

  return true;
}

function inferPlannedSustainedMinutes(workout: SustainedEffortWorkoutLike): number | null {
  const fromTitle = parseMinutesFromTitle(workout.title);
  if (fromTitle !== null && fromTitle >= 35 && fromTitle <= 65 && isPlannedContinuousSustainedWorkoutContext(workout)) {
    return fromTitle;
  }

  const segments = workout.planned?.segments ?? [];
  const mainSegments = segments.filter(
    (segment) =>
      segment.is_rest !== true &&
      segment.segment_type !== "warmup" &&
      segment.segment_type !== "cooldown" &&
      (segment.duration_minutes ?? 0) >= 35 &&
      (segment.duration_minutes ?? 0) <= 65,
  );
  if (mainSegments.length === 1) {
    return mainSegments[0]!.duration_minutes ?? null;
  }
  return null;
}

export function isQualifyingSustainedEffortWorkout(workout: SustainedEffortWorkoutLike): boolean {
  const title = workout.title ?? "";
  const titleTrimmed = title.trim();
  const text = `${title} ${workout.planned?.description ?? workout.description ?? ""}`;

  if (EASY_RECOVERY_PATTERN.test(text)) return false;
  if (GEL_TIMING_PATTERN.test(text) && !SUSTAINED_STANDALONE_TITLE_PATTERN.test(titleTrimmed)) {
    return false;
  }
  if (
    (LONG_RUN_TITLE_PATTERN.test(titleTrimmed) ||
      (workout.intensity_flags ?? []).includes("long_run")) &&
    !SUSTAINED_STANDALONE_TITLE_PATTERN.test(titleTrimmed)
  ) {
    return false;
  }

  if (SUSTAINED_STANDALONE_TITLE_PATTERN.test(titleTrimmed)) return true;
  if (SUSTAINED_TEXT_PATTERN.test(text) && !LONG_RUN_TITLE_PATTERN.test(titleTrimmed)) return true;

  const plannedMinutes = inferPlannedSustainedMinutes(workout);
  if (plannedMinutes !== null) return true;

  const mainComparison = (workout.segment_comparison ?? []).find(
    (segment) =>
      segment.segment_type === "main" &&
      (segment.planned_duration_minutes ?? 0) >= 35 &&
      (segment.planned_duration_minutes ?? 0) <= 65,
  );
  return mainComparison !== undefined;
}

function isTempoThresholdWorkoutContext(
  workout: SustainedEffortWorkoutLike,
  extractedBlockMinutes: number | null = null,
): boolean {
  const text = `${workout.title ?? ""} ${workout.planned?.description ?? workout.description ?? ""}`;
  if (hasExplicitTempoThresholdMarker(workout.title, text)) return true;
  if (PROGRESSIVE_LONG_RUN_PATTERN.test(text)) return true;

  if (isLongRunWorkoutContext(workout, extractedBlockMinutes)) {
    return false;
  }

  const roleLower = workout.role.toLowerCase();
  if (roleLower === "tempo_threshold") return true;

  const targetFastMinPerKm = findPlannedTargetFastMinPerKm(workout);
  const avgPaceMinPerKm = workout.avg_pace_min_per_km;
  if (
    targetFastMinPerKm !== null &&
    avgPaceMinPerKm !== null &&
    avgPaceMinPerKm <= targetFastMinPerKm + 0.15
  ) {
    return true;
  }

  const avgHr = workout.avg_hr;
  if (avgHr != null && avgHr >= HARD_SUSTAINED_HR_BPM) return true;

  return false;
}

function isLongRunWorkoutContext(
  workout: SustainedEffortWorkoutLike,
  extractedBlockMinutes: number | null = null,
): boolean {
  const title = workout.title ?? "";
  const titleTrimmed = title.trim();
  const text = `${title} ${workout.planned?.description ?? workout.description ?? ""}`;

  if (isPlannedContinuousSustainedWorkoutContext(workout, extractedBlockMinutes)) {
    return false;
  }

  if (hasExplicitTempoThresholdMarker(workout.title, text)) {
    const titleDurationMinutes = parseMinutesFromTitle(workout.title);
    if (
      titleDurationMinutes !== null &&
      titleDurationMinutes >= 35 &&
      titleDurationMinutes <= 65
    ) {
      return false;
    }
  }

  if ((workout.intensity_flags ?? []).includes("long_run")) return true;
  if (LONG_RUN_TITLE_PATTERN.test(titleTrimmed)) return true;

  const roleLower = workout.role.toLowerCase();
  if (roleLower.includes("long_run") || roleLower === "long run") return true;

  const titleDurationMinutes = parseMinutesFromTitle(workout.title);
  if (
    titleDurationMinutes !== null &&
    titleDurationMinutes >= 35 &&
    titleDurationMinutes <= 65 &&
    SUSTAINED_STANDALONE_TITLE_PATTERN.test(titleTrimmed) &&
    !LONG_RUN_DURATION_RUN_TITLE_PATTERN.test(titleTrimmed) &&
    !LONG_RUN_TITLE_PATTERN.test(titleTrimmed)
  ) {
    return false;
  }

  if (
    titleDurationMinutes !== null &&
    titleDurationMinutes >= LONG_RUN_WORKOUT_MIN_MINUTES &&
    !hasExplicitTempoThresholdMarker(workout.title, text)
  ) {
    return true;
  }

  const durationRunMatch = titleTrimmed.match(LONG_RUN_DURATION_RUN_TITLE_PATTERN);
  if (durationRunMatch) {
    const totalMinutes = Number(durationRunMatch[1]);
    if (
      Number.isFinite(totalMinutes) &&
      totalMinutes >= LONG_RUN_WORKOUT_MIN_MINUTES &&
      !hasExplicitTempoThresholdMarker(workout.title, text)
    ) {
      return true;
    }
  }

  const completedMinutes = workout.completed_duration_minutes;
  if (
    completedMinutes != null &&
    completedMinutes >= LONG_RUN_WORKOUT_MIN_MINUTES &&
    !hasExplicitTempoThresholdMarker(workout.title, text)
  ) {
    return true;
  }

  if (
    extractedBlockMinutes !== null &&
    completedMinutes != null &&
    completedMinutes >= LONG_RUN_WORKOUT_MIN_MINUTES &&
    completedMinutes - extractedBlockMinutes >= 20 &&
    !hasExplicitTempoThresholdMarker(workout.title, text)
  ) {
    return true;
  }

  return false;
}

function isHardSustainedBlock(input: {
  blockPaceMinPerKm: number | null;
  blockAvgHr: number | null;
  targetFastMinPerKm: number | null;
  isLongRun: boolean;
  isTempoThreshold: boolean;
}): boolean {
  if (input.blockAvgHr != null && input.blockAvgHr >= HARD_SUSTAINED_HR_BPM) return true;
  if (input.blockPaceMinPerKm === null) return false;
  if (input.isLongRun) {
    return input.isTempoThreshold;
  }
  if (
    input.targetFastMinPerKm !== null &&
    input.blockPaceMinPerKm <= input.targetFastMinPerKm + 0.15
  ) {
    return true;
  }
  if (input.blockPaceMinPerKm <= HARD_SUSTAINED_PACE_MAX_MIN_PER_KM) return true;
  return false;
}

function classifySustainedEvidenceRole(input: {
  workout: SustainedEffortWorkoutLike;
  durationSeconds: number | null;
  plannedMinutes: number | null;
  blockPaceMinPerKm: number | null;
  blockAvgHr: number | null;
  targetFastMinPerKm: number | null;
}): SustainedEffortEvidenceRole {
  const minutes =
    input.durationSeconds !== null ? input.durationSeconds / 60 : input.plannedMinutes ?? 0;
  const text = `${input.workout.title ?? ""} ${input.workout.planned?.description ?? input.workout.description ?? ""}`;
  const isLongRun = isLongRunWorkoutContext(input.workout, minutes);
  const isTempoThreshold = isTempoThresholdWorkoutContext(input.workout, minutes);
  const isHardBlock = isHardSustainedBlock({
    blockPaceMinPerKm: input.blockPaceMinPerKm,
    blockAvgHr: input.blockAvgHr,
    targetFastMinPerKm: input.targetFastMinPerKm,
    isLongRun,
    isTempoThreshold,
  });
  const isProgressiveLongRun = PROGRESSIVE_LONG_RUN_PATTERN.test(text);

  if (isLongRun) {
    if ((isTempoThreshold || isProgressiveLongRun) && isHardBlock) {
      if (minutes >= 40 && minutes <= 65) return "half_specific_sustained";
      if (minutes >= 25) return "threshold_tempo_sustained";
    }
    if (EASY_RECOVERY_PATTERN.test(text)) return "easy_long_run_support";
    return "long_run_endurance_support";
  }

  if (isTempoThreshold || isHardBlock) {
    if (minutes >= 40 && minutes <= 65) return "half_specific_sustained";
    if (minutes >= 25) return "threshold_tempo_sustained";
  }

  const titleTrimmed = (input.workout.title ?? "").trim();
  if (
    SUSTAINED_STANDALONE_TITLE_PATTERN.test(titleTrimmed) &&
    minutes >= 35 &&
    minutes <= 65 &&
    isHardBlock
  ) {
    return "half_specific_sustained";
  }

  if (minutes >= 40 && minutes <= 65) return "unknown_sustained";
  if (minutes >= 25 && minutes < 40) return "threshold_tempo_sustained";
  return "steady_support";
}

export function isSustainedRoleEligibleForThresholdAnchor(
  role: SustainedEffortEvidenceRole,
): boolean {
  return THRESHOLD_ANCHOR_EVIDENCE_ROLES.has(role);
}

function computeExcludedFromTrainingImpliedReason(input: {
  available: boolean;
  predictionEligible: boolean;
  evidenceRole: SustainedEffortEvidenceRole;
  confidence: SustainedEffortConfidence;
  durationSeconds: number | null;
  paceSecondsPerKm: number | null;
  severeFlags: boolean;
}): ExcludedFromTrainingImpliedReason | null {
  if (!input.available) return "missing_pace";
  if (input.predictionEligible) return null;
  if (input.severeFlags) return "severe_quality_flags";
  if (
    input.evidenceRole === "long_run_endurance_support" ||
    input.evidenceRole === "easy_long_run_support"
  ) {
    return "long_run_endurance_support_only";
  }
  if (!isSustainedRoleEligibleForThresholdAnchor(input.evidenceRole)) {
    return "no_explicit_tempo_marker";
  }
  const cfg = sustainedCfg();
  if ((input.durationSeconds ?? 0) < cfg.promotion_min_duration_seconds) {
    return "insufficient_duration";
  }
  if (input.paceSecondsPerKm == null || input.paceSecondsPerKm <= 0) {
    return "missing_pace";
  }
  if (input.confidence === "low" || input.confidence === "none") {
    return "low_confidence";
  }
  return "low_confidence";
}

function isRecoveryOrEasyPace(paceMinPerKm: number, targetFastMinPerKm: number | null): boolean {
  if (targetFastMinPerKm === null) return false;
  return paceMinPerKm > targetFastMinPerKm + 0.75;
}

function findPlannedTargetFastMinPerKm(workout: SustainedEffortWorkoutLike): number | null {
  const mainSegment = (workout.planned?.segments ?? []).find(
    (segment) => segment.segment_type === "main" && segment.targets?.pace_min_per_km,
  );
  const target = mainSegment?.targets?.pace_min_per_km?.fast_min_per_km;
  if (typeof target === "number" && Number.isFinite(target)) return target;
  return null;
}

function scoreFitSustainedLap(input: {
  durationSeconds: number;
  distanceMeters: number | null;
  paceMinPerKm: number | null;
  avgHr: number | null;
  plannedMinutes: number | null;
  targetFastMinPerKm: number | null;
}): number {
  const cfg = sustainedCfg();
  if (input.paceMinPerKm === null) return -100;
  if (
    input.durationSeconds < cfg.min_duration_seconds ||
    input.durationSeconds > cfg.max_duration_seconds
  ) {
    return -100;
  }

  let score = 0;
  const durationMinutes = input.durationSeconds / 60;
  if (plannedMinutesMatch(durationMinutes, input.plannedMinutes)) score += 30;
  if (durationMinutes >= 45 && durationMinutes <= 60) score += 20;
  if (input.distanceMeters !== null && input.distanceMeters >= 8000) score += 15;

  if (input.targetFastMinPerKm !== null) {
    const delta = Math.abs(input.paceMinPerKm - input.targetFastMinPerKm);
    score += Math.max(0, 20 - delta * 40);
  }

  if (input.avgHr !== null && input.avgHr >= 155 && input.avgHr <= 178) score += 8;
  return score;
}

function plannedMinutesMatch(actualMinutes: number, plannedMinutes: number | null): boolean {
  if (plannedMinutes === null) return actualMinutes >= 40 && actualMinutes <= 60;
  return Math.abs(actualMinutes - plannedMinutes) <= 8;
}

function buildUnavailableCandidate(notes: string[]): SustainedEffortCandidate {
  return {
    available: false,
    source: "unmatched",
    shadow_mode: true,
    prediction_eligible: false,
    confidence: "none",
    duration_seconds: null,
    distance_km: null,
    pace_seconds_per_km: null,
    pace_text: null,
    ngp_seconds_per_km: null,
    evidence_role: "steady_support",
    notes,
  };
}

function extractFromFitLaps(input: {
  fitLaps: FitLapRecordLike[] | null;
  workout: SustainedEffortWorkoutLike;
  plannedMinutes: number | null;
  targetFastMinPerKm: number | null;
}): {
  block: {
    duration_seconds: number;
    distance_km: number;
    pace_seconds_per_km: number;
    avg_hr: number | null;
  } | null;
  notes: string[];
} {
  const notes: string[] = [];
  if (!input.fitLaps || input.fitLaps.length === 0) {
    notes.push("FIT laps недоступны в parsed export.");
    return { block: null, notes };
  }

  const candidates = input.fitLaps
    .filter((lap) => lap.pace_min_per_km !== null)
    .map((lap) => ({
      lap,
      score: scoreFitSustainedLap({
        durationSeconds: lap.duration_seconds,
        distanceMeters: lap.distance_meters,
        paceMinPerKm: lap.pace_min_per_km,
        avgHr: lap.avg_hr,
        plannedMinutes: input.plannedMinutes,
        targetFastMinPerKm: input.targetFastMinPerKm,
      }),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length) {
    notes.push("В FIT laps нет непрерывного блока 35–65 мин с темпом.");
    return { block: null, notes };
  }

  const best = candidates[0]!.lap;
  notes.push(
    `FIT lap #${best.lap_index}: ${formatDurationFromSeconds(Math.round(best.duration_seconds))} / ${((best.distance_meters ?? 0) / 1000).toFixed(2)} км / ${formatPaceText(best.pace_min_per_km!)}.`,
  );
  notes.push(
    "TrainingPeaks UI manual selection (NGP/sub-range) недоступна в parsed export — используется лучший FIT lap.",
  );

  return {
    block: {
      duration_seconds: Math.round(best.duration_seconds),
      distance_km: Math.round(((best.distance_meters ?? 0) / 1000) * 100) / 100,
      pace_seconds_per_km: paceMinPerKmToSeconds(best.pace_min_per_km!),
      avg_hr: best.avg_hr !== null ? Math.round(best.avg_hr) : null,
    },
    notes,
  };
}

function normalizeFitRecords(rawRecords: FitRecordLike[] | null): FitRecordLike[] {
  if (!rawRecords?.length) return [];
  return rawRecords
    .filter(
      (record) =>
        record.timer_time_seconds >= 0 &&
        Number.isFinite(record.distance_meters) &&
        record.distance_meters >= 0,
    )
    .sort((left, right) => left.timer_time_seconds - right.timer_time_seconds);
}

function gradeFromAltitudeDelta(deltaAltMeters: number, deltaDistMeters: number): number {
  if (deltaDistMeters <= 0) return 0;
  return deltaAltMeters / deltaDistMeters;
}

function computeRecordNgpSecondsPerKm(speedMps: number, grade: number): number | null {
  if (!Number.isFinite(speedMps) || speedMps <= 0) return null;
  const paceSecPerKm = 1000 / speedMps;
  return paceSecPerKm * (1 + 0.033 * grade + 0.033 * grade * grade);
}

function computeWindowNgpSecondsPerKm(records: FitRecordLike[]): number | null {
  let weightedSum = 0;
  let weightSeconds = 0;
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]!;
    const current = records[index]!;
    const deltaTime = current.timer_time_seconds - previous.timer_time_seconds;
    const deltaDist = current.distance_meters - previous.distance_meters;
    if (deltaTime <= 0 || deltaDist <= 0) continue;
    const speed =
      current.speed_mps != null && current.speed_mps > 0
        ? current.speed_mps
        : deltaDist / deltaTime;
    const deltaAlt =
      current.altitude_meters != null && previous.altitude_meters != null
        ? current.altitude_meters - previous.altitude_meters
        : 0;
    const ngp = computeRecordNgpSecondsPerKm(speed, gradeFromAltitudeDelta(deltaAlt, deltaDist));
    if (ngp === null) continue;
    weightedSum += ngp * deltaTime;
    weightSeconds += deltaTime;
  }
  if (weightSeconds <= 0) return null;
  return Math.round(weightedSum / weightSeconds);
}

function scoreFitRecordWindow(input: {
  durationSeconds: number;
  distanceMeters: number;
  paceMinPerKm: number;
  plannedMinutes: number | null;
  targetFastMinPerKm: number | null;
  targetSlowMinPerKm: number | null;
}): number {
  const cfg = sustainedCfg();
  if (
    input.durationSeconds < cfg.min_duration_seconds ||
    input.durationSeconds > cfg.max_duration_seconds ||
    input.distanceMeters < 7000
  ) {
    return -100;
  }

  const targetSeconds = (input.plannedMinutes ?? 50) * 60;
  const durationDeltaMin = Math.abs(input.durationSeconds - targetSeconds) / 60;
  let score = 50 - durationDeltaMin * 8;

  if (durationDeltaMin <= 2) score += 25;
  else if (durationDeltaMin <= 5) score += 12;

  if (input.targetFastMinPerKm !== null && input.targetSlowMinPerKm !== null) {
    if (
      input.paceMinPerKm >= input.targetFastMinPerKm - 0.08 &&
      input.paceMinPerKm <= input.targetSlowMinPerKm + 0.2
    ) {
      score += 25;
    } else {
      const midTarget = (input.targetFastMinPerKm + input.targetSlowMinPerKm) / 2;
      score += Math.max(0, 20 - Math.abs(input.paceMinPerKm - midTarget) * 35);
    }
  }

  if (input.distanceMeters >= 9000) score += 10;
  return score;
}

function findPlannedTargetSlowMinPerKm(workout: SustainedEffortWorkoutLike): number | null {
  const mainSegment = (workout.planned?.segments ?? []).find(
    (segment) => segment.segment_type === "main" && segment.targets?.pace_min_per_km,
  );
  const target = mainSegment?.targets?.pace_min_per_km?.slow_min_per_km;
  if (typeof target === "number" && Number.isFinite(target)) return target;
  return null;
}

function downsampleFitRecords(records: FitRecordLike[], targetCount: number): FitRecordLike[] {
  if (records.length <= targetCount) return records;
  const stride = Math.ceil(records.length / targetCount);
  const downsampled: FitRecordLike[] = [];
  for (let index = 0; index < records.length; index += stride) {
    downsampled.push(records[index]!);
  }
  const last = records[records.length - 1]!;
  if (downsampled[downsampled.length - 1] !== last) {
    downsampled.push(last);
  }
  return downsampled;
}

function extractFromFitRecordWindow(input: {
  fitRecords: FitRecordLike[] | null;
  workout: SustainedEffortWorkoutLike;
  plannedMinutes: number | null;
  targetFastMinPerKm: number | null;
  targetSlowMinPerKm: number | null;
}): {
  block: {
    duration_seconds: number;
    distance_km: number;
    pace_seconds_per_km: number;
    ngp_seconds_per_km: number | null;
    avg_hr: number | null;
  } | null;
  notes: string[];
} {
  const notes: string[] = [];
  const normalizedRecords = normalizeFitRecords(input.fitRecords);
  if (!normalizedRecords.length) {
    notes.push("FIT records недоступны в parsed export.");
    return { block: null, notes };
  }

  const extractionStartedMs = probeTimingNowMs();
  let records = normalizedRecords;
  let startStride = 1;
  const guardDiagnostics: string[] = [];

  if (records.length > FIT_RECORD_WINDOW_MAX_RECORDS) {
    records = downsampleFitRecords(records, FIT_RECORD_WINDOW_DOWNSAMPLE_TARGET);
    guardDiagnostics.push(
      `FIT records downsampled ${normalizedRecords.length}→${records.length} for sustained window search.`,
    );
  }
  if (records.length > FIT_RECORD_WINDOW_DOWNSAMPLE_TARGET) {
    startStride = FIT_RECORD_WINDOW_START_STRIDE;
    guardDiagnostics.push(`FIT record window start stride=${startStride}.`);
  }

  const cfg = sustainedCfg();
  const targetSeconds = (input.plannedMinutes ?? 50) * 60;
  const durationToleranceSeconds = Math.max(120, Math.round(targetSeconds * 0.08));

  type WindowCandidate = {
    durationSeconds: number;
    distanceMeters: number;
    paceMinPerKm: number;
    score: number;
    startIndex: number;
    endIndex: number;
  };

  let bestCandidate: WindowCandidate | null = null;
  let guardTriggered = false;
  let minEndIndex = 1;

  for (let startIndex = 0; startIndex < records.length - 1; startIndex += startStride) {
    if (probeTimingElapsedMs(extractionStartedMs) > FIT_RECORD_WINDOW_MAX_ELAPSED_MS) {
      guardTriggered = true;
      guardDiagnostics.push(
        `FIT record window search stopped after ${FIT_RECORD_WINDOW_MAX_ELAPSED_MS}ms (partial results kept).`,
      );
      break;
    }

    if (minEndIndex <= startIndex) minEndIndex = startIndex + 1;
    const start = records[startIndex]!;

    while (minEndIndex < records.length) {
      const durationSeconds = records[minEndIndex]!.timer_time_seconds - start.timer_time_seconds;
      if (durationSeconds >= cfg.min_duration_seconds) break;
      minEndIndex += 1;
    }

    for (let endIndex = minEndIndex; endIndex < records.length; endIndex += 1) {
      const end = records[endIndex]!;
      const durationSeconds = end.timer_time_seconds - start.timer_time_seconds;
      if (durationSeconds > cfg.max_duration_seconds) break;

      if (Math.abs(durationSeconds - targetSeconds) > durationToleranceSeconds) continue;

      const distanceMeters = end.distance_meters - start.distance_meters;
      if (distanceMeters < 7000) continue;

      const paceMinPerKm = (durationSeconds / 60) / (distanceMeters / 1000);
      if (isRecoveryOrEasyPace(paceMinPerKm, input.targetFastMinPerKm)) continue;

      const score = scoreFitRecordWindow({
        durationSeconds,
        distanceMeters,
        paceMinPerKm,
        plannedMinutes: input.plannedMinutes,
        targetFastMinPerKm: input.targetFastMinPerKm,
        targetSlowMinPerKm: input.targetSlowMinPerKm,
      });
      if (score <= 0) continue;

      const candidate: WindowCandidate = {
        durationSeconds,
        distanceMeters,
        paceMinPerKm,
        score,
        startIndex,
        endIndex,
      };

      if (!bestCandidate || candidate.score > bestCandidate.score) {
        bestCandidate = candidate;
      }
    }
  }

  if (isProbeTimingEnabled()) {
    logProbeTiming({
      phase: "sustained_fit_record_window",
      message: "extractFromFitRecordWindow",
      elapsedMs: probeTimingElapsedMs(extractionStartedMs),
      data: {
        workoutDate: input.workout.date,
        workoutTitle: input.workout.title,
        recordsCount: normalizedRecords.length,
        searchRecordsCount: records.length,
        candidatesCount: bestCandidate ? 1 : 0,
        guardTriggered,
      },
    });
  }

  if (guardDiagnostics.length > 0) {
    notes.push(...guardDiagnostics);
  }

  if (!bestCandidate) {
    notes.push("В FIT records нет непрерывного блока, близкого к planned sustained window.");
    return { block: null, notes };
  }

  const best = bestCandidate;
  const windowRecords = records.slice(best.startIndex, best.endIndex + 1);
  const hrValues = windowRecords
    .map((record) => record.heart_rate)
    .filter((hr): hr is number => hr != null && hr > 0);
  const avgHr =
    hrValues.length > 0
      ? Math.round(hrValues.reduce((sum, hr) => sum + hr, 0) / hrValues.length)
      : null;
  const ngpSecondsPerKm = computeWindowNgpSecondsPerKm(windowRecords);
  const ngpText =
    ngpSecondsPerKm != null ? ` / NGP ${formatPaceSecondsPerKm(ngpSecondsPerKm)}` : "";
  notes.push(
    `FIT record window: ${formatDurationFromSeconds(Math.round(best.durationSeconds))} / ${(best.distanceMeters / 1000).toFixed(2)} км / ${formatPaceText(best.paceMinPerKm)}${ngpText}.`,
  );
  notes.push(
    "TrainingPeaks UI manual selection недоступна в parsed export — используется лучший FIT record window.",
  );

  return {
    block: {
      duration_seconds: Math.round(best.durationSeconds),
      distance_km: Math.round((best.distanceMeters / 1000) * 100) / 100,
      pace_seconds_per_km: paceMinPerKmToSeconds(best.paceMinPerKm),
      ngp_seconds_per_km: ngpSecondsPerKm,
      avg_hr: avgHr,
    },
    notes,
  };
}

function extractFromSegmentComparison(input: {
  workout: SustainedEffortWorkoutLike;
  plannedMinutes: number | null;
}): {
  block: {
    duration_seconds: number;
    distance_km: number;
    pace_seconds_per_km: number;
    avg_hr: number | null;
  } | null;
  notes: string[];
  severeFlags: boolean;
} {
  const notes: string[] = [];
  const segments = (input.workout.segment_comparison ?? []).filter(
    (segment) =>
      segment.segment_type === "main" &&
      segment.is_rest !== true &&
      segment.actual?.avg_pace_min_per_km != null &&
      (segment.planned_duration_minutes ?? segment.actual?.duration_minutes ?? 0) >= 35,
  );

  if (!segments.length) {
    notes.push("segment_comparison не содержит пригодного main-блока 35+ мин.");
    return { block: null, notes, severeFlags: false };
  }

  const segment = segments.sort(
    (left, right) => (right.planned_duration_minutes ?? 0) - (left.planned_duration_minutes ?? 0),
  )[0]!;
  const durationMinutes = segment.actual?.duration_minutes ?? segment.planned_duration_minutes ?? 0;
  const durationSeconds = Math.round(durationMinutes * 60);
  const paceMinPerKm = segment.actual?.avg_pace_min_per_km;
  if (paceMinPerKm == null || durationSeconds <= 0) {
    return { block: null, notes, severeFlags: false };
  }

  const severeFlags = (segment.data_quality_flags ?? []).some((flag) =>
    SEVERE_DATA_QUALITY_FLAGS.has(flag),
  );
  notes.push(
    `segment_comparison main: ${formatDurationFromSeconds(durationSeconds)} / ${(segment.actual?.distance_km ?? 0).toFixed(2)} км / ${segment.actual?.avg_pace_text ?? formatPaceText(paceMinPerKm)}.`,
  );

  return {
    block: {
      duration_seconds: durationSeconds,
      distance_km: Math.round((segment.actual?.distance_km ?? 0) * 100) / 100,
      pace_seconds_per_km: paceMinPerKmToSeconds(paceMinPerKm),
      avg_hr:
        segment.actual?.avg_hr != null && segment.actual.avg_hr > 0
          ? Math.round(segment.actual.avg_hr)
          : null,
    },
    notes,
    severeFlags,
  };
}

function extractFromWholeWorkout(input: {
  workout: SustainedEffortWorkoutLike;
  plannedMinutes: number | null;
  targetFastMinPerKm: number | null;
}): {
  block: {
    duration_seconds: number;
    distance_km: number;
    pace_seconds_per_km: number;
    avg_hr: number | null;
  } | null;
  notes: string[];
} {
  const notes: string[] = [];
  const completedMinutes = input.workout.completed_duration_minutes;
  const paceMinPerKm = input.workout.avg_pace_min_per_km;
  const distanceKm = input.workout.distance_km;
  if (
    completedMinutes == null ||
    paceMinPerKm == null ||
    distanceKm == null ||
    completedMinutes <= 0
  ) {
    notes.push("Whole-workout метрики недоступны.");
    return { block: null, notes };
  }

  const plannedMinutes = input.plannedMinutes ?? completedMinutes;
  const workFraction = Math.min(1, plannedMinutes / completedMinutes);
  if (workFraction < 0.65) {
    notes.push("Whole-workout не подходит: слишком много разминки/заминки относительно целевого блока.");
    return { block: null, notes };
  }

  if (isRecoveryOrEasyPace(paceMinPerKm, input.targetFastMinPerKm)) {
    notes.push("Whole-workout темп выглядит как easy/recovery.");
    return { block: null, notes };
  }

  const estimatedDurationSeconds = Math.round(plannedMinutes * 60);
  const estimatedDistanceKm = Math.round(distanceKm * workFraction * 100) / 100;
  notes.push(
    `Whole-workout оценка: ~${formatDurationFromSeconds(estimatedDurationSeconds)} / ~${estimatedDistanceKm.toFixed(2)} км / ${formatPaceText(paceMinPerKm)} (work fraction ${Math.round(workFraction * 100)}%).`,
  );

  return {
    block: {
      duration_seconds: estimatedDurationSeconds,
      distance_km: estimatedDistanceKm,
      pace_seconds_per_km: paceMinPerKmToSeconds(paceMinPerKm),
      avg_hr:
        input.workout.avg_hr != null && input.workout.avg_hr > 0
          ? Math.round(input.workout.avg_hr)
          : null,
    },
    notes,
  };
}

export function computeSustainedHalfPacePenalty(input: {
  durationSeconds: number;
  paceSecondsPerKm: number;
  avgHr: number | null;
  fadePct?: number | null;
}): number {
  const cfg = sustainedCfg();
  let penalty = cfg.default_half_pace_penalty_sec_per_km;
  const durationMinutes = input.durationSeconds / 60;

  if (durationMinutes >= 45 && durationMinutes <= 60) {
    penalty = cfg.controlled_block_half_pace_penalty_sec_per_km;
  } else if (durationMinutes >= 40 && durationMinutes < 45) {
    penalty = cfg.shorter_block_half_pace_penalty_sec_per_km;
  } else if (durationMinutes > 60) {
    penalty = cfg.long_block_half_pace_penalty_sec_per_km;
  }

  if (input.avgHr !== null && input.avgHr >= cfg.high_hr_penalty_threshold_bpm) {
    penalty += cfg.high_hr_extra_penalty_sec_per_km;
  } else if (input.avgHr !== null && input.avgHr >= cfg.elevated_hr_threshold_bpm) {
    penalty += cfg.elevated_hr_extra_penalty_sec_per_km;
  }

  if (input.fadePct != null && input.fadePct > 5) {
    penalty += cfg.fade_extra_penalty_sec_per_km;
  }

  return Math.min(cfg.max_half_pace_penalty_sec_per_km, Math.max(cfg.min_half_pace_penalty_sec_per_km, penalty));
}

function assessSustainedConfidence(input: {
  source: SustainedEffortSource;
  durationSeconds: number;
  distanceKm: number;
  paceSecondsPerKm: number;
  avgHr: number | null;
  severeFlags: boolean;
  timerSlicePaceSecondsPerKm: number | null;
}): SustainedEffortConfidence {
  if (input.severeFlags) return "low";

  const durationMinutes = input.durationSeconds / 60;
  let score = 0;
  if (input.source === "fit_record_window") score += 40;
  if (input.source === "fit_lap") score += 35;
  if (input.source === "segment_comparison") score += 25;
  if (input.source === "whole_workout") score += 12;

  if (durationMinutes >= 40 && durationMinutes <= 60) score += 25;
  if (input.distanceKm >= 8) score += 15;
  if (input.avgHr !== null && input.avgHr >= 155 && input.avgHr <= 178) score += 10;

  if (
    input.timerSlicePaceSecondsPerKm !== null &&
    input.paceSecondsPerKm + 5 < input.timerSlicePaceSecondsPerKm
  ) {
    score += 10;
  }

  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  if (score >= 25) return "low";
  return "none";
}

export function buildSustainedEffortCandidate(input: {
  workout: SustainedEffortWorkoutLike;
  fitLaps: FitLapRecordLike[] | null;
  fitRecords?: FitRecordLike[] | null;
  timerSliceWorkPaceMinPerKm?: number | null;
  dataQualityFlags?: string[];
}): SustainedEffortCandidate | undefined {
  if (!isQualifyingSustainedEffortWorkout(input.workout)) return undefined;

  const plannedMinutes = inferPlannedSustainedMinutes(input.workout);
  const targetFastMinPerKm = findPlannedTargetFastMinPerKm(input.workout);
  const targetSlowMinPerKm = findPlannedTargetSlowMinPerKm(input.workout);
  const notes: string[] = [];
  const timerSlicePaceSecondsPerKm =
    input.timerSliceWorkPaceMinPerKm != null
      ? paceMinPerKmToSeconds(input.timerSliceWorkPaceMinPerKm)
      : null;

  const fitRecordExtract = extractFromFitRecordWindow({
    fitRecords: input.fitRecords ?? null,
    workout: input.workout,
    plannedMinutes,
    targetFastMinPerKm,
    targetSlowMinPerKm,
  });
  notes.push(...fitRecordExtract.notes);

  const fitExtract = extractFromFitLaps({
    fitLaps: input.fitLaps,
    workout: input.workout,
    plannedMinutes,
    targetFastMinPerKm,
  });
  notes.push(...fitExtract.notes);

  const segmentExtract = extractFromSegmentComparison({
    workout: input.workout,
    plannedMinutes,
  });
  notes.push(...segmentExtract.notes);

  const wholeExtract = extractFromWholeWorkout({
    workout: input.workout,
    plannedMinutes,
    targetFastMinPerKm,
  });
  notes.push(...wholeExtract.notes);

  type RankedBlock = {
    source: SustainedEffortSource;
    block: {
      duration_seconds: number;
      distance_km: number;
      pace_seconds_per_km: number;
      avg_hr: number | null;
      ngp_seconds_per_km?: number | null;
    };
    severeFlags: boolean;
    shadow: boolean;
  };

  const ranked: RankedBlock[] = [];
  if (fitRecordExtract.block) {
    ranked.push({
      source: "fit_record_window",
      block: fitRecordExtract.block,
      severeFlags: false,
      shadow: false,
    });
  }
  if (fitExtract.block) {
    ranked.push({
      source: "fit_lap",
      block: fitExtract.block,
      severeFlags: false,
      shadow: fitRecordExtract.block !== null,
    });
  }
  if (segmentExtract.block) {
    ranked.push({
      source: "segment_comparison",
      block: segmentExtract.block,
      severeFlags: segmentExtract.severeFlags,
      shadow: fitRecordExtract.block !== null || fitExtract.block !== null,
    });
  }
  if (wholeExtract.block) {
    ranked.push({
      source: "whole_workout",
      block: wholeExtract.block,
      severeFlags: false,
      shadow:
        fitRecordExtract.block !== null ||
        fitExtract.block !== null ||
        segmentExtract.block !== null,
    });
  }

  if (!ranked.length) {
    return buildUnavailableCandidate([
      ...notes,
      "manual_selection_unavailable: TrainingPeaks UI selection недоступна в parsed export.",
    ]);
  }

  ranked.sort((left, right) => {
    const sourcePriority: Record<SustainedEffortSource, number> = {
      fit_record_window: 4,
      fit_lap: 3,
      segment_comparison: 2,
      whole_workout: 1,
      manual_selection_unavailable: 0,
      unmatched: 0,
    };
    return sourcePriority[right.source] - sourcePriority[left.source];
  });

  const selected = ranked[0]!;
  const block = selected.block;
  const blockPaceMinPerKm = block.pace_seconds_per_km / 60;
  const evidenceRole = classifySustainedEvidenceRole({
    workout: input.workout,
    durationSeconds: block.duration_seconds,
    plannedMinutes,
    blockPaceMinPerKm,
    blockAvgHr: block.avg_hr,
    targetFastMinPerKm,
  });
  const confidence = assessSustainedConfidence({
    source: selected.source,
    durationSeconds: block.duration_seconds,
    distanceKm: block.distance_km,
    paceSecondsPerKm: block.pace_seconds_per_km,
    avgHr: block.avg_hr,
    severeFlags: selected.severeFlags || (input.dataQualityFlags ?? []).some((flag) => SEVERE_DATA_QUALITY_FLAGS.has(flag)),
    timerSlicePaceSecondsPerKm,
  });

  const penalty = computeSustainedHalfPacePenalty({
    durationSeconds: block.duration_seconds,
    paceSecondsPerKm: block.pace_seconds_per_km,
    avgHr: block.avg_hr,
  });

  const cfg = sustainedCfg();
  const severeQualityFlags =
    selected.severeFlags || (input.dataQualityFlags ?? []).some((flag) => SEVERE_DATA_QUALITY_FLAGS.has(flag));
  const thresholdEligible = isSustainedRoleEligibleForThresholdAnchor(evidenceRole);
  const promotionEligible =
    block.duration_seconds >= cfg.promotion_min_duration_seconds &&
    block.pace_seconds_per_km > 0 &&
    (confidence === "medium" || confidence === "high") &&
    !severeQualityFlags &&
    thresholdEligible;
  const excludedFromTrainingImpliedReason = computeExcludedFromTrainingImpliedReason({
    available: true,
    predictionEligible: promotionEligible,
    evidenceRole,
    confidence,
    durationSeconds: block.duration_seconds,
    paceSecondsPerKm: block.pace_seconds_per_km,
    severeFlags: severeQualityFlags,
  });

  if (timerSlicePaceSecondsPerKm !== null && block.pace_seconds_per_km + 8 < timerSlicePaceSecondsPerKm) {
    notes.push(
      `Timer-slice (${formatPaceSecondsPerKm(timerSlicePaceSecondsPerKm)}) отклонён; sustained block взят из ${selected.source}.`,
    );
  }

  return {
    available: true,
    source: selected.source,
    shadow_mode: selected.shadow,
    prediction_eligible: promotionEligible,
    confidence,
    duration_seconds: block.duration_seconds,
    distance_km: block.distance_km,
    pace_seconds_per_km: block.pace_seconds_per_km,
    pace_text: formatPaceSecondsPerKm(block.pace_seconds_per_km),
    ngp_seconds_per_km: block.ngp_seconds_per_km ?? null,
    avg_hr: block.avg_hr ?? undefined,
    max_hr: undefined,
    evidence_role: evidenceRole,
    half_pace_penalty_sec_per_km: penalty,
    excluded_from_training_implied_reason: excludedFromTrainingImpliedReason,
    threshold_eligible: thresholdEligible,
    notes,
  };
}

export function sustainedBlockPaceSecondsPerKm(
  candidate: Pick<SustainedEffortCandidate, "pace_seconds_per_km" | "ngp_seconds_per_km">,
): number | null {
  if (candidate.pace_seconds_per_km == null) return null;
  if (
    candidate.ngp_seconds_per_km != null &&
    candidate.ngp_seconds_per_km + 5 < candidate.pace_seconds_per_km
  ) {
    return candidate.ngp_seconds_per_km;
  }
  return candidate.pace_seconds_per_km;
}

export function isSustainedEffortEligibleForHalf(candidate: SustainedEffortCandidate | undefined): boolean {
  if (!candidate?.available) return false;
  return candidate.prediction_eligible;
}

export function sustainedEvidenceWeight(durationSeconds: number | null): number {
  if (durationSeconds === null) return 1;
  const minutes = durationSeconds / 60;
  if (minutes >= 45 && minutes <= 60) return 1.55;
  if (minutes >= 40 && minutes < 45) return 1.35;
  if (minutes > 60) return 1.45;
  return 1.1;
}
