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
    observations: [],
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
    history: [], lastPraise: null, laps: [], memoryItems: [], healthMetrics: [], healthProfile: null,
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
