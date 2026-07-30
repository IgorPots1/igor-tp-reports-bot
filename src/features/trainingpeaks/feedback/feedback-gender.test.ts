import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateFeedbackDraft } from "./feedback-factcheck.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";

const base: FeedbackContextPacket = {
  workoutId: 1, workoutDate: "2026-07-30", title: "Лёгкая", sessionType: "easy", sex: "male", register: "ty",
  hrTrusted: true, workoutHeader: "", observationsBlock: "", comparisonBlock: "", fewshotsText: "", fewshotsUsed: [],
  allowedNumbers: [], comparisonBaseline: null, studentWords: [], observations: [], groupBound: false,
};
const ok = (draft: string, o: Partial<FeedbackContextPacket> = {}) => validateFeedbackDraft({ draft, packet: { ...base, ...o } }).ok;

describe("gender — feminine forms for a male athlete (the reported leak)", () => {
  test("reject the forms the old denylist MISSED", () => {
    for (const d of ["Ты сегодня справилась 👍", "Молодец, начала ровно и смогла добежать", "Ты готова была прибавить, рада за прогресс", "Разложилась во второй половине", "Ты потерпела и выдержала темп", "Хорошо, только устала под конец"]) {
      assert.equal(ok(d, { sex: "male" }), false, d);
    }
  });
  test("correct masculine draft for a male → ok", () => {
    assert.equal(ok("Отлично пробежал, разложился и почти не устал 👍", { sex: "male" }), true);
  });
});

describe("gender — no false positives (feminine NOUN subjects)", () => {
  test("«тренировка прошла» / «концовка далась» for a male → ok (noun subject, not the athlete)", () => {
    assert.equal(ok("Тренировка прошла хорошо, концовка далась тяжелее", { sex: "male" }), true);
    assert.equal(ok("Серия удалась, длительная получилась ровной", { sex: "male" }), true);
  });
  test("feminine common NOUNS (сила/работа/погода) for a male → ok", () => {
    assert.equal(ok("Сила есть, работа хорошая, погода помогла", { sex: "male" }), true);
  });
});

describe("gender — female athlete", () => {
  test("masculine forms for a female → reject", () => {
    assert.equal(ok("Отлично пробежал, справился 👍", { sex: "female" }), false);
  });
  test("correct feminine draft for a female → ok", () => {
    assert.equal(ok("Отлично пробежала, справилась и разложилась 👍", { sex: "female" }), true);
  });
});

describe("gender — sex unknown (null) no longer silently feminine", () => {
  test("gendered draft (either sex) → reject, don't guess", () => {
    assert.equal(ok("Отлично пробежала 👍", { sex: null }), false);
    assert.equal(ok("Отлично пробежал 👍", { sex: null }), false);
  });
  test("gender-neutral draft → ok", () => {
    assert.equal(ok("Отлично, ровно и спокойно, держи темп 👍", { sex: null }), true);
  });
});
