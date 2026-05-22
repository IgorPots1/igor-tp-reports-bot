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
import { equivalentRaceTimes } from "./equivalency.ts";
import { trainingZonesFromAnchor, type TrainingZoneRange } from "./zones.ts";
import {
  DISTANCE_PRESETS,
  formatDurationFromSeconds,
  formatPaceText,
  parseDurationToSeconds,
  type DistanceKey,
} from "../race-distance.ts";
import type { TrainingImpliedHalfAnchor } from "../e-predictor-training-implied-half.ts";

export type VdotStyleSource =
  | "official_best"
  | "probable_best"
  | "clean_training_best"
  | "training_implied_anchor"
  | "none";

export type VdotStyleSourceQuality = "high" | "medium" | "low" | "stale" | "none";

export type VdotStyleVerdict = "agree" | "mild_disagree" | "strong_disagree" | "no_anchor";

export type VdotStyleAnchor = {
  distance: VdotStyleDistanceKey;
  date: string | null;
  time_seconds: number;
  pace_seconds_per_km: number;
  label: string;
};

export type VdotStyleRaceTime = {
  time_seconds: number;
  pace_seconds_per_km: number;
};

export type VdotStyleEquivalentRaceTimes = Record<VdotStyleDistanceKey, VdotStyleRaceTime>;

export type VdotStyleTrainingZones = Record<VdotStyleZoneName, TrainingZoneRange>;

export type VdotStyleComparison = {
  e_predictor_likely_time_seconds: number;
  e_predictor_likely_pace_seconds_per_km: number;
  vdot_style_time_seconds: number;
  vdot_style_pace_seconds_per_km: number;
  disagreement_sec_per_km: number;
  disagreement_pct: number;
  verdict: VdotStyleVerdict;
};

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

export type VdotStyleCheck = {
  enabled: true;
  report_only: true;
  source: VdotStyleSource;
  source_quality: VdotStyleSourceQuality;
  anchor: VdotStyleAnchor | null;
  equivalent_race_times: VdotStyleEquivalentRaceTimes | null;
  training_zones: VdotStyleTrainingZones | null;
  target_distance_prediction: {
    distance: DistanceKey;
    time_seconds: number;
    pace_seconds_per_km: number;
  } | null;
  comparison_to_e_predictor: VdotStyleComparison | null;
  workout_zone_classification: VdotStyleWorkoutClassification[];
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
  work_avg_pace: string | null;
  evidence_source?: string;
  extraction_strategy?: string;
  segment_matching?: {
    fit_lap_candidate?: {
      candidate_work_avg_pace?: string | null;
    } | null;
  };
};

type BuildVdotStyleCheckInput = {
  targetDistance: DistanceKey;
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
  const zoneMap = zones;
  return workouts
    .filter((workout) => workout.segment_evidence_available)
    .slice(0, 5)
    .flatMap((workout) => {
      const observed = observedPaceFromWorkout(workout);
      if (!observed) return [];
      const classification = classifySegmentPace(observed.paceSecondsPerKm, zoneMap);
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

export function buildVdotStyleCheck(input: BuildVdotStyleCheckInput): VdotStyleCheck {
  const notes = [
    "Report-only VDOT-style check: эквивалентные результаты и тренировочные зоны не меняют прогноз E-Predictor.",
    "Phase B: один anchor-источник, без staleness detector и без dual official vs training-implied сравнения.",
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
      notes: [...notes, "Недостаточно надёжного anchor для VDOT-style проверки."],
    };
  }

  const { source, anchorDistanceMeters, anchorTimeSeconds, anchor } = resolved;
  const equivalentsRaw = equivalentRaceTimes(anchorDistanceMeters, anchorTimeSeconds);
  const equivalentRaceTimesOut = Object.fromEntries(
    (Object.keys(VDOT_STYLE_STANDARD_DISTANCES) as VdotStyleDistanceKey[]).map((distanceKey) => [
      distanceKey,
      toRaceTimeEstimate(distanceKey, equivalentsRaw),
    ]),
  ) as VdotStyleEquivalentRaceTimes;

  const trainingZones = trainingZonesFromAnchor(anchorDistanceMeters, anchorTimeSeconds).zones;
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
    enabled: true,
    report_only: true,
    source,
    source_quality: sourceQualityFor(source),
    anchor,
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
    notes,
  };
}

function formatClassificationLine(entry: VdotStyleWorkoutClassification): string {
  const zoneLabel = entry.boundary_label ?? entry.zone;
  const title = entry.title ?? "—";
  return `${entry.date} · ${title} · ${entry.observed_pace_text} → ${zoneLabel}`;
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

  const anchorDate = check.anchor.date ? `, ${check.anchor.date}` : "";
  lines.push(
    `Источник: ${check.source} — ${check.anchor.label}${anchorDate}, ${formatDurationFromSeconds(check.anchor.time_seconds)}, ${formatPaceSecondsPerKm(check.anchor.pace_seconds_per_km)}`,
  );
  lines.push("");

  if (check.equivalent_race_times) {
    lines.push("| Дистанция | Время | Темп |");
    lines.push("|---|---:|---:|");
    for (const distanceKey of ["5k", "10k", "half", "marathon"] as const) {
      const estimate = check.equivalent_race_times[distanceKey];
      lines.push(
        `| ${VDOT_EQUIVALENT_DISTANCE_LABELS[distanceKey]} | ${formatDurationFromSeconds(estimate.time_seconds)} | ${formatPaceSecondsPerKm(estimate.pace_seconds_per_km)} |`,
      );
    }
    lines.push("");
  }

  if (check.training_zones) {
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
        `| ${VDOT_ZONE_LABELS[zoneName]} | ${formatZonePaceRange(check.training_zones[zoneName])} |`,
      );
    }
    lines.push("");
  }

  if (check.comparison_to_e_predictor && check.target_distance_prediction) {
    const comparison = check.comparison_to_e_predictor;
    lines.push(
      `VDOT-style: ${formatDurationFromSeconds(comparison.vdot_style_time_seconds)} (${formatPaceSecondsPerKm(comparison.vdot_style_pace_seconds_per_km)}); E-Predictor likely: ${formatDurationFromSeconds(comparison.e_predictor_likely_time_seconds)} (${formatPaceText(comparison.e_predictor_likely_pace_seconds_per_km / 60)}); расхождение: ${comparison.disagreement_sec_per_km} сек/км; verdict: ${comparison.verdict}`,
    );
    lines.push("");
  }

  if (check.workout_zone_classification.length > 0) {
    for (const entry of check.workout_zone_classification) {
      lines.push(formatClassificationLine(entry));
    }
    lines.push("");
  }

  return lines;
}
