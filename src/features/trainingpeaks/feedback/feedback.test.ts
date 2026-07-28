import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classifySessionType } from "./session-type.ts";
import { computeSplitHalf } from "./split-half.ts";
import { evaluateNegativeSplit } from "./negative-split.ts";
import { evaluateEvenPace, evaluateFullStructure } from "./positive-dictionary.ts";
import { evaluateFatigueCause } from "./fatigue-cause.ts";
import { resolveRecentMetricValue, computeHrvTrend, computeHealthBaseline } from "./health-baseline.ts";
import { FOCUS_CAP } from "./focus.ts";
import { planObservations } from "./observation-planner.ts";
import type { ContextPacket, PlannerDerivedMetrics, PlannerLap } from "./types.ts";

function baseCurrent(overrides: Partial<PlannerDerivedMetrics> = {}): PlannerDerivedMetrics {
  return {
    workoutId: 1,
    workoutDate: "2026-07-15",
    workoutType: "run",
    comparisonKey: null,
    repsDetectedCount: null,
    repPaces: null,
    repPeakHrs: null,
    repPaceFadePct: null,
    repRecoveryDrops: null,
    avgHr: 140,
    hrTrusted: true,
    hrQuality: "good",
    avgPaceSecPerKm: 330,
    durationS: 2400,
    hrDecouplingPct: 1,
    aerobicEf: null,
    repPaceCv: null,
    pctTimeHrTarget: null,
    pctTimePaceTarget: null,
    paceTrusted: true,
    distanceTrusted: true,
    ...overrides,
  };
}

function basePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    studentId: "s1",
    sex: "female",
    telegramFormality: "ty",
    workout: { workoutId: 1, workoutDate: "2026-07-15", title: "Лёгкая" },
    current: baseCurrent(),
    history: [],
    lastPraise: null,
    laps: [],
    memoryItems: [],
    studentMessages: [],
    healthMetrics: [],
    healthProfile: null,
    ...overrides,
  };
}

function negSplitLaps(secondHalfHr: number): PlannerLap[] {
  return [
    { lapIndex: 1, distanceM: 2000, timerTimeS: 680, paceSecPerKm: 340, avgHr: 139, isWork: null },
    { lapIndex: 2, distanceM: 2000, timerTimeS: 680, paceSecPerKm: 340, avgHr: 141, isWork: null },
    { lapIndex: 3, distanceM: 2000, timerTimeS: 640, paceSecPerKm: 320, avgHr: secondHalfHr - 1, isWork: null },
    { lapIndex: 4, distanceM: 2000, timerTimeS: 640, paceSecPerKm: 320, avgHr: secondHalfHr + 1, isWork: null },
  ];
}

function easyHistoryBaseline(): PlannerDerivedMetrics[] {
  return Array.from({ length: 6 }, (_, i) => baseCurrent({ workoutId: 100 + i, workoutDate: `2026-06-${10 + i}`, avgHr: 130, comparisonKey: null, repsDetectedCount: null }));
}

function thirtyDaysOfPulse(baselineValue: number): { metricDate: string; metricKey: "pulse"; value: number }[] {
  const out: { metricDate: string; metricKey: "pulse"; value: number }[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const day = String(i).padStart(2, "0");
    out.push({ metricDate: `2026-06-${day}`, metricKey: "pulse", value: baselineValue });
  }
  return out;
}

describe("session-type", () => {
  test("interval reuses compareWorkout's own rule", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: "5x[400meter]", repsDetectedCount: 5 }), title: null });
    assert.equal(result.sessionType, "interval");
  });
  test("title keyword wins over duration fallback", () => {
    const result = classifySessionType({ current: baseCurrent({ durationS: 1000 }), title: "Длительная 12км" });
    assert.equal(result.sessionType, "long_tempo");
  });
  test("no hint, short duration -> easy default", () => {
    const result = classifySessionType({ current: baseCurrent({ durationS: 1800 }), title: null });
    assert.equal(result.sessionType, "easy");
  });
  test("reps>=3 without comparison_key -> interval fallback (legacy summaryOnly)", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: null, repsDetectedCount: 24 }), title: "24×1 мин" });
    assert.equal(result.sessionType, "interval");
    assert.equal(result.confidence, "medium");
    assert.match(result.reason, /without comparison_key/);
  });
  test("reps=2 without key stays NOT interval; «темп»-title 35 мин → easy (Блок 6: «темп» больше не длинная)", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: null, repsDetectedCount: 2, durationS: 2100 }), title: "35 мин темп" });
    assert.equal(result.sessionType, "easy");
  });
  test("keyed path still wins and reads high confidence", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: "5x[400meter]", repsDetectedCount: 5 }), title: null });
    assert.equal(result.confidence, "high");
  });
  test("easy run (reps<2, no key) stays easy — no regression", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: null, repsDetectedCount: 0, durationS: 2400 }), title: "Лёгкий бег" });
    assert.equal(result.sessionType, "easy");
  });
  test("easy title + phantom heuristic reps (no N×M) is VETOED → not interval", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: null, repsDetectedCount: 5, durationS: 2400 }), title: "Легкий бег" });
    assert.notEqual(result.sessionType, "interval");
  });
  test("interval title keeps its N×M despite recovery word → interval", () => {
    const result = classifySessionType({ current: baseCurrent({ comparisonKey: null, repsDetectedCount: 20 }), title: "20 x 1 мин (восстановление бегом)" });
    assert.equal(result.sessionType, "interval");
  });
});

