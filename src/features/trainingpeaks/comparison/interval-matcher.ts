// Tier 1 / Tier 2 interval matcher (design doc "2. A" + "3. B" + "4. C").
//
// Scope of this наряд: intervals only. Tier 1 = exact structure key (compare
// everything: median rep pace, rep HR, fade, recovery). Tier 2 = equivalent
// structure (rep length ±10%, rep count ±1, both single-block) — compare ONLY
// median rep pace and rep HR (fade/volume differ between 7 and 8 reps and are
// NOT comparable). Steady/long runs (tier 3) are a separate, riskier наряд.
//
// The ladder is structural: the FIRST tier with a structural match wins. If the
// exact key has appeared before, we stay at tier 1 even when its norm is too
// thin to speak — we do NOT silently drop to tier 2. Whether tier 2 SHOULD
// rescue a thin tier-1 norm is an open question (design doc п. Игоря); the
// matcher measures how often that happens (poolCounts) rather than deciding it.

import { isSingleBlockKey, parseComparisonKey } from "./comparison-key.ts";
import { effectiveThreshold, mad, median, medianOfReps } from "./norm.ts";
import {
  OLD_MODE_MIN_AGE_DAYS,
  SLIDING_WINDOW_DAYS,
  daysBetween,
} from "./resolve-window.ts";
import type { DerivedRowForComparison } from "./types.ts";

// Igor's flat thresholds (design doc "4. C"). Each is also guarded by 2×MAD.
export const PACE_THRESHOLD_SEC = 10; // s/km
export const HR_THRESHOLD_BPM = 5; // bpm
export const FADE_THRESHOLD_PP = 5; // percentage points
export const RECOVERY_THRESHOLD_BPM = 5; // bpm
// Rep HR is only comparable "при сопоставимом темпе": if the pace itself moved
// by ≥10 s/km, a HR difference is expected and says nothing on its own.
export const COMPARABLE_PACE_MAX_DELTA_SEC = 10;

export const MIN_POINTS_RECENT = 3; // "свежее ≥3"
export const MIN_POINTS_OLD = 2; // "давнее ≥2"
export const MIN_REPS_FOR_INTERVAL = 2;

export type IntervalMetric = "rep_pace" | "rep_hr" | "fade" | "recovery";
export type NormMode = "recent" | "old";

export type MetricEval = {
  metric: IntervalMetric;
  mode: NormMode;
  before: number; // norm value (median of the pool)
  after: number; // current workout value
  delta: number; // after - before
  baseN: number; // points in the norm
  mad: number | null; // spread of the norm (for "old", taken from recent points)
  flatThreshold: number;
  effectiveThreshold: number;
  igorPass: boolean; // |delta| >= flat threshold
  fired: boolean; // |delta| >= effective threshold (post MAD guard)
  suppressed: "hr_untrusted" | "pace_not_comparable" | null;
};

export type IntervalMatchResult = {
  evaluated: boolean; // a keyable interval run with usable rep data
  key: string | null;
  tier: 1 | 2 | null; // chosen tier; null = no structural comparable at all
  hadStructuralComparable: boolean;
  metricEvals: MetricEval[]; // metrics whose norm reached min points
  recentPool: DerivedRowForComparison[]; // chosen-tier rows in the sliding window
  oldPool: DerivedRowForComparison[]; // chosen-tier rows older than 6 weeks
  // Anchor-metric (rep_pace) pool sizes, for the tier-2-rescue-potential stat.
  poolCounts: { tier1RecentN: number; tier1OldN: number; tier2RecentN: number; tier2OldN: number };
};

/** The single reason a workout stayed silent (or that it fired), for the proof
 *  harness's four-way silence taxonomy (design doc п. Игоря). Only meaningful on
 *  evaluated interval runs. */
export type MatchOutcome = "fired" | "mad_killed" | "below_threshold" | "norm_not_met" | "no_comparable";

export function classifyMatchOutcome(match: IntervalMatchResult): MatchOutcome {
  const unsuppressed = match.metricEvals.filter((e) => e.suppressed === null);
  if (unsuppressed.some((e) => e.fired)) return "fired";
  if (unsuppressed.some((e) => e.igorPass)) return "mad_killed";
  if (unsuppressed.length > 0) return "below_threshold";
  if (match.hadStructuralComparable) return "norm_not_met";
  return "no_comparable";
}

