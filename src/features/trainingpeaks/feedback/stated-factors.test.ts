import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractStatedFactorsDeterministic, resolveStatedCause, hasDeviceGlitch } from "./stated-factors.ts";
import { planObservations } from "./observation-planner.ts";
import type { ContextPacket, PlannerDerivedMetrics, PlannerStudentMessage, StatedFactor } from "./types.ts";

const WD = "2026-07-15";

function msg(text: string, date = WD): PlannerStudentMessage {
  return { text, date, labels: ["report_like"] };
}

function baseCurrent(overrides: Partial<PlannerDerivedMetrics> = {}): PlannerDerivedMetrics {
  return {
    workoutId: 1, workoutDate: WD, workoutType: "run", comparisonKey: null, repsDetectedCount: null,
    repPaces: null, repPeakHrs: null, repPaceFadePct: null, repRecoveryDrops: null, avgHr: 140,
    hrTrusted: true, hrQuality: "good", avgPaceSecPerKm: 330, durationS: 2400, hrDecouplingPct: 1,
    aerobicEf: null, repPaceCv: null, pctTimeHrTarget: null, pctTimePaceTarget: null,
    paceTrusted: true, distanceTrusted: true, ...overrides,
  };
}

function easyHistoryBaseline(): PlannerDerivedMetrics[] {
  return Array.from({ length: 6 }, (_, i) => baseCurrent({ workoutId: 100 + i, workoutDate: `2026-06-${10 + i}`, avgHr: 130 }));
}

function basePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    studentId: "s1", sex: "female", telegramFormality: "ty",
    workout: { workoutId: 1, workoutDate: WD, title: "Лёгкая" },
    current: baseCurrent(), history: [], lastPraise: null, laps: [],
    memoryItems: [], studentMessages: [], healthMetrics: [], healthProfile: null, ...overrides,
  };
}

describe("stated-factors — deterministic extractor (fallback, paraphrase coverage)", () => {
  const cases: Array<{ text: string; factor: StatedFactor["factor"] }> = [
    { text: "воду не брала на длительную", factor: "dehydration" },
    { text: "забыла попить перед бегом", factor: "dehydration" },
    { text: "пила мало сегодня", factor: "dehydration" },
    { text: "было очень жарко, духота на улице", factor: "heat" },
    { text: "мало спал, не выспался совсем", factor: "undersleep" },
    { text: "затеяли ремонт дома, устаю очень по жизни", factor: "life_stress" },
    { text: "болит колено после вчерашнего", factor: "soreness" },
    { text: "болел на неделе, горло ещё", factor: "illness" },
    { text: "бежала по горкам, рельеф тяжёлый", factor: "conditions" },
  ];
  for (const c of cases) {
    test(`«${c.text}» → ${c.factor}`, () => {
      const factors = extractStatedFactorsDeterministic([msg(c.text)], WD);
      assert.ok(factors.some((f) => f.factor === c.factor), `expected ${c.factor} in ${JSON.stringify(factors)}`);
    });
  }

  test("recurring: same factor on two distinct days", () => {
    const factors = extractStatedFactorsDeterministic([msg("устаю, ремонт", "2026-07-13"), msg("опять ремонт, вымотал", "2026-07-14")], WD);
    const stress = factors.find((f) => f.factor === "life_stress");
    assert.ok(stress);
    assert.equal(stress.recurring, true);
  });

  test("out-of-window message is ignored", () => {
    const factors = extractStatedFactorsDeterministic([msg("было жарко", "2026-06-01")], WD);
    assert.equal(factors.length, 0);
  });

  test("no factor named → empty", () => {
    assert.equal(extractStatedFactorsDeterministic([msg("отбегала, всё по плану")], WD).length, 0);
  });

  test("negation is respected: «было не жарко, свежо» → NOT heat", () => {
    const factors = extractStatedFactorsDeterministic([msg("забег под дождём, было не жарко, свежо")], WD);
    assert.ok(!factors.some((f) => f.factor === "heat"), `heat must be rejected, got ${JSON.stringify(factors)}`);
  });

  test("negation: «выспалась, спала отлично» → NOT undersleep", () => {
    const factors = extractStatedFactorsDeterministic([msg("выспалась, спала отлично")], WD);
    assert.ok(!factors.some((f) => f.factor === "undersleep"));
  });
});

