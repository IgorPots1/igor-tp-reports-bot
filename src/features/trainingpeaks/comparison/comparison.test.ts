import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeComparisonKey, isSingleBlockKey, parseComparisonKey } from "./comparison-key.ts";
import { effectiveThreshold, mad, median } from "./norm.ts";
import { addDays, daysBetween, resolveComparisonWindow } from "./resolve-window.ts";
import { classifyShift, evaluateMechanismB, softThreshold } from "./signal-consistency.ts";
import { shouldEmitPraise } from "./pause.ts";
import { matchIntervalWorkout } from "./interval-matcher.ts";
import { matchSteadyWorkout } from "./steady-matcher.ts";
import { classifyOutcome } from "./match-result.ts";
import { detectPulseAnomaly } from "./pulse-anomaly.ts";
import { compareWorkout } from "./index.ts";
import type { DerivedRowForComparison, MetricShift } from "./types.ts";

// ── structure fixtures ───────────────────────────────────────────────────────
function repeatBlock(repeat: number, steps: Array<{ len: number; unit: string; active?: boolean }>) {
  return {
    length: { value: repeat, unit: "repetition" },
    steps: steps.map((s) => ({ intensityClass: s.active === false ? "rest" : "active", length: { value: s.len, unit: s.unit } })),
  };
}
const warmup = { length: { value: 1, unit: "repetition" }, intensityClass: "warmUp", steps: [] };

describe("comparison-key", () => {
  test("single active step per cycle → NxM[unit]", () => {
    assert.equal(computeComparisonKey({ structure: [warmup, repeatBlock(7, [{ len: 300, unit: "second" }])] }), "7x[300second]");
  });
  test("multiblock joins with +; no repeat → null", () => {
    assert.equal(computeComparisonKey({ structure: [repeatBlock(3, [{ len: 400, unit: "meter" }]), repeatBlock(4, [{ len: 200, unit: "meter" }])] }), "3x[400meter]+4x[200meter]");
    assert.equal(computeComparisonKey({ structure: [warmup] }), null);
  });
  test("parse round-trips and classifies single vs multiblock", () => {
    assert.equal(isSingleBlockKey(parseComparisonKey("7x[300second]")), true);
    assert.equal(isSingleBlockKey(parseComparisonKey("3x[400meter]+4x[200meter]")), false);
  });
});

describe("norm primitives", () => {
  test("median, MAD, effective threshold", () => {
    assert.equal(median([435, 453, 471]), 453);
    assert.equal(mad([435, 453, 471]), 18);
    assert.equal(effectiveThreshold(10, 18), 36);
    assert.equal(effectiveThreshold(10, null), 10);
  });
});

describe("window date math", () => {
  test("addDays / daysBetween", () => {
    assert.equal(addDays("2026-07-01", -56), "2026-05-06");
    assert.equal(daysBetween("2026-06-01", "2026-07-01"), 30);
    assert.equal(resolveComparisonWindow({ workoutDate: "2026-07-01", futureRaceDates: ["2026-08-01"] }).label, "pre_race");
  });
});

describe("signal-consistency (mechanism B)", () => {
  test("classifyShift by soft threshold and direction", () => {
    assert.equal(classifyShift(-6, -1, 5), "improved"); // pace faster past soft
    assert.equal(classifyShift(+6, -1, 5), "worsened"); // pace slower past soft
    assert.equal(classifyShift(+3, 1, 2.5), "improved"); // recovery drop bigger
    assert.equal(classifyShift(-2, -1, 5), "neutral");
    assert.equal(softThreshold(10), 5);
  });
  test("B fires on >=2 improved and 0 worsened; a contradiction kills it", () => {
    const s = (metric: MetricShift["metric"], status: MetricShift["status"]): MetricShift => ({ metric, before: 0, after: 0, delta: 0, baseN: 1, spread: null, status });
    assert.equal(evaluateMechanismB([s("rep_pace", "improved"), s("recovery", "improved")]).fires, true);
    assert.equal(evaluateMechanismB([s("rep_pace", "improved"), s("rep_hr", "worsened"), s("recovery", "improved")]).fires, false);
    assert.equal(evaluateMechanismB([s("rep_pace", "improved"), s("rep_hr", "neutral")]).fires, false);
  });
});