type Recency = "recent" | "old";

function tierOfMatch(currentKey: string, historyKey: string): 1 | 2 | null {
  if (historyKey === currentKey) return 1;
  const cur = parseComparisonKey(currentKey);
  const his = parseComparisonKey(historyKey);
  if (!isSingleBlockKey(cur) || !isSingleBlockKey(his)) return null;
  const c = cur!.blocks[0]!;
  const h = his!.blocks[0]!;
  const cs = c.steps[0]!;
  const hs = h.steps[0]!;
  if (cs.unit !== hs.unit) return null;
  const lenWithin10 = Math.abs(cs.len - hs.len) <= 0.1 * Math.max(cs.len, hs.len);
  const countWithin1 = Math.abs(c.repeat - h.repeat) <= 1;
  return lenWithin10 && countWithin1 ? 2 : null;
}

function recencyOf(currentDate: string, rowDate: string): Recency | null {
  const age = daysBetween(rowDate, currentDate); // >0 = row is older than current
  if (age <= 0) return null; // same day or future — not history
  // Bands overlap by design (доклад: свежее ≤8 нед, давнее >6 нед): a point
  // 43–56 days old feeds both norms. A single point can be both recent and old.
  const isRecent = age <= SLIDING_WINDOW_DAYS;
  const isOld = age > OLD_MODE_MIN_AGE_DAYS;
  if (isRecent && isOld) return "recent"; // primary tag; old-ness re-derived below
  if (isRecent) return "recent";
  if (isOld) return "old";
  return null;
}

function metricValue(row: DerivedRowForComparison, metric: IntervalMetric): number | null {
  switch (metric) {
    case "rep_pace":
      return medianOfReps(row.repPaces);
    case "rep_hr":
      return medianOfReps(row.repPeakHrs);
    case "fade":
      return typeof row.repPaceFadePct === "number" && Number.isFinite(row.repPaceFadePct)
        ? row.repPaceFadePct
        : null;
    case "recovery":
      return medianOfReps(row.repRecoveryDrops);
  }
}

function flatThresholdFor(metric: IntervalMetric): number {
  switch (metric) {
    case "rep_pace":
      return PACE_THRESHOLD_SEC;
    case "rep_hr":
      return HR_THRESHOLD_BPM;
    case "fade":
      return FADE_THRESHOLD_PP;
    case "recovery":
      return RECOVERY_THRESHOLD_BPM;
  }
}

/**
 * Compare one "current" interval run against the student's history. History is
 * the student's OTHER run derived rows (any date); this function does the tier
 * selection, windowing, norm building and MAD guard. Pure.
 */
