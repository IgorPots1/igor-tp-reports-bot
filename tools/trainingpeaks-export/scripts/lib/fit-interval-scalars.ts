// Interval rep scalars (design doc section 2 + 5c): rep_paces, rep_peak_hrs,
// rep_pace_fade_pct, rep_pace_cv, rep_recovery_drops. Computed ONLY over
// work-classified laps (is_work=true) — the classification itself comes from
// fit-lap-work-detection.ts (detectWorkLaps), not recomputed here.
//
// recovery_drop is relative to each rep's OWN peak (design doc "вшитое
// ограничение" #1) — never an absolute HR threshold, so it means the same
// thing across athletes with very different HR zones.

import { MOVING_SPEED_MIN_MPS } from "./fit-hr-cleaning-constants.ts";
import type { CleanedFitRecord } from "./fit-hr-cleaning.ts";
import { lapDurationSeconds, lapPaceSecPerKm, type NormalizedFitLap } from "./fit-workout-normalization.ts";
import {
  MIN_WORK_REPS_FOR_SCALARS,
  RECOVERY_CAP_S,
  RECOVERY_LAG_S,
  RECOVERY_MIN_GAP_S,
  RECOVERY_STOPPED_FRACTION_MAX,
} from "./fit-scalar-constants.ts";

export type IntervalScalarsResult = {
  repPaces: Array<number | null> | null;
  repPeakHrs: Array<number | null> | null;
  repPaceFadePct: number | null;
  repPaceCv: number | null;
  repRecoveryDrops: Array<number | null> | null;
  warnings: string[];
};

function maxHrInWindow(records: CleanedFitRecord[], startS: number, endS: number): number | null {
  let max: number | null = null;
  for (const r of records) {
    if (r.timeS < startS || r.timeS > endS) continue;
    if (r.heartRateCleaned === null) continue;
    if (max === null || r.heartRateCleaned > max) max = r.heartRateCleaned;
  }
  return max;
}

function minHrInWindowWithStopFlag(
  records: CleanedFitRecord[],
  startS: number,
  endS: number
): { min: number | null; stoppedFraction: number } {
  let min: number | null = null;
  let total = 0;
  let stopped = 0;
  for (const r of records) {
    if (r.timeS < startS || r.timeS > endS) continue;
    total += 1;
    if (r.speedMps !== null && r.speedMps < MOVING_SPEED_MIN_MPS) stopped += 1;
    if (r.heartRateCleaned === null) continue;
    if (min === null || r.heartRateCleaned < min) min = r.heartRateCleaned;
  }
  return { min, stoppedFraction: total > 0 ? stopped / total : 0 };
}

export function computeIntervalScalars(input: {
  laps: NormalizedFitLap[];
  isWorkByLapIndex: Map<number, boolean | null>;
  cleanedRecords: CleanedFitRecord[];
}): IntervalScalarsResult {
  const warnings: string[] = [];
  const workLaps = input.laps
    .filter((l) => input.isWorkByLapIndex.get(l.lapIndex) === true)
    .sort((a, b) => (a.startOffsetS ?? a.lapIndex) - (b.startOffsetS ?? b.lapIndex));

  if (workLaps.length < MIN_WORK_REPS_FOR_SCALARS) {
    warnings.push(
      `rep scalars null: ${workLaps.length} work lap(s) detected, need >=${MIN_WORK_REPS_FOR_SCALARS} (not an interval workout, or work detection found no confident split)`
    );
    return { repPaces: null, repPeakHrs: null, repPaceFadePct: null, repPaceCv: null, repRecoveryDrops: null, warnings };
  }

  const repPaces = workLaps.map((lap) => lapPaceSecPerKm(lap));
  const repPeakHrs: Array<number | null> = [];
  const repRecoveryDrops: Array<number | null> = [];

  workLaps.forEach((lap, i) => {
    const repStart = lap.startOffsetS;
    const durationS = lapDurationSeconds(lap);
    if (repStart === null || durationS === null) {
      repPeakHrs.push(null);
      repRecoveryDrops.push(null);
      warnings.push(`rep ${i}: peak_hr/recovery_drop null — missing lap start offset or duration`);
      return;
    }
    const repEnd = repStart + durationS;

    const peakHr = maxHrInWindow(input.cleanedRecords, repStart, repEnd + RECOVERY_LAG_S);
    repPeakHrs.push(peakHr);

    const nextRepStartS = workLaps[i + 1]?.startOffsetS ?? null;
    const recoveryWindowStart = repEnd + RECOVERY_MIN_GAP_S;
    const recoveryWindowCappedEnd = repEnd + RECOVERY_CAP_S;
    const recoveryWindowEnd =
      nextRepStartS !== null ? Math.min(nextRepStartS, recoveryWindowCappedEnd) : recoveryWindowCappedEnd;

    if (recoveryWindowEnd <= recoveryWindowStart) {
      repRecoveryDrops.push(null);
      warnings.push(`rep ${i}: recovery_drop null — no positive-length recovery window before the next rep`);
      return;
    }

    const { min: recoveryMinHr, stoppedFraction } = minHrInWindowWithStopFlag(
      input.cleanedRecords,
      recoveryWindowStart,
      recoveryWindowEnd
    );
    if (peakHr === null || recoveryMinHr === null) {
      repRecoveryDrops.push(null);
      warnings.push(`rep ${i}: recovery_drop null — no valid cleaned HR in the peak or recovery window`);
      return;
    }
    repRecoveryDrops.push(peakHr - recoveryMinHr);
    if (stoppedFraction > RECOVERY_STOPPED_FRACTION_MAX) {
      warnings.push(
        `rep ${i}: recovery window mostly stopped (speed<${MOVING_SPEED_MIN_MPS}m/s for ${Math.round(stoppedFraction * 100)}% of window) — drop may reflect rest, not active recovery`
      );
    }
  });

  const validPaces = repPaces.filter((p): p is number => p !== null);
  let repPaceFadePct: number | null = null;
  let repPaceCv: number | null = null;
  if (validPaces.length >= MIN_WORK_REPS_FOR_SCALARS) {
    const first = validPaces[0]!;
    const last = validPaces[validPaces.length - 1]!;
    repPaceFadePct = first !== 0 ? ((last - first) / first) * 100 : null;

    const mean = validPaces.reduce((sum, v) => sum + v, 0) / validPaces.length;
    const variance = validPaces.reduce((sum, v) => sum + (v - mean) ** 2, 0) / validPaces.length;
    repPaceCv = mean !== 0 ? (Math.sqrt(variance) / mean) * 100 : null;
  } else {
    warnings.push(
      `rep_pace_fade_pct/rep_pace_cv null: only ${validPaces.length} work lap(s) have a computable pace, need >=${MIN_WORK_REPS_FOR_SCALARS}`
    );
  }

  return { repPaces, repPeakHrs, repPaceFadePct, repPaceCv, repRecoveryDrops, warnings };
}
