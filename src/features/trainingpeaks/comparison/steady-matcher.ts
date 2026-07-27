// Steady / long-run matcher (ярус 3), наряд 2. Same two mechanisms (A strong
// single, B consistent picture) and the 14-day pause as intervals.
//
// COMPARABILITY IS THE WHOLE GAME HERE (design doc §A, tier 3): duration (or
// distance) within ±25% AND the SAME intensity band — both runs' average HR
// within ±5 bpm. Without the HR band tier 3 lies: a tempo run lands in the easy
// bucket of the same length and reads as "−85 s/km progress" (Marina Nikolaeva,
// 10.4 km, 278 vs base 363). The proof measures how many false signals the band
// removes (matchSteadyWorkout with enforceHrBand=false).
//
// Metrics (no reps, no recovery here): pace at comparable HR (primary), average
// HR, hr_decoupling_pct (≥3 pp). aerobic_ef is a NORMALIZER only — it corroborates
// that a pace/HR improvement is real (EF moved the same way), and is NEVER shown
// to the student. EF moved but pace/HR didn't clear threshold → silence.

import { median } from "./norm.ts";
import { evaluateMechanismB } from "./signal-consistency.ts";
import { buildMetricShift, metricStrength, type BuiltShift } from "./metric-shift.ts";
import { MIN_RECENT_FOR_STABLE_NORM, OLD_MODE_MIN_AGE_DAYS, SLIDING_WINDOW_DAYS, daysBetween } from "./resolve-window.ts";
import type { MatchResult } from "./match-result.ts";
import type { ComparisonMetric, DerivedRowForComparison, MetricShift, PraiseCandidate } from "./types.ts";

export const STEADY_PACE_THRESHOLD_SEC = 10;
export const STEADY_HR_THRESHOLD_BPM = 5;
export const DECOUPLING_THRESHOLD_PP = 3;
export const DURATION_TOLERANCE = 0.25; // ±25%
export const HR_BAND_BPM = 5; // same intensity band
export const EF_MIN_IMPROVE_FRACTION = 0.03; // EF must corroborate by ≥3% of norm
export const MAX_REPS_FOR_STEADY = 1; // reps_detected_count < 2 → steady, not interval

const FLAT: Partial<Record<ComparisonMetric, number>> = {
  steady_pace: STEADY_PACE_THRESHOLD_SEC,
  avg_hr: STEADY_HR_THRESHOLD_BPM,
  decoupling: DECOUPLING_THRESHOLD_PP,
};
const STEADY_METRICS: ComparisonMetric[] = ["steady_pace", "avg_hr", "decoupling"];

type Recency = "recent" | "old";

function isSteadyRun(row: DerivedRowForComparison): boolean {
  return (
    row.workoutType === "run" &&
    (row.repsDetectedCount ?? 0) <= MAX_REPS_FOR_STEADY &&
    row.avgPaceSecPerKm !== null &&
    row.avgHr !== null &&
    row.durationS !== null
  );
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
    case "steady_pace":
      return row.avgPaceSecPerKm;
    case "avg_hr":
      return row.avgHr;
    case "decoupling":
      return typeof row.hrDecouplingPct === "number" && Number.isFinite(row.hrDecouplingPct) ? row.hrDecouplingPct : null;
    default:
      return null;
  }
}

const strength = (shift: MetricShift): number => metricStrength(shift, FLAT[shift.metric] ?? 1);

