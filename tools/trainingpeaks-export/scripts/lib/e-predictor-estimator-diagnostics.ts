import { loadEPredictorConstants } from "./e-predictor-constants.ts";
import {
  DISTANCE_PRESETS,
  formatDurationFromSeconds,
  formatPaceText,
  parseDurationToSeconds,
  type DistanceKey,
} from "./race-distance.ts";
import { VDOT_STYLE_STANDARD_DISTANCES } from "./vdot-style/constants.ts";

export type EstimatorStatus =
  | "used_primary"
  | "used_secondary"
  | "diagnostic"
  | "underused"
  | "needs_reconstruction"
  | "not_applicable";

export type PredictionEstimator = {
  kind: string;
  source_date: string | null;
  prediction_time_text: string | null;
  pace_text: string | null;
  status: EstimatorStatus;
  weight_hint: string | null;
  notes: string[];
};

export type ThresholdClusterWorkoutSummary = {
  date: string;
  title: string | null;
  work_avg_pace: string | null;
  work_reps_compared: number | null;
  work_reps_planned: number | null;
};

export type ThresholdClusterDiagnostic = {
  count: number;
  median_pace_text: string | null;
  median_pace_seconds_per_km: number | null;
  workouts: ThresholdClusterWorkoutSummary[];
  status: "underused_due_partial_template_extraction";
  recommendation: string;
};

export type SegmentKeyWorkoutForEstimator = {
  date: string;
  title: string | null;
  role: string;
  segment_evidence_available: boolean;
  usable_for_prediction: boolean;
  work_reps_compared: number | null;
  work_reps_planned: number | null;
  work_avg_pace: string | null;
  completion_ratio: number | null;
  verdict: string;
};

export type RaceResultCandidateForEstimator = {
  date: string;
  title: string | null;
  duration_text: string;
  duration_min: number;
  pace_text: string;
  pace_min_per_km: number;
  distance_km: number;
};

export type RaceResultsProbeForEstimator = {
  distance_results: Partial<
    Record<
      DistanceKey,
      {
        official_best: RaceResultCandidateForEstimator | null;
        probable_best: RaceResultCandidateForEstimator | null;
      }
    >
  >;
};

export type SelectedAnchorForEstimator = {
  kind: string;
  candidate: RaceResultCandidateForEstimator;
  confidence_weight: number;
};

export type PredictionScenarioForEstimator = {
  time_text: string;
  pace_text: string;
  seconds: number;
};

export type EstimatorDiagnosticsResult = {
  estimators: PredictionEstimator[];
  threshold_cluster_diagnostic: ThresholdClusterDiagnostic | null;
  flags: string[];
  coach_notes: string[];
  warnings: string[];
};

const RECENT_HALF_FRESHNESS_DAYS = 56;
const CONSERVATIVE_VS_HALF_PACE_TOLERANCE_SEC_PER_KM = 6;
const THRESHOLD_REPEAT_TITLE_PATTERN =
  /\d+\s*[x×хX]\s*(\d+)\s*(?:мин|min)?/i;
const CURRENT_SHAPE_7X5_TITLE_PATTERN = /7\s*[x×хX]\s*5\s*(?:мин|min)?/i;

