import {
  loadEPredictorConstants,
  type ConfidenceBand,
} from "./e-predictor-constants.ts";
import {
  isSustainedEffortEligibleForHalf,
  sustainedBlockPaceSecondsPerKm,
  sustainedEvidenceWeight,
  type SustainedEffortCandidate,
} from "./e-predictor-sustained-effort.ts";
import {
  formatDurationFromSeconds,
  formatPaceText,
  paceMinPerKmToSeconds,
} from "./race-distance.ts";

const HALF_DISTANCE_KM = 21.0975;
const PREFERRED_BLOCK_MIN_MIN = 14;
const PREFERRED_BLOCK_MIN_MAX = 30;

export type TrainingImpliedEvidenceKind = "threshold_repeat" | "sustained_effort";

export type TrainingImpliedEvidenceWorkout = {
  date: string;
  title: string | null;
  role: string;
  work_avg_pace: string;
  block_minutes: number | null;
  weight: number;
  evidence_kind: TrainingImpliedEvidenceKind;
  sustained_penalty_s_per_km?: number | null;
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
  sustained_effort_candidate?: SustainedEffortCandidate;
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
  const repeatMatch = title.match(/(\d+)\s*[x×хX]\s*(\d+)/i);
  if (repeatMatch) {
    const minutes = Number(repeatMatch[2]);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }
  const sustainedMatch = title.match(/\b(\d{2,3})\s*мин/i);
  if (sustainedMatch) {
    const minutes = Number(sustainedMatch[1]);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }
  return null;
}

function inferBlockMinutes(workout: SegmentKeyWorkoutLike): number | null {
  const fromTitle = inferBlockMinutesFromTitle(workout.title);
  if (fromTitle !== null) return fromTitle;
  const roleLower = workout.role.toLowerCase();
  if (roleLower.includes("sub-threshold") || roleLower.includes("tempo")) {
    if (roleLower.includes("24")) return 24;
  }
  const sustained = workout.sustained_effort_candidate;
  if (sustained?.duration_seconds != null) {
    return Math.round(sustained.duration_seconds / 60);
  }
  return null;
}

