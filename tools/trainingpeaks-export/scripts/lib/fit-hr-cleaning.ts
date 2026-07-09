// FIT heart-rate cleaning: the mandatory first step before any HR-derived
// value (design doc section 4). Runs bounds -> slew filter -> Hampel filter
// -> cadence-lock detection, in that order, on a single athlete's records
// stream for one workout.
//
// All thresholds are named constants imported from fit-hr-cleaning-constants.ts
// (see that file for the rationale behind each default) — no magic numbers here.

import {
  HR_FLOOR,
  HR_CEILING_BUFFER,
  HR_CEILING_ABS,
  SLEW_MAX_BPM_S,
  HAMPEL_WIN_S,
  HAMPEL_K,
  CADENCE_LOCK_MIN_S,
  CADENCE_LOCK_BPM_TOL,
  QUALITY_GOOD_PCT,
  QUALITY_DEGRADED_PCT,
  CADENCE_LOCK_UNRELIABLE_PCT,
  MOVING_SPEED_MIN_MPS,
} from "./fit-hr-cleaning-constants.ts";
import type { NormalizedFitRecord } from "./fit-workout-normalization.ts";

export type HrQuality = "good" | "degraded" | "unreliable";

export type CleanedFitRecord = NormalizedFitRecord & {
  heartRateCleaned: number | null; // null if the original HR was dropped/unreliable
  hrDropped: boolean; // true if the original HR reading was discarded (bounds/slew/cadence-lock)
  hrCadenceLocked: boolean; // true if this sample sits inside a cadence-lock window
};

