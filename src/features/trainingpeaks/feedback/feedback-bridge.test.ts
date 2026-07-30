import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateFeedbackDraft } from "./feedback-factcheck.ts";
import { buildFeedbackContextPacket, type FeedbackContextPacket } from "./context-packet.ts";
import { assembleFeedbackPrompt } from "./feedback-prompt.ts";
import { resolveFeedbackGeneratorBackend } from "./feedback-generator.ts";
import type { ContextPacket, PlannerDerivedMetrics } from "./types.ts";

function basePacket(overrides: Partial<FeedbackContextPacket> = {}): FeedbackContextPacket {
  return {
    workoutId: 1,
    workoutDate: "2026-07-15",
    title: "Лёгкая",
    sessionType: "easy",
    sex: "female",
    register: "ty",
    hrTrusted: true,
    workoutHeader: "Тип: лёгкая.",
    observationsBlock: "- [ПОХВАЛА] чисто",
    comparisonBlock: "Сравнения нет.",
    fewshotsText: "- Молодец 👍",
    fewshotsUsed: ["A×4"],
    allowedNumbers: [],
    comparisonBaseline: null,
    studentWords: [],
    observations: [],
    groupBound: false,
    ...overrides,
  };
}

describe("feedback fact-check", () => {
  test("clean qualitative draft passes", () => {
    const r = validateFeedbackDraft({ draft: "Молодец 👍 всё ровно, пульс держался", packet: basePacket() });
    assert.equal(r.ok, true);
  });
  test("absolute pace token → fail", () => {
    const r = validateFeedbackDraft({ draft: "Отлично 👍 первый отрезок 4:20, дальше выровняла", packet: basePacket() });
    assert.equal(r.ok, false);
  });
  test("number not in allowedNumbers → fail", () => {
    const r = validateFeedbackDraft({ draft: "Пульс держался в среднем 145, молодец", packet: basePacket({ allowedNumbers: [] }) });
    assert.equal(r.ok, false);
  });
  test("comparison delta that IS in allowedNumbers → ok", () => {
    const r = validateFeedbackDraft({ draft: "Отлично 👍 темп на 13 с/км быстрее, чем раньше", packet: basePacket({ allowedNumbers: [13] }) });
    assert.equal(r.ok, true);
  });
  test("masculine form for female → fail", () => {
    const r = validateFeedbackDraft({ draft: "Отлично пробежал 👍", packet: basePacket({ sex: "female" }) });
    assert.equal(r.ok, false);
  });
  test("masculine form for male → ok", () => {
    const r = validateFeedbackDraft({ draft: "Отлично пробежал 👍 чисто", packet: basePacket({ sex: "male" }) });
    assert.equal(r.ok, true);
  });
  test("C7: pulse mention on untrusted HR → fail", () => {
    const r = validateFeedbackDraft({ draft: "Молодец 👍 пульс ровный", packet: basePacket({ hrTrusted: false }) });
    assert.equal(r.ok, false);
  });

  // Block 2 — register: body must not drift to "ты" for a formal ("вы") student.
  test("«ты»-pronoun body for register=vy → fail (Grushevskaya «Ты написала»)", () => {
    const r = validateFeedbackDraft({ draft: "Здравствуйте! Длительная прошла хорошо. Ты написала «полегче»", packet: basePacket({ register: "vy", sex: "female" }) });
    assert.equal(r.ok, false);
  });
  test("2sg verb «держишь» for register=vy → fail", () => {
    const r = validateFeedbackDraft({ draft: "Здравствуйте! ты слишком быстро начинаешь", packet: basePacket({ register: "vy", sex: "female" }) });
    assert.equal(r.ok, false);
  });
  test("proper «вы» body → ok", () => {
    const r = validateFeedbackDraft({ draft: "Здравствуйте! Вы держались ровно, постарайтесь и дальше так", packet: basePacket({ register: "vy", sex: "female" }) });
    assert.equal(r.ok, true);
  });
  test("workout-subject «прошла» is NOT a ты-marker for vy → ok", () => {
    const r = validateFeedbackDraft({ draft: "Здравствуйте! Длительная прошла отлично, пульс держался ровно", packet: basePacket({ register: "vy", sex: "female" }) });
    assert.equal(r.ok, true);
  });
  test("«ты» body for register=ty → ok (unchanged)", () => {
    const r = validateFeedbackDraft({ draft: "Привет! ты держался ровно, молодец", packet: basePacket({ register: "ty", sex: "male" }) });
    assert.equal(r.ok, true);
  });
});

