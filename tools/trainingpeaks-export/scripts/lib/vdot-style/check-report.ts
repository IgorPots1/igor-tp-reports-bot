import {
  VDOT_STYLE_STANDARD_DISTANCES,
  VDOT_STYLE_VERDICT_THRESHOLDS,
  type VdotStyleDistanceKey,
  type VdotStyleZoneName,
} from "./constants.ts";
import {
  classifySegmentPace,
  type SegmentBoundaryLabel,
  type SegmentClassificationZone,
} from "./classify.ts";
import { buildTrainingImpliedCurrentShapeAnchor } from "./current-shape-anchor.ts";
import { equivalentRaceTimes } from "./equivalency.ts";
import { detectAnchorStaleness, type VdotStyleStaleness } from "./staleness.ts";
import type {
  VdotStyleAnchor,
  VdotStyleComparison,
  VdotStyleEquivalentRaceTimes,
  VdotStyleRaceTime,
  VdotStyleSource,
  VdotStyleSourceQuality,
  VdotStyleTargetPrediction,
  VdotStyleVerdict,
} from "./types.ts";
import { trainingZonesFromAnchor, type TrainingZoneRange, type TrainingZones } from "./zones.ts";
import {
  DISTANCE_PRESETS,
  formatDurationFromSeconds,
  formatPaceText,
  parseDurationToSeconds,
  type DistanceKey,
} from "../race-distance.ts";
import type { TrainingImpliedHalfAnchor } from "../e-predictor-training-implied-half.ts";

export type {
  VdotStyleAnchor,
  VdotStyleComparison,
  VdotStyleEquivalentRaceTimes,
  VdotStyleRaceTime,
  VdotStyleSource,
  VdotStyleSourceQuality,
  VdotStyleVerdict,
} from "./types.ts";

export type VdotStyleTrainingZones = TrainingZones;

export type VdotStyleWorkoutClassification = {
  date: string;
  title: string | null;
  observed_pace_seconds_per_km: number;
  observed_pace_text: string;
  zone: SegmentClassificationZone;
  boundary_label?: SegmentBoundaryLabel;
  nearest_zone: VdotStyleZoneName;
  distance_supported: string[];
  evidence_source: string | null;
  extraction_strategy: string | null;
};

export type VdotStyleSecondarySource = {
  source: "training_implied_current_shape";
  source_quality: "medium" | "low";
  anchor: VdotStyleAnchor;
  equivalent_race_times: VdotStyleEquivalentRaceTimes;
  training_zones: VdotStyleTrainingZones;
  target_distance_prediction: VdotStyleTargetPrediction;
  workout_zone_classification: VdotStyleWorkoutClassification[];
  comparison_to_e_predictor: VdotStyleComparison;
  notes: string[];
};

export type VdotStyleCheck = {
  enabled: true;
  report_only: true;
  source: VdotStyleSource;
  source_quality: VdotStyleSourceQuality;
  anchor: VdotStyleAnchor | null;
  equivalent_race_times: VdotStyleEquivalentRaceTimes | null;
  training_zones: VdotStyleTrainingZones | null;
  target_distance_prediction: VdotStyleTargetPrediction | null;
  comparison_to_e_predictor: VdotStyleComparison | null;
  workout_zone_classification: VdotStyleWorkoutClassification[];
  staleness: VdotStyleStaleness;
  secondary_sources: VdotStyleSecondarySource[];
  notes: string[];
};

type VdotStyleAnchorKind =
  | "official_best"
  | "probable_best"
  | "clean_training_best"
  | "official_flagged"
  | "needs_coach_review";

type VdotStyleRaceAnchor = {
  kind: VdotStyleAnchorKind;
  candidate: {
    date: string;
    distance_bucket: DistanceKey;
    duration_min: number;
    duration_text: string;
    pace_min_per_km: number;
    pace_text: string;
  };
};

