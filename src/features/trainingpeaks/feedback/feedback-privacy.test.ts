import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isSensitiveTopic } from "./sensitive-topics.ts";
import { suppressAnsweredPersistentFactors } from "./stated-factors.ts";
import { validateFeedbackDraft } from "./feedback-factcheck.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";
import type { StatedFactor } from "./types.ts";

// Privacy (б): the sensitive-topic classifier that keeps medical/personal content out of group drafts.
describe("isSensitiveTopic", () => {
  test("medical/personal topics → true", () => {
    for (const t of ["предстоящая операция", "была у врача", "хроническая болезнь", "выгорание ко всему", "колено побаливает", "растяжение", "депрессия накрыла", "обследование в четверг"]) {
      assert.equal(isSensitiveTopic(t), true, t);
    }
  });
  test("ordinary training talk → false", () => {
    for (const t of ["устал сегодня", "было тяжело под конец", "ноги забиты после силовой", "всё хорошо, пробежал ровно", "жара, пил больше воды", "больше не разгонялся"]) {
      assert.equal(isSensitiveTopic(t), false, t);
    }
  });
});

// Privacy (в): a persistent factor already answered by the coach must not be re-raised.
describe("suppressAnsweredPersistentFactors", () => {
  const trigger = "2026-07-30T06:00:00Z";
  const persistent = (date: string): StatedFactor => ({ factor: "undersleep", quote: "почти не спал", date, recurring: true });
  const tight = (date: string): StatedFactor => ({ factor: "heat", quote: "жара", date, recurring: false });

  test("raised earlier + coach touched since → dropped", () => {
    const out = suppressAnsweredPersistentFactors([persistent("2026-07-28")], "2026-07-29T10:00:00Z", trigger);
    assert.equal(out.length, 0);
  });
  test("raised earlier but coach touch is BEFORE the raise → kept", () => {
    const out = suppressAnsweredPersistentFactors([persistent("2026-07-28")], "2026-07-27T10:00:00Z", trigger);
    assert.equal(out.length, 1);
  });
  test("raised TODAY (trigger day) → fresh, kept even if coach touched", () => {
    const out = suppressAnsweredPersistentFactors([persistent("2026-07-30")], "2026-07-30T05:00:00Z", trigger);
    assert.equal(out.length, 1);
  });
  test("tight-window (non-persistent) factor never suppressed", () => {
    const out = suppressAnsweredPersistentFactors([tight("2026-07-28")], "2026-07-29T10:00:00Z", trigger);
    assert.equal(out.length, 1);
  });
  test("no coach touch → unchanged", () => {
    const fs = [persistent("2026-07-28")];
    assert.equal(suppressAnsweredPersistentFactors(fs, null, trigger).length, 1);
  });
});

// Privacy (б) insurance gate in the factcheck.
describe("factcheck — group-bound sensitive gate", () => {
  const base: FeedbackContextPacket = {
    workoutId: 1, workoutDate: "2026-07-30", title: "Лёгкая", sessionType: "easy", sex: "female", register: "ty",
    hrTrusted: true, workoutHeader: "", observationsBlock: "", comparisonBlock: "", fewshotsText: "", fewshotsUsed: [],
    allowedNumbers: [], comparisonBaseline: null, studentWords: [], observations: [], groupBound: false,
  };
  test("group-bound draft with medical topic → reject", () => {
    const r = validateFeedbackDraft({ draft: "Молодец) слышала про операцию, держись", packet: { ...base, groupBound: true } });
    assert.equal(r.ok, false);
  });
  test("PRIVATE (dm) draft with the same topic → allowed (личка)", () => {
    const r = validateFeedbackDraft({ draft: "Молодец) слышала про операцию, держись", packet: { ...base, groupBound: false } });
    assert.equal(r.ok, true);
  });
  test("group-bound clean draft → allowed", () => {
    const r = validateFeedbackDraft({ draft: "Отлично, ровно отработала, пульс держался 👍", packet: { ...base, groupBound: true } });
    assert.equal(r.ok, true);
  });
});
