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
// E-Predictor: uses the REAL Daniels VDOT model (src/app/tools/plan/vdot.ts) —
// single source, no local copy. Self-consistency check: a candidate whose implied
// VDOT is a sharp outlier vs the athlete's OWN records on other distances (their
// E-Predictor level) is suspicious (`self_outlier`). A per-athlete threshold anchor
// (tp_zone_snapshots) could tighten this further — see docs/questions.md §9.

// Real Daniels VDOT model (E-Predictor). Single source of truth — no local copy.
import { vdotFromRace } from "@/app/tools/plan/vdot";

import * as C from "./constants";

export type RecordTrust = "verified" | "preliminary" | "hidden";

/**
 * Provenance of a record. reconstructed = built from a training-run segment;
 * race_events / club_races = a real race date (TP calendar scan / student-declared),
 * whose TIME still comes from the matched workout; coach_confirmed / official_protocol
 * = human-authored override. Priority when a date has several: coach_confirmed >
 * official_protocol > race_events > club_races > reconstructed.
 */
export type RecordSource =
  | "reconstructed"
  | "official_protocol"
  | "coach_confirmed"
  | "race_events"
  | "club_races";

export type RecordHiddenReason =
  | "interval"
  | "pace_too_fast"
  | "pause_gap"
  | "lap_distance_mismatch"
  | "self_outlier"
  | "not_running";

export type RecordDistanceKey = "5k" | "10k" | "21k" | "42k";

export type RecordCalcMethod = "best_split" | "whole_workout";

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
  /** How the candidate was built. best_split => distanceKm/durationSeconds are the segment's. */
  calcMethod: RecordCalcMethod;
  /** Full distance of the source workout (whole file), km — for diagnosis. */
  wholeDistanceKm: number;
  /** Present for best_split: continuity stats + lap boundaries INSIDE the segment. */
  segment?: {
    movingS: number;
    elapsedS: number;
    distanceKm: number;
    paceCv: number | null;
    startLap: number;
    endLap: number;
    lapCount: number;
  };
};

/** race = record on a declared race date / coach-confirmed; else a training-run segment. */
export type ClubRecordType = "race" | "training_split";

export type WorkoutQuality = {
  hasLaps: boolean;
  hasFit: boolean;
  /** CV of per-lap pace (work laps if any, else all); null if < 3 pace laps. */
  paceCv: number | null;
  lapTimerSumS: number | null;
  lapElapsedSumS: number | null;
  lapDistanceSumM: number | null;
  isInterval: boolean;
  /** derived_metrics.workout_type ('run'|'bike'|'swim'|…) or null if unknown. */
  workoutType: string | null;
};