type VdotStyleSegmentKeyWorkout = {
  date: string;
  title: string | null;
  segment_evidence_available: boolean;
  usable_for_prediction?: boolean;
  verdict?: string;
  evidence_source?: string;
  extraction_strategy?: string;
  work_avg_pace?: string | null;
  segment_matching?: {
    fit_lap_candidate?: {
      candidate_work_avg_pace?: string | null;
      confidence?: string;
    } | null;
  };
};

type BuildVdotStyleCheckInput = {
  targetDistance: DistanceKey;
  referenceDate: string;
  primaryAnchor: VdotStyleRaceAnchor | null;
  trainingImpliedAnchor: TrainingImpliedHalfAnchor | null;
  ePredictorLikelySeconds: number;
  segmentKeyWorkouts: VdotStyleSegmentKeyWorkout[];
};

const VDOT_EQUIVALENT_DISTANCE_LABELS: Record<VdotStyleDistanceKey, string> = {
  "5k": "5 км",
  "10k": "10 км",
  "15k": "15 км",
  half: "21.1 км",
  marathon: "42.2 км",
};

const VDOT_ZONE_LABELS: Record<VdotStyleZoneName, string> = {
  easy: "Easy",
  marathon: "Marathon",
  threshold: "Threshold",
  interval: "Interval",
  repetition: "Repetition",
};

const VDOT_STYLE_ANCHOR_SOURCES = new Set<VdotStyleSource>([
  "official_best",
  "probable_best",
  "clean_training_best",
]);

function distanceKeyToVdotKey(distance: DistanceKey): VdotStyleDistanceKey {
  return distance;
}

