import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeComparisonKey, isSingleBlockKey, parseComparisonKey } from "./comparison-key.ts";
import { effectiveThreshold, mad, median } from "./norm.ts";
import { addDays, daysBetween, resolveComparisonWindow } from "./resolve-window.ts";
import { classifyMatchOutcome, matchIntervalWorkout } from "./interval-matcher.ts";
import { detectPulseAnomaly } from "./pulse-anomaly.ts";
import { compareWorkout } from "./index.ts";
import type { DerivedRowForComparison } from "./types.ts";

// ── structure fixtures (shape mirrors TP source_snapshot.structure) ──────────
function repeatBlock(repeat: number, steps: Array<{ len: number; unit: string; active?: boolean }>) {
  return {
    length: { value: repeat, unit: "repetition" },
    steps: steps.map((s) => ({
      intensityClass: s.active === false ? "rest" : "active",
      length: { value: s.len, unit: s.unit },
    })),
  };
}
const warmup = { length: { value: 1, unit: "repetition" }, intensityClass: "warmUp", steps: [] };

describe("comparison-key", () => {
  test("single active step per cycle → NxM[unit]", () => {
    assert.equal(
      computeComparisonKey({ structure: [warmup, repeatBlock(7, [{ len: 300, unit: "second" }])] }),
      "7x[300second]"
    );
  });

  test("distance reps key in meters", () => {
    assert.equal(computeComparisonKey({ structure: [repeatBlock(4, [{ len: 1000, unit: "meter" }])] }), "4x[1000meter]");
  });

  test("recovery step inside the block does not enter the key", () => {
    const key = computeComparisonKey({
      structure: [repeatBlock(7, [{ len: 400, unit: "meter" }, { len: 200, unit: "meter", active: false }])],
    });
    assert.equal(key, "7x[400meter]");
  });

  test("several active steps per cycle join with /", () => {
    const key = computeComparisonKey({
      structure: [repeatBlock(7, [{ len: 400, unit: "meter" }, { len: 200, unit: "meter" }])],
    });
    assert.equal(key, "7x[400meter/200meter]");
  });

  test("multiblock joins with +", () => {
    const key = computeComparisonKey({
      structure: [repeatBlock(3, [{ len: 400, unit: "meter" }]), repeatBlock(4, [{ len: 200, unit: "meter" }])],
    });
    assert.equal(key, "3x[400meter]+4x[200meter]");
  });

  test("no repeated block → null", () => {
    assert.equal(computeComparisonKey({ structure: [warmup] }), null);
    assert.equal(computeComparisonKey({ structure: [] }), null);
    assert.equal(computeComparisonKey(null), null);
  });

  test("active work step without a usable length → null (unkeyable)", () => {
    const key = computeComparisonKey({ structure: [repeatBlock(6, [{ len: 0, unit: "second" }])] });
    assert.equal(key, null);
  });

  test("parse round-trips and classifies single vs multiblock", () => {
    assert.deepEqual(parseComparisonKey("7x[300second]"), { blocks: [{ repeat: 7, steps: [{ len: 300, unit: "second" }] }] });
    assert.equal(isSingleBlockKey(parseComparisonKey("7x[300second]")), true);
    assert.equal(isSingleBlockKey(parseComparisonKey("7x[400meter/200meter]")), false);
    assert.equal(isSingleBlockKey(parseComparisonKey("3x[400meter]+4x[200meter]")), false);
    assert.equal(parseComparisonKey("garbage"), null);
  });
});

describe("norm primitives", () => {
  test("median and MAD", () => {
    assert.equal(median([435, 453, 471]), 453);
    assert.equal(mad([435, 453, 471]), 18); // deviations 18,0,18 → median 18
    assert.equal(mad([100]), null);
  });
  test("effective threshold = max(flat, 2×MAD)", () => {
    assert.equal(effectiveThreshold(10, 18), 36);
    assert.equal(effectiveThreshold(10, 2), 10);
    assert.equal(effectiveThreshold(10, null), 10);
  });
});