describe("pause (weight-aware)", () => {
  test("stronger breaks through; equal/weaker waits 14 days", () => {
    const composite = 3 as const;
    const b = 1 as const;
    assert.equal(shouldEmitPraise({ candidateWeight: composite, last: { weight: b, date: "2026-06-29" }, workoutDate: "2026-07-01" }), true);
    assert.equal(shouldEmitPraise({ candidateWeight: b, last: { weight: composite, date: "2026-06-29" }, workoutDate: "2026-07-01" }), false);
    assert.equal(shouldEmitPraise({ candidateWeight: composite, last: { weight: composite, date: "2026-06-29" }, workoutDate: "2026-07-01" }), false);
    assert.equal(shouldEmitPraise({ candidateWeight: 2, last: { weight: composite, date: "2026-06-01" }, workoutDate: "2026-07-01" }), true);
    assert.equal(shouldEmitPraise({ candidateWeight: b, last: null, workoutDate: "2026-07-01" }), true);
  });
});

// ── matcher helpers ──────────────────────────────────────────────────────────
function run(o: Partial<DerivedRowForComparison> & { workoutId: number; workoutDate: string }): DerivedRowForComparison {
  return {
    workoutType: "run",
    comparisonKey: "7x[300second]",
    repsDetectedCount: 7,
    repPaces: [300],
    repPeakHrs: [160],
    repPaceFadePct: null,
    repRecoveryDrops: null,
    avgHr: 150,
    hrTrusted: true,
    hrQuality: "good",
    avgPaceSecPerKm: null,
    durationS: null,
    hrDecouplingPct: null,
    aerobicEf: null,
    ...o,
  };
}

function steady(o: Partial<DerivedRowForComparison> & { workoutId: number; workoutDate: string }): DerivedRowForComparison {
  return {
    workoutType: "run",
    comparisonKey: null,
    repsDetectedCount: 0,
    repPaces: null,
    repPeakHrs: null,
    repPaceFadePct: null,
    repRecoveryDrops: null,
    avgHr: 145,
    hrTrusted: true,
    hrQuality: "good",
    avgPaceSecPerKm: 360,
    durationS: 3600,
    hrDecouplingPct: 5,
    aerobicEf: 0.017,
    ...o,
  };
}

describe("tier 2 wider (наряд 2)", () => {
  test("6×4 vs 8×4 comparable (same length, any count)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", comparisonKey: "8x[240second]", repPaces: [300] });
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", comparisonKey: "6x[240second]", repPaces: [312] })];
    assert.equal(matchIntervalWorkout({ current, history }).tier, 2);
  });
  test("7×5 vs 7×4 NOT comparable (different length)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", comparisonKey: "7x[240second]", repPaces: [280] });
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", comparisonKey: "7x[300second]", repPaces: [300] })];
    const res = matchIntervalWorkout({ current, history });
    assert.equal(res.hadComparable, false);
    assert.equal(classifyOutcome(res), "no_comparable");
  });
});

describe("min points = 1; MAD guard only n>=3", () => {
  test("one comparable point → norm forms (below_threshold, not norm_not_met)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [449] });
    const res = matchIntervalWorkout({ current, history: [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [453] })] });
    assert.equal(classifyOutcome(res), "below_threshold");
  });
  test("n=1, Δ21 faster → fires (no MAD guard)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [432] });
    const res = matchIntervalWorkout({ current, history: [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [453] })] });
    assert.equal(classifyOutcome(res), "fired");
  });
  test("n=3 with MAD 18, Δ21 faster → mad_killed; Δ36 → fires", () => {
    const hist = [
      run({ workoutId: 1, workoutDate: "2026-06-01", repPaces: [435] }),
      run({ workoutId: 2, workoutDate: "2026-06-10", repPaces: [453] }),
      run({ workoutId: 3, workoutDate: "2026-06-20", repPaces: [471] }),
    ];
    assert.equal(classifyOutcome(matchIntervalWorkout({ current: run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [432] }), history: hist })), "mad_killed");
    assert.equal(classifyOutcome(matchIntervalWorkout({ current: run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [417] }), history: hist })), "fired");
  });
});

