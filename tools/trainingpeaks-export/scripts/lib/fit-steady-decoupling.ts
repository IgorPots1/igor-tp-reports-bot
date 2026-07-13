// Steady-effort decoupling gate + hr_decoupling_pct + steady_duration_s
// (design doc section 5b), and aerobic_ef (design doc section 2 + "вшитые
// ограничения" #2). Mirrors computeDriftFromFitRecords in
// hr-drift-elevation-audit.ts (trim -> steady filter -> split in half by
// count -> speed/hr efficiency per half -> % change), but runs on records
// already cleaned by fit-hr-cleaning.ts instead of raw FIT records.
//
// decoupling_invalid_reason values used here: 'interval_workout' | 'hr_unreliable'
// | 'no_fit_records' | 'too_short' | 'insufficient_valid_points' | 'not_steady'.
// The DB column comment lists 'not_steady'|'too_short'|'interval_workout'|...
// (trailing "..." — non-exhaustive by design), so the extra reasons here are
// intentional, not a schema mismatch.

import { MOVING_SPEED_MIN_MPS } from "./fit-hr-cleaning-constants.ts";
import type { CleanedFitRecord, HrQuality } from "./fit-hr-cleaning.ts";
import {
  COOLDOWN_TRIM_S,
  STEADY_MIN_S,
  STEADY_MIN_VALID_POINTS,
  STEADY_PACE_CV_MAX_PCT,
  WARMUP_TRIM_S,
} from "./fit-scalar-constants.ts";

export type DecouplingResult = {
  decouplingValid: boolean;
  decouplingInvalidReason: string | null;
  hrDecouplingPct: number | null;
  steadyDurationS: number | null;
};

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function computeSteadyDecoupling(input: {
  cleanedRecords: CleanedFitRecord[];
  // true when work-detection found a confident interval split with >=2 work
  // laps (fit-lap-work-detection.ts's method !== 'none') — an interval
  // workout can never be "steady", regardless of what the record stream
  // itself looks like.
  isIntervalWorkout: boolean;
  hrQuality: HrQuality | null;
}): DecouplingResult {
  if (input.isIntervalWorkout) {
    return { decouplingValid: false, decouplingInvalidReason: "interval_workout", hrDecouplingPct: null, steadyDurationS: null };
  }
  if (input.hrQuality === "unreliable") {
    return { decouplingValid: false, decouplingInvalidReason: "hr_unreliable", hrDecouplingPct: null, steadyDurationS: null };
  }

  const records = input.cleanedRecords;
  if (records.length === 0) {
    return { decouplingValid: false, decouplingInvalidReason: "no_fit_records", hrDecouplingPct: null, steadyDurationS: null };
  }

  const totalDurationS = records[records.length - 1]!.timeS;
  const trimStart = WARMUP_TRIM_S;
  const trimEnd = totalDurationS - COOLDOWN_TRIM_S;
  if (trimEnd - trimStart < STEADY_MIN_S) {
    return {
      decouplingValid: false,
      decouplingInvalidReason: "too_short",
      hrDecouplingPct: null,
      steadyDurationS: trimEnd > trimStart ? trimEnd - trimStart : null,
    };
  }

  const steady = records.filter(
    (r) => r.timeS >= trimStart && r.timeS <= trimEnd && r.speedMps !== null && r.speedMps > MOVING_SPEED_MIN_MPS && r.heartRateCleaned !== null
  );
  const steadyDurationS = steady.length > 0 ? steady[steady.length - 1]!.timeS - steady[0]!.timeS : null;

  if (steady.length < STEADY_MIN_VALID_POINTS) {
    return { decouplingValid: false, decouplingInvalidReason: "insufficient_valid_points", hrDecouplingPct: null, steadyDurationS };
  }

  // Not-steady check: a work/rest oscillation the lap-based work-detection
  // tier missed (e.g. a fartlek run with no laps at all).
  const paces = steady.map((r) => 1000 / r.speedMps!);
  const paceMean = mean(paces);
  const paceCv = paceMean !== 0 ? (Math.sqrt(mean(paces.map((p) => (p - paceMean) ** 2))) / paceMean) * 100 : 0;
  if (paceCv > STEADY_PACE_CV_MAX_PCT) {
    return { decouplingValid: false, decouplingInvalidReason: "not_steady", hrDecouplingPct: null, steadyDurationS };
  }

  const mid = Math.floor(steady.length / 2);
  const first = steady.slice(0, mid);
  const second = steady.slice(mid);
  const speed1 = mean(first.map((r) => r.speedMps!));
  const speed2 = mean(second.map((r) => r.speedMps!));
  const hr1 = mean(first.map((r) => r.heartRateCleaned!));
  const hr2 = mean(second.map((r) => r.heartRateCleaned!));
  // Aerobic efficiency: metres per heartbeat. HIGHER = better.
  const eff1 = hr1 > 0 ? speed1 / hr1 : null;
  const eff2 = hr2 > 0 ? speed2 / hr2 : null;

  // SIGN CONVENTION (Friel/TrainingPeaks Pa:Hr, and the only one this codebase
  // uses -- do not flip it):
  //
  //   POSITIVE = efficiency FELL in the second half = HR drifted UP relative to
  //              pace = the athlete faded. This is the BAD direction, and it is
  //              the normal outcome of a long steady run.
  //   NEGATIVE = efficiency IMPROVED in the second half (negative split /
  //              athlete warmed into it). The GOOD direction.
  //
  // This was previously computed as ((eff2/eff1) - 1) * 100, i.e. NEGATED --
  // a fading athlete scored negative and would have been reported as
  // "improved". Verified against live data (Elena Titskaia, 90min long run
  // 2026-07-11): pace slowed 370.9 -> 380.9 s/km AND HR rose 142.1 -> 148.7,
  // i.e. unambiguous fade, which must be POSITIVE. Sign is asserted by tests
  // in check-fit-ingest-pipeline.ts -- keep them.
  const hrDecouplingPct = eff1 !== null && eff2 !== null && eff1 > 0 ? ((eff1 - eff2) / eff1) * 100 : null;

  if (hrDecouplingPct === null) {
    return { decouplingValid: false, decouplingInvalidReason: "insufficient_valid_points", hrDecouplingPct: null, steadyDurationS };
  }

  return { decouplingValid: true, decouplingInvalidReason: null, hrDecouplingPct, steadyDurationS };
}

// aerobic_ef = mean(speed_mps) / avg_hr over the whole (cleaned, moving)
// workout — NOT gated to the steady segment (naряд's explicit formula for
// this stage: "speed_mps / cleaned avg_hr"). Reuses the SAME avgHr stage 3
// already computed and stores in derived_metrics.avg_hr, so the two columns
// never drift apart from independently-filtered populations.
// ef_context_flag is always 'context_dependent' (DB check constraint) —
// this function returns only the bare number, never a verdict.
export function computeAerobicEf(records: CleanedFitRecord[], avgHr: number | null): number | null {
  if (avgHr === null || avgHr <= 0) return null;
  const moving = records.filter((r) => r.heartRateCleaned !== null && r.speedMps !== null && r.speedMps > MOVING_SPEED_MIN_MPS);
  if (moving.length === 0) return null;
  const avgSpeed = mean(moving.map((r) => r.speedMps!));
  return avgSpeed / avgHr;
}
