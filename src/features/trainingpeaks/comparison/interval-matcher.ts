// Interval matcher (ярусы 1–2), наряд 2. Produces praise CANDIDATES via three
// mechanisms; focus.ts picks one and pause.ts gates it.
//
// Tier 1 = exact structure key (same length AND count): compare pace, HR, fade,
// recovery. Tier 2 = same rep length (±10%), ANY count: compare pace and HR, and
// rep COUNT joins as a mechanism-B participant and the composite signal —
// fade/volume are NOT comparable across different counts.
//
// Everything here is IMPROVEMENT-directed (наряд 2 reframing: surface progress,
// not regressions).

import { computeComparisonKey, isSingleBlockKey, parseComparisonKey } from "./comparison-key.ts";
import { median, medianOfReps } from "./norm.ts";
import { classifyShift, evaluateMechanismB } from "./signal-consistency.ts";
import { buildMetricShift, metricStrength, MIN_POINTS, type BuiltShift } from "./metric-shift.ts";
import { OLD_MODE_MIN_AGE_DAYS, SLIDING_WINDOW_DAYS, daysBetween } from "./resolve-window.ts";
import type { MatchResult } from "./match-result.ts";
import type { ComparisonMetric, DerivedRowForComparison, MetricShift, PraiseCandidate } from "./types.ts";

export const PACE_THRESHOLD_SEC = 10;
export const HR_THRESHOLD_BPM = 5;
export const FADE_THRESHOLD_PP = 5;
export const RECOVERY_THRESHOLD_BPM = 5;
export const COMPARABLE_PACE_MAX_DELTA_SEC = 10; // rep HR comparable only at comparable pace
export const COUNT_SOFT_MIN = 1; // rep-count is a B participant: +1 rep = "improved"
export const MIN_REPS_FOR_INTERVAL = 2;

const FLAT: Partial<Record<ComparisonMetric, number>> = {
  rep_pace: PACE_THRESHOLD_SEC,
  rep_hr: HR_THRESHOLD_BPM,
  fade: FADE_THRESHOLD_PP,
  recovery: RECOVERY_THRESHOLD_BPM,
};

type Recency = "recent" | "old";

// Tier 2 (наряд 2): same rep length (±10%), ANY count. Igor: "6×4 и 8×4 сравню".
// Different length (7×5 vs 7×4) stays incomparable — the shorter rep is run
// faster, that's duration, not progress.
function tierOfMatch(currentKey: string, historyKey: string): 1 | 2 | null {
  if (historyKey === currentKey) return 1;
  const cur = parseComparisonKey(currentKey);
  const his = parseComparisonKey(historyKey);
  if (!isSingleBlockKey(cur) || !isSingleBlockKey(his)) return null;
  const cs = cur!.blocks[0]!.steps[0]!;
  const hs = his!.blocks[0]!.steps[0]!;
  if (cs.unit !== hs.unit) return null;
  return Math.abs(cs.len - hs.len) <= 0.1 * Math.max(cs.len, hs.len) ? 2 : null;
}

function recencyOf(currentDate: string, rowDate: string): Recency | null {
  const age = daysBetween(rowDate, currentDate);
  if (age <= 0) return null;
  if (age <= SLIDING_WINDOW_DAYS) return "recent";
  if (age > OLD_MODE_MIN_AGE_DAYS) return "old";
  return null;
}

function metricValue(row: DerivedRowForComparison, metric: ComparisonMetric): number | null {
  switch (metric) {
    case "rep_pace":
      return medianOfReps(row.repPaces);
    case "rep_hr":
      return medianOfReps(row.repPeakHrs);
    case "fade":
      return typeof row.repPaceFadePct === "number" && Number.isFinite(row.repPaceFadePct) ? row.repPaceFadePct : null;
    case "recovery":
      return medianOfReps(row.repRecoveryDrops);
    default:
      return null;
  }
}

function keyRepeat(key: string | null): number | null {
  const parsed = parseComparisonKey(key ?? undefined);
  return isSingleBlockKey(parsed) ? parsed!.blocks[0]!.repeat : null;
}

const strength = (shift: MetricShift): number => metricStrength(shift, FLAT[shift.metric] ?? 1);