describe("window date math", () => {
  test("addDays / daysBetween", () => {
    assert.equal(addDays("2026-07-01", -56), "2026-05-06");
    assert.equal(daysBetween("2026-06-01", "2026-07-01"), 30);
  });
  test("future race → pre_race label; else sliding_8w", () => {
    assert.equal(resolveComparisonWindow({ workoutDate: "2026-07-01", futureRaceDates: ["2026-08-01"] }).label, "pre_race");
    assert.equal(resolveComparisonWindow({ workoutDate: "2026-07-01", futureRaceDates: ["2026-06-01"] }).label, "sliding_8w");
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
    ...o,
  };
}

// Three recent same-key points with pace median 453, MAD 18 (from доклад: Ksenia).
function kseniaHistory(): DerivedRowForComparison[] {
  return [
    run({ workoutId: 1, workoutDate: "2026-06-01", repPaces: [435] }),
    run({ workoutId: 2, workoutDate: "2026-06-10", repPaces: [453] }),
    run({ workoutId: 3, workoutDate: "2026-06-20", repPaces: [471] }),
  ];
}

describe("tier 2 boundary (design doc п.5)", () => {
  test("7×5 vs 8×5 are comparable at tier 2 (pace only)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", comparisonKey: "8x[300second]", repPaces: [480] });
    const history = kseniaHistory(); // all keyed 7x[300second]
    const res = matchIntervalWorkout({ current, history });
    assert.equal(res.tier, 2);
    // tier 2 evaluates rep_pace (and rep_hr), never fade/recovery
    assert.ok(res.metricEvals.some((e) => e.metric === "rep_pace"));
    assert.ok(!res.metricEvals.some((e) => e.metric === "fade" || e.metric === "recovery"));
  });

  test("7×5 vs 7×4 are NOT comparable (length diff > 10%)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", comparisonKey: "7x[240second]", repPaces: [280] });
    const history = kseniaHistory();
    const res = matchIntervalWorkout({ current, history });
    assert.equal(res.tier, null);
    assert.equal(res.hadStructuralComparable, false);
    assert.equal(classifyMatchOutcome(res), "no_comparable");
  });
});

describe("MAD guard (design doc §B — Ksenia)", () => {
  test("Δ+21 s/km at MAD 18 → silenced (mad_killed)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [474] }); // 453 + 21
    const res = matchIntervalWorkout({ current, history: kseniaHistory() });
    const pace = res.metricEvals.find((e) => e.metric === "rep_pace" && e.mode === "recent")!;
    assert.equal(pace.before, 453);
    assert.equal(pace.igorPass, true); // clears the flat 10 s/km
    assert.equal(pace.fired, false); // but not 2×MAD = 36
    assert.equal(classifyMatchOutcome(res), "mad_killed");
  });

  test("Δ+36 s/km at MAD 18 → speaks (fired)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [489] }); // 453 + 36
    const res = matchIntervalWorkout({ current, history: kseniaHistory() });
    const pace = res.metricEvals.find((e) => e.metric === "rep_pace" && e.mode === "recent")!;
    assert.equal(pace.fired, true);
    assert.equal(classifyMatchOutcome(res), "fired");
  });
});

describe("silence taxonomy", () => {
  test("no comparable when no key matches", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", comparisonKey: "12x[120second]" });
    const res = matchIntervalWorkout({ current, history: kseniaHistory() });
    assert.equal(classifyMatchOutcome(res), "no_comparable");
  });

  test("norm_not_met with only one comparable point", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [500] });
    const history = [run({ workoutId: 1, workoutDate: "2026-06-10", repPaces: [450] })];
    const res = matchIntervalWorkout({ current, history });
    assert.equal(res.hadStructuralComparable, true);
    assert.equal(classifyMatchOutcome(res), "norm_not_met");
  });

  test("below_threshold when delta is small", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [455] }); // Δ+2 vs 453
    const res = matchIntervalWorkout({ current, history: kseniaHistory() });
    assert.equal(classifyMatchOutcome(res), "below_threshold");
  });
});