describe("split-half + negative-split", () => {
  test("second half faster, pulse stable -> disciplined praise", () => {
    const outcome = evaluateNegativeSplit({ laps: negSplitLaps(141), sessionType: "easy" });
    assert.equal(outcome.kind, "praise_disciplined");
  });
  test("second half faster, pulse rose meaningfully -> surge correction, never praise", () => {
    const outcome = evaluateNegativeSplit({ laps: negSplitLaps(155), sessionType: "easy" });
    assert.equal(outcome.kind, "correction_surge");
  });
  test("intervals never go through negative-split", () => {
    const outcome = evaluateNegativeSplit({ laps: negSplitLaps(141), sessionType: "interval" });
    assert.equal(outcome.kind, "none");
  });
  test("single lap can't split", () => {
    assert.equal(computeSplitHalf([{ lapIndex: 1, distanceM: 5000, timerTimeS: 1500, paceSecPerKm: 300, avgHr: 140, isWork: null }]), null);
  });
});

describe("positive-dictionary", () => {
  test("even pace fires only on intervals under the CV threshold", () => {
    assert.equal(evaluateEvenPace(baseCurrent({ repPaceCv: 2 }), "easy"), null);
    assert.notEqual(evaluateEvenPace(baseCurrent({ repPaceCv: 2 }), "interval"), null);
    assert.equal(evaluateEvenPace(baseCurrent({ repPaceCv: 10 }), "interval"), null);
  });
  test("full structure compares detected reps against the parsed key", () => {
    const done = evaluateFullStructure(baseCurrent({ comparisonKey: "5x[400meter]", repsDetectedCount: 5 }), "interval");
    assert.notEqual(done, null);
    const short = evaluateFullStructure(baseCurrent({ comparisonKey: "5x[400meter]", repsDetectedCount: 3 }), "interval");
    assert.equal(short, null);
  });
});

describe("C4 fatigue-cause — words beat the number", () => {
  test("elevated pulse + student said easy -> silence, no health lookup", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }),
      history: easyHistoryBaseline(),
      memoryItems: [{ type: "emotional_state", text: "Было легко, бодро себя чувствовала", date: "2026-07-15" }],
    });
    const outcome = evaluateFatigueCause(packet, "easy");
    assert.equal(outcome.kind, "silent");
  });
  test("elevated pulse + student said tired + RHR confirms -> confirmed cause", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }),
      history: easyHistoryBaseline(),
      memoryItems: [{ type: "health_status", text: "Тяжело далось, устала очень", date: "2026-07-15" }],
      healthProfile: { hasPulse: true, hasSleepHours: false, hasHrv: false, hasBodyBattery: false },
      healthMetrics: [...thirtyDaysOfPulse(55), { metricDate: "2026-07-15", metricKey: "pulse", value: 60 }],
    });
    const outcome = evaluateFatigueCause(packet, "easy");
    assert.equal(outcome.kind, "confirmed");
    if (outcome.kind === "confirmed") assert.equal(outcome.adviceKey, "cause_confirmed_tired_rhr");
  });
  test("elevated pulse + nothing said -> question, not an assertion", () => {
    const packet = basePacket({ current: baseCurrent({ avgHr: 145 }), history: easyHistoryBaseline(), memoryItems: [] });
    const outcome = evaluateFatigueCause(packet, "easy");
    assert.equal(outcome.kind, "question");
  });
  test("pulse not elevated at all -> not_triggered regardless of words", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 130 }),
      history: easyHistoryBaseline(),
      memoryItems: [{ type: "health_status", text: "Тяжело устала", date: "2026-07-15" }],
    });
    assert.equal(evaluateFatigueCause(packet, "easy").kind, "not_triggered");
  });
});