function blockWeight(blockMinutes: number | null, evidenceKind: TrainingImpliedEvidenceKind): number {
  if (evidenceKind === "sustained_effort") {
    const durationSeconds = blockMinutes !== null ? blockMinutes * 60 : null;
    return sustainedEvidenceWeight(durationSeconds);
  }
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

function buildEvidenceWorkout(
  workout: SegmentKeyWorkoutLike,
): TrainingImpliedEvidenceWorkout | null {
  const sustained = workout.sustained_effort_candidate;
  if (isSustainedEffortEligibleForHalf(sustained)) {
    const blockMinutes =
      sustained!.duration_seconds !== null ? Math.round(sustained!.duration_seconds / 60) : null;
    const effectivePaceSeconds = sustainedBlockPaceSecondsPerKm(sustained!);
    return {
      date: workout.date,
      title: workout.title,
      role: workout.role,
      work_avg_pace:
        effectivePaceSeconds !== null
          ? formatPaceText(effectivePaceSeconds / 60)
          : sustained!.pace_text ?? formatPaceText((sustained!.pace_seconds_per_km ?? 0) / 60),
      block_minutes: blockMinutes,
      weight: blockWeight(blockMinutes, "sustained_effort"),
      evidence_kind: "sustained_effort",
      sustained_penalty_s_per_km: sustained!.half_pace_penalty_sec_per_km ?? null,
    };
  }

  if (!workout.usable_for_prediction || !workout.work_avg_pace) return null;
  const roleLower = workout.role.toLowerCase();
  const blockMinutes = inferBlockMinutes(workout);
  const thresholdLike =
    roleLower.includes("threshold") ||
    roleLower.includes("tempo") ||
    roleLower.includes("sub-threshold") ||
    (blockMinutes !== null && blockMinutes >= 10 && blockMinutes <= 30);
  if (!thresholdLike) return null;

  return {
    date: workout.date,
    title: workout.title,
    role: workout.role,
    work_avg_pace: workout.work_avg_pace,
    block_minutes: blockMinutes,
    weight: blockWeight(blockMinutes, "threshold_repeat"),
    evidence_kind: "threshold_repeat",
  };
}

function countEligibleEvidence(segmentKeyWorkouts: SegmentKeyWorkoutLike[]): {
  evidenceWorkouts: TrainingImpliedEvidenceWorkout[];
  sustainedCount: number;
  thresholdCount: number;
  strongSustained: boolean;
} {
  const evidenceWorkouts = segmentKeyWorkouts
    .map((workout) => buildEvidenceWorkout(workout))
    .filter((workout): workout is TrainingImpliedEvidenceWorkout => workout !== null);

  const sustainedCount = evidenceWorkouts.filter(
    (workout) => workout.evidence_kind === "sustained_effort",
  ).length;
  const thresholdCount = evidenceWorkouts.filter(
    (workout) => workout.evidence_kind === "threshold_repeat",
  ).length;
  const sustainedCfg = loadEPredictorConstants().half_marathon.sustained_effort;
  const strongSustained = segmentKeyWorkouts.some((workout) => {
    const sustained = workout.sustained_effort_candidate;
    return (
      isSustainedEffortEligibleForHalf(sustained) &&
      (sustained!.duration_seconds ?? 0) >= sustainedCfg.strong_single_block_min_duration_seconds &&
      (sustained!.confidence === "medium" || sustained!.confidence === "high")
    );
  });

  return { evidenceWorkouts, sustainedCount, thresholdCount, strongSustained };
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

  const { evidenceWorkouts, sustainedCount, thresholdCount, strongSustained } =
    countEligibleEvidence(input.segmentKeyWorkouts);

  for (const workout of input.segmentKeyWorkouts) {
    const sustained = workout.sustained_effort_candidate;
    if (sustained?.available) {
      sustained.used_for_training_implied_anchor = isSustainedEffortEligibleForHalf(sustained);
    }
  }

  const halfPaceSamples = evidenceWorkouts
    .map((workout) => {
      const paceSPerKm = parsePaceTextToSecondsPerKm(workout.work_avg_pace);
      if (paceSPerKm === null) return null;

      if (workout.evidence_kind === "sustained_effort") {
        const penalty = workout.sustained_penalty_s_per_km ?? constants.half_marathon.sustained_effort.default_half_pace_penalty_sec_per_km;
        return { value: paceSPerKm + penalty, weight: workout.weight };
      }

      const thresholdPaceMinPerKm = paceSPerKm / 60;
      const roughImpliedFinishS = paceMinPerKmToSeconds(thresholdPaceMinPerKm, distanceKm);
      const halfPaceOffsetSPerKm = lookupHalfPaceOffsetSeconds(roughImpliedFinishS);
      return { value: paceSPerKm + halfPaceOffsetSPerKm, weight: workout.weight };
    })
    .filter((row): row is { value: number; weight: number } => row !== null);

  const thresholdPaceSamples = evidenceWorkouts
    .map((workout) => {
      const paceSPerKm = parsePaceTextToSecondsPerKm(workout.work_avg_pace);
      if (paceSPerKm === null) return null;
      return { value: paceSPerKm, weight: workout.weight };
    })
    .filter((row): row is { value: number; weight: number } => row !== null);

  const thresholdPaceSPerKm =
    weightedMedian(thresholdPaceSamples) ?? trimmedWeightedMean(thresholdPaceSamples);
  const impliedHalfPaceBeforePenalties =
    weightedMedian(halfPaceSamples) ?? trimmedWeightedMean(halfPaceSamples);

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

  const evidenceCount = evidenceWorkouts.length;
  const passesEvidenceGate =
    evidenceCount >= cfg.min_usable_threshold_workouts ||
    (strongSustained && sustainedCount >= 1 && enduranceGate.passed);

  if (input.weeksFound < cfg.min_weeks_found) {
    notes.push(
      `Недостаточно недель подготовки (${input.weeksFound}/${cfg.min_weeks_found}).`,
    );
    return unavailableBase;
  }
  if (!passesEvidenceGate) {
    notes.push(
      `Мало пригодных темповых/sustained блоков (${evidenceCount}/${cfg.min_usable_threshold_workouts}).`,
    );
    if (sustainedCount > 0) {
      notes.push(`Sustained blocks найдены (${sustainedCount}), но не прошли promotion gate.`);
    }
    return unavailableBase;
  }
  if (!enduranceGate.passed) {
    notes.push("Не пройден endurance gate для half.");
    return unavailableBase;
  }
  if (impliedHalfPaceBeforePenalties === null) {
    notes.push("Не удалось оценить half pace из threshold/sustained evidence.");
    return unavailableBase;
  }

  const durabilityPenaltySPerKm = cfg.durability_penalty_seconds_per_km[enduranceGate.status];
  const noRaceAnchorSafetyPenaltySPerKm = cfg.no_race_anchor_safety_penalty_s_per_km;
  const impliedHalfPaceSPerKm =
    impliedHalfPaceBeforePenalties + durabilityPenaltySPerKm + noRaceAnchorSafetyPenaltySPerKm;
  const impliedHalfTimeS = Math.round(impliedHalfPaceSPerKm * distanceKm);

  const representativeThresholdFinishS =
    thresholdPaceSPerKm !== null
      ? paceMinPerKmToSeconds(thresholdPaceSPerKm / 60, distanceKm)
      : paceMinPerKmToSeconds(impliedHalfPaceBeforePenalties / 60, distanceKm);
  const halfPaceOffsetSPerKm = lookupHalfPaceOffsetSeconds(representativeThresholdFinishS);

  if (sustainedCount > 0) {
    notes.push(
      `${sustainedCount} sustained block(s) + ${thresholdCount} threshold repeat(s) учтены для training-implied half.`,
    );
  } else {
    notes.push(
      `Пороговый темп ${thresholdPaceSPerKm !== null ? formatPaceText(thresholdPaceSPerKm / 60) : "—"} + offset ${halfPaceOffsetSPerKm} с/км.`,
    );
  }
  notes.push(
    `Implied half: ${formatDurationFromSeconds(impliedHalfTimeS)} (${formatPaceText(impliedHalfPaceSPerKm / 60)}) = sustained/threshold conversion + durability ${durabilityPenaltySPerKm} с/км + no-race-anchor safety ${noRaceAnchorSafetyPenaltySPerKm} с/км.`,
  );
  if (evidenceWorkouts.length < cfg.preferred_usable_threshold_workouts) {
    notes.push(
      `Меньше предпочтительного числа темповых тренировок (${evidenceWorkouts.length}/${cfg.preferred_usable_threshold_workouts}) — уверенность ограничена.`,
    );
  }

  return {
    available: true,
    source: "training_implied_half",
    threshold_pace_s_per_km: thresholdPaceSPerKm,
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
