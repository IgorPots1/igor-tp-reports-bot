import {
  loadEPredictorConstants,
  type ConfidenceBand,
} from "./e-predictor-constants.ts";
import {
  formatDurationFromSeconds,
  formatPaceText,
  paceMinPerKmToSeconds,
} from "./race-distance.ts";

const HALF_DISTANCE_KM = 21.0975;
const PREFERRED_BLOCK_MIN_MIN = 14;
const PREFERRED_BLOCK_MIN_MAX = 30;

export type TrainingImpliedEvidenceWorkout = {
  date: string;
  title: string | null;
  role: string;
  work_avg_pace: string;
  block_minutes: number | null;
  weight: number;
};

export type TrainingImpliedEnduranceGate = {
  longest_run_km: number;
  long_runs_14k_count: number;
  passed: boolean;
  status: "cleared" | "partial" | "weak";
  notes: string[];
};

export type TrainingImpliedHalfAnchor = {
  available: boolean;
  source: "training_implied_half";
  threshold_pace_s_per_km: number | null;
  half_pace_offset_s_per_km: number | null;
  durability_penalty_s_per_km: number | null;
  no_race_anchor_safety_penalty_s_per_km: number | null;
  implied_half_pace_s_per_km: number | null;
  implied_half_time_s: number | null;
  confidence_cap: ConfidenceBand;
  evidence_workouts: TrainingImpliedEvidenceWorkout[];
  endurance_gate: TrainingImpliedEnduranceGate;
  notes: string[];
};

export type SegmentKeyWorkoutLike = {
  date: string;
  title: string | null;
  role: string;
  usable_for_prediction: boolean;
  work_avg_pace: string | null;
};

export type LongRunLike = {
  date: string;
  title: string | null;
  distance_km: number;
};

