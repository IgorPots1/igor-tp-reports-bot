// One metric's shift vs its personal norm — shared by the interval and steady
// matchers so both apply MAD/threshold semantics identically (наряд 2).
//
// Minimum norm size is 1 point; the MAD guard applies only from 3 points (below
// that, the flat threshold alone — a single past session can't estimate spread).

import { effectiveThreshold, mad, median } from "./norm.ts";
import { classifyShift, softThreshold } from "./signal-consistency.ts";
import type { ComparisonMetric, MetricShift } from "./types.ts";

export const MIN_POINTS = 1;
export const MIN_MAD_POINTS = 3;

/** +1 when a larger value is better (recovery drop, rep count), −1 when smaller
 *  is better (pace, HR, fade, decoupling). */
export const IMPROVEMENT_SIGN: Record<ComparisonMetric, 1 | -1> = {
  rep_pace: -1,
  rep_hr: -1,
  fade: -1,
  recovery: 1,
  rep_count: 1,
  steady_pace: -1,
  avg_hr: -1,
  decoupling: -1,
  hr_sensor: -1,
};

export type BuiltShift = { shift: MetricShift; flatPass: boolean; madKilled: boolean };

/**
 * Build a metric's shift + mechanism-A verdict, or null if no norm forms.
 * `spreadValues` is what the MAD is measured over (recent uses its own pool; old
 * borrows the student's recent width).
 */
export function buildMetricShift(
  metric: ComparisonMetric,
  currentValue: number | null,
  poolValues: number[],
  spreadValues: number[],
  flat: number
): BuiltShift | null {
  if (currentValue === null || poolValues.length < MIN_POINTS) return null;
  const normValue = median(poolValues);
  if (normValue === null) return null;

  const spread = spreadValues.length >= MIN_MAD_POINTS ? mad(spreadValues) : null;
  const sign = IMPROVEMENT_SIGN[metric];
  const delta = currentValue - normValue;
  const improvement = delta * sign;
  const eff = effectiveThreshold(flat, spread);

  return {
    shift: {
      metric,
      before: normValue,
      after: currentValue,
      delta,
      baseN: poolValues.length,
      spread,
      status: classifyShift(delta, sign, softThreshold(flat)),
    },
    flatPass: improvement >= eff, // mechanism A: past the (MAD-guarded) flat threshold
    madKilled: spread !== null && improvement >= flat && improvement < eff,
  };
}

export function metricStrength(shift: MetricShift, flat: number): number {
  return Math.abs(shift.delta * IMPROVEMENT_SIGN[shift.metric]) / flat;
}