describe("mechanism A vs B", () => {
  test("A: one strong single improvement fires (weight 2)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [300] });
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [340] })]; // current 40 faster
    const a = matchIntervalWorkout({ current, history }).candidates.find((c) => c.kind === "mechanism_a");
    assert.ok(a && a.weight === 2);
  });
  test("B: two consistent soft improvements fire (weight 1)", () => {
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [300], repPeakHrs: [160], repRecoveryDrops: [20] })];
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [294], repPeakHrs: [160], repRecoveryDrops: [23] });
    const res = matchIntervalWorkout({ current, history });
    const b = res.candidates.find((c) => c.kind === "mechanism_b");
    assert.ok(b, "B should fire");
    assert.equal(b!.metrics.length, 2); // pace + recovery
    assert.ok(!res.candidates.some((c) => c.kind === "mechanism_a"));
  });
  test("B silent when a metric contradicts (pace better, HR worse)", () => {
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [300], repPeakHrs: [160] })];
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [294], repPeakHrs: [165] });
    const res = matchIntervalWorkout({ current, history });
    assert.ok(!res.candidates.some((c) => c.kind === "mechanism_b"));
    assert.ok(!res.candidates.some((c) => c.kind === "mechanism_a"));
  });
});

describe("composite progress (priority)", () => {
  test("count up + pace not worse → composite (weight 3), wins focus", () => {
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", comparisonKey: "6x[300second]", repPaces: [300] })];
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", comparisonKey: "8x[300second]", repPaces: [298] });
    const result = compareWorkout({ current, history });
    assert.equal(result.observation?.kind, "composite");
    assert.equal(result.observation?.composite?.countBefore, 6);
    assert.equal(result.observation?.composite?.countAfter, 8);
  });
});

describe("pause integration + artifact flag", () => {
  test("weak B suppressed by a fresh composite; the praise is still recorded", () => {
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [300], repPeakHrs: [160], repRecoveryDrops: [20] })];
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [294], repPeakHrs: [160], repRecoveryDrops: [23] });
    const result = compareWorkout({ current, history, lastPraise: { weight: 3, date: "2026-06-29" } });
    assert.equal(result.observation, null);
    assert.ok(result.suppressedByPause && result.suppressedByPause.kind === "mechanism_b");
  });
  test("unusually large pace improvement raises an unusual_shift coach flag", () => {
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [340] })];
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [300] });
    const result = compareWorkout({ current, history });
    assert.ok(result.coachFlags.some((f) => f.kind === "unusual_shift"));
  });
});

describe("ярус 3 — steady runs, HR-band honesty gate", () => {
  test("HR band cuts the tempo-in-easy-bucket false positive (Marina)", () => {
    const history = [steady({ workoutId: 1, workoutDate: "2026-06-10", avgPaceSecPerKm: 363, avgHr: 140, aerobicEf: 0.015 })];
    const current = steady({ workoutId: 99, workoutDate: "2026-07-01", avgPaceSecPerKm: 278, avgHr: 165, aerobicEf: 0.02 });
    const withBand = matchSteadyWorkout({ current, history, enforceHrBand: true });
    assert.equal(withBand.hadComparable, false);
    assert.ok(withBand.steadyFalseAvoidedByHrBand >= 1);
    const withoutBand = matchSteadyWorkout({ current, history, enforceHrBand: false });
    assert.ok(withoutBand.candidates.length > 0);
  });
  test("real improvement within the HR band fires (pace faster, EF corroborates)", () => {
    const history = [steady({ workoutId: 1, workoutDate: "2026-06-10", avgPaceSecPerKm: 360, avgHr: 145, aerobicEf: 0.017 })];
    const current = steady({ workoutId: 99, workoutDate: "2026-07-01", avgPaceSecPerKm: 348, avgHr: 145, aerobicEf: 0.0181 });
    const res = matchSteadyWorkout({ current, history });
    assert.equal(res.tier, 3);
    assert.ok(res.candidates.some((c) => c.kind === "mechanism_a" && c.primaryMetric === "steady_pace"));
  });
  test("EF must corroborate: pace faster but EF flat → silence", () => {
    const history = [steady({ workoutId: 1, workoutDate: "2026-06-10", avgPaceSecPerKm: 360, avgHr: 145, aerobicEf: 0.017 })];
    const current = steady({ workoutId: 99, workoutDate: "2026-07-01", avgPaceSecPerKm: 348, avgHr: 145, aerobicEf: 0.0171 });
    const res = matchSteadyWorkout({ current, history });
    assert.ok(!res.candidates.some((c) => c.primaryMetric === "steady_pace"));
  });
});

