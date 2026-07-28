import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractStatedFactorsDeterministic, resolveStatedCause, hasDeviceGlitch, deviceGlitchScope, isFactorGrounded } from "./stated-factors.ts";
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

describe("deviceGlitchScope — GPS gates pace/distance, watch gates HR (Блок 5)", () => {
  const scope = (text: string) => deviceGlitchScope(extractStatedFactorsDeterministic([msg(text)], WD));
  test("GPS glitch → pace/distance untrusted, HR left alone (Карнаух)", () => {
    assert.deepEqual(scope("GPS не поймал, темп непонятный"), { hr: false, paceDistance: true });
  });
  test("watch «странно себя ведут» → HR only (прежнее поведение, Бучкина)", () => {
    assert.deepEqual(scope("часы странно себя ведут"), { hr: true, paceDistance: false });
  });
  test("pulse-specific → HR only", () => {
    assert.deepEqual(scope("пульс завышен, датчик врёт"), { hr: true, paceDistance: false });
  });
  test("нет глюка → ничего не гасим", () => {
    assert.deepEqual(deviceGlitchScope([]), { hr: false, paceDistance: false });
  });
});

describe("nutrition — еда как контекст (Кукушкина/Надя)", () => {
  const f = (text: string) => extractStatedFactorsDeterministic([msg(text)], WD).map((x) => x.factor);
  test("«съела овсянку с бананом перед бегом» → nutrition", () => {
    assert.ok(f("Перед бегом съела овсянку с бананом и кленовый сироп").includes("nutrition"));
  });
  test("«без гелей на длинной тяжело» → nutrition", () => {
    assert.ok(f("без гелей на длинной под конец совсем тяжело").includes("nutrition"));
  });
  test("«натощак, сил не хватило» → nutrition", () => {
    assert.ok(f("побежала натощак, сил не хватило").includes("nutrition"));
  });
  test("вода остаётся dehydration, НЕ nutrition", () => {
    const got = f("не пил воду, забыл взять");
    assert.ok(got.includes("dehydration"));
    assert.ok(!got.includes("nutrition"));
  });
  test("«всё отлично, пульс ровный» → без фактора еды", () => {
    assert.ok(!f("всё отлично, пульс ровный").includes("nutrition"));
  });
});

// Block #3 — quote-grounding. Haiku returns {factor, quote}; the quote must carry a domain word for
// that factor or the label is dropped as misattribution. Cases below are drawn from real drops/keeps
// measured on 30 days of resolved causes.
describe("isFactorGrounded — цитата должна нести слово из домена фактора", () => {
  test("кейс Анастасии: еда, приписанная к обезвоживанию, отваливается; та же цитата под nutrition — остаётся", () => {
    const q = "утром только два тоста с джемом съела";
    assert.equal(isFactorGrounded("dehydration", q), false, "«два тоста» не про воду — отвал");
    assert.equal(isFactorGrounded("nutrition", q), true, "«тост/джем/съела» — это еда, остаётся");
  });
  test("крепатура мышц после приседаний грунтуется как muscle_doms", () => {
    assert.equal(isFactorGrounded("muscle_doms", "мышцы бедра забиты, вчера были приседания"), true);
  });
  test("боль в животе/желудке НЕ грунтуется как суставная травма", () => {
    assert.equal(isFactorGrounded("soreness", "живот так же болел"), false);
    assert.equal(isFactorGrounded("soreness", "разболелся желудок и еле добежала"), false);
  });
  test("реальная суставная жалоба грунтуется как soreness", () => {
    assert.equal(isFactorGrounded("soreness", "колено ноет после спуска"), true);
    assert.equal(isFactorGrounded("soreness", "нога иногда тянет"), true);
  });
  test("«+30» без значка градуса всё равно жара", () => {
    assert.equal(isFactorGrounded("heat", "там было +30 и я думала что умру"), true);
    assert.equal(isFactorGrounded("heat", "было жарковато"), true);
  });
  test("дождь и маршрут/дороги грунтуются как conditions", () => {
    assert.equal(isFactorGrounded("conditions", "побегала в дождь первый раз"), true);
    assert.equal(isFactorGrounded("conditions", "маршрут с учётом ремонта дорог"), true);
  });
  test("выгорание/операция и «устала» грунтуются как жизненный стресс", () => {
    assert.equal(isFactorGrounded("life_stress", "реальное выгорание из-за предстоящей операции"), true);
    assert.equal(isFactorGrounded("life_stress", "Устала"), true);
  });
  test("ночь без сна грунтуется как недосып", () => {
    assert.equal(isFactorGrounded("undersleep", "у меня сегодня была ночь без сна"), true);
  });
  test("пустая цитата и неизвестный фактор — fail-open (не отваливаем то, что не можем судить)", () => {
    assert.equal(isFactorGrounded("dehydration", ""), true);
    assert.equal(isFactorGrounded("dehydration", "   "), true);
    // @ts-expect-error — фактор вне карты грунта → fail-open
    assert.equal(isFactorGrounded("unknown_kind", "любой текст"), true);
  });
});
