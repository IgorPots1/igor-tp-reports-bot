// Club Mini App — personal-records reconstruction with THREE trust levels.
// Fragile-by-nature, so isolated here with an explicit "when unsure, don't show"
// policy (Stage C, 2026-07-25 spec).
//
//   verified    — laps with pace, CV <= threshold, passed EVERY plausibility check.
//                 Shown everywhere, including club leaderboards.
//   preliminary — plausible but unconfirmable (no pace laps / CV unknown). Shown
//                 ONLY on the owner's own card, never in club tops.
//   hidden      — failed a plausibility check. Shown NOWHERE (not even to owner);
//                 logged with a reason (validate-records.ts / records-validation.md).
//
// No pace laps => at most `preliminary`, never `verified`. There is no
// "narrow distance band => reliable" shortcut anymore.
//
// E-Predictor note: no per-athlete VDOT/threshold anchor is joinable to the
// workout cache at read time (E-Predictor lives in tools/ scripts + config, not a
// per-student column). Per spec we use the fallback: self-consistency — a
// candidate whose implied VDOT is a sharp outlier vs the athlete's OWN records on
// other distances is treated as suspicious (`self_outlier`). See docs/questions.md.

import * as C from "./constants";

export type RecordTrust = "verified" | "preliminary" | "hidden";

/** Future-proofing for probeg.org / coach confirmation (schema only; see club_records migration). */
export type RecordSource = "reconstructed" | "official_protocol" | "coach_confirmed";

export type RecordHiddenReason =
  | "interval"
  | "pace_too_fast"
  | "pause_gap"
  | "lap_distance_mismatch"
  | "self_outlier";

export type RecordDistanceKey = "5k" | "10k" | "21k" | "42k";

export type RecordCandidate = {
  workoutId: string;
  studentId: string;
  studentName: string;
  distanceKey: RecordDistanceKey;
  targetKm: number;
  distanceKm: number;
  durationSeconds: number;
  date: string;
  bandDeltaKm: number;
};

export type WorkoutQuality = {
  hasLaps: boolean;
  hasFit: boolean;
  /** CV of per-lap pace (work laps if any, else all); null if < 3 pace laps. */
  paceCv: number | null;
  lapTimerSumS: number | null;
  lapElapsedSumS: number | null;
  lapDistanceSumM: number | null;
  isInterval: boolean;
};

export type EvaluatedRecord = {
  candidate: RecordCandidate;
  trust: RecordTrust;
  hiddenReason: RecordHiddenReason | null;
  hasLaps: boolean;
  paceCv: number | null;
  source: RecordSource;
};

/** Daniels VDOT from a race result (local copy of src/app/tools/plan/vdot.ts to keep the club isolated). */
export function vdotFromRace(meters: number, seconds: number): number {
  const min = seconds / 60;
  const v = meters / min;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
  return vo2 / pct;
}

function paceSecPerKm(distanceKm: number, seconds: number): number | null {
  if (distanceKm <= 0 || seconds <= 0) {
    return null;
  }
  return seconds / distanceKm;
}

/**
 * Evaluate one candidate against every plausibility check + the trust ladder.
 * `referenceVdot` is the athlete's typical VDOT from OTHER distances (null if
 * unknown → self-outlier check skipped).
 */
export function evaluateCandidate(
  cand: RecordCandidate,
  quality: WorkoutQuality | undefined,
  referenceVdot: number | null
): EvaluatedRecord {
  const base = {
    candidate: cand,
    hasLaps: quality?.hasLaps ?? false,
    paceCv: quality?.paceCv ?? null,
    source: "reconstructed" as RecordSource,
  };

  // --- Plausibility (any fail => hidden) ---

  // Known interval / fartlek structure — not a continuous distance effort.
  if (quality?.isInterval) {
    return { ...base, trust: "hidden", hiddenReason: "interval" };
  }

  // Physically implausible pace (broken record). Ceiling has margin for the strongest club runner.
  const pace = paceSecPerKm(cand.distanceKm, cand.durationSeconds);
  const ceiling = C.CLUB_RECORD_PACE_FLOOR_SEC_PER_KM[cand.distanceKey];
  if (pace !== null && ceiling && pace < ceiling) {
    return { ...base, trust: "hidden", hiddenReason: "pace_too_fast" };
  }

  // Paused effort: elapsed >> moving (timer) → not a continuous run.
  if (
    quality?.lapElapsedSumS &&
    quality?.lapTimerSumS &&
    quality.lapTimerSumS > 0 &&
    quality.lapElapsedSumS / quality.lapTimerSumS > 1 + C.CLUB_RECORD_PAUSE_TOLERANCE
  ) {
    return { ...base, trust: "hidden", hiddenReason: "pause_gap" };
  }

  // Lap distances disagree with the recorded total → broken record / bad GPS.
  if (quality?.lapDistanceSumM && quality.lapDistanceSumM > 0) {
    const lapKm = quality.lapDistanceSumM / 1000;
    const rel = Math.abs(lapKm - cand.distanceKm) / cand.distanceKm;
    if (rel > C.CLUB_RECORD_LAP_DISTANCE_TOLERANCE) {
      return { ...base, trust: "hidden", hiddenReason: "lap_distance_mismatch" };
    }
  }

  // Self-consistency (E-Predictor fallback): implied VDOT far above the athlete's
  // own level from OTHER distances → suspicious.
  if (referenceVdot !== null && pace !== null) {
    const impliedVdot = vdotFromRace(cand.distanceKm * 1000, cand.durationSeconds);
    if (impliedVdot > referenceVdot + C.CLUB_RECORD_SELF_OUTLIER_VDOT_MARGIN) {
      return { ...base, trust: "hidden", hiddenReason: "self_outlier" };
    }
  }

  // --- Trust ladder (passed plausibility) ---
  const target = C.CLUB_RECORD_DISTANCES.find((d) => d.key === cand.distanceKey);
  const canVerify =
    !target?.alwaysPreliminary &&
    (quality?.paceCv ?? null) !== null &&
    (quality?.paceCv as number) <= C.CLUB_RECORD_PACE_CV_RELIABLE;

  return {
    ...base,
    trust: canVerify ? "verified" : "preliminary",
    hiddenReason: null,
  };
}

/**
 * Athlete reference VDOT = median VDOT across their best candidate on EACH OTHER
 * distance (excluding `excludeKey`). Used for the self-outlier check. Returns null
 * when the athlete has no other-distance candidate.
 */
export function referenceVdotForAthlete(
  bestByDistance: Map<RecordDistanceKey, RecordCandidate>,
  excludeKey: RecordDistanceKey
): number | null {
  const vdots: number[] = [];
  for (const [key, cand] of bestByDistance) {
    if (key === excludeKey) {
      continue;
    }
    vdots.push(vdotFromRace(cand.distanceKm * 1000, cand.durationSeconds));
  }
  if (vdots.length === 0) {
    return null;
  }
  vdots.sort((a, b) => a - b);
  const mid = Math.floor(vdots.length / 2);
  return vdots.length % 2 === 0 ? (vdots[mid - 1] + vdots[mid]) / 2 : vdots[mid];
}
