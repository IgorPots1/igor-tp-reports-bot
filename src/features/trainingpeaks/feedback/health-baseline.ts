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

// HRV trend (2-3 week) constants — HRV is used ONLY as a direction over time, never a single
// reading. The window is split into a recent half and a prior half; each half needs enough
// points that one noisy night can't move its median.
export const HRV_TREND_WINDOW_DAYS = 21;
export const HRV_TREND_RECENT_DAYS = 7;
export const HRV_TREND_MIN_POINTS_PER_HALF = 4;
export const HRV_TREND_FLAT_BAND_PCT = 5; // |change| below this reads as "flat", not a trend

export type HealthBaseline = {
  metricKey: PlannerHealthMetric["metricKey"];
  medianValue: number;
  sampleCount: number;
  windowDays: number;
};

export type RecentMetricValue = { value: number; date: string; ageDays: number };

export type HrvTrend = {
  direction: "down" | "flat" | "up";
  dropPct: number; // positive = decline (recent median below prior median)
  recentMedian: number;
  priorMedian: number;
  recentCount: number;
  priorCount: number;
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

function isoDaysBetween(earlier: string, later: string): number {
  const a = new Date(`${earlier}T00:00:00Z`).getTime();
  const b = new Date(`${later}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function computeHealthBaseline(input: {
  metrics: PlannerHealthMetric[];
  metricKey: PlannerHealthMetric["metricKey"];
  asOfDate: string;
  windowDays?: number;
  minPoints?: number;
}): HealthBaseline | null {
  const windowDays = input.windowDays ?? DEFAULT_BASELINE_WINDOW_DAYS;
  const minPoints = input.minPoints ?? MIN_BASELINE_POINTS;
  const from = daysBeforeDate(input.asOfDate, windowDays);
  const values = input.metrics
    .filter((m) => m.metricKey === input.metricKey && m.metricDate >= from && m.metricDate < input.asOfDate)
    .map((m) => m.value);

  if (values.length < minPoints) return null;
  return { metricKey: input.metricKey, medianValue: median(values), sampleCount: values.length, windowDays };
}

// Nearest reading in [asOfDate - windowDays, asOfDate], the one closest to asOfDate winning.
// Loosens the old exact-date match: a Garmin RHR/sleep row is often dated the night-of or the
// day before the run, and demanding metricDate === workoutDate silently dropped nearly every
// case (0 RHR/sleep fires in production). windowDays stays SMALL (RHR/sleep are short-horizon
// signals) so we never attribute a stale reading to "today".
export function resolveRecentMetricValue(
  metrics: PlannerHealthMetric[],
  metricKey: PlannerHealthMetric["metricKey"],
  asOfDate: string,
  windowDays: number
): RecentMetricValue | null {
  const from = daysBeforeDate(asOfDate, windowDays);
  let best: RecentMetricValue | null = null;
  for (const m of metrics) {
    if (m.metricKey !== metricKey) continue;
    if (m.metricDate < from || m.metricDate > asOfDate) continue;
    const ageDays = isoDaysBetween(m.metricDate, asOfDate);
    if (best === null || ageDays < best.ageDays) best = { value: m.value, date: m.metricDate, ageDays };
  }
  return best;
}

// HRV as a 2-3 week TREND, never a single reading. Splits a trailing window into a recent half
// (last recentDays) and a prior half; compares medians. A single noisy night can't move a
// median built from a week-plus of points, so this reads the DIRECTION of recovery — the only
// honest way to use HRV (Igor: "разовое значение в вывод НЕ берём, тренд за 2-3 недели читается").
export function computeHrvTrend(input: {
  metrics: PlannerHealthMetric[];
  asOfDate: string;
  windowDays?: number;
  recentDays?: number;
  minPointsPerHalf?: number;
}): HrvTrend | null {
  const windowDays = input.windowDays ?? HRV_TREND_WINDOW_DAYS;
  const recentDays = input.recentDays ?? HRV_TREND_RECENT_DAYS;
  const minPerHalf = input.minPointsPerHalf ?? HRV_TREND_MIN_POINTS_PER_HALF;
  const from = daysBeforeDate(input.asOfDate, windowDays);
  const recentFrom = daysBeforeDate(input.asOfDate, recentDays);

  const inWindow = input.metrics.filter(
    (m) => m.metricKey === "hrv" && m.metricDate >= from && m.metricDate < input.asOfDate
  );
  const recent = inWindow.filter((m) => m.metricDate >= recentFrom).map((m) => m.value);
  const prior = inWindow.filter((m) => m.metricDate < recentFrom).map((m) => m.value);
  if (recent.length < minPerHalf || prior.length < minPerHalf) return null;

  const recentMedian = median(recent);
  const priorMedian = median(prior);
  const dropPct = priorMedian > 0 ? ((priorMedian - recentMedian) / priorMedian) * 100 : 0;
  const direction = dropPct >= HRV_TREND_FLAT_BAND_PCT ? "down" : dropPct <= -HRV_TREND_FLAT_BAND_PCT ? "up" : "flat";
  return { direction, dropPct, recentMedian, priorMedian, recentCount: recent.length, priorCount: prior.length, windowDays };
}

/** Today's value for a metric — latest reading if several share the date
 *  (mirrors recovery-alerts.ts's pickMetricValuesByDate "keep latest" rule,
 *  minus the timestamp tiebreak since PlannerHealthMetric doesn't carry one;
 *  callers pass already-deduped metrics). */
export function resolveMetricValueOnDate(metrics: PlannerHealthMetric[], metricKey: PlannerHealthMetric["metricKey"], date: string): number | null {
  const matches = metrics.filter((m) => m.metricKey === metricKey && m.metricDate === date);
  return matches.length > 0 ? matches[matches.length - 1]!.value : null;
}