export function matchIntervalWorkout(input: {
  current: DerivedRowForComparison;
  history: DerivedRowForComparison[];
}): IntervalMatchResult {
  const { current } = input;
  const empty: IntervalMatchResult = {
    evaluated: false,
    key: current.comparisonKey,
    tier: null,
    hadStructuralComparable: false,
    metricEvals: [],
    recentPool: [],
    oldPool: [],
    poolCounts: { tier1RecentN: 0, tier1OldN: 0, tier2RecentN: 0, tier2OldN: 0 },
  };

  if (
    current.workoutType !== "run" ||
    !current.comparisonKey ||
    (current.repsDetectedCount ?? 0) < MIN_REPS_FOR_INTERVAL
  ) {
    return empty;
  }

  // Tag every history row by tier + recency, keeping only structural comparables.
  type Tagged = { row: DerivedRowForComparison; tier: 1 | 2; recency: Recency; alsoOld: boolean };
  const tagged: Tagged[] = [];
  for (const row of input.history) {
    if (row.workoutType !== "run" || !row.comparisonKey) continue;
    if (row.workoutId === current.workoutId) continue;
    const tier = tierOfMatch(current.comparisonKey, row.comparisonKey);
    if (tier === null) continue;
    const recency = recencyOf(current.workoutDate, row.workoutDate);
    if (recency === null) continue;
    const age = daysBetween(row.workoutDate, current.workoutDate);
    tagged.push({ row, tier, recency, alsoOld: age > OLD_MODE_MIN_AGE_DAYS });
  }

  const anchorHasPace = (row: DerivedRowForComparison) => metricValue(row, "rep_pace") !== null;
  const poolCounts = {
    tier1RecentN: tagged.filter((t) => t.tier === 1 && t.recency === "recent" && anchorHasPace(t.row)).length,
    tier1OldN: tagged.filter((t) => t.tier === 1 && t.alsoOld && anchorHasPace(t.row)).length,
    tier2RecentN: tagged.filter((t) => t.tier === 2 && t.recency === "recent" && anchorHasPace(t.row)).length,
    tier2OldN: tagged.filter((t) => t.tier === 2 && t.alsoOld && anchorHasPace(t.row)).length,
  };

  const hasTier1 = tagged.some((t) => t.tier === 1);
  const chosenTier: 1 | 2 | null = hasTier1 ? 1 : tagged.some((t) => t.tier === 2) ? 2 : null;
  if (chosenTier === null) {
    return { ...empty, evaluated: true, hadStructuralComparable: false };
  }

  const pool = tagged.filter((t) => t.tier === chosenTier);
  const recentRows = pool.filter((t) => t.recency === "recent").map((t) => t.row);
  const oldRows = pool.filter((t) => t.alsoOld).map((t) => t.row);

  // Tier 1 compares everything; tier 2 only the count-independent metrics.
  const metrics: IntervalMetric[] = chosenTier === 1 ? ["rep_pace", "rep_hr", "fade", "recovery"] : ["rep_pace", "rep_hr"];

  const hrUntrusted = current.hrTrusted === false || current.hrQuality === "unreliable";

  const metricEvals: MetricEval[] = [];

  const evalMetric = (metric: IntervalMetric, mode: NormMode, poolRows: DerivedRowForComparison[]): void => {
    const currentValue = metricValue(current, metric);
    if (currentValue === null) return;

    const poolValues = poolRows
      .map((r) => metricValue(r, metric))
      .filter((v): v is number => v !== null);
    const minPoints = mode === "recent" ? MIN_POINTS_RECENT : MIN_POINTS_OLD;
    if (poolValues.length < minPoints) return;

    const normValue = median(poolValues);
    if (normValue === null) return;

    // Spread: recent uses its own MAD; old borrows the student's recent width
    // (his own "ширина нормы" is known better than a 2-point old cluster's).
    let spread: number | null;
    if (mode === "recent") {
      spread = mad(poolValues);
    } else {
      const recentValues = recentRows
        .map((r) => metricValue(r, metric))
        .filter((v): v is number => v !== null);
      spread = recentValues.length >= 2 ? mad(recentValues) : null;
    }

    const delta = currentValue - normValue;
    const flat = flatThresholdFor(metric);
    const eff = effectiveThreshold(flat, spread);

    // hr_untrusted is decided here; pace-comparability (the other suppression
    // reason) needs the same mode's rep_pace eval, so it is applied in a second
    // pass once all evals exist.
    const suppressed: MetricEval["suppressed"] = metric === "rep_hr" && hrUntrusted ? "hr_untrusted" : null;

    metricEvals.push({
      metric,
      mode,
      before: normValue,
      after: currentValue,
      delta,
      baseN: poolValues.length,
      mad: spread,
      flatThreshold: flat,
      effectiveThreshold: eff,
      igorPass: Math.abs(delta) >= flat,
      fired: Math.abs(delta) >= eff,
      suppressed,
    });
  };

  for (const metric of metrics) {
    evalMetric(metric, "recent", recentRows);
    evalMetric(metric, "old", oldRows);
  }

  // Second pass for rep_hr comparability: HR is only comparable at the same
  // pace. Suppress rep_hr in a mode when that mode's rep_pace delta is ≥10 s/km.
  for (const hrEval of metricEvals) {
    if (hrEval.metric !== "rep_hr" || hrEval.suppressed) continue;
    const paceEval = metricEvals.find((e) => e.metric === "rep_pace" && e.mode === hrEval.mode);
    if (!paceEval || Math.abs(paceEval.delta) >= COMPARABLE_PACE_MAX_DELTA_SEC) {
      hrEval.suppressed = "pace_not_comparable";
    }
  }

  return {
    evaluated: true,
    key: current.comparisonKey,
    tier: chosenTier,
    hadStructuralComparable: true,
    metricEvals,
    recentPool: recentRows,
    oldPool: oldRows,
    poolCounts,
  };
}