function plannerInput(current: Partial<PlannerDerivedMetrics>): ContextPacket {
  return {
    studentId: "s1",
    sex: "female",
    telegramFormality: "ty",
    workout: { workoutId: 1, workoutDate: "2026-07-15", title: "Лёгкая" },
    current: {
      workoutId: 1, workoutDate: "2026-07-15", workoutType: "run", comparisonKey: null, repsDetectedCount: null,
      repPaces: null, repPeakHrs: null, repPaceFadePct: null, repRecoveryDrops: null, avgHr: 140, hrTrusted: true, hrQuality: "good",
      avgPaceSecPerKm: 330, durationS: 2400, hrDecouplingPct: 1, aerobicEf: null, repPaceCv: null, pctTimeHrTarget: null,
      pctTimePaceTarget: null, paceTrusted: true, distanceTrusted: true, hasFit: true, fallbackLevel: "fit_full", ...current,
    },
    history: [], lastPraise: null, laps: [], memoryItems: [], studentMessages: [], healthMetrics: [], healthProfile: null,
  };
}

describe("context-packet data-integrity → sensor-glitch words draft (правка 2)", () => {
  // Data-integrity issues no longer go silent: they produce a numbers-free "how did it
  // feel?" draft (allowedNumbers empty, hrTrusted false) instead of a blocked coach signal.
  test("no FIT → words draft, not blocked", () => {
    const r = buildFeedbackContextPacket(plannerInput({ hasFit: false }));
    assert.equal(r.blocked, false);
    if (!r.blocked) {
      assert.deepEqual(r.packet.allowedNumbers, []);
      assert.equal(r.packet.hrTrusted, false);
      assert.match(r.packet.observationsBlock, /НЕДОСТОВЕРНЫ|ощущени/u);
    }
  });
  test("summary_only fallback → words draft, not blocked", () => {
    const r = buildFeedbackContextPacket(plannerInput({ fallbackLevel: "summary_only" }));
    assert.equal(r.blocked, false);
  });
  test("untrusted pace → words draft, not blocked", () => {
    const r = buildFeedbackContextPacket(plannerInput({ paceTrusted: false }));
    assert.equal(r.blocked, false);
    if (!r.blocked) assert.deepEqual(r.packet.allowedNumbers, []);
  });
  test("clean fit_full workout → not blocked, builds a packet", () => {
    const r = buildFeedbackContextPacket(plannerInput({}));
    assert.equal(r.blocked, false);
    if (!r.blocked) {
      assert.ok(r.packet.observationsBlock.length > 0);
      assert.equal(r.packet.sex, "female");
    }
  });
});