describe("pulse anomaly detector (unchanged from наряд 1)", () => {
  const normPool: DerivedRowForComparison[] = [
    run({ workoutId: 1, workoutDate: "2026-06-01", repPeakHrs: [150, 168, 169, 170] }),
    run({ workoutId: 2, workoutDate: "2026-06-10", repPeakHrs: [150, 169, 170, 171] }),
    run({ workoutId: 3, workoutDate: "2026-06-20", repPeakHrs: [150, 170, 171, 172] }),
  ];
  test("grades by shortfall; needs comparable pace", () => {
    const mk = (hrs: number[]) => run({ workoutId: 9, workoutDate: "2026-07-01", repPeakHrs: hrs });
    assert.equal(detectPulseAnomaly({ current: mk([120, 165, 166, 167]), normPool, paceDeltaSec: 0 }).grade, "silent");
    assert.equal(detectPulseAnomaly({ current: mk([120, 159, 160, 161]), normPool, paceDeltaSec: 0 }).grade, "flag_coach");
    assert.equal(detectPulseAnomaly({ current: mk([120, 152, 153, 154]), normPool, paceDeltaSec: 0 }).grade, "suppress_and_ask");
    assert.equal(detectPulseAnomaly({ current: mk([120, 150, 150, 150]), normPool, paceDeltaSec: 25 }).reason, "pace_not_comparable");
  });
});

describe("old-mode gate (Anton: не сравнивать со скачущим/устаревшим якорем)", () => {
  const cur = { workoutId: 99, workoutDate: "2026-07-01", avgPaceSecPerKm: 350, aerobicEf: 0.019 };
  test("scattered old baseline (high MAD) → no candidate (silence)", () => {
    const res = matchSteadyWorkout({
      current: steady(cur),
      history: [
        steady({ workoutId: 1, workoutDate: "2026-04-20", avgPaceSecPerKm: 400 }),
        steady({ workoutId: 2, workoutDate: "2026-04-22", avgPaceSecPerKm: 340 }),
        steady({ workoutId: 3, workoutDate: "2026-04-25", avgPaceSecPerKm: 390 }),
        steady({ workoutId: 4, workoutDate: "2026-04-28", avgPaceSecPerKm: 360, aerobicEf: 0.017 }),
      ],
    });
    assert.equal(res.candidates.filter((c) => c.mode === "old").length, 0);
  });
  test("tight old baseline, thin recent → old progress still speaks", () => {
    const res = matchSteadyWorkout({
      current: steady(cur),
      history: [
        steady({ workoutId: 1, workoutDate: "2026-04-20", avgPaceSecPerKm: 372, aerobicEf: 0.017 }),
        steady({ workoutId: 2, workoutDate: "2026-04-22", avgPaceSecPerKm: 370, aerobicEf: 0.017 }),
        steady({ workoutId: 3, workoutDate: "2026-04-25", avgPaceSecPerKm: 371, aerobicEf: 0.017 }),
      ],
    });
    assert.ok(res.candidates.some((c) => c.mode === "old"));
  });
  test("enough recent norm + current slower than recent → old suppressed (no false progress)", () => {
    const res = matchSteadyWorkout({
      current: steady({ ...cur, avgPaceSecPerKm: 369 }),
      history: [
        steady({ workoutId: 10, workoutDate: "2026-06-20", avgPaceSecPerKm: 360, aerobicEf: 0.017 }),
        steady({ workoutId: 11, workoutDate: "2026-06-15", avgPaceSecPerKm: 358, aerobicEf: 0.017 }),
        steady({ workoutId: 12, workoutDate: "2026-06-10", avgPaceSecPerKm: 362, aerobicEf: 0.017 }),
        steady({ workoutId: 1, workoutDate: "2026-04-20", avgPaceSecPerKm: 383, aerobicEf: 0.017 }),
        steady({ workoutId: 2, workoutDate: "2026-04-22", avgPaceSecPerKm: 384, aerobicEf: 0.017 }),
        steady({ workoutId: 3, workoutDate: "2026-04-25", avgPaceSecPerKm: 382, aerobicEf: 0.017 }),
      ],
    });
    assert.equal(res.candidates.filter((c) => c.mode === "old").length, 0);
  });
});