function parsePaceTextToSecondsPerKm(paceText: string | null): number | null {
  if (!paceText) return null;
  const match = paceText.match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatPaceSecondsPerKm(secondsPerKm: number): string {
  const totalSeconds = Math.round(secondsPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/км`;
}

function formatZonePaceRange(range: TrainingZoneRange): string {
  return `${formatPaceSecondsPerKm(range.min_pace_sec_per_km)}–${formatPaceSecondsPerKm(range.max_pace_sec_per_km)}`;
}

function toRaceTimeEstimate(
  distanceKey: VdotStyleDistanceKey,
  equivalents: ReturnType<typeof equivalentRaceTimes>,
): VdotStyleRaceTime {
  const estimate = equivalents[distanceKey];
  return {
    time_seconds: estimate.time_seconds,
    pace_seconds_per_km: estimate.pace_seconds_per_km,
  };
}

function sourceQualityFor(source: VdotStyleSource): VdotStyleSourceQuality {
  switch (source) {
    case "official_best":
      return "high";
    case "probable_best":
      return "medium";
    case "clean_training_best":
    case "training_implied_anchor":
      return "low";
    default:
      return "none";
  }
}

function computeComparisonVerdict(disagreementPct: number): Exclude<VdotStyleVerdict, "no_anchor"> {
  if (disagreementPct <= VDOT_STYLE_VERDICT_THRESHOLDS.agree_max_pct) {
    return "agree";
  }
  if (disagreementPct <= VDOT_STYLE_VERDICT_THRESHOLDS.mild_disagree_max_pct) {
    return "mild_disagree";
  }
  return "strong_disagree";
}

function resolveAnchorSource(input: BuildVdotStyleCheckInput): {
  source: VdotStyleSource;
  anchorDistanceMeters: number;
  anchorTimeSeconds: number;
  anchor: VdotStyleAnchor;
} | null {
  const primaryKind = input.primaryAnchor?.kind;
  if (primaryKind && VDOT_STYLE_ANCHOR_SOURCES.has(primaryKind as VdotStyleSource)) {
    const candidate = input.primaryAnchor!.candidate;
    const distance = distanceKeyToVdotKey(candidate.distance_bucket);
    const anchorTimeSeconds =
      parseDurationToSeconds(candidate.duration_text) ??
      Math.round(candidate.duration_min * 60);
    const anchorDistanceMeters = VDOT_STYLE_STANDARD_DISTANCES[distance];
    const anchorPaceSecondsPerKm = Math.round(candidate.pace_min_per_km * 60);
    return {
      source: primaryKind as VdotStyleSource,
      anchorDistanceMeters,
      anchorTimeSeconds,
      anchor: {
        distance,
        date: candidate.date,
        time_seconds: anchorTimeSeconds,
        pace_seconds_per_km: anchorPaceSecondsPerKm,
        label: DISTANCE_PRESETS[candidate.distance_bucket].label,
      },
    };
  }

  if (input.trainingImpliedAnchor?.available) {
    const implied = input.trainingImpliedAnchor;
    if (
      implied.implied_half_time_s !== null &&
      implied.implied_half_pace_s_per_km !== null
    ) {
      const evidenceDate =
        implied.evidence_workouts
          .map((workout) => workout.date)
          .sort((a, b) => b.localeCompare(a))[0] ?? null;
      return {
        source: "training_implied_anchor",
        anchorDistanceMeters: VDOT_STYLE_STANDARD_DISTANCES.half,
        anchorTimeSeconds: implied.implied_half_time_s,
        anchor: {
          distance: "half",
          date: evidenceDate,
          time_seconds: implied.implied_half_time_s,
          pace_seconds_per_km: implied.implied_half_pace_s_per_km,
          label: "training-implied half",
        },
      };
    }
  }

  return null;
}

function observedPaceFromWorkout(
  workout: VdotStyleSegmentKeyWorkout,
): { paceText: string; paceSecondsPerKm: number } | null {
  const paceText =
    workout.work_avg_pace ??
    workout.segment_matching?.fit_lap_candidate?.candidate_work_avg_pace ??
    null;
  const paceSecondsPerKm = parsePaceTextToSecondsPerKm(paceText);
  if (!paceText || paceSecondsPerKm === null) return null;
  return { paceText, paceSecondsPerKm };
}

function classifyWorkouts(
  workouts: VdotStyleSegmentKeyWorkout[],
  zones: VdotStyleTrainingZones,
): VdotStyleWorkoutClassification[] {
  return workouts
    .filter((workout) => workout.segment_evidence_available)
    .slice(0, 5)
    .flatMap((workout) => {
      const observed = observedPaceFromWorkout(workout);
      if (!observed) return [];
      const classification = classifySegmentPace(observed.paceSecondsPerKm, zones);
      return [{
        date: workout.date,
        title: workout.title,
        observed_pace_seconds_per_km: observed.paceSecondsPerKm,
        observed_pace_text: observed.paceText,
        zone: classification.zone,
        ...(classification.boundary_label ? { boundary_label: classification.boundary_label } : {}),
        nearest_zone: classification.nearest_zone,
        distance_supported: classification.distance_supported,
        evidence_source: workout.evidence_source ?? null,
        extraction_strategy: workout.extraction_strategy ?? null,
      }];
    });
}

type ResolvedAnchorCheck = {
  source: VdotStyleSource;
  source_quality: VdotStyleSourceQuality;
  anchor: VdotStyleAnchor;
  equivalent_race_times: VdotStyleEquivalentRaceTimes;
  training_zones: VdotStyleTrainingZones;
  target_distance_prediction: VdotStyleTargetPrediction;
  comparison_to_e_predictor: VdotStyleComparison;
  workout_zone_classification: VdotStyleWorkoutClassification[];
};

function buildCheckFromResolvedAnchor(input: {
  source: VdotStyleSource;
  sourceQuality?: VdotStyleSourceQuality;
  anchorDistanceMeters: number;
  anchorTimeSeconds: number;
  anchor: VdotStyleAnchor;
  targetDistance: DistanceKey;
  ePredictorLikelySeconds: number;
  segmentKeyWorkouts: VdotStyleSegmentKeyWorkout[];
}): ResolvedAnchorCheck {
  const equivalentsRaw = equivalentRaceTimes(input.anchorDistanceMeters, input.anchorTimeSeconds);
  const equivalentRaceTimesOut = Object.fromEntries(
    (Object.keys(VDOT_STYLE_STANDARD_DISTANCES) as VdotStyleDistanceKey[]).map((distanceKey) => [
      distanceKey,
      toRaceTimeEstimate(distanceKey, equivalentsRaw),
    ]),
  ) as VdotStyleEquivalentRaceTimes;

  const trainingZones = trainingZonesFromAnchor(
    input.anchorDistanceMeters,
    input.anchorTimeSeconds,
  ).zones;
  const targetKey = distanceKeyToVdotKey(input.targetDistance);
  const targetEstimate = equivalentRaceTimesOut[targetKey];
  const targetDistanceKm = DISTANCE_PRESETS[input.targetDistance].target_km;
  const ePredictorLikelyPaceSecondsPerKm = input.ePredictorLikelySeconds / targetDistanceKm;
  const disagreementSecPerKm = Math.abs(
    targetEstimate.pace_seconds_per_km - ePredictorLikelyPaceSecondsPerKm,
  );
  const disagreementPct =
    ePredictorLikelyPaceSecondsPerKm > 0
      ? disagreementSecPerKm / ePredictorLikelyPaceSecondsPerKm
      : 0;

  return {
    source: input.source,
    source_quality: input.sourceQuality ?? sourceQualityFor(input.source),
    anchor: input.anchor,
    equivalent_race_times: equivalentRaceTimesOut,
    training_zones: trainingZones,
    target_distance_prediction: {
      distance: input.targetDistance,
      time_seconds: targetEstimate.time_seconds,
      pace_seconds_per_km: targetEstimate.pace_seconds_per_km,
    },
    comparison_to_e_predictor: {
      e_predictor_likely_time_seconds: input.ePredictorLikelySeconds,
      e_predictor_likely_pace_seconds_per_km: Math.round(ePredictorLikelyPaceSecondsPerKm),
      vdot_style_time_seconds: targetEstimate.time_seconds,
      vdot_style_pace_seconds_per_km: targetEstimate.pace_seconds_per_km,
      disagreement_sec_per_km: Math.round(disagreementSecPerKm),
      disagreement_pct: Math.round(disagreementPct * 10000) / 10000,
      verdict: computeComparisonVerdict(disagreementPct),
    },
    workout_zone_classification: classifyWorkouts(input.segmentKeyWorkouts, trainingZones),
  };
}

function buildSecondarySource(input: {
  targetDistance: DistanceKey;
  ePredictorLikelySeconds: number;
  segmentKeyWorkouts: VdotStyleSegmentKeyWorkout[];
}): VdotStyleSecondarySource | null {
  const implied = buildTrainingImpliedCurrentShapeAnchor({
    targetDistance: input.targetDistance,
    segmentKeyWorkouts: input.segmentKeyWorkouts,
  });
  if (!implied) return null;

  const anchorDistanceMeters = VDOT_STYLE_STANDARD_DISTANCES[implied.anchor.distance];
  const built = buildCheckFromResolvedAnchor({
    source: "training_implied_anchor",
    sourceQuality: implied.source_quality,
    anchorDistanceMeters,
    anchorTimeSeconds: implied.anchor.time_seconds,
    anchor: implied.anchor,
    targetDistance: input.targetDistance,
    ePredictorLikelySeconds: input.ePredictorLikelySeconds,
    segmentKeyWorkouts: input.segmentKeyWorkouts,
  });

  return {
    source: "training_implied_current_shape",
    source_quality: implied.source_quality === "medium" ? "medium" : "low",
    anchor: built.anchor,
    equivalent_race_times: built.equivalent_race_times,
    training_zones: built.training_zones,
    target_distance_prediction: built.target_distance_prediction,
    workout_zone_classification: built.workout_zone_classification,
    comparison_to_e_predictor: built.comparison_to_e_predictor,
    notes: implied.notes,
  };
}

const EMPTY_STALENESS: VdotStyleStaleness = {
  flagged: false,
  reason: null,
  anchor_age_days: null,
  recent_segments_used: [],
  notes: [],
};

export function buildVdotStyleCheck(input: BuildVdotStyleCheckInput): VdotStyleCheck {
  const notes = [
    "Report-only VDOT-style check: эквивалентные результаты и тренировочные зоны не меняют прогноз E-Predictor.",
    "При обнаружении устаревшего официального anchor добавляется диагностическая проверка по текущей форме.",
  ];

  const resolved = resolveAnchorSource(input);
  if (!resolved) {
    return {
      enabled: true,
      report_only: true,
      source: "none",
      source_quality: "none",
      anchor: null,
      equivalent_race_times: null,
      training_zones: null,
      target_distance_prediction: null,
      comparison_to_e_predictor: null,
      workout_zone_classification: [],
      staleness: EMPTY_STALENESS,
      secondary_sources: [],
      notes: [...notes, "Недостаточно надёжного anchor для VDOT-style проверки."],
    };
  }

  const built = buildCheckFromResolvedAnchor({
    source: resolved.source,
    anchorDistanceMeters: resolved.anchorDistanceMeters,
    anchorTimeSeconds: resolved.anchorTimeSeconds,
    anchor: resolved.anchor,
    targetDistance: input.targetDistance,
    ePredictorLikelySeconds: input.ePredictorLikelySeconds,
    segmentKeyWorkouts: input.segmentKeyWorkouts,
  });

  const staleness =
    resolved.source === "training_implied_anchor"
      ? {
          ...EMPTY_STALENESS,
          notes: [
            "Primary VDOT-style source is training-implied — official-anchor staleness check skipped.",
          ],
        }
      : detectAnchorStaleness({
          source: resolved.source,
          primaryAnchorKind: input.primaryAnchor?.kind ?? null,
          anchorDate: resolved.anchor.date,
          referenceDate: input.referenceDate,
          trainingZones: built.training_zones,
          segmentKeyWorkouts: input.segmentKeyWorkouts,
        });

  const secondarySources: VdotStyleSecondarySource[] = [];
  if (staleness.flagged) {
    const secondary = buildSecondarySource({
      targetDistance: input.targetDistance,
      ePredictorLikelySeconds: input.ePredictorLikelySeconds,
      segmentKeyWorkouts: input.segmentKeyWorkouts,
    });
    if (secondary) {
      secondarySources.push(secondary);
      notes.push(
        "Добавлена альтернативная VDOT-style проверка по текущей форме (training_implied_current_shape).",
      );
    } else {
      notes.push(
        "Старый официальный anchor помечен как устаревший, но недостаточно данных для training-implied current-shape проверки.",
      );
    }
  }

  return {
    enabled: true,
    report_only: true,
    source: built.source,
    source_quality: built.source_quality,
    anchor: built.anchor,
    equivalent_race_times: built.equivalent_race_times,
    training_zones: built.training_zones,
    target_distance_prediction: built.target_distance_prediction,
    comparison_to_e_predictor: built.comparison_to_e_predictor,
    workout_zone_classification: built.workout_zone_classification,
    staleness,
    secondary_sources: secondarySources,
    notes,
  };
}

function formatClassificationLine(entry: VdotStyleWorkoutClassification): string {
  const zoneLabel = entry.boundary_label ?? entry.zone;
  const title = entry.title ?? "—";
  return `${entry.date} · ${title} · ${entry.observed_pace_text} → ${zoneLabel}`;
}

function formatAnchorCheckBlock(input: {
  sourceLabel: string;
  anchor: VdotStyleAnchor;
  equivalentRaceTimes: VdotStyleEquivalentRaceTimes;
  trainingZones: VdotStyleTrainingZones;
  comparison: VdotStyleComparison;
  workoutClassification: VdotStyleWorkoutClassification[];
}): string[] {
  const lines: string[] = [];
  const anchorDate = input.anchor.date ? `, ${input.anchor.date}` : "";
  lines.push(
    `Источник: ${input.sourceLabel} — ${input.anchor.label}${anchorDate}, ${formatDurationFromSeconds(input.anchor.time_seconds)}, ${formatPaceSecondsPerKm(input.anchor.pace_seconds_per_km)}`,
  );
  lines.push("");

  lines.push("| Дистанция | Время | Темп |");
  lines.push("|---|---:|---:|");
  for (const distanceKey of ["5k", "10k", "half", "marathon"] as const) {
    const estimate = input.equivalentRaceTimes[distanceKey];
    lines.push(
      `| ${VDOT_EQUIVALENT_DISTANCE_LABELS[distanceKey]} | ${formatDurationFromSeconds(estimate.time_seconds)} | ${formatPaceSecondsPerKm(estimate.pace_seconds_per_km)} |`,
    );
  }
  lines.push("");

  lines.push("| Зона | Темп |");
  lines.push("|---|---:|");
  for (const zoneName of [
    "easy",
    "marathon",
    "threshold",
    "interval",
    "repetition",
  ] as const) {
    lines.push(
      `| ${VDOT_ZONE_LABELS[zoneName]} | ${formatZonePaceRange(input.trainingZones[zoneName])} |`,
    );
  }
  lines.push("");

  lines.push(
    `VDOT-style: ${formatDurationFromSeconds(input.comparison.vdot_style_time_seconds)} (${formatPaceSecondsPerKm(input.comparison.vdot_style_pace_seconds_per_km)}); E-Predictor likely: ${formatDurationFromSeconds(input.comparison.e_predictor_likely_time_seconds)} (${formatPaceText(input.comparison.e_predictor_likely_pace_seconds_per_km / 60)}); расхождение: ${input.comparison.disagreement_sec_per_km} сек/км; verdict: ${input.comparison.verdict}`,
  );
  lines.push("");

  if (input.workoutClassification.length > 0) {
    for (const entry of input.workoutClassification) {
      lines.push(formatClassificationLine(entry));
    }
    lines.push("");
  }

  return lines;
}

export function formatVdotStyleCheckMarkdown(check: VdotStyleCheck): string[] {
  const lines: string[] = [];
  lines.push("## VDOT-style check");
  lines.push("");
  lines.push(
    "Это независимая проверка по эквивалентным результатам и тренировочным зонам. Она не меняет прогноз E-Predictor.",
  );
  lines.push("");

  if (check.source === "none" || !check.anchor) {
    lines.push("Недостаточно надёжного anchor для VDOT-style проверки.");
    lines.push("");
    return lines;
  }

  lines.push(
    ...formatAnchorCheckBlock({
      sourceLabel: check.source,
      anchor: check.anchor,
      equivalentRaceTimes: check.equivalent_race_times!,
      trainingZones: check.training_zones!,
      comparison: check.comparison_to_e_predictor!,
      workoutClassification: check.workout_zone_classification,
    }),
  );

  if (check.staleness.flagged) {
    lines.push("### Проверка актуальности anchor");
    lines.push("");
    lines.push("Официальный anchor может быть устаревшим.");
    lines.push(
      "Причина: текущие рабочие отрезки быстрее зон, рассчитанных от старого результата.",
    );
    lines.push("");
    for (const segment of check.staleness.recent_segments_used) {
      const title = segment.title ?? "—";
      lines.push(
        `- ${segment.date} · ${title} · ${segment.observed_pace_text} → ${segment.classification_summary}`,
      );
    }
    lines.push("");
  }

  for (const secondary of check.secondary_sources) {
    lines.push("### Альтернативная VDOT-style проверка по текущей форме");
    lines.push("");
    lines.push(
      ...formatAnchorCheckBlock({
        sourceLabel: secondary.source,
        anchor: secondary.anchor,
        equivalentRaceTimes: secondary.equivalent_race_times,
        trainingZones: secondary.training_zones,
        comparison: secondary.comparison_to_e_predictor,
        workoutClassification: secondary.workout_zone_classification,
      }),
    );
    lines.push("Не меняет прогноз автоматически.");
    lines.push("");
    for (const note of secondary.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return lines;
}
