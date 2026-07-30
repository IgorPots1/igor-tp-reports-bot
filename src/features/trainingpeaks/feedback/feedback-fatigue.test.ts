import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateFeedbackDraft } from "./feedback-factcheck.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";

const base: FeedbackContextPacket = {
  workoutId: 1, workoutDate: "2026-07-30", title: "Интервалы", sessionType: "interval", sex: "male", register: "ty",
  hrTrusted: true, workoutHeader: "", observationsBlock: "", comparisonBlock: "", fewshotsText: "", fewshotsUsed: [],
  allowedNumbers: [], comparisonBaseline: null, studentWords: [], observations: [], groupBound: false,
};
const praiseObs = [{ type: "praise", adviceKey: "praise_even_pace", focused: true, reason: "" }, { type: "coach_signal", adviceKey: "cause_confirmed_heat", focused: false, reason: "" }];

describe("anti-fabricated-fatigue (Сорокин)", () => {
  test("«стало тяжелее к концу» with only praise/heat signals + no student words → reject", () => {
    const r = validateFeedbackDraft({ draft: "Серия в целом хорошо, но ближе к концу отрезки явно стали тяжелее", packet: { ...base, observations: praiseObs } });
    assert.equal(r.ok, false);
  });
  test("«давались с трудом» fabricated → reject", () => {
    const r = validateFeedbackDraft({ draft: "Начало ровно, но последние отрезки давались с трудом", packet: { ...base, observations: praiseObs } });
    assert.equal(r.ok, false);
  });
  test("same claim BUT a real fade signal fired → allowed", () => {
    const r = validateFeedbackDraft({ draft: "К концу отрезки стали тяжелее, чуть просел темп", packet: { ...base, observations: [{ type: "correction", adviceKey: "correction_interval_fade", focused: true, reason: "" }] } });
    assert.equal(r.ok, true);
  });
  test("same claim BUT the student said it was hard → allowed", () => {
    const r = validateFeedbackDraft({ draft: "Да, к концу стало тяжелее, ты молодец что дотерпел", packet: { ...base, observations: praiseObs, studentWords: ["последние отрезки было тяжело"] } });
    assert.equal(r.ok, true);
  });
  test("clean praise draft (no fatigue claim) → allowed", () => {
    const r = validateFeedbackDraft({ draft: "Отлично, серия ровная, темп держал, молодец 👍", packet: { ...base, observations: praiseObs } });
    assert.equal(r.ok, true);
  });
  test("neutral «в жару тяжело» (not a comparative end-fade) → allowed", () => {
    const r = validateFeedbackDraft({ draft: "В жару бежать тяжело, но ты справился ровно 👍", packet: { ...base, observations: praiseObs } });
    assert.equal(r.ok, true);
  });
});