export function matchIntervalWorkout(input: {
  current: DerivedRowForComparison;
  history: DerivedRowForComparison[];
}): MatchResult {
  const { current } = input;
  const empty: MatchResult = {
    evaluated: false,
    tier: null,
    key: current.comparisonKey,
    hadComparable: false,
    candidates: [],
    anyMetricEvaluated: false,
    anyMadKilled: false,
    recentPool: [],
    oldPool: [],
    steadyComparableCount: 0,
    steadyFalseAvoidedByHrBand: 0,
  };

  if (current.workoutType !== "run" || !current.comparisonKey || (current.repsDetectedCount ?? 0) < MIN_REPS_FOR_INTERVAL) {
    return empty;
  }

  type Tagged = { row: DerivedRowForComparison; tier: 1 | 2; recency: Recency; alsoOld: boolean };
  const tagged: Tagged[] = [];
  for (const row of input.history) {
    if (row.workoutType !== "run" || !row.comparisonKey || row.workoutId === current.workoutId) continue;
    const tier = tierOfMatch(current.comparisonKey, row.comparisonKey);
    if (tier === null) continue;
    const recency = recencyOf(current.workoutDate, row.workoutDate);
    if (recency === null) continue;
    tagged.push({ row, tier, recency, alsoOld: daysBetween(row.workoutDate, current.workoutDate) > OLD_MODE_MIN_AGE_DAYS });
  }

  const hasTier1 = tagged.some((t) => t.tier === 1);
  const tier: 1 | 2 | null = hasTier1 ? 1 : tagged.some((t) => t.tier === 2) ? 2 : null;
  if (tier === null) return { ...empty, evaluated: true };

  const pool = tagged.filter((t) => t.tier === tier);
  const recentRows = pool.filter((t) => t.recency === "recent").map((t) => t.row);
  const oldRows = pool.filter((t) => t.alsoOld).map((t) => t.row);

  const aMetrics: ComparisonMetric[] = tier === 1 ? ["rep_pace", "rep_hr", "fade", "recovery"] : ["rep_pace", "rep_hr"];
  const currentCount = keyRepeat(current.comparisonKey);

  const candidates: PraiseCandidate[] = [];
  let anyMetricEvaluated = false;
  let anyMadKilled = false;

  const valuesOf = (rows: DerivedRowForComparison[], metric: ComparisonMetric): number[] =>
    rows.map((r) => metricValue(r, metric)).filter((v): v is number => v !== null);

  const runMode = (mode: Recency, poolRows: DerivedRowForComparison[]): void => {
    if (poolRows.length === 0) return;
    const spreadFor = (metric: ComparisonMetric) => (mode === "old" ? valuesOf(recentRows, metric) : valuesOf(poolRows, metric));

    const builtByMetric = new Map<ComparisonMetric, BuiltShift>();
    // pace first (rep-HR comparability + composite depend on it)
    const paceBuilt = buildMetricShift("rep_pace", metricValue(current, "rep_pace"), valuesOf(poolRows, "rep_pace"), spreadFor("rep_pace"), FLAT.rep_pace!);
    if (paceBuilt) builtByMetric.set("rep_pace", paceBuilt);
    const paceComparable = paceBuilt !== null && Math.abs(paceBuilt.shift.delta) < COMPARABLE_PACE_MAX_DELTA_SEC;

    for (const metric of aMetrics) {
      if (metric === "rep_pace") continue;
      if (metric === "rep_hr" && !paceComparable) continue; // HR only at comparable pace
      const built = buildMetricShift(metric, metricValue(current, metric), valuesOf(poolRows, metric), spreadFor(metric), FLAT[metric]!);
      if (built) builtByMetric.set(metric, built);
    }

    // rep count (tier 2 only) — a mechanism-B participant + composite input
    let countShift: MetricShift | null = null;
    if (tier === 2 && currentCount !== null) {
      const poolCounts = poolRows.map((r) => keyRepeat(r.comparisonKey)).filter((v): v is number => v !== null);
      if (poolCounts.length >= MIN_POINTS) {
        const countBefore = median(poolCounts)!;
        const cDelta = currentCount - countBefore;
        countShift = { metric: "rep_count", before: countBefore, after: currentCount, delta: cDelta, baseN: poolCounts.length, spread: null, status: classifyShift(cDelta, 1, COUNT_SOFT_MIN) };
      }
    }

    for (const built of builtByMetric.values()) {
      anyMetricEvaluated = true;
      if (built.madKilled) anyMadKilled = true;
    }

    // ── composite (weight 3): count up AND pace not worse ──
    if (tier === 2 && countShift && countShift.after > countShift.before && paceBuilt && paceBuilt.shift.delta <= 0) {
      candidates.push({
        kind: "composite",
        weight: 3,
        tier,
        key: current.comparisonKey,
        mode,
        metrics: [paceBuilt.shift],
        composite: { countBefore: countShift.before, countAfter: countShift.after },
        primaryMetric: "rep_pace",
        primaryDelta: paceBuilt.shift.delta,
        primaryStrength: strength(paceBuilt.shift),
      });
    }

    // ── mechanism A (weight 2): strongest single metric past the effective threshold ──
    const aFired = [...builtByMetric.values()].filter((b) => b.flatPass);
    if (aFired.length > 0) {
      const best = aFired.reduce((x, y) => (strength(y.shift) > strength(x.shift) ? y : x));
      candidates.push({
        kind: "mechanism_a",
        weight: 2,
        tier,
        key: current.comparisonKey,
        mode,
        metrics: [best.shift],
        primaryMetric: best.shift.metric,
        primaryDelta: best.shift.delta,
        primaryStrength: strength(best.shift),
      });
    }

    // ── mechanism B (weight 1): >=2 consistent soft improvements, 0 contradictions ──
    const bShifts: MetricShift[] = [...builtByMetric.values()].map((b) => b.shift);
    if (countShift) bShifts.push(countShift);
    const b = evaluateMechanismB(bShifts);
    if (b.fires) {
      const primary = b.improved.reduce((x, y) => (strength(y) > strength(x) ? y : x));
      candidates.push({
        kind: "mechanism_b",
        weight: 1,
        tier,
        key: current.comparisonKey,
        mode,
        metrics: b.improved,
        primaryMetric: primary.metric,
        primaryDelta: primary.delta,
        primaryStrength: strength(primary),
      });
    }
  };

  runMode("recent", recentRows);
  runMode("old", oldRows);

  return {
    evaluated: true,
    tier,
    key: current.comparisonKey,
    hadComparable: true,
    candidates,
    anyMetricEvaluated,
    anyMadKilled,
    recentPool: recentRows,
    oldPool: oldRows,
    steadyComparableCount: 0,
    steadyFalseAvoidedByHrBand: 0,
  };
}

export { computeComparisonKey };
