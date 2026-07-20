// Personal norm primitives (design doc "3. B. Персональная норма").
//
// Norm is MEDIAN + MAD, never mean: one broken sensor must not move the norm,
// and the median is inert to it. Spread is measured as MAD (median absolute
// deviation about the median), the robust sibling of standard deviation.
//
// The MAD guard is the addition to Igor's flat thresholds: a signal must clear
// max(flat threshold, 2×MAD). It changes outcomes — for an athlete whose rep
// pace MAD is 18 s/km, a +21 s/km delta sits at 1.2 MAD (inside her ordinary
// spread) and is silenced, whereas a +36 s/km delta (2×MAD) speaks.

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Median absolute deviation about the median. null for <2 points (a single
 *  point has no spread — the matcher's min-points gates keep this from being
 *  called on too-thin data, but null is handled defensively downstream). */
export function mad(values: number[]): number | null {
  if (values.length < 2) return null;
  const med = median(values);
  if (med === null) return null;
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

/** The effective threshold a delta must clear: the larger of Igor's flat
 *  threshold and 2×MAD. When MAD is unknown (too few points) only the flat
 *  threshold applies. */
export function effectiveThreshold(flatThreshold: number, madValue: number | null): number {
  if (madValue === null || !Number.isFinite(madValue)) return flatThreshold;
  return Math.max(flatThreshold, 2 * madValue);
}

/** Median of the finite entries of a per-rep array (rep_paces / rep_peak_hrs /
 *  rep_recovery_drops), or null if none are usable. Optionally drops the first
 *  `skipLeading` reps (HR lags at the start of work — see pulse-anomaly.ts). */
export function medianOfReps(
  reps: Array<number | null> | null | undefined,
  skipLeading = 0
): number | null {
  if (!Array.isArray(reps)) return null;
  const usable = reps.slice(skipLeading).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return median(usable);
}