function parsePaceTextToSecondsPerKm(paceText: string | null): number | null {
  if (!paceText) return null;
  const match = paceText.match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function riegelProjectTimeSeconds(input: {
  sourceDistanceMeters: number;
  sourceTimeSeconds: number;
  targetDistanceMeters: number;
  exponent: number;
}): number {
  const ratio = input.targetDistanceMeters / input.sourceDistanceMeters;
  return Math.round(input.sourceTimeSeconds * ratio ** input.exponent);
}

function candidateTimeSeconds(candidate: RaceResultCandidateForEstimator): number | null {
  const parsed = parseDurationToSeconds(candidate.duration_text);
  if (parsed !== null) return parsed;
  if (candidate.duration_min > 0) return Math.round(candidate.duration_min * 60);
  if (candidate.pace_min_per_km > 0 && candidate.distance_km > 0) {
    return Math.round(candidate.pace_min_per_km * 60 * candidate.distance_km);
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

function isThresholdRepeatTitle(title: string | null): boolean {
  if (!title) return false;
  const match = title.match(THRESHOLD_REPEAT_TITLE_PATTERN);
  if (!match) return false;
  const repMinutes = Number(match[1]);
  if (!Number.isFinite(repMinutes)) return false;
  return repMinutes >= 8 && repMinutes <= 30;
}

function isPartialRepExtraction(workout: SegmentKeyWorkoutForEstimator): boolean {
  if (workout.work_reps_planned === null || workout.work_reps_planned <= 1) return false;
  if (workout.work_reps_compared === null || workout.work_reps_compared < 1) return false;
  return workout.work_reps_compared < workout.work_reps_planned;
}

function hasSegmentEvidence(workout: SegmentKeyWorkoutForEstimator): boolean {
  return workout.segment_evidence_available && workout.work_avg_pace !== null;
}

function findRecentHalfAnchor(input: {
  raceResultsProbe: RaceResultsProbeForEstimator | null;
  raceDate: string;
}): { candidate: RaceResultCandidateForEstimator; kind: "official_best" | "probable_best" } | null {
  if (!input.raceResultsProbe) return null;
  const halfBucket = input.raceResultsProbe.distance_results.half;
  if (!halfBucket) return null;

  for (const kind of ["official_best", "probable_best"] as const) {
    const candidate = halfBucket[kind];
    if (!candidate) continue;
    const ageDays = daysBetween(candidate.date, input.raceDate);
    if (ageDays < 0 || ageDays > RECENT_HALF_FRESHNESS_DAYS) continue;
    return { candidate, kind };
  }
  return null;
}

function buildOfficialTargetDistanceEstimator(input: {
  targetDistance: DistanceKey;
  primaryAnchor: SelectedAnchorForEstimator | null;
}): PredictionEstimator | null {
  if (!input.primaryAnchor) return null;

  const preset = DISTANCE_PRESETS[input.targetDistance];
  const candidate = input.primaryAnchor.candidate;
  const timeSeconds = candidateTimeSeconds(candidate);
  const distanceDeltaKm = Math.abs(candidate.distance_km - preset.target_km);
  const onTargetDistance = distanceDeltaKm <= 0.15;

  const predictionTimeText =
    onTargetDistance && timeSeconds !== null
      ? formatDurationFromSeconds(timeSeconds)
      : timeSeconds !== null
        ? formatDurationFromSeconds(
            Math.round((timeSeconds / candidate.distance_km) * preset.target_km),
          )
        : candidate.duration_text;

  const kindByDistance: Partial<Record<DistanceKey, string>> = {
    "5k": "official_5k_anchor",
    "10k": "official_10k_anchor",
    half: "official_half_anchor",
    marathon: "official_marathon_anchor",
  };

  return {
    kind: kindByDistance[input.targetDistance] ?? "official_race_anchor",
    source_date: input.primaryAnchor.candidate.date,
    prediction_time_text: predictionTimeText,
    pace_text: input.primaryAnchor.candidate.pace_text,
    status: "used_primary",
    weight_hint: `primary race anchor (${input.primaryAnchor.kind}, weight ~${input.primaryAnchor.confidence_weight.toFixed(2)})`,
    notes: [
      `Официальный/лучший результат на целевой дистанции: ${input.primaryAnchor.candidate.duration_text}.`,
      "Используется как база для likely-сценария E-Predictor v2.",
    ],
  };
}

function buildRecentHalfTo10kEstimator(input: {
  targetDistance: DistanceKey;
  raceDate: string;
  raceResultsProbe: RaceResultsProbeForEstimator | null;
}): PredictionEstimator | null {
  if (input.targetDistance !== "10k") return null;

  const recentHalf = findRecentHalfAnchor({
    raceResultsProbe: input.raceResultsProbe,
    raceDate: input.raceDate,
  });
  if (!recentHalf) return null;

  const sourceTimeSeconds = candidateTimeSeconds(recentHalf.candidate);
  if (sourceTimeSeconds === null) return null;

  const riegel = loadEPredictorConstants().riegel;
  const projectedSeconds = riegelProjectTimeSeconds({
    sourceDistanceMeters: VDOT_STYLE_STANDARD_DISTANCES.half,
    sourceTimeSeconds,
    targetDistanceMeters: VDOT_STYLE_STANDARD_DISTANCES["10k"],
    exponent: riegel.default_exponent,
  });
  const projectedPaceMinPerKm = projectedSeconds / 60 / DISTANCE_PRESETS["10k"].target_km;

  return {
    kind: "recent_half_to_10k",
    source_date: recentHalf.candidate.date,
    prediction_time_text: formatDurationFromSeconds(projectedSeconds),
    pace_text: formatPaceText(projectedPaceMinPerKm),
    status: "diagnostic",
    weight_hint: "diagnostic only — не меняет прогноз",
    notes: [
      "fresh cross-distance anchor",
      `Источник: ${recentHalf.kind}, ${recentHalf.candidate.distance_km} км за ${recentHalf.candidate.duration_text} (${recentHalf.candidate.pace_text}).`,
      `Riegel-проекция half → 10K (exp=${riegel.default_exponent}).`,
    ],
  };
}

function buildCurrentShape7x5Estimator(input: {
  targetDistance: DistanceKey;
  segmentKeyWorkouts: SegmentKeyWorkoutForEstimator[];
}): PredictionEstimator | null {
  if (input.targetDistance !== "10k" && input.targetDistance !== "5k") return null;

  const candidates = input.segmentKeyWorkouts
    .filter(
      (workout) =>
        workout.title !== null &&
        CURRENT_SHAPE_7X5_TITLE_PATTERN.test(workout.title) &&
        hasSegmentEvidence(workout),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  if (candidates.length === 0) return null;

  const best = candidates[0]!;
  const segmentPaceSecPerKm = parsePaceTextToSecondsPerKm(best.work_avg_pace);
  if (segmentPaceSecPerKm === null) return null;

  const segmentToRaceAdjustmentSecPerKm = best.usable_for_prediction ? 16 : 16;
  const impliedPaceSecPerKm = segmentPaceSecPerKm + segmentToRaceAdjustmentSecPerKm;
  const preset = DISTANCE_PRESETS[input.targetDistance];
  const impliedTimeSeconds = Math.round(impliedPaceSecPerKm * preset.target_km);
  const impliedPaceMinPerKm = impliedTimeSeconds / 60 / preset.target_km;

  const repsLabel =
    best.work_reps_compared !== null && best.work_reps_planned !== null
      ? `${best.work_reps_compared}/${best.work_reps_planned} reps`
      : "7/7 reps";

  return {
    kind: "current_shape_7x5",
    source_date: best.date,
    prediction_time_text: formatDurationFromSeconds(impliedTimeSeconds),
    pace_text: formatPaceText(impliedPaceMinPerKm),
    status: best.usable_for_prediction ? "used_secondary" : "diagnostic",
    weight_hint: best.usable_for_prediction
      ? "segment evidence влияет на confidence/notes"
      : "диагностика текущей формы",
    notes: [
      `${best.title ?? "7×5"}: ${repsLabel}, avg ${best.work_avg_pace}.`,
      `Конверсия segment → race pace: +${segmentToRaceAdjustmentSecPerKm} с/км.`,
      best.usable_for_prediction
        ? "Usable segment evidence — учтено в segment-aware модели."
        : "Report-only оценка текущей формы.",
    ],
  };
}

function buildThresholdClusterDiagnostic(input: {
  segmentKeyWorkouts: SegmentKeyWorkoutForEstimator[];
}): ThresholdClusterDiagnostic | null {
  const clusterWorkouts = input.segmentKeyWorkouts.filter((workout) => {
    if (!isThresholdRepeatTitle(workout.title)) return false;
    if (!hasSegmentEvidence(workout)) return false;
    if (workout.usable_for_prediction) return false;
    if (!isPartialRepExtraction(workout)) return false;
    const role = workout.role.toLowerCase();
    return role.includes("threshold") || role.includes("tempo") || role.includes("sub-threshold");
  });

  if (clusterWorkouts.length === 0) return null;

  const paceValues = clusterWorkouts
    .map((workout) => parsePaceTextToSecondsPerKm(workout.work_avg_pace))
    .filter((pace): pace is number => pace !== null);
  const medianPaceSecPerKm = median(paceValues);

  return {
    count: clusterWorkouts.length,
    median_pace_text:
      medianPaceSecPerKm !== null ? formatPaceText(medianPaceSecPerKm / 60) : null,
    median_pace_seconds_per_km: medianPaceSecPerKm,
    workouts: clusterWorkouts
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((workout) => ({
        date: workout.date,
        title: workout.title,
        work_avg_pace: workout.work_avg_pace,
        work_reps_compared: workout.work_reps_compared,
        work_reps_planned: workout.work_reps_planned,
      })),
    status: "underused_due_partial_template_extraction",
    recommendation: "needs arithmetic-consistency / FIT-lap reconstruction",
  };
}

function buildThresholdClusterEstimator(
  cluster: ThresholdClusterDiagnostic | null,
): PredictionEstimator | null {
  if (!cluster) return null;

  const presetNotes = cluster.workouts.slice(0, 6).map((workout) => {
    const reps =
      workout.work_reps_compared !== null && workout.work_reps_planned !== null
        ? `${workout.work_reps_compared}/${workout.work_reps_planned}`
        : "?/?";
    return `${workout.date} · ${workout.title ?? "—"} · ${workout.work_avg_pace ?? "—"} (${reps})`;
  });

  return {
    kind: "threshold_cluster",
    source_date: cluster.workouts[0]?.date ?? null,
    prediction_time_text: null,
    pace_text: cluster.median_pace_text,
    status: "needs_reconstruction",
    weight_hint: "не используется в прогнозе",
    notes: [
      `${cluster.count} threshold-тренировок с частичным извлечением (1/N).`,
      `Median pace: ${cluster.median_pace_text ?? "н/д"}.`,
      cluster.recommendation,
      ...presetNotes,
    ],
  };
}

function assessConservativeVsRecentHalf(input: {
  targetDistance: DistanceKey;
  raceDate: string;
  raceResultsProbe: RaceResultsProbeForEstimator | null;
  conservativeScenario: PredictionScenarioForEstimator;
}): { flags: string[]; coach_notes: string[]; warnings: string[] } {
  const flags: string[] = [];
  const coach_notes: string[] = [];
  const warnings: string[] = [];

  if (input.targetDistance !== "10k") {
    return { flags, coach_notes, warnings };
  }

  const recentHalf = findRecentHalfAnchor({
    raceResultsProbe: input.raceResultsProbe,
    raceDate: input.raceDate,
  });
  if (!recentHalf) {
    return { flags, coach_notes, warnings };
  }

  const conservativePaceSecPerKm = parsePaceTextToSecondsPerKm(input.conservativeScenario.pace_text);
  const halfPaceSecPerKm = parsePaceTextToSecondsPerKm(recentHalf.candidate.pace_text);
  if (conservativePaceSecPerKm === null || halfPaceSecPerKm === null) {
    return { flags, coach_notes, warnings };
  }

  if (conservativePaceSecPerKm >= halfPaceSecPerKm - CONSERVATIVE_VS_HALF_PACE_TOLERANCE_SEC_PER_KM) {
    flags.push("conservative_range_may_be_too_slow_vs_recent_half");
    coach_notes.push(
      "Недавний half поддерживает более быстрый нижний сценарий; conservative стоит проверить.",
    );
  }

  if (halfPaceSecPerKm <= conservativePaceSecPerKm + CONSERVATIVE_VS_HALF_PACE_TOLERANCE_SEC_PER_KM) {
    warnings.push(
      "Консервативный 10K сценарий почти равен свежему half pace — диапазон может быть слишком осторожным.",
    );
  }

  return { flags, coach_notes, warnings };
}

export function buildPredictionEstimatorDiagnostics(input: {
  targetDistance: DistanceKey;
  raceDate: string;
  primaryAnchor: SelectedAnchorForEstimator | null;
  prediction: {
    conservative: PredictionScenarioForEstimator;
  };
  raceResultsProbe: RaceResultsProbeForEstimator | null;
  segmentKeyWorkouts: SegmentKeyWorkoutForEstimator[];
}): EstimatorDiagnosticsResult {
  const estimators: PredictionEstimator[] = [];

  const officialEstimator = buildOfficialTargetDistanceEstimator({
    targetDistance: input.targetDistance,
    primaryAnchor: input.primaryAnchor,
  });
  if (officialEstimator) estimators.push(officialEstimator);

  const recentHalfEstimator = buildRecentHalfTo10kEstimator({
    targetDistance: input.targetDistance,
    raceDate: input.raceDate,
    raceResultsProbe: input.raceResultsProbe,
  });
  if (recentHalfEstimator) estimators.push(recentHalfEstimator);

  const currentShapeEstimator = buildCurrentShape7x5Estimator({
    targetDistance: input.targetDistance,
    segmentKeyWorkouts: input.segmentKeyWorkouts,
  });
  if (currentShapeEstimator) estimators.push(currentShapeEstimator);

  const thresholdCluster = buildThresholdClusterDiagnostic({
    segmentKeyWorkouts: input.segmentKeyWorkouts,
  });
  const thresholdClusterEstimator = buildThresholdClusterEstimator(thresholdCluster);
  if (thresholdClusterEstimator) estimators.push(thresholdClusterEstimator);

  const conservativeAssessment = assessConservativeVsRecentHalf({
    targetDistance: input.targetDistance,
    raceDate: input.raceDate,
    raceResultsProbe: input.raceResultsProbe,
    conservativeScenario: input.prediction.conservative,
  });

  return {
    estimators,
    threshold_cluster_diagnostic: thresholdCluster,
    flags: conservativeAssessment.flags,
    coach_notes: conservativeAssessment.coach_notes,
    warnings: conservativeAssessment.warnings,
  };
}

const ESTIMATOR_KIND_LABELS_RU: Record<string, string> = {
  official_5k_anchor: "Официальный 5K якорь",
  official_10k_anchor: "Официальный 10K якорь",
  official_half_anchor: "Официальный half якорь",
  official_marathon_anchor: "Официальный marathon якорь",
  official_race_anchor: "Официальный race якорь",
  recent_half_to_10k: "Свежий half → 10K (Riegel)",
  current_shape_7x5: "Текущая форма (7×5 мин)",
  threshold_cluster: "Кластер threshold (1/N)",
};

const ESTIMATOR_STATUS_LABELS_RU: Record<EstimatorStatus, string> = {
  used_primary: "основной",
  used_secondary: "вспомогательный",
  diagnostic: "диагностика",
  underused: "недоиспользован",
  needs_reconstruction: "нужна реконструкция",
  not_applicable: "не применимо",
};

export function formatEstimatorBreakdownMarkdown(input: {
  estimators: PredictionEstimator[];
  threshold_cluster_diagnostic: ThresholdClusterDiagnostic | null;
  coach_notes: string[];
  warnings: string[];
}): string[] {
  const lines: string[] = [];
  lines.push("## Estimator breakdown / Из чего сложился прогноз");
  lines.push("");

  if (input.estimators.length === 0) {
    lines.push("- Нет собранных estimator-строк для этого прогона.");
    lines.push("");
    return lines;
  }

  lines.push("| Estimator | Дата | Прогноз | Темп | Статус |");
  lines.push("|---|---|---:|---:|---|");
  for (const estimator of input.estimators) {
    const label = ESTIMATOR_KIND_LABELS_RU[estimator.kind] ?? estimator.kind;
    const statusLabel = ESTIMATOR_STATUS_LABELS_RU[estimator.status] ?? estimator.status;
    lines.push(
      `| ${label} | ${estimator.source_date ?? "—"} | ${estimator.prediction_time_text ?? "—"} | ${estimator.pace_text ?? "—"} | ${statusLabel} |`,
    );
  }
  lines.push("");

  for (const estimator of input.estimators) {
    const label = ESTIMATOR_KIND_LABELS_RU[estimator.kind] ?? estimator.kind;
    lines.push(`### ${label}`);
    if (estimator.weight_hint) {
      lines.push(`- Вес/роль: ${estimator.weight_hint}`);
    }
    for (const note of estimator.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  if (input.threshold_cluster_diagnostic) {
    const cluster = input.threshold_cluster_diagnostic;
    lines.push("### Threshold cluster diagnostic");
    lines.push(`- Count: **${cluster.count}**`);
    lines.push(`- Median pace: **${cluster.median_pace_text ?? "н/д"}**`);
    lines.push(`- Status: **${cluster.status}**`);
    lines.push(`- Recommendation: ${cluster.recommendation}`);
    for (const workout of cluster.workouts.slice(0, 8)) {
      const reps =
        workout.work_reps_compared !== null && workout.work_reps_planned !== null
          ? `${workout.work_reps_compared}/${workout.work_reps_planned}`
          : "?/?";
      lines.push(`  - ${workout.date} · ${workout.title ?? "—"} · ${workout.work_avg_pace ?? "—"} (${reps})`);
    }
    lines.push("");
  }

  for (const warning of input.warnings) {
    lines.push(`> ⚠ ${warning}`);
  }
  for (const note of input.coach_notes) {
    lines.push(`> **Coach note:** ${note}`);
  }
  if (input.warnings.length > 0 || input.coach_notes.length > 0) {
    lines.push("");
  }

  return lines;
}