describe("student-words channel (наряд: слова ученика → черновик)", () => {
  function inputWithMessages(messages: ContextPacket["studentMessages"]): ContextPacket {
    const base = plannerInput({});
    return { ...base, workout: { ...base.workout, workoutDate: "2026-07-15" }, studentMessages: messages };
  }

  test("окно дата−1..+2: ловит отчёт про тренировку, НЕ тащит болтовню недельной давности", () => {
    const r = buildFeedbackContextPacket(inputWithMessages([
      { text: "было 30-31°С, трудно бегать интервалы", date: "2026-07-15", labels: ["report_like"] },
      { text: "старый вопрос про план недельной давности", date: "2026-07-08", labels: ["unknown"] },
    ]));
    assert.equal(r.blocked, false);
    if (!r.blocked) {
      assert.ok(r.packet.studentWords.some((w) => w.includes("30-31°С")), "должен поймать отчёт про жару");
      assert.ok(!r.packet.studentWords.some((w) => w.includes("недельной давности")), "не должен тащить старое");
    }
  });

  test("триггер-якорь: вчерашний отчёт про ДРУГОЙ бег не тащится, сегодняшний + follow-up остаются (Левина)", () => {
    const base = plannerInput({});
    const packet: ContextPacket = {
      ...base,
      workout: { ...base.workout, workoutDate: "2026-07-15" },
      triggerObservedAt: "2026-07-15T13:04:00Z",
      studentMessages: [
        { text: "вчера выбежала, ни часов не взяла", date: "2026-07-14", at: "2026-07-14T13:00:00Z", labels: ["report_like"] },
        { text: "сегодня 5 км за 35 минут, как в плане", date: "2026-07-15", at: "2026-07-15T13:04:00Z", labels: ["report_like"] },
        { text: "ну вроде стабильно", date: "2026-07-15", at: "2026-07-15T13:10:00Z", labels: ["unknown"] },
      ],
    };
    const r = buildFeedbackContextPacket(packet);
    if (!r.blocked) {
      assert.ok(r.packet.studentWords.some((w) => w.includes("5 км за 35")), "сегодняшний отчёт остаётся");
      assert.ok(r.packet.studentWords.some((w) => w.includes("стабильно")), "same-day follow-up остаётся");
      assert.ok(!r.packet.studentWords.some((w) => w.includes("вчера выбежала")), "вчерашний отчёт про другой бег НЕ тащится");
    }
  });

  test("без триггера — прежнее окно дата−1..+2 (фолбэк для тестов/пересборок)", () => {
    const r = buildFeedbackContextPacket(inputWithMessages([
      { text: "вчера тоже бегала, было норм", date: "2026-07-14", labels: ["report_like"] },
    ]));
    // нет triggerObservedAt → старое поведение: −1 день попадает
    if (!r.blocked) assert.ok(r.packet.studentWords.some((w) => w.includes("вчера тоже бегала")));
  });

  test("report_like в приоритете над прочими сообщениями в окне", () => {
    const r = buildFeedbackContextPacket(inputWithMessages([
      { text: "спасибо, до встречи", date: "2026-07-15", labels: ["unknown"] },
      { text: "сегодня очень тяжело, ноги ватные", date: "2026-07-15", labels: ["report_like"] },
    ]));
    if (!r.blocked) assert.deepEqual(r.packet.studentWords, ["сегодня очень тяжело, ноги ватные"]);
  });

  test("assembled prompt показывает слова ученика + правила «причина не вина» и «не цитируй числа»", () => {
    const r = buildFeedbackContextPacket(inputWithMessages([
      { text: "было 30-31°С, трудно", date: "2026-07-15", labels: ["report_like"] },
    ]));
    if (!r.blocked) {
      const prompt = assembleFeedbackPrompt(r.packet);
      assert.ok(prompt.includes("30-31°С"), "слова ученика в промпте");
      assert.ok(prompt.includes("причина, не вина"), "правило причина-не-вина");
      assert.match(prompt, /НЕ повторяй|переводи в слова/u, "правило не цитировать числа");
    }
  });

  test("РЕГРЕСС: факт-чек отклоняет черновик, процитировавший число из слов ученика (30)", () => {
    // studentWords дают модели «30-31°С», но факт-чек держит: 30 нет в allowedNumbers.
    const r = validateFeedbackDraft({ draft: "Привет! В жару 30 было тяжело, молодец", packet: basePacket({ allowedNumbers: [] }) });
    assert.equal(r.ok, false);
  });
});

describe("prompt assembly + backend switch", () => {
  test("assembled prompt fills every placeholder", () => {
    const prompt = assembleFeedbackPrompt(basePacket({ comparisonBlock: "Темп на 13 с/км быстрее.", allowedNumbers: [13] }));
    assert.ok(!prompt.includes("{{"));
    assert.ok(prompt.includes("Тип: лёгкая"));
    assert.ok(prompt.includes("Темп на 13 с/км быстрее"));
  });
  test("backend defaults to cowork; api only when env=api", () => {
    const prev = process.env.FEEDBACK_GENERATOR;
    delete process.env.FEEDBACK_GENERATOR;
    assert.equal(resolveFeedbackGeneratorBackend(), "cowork");
    process.env.FEEDBACK_GENERATOR = "api";
    assert.equal(resolveFeedbackGeneratorBackend(), "api");
    if (prev === undefined) delete process.env.FEEDBACK_GENERATOR;
    else process.env.FEEDBACK_GENERATOR = prev;
  });
});