describe("health-baseline — window resolution + HRV trend (loosening)", () => {
  test("resolveRecentMetricValue picks the nearest reading in the window", () => {
    const metrics = [
      { metricDate: "2026-07-13", metricKey: "pulse" as const, value: 58 },
      { metricDate: "2026-07-14", metricKey: "pulse" as const, value: 61 },
    ];
    const got = resolveRecentMetricValue(metrics, "pulse", "2026-07-15", 2);
    assert.equal(got?.value, 61); // 07-14 is closer to 07-15 than 07-13
    assert.equal(got?.ageDays, 1);
  });
  test("resolveRecentMetricValue returns null outside the window", () => {
    const metrics = [{ metricDate: "2026-07-10", metricKey: "pulse" as const, value: 61 }];
    assert.equal(resolveRecentMetricValue(metrics, "pulse", "2026-07-15", 2), null); // 5d away
  });
  test("computeHrvTrend flags a sustained decline, not a single dip", () => {
    const prior = ["06-27", "06-29", "07-01", "07-03", "07-05"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "hrv" as const, value: 60 }));
    const recent = ["07-08", "07-10", "07-11", "07-12"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "hrv" as const, value: 50 }));
    const trend = computeHrvTrend({ metrics: [...prior, ...recent], asOfDate: "2026-07-15" });
    assert.equal(trend?.direction, "down");
    assert.ok((trend?.dropPct ?? 0) >= 8);
  });
  test("computeHrvTrend: one low night can't move the median -> flat", () => {
    const prior = ["06-27", "06-29", "07-01", "07-03", "07-05"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "hrv" as const, value: 60 }));
    const recent = [
      { metricDate: "2026-07-08", metricKey: "hrv" as const, value: 60 },
      { metricDate: "2026-07-10", metricKey: "hrv" as const, value: 60 },
      { metricDate: "2026-07-11", metricKey: "hrv" as const, value: 60 },
      { metricDate: "2026-07-12", metricKey: "hrv" as const, value: 35 }, // one bad night
    ];
    const trend = computeHrvTrend({ metrics: [...prior, ...recent], asOfDate: "2026-07-15" });
    assert.equal(trend?.direction, "flat");
  });
  test("computeHrvTrend needs enough points per half -> null", () => {
    const few = ["07-08", "07-10"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "hrv" as const, value: 50 }));
    assert.equal(computeHrvTrend({ metrics: few, asOfDate: "2026-07-15" }), null);
  });
  test("baseline with fewer points is allowed when minPoints lowered", () => {
    const three = ["07-01", "07-03", "07-05"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "pulse" as const, value: 55 }));
    assert.equal(computeHealthBaseline({ metrics: three, metricKey: "pulse", asOfDate: "2026-07-15" }), null); // default min 5
    assert.equal(computeHealthBaseline({ metrics: three, metricKey: "pulse", asOfDate: "2026-07-15", minPoints: 3 })?.medianValue, 55);
  });
});