describe("rep HR only comparable at comparable pace", () => {
  test("HR suppressed when pace moved ≥10 s/km", () => {
    // pace 453→490 (Δ+37, fires and is >10) → HR not comparable
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [490], repPeakHrs: [140] });
    const res = matchIntervalWorkout({ current, history: kseniaHistory() });
    const hr = res.metricEvals.find((e) => e.metric === "rep_hr" && e.mode === "recent");
    assert.equal(hr?.suppressed, "pace_not_comparable");
  });
});

describe("pulse anomaly detector (design doc §E)", () => {
  const normPool: DerivedRowForComparison[] = [
    run({ workoutId: 1, workoutDate: "2026-06-01", repPeakHrs: [150, 168, 169, 170] }),
    run({ workoutId: 2, workoutDate: "2026-06-10", repPeakHrs: [150, 169, 170, 171] }),
    run({ workoutId: 3, workoutDate: "2026-06-20", repPeakHrs: [150, 170, 171, 172] }),
  ];
  // norm HR (skip first rep each) medians: 169, 170, 171 → norm median 170

  test("shortfall < 8 bpm → silent", () => {
    const current = run({ workoutId: 9, workoutDate: "2026-07-01", repPeakHrs: [120, 165, 166, 167] }); // skip1 → 166, shortfall 4
    const r = detectPulseAnomaly({ current, normPool, paceDeltaSec: 0 });
    assert.equal(r.grade, "silent");
  });

  test("8–15 bpm shortfall → flag coach", () => {
    const current = run({ workoutId: 9, workoutDate: "2026-07-01", repPeakHrs: [120, 159, 160, 161] }); // skip1 → 160, shortfall 10
    const r = detectPulseAnomaly({ current, normPool, paceDeltaSec: 0 });
    assert.equal(r.grade, "flag_coach");
  });

  test("≥15 bpm shortfall → suppress and ask", () => {
    const current = run({ workoutId: 9, workoutDate: "2026-07-01", repPeakHrs: [120, 152, 153, 154] }); // skip1 → 153, shortfall 17
    const r = detectPulseAnomaly({ current, normPool, paceDeltaSec: 0 });
    assert.equal(r.grade, "suppress_and_ask");
  });

  test("not comparable pace → silent regardless of HR", () => {
    const current = run({ workoutId: 9, workoutDate: "2026-07-01", repPeakHrs: [120, 150, 150, 150] });
    const r = detectPulseAnomaly({ current, normPool, paceDeltaSec: 25 });
    assert.equal(r.grade, "silent");
    assert.equal(r.reason, "pace_not_comparable");
  });

  test("untrusted HR → silent", () => {
    const current = run({ workoutId: 9, workoutDate: "2026-07-01", hrTrusted: false, repPeakHrs: [120, 150, 150, 150] });
    const r = detectPulseAnomaly({ current, normPool, paceDeltaSec: 0 });
    assert.equal(r.reason, "hr_untrusted");
  });
});

describe("orchestrator compareWorkout", () => {
  test("fires one observation and stays a pure structure (no verdict field)", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [489] });
    const result = compareWorkout({ current, history: kseniaHistory() });
    assert.equal(result.outcome, "fired");
    assert.ok(result.observation);
    assert.equal(result.observation!.metric, "rep_pace");
    assert.equal(result.observation!.class.tier, 1);
    assert.equal(result.observation!.before, 453);
    assert.equal(result.observation!.after, 489);
  });

  test("silence returns a null observation", () => {
    const current = run({ workoutId: 99, workoutDate: "2026-07-01", repPaces: [455] });
    const result = compareWorkout({ current, history: kseniaHistory() });
    assert.equal(result.observation, null);
  });
});
