import { type TrainingPeaksWorkoutRaw } from "../../scripts/lib/trainingpeaks-workout-normalization.ts";
import {
  collectWorkoutText,
  extractWorkoutSummaryMetrics,
  type NumberParser,
} from "./extract-summary.ts";
import { RACE_KEYWORDS_PATTERN, RACE_TEXT_BY_DISTANCE } from "./race-keywords.ts";

export type DataQualityStatus = "clean" | "suspicious" | "excluded";

export type DataQualityWarning =
  | "gps_or_speed_anomaly"
  | "pace_outlier"
  | "speed_summary_inconsistent"
  | "duration_distance_mismatch"
  | "low_confidence_race_result"
  | "distance_near_window_edge"
  | "impossible_summary_metrics"
  | "normalized_speed_mismatch"
  | "implausible_max_speed"
  | "heart_rate_mismatch";

export type HeartRatePeerReference = {
  peer_median_hr: number;
  next_best_hr: number | null;
  hr_gap_vs_median: number;
  hr_gap_vs_next_best: number | null;
};

export type DataQualityDistanceKey = keyof typeof RACE_TEXT_BY_DISTANCE;

export type DataQualityCandidate = {
  workoutId: number;
  date: string;
  distance_bucket: DataQualityDistanceKey;
  pace_min_per_km: number;
  avg_hr: number | null;
  personalRecordCount: number | null;
  raceTypeDuration: unknown | null;
  reasons: string[];
  same_day_event: boolean;
  event_name: string | null;
  event_confidence: number;
  race_signals?: string[];
};

export type DataQualityWindow = {
  target_km: number;
};

export type AssessedCandidateQuality = {
  day_of_week: string;
  heart_rate_peer_reference?: HeartRatePeerReference;
  data_quality_status: DataQualityStatus;
  data_quality_score: number;
  warnings: DataQualityWarning[];
  review_required: boolean;
  can_be_official_best: boolean;
};

const WARNING_PENALTIES: Record<DataQualityWarning, number> = {
  duration_distance_mismatch: 0.25,
  speed_summary_inconsistent: 0.2,
  normalized_speed_mismatch: 0.18,
  gps_or_speed_anomaly: 0.22,
  implausible_max_speed: 0.18,
  pace_outlier: 0.05,
  low_confidence_race_result: 0.12,
  distance_near_window_edge: 0.03,
  impossible_summary_metrics: 1.0,
  heart_rate_mismatch: 0.1,
};

const BASE_BLOCKING_WARNINGS = new Set<DataQualityWarning>([
  "gps_or_speed_anomaly",
  "speed_summary_inconsistent",
  "duration_distance_mismatch",
  "normalized_speed_mismatch",
  "implausible_max_speed",
  "impossible_summary_metrics",
]);

const PACE_OUTLIER_COMPANION_BLOCKERS = new Set<DataQualityWarning>([
  "gps_or_speed_anomaly",
  "speed_summary_inconsistent",
  "duration_distance_mismatch",
  "normalized_speed_mismatch",
  "implausible_max_speed",
  "heart_rate_mismatch",
  "impossible_summary_metrics",
  "low_confidence_race_result",
]);

const IMPOSSIBLE_PACE_MIN_PER_KM: Record<DataQualityDistanceKey, number> = {
  "5k": 2 + 35 / 60,
  "10k": 2 + 40 / 60,
  half: 2 + 45 / 60,
  marathon: 2 + 55 / 60,
};

const DAY_OF_WEEK_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function getDayOfWeekLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return DAY_OF_WEEK_LABELS[date.getUTCDay()] ?? "Unknown";
}

