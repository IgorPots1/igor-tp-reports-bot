import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { detectNegativeSelfReport, matchNegativeSelfReport } from "./negative-self-report.ts";
import type { ContextPacket } from "./types.ts";

describe("matchNegativeSelfReport — #4 hardship words", () => {
  test("catches Igor's examples", () => {
    assert.ok(matchNegativeSelfReport(["Еле добежала сегодня"]));
    assert.ok(matchNegativeSelfReport(["Плохо прошла тренировка"]));
    assert.ok(matchNegativeSelfReport(["Было тяжело, еле дотянул"]));
    assert.ok(matchNegativeSelfReport(["Ноги тяжёлые, не бежали совсем"]));
    assert.ok(matchNegativeSelfReport(["темп ок, но ноги как свинцовые"]));
  });
  test("normal / positive reports are NOT flagged (регресс-гард)", () => {
    assert.equal(matchNegativeSelfReport(["Всё отлично, бежалось легко"]), null);
    assert.equal(matchNegativeSelfReport(["Отбегала, все нормально"]), null);
    assert.equal(matchNegativeSelfReport(["Хорошо👍🏻 пободрее сегодня"]), null);
    assert.equal(matchNegativeSelfReport(["Огонь"]), null);
  });
  test("negation of the hardship does NOT fire («не тяжело», «неплохо», «не устала»)", () => {
    assert.equal(matchNegativeSelfReport(["Совсем не тяжело, наоборот бодро"]), null);
    assert.equal(matchNegativeSelfReport(["Прошло неплохо"]), null);
    assert.equal(matchNegativeSelfReport(["не устала ) Все отлично"]), null);
  });
  test("«елена»/«неплохо» don't false-match on stems", () => {
    assert.equal(matchNegativeSelfReport(["Привет от Елены, всё супер"]), null);
  });
  test("returns the offending phrase for the coach panel", () => {
    assert.equal(matchNegativeSelfReport(["Еле добежал🫣"]), "Еле добежал🫣");
  });
});

describe("detectNegativeSelfReport — windows to THIS run", () => {
  const base: ContextPacket = {
    studentId: "s1", sex: "female", telegramFormality: "ty",
    workout: { workoutId: 1, workoutDate: "2026-07-15", title: "Интервалы" },
    current: { workoutId: 1, workoutDate: "2026-07-15", workoutType: "run", comparisonKey: null, repsDetectedCount: null, repPaces: null, repPeakHrs: null, repPaceFadePct: null, repRecoveryDrops: null, avgHr: 140, hrTrusted: true, hrQuality: "good", avgPaceSecPerKm: 330, durationS: 2400, hrDecouplingPct: 1, aerobicEf: null, repPaceCv: null, pctTimeHrTarget: null, pctTimePaceTarget: null, paceTrusted: true, distanceTrusted: true },
    history: [], lastPraise: null, laps: [], memoryItems: [], studentMessages: [], healthMetrics: [], healthProfile: null,
  };
  test("same-day report about this run fires", () => {
    const got = detectNegativeSelfReport({ ...base, studentMessages: [{ text: "Еле добежала", date: "2026-07-15", labels: ["report_like"] }] });
    assert.equal(got.negative, true);
    assert.equal(got.quote, "Еле добежала");
  });
  test("a hardship message 5 days away is out of window → not this run", () => {
    const got = detectNegativeSelfReport({ ...base, studentMessages: [{ text: "Было тяжело", date: "2026-07-05", labels: ["report_like"] }] });
    assert.equal(got.negative, false);
  });
  test("positive same-day report → not negative", () => {
    const got = detectNegativeSelfReport({ ...base, studentMessages: [{ text: "Всё легко и бодро", date: "2026-07-15", labels: ["report_like"] }] });
    assert.equal(got.negative, false);
  });
});
