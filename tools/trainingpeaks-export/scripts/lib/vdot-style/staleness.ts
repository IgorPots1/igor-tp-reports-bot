import {
  VDOT_STYLE_STALENESS_MODERATE_MARGIN_SEC_PER_KM,
  VDOT_STYLE_STALENESS_STRONG_MARGIN_SEC_PER_KM,
  VDOT_STYLE_STALENESS_THRESHOLD_DAYS,
} from "./constants.ts";
import type { TrainingZones } from "./zones.ts";
type StalenessEligibleSource = "official_best" | "probable_best" | "clean_training_best" | "training_implied_anchor" | "none";

export type VdotStyleStalenessSegment = {
  date: string;
  title: string | null;
  observed_pace_text: string;
  observed_pace_seconds_per_km: number;
  margin_sec_per_km_faster_than_threshold: number;
  signal_strength: "strong" | "moderate";
  classification_summary: string;
};

export type VdotStyleStaleness = {
  flagged: boolean;
  reason: string | null;
  anchor_age_days: number | null;
  recent_segments_used: VdotStyleStalenessSegment[];
  notes: string[];
};

export type VdotStyleStalenessWorkout = {
  date: string;
  title: string | null;
  segment_evidence_available: boolean;
  usable_for_prediction?: boolean;
  verdict?: string;
  evidence_source?: string;
  work_avg_pace?: string | null;
  segment_matching?: {
    fit_lap_candidate?: {
      candidate_work_avg_pace?: string | null;
      confidence?: string;
    } | null;
  };
};

function parsePaceTextToSecondsPerKm(paceText: string | null): number | null {
  if (!paceText) return null;
  const match = paceText.match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function daysBetween(fromDate: string, toDate: string): number {
  const fromMs = Date.parse(`${fromDate}T12:00:00Z`);
  const toMs = Date.parse(`${toDate}T12:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)));
}

function observedPaceFromWorkout(
  workout: VdotStyleStalenessWorkout,
): { paceText: string; paceSecondsPerKm: number } | null {
  const paceText =
    workout.work_avg_pace ??
    workout.segment_matching?.fit_lap_candidate?.candidate_work_avg_pace ??
    null;
  const paceSecondsPerKm = parsePaceTextToSecondsPerKm(paceText);
  if (!paceText || paceSecondsPerKm === null) return null;
  return { paceText, paceSecondsPerKm };
}

function isReliableForStaleness(workout: VdotStyleStalenessWorkout): boolean {
  if (!workout.segment_evidence_available) return false;
  if (workout.usable_for_prediction !== true) return false;
  if (workout.verdict === "warning" || workout.verdict === "unavailable") return false;

  const source = workout.evidence_source;
  if (source === "fit_lap_candidate") return true;
  if (source === "segment_comparison") {
    return workout.verdict === "positive" || workout.verdict === "neutral";
  }
  return false;
}

function classificationSummaryForFastPace(): string {
  return "faster than threshold/interval zones from official anchor";
}

export function detectAnchorStaleness(input: {
  source: StalenessEligibleSource;
  primaryAnchorKind?: string | null;
  anchorDate: string | null;
  referenceDate: string;
  trainingZones: TrainingZones;
  segmentKeyWorkouts: VdotStyleStalenessWorkout[];
}): VdotStyleStaleness {
  const notes: string[] = [];
  const anchorAgeDays =
    input.anchorDate !== null
      ? daysBetween(input.anchorDate, input.referenceDate)
      : null;

  const officialLikeSource =
    input.source === "official_best" ||
    input.primaryAnchorKind === "official_flagged";

  if (!officialLikeSource) {
    return {
      flagged: false,
      reason: null,
      anchor_age_days: anchorAgeDays,
      recent_segments_used: [],
      notes: [
        "Staleness check applies only to official race anchors, not training-implied sources.",
      ],
    };
  }

  if (anchorAgeDays === null) {
    return {
      flagged: false,
      reason: null,
      anchor_age_days: null,
      recent_segments_used: [],
      notes: ["Official anchor date missing — staleness not evaluated."],
    };
  }

  if (anchorAgeDays <= VDOT_STYLE_STALENESS_THRESHOLD_DAYS) {
    return {
      flagged: false,
      reason: null,
      anchor_age_days: anchorAgeDays,
      recent_segments_used: [],
      notes: [
        `Official anchor age ${anchorAgeDays} days is within ${VDOT_STYLE_STALENESS_THRESHOLD_DAYS}-day threshold.`,
      ],
    };
  }

  const thresholdFastEdge = input.trainingZones.threshold.min_pace_sec_per_km;
  const suspiciousSegments: VdotStyleStalenessSegment[] = [];

  const reliableWorkouts = input.segmentKeyWorkouts
    .filter(isReliableForStaleness)
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const workout of reliableWorkouts) {
    const observed = observedPaceFromWorkout(workout);
    if (!observed) continue;

    const marginFaster = thresholdFastEdge - observed.paceSecondsPerKm;
    if (marginFaster <= VDOT_STYLE_STALENESS_MODERATE_MARGIN_SEC_PER_KM) continue;

    const signalStrength =
      marginFaster >= VDOT_STYLE_STALENESS_STRONG_MARGIN_SEC_PER_KM
        ? "strong"
        : "moderate";

    suspiciousSegments.push({
      date: workout.date,
      title: workout.title,
      observed_pace_text: observed.paceText,
      observed_pace_seconds_per_km: observed.paceSecondsPerKm,
      margin_sec_per_km_faster_than_threshold: Math.round(marginFaster),
      signal_strength: signalStrength,
      classification_summary: classificationSummaryForFastPace(),
    });
  }

  const strongCount = suspiciousSegments.filter((s) => s.signal_strength === "strong").length;
  const moderateCount = suspiciousSegments.filter((s) => s.signal_strength === "moderate").length;
  const shouldFlag = strongCount >= 1 || moderateCount >= 2;

  if (!shouldFlag) {
    notes.push(
      `Official anchor is ${anchorAgeDays} days old, but recent segments do not show a strong pace-vs-zones mismatch.`,
    );
    return {
      flagged: false,
      reason: null,
      anchor_age_days: anchorAgeDays,
      recent_segments_used: suspiciousSegments.slice(0, 5),
      notes,
    };
  }

  notes.push(
    `Official anchor is ${anchorAgeDays} days old (>${VDOT_STYLE_STALENESS_THRESHOLD_DAYS} days).`,
  );
  if (strongCount >= 1) {
    notes.push(`${strongCount} recent segment workout(s) are substantially faster than official-anchor threshold zones.`);
  }
  if (moderateCount >= 2) {
    notes.push(`${moderateCount} recent segment workouts show moderate pace-vs-zones mismatch.`);
  }

  return {
    flagged: true,
    reason:
      "Recent prediction-eligible segment workouts are substantially faster than training zones derived from the old official anchor.",
    anchor_age_days: anchorAgeDays,
    recent_segments_used: suspiciousSegments.slice(0, 5),
    notes,
  };
}