export function isWeekday(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function isPaceOutlierVsPeers(input: {
  candidatePace: number;
  medianPace: number | null;
  nextBestPace: number | null;
}): boolean {
  if (input.nextBestPace !== null) {
    const deltaVsNext = (input.nextBestPace - input.candidatePace) / input.nextBestPace;
    if (deltaVsNext > 0.08) return true;
  }
  if (input.medianPace !== null) {
    const deltaVsMedian = (input.medianPace - input.candidatePace) / input.medianPace;
    if (deltaVsMedian > 0.1) return true;
  }
  return false;
}

function hasRaceLikeText(
  candidate: DataQualityCandidate,
  raw: TrainingPeaksWorkoutRaw | undefined,
): boolean {
  if ((candidate.race_signals?.length ?? 0) > 0) return true;
  const text = raw ? collectWorkoutText(raw) : "";
  if (text && RACE_TEXT_BY_DISTANCE[candidate.distance_bucket].test(text)) return true;
  if (RACE_KEYWORDS_PATTERN.test(text)) return true;
  const prCount = candidate.personalRecordCount;
  if (prCount !== null && prCount > 0) return true;
  if (candidate.raceTypeDuration !== null && candidate.raceTypeDuration !== undefined) return true;
  return false;
}

function hasReasonableSameDayEventConfidence(candidate: DataQualityCandidate): boolean {
  if (!candidate.same_day_event) return false;
  if (candidate.event_confidence < 0.45) return false;
  if (!candidate.event_name?.trim()) return false;
  return true;
}

function isPaceOutlierNonBlocking(
  warnings: Set<DataQualityWarning>,
  candidate: DataQualityCandidate,
): boolean {
  if (!warnings.has("pace_outlier")) return false;
  for (const blocker of PACE_OUTLIER_COMPANION_BLOCKERS) {
    if (warnings.has(blocker)) return false;
  }
  return hasReasonableSameDayEventConfidence(candidate) || !warnings.has("low_confidence_race_result");
}

function isBlockingWarning(
  warning: DataQualityWarning,
  context: {
    hrGapMax: number;
    sameDayEvent: boolean;
    candidate: DataQualityCandidate;
    warnings: Set<DataQualityWarning>;
  },
): boolean {
  if (warning === "pace_outlier") {
    return !isPaceOutlierNonBlocking(context.warnings, context.candidate);
  }
  if (BASE_BLOCKING_WARNINGS.has(warning)) return true;
  if (
    warning === "heart_rate_mismatch" &&
    context.hrGapMax >= 20 &&
    !context.sameDayEvent &&
    context.warnings.has("pace_outlier")
  ) {
    return true;
  }
  return false;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export function assessCandidateDataQuality(input: {
  candidate: DataQualityCandidate;
  raw: TrainingPeaksWorkoutRaw | undefined;
  window: DataQualityWindow;
  rankByPace: number;
  peerCandidates: DataQualityCandidate[];
  medianPace: number | null;
  nextBestPace: number | null;
  nextBestCandidate: DataQualityCandidate | null;
  parseNumber?: NumberParser;
}): AssessedCandidateQuality {
  const { candidate, raw, rankByPace, peerCandidates } = input;
  const metrics = raw ? extractWorkoutSummaryMetrics(raw, input.parseNumber) : null;
  const warnings = new Set<DataQualityWarning>();
  let score = 1.0;

  const dayOfWeek = getDayOfWeekLabel(candidate.date);

  const peerHrValues = peerCandidates
    .map((peer) => peer.avg_hr)
    .filter((value): value is number => value !== null);
  const peerMedianHr = median(peerHrValues);
  const nextBestHr = input.nextBestCandidate?.avg_hr ?? null;
  const candidateHr = candidate.avg_hr ?? metrics?.heartRateAverage ?? null;

  let heartRatePeerReference: HeartRatePeerReference | undefined;
  let hrGapVsMedian = 0;
  let hrGapVsNextBest: number | null = null;
  if (candidateHr !== null && peerMedianHr !== null) {
    hrGapVsMedian = peerMedianHr - candidateHr;
    hrGapVsNextBest = nextBestHr !== null ? nextBestHr - candidateHr : null;
    heartRatePeerReference = {
      peer_median_hr: Math.round(peerMedianHr),
      next_best_hr: nextBestHr !== null ? Math.round(nextBestHr) : null,
      hr_gap_vs_median: Math.round(hrGapVsMedian),
      hr_gap_vs_next_best: hrGapVsNextBest !== null ? Math.round(hrGapVsNextBest) : null,
    };
  }

  const hrGapMax = Math.max(hrGapVsMedian, hrGapVsNextBest ?? 0);

  if (metrics) {
    const {
      distanceMeters,
      totalTimeHours,
      derivedSpeedMps,
      velocityAverage,
      velocityMaximum,
      normalizedSpeedActual,
      heartRateMinimum,
      heartRateMaximum,
      heartRateAverage,
      cadenceAverage,
      cadenceMaximum,
      powerAverage,
      powerMaximum,
    } = metrics;

    if (
      (distanceMeters !== null && distanceMeters <= 0) ||
      (totalTimeHours !== null && totalTimeHours <= 0)
    ) {
      warnings.add("impossible_summary_metrics");
    }
    if (derivedSpeedMps !== null && !Number.isFinite(derivedSpeedMps)) {
      warnings.add("impossible_summary_metrics");
    }

    if (
      velocityAverage !== null &&
      velocityMaximum !== null &&
      velocityAverage > velocityMaximum * 1.01
    ) {
      warnings.add("impossible_summary_metrics");
    }
    if (
      derivedSpeedMps !== null &&
      velocityMaximum !== null &&
      derivedSpeedMps > velocityMaximum * 1.01
    ) {
      warnings.add("impossible_summary_metrics");
    }

    if (
      heartRateAverage !== null &&
      heartRateMaximum !== null &&
      heartRateAverage > heartRateMaximum
    ) {
      warnings.add("impossible_summary_metrics");
    }
    if (
      heartRateMinimum !== null &&
      heartRateAverage !== null &&
      heartRateMinimum > heartRateAverage
    ) {
      warnings.add("impossible_summary_metrics");
    }
    if (
      heartRateMinimum !== null &&
      heartRateMaximum !== null &&
      heartRateMinimum > heartRateMaximum
    ) {
      warnings.add("impossible_summary_metrics");
    }
    if (cadenceAverage !== null && cadenceMaximum !== null && cadenceAverage > cadenceMaximum) {
      warnings.add("impossible_summary_metrics");
    }
    if (powerAverage !== null && powerMaximum !== null && powerAverage > powerMaximum) {
      warnings.add("impossible_summary_metrics");
    }

    if (candidate.pace_min_per_km < IMPOSSIBLE_PACE_MIN_PER_KM[candidate.distance_bucket]) {
      warnings.add("impossible_summary_metrics");
    }

    if (
      derivedSpeedMps !== null &&
      velocityAverage !== null &&
      velocityAverage > 0 &&
      Math.abs(derivedSpeedMps - velocityAverage) / velocityAverage > 0.05
    ) {
      warnings.add("speed_summary_inconsistent");
    }
    if (derivedSpeedMps !== null && normalizedSpeedActual !== null && normalizedSpeedActual > 0) {
      const normalizedDelta = Math.abs(derivedSpeedMps - normalizedSpeedActual) / normalizedSpeedActual;
      if (normalizedDelta > 0.07) {
        warnings.add("normalized_speed_mismatch");
      }
      if (normalizedDelta > 0.15) {
        warnings.add("duration_distance_mismatch");
      }
    }

    if (
      derivedSpeedMps !== null &&
      velocityMaximum !== null &&
      derivedSpeedMps > 0 &&
      velocityMaximum / derivedSpeedMps > 2.2
    ) {
      warnings.add("gps_or_speed_anomaly");
    }
    if (velocityMaximum !== null && velocityMaximum > 8.5) {
      warnings.add("implausible_max_speed");
    }
  }

  if (candidate.reasons.includes("distance_near_window_edge")) {
    warnings.add("distance_near_window_edge");
  }

  const peerCount = peerCandidates.length;
  const paceOutlier =
    peerCount >= 2 &&
    isPaceOutlierVsPeers({
      candidatePace: candidate.pace_min_per_km,
      medianPace: input.medianPace,
      nextBestPace: input.nextBestPace,
    });
  const paceOutlierWeak =
    peerCount < 3 &&
    isPaceOutlierVsPeers({
      candidatePace: candidate.pace_min_per_km,
      medianPace: input.medianPace,
      nextBestPace: input.nextBestPace,
    });

  if (paceOutlier) {
    warnings.add("pace_outlier");
  } else if (paceOutlierWeak) {
    warnings.add("pace_outlier");
  }

  const raceLike = hasRaceLikeText(candidate, raw);
  const exceptionallyFast =
    paceOutlier ||
    paceOutlierWeak ||
    (input.medianPace !== null &&
      (input.medianPace - candidate.pace_min_per_km) / input.medianPace > 0.1);

  if (
    !candidate.same_day_event &&
    !raceLike &&
    exceptionallyFast
  ) {
    warnings.add("low_confidence_race_result");
  }

  if (
    rankByPace <= 1 &&
    isWeekday(candidate.date) &&
    !candidate.same_day_event &&
    !raceLike &&
    (paceOutlier || paceOutlierWeak)
  ) {
    warnings.add("low_confidence_race_result");
  }

  if (
    candidateHr !== null &&
    peerHrValues.length >= 2 &&
    (paceOutlier || paceOutlierWeak || rankByPace <= 1)
  ) {
    const belowMedian = peerMedianHr !== null && hrGapVsMedian >= 12;
    const belowNextBest = hrGapVsNextBest !== null && hrGapVsNextBest >= 15;
    if (belowMedian || belowNextBest) {
      warnings.add("heart_rate_mismatch");
    }
  }

  for (const warning of warnings) {
    score -= WARNING_PENALTIES[warning] ?? 0;
  }
  score = clampScore(score);

  const warningList = [...warnings];
  const blockingContext = {
    hrGapMax,
    sameDayEvent: candidate.same_day_event,
    candidate,
    warnings,
  };
  const hasBlockingWarning = warningList.some((warning) =>
    isBlockingWarning(warning, blockingContext),
  );

  let dataQualityStatus: DataQualityStatus;
  if (warnings.has("impossible_summary_metrics") || score < 0.35) {
    dataQualityStatus = "excluded";
  } else if (score < 0.72 || hasBlockingWarning) {
    dataQualityStatus = "suspicious";
  } else {
    dataQualityStatus = "clean";
  }

  return {
    day_of_week: dayOfWeek,
    heart_rate_peer_reference: heartRatePeerReference,
    data_quality_status: dataQualityStatus,
    data_quality_score: score,
    warnings: warningList,
    review_required: dataQualityStatus === "suspicious",
    can_be_official_best: dataQualityStatus !== "excluded",
  };
}
