// Personal recovery baseline (C4). No such thing exists anywhere in the repo —
// recovery-alerts.ts uses fixed absolute thresholds (SHORT_SLEEP_THRESHOLD_HOURS
// = 6.5h, LOW_BODY_BATTERY_THRESHOLD = 35 for everyone). This builds a
// per-student rolling MEDIAN instead — robust to outliers by construction — over
// a trailing window that EXCLUDES the workout date itself (the baseline is
// "normal for this student", not "today folded into its own norm").
//
// Window defaults to 30 days (the plan's "~14-30д" upper bound): more points
// makes the median more stable, and Garmin-sync gaps already thin the sample.

import type { PlannerHealthMetric } from "./types.ts";

export const DEFAULT_BASELINE_WINDOW_DAYS = 30;
export const MIN_BASELINE_POINTS = 5; // judgment call: below this a median is noise, not a norm

export type HealthBaseline = {
  metricKey: PlannerHealthMetric["metricKey"];
  medianValue: number;
  sampleCount: number;
  windowDays: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function daysBeforeDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function computeHealthBaseline(input: {
  metrics: PlannerHealthMetric[];
  metricKey: PlannerHealthMetric["metricKey"];
  asOfDate: string;
  windowDays?: number;
}): HealthBaseline | null {
  const windowDays = input.windowDays ?? DEFAULT_BASELINE_WINDOW_DAYS;
  const from = daysBeforeDate(input.asOfDate, windowDays);
  const values = input.metrics
    .filter((m) => m.metricKey === input.metricKey && m.metricDate >= from && m.metricDate < input.asOfDate)
    .map((m) => m.value);

  if (values.length < MIN_BASELINE_POINTS) return null;
  return { metricKey: input.metricKey, medianValue: median(values), sampleCount: values.length, windowDays };
}

/** Today's value for a metric — latest reading if several share the date
 *  (mirrors recovery-alerts.ts's pickMetricValuesByDate "keep latest" rule,
 *  minus the timestamp tiebreak since PlannerHealthMetric doesn't carry one;
 *  callers pass already-deduped metrics). */
export function resolveMetricValueOnDate(metrics: PlannerHealthMetric[], metricKey: PlannerHealthMetric["metricKey"], date: string): number | null {
  const matches = metrics.filter((m) => m.metricKey === metricKey && m.metricDate === date);
  return matches.length > 0 ? matches[matches.length - 1]!.value : null;
}
