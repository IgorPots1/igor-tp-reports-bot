import {
  VDOT_STYLE_STANDARD_DISTANCES,
  type VdotStyleDistanceKey,
} from "./constants.ts";
import type { DistanceKey } from "../race-distance.ts";
import type { VdotStyleAnchor, VdotStyleSourceQuality } from "./types.ts";
import type { VdotStyleStalenessWorkout } from "./staleness.ts";

function parsePaceTextToSecondsPerKm(paceText: string | null): number | null {
  if (!paceText) return null;
  const match = paceText.match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseRepDurationMinutes(title: string | null): number | null {
  if (!title) return null;
  const match = title.match(/(\d+)\s*(?:х|x)\s*(\d+)\s*мин/i);
  if (match) return Number(match[2]);
  const single = title.match(/(\d+)\s*мин/i);
  if (single) return Number(single[1]);
  return null;
}

function isReliableForCurrentShape(workout: VdotStyleStalenessWorkout): boolean {
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

function paceAdjustmentSecPerKm(input: {
  repDurationMin: number | null;
  evidenceSource?: string;
  fitLapConfidence?: string;
  verdict?: string;
}): { adjustment: number; notes: string[] } {
  const notes: string[] = [];
  let base: number;

  const repMin = input.repDurationMin;
  if (repMin === null) {
    base = 20;
    notes.push("Rep duration unknown — using conservative +20 s/km segment-to-race adjustment.");
  } else if (repMin <= 5) {
    base = 12;
    notes.push(`Short reps (~${repMin} min): segment pace treated as faster than 10K race pace (+12 s/km base).`);
  } else if (repMin <= 8) {
    base = 17;
    notes.push(`6–8 min reps (~${repMin} min): segment treated as threshold/10K support, not race pace (+17 s/km base).`);
  } else if (repMin <= 15) {
    base = 22;
    notes.push(`Longer reps (~${repMin} min): closer to threshold block (+22 s/km base).`);
  } else {
    base = 25;
    notes.push(`Extended reps (~${repMin} min): conservative race conversion (+25 s/km base).`);
  }

  let extra = 0;
  if (input.evidenceSource === "segment_comparison") {
    extra += input.verdict === "neutral" ? 5 : 3;
    notes.push("Segment-comparison evidence — added conservative margin.");
  } else if (input.fitLapConfidence === "low") {
    extra += 4;
    notes.push("FIT-lap confidence low — added +4 s/km.");
  } else if (input.fitLapConfidence === "medium") {
    extra += 2;
    notes.push("FIT-lap confidence medium — added +2 s/km.");
  }

  const adjustment = Math.min(25, Math.max(10, base + extra));
  return { adjustment, notes };
}

export function buildTrainingImpliedCurrentShapeAnchor(input: {
  targetDistance: DistanceKey;
  segmentKeyWorkouts: VdotStyleStalenessWorkout[];
}): {
  anchor: VdotStyleAnchor;
  source_quality: VdotStyleSourceQuality;
  evidence_workout: {
    date: string;
    title: string | null;
    segment_pace_text: string;
    segment_pace_seconds_per_km: number;
    rep_duration_min: number | null;
  };
  notes: string[];
} | null {
  const candidates = input.segmentKeyWorkouts
    .filter(isReliableForCurrentShape)
    .flatMap((workout) => {
      const observed = observedPaceFromWorkout(workout);
      if (!observed) return [];
      return [{ workout, observed }];
    })
    .sort((a, b) => {
      const paceDiff = a.observed.paceSecondsPerKm - b.observed.paceSecondsPerKm;
      if (paceDiff !== 0) return paceDiff;
      return b.workout.date.localeCompare(a.workout.date);
    });

  if (candidates.length === 0) return null;

  const best = candidates[0]!;
  const repDurationMin = parseRepDurationMinutes(best.workout.title);
  const { adjustment, notes: adjustmentNotes } = paceAdjustmentSecPerKm({
    repDurationMin,
    evidenceSource: best.workout.evidence_source,
    fitLapConfidence: best.workout.segment_matching?.fit_lap_candidate?.confidence,
    verdict: best.workout.verdict,
  });

  const impliedPaceSecPerKm = Math.round(best.observed.paceSecondsPerKm + adjustment);
  const vdotDistance: VdotStyleDistanceKey =
    input.targetDistance === "5k" ||
    input.targetDistance === "10k" ||
    input.targetDistance === "15k" ||
    input.targetDistance === "half" ||
    input.targetDistance === "marathon"
      ? input.targetDistance
      : "10k";

  const distanceMeters = VDOT_STYLE_STANDARD_DISTANCES[vdotDistance];
  const impliedTimeSeconds = Math.round((impliedPaceSecPerKm * distanceMeters) / 1000);

  const sourceQuality: VdotStyleSourceQuality =
    best.workout.evidence_source === "fit_lap_candidate" &&
    best.workout.segment_matching?.fit_lap_candidate?.confidence === "medium"
      ? "medium"
      : "low";

  const notes = [
    "Training-implied VDOT-style source is diagnostic only and should be coach-reviewed.",
    `Best recent segment: ${best.workout.date} · ${best.workout.title ?? "—"} · ${best.observed.paceText}.`,
    ...adjustmentNotes,
    `Conservative implied ${vdotDistance} anchor pace: ${Math.floor(impliedPaceSecPerKm / 60)}:${String(impliedPaceSecPerKm % 60).padStart(2, "0")}/km (segment + ${adjustment} s/km).`,
  ];

  return {
    anchor: {
      distance: vdotDistance,
      date: best.workout.date,
      time_seconds: impliedTimeSeconds,
      pace_seconds_per_km: impliedPaceSecPerKm,
      label: `training-implied current shape (${vdotDistance})`,
    },
    source_quality: sourceQuality,
    evidence_workout: {
      date: best.workout.date,
      title: best.workout.title,
      segment_pace_text: best.observed.paceText,
      segment_pace_seconds_per_km: best.observed.paceSecondsPerKm,
      rep_duration_min: repDurationMin,
    },
    notes,
  };
}