export type EvaluatedRecord = {
  candidate: RecordCandidate;
  trust: RecordTrust;
  hiddenReason: RecordHiddenReason | null;
  hasLaps: boolean;
  paceCv: number | null;
  source: RecordSource;
  calcMethod: RecordCalcMethod;
};

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
  const isSplit = cand.calcMethod === "best_split" && cand.segment != null;
  // For best_split, continuity stats come from INSIDE the segment; for whole_workout,
  // from the whole-file lap aggregates.
  const effectivePaceCv = isSplit ? cand.segment!.paceCv : quality?.paceCv ?? null;
  const base = {
    candidate: cand,
    hasLaps: quality?.hasLaps ?? false,
    paceCv: effectivePaceCv,
    source: "reconstructed" as RecordSource,
    calcMethod: cand.calcMethod,
  };

  // --- Plausibility (any fail => hidden) ---

  // Not a continuous RUNNING effort: derived workout_type says non-run (walk / bike
  // / mixed). First layer; the pace ceiling below is the backup.
  if (quality?.workoutType && quality.workoutType !== "run") {
    return { ...base, trust: "hidden", hiddenReason: "not_running" };
  }

  // Known interval / fartlek structure — not a continuous distance effort.
  if (quality?.isInterval) {
    return { ...base, trust: "hidden", hiddenReason: "interval" };
  }

  // Physically implausible pace (broken record). Ceiling has margin for the strongest club runner.
  const pace = paceSecPerKm(cand.distanceKm, cand.durationSeconds);
  const floor = C.CLUB_RECORD_PACE_FLOOR_SEC_PER_KM[cand.distanceKey];
  if (pace !== null && floor && pace < floor) {
    return { ...base, trust: "hidden", hiddenReason: "pace_too_fast" };
  }

  // Too slow to be a running record → walking / mixed (backup to workout_type).
  if (pace !== null && pace > C.CLUB_RECORD_PACE_CEILING_SEC_PER_KM) {
    return { ...base, trust: "hidden", hiddenReason: "not_running" };
  }

  // Paused effort: elapsed >> moving. best_split checks WITHIN the segment; the
  // 10% threshold is unchanged. whole_workout checks the whole file.
  const elapsed = isSplit ? cand.segment!.elapsedS : quality?.lapElapsedSumS ?? 0;
  const moving = isSplit ? cand.segment!.movingS : quality?.lapTimerSumS ?? 0;
  if (elapsed && moving && moving > 0 && elapsed / moving > 1 + C.CLUB_RECORD_PAUSE_TOLERANCE) {
    return { ...base, trust: "hidden", hiddenReason: "pause_gap" };
  }

  // Lap distances disagree with the recorded total → broken record / bad GPS.
  // Only for whole_workout: a best_split segment's distance IS the lap-sum by construction.
  if (!isSplit && quality?.lapDistanceSumM && quality.lapDistanceSumM > 0) {
    const lapKm = quality.lapDistanceSumM / 1000;
    const rel = Math.abs(lapKm - cand.distanceKm) / cand.distanceKm;
    if (rel > C.CLUB_RECORD_LAP_DISTANCE_TOLERANCE) {
      return { ...base, trust: "hidden", hiddenReason: "lap_distance_mismatch" };
    }
  }

  // Self-consistency via the real E-Predictor (Daniels VDOT). Two layers (A2):
  //  1. ABSOLUTE ceiling, applied ALWAYS. A reconstructed split implying a VDOT far
  //     above this club's real level is broken data. This is the backstop the
  //     relative check cannot provide: when the athlete's OTHER distances are ALSO
  //     corrupt-fast (e.g. a 0:26/km "5k"), the reference VDOT is itself garbage and
  //     a relative check is defeated — the absolute ceiling still fires.
  //  2. RELATIVE check vs the athlete's own realistic level from OTHER distances.
  if (pace !== null) {
    const impliedVdot = vdotFromRace(cand.distanceKm * 1000, cand.durationSeconds);
    if (impliedVdot > C.CLUB_RECORD_ABSOLUTE_VDOT_CEILING) {
      return { ...base, trust: "hidden", hiddenReason: "self_outlier" };
    }
    if (referenceVdot !== null && impliedVdot > referenceVdot + C.CLUB_RECORD_SELF_OUTLIER_VDOT_MARGIN) {
      return { ...base, trust: "hidden", hiddenReason: "self_outlier" };
    }
  }

  // --- Trust ladder (passed plausibility) ---
  const target = C.CLUB_RECORD_DISTANCES.find((d) => d.key === cand.distanceKey);
  const canVerify =
    !target?.alwaysPreliminary &&
    effectivePaceCv !== null &&
    effectivePaceCv <= C.CLUB_RECORD_PACE_CV_RELIABLE;

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
    const v = vdotFromRace(cand.distanceKm * 1000, cand.durationSeconds);
    // Skip corrupt-fast neighbours so broken lap data can't poison the reference (A2).
    if (v > C.CLUB_RECORD_MAX_HUMAN_VDOT) {
      continue;
    }
    vdots.push(v);
  }
  if (vdots.length === 0) {
    return null;
  }
  vdots.sort((a, b) => a - b);
  const mid = Math.floor(vdots.length / 2);
  return vdots.length % 2 === 0 ? (vdots[mid - 1] + vdots[mid]) / 2 : vdots[mid];
}
