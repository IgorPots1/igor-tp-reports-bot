import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractAskedQuestionKeys, isQuestionOnPause } from "./question-pause.ts";

describe("extractAskedQuestionKeys", () => {
  test("recognises the recovery question", () => {
    assert.deepEqual(extractAskedQuestionKeys("Молодец) Объём растёт, успеваешь восстанавливаться?"), ["question_accumulated_load"]);
  });
  test("recognises the elevated-pulse question", () => {
    assert.deepEqual(extractAskedQuestionKeys("Пульс был чуть выше обычного, как самочувствие?"), ["question_high_pulse_unknown"]);
  });
  test("a plain praise with no question → nothing", () => {
    assert.deepEqual(extractAskedQuestionKeys("Отличная серия, ровно от первого до последнего 👍"), []);
  });
  test("empty / null → []", () => {
    assert.deepEqual(extractAskedQuestionKeys(null), []);
    assert.deepEqual(extractAskedQuestionKeys(""), []);
  });
});

describe("isQuestionOnPause", () => {
  const KEY = "question_accumulated_load";
  const asked = (date: string) => [{ adviceKey: KEY, date }];

  test("never asked → not on pause", () => {
    assert.equal(isQuestionOnPause({ adviceKey: KEY, recentlyAsked: [], coachTouchAt: null, workoutDate: "2026-07-30" }), false);
    assert.equal(isQuestionOnPause({ adviceKey: KEY, recentlyAsked: undefined, coachTouchAt: null, workoutDate: "2026-07-30" }), false);
  });
  test("asked 5 days ago → on pause (mechanical repeat)", () => {
    assert.equal(isQuestionOnPause({ adviceKey: KEY, recentlyAsked: asked("2026-07-25"), coachTouchAt: null, workoutDate: "2026-07-30" }), true);
  });
  test("asked 20 days ago, no coach touch → pause expired, ask again", () => {
    assert.equal(isQuestionOnPause({ adviceKey: KEY, recentlyAsked: asked("2026-07-10"), coachTouchAt: null, workoutDate: "2026-07-30" }), false);
  });
  test("asked 20 days ago BUT coach engaged 3 days ago → still quiet (answered)", () => {
    assert.equal(isQuestionOnPause({ adviceKey: KEY, recentlyAsked: asked("2026-07-10"), coachTouchAt: "2026-07-27T09:00:00Z", workoutDate: "2026-07-30" }), true);
  });
  test("coach touch was BEFORE the ask → does not count as answered", () => {
    assert.equal(isQuestionOnPause({ adviceKey: KEY, recentlyAsked: asked("2026-07-10"), coachTouchAt: "2026-07-05T09:00:00Z", workoutDate: "2026-07-30" }), false);
  });
  test("a DIFFERENT question is unaffected", () => {
    assert.equal(isQuestionOnPause({ adviceKey: "question_high_pulse_unknown", recentlyAsked: asked("2026-07-28"), coachTouchAt: null, workoutDate: "2026-07-30" }), false);
  });
});
