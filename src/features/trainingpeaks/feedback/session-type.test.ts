import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classifySessionType, isDataFragment } from "./session-type.ts";
import type { PlannerDerivedMetrics } from "./types.ts";

function cur(durationS: number | null, over: Partial<PlannerDerivedMetrics> = {}): PlannerDerivedMetrics {
  return { workoutType: "run", comparisonKey: null, repsDetectedCount: 0, durationS, ...over } as PlannerDerivedMetrics;
}

describe("isDataFragment (Блок 6 — обрывок ДО классификации)", () => {
  test("«Длительный бег» 5 мин при плане 75 → обрывок", () => {
    assert.equal(isDataFragment(5 * 60, 75 * 60, "Длительный бег"), true);
  });
  test("«Длительный бег» 8 мин при плане 80 → обрывок", () => {
    assert.equal(isDataFragment(8 * 60, 80 * 60, "Длительный бег"), true);
  });
  test("РЕГРЕСС: плановая короткая (план 30, факт 28) → НЕ обрывок", () => {
    assert.equal(isDataFragment(28 * 60, 30 * 60, "Легкий бег"), false);
  });
  test("РЕГРЕСС: 54 мин при плане 110 → НЕ обрывок (реальная частичная, не битая запись)", () => {
    assert.equal(isDataFragment(54 * 60, 110 * 60, "Бег по темпу"), false);
  });
  test("настоящая длинная 90/90 → не обрывок", () => {
    assert.equal(isDataFragment(90 * 60, 90 * 60, "Длительный бег"), false);
  });
  test("без плана: «Длительный» 5 мин → обрывок (эвристика)", () => {
    assert.equal(isDataFragment(5 * 60, null, "Длительный бег"), true);
  });
  test("без плана: любой бег <8 мин → обрывок", () => {
    assert.equal(isDataFragment(6 * 60, null, "Running"), true);
  });
  test("без плана: 20-мин бег → не обрывок", () => {
    assert.equal(isDataFragment(20 * 60, null, "Running"), false);
  });
});

describe("classifySessionType (Блок 6 — «темп» больше не длинная)", () => {
  test("Утенкова: «Бег по темпу» 54 мин → easy (НЕ длительная)", () => {
    assert.equal(classifySessionType({ current: cur(54 * 60), title: "Бег по темпу" }).sessionType, "easy");
  });
  test("«Длительный бег» 90 мин → длительная", () => {
    assert.equal(classifySessionType({ current: cur(90 * 60), title: "Длительный бег" }).sessionType, "long_tempo");
  });
  test("«Бег по темпу» 91 мин → длительная по ≥80 мин", () => {
    assert.equal(classifySessionType({ current: cur(91 * 60), title: "Бег по темпу" }).sessionType, "long_tempo");
  });
  test("«Бег по темпу» 50 мин → easy", () => {
    assert.equal(classifySessionType({ current: cur(50 * 60), title: "Бег по темпу" }).sessionType, "easy");
  });
  test("79 мин без названия-подсказки → easy (порог 80)", () => {
    assert.equal(classifySessionType({ current: cur(79 * 60), title: "Running" }).sessionType, "easy");
  });
});