describe("stated-factors — resolveStatedCause precedence", () => {
  test("illness (care) beats heat", () => {
    const packet = basePacket({ statedFactors: [
      { factor: "heat", quote: "жарко", date: WD, recurring: false },
      { factor: "illness", quote: "простыл", date: WD, recurring: false },
    ] });
    assert.equal(resolveStatedCause(packet)?.adviceKey, "cause_confirmed_illness");
  });

  test("recurring life_stress outranks a one-off heat", () => {
    const packet = basePacket({ statedFactors: [
      { factor: "heat", quote: "жарко", date: WD, recurring: false },
      { factor: "life_stress", quote: "ремонт", date: WD, recurring: true },
    ] });
    assert.equal(resolveStatedCause(packet)?.adviceKey, "cause_confirmed_life_stress");
  });

  test("no factors → null", () => {
    assert.equal(resolveStatedCause(basePacket()), null);
  });

  test("device_glitch is NOT a cause (data-trust signal, not вина)", () => {
    const packet = basePacket({ statedFactors: [{ factor: "device_glitch", quote: "часы странно себя ведут", date: WD, recurring: false }] });
    assert.equal(resolveStatedCause(packet), null);
    assert.equal(hasDeviceGlitch(packet.statedFactors), true);
  });

  test("device_glitch alongside a real cause → cause still resolves, glitch flagged separately", () => {
    const packet = basePacket({ statedFactors: [
      { factor: "device_glitch", quote: "часы врут", date: WD, recurring: false },
      { factor: "heat", quote: "жарко", date: WD, recurring: false },
    ] });
    assert.equal(resolveStatedCause(packet)?.adviceKey, "cause_confirmed_heat");
    assert.equal(hasDeviceGlitch(packet.statedFactors), true);
  });
});

describe("stated-factors — device_glitch extraction", () => {
  const cases = [
    "Часы странно себя ведут, надо разбираться",
    "часы сегодня глючат, пульс наверное кривой",
    "датчик врёт, пульс завышен",
    "сбой часов, потеряла сигнал",
    "пульс наверное кривой сегодня",
  ];
  for (const text of cases) {
    test(`«${text}» → device_glitch`, () => {
      const factors = extractStatedFactorsDeterministic([msg(text)], WD);
      assert.ok(factors.some((f) => f.factor === "device_glitch"), `expected device_glitch in ${JSON.stringify(factors)}`);
    });
  }
});

describe("stated-factors — planner integration + regression", () => {
  // Дима: elevated pulse on an easy run, student said nothing durable, but wrote «жарко».
  test("named factor emits a cause and SUPPRESSES the high-pulse question", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }), // +15 over baseline 130 → pulse trigger fires
      history: easyHistoryBaseline(),
      memoryItems: [],
      statedFactors: [{ factor: "heat", quote: "немного жарко было бежать", date: WD, recurring: false }],
    });
    const obs = planObservations(packet);
    assert.ok(obs.some((o) => o.adviceKey === "cause_confirmed_heat"), "expected cause_confirmed_heat");
    assert.ok(!obs.some((o) => o.adviceKey === "question_high_pulse_unknown"), "question must be suppressed");
  });

  // Regression: SAME packet without a stated factor still asks — the fix must not kill the branch.
  test("no factor + genuinely silent student → high-pulse question STILL fires", () => {
    const packet = basePacket({
      current: baseCurrent({ avgHr: 145 }),
      history: easyHistoryBaseline(),
      memoryItems: [],
      // statedFactors undefined → behaves exactly as before
    });
    const obs = planObservations(packet);
    assert.ok(obs.some((o) => o.adviceKey === "question_high_pulse_unknown"), "question must still fire when truly silent");
  });

  test("empty statedFactors array behaves like no factor (question fires)", () => {
    const packet = basePacket({ current: baseCurrent({ avgHr: 145 }), history: easyHistoryBaseline(), statedFactors: [] });
    const obs = planObservations(packet);
    assert.ok(obs.some((o) => o.adviceKey === "question_high_pulse_unknown"));
  });
});

describe("muscle_doms vs soreness (крепатура ≠ травма, Блок 4)", () => {
  const f = (text: string) => extractStatedFactorsDeterministic([msg(text)], WD).map((x) => x.factor);
  test("Надя: мышцы бедра + вчера приседания → muscle_doms, НЕ soreness", () => {
    const got = f("чувствовала мышцы передней части бедра, вчера были приседания");
    assert.ok(got.includes("muscle_doms"), `ждём muscle_doms, получили ${JSON.stringify(got)}`);
    assert.ok(!got.includes("soreness"), "не должно быть soreness (это не травма)");
  });
  test("«мышцы забиты после силовой» → muscle_doms", () => {
    assert.deepEqual(f("мышцы забиты после силовой"), ["muscle_doms"]);
  });
  test("«крепатура» → muscle_doms", () => {
    assert.deepEqual(f("сильная крепатура сегодня"), ["muscle_doms"]);
  });
  test("«болит колено, потянул» → soreness (травма-сигнал остаётся)", () => {
    const got = f("болит колено, наверное потянул");
    assert.ok(got.includes("soreness"));
    assert.ok(!got.includes("muscle_doms"));
  });
  test("muscle_doms маппится на не-алармовый совет (не soreness)", () => {
    const packet = { statedFactors: [{ factor: "muscle_doms", quote: "мышцы забиты", date: WD, recurring: false }] } as unknown as ContextPacket;
    const cause = resolveStatedCause(packet);
    assert.equal(cause?.adviceKey, "cause_confirmed_muscle_doms");
  });
});