export function matchSteadyWorkout(input: {
  current: DerivedRowForComparison;
  history: DerivedRowForComparison[];
  enforceHrBand?: boolean;
}): MatchResult {
  const enforceHrBand = input.enforceHrBand ?? true;
  const { current } = input;
  const empty: MatchResult = {
    evaluated: false,
    tier: null,
    key: null,
    hadComparable: false,
    candidates: [],
    anyMetricEvaluated: false,
    anyMadKilled: false,
    recentPool: [],
    oldPool: [],
    steadyComparableCount: 0,
    steadyFalseAvoidedByHrBand: 0,
  };

  if (!isSteadyRun(current) || current.hrTrusted === false) return empty;
  const curDuration = current.durationS!;
  const curHr = current.avgHr!;

  // duration ±25% first; the HR band is the honesty gate on top of it.
  const durationOk: { row: DerivedRowForComparison; recency: Recency; alsoOld: boolean }[] = [];
  for (const row of input.history) {
    if (row.workoutId === current.workoutId || !isSteadyRun(row)) continue;
    if (Math.abs(row.durationS! - curDuration) > DURATION_TOLERANCE * curDuration) continue;
    const recency = recencyOf(current.workoutDate, row.workoutDate);
    if (recency === null) continue;
    durationOk.push({ row, recency, alsoOld: daysBetween(row.workoutDate, current.workoutDate) > OLD_MODE_MIN_AGE_DAYS });
  }
  const inHrBand = (row: DerivedRowForComparison) => Math.abs(row.avgHr! - curHr) <= HR_BAND_BPM;
  const comparable = enforceHrBand ? durationOk.filter((d) => inHrBand(d.row)) : durationOk;
  const falseAvoided = durationOk.length - durationOk.filter((d) => inHrBand(d.row)).length;

  if (comparable.length === 0) {
    return { ...empty, evaluated: true, steadyFalseAvoidedByHrBand: falseAvoided };
  }

  const recentRows = comparable.filter((c) => c.recency === "recent").map((c) => c.row);
  const oldRows = comparable.filter((c) => c.alsoOld).map((c) => c.row);

  const candidates: PraiseCandidate[] = [];
  let anyMetricEvaluated = false;
  let anyMadKilled = false;

  const valuesOf = (rows: DerivedRowForComparison[], metric: ComparisonMetric): number[] =>
    rows.map((r) => metricValue(r, metric)).filter((v): v is number => v !== null);
  const efValues = (rows: DerivedRowForComparison[]): number[] =>
    rows.map((r) => r.aerobicEf).filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const runMode = (mode: Recency, poolRows: DerivedRowForComparison[]): void => {
    if (poolRows.length === 0) return;
    // Spread (MAD) is measured over the SAME pool the norm is built from, incl. old-mode. The old
    // code measured old-mode spread over the thin recent rows, which disabled the MAD gate (Anton:
    // 2 recent points → no MAD → old fired on the flat threshold alone despite scattered old data).
    // Now if a month-plus-ago baseline is itself unstable (high MAD, "месяц назад скакали"), 2×MAD
    // exceeds the delta and the claim is silenced — there is no norm there to compare against.
    const spreadFor = (metric: ComparisonMetric) => valuesOf(poolRows, metric);

    // aerobic_ef corroboration: an improvement in pace/HR is only credited when
    // EF moved the same way (faster-per-HR) by ≥3% of its norm.
    const efNorm = median(efValues(poolRows));
    const efImproved =
      efNorm !== null && efNorm > 0 && current.aerobicEf !== null && (current.aerobicEf - efNorm) / efNorm >= EF_MIN_IMPROVE_FRACTION;

    const builtByMetric = new Map<ComparisonMetric, BuiltShift>();
    for (const metric of STEADY_METRICS) {
      const built = buildMetricShift(metric, metricValue(current, metric), valuesOf(poolRows, metric), spreadFor(metric), FLAT[metric]!);
      if (!built) continue;
      // EF gate applies to pace and HR (the "at comparable HR / pace" story); a
      // decoupling improvement stands on its own.
      if ((metric === "steady_pace" || metric === "avg_hr") && !efImproved) {
        built.flatPass = false;
        if (built.shift.status === "improved") built.shift.status = "neutral";
      }
      builtByMetric.set(metric, built);
    }

    for (const built of builtByMetric.values()) {
      anyMetricEvaluated = true;
      if (built.madKilled) anyMadKilled = true;
    }

    // mechanism A: strongest single metric past the effective threshold
    const aFired = [...builtByMetric.values()].filter((b) => b.flatPass);
    if (aFired.length > 0) {
      const best = aFired.reduce((x, y) => (strength(y.shift) > strength(x.shift) ? y : x));
      candidates.push({
        kind: "mechanism_a",
        weight: 2,
        tier: 3,
        key: null,
        mode,
        metrics: [best.shift],
        primaryMetric: best.shift.metric,
        primaryDelta: best.shift.delta,
        primaryStrength: strength(best.shift),
      });
    }

    // mechanism B: >=2 consistent soft improvements, 0 contradictions
    const b = evaluateMechanismB([...builtByMetric.values()].map((x) => x.shift));
    if (b.fires) {
      const primary = b.improved.reduce((x, y) => (strength(y) > strength(x) ? y : x));
      candidates.push({
        kind: "mechanism_b",
        weight: 1,
        tier: 3,
        key: null,
        mode,
        metrics: b.improved,
        primaryMetric: primary.metric,
        primaryDelta: primary.delta,
        primaryStrength: strength(primary),
      });
    }
  };

  runMode("recent", recentRows);
  // Old-mode only when the recent norm is too thin to judge — otherwise "прогресс vs месяц назад" can
  // contradict a flat/declining recent trend (Anton). Recent speaks first; old fills a gap, not competes.
  if (recentRows.length < MIN_RECENT_FOR_STABLE_NORM) {
    runMode("old", oldRows);
  }

  return {
    evaluated: true,
    tier: 3,
    key: null,
    hadComparable: true,
    candidates,
    anyMetricEvaluated,
    anyMadKilled,
    recentPool: recentRows,
    oldPool: oldRows,
    steadyComparableCount: comparable.length,
    steadyFalseAvoidedByHrBand: falseAvoided,
  };
}
