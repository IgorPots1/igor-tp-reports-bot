import { loadEPredictorConstants } from "./e-predictor-constants.ts";
import { formatDurationFromSeconds, formatPaceText } from "./race-distance.ts";

export type SustainedEffortSource =
  | "fit_record_window"
  | "fit_lap"
  | "segment_comparison"
  | "whole_workout"
  | "manual_selection_unavailable"
  | "unmatched";

export type SustainedEffortEvidenceRole =
  | "half_specific_sustained"
  | "threshold_support"
  | "steady_support";

export type SustainedEffortConfidence = "high" | "medium" | "low" | "none";

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

function inferPlannedSustainedMinutes(workout: SustainedEffortWorkoutLike): number | null {
  const fromTitle = parseMinutesFromTitle(workout.title);
  if (fromTitle !== null && fromTitle >= 35 && fromTitle <= 65) return fromTitle;

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

function classifySustainedEvidenceRole(
  durationSeconds: number | null,
  plannedMinutes: number | null,
): SustainedEffortEvidenceRole {
  const minutes =
    durationSeconds !== null ? durationSeconds / 60 : plannedMinutes ?? 0;
  if (minutes >= 40 && minutes <= 65) return "half_specific_sustained";
  if (minutes >= 25 && minutes < 40) return "threshold_support";
  return "steady_support";
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
  const records = normalizeFitRecords(input.fitRecords);
  if (!records.length) {
    notes.push("FIT records недоступны в parsed export.");
    return { block: null, notes };
  }

  const cfg = sustainedCfg();
  const targetSeconds = (input.plannedMinutes ?? 50) * 60;
  const durationToleranceSeconds = Math.max(120, Math.round(targetSeconds * 0.08));

  type WindowCandidate = {
    durationSeconds: number;
    distanceMeters: number;
    paceMinPerKm: number;
    avgHr: number | null;
    ngpSecondsPerKm: number | null;
    score: number;
    startIndex: number;
    endIndex: number;
  };

  const candidates: WindowCandidate[] = [];
  for (let startIndex = 0; startIndex < records.length - 1; startIndex += 1) {
    const start = records[startIndex]!;
    for (let endIndex = startIndex + 1; endIndex < records.length; endIndex += 1) {
      const end = records[endIndex]!;
      const durationSeconds = end.timer_time_seconds - start.timer_time_seconds;
      if (durationSeconds < cfg.min_duration_seconds || durationSeconds > cfg.max_duration_seconds) {
        continue;
      }
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

      const windowRecords = records.slice(startIndex, endIndex + 1);
      const hrValues = windowRecords
        .map((record) => record.heart_rate)
        .filter((hr): hr is number => hr != null && hr > 0);
      const avgHr =
        hrValues.length > 0
          ? Math.round(hrValues.reduce((sum, hr) => sum + hr, 0) / hrValues.length)
          : null;

      candidates.push({
        durationSeconds,
        distanceMeters,
        paceMinPerKm,
        avgHr,
        ngpSecondsPerKm: computeWindowNgpSecondsPerKm(windowRecords),
        score,
        startIndex,
        endIndex,
      });
    }
  }

  if (!candidates.length) {
    notes.push("В FIT records нет непрерывного блока, близкого к planned sustained window.");
    return { block: null, notes };
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0]!;
  const ngpText =
    best.ngpSecondsPerKm != null ? ` / NGP ${formatPaceSecondsPerKm(best.ngpSecondsPerKm)}` : "";
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
      ngp_seconds_per_km: best.ngpSecondsPerKm,
      avg_hr: best.avgHr,
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
  const evidenceRole = classifySustainedEvidenceRole(block.duration_seconds, plannedMinutes);
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
  const promotionEligible =
    block.duration_seconds >= cfg.promotion_min_duration_seconds &&
    block.pace_seconds_per_km > 0 &&
    (confidence === "medium" || confidence === "high") &&
    !selected.severeFlags &&
    evidenceRole === "half_specific_sustained";

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
