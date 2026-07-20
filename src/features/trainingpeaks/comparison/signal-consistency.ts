// Mechanism B — the consistent-picture signal (наряд 2, изменение 3), shared by
// the interval and steady matchers.
//
// Mechanism A: ONE metric cleared Igor's full threshold, in the improvement
// direction → speak (a strong single event).
// Mechanism B: SEVERAL metrics each cleared a SOFT threshold in the improvement
// direction, and NONE worsened past it → speak about the whole picture. Each
// alone is noise; two-or-more agreeing, with nothing contradicting, is a signal
// a coach would mention.
//
// SOFT threshold = HALF the full threshold. Rationale: each metric still shows a
// real (half-meaningful) move; requiring >=2 agreeing AND 0 contradicting makes
// the COMBINATION meaningful even though each single move is sub-threshold. Too
// low → single-bpm noise; too high → the mechanism never fires. The proof
// reports the live fire rate so Igor can retune.

import type { MetricShift } from "./types.ts";

export const SOFT_THRESHOLD_FRACTION = 0.5;
export const MIN_CONSISTENT_METRICS = 2;

export function softThreshold(flatThreshold: number): number {
  return flatThreshold * SOFT_THRESHOLD_FRACTION;
}

/**
 * Classify one metric's move vs its SOFT threshold. `improvementSign` is +1 when
 * a larger value is better (recovery drop, rep count) and −1 when smaller is
 * better (pace, HR, fade, decoupling).
 */
export function classifyShift(delta: number, improvementSign: 1 | -1, soft: number): MetricShift["status"] {
  const improvement = delta * improvementSign; // >0 = toward better
  if (improvement >= soft) return "improved";
  if (improvement <= -soft) return "worsened";
  return "neutral";
}

/**
 * Mechanism B fires when >=2 metrics improved past the soft threshold and NONE
 * worsened past it (consistency: all agreeing point toward improvement; a single
 * contradiction — pace better but HR worse — kills the picture).
 */
export function evaluateMechanismB(shifts: MetricShift[]): { fires: boolean; improved: MetricShift[] } {
  const improved = shifts.filter((s) => s.status === "improved");
  const worsened = shifts.filter((s) => s.status === "worsened");
  return { fires: improved.length >= MIN_CONSISTENT_METRICS && worsened.length === 0, improved };
}