function parsePaceTextToSecondsPerKm(paceText: string | null): number | null {
  if (!paceText) return null;
  const match = paceText.match(/(\d+):(\d+)/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function inferBlockMinutesFromTitle(title: string | null): number | null {
  if (!title) return null;
  const match = title.match(/(\d+)\s*[x×хX]\s*(\d+)/i);
  if (!match) return null;
  const minutes = Number(match[2]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function inferBlockMinutes(workout: SegmentKeyWorkoutLike): number | null {
  const fromTitle = inferBlockMinutesFromTitle(workout.title);
  if (fromTitle !== null) return fromTitle;
  const roleLower = workout.role.toLowerCase();
  if (roleLower.includes("sub-threshold") || roleLower.includes("tempo")) {
    if (roleLower.includes("24")) return 24;
  }
  return null;
}

function isThresholdLikeForHalf(workout: SegmentKeyWorkoutLike): boolean {
  if (!workout.usable_for_prediction || !workout.work_avg_pace) return false;
  const roleLower = workout.role.toLowerCase();
  if (
    roleLower.includes("threshold") ||
    roleLower.includes("tempo") ||
    roleLower.includes("sub-threshold")
  ) {
    return true;
  }
  const blockMinutes = inferBlockMinutes(workout);
  if (blockMinutes !== null && blockMinutes >= 10 && blockMinutes <= 30) {
    return true;
  }
  return false;
}

function blockWeight(blockMinutes: number | null): number {
  if (blockMinutes === null) return 1;
  if (blockMinutes >= PREFERRED_BLOCK_MIN_MIN && blockMinutes <= PREFERRED_BLOCK_MIN_MAX) {
    return 1.35;
  }
  if (blockMinutes >= 10 && blockMinutes < PREFERRED_BLOCK_MIN_MIN) {
    return 1.1;
  }
  return 0.9;
}

function weightedMedian(samples: Array<{ value: number; weight: number }>): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= totalWeight / 2) {
      return row.value;
    }
  }
  return sorted[sorted.length - 1]!.value;
}

function trimmedWeightedMean(samples: Array<{ value: number; weight: number }>): number | null {
  if (!samples.length) return null;
  if (samples.length < 4) {
    const totalWeight = samples.reduce((sum, row) => sum + row.weight, 0);
    if (totalWeight <= 0) return null;
    return samples.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
  }
  const sorted = [...samples].sort((left, right) => left.value - right.value);
  const trimmed = sorted.slice(1, sorted.length - 1);
  const totalWeight = trimmed.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;
  return trimmed.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function lookupHalfPaceOffsetSeconds(impliedFinishSeconds: number): number {
  const bands = loadEPredictorConstants().half_marathon.pace_offset_seconds_per_km_by_finish_band;
  for (const band of bands) {
    if (impliedFinishSeconds <= band.max_finish_seconds) {
      return band.offset_seconds_per_km;
    }
  }
  return bands[bands.length - 1]!.offset_seconds_per_km;
}

function assessEnduranceGate(input: {
  longRuns: LongRunLike[];
  minLongRuns14k: number;
  minLongestRunFraction: number;
}): TrainingImpliedEnduranceGate {
  const longRuns14k = input.longRuns.filter((run) => run.distance_km >= 14);
  const longestRunKm =
    input.longRuns.length > 0 ? Math.max(...input.longRuns.map((run) => run.distance_km)) : 0;
  const longestRunFraction = longestRunKm / HALF_DISTANCE_KM;
  const notes: string[] = [];

  const hasLongRunCount = longRuns14k.length >= input.minLongRuns14k;
  const hasLongestFraction = longestRunFraction >= input.minLongestRunFraction;
  const passed = hasLongRunCount || hasLongestFraction;

  let status: TrainingImpliedEnduranceGate["status"] = "weak";
  if (hasLongRunCount) {
    status = "cleared";
    notes.push(
      `${longRuns14k.length} длительных ≥14 км (нужно ${input.minLongRuns14k}) — выносливость подтверждена.`,
    );
  } else if (hasLongestFraction) {
    status = "partial";
    notes.push(
      `Длинная ${longestRunKm.toFixed(1)} км (${Math.round(longestRunFraction * 100)}% дистанции) — частичное подтверждение выносливости.`,
    );
  } else {
    notes.push("Недостаточно длительных для уверенной half-выносливости.");
  }

  return {
    longest_run_km: Math.round(longestRunKm * 10) / 10,
    long_runs_14k_count: longRuns14k.length,
    passed,
    status,
    notes,
  };
}

export function isStrongHalfRaceAnchor(kind: string | null | undefined): boolean {
  return kind === "official_best" || kind === "official_flagged" || kind === "probable_best";
}

export function computeTrainingImpliedHalfAnchor(input: {
  segmentKeyWorkouts: SegmentKeyWorkoutLike[];
  longRuns: LongRunLike[];
  weeksFound: number;
  raceDistanceKm?: number;
}): TrainingImpliedHalfAnchor {
  const constants = loadEPredictorConstants();
  const cfg = constants.half_marathon.training_implied_anchor;
  const distanceKm = input.raceDistanceKm ?? HALF_DISTANCE_KM;
  const notes: string[] = [];

  const enduranceGate = assessEnduranceGate({
    longRuns: input.longRuns,
    minLongRuns14k: cfg.min_long_runs_14k,
    minLongestRunFraction: cfg.min_longest_run_fraction_of_race,
  });

  const thresholdCandidates = input.segmentKeyWorkouts.filter(isThresholdLikeForHalf);
  const evidenceWorkouts: TrainingImpliedEvidenceWorkout[] = thresholdCandidates.map((workout) => {
    const blockMinutes = inferBlockMinutes(workout);
    return {
      date: workout.date,
      title: workout.title,
      role: workout.role,
      work_avg_pace: workout.work_avg_pace!,
      block_minutes: blockMinutes,
      weight: blockWeight(blockMinutes),
    };
  });

  const paceSamples = evidenceWorkouts
    .map((workout) => {
      const paceSPerKm = parsePaceTextToSecondsPerKm(workout.work_avg_pace);
      if (paceSPerKm === null) return null;
      return { value: paceSPerKm, weight: workout.weight };
    })
    .filter((row): row is { value: number; weight: number } => row !== null);

  const thresholdPaceSPerKm =
    weightedMedian(paceSamples) ?? trimmedWeightedMean(paceSamples);

  const unavailableBase: TrainingImpliedHalfAnchor = {
    available: false,
    source: "training_implied_half",
    threshold_pace_s_per_km: thresholdPaceSPerKm,
    half_pace_offset_s_per_km: null,
    durability_penalty_s_per_km: null,
    no_race_anchor_safety_penalty_s_per_km: null,
    implied_half_pace_s_per_km: null,
    implied_half_time_s: null,
    confidence_cap: cfg.max_confidence_without_race_anchor,
    evidence_workouts: evidenceWorkouts,
    endurance_gate: enduranceGate,
    notes,
  };

  if (input.weeksFound < cfg.min_weeks_found) {
    notes.push(
      `Недостаточно недель подготовки (${input.weeksFound}/${cfg.min_weeks_found}).`,
    );
    return unavailableBase;
  }
  if (evidenceWorkouts.length < cfg.min_usable_threshold_workouts) {
    notes.push(
      `Мало пригодных темповых блоков (${evidenceWorkouts.length}/${cfg.min_usable_threshold_workouts}).`,
    );
    return unavailableBase;
  }
  if (!enduranceGate.passed) {
    notes.push("Не пройден endurance gate для half.");
    return unavailableBase;
  }
  if (thresholdPaceSPerKm === null) {
    notes.push("Не удалось оценить пороговый темп из segment evidence.");
    return unavailableBase;
  }

  const thresholdPaceMinPerKm = thresholdPaceSPerKm / 60;
  const roughImpliedFinishS = paceMinPerKmToSeconds(thresholdPaceMinPerKm, distanceKm);
  const halfPaceOffsetSPerKm = lookupHalfPaceOffsetSeconds(roughImpliedFinishS);
  const durabilityPenaltySPerKm = cfg.durability_penalty_seconds_per_km[enduranceGate.status];
  const noRaceAnchorSafetyPenaltySPerKm = cfg.no_race_anchor_safety_penalty_s_per_km;
  const impliedHalfPaceSPerKm =
    thresholdPaceSPerKm +
    halfPaceOffsetSPerKm +
    durabilityPenaltySPerKm +
    noRaceAnchorSafetyPenaltySPerKm;
  const impliedHalfTimeS = Math.round(impliedHalfPaceSPerKm * distanceKm);

  notes.push(
    `Пороговый темп ${formatPaceText(thresholdPaceMinPerKm)} + offset ${halfPaceOffsetSPerKm} с/км + durability ${durabilityPenaltySPerKm} с/км + no-race-anchor safety ${noRaceAnchorSafetyPenaltySPerKm} с/км.`,
  );
  notes.push(
    `Implied half: ${formatDurationFromSeconds(impliedHalfTimeS)} (${formatPaceText(impliedHalfPaceSPerKm / 60)}).`,
  );
  if (evidenceWorkouts.length < cfg.preferred_usable_threshold_workouts) {
    notes.push(
      `Меньше предпочтительного числа темповых тренировок (${evidenceWorkouts.length}/${cfg.preferred_usable_threshold_workouts}) — уверенность ограничена.`,
    );
  }

  return {
    available: true,
    source: "training_implied_half",
    threshold_pace_s_per_km: Math.round(thresholdPaceSPerKm),
    half_pace_offset_s_per_km: halfPaceOffsetSPerKm,
    durability_penalty_s_per_km: durabilityPenaltySPerKm,
    no_race_anchor_safety_penalty_s_per_km: noRaceAnchorSafetyPenaltySPerKm,
    implied_half_pace_s_per_km: Math.round(impliedHalfPaceSPerKm),
    implied_half_time_s: impliedHalfTimeS,
    confidence_cap: cfg.max_confidence_without_race_anchor,
    evidence_workouts: evidenceWorkouts,
    endurance_gate: enduranceGate,
    notes,
  };
}