describe("C4 fatigue-cause — loosening (window + trend) and honesty guards", () => {
  test("RHR confirms when the reading is a day OFF the workout date (old exact-match missed it)", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }),
      history: easyHistoryBaseline(),
      memoryItems: [{ type: "health_status", text: "Тяжело далось, устала", date: "2026-07-15" }],
      healthProfile: { hasPulse: true, hasSleepHours: false, hasHrv: false, hasBodyBattery: false },
      // baseline 55 in June; today's RHR reading dated 07-14 (the day before), value 60
      healthMetrics: [...thirtyDaysOfPulse(55), { metricDate: "2026-07-14", metricKey: "pulse", value: 60 }],
    });
    const outcome = evaluateFatigueCause(packet, "easy");
    assert.equal(outcome.kind, "confirmed");
    if (outcome.kind === "confirmed") assert.equal(outcome.adviceKey, "cause_confirmed_tired_rhr");
  });
  test("regression: tired but baseline too thin (2 points) -> generic, never names RHR", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }),
      history: easyHistoryBaseline(),
      memoryItems: [{ type: "health_status", text: "Тяжело, устала", date: "2026-07-15" }],
      healthProfile: { hasPulse: true, hasSleepHours: false, hasHrv: false, hasBodyBattery: false },
      healthMetrics: [
        { metricDate: "2026-07-01", metricKey: "pulse", value: 55 },
        { metricDate: "2026-07-03", metricKey: "pulse", value: 55 },
        { metricDate: "2026-07-15", metricKey: "pulse", value: 62 },
      ],
    });
    const outcome = evaluateFatigueCause(packet, "easy");
    assert.equal(outcome.kind, "confirmed");
    if (outcome.kind === "confirmed") assert.equal(outcome.adviceKey, "cause_confirmed_tired_generic");
  });
  test("HRV declining trend confirms (words only), single spike does not", () => {
    const priorHrv = ["06-27", "06-29", "07-01", "07-03", "07-05"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "hrv" as const, value: 60 }));
    const recentHrvDown = ["07-08", "07-10", "07-11", "07-13"].map((d) => ({ metricDate: `2026-${d}`, metricKey: "hrv" as const, value: 50 }));
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }),
      history: easyHistoryBaseline(),
      memoryItems: [{ type: "health_status", text: "Тяжело далось", date: "2026-07-15" }],
      healthProfile: { hasPulse: false, hasSleepHours: false, hasHrv: true, hasBodyBattery: false },
      healthMetrics: [...priorHrv, ...recentHrvDown],
    });
    const outcome = evaluateFatigueCause(packet, "easy");
    assert.equal(outcome.kind, "confirmed");
    if (outcome.kind === "confirmed") {
      assert.equal(outcome.adviceKey, "cause_confirmed_tired_hrv_trend");
      // honesty: no HRV number leaks into the observation's numbers (allowedNumbers is comparison-only anyway)
      assert.equal("hrvToday" in outcome.numbers, false);
      assert.equal("hrvRecent" in outcome.numbers, false);
    }
  });
});

describe("planObservations — orchestrator", () => {
  test("clean easy run: default praise, no fabricated correction", () => {
    const observations = planObservations(basePacket());
    assert.ok(observations.some((o) => o.type === "praise"));
    assert.ok(!observations.some((o) => o.type === "correction"));
  });

  test("disciplined negative split ends up praised and focused", () => {
    const observations = planObservations(basePacket({ laps: negSplitLaps(141) }));
    const praise = observations.find((o) => o.adviceKey === "praise_negative_split");
    assert.ok(praise);
    assert.equal(praise!.focused, true);
    assert.ok(!observations.some((o) => o.adviceKey.startsWith("correction_second_half_surge")));
  });

  test("surging negative split is corrected, never praised", () => {
    const observations = planObservations(basePacket({ laps: negSplitLaps(155) }));
    assert.ok(observations.some((o) => o.adviceKey === "correction_second_half_surge_easy"));
    assert.ok(!observations.some((o) => o.adviceKey === "praise_negative_split"));
  });

  test("hr_trusted=false: coach signal fires, HR-dependent slots stay silent", () => {
    const observations = planObservations(
      basePacket({
        workout: { workoutId: 1, workoutDate: "2026-07-15", title: "Длительная" },
        current: baseCurrent({ hrTrusted: false, hrQuality: "unreliable", hrDecouplingPct: 8, durationS: 4000 }),
      })
    );
    assert.ok(observations.some((o) => o.adviceKey === "signal_hr_untrusted" && o.type === "coach_signal"));
    assert.ok(!observations.some((o) => o.adviceKey === "correction_hr_drift_tempo"));
  });

  test("interval fade fires as a correction", () => {
    const observations = planObservations(
      basePacket({
        current: baseCurrent({ comparisonKey: "5x[400meter]", repsDetectedCount: 5, repPaceFadePct: 15 }),
      })
    );
    assert.ok(observations.some((o) => o.adviceKey === "correction_interval_fade"));
  });

  test("focus caps at FOCUS_CAP; coach_signal is never focused", () => {
    const observations = planObservations(
      basePacket({
        workout: { workoutId: 1, workoutDate: "2026-07-15", title: "Длительная" },
        current: baseCurrent({ hrTrusted: false, durationS: 4000, avgPaceSecPerKm: 400, pctTimePaceTarget: null }),
        laps: negSplitLaps(141),
      })
    );
    const focused = observations.filter((o) => o.focused);
    assert.ok(focused.length <= FOCUS_CAP);
    assert.ok(!focused.some((o) => o.type === "coach_signal"));
    assert.ok(observations.length >= focused.length);
  });
});