export type HrCleaningResult = {
  records: CleanedFitRecord[];
  pctHrCleaned: number | null; // % of samples with an original HR that were dropped/replaced; null = no HR data at all
  hrQuality: HrQuality | null; // null = no HR data to judge (not the same as "unreliable")
  cadenceLockCoveragePct: number | null; // % of MOVING-time samples inside a cadence-lock window
  hrCeilingUsed: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// observed_max_hr + buffer when the athlete has ingest history; the absolute
// default otherwise. 220 always wins as a sanity cap from above (design doc:
// "Абсолют 220 всегда как sanity-страховка сверху").
function resolveHrCeiling(observedMaxHr: number | null): number {
  if (observedMaxHr !== null && observedMaxHr > 0) {
    return Math.min(observedMaxHr + HR_CEILING_BUFFER, HR_CEILING_ABS);
  }
  return HR_CEILING_ABS;
}

export function cleanHeartRateSeries(input: {
  records: NormalizedFitRecord[];
  // Historical observed max HR for this athlete (e.g. max(laps.max_hr) across
  // prior ingested workouts), or null if there's no history yet.
  observedMaxHr: number | null;
}): HrCleaningResult {
  const { records } = input;
  const n = records.length;
  const hrCeiling = resolveHrCeiling(input.observedMaxHr);

  // Step 1: hard physiological bounds.
  const working: (number | null)[] = records.map((r) => {
    if (r.heartRate === null) return null;
    if (r.heartRate < HR_FLOOR || r.heartRate > hrCeiling) return null;
    return r.heartRate;
  });

  // Step 2: slew filter. Drops single-sample spikes/dips that jump away from
  // the trend and immediately revert — a sustained ramp (real effort change)
  // has the same sign on both sides and is left alone.
  for (let i = 1; i < n - 1; i += 1) {
    const prev = working[i - 1];
    const cur = working[i];
    const next = working[i + 1];
    if (prev === null || cur === null || next === null) continue;
    const dtPrev = records[i]!.timeS - records[i - 1]!.timeS;
    const dtNext = records[i + 1]!.timeS - records[i]!.timeS;
    if (dtPrev <= 0 || dtNext <= 0) continue;
    const slewIn = (cur - prev) / dtPrev;
    const slewOut = (next - cur) / dtNext;
    const isSpike =
      Math.abs(slewIn) > SLEW_MAX_BPM_S &&
      Math.abs(slewOut) > SLEW_MAX_BPM_S &&
      Math.sign(slewIn) !== 0 &&
      Math.sign(slewIn) !== Math.sign(slewOut);
    if (isSpike) {
      working[i] = null;
    }
  }

  // Step 3: Hampel filter (median + MAD) over a +-HAMPEL_WIN_S time window.
  // Replaces (does not drop) an outlier with the local median.
  // O(n^2) window scan: fine for a single workout's record count (a few
  // thousand samples at 1Hz); this is a batch ingest step, not a hot path.
  const hampelOutput = [...working];
  for (let i = 0; i < n; i += 1) {
    if (working[i] === null) continue;
    const windowValues: number[] = [];
    for (let j = 0; j < n; j += 1) {
      if (working[j] === null) continue;
      if (Math.abs(records[j]!.timeS - records[i]!.timeS) <= HAMPEL_WIN_S) {
        windowValues.push(working[j]!);
      }
    }
    if (windowValues.length < 3) continue; // not enough local context to judge
    const med = median(windowValues);
    const scaledMad = 1.4826 * median(windowValues.map((v) => Math.abs(v - med)));
    if (scaledMad > 0 && Math.abs(working[i]! - med) > HAMPEL_K * scaledMad) {
      hampelOutput[i] = med;
    }
  }

  // Step 4: cadence-lock detection. Finds maximal runs of consecutive samples
  // where HR tracks cadence*2 (running: FIT cadence is per-leg rpm) within
  // tolerance; a run lasting >= CADENCE_LOCK_MIN_S is cadence-lock, not
  // coincidence — real HR does not track cadence this tightly this long.
  const cadenceLocked = new Array<boolean>(n).fill(false);
  {
    let runStart = 0;
    for (let i = 0; i <= n; i += 1) {
      const matches =
        i < n &&
        hampelOutput[i] !== null &&
        records[i]!.cadenceRpm !== null &&
        Math.abs(hampelOutput[i]! - records[i]!.cadenceRpm! * 2) <= CADENCE_LOCK_BPM_TOL;
      if (!matches) {
        if (i > runStart) {
          const runDurationS = records[i - 1]!.timeS - records[runStart]!.timeS;
          if (runDurationS >= CADENCE_LOCK_MIN_S) {
            for (let k = runStart; k < i; k += 1) cadenceLocked[k] = true;
          }
        }
        runStart = i + 1;
      }
    }
  }

  const finalCleaned: (number | null)[] = hampelOutput.map((v, i) => (cadenceLocked[i] ? null : v));

  const totalWithOriginalHr = records.filter((r) => r.heartRate !== null).length;
  const droppedOrReplacedCount = records.reduce((acc, r, i) => {
    if (r.heartRate === null) return acc;
    return acc + (finalCleaned[i] !== r.heartRate ? 1 : 0);
  }, 0);
  const pctHrCleaned = totalWithOriginalHr > 0 ? (droppedOrReplacedCount / totalWithOriginalHr) * 100 : null;

  const movingRecords = records.filter((r) => r.speedMps !== null && r.speedMps > MOVING_SPEED_MIN_MPS);
  const movingLockedCount = records.reduce(
    (acc, r, i) => acc + (cadenceLocked[i] && r.speedMps !== null && r.speedMps > MOVING_SPEED_MIN_MPS ? 1 : 0),
    0
  );
  const cadenceLockCoveragePct = movingRecords.length > 0 ? (movingLockedCount / movingRecords.length) * 100 : null;

  let hrQuality: HrQuality | null = null;
  if (totalWithOriginalHr > 0) {
    if (
      (pctHrCleaned !== null && pctHrCleaned > QUALITY_DEGRADED_PCT) ||
      (cadenceLockCoveragePct !== null && cadenceLockCoveragePct > CADENCE_LOCK_UNRELIABLE_PCT)
    ) {
      hrQuality = "unreliable";
    } else if (pctHrCleaned !== null && pctHrCleaned > QUALITY_GOOD_PCT) {
      hrQuality = "degraded";
    } else {
      hrQuality = "good";
    }
  }

  return {
    records: records.map((r, i) => ({
      ...r,
      heartRateCleaned: finalCleaned[i]!,
      hrDropped: r.heartRate !== null && finalCleaned[i] === null,
      hrCadenceLocked: cadenceLocked[i]!,
    })),
    pctHrCleaned,
    hrQuality,
    cadenceLockCoveragePct,
    hrCeilingUsed: hrCeiling,
  };
}

// Cleaned average HR over MOVING samples only (design doc: stopped time would
// drag the average down without reflecting effort).
export function computeCleanedMovingAverageHr(records: CleanedFitRecord[]): number | null {
  const values = records
    .filter((r) => r.heartRateCleaned !== null && r.speedMps !== null && r.speedMps > MOVING_SPEED_MIN_MPS)
    .map((r) => r.heartRateCleaned!);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
