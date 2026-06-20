import assert from "node:assert/strict";

import {
  buildDerivedNutritionCombinedMessage,
  buildNutritionDayProseFacts,
} from "@/features/nutrition/combined-message";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import { validateNutritionDayProse } from "@/features/nutrition/telegram-renderer";

function makeReview(overrides: Record<string, unknown>): NutritionWeeklyAnalysis {
  return {
    id: "review-1",
    studentId: "student-1",
    reportId: "report-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    nutritionSummary: {},
    ...overrides,
  } as unknown as NutritionWeeklyAnalysis;
}

const baseInput = {
  plan: null,
  formality: "ty" as const,
  studentName: "Тест",
};

// 1. status === awaiting_generation -> combined message is held, not sendable.
{
  const result = buildDerivedNutritionCombinedMessage({
    ...baseInput,
    review: makeReview({ status: "awaiting_generation" }),
  });
  assert.equal(result.status, "awaiting_generation", "awaiting status propagates to combined message");
  assert.equal(result.athleteMessageDraft, null, "no athlete draft when awaiting");
  assert.equal(result.renderResult.text, null, "no sendable text when awaiting");
  assert.equal(result.renderResult.ok, false, "render result not ok when awaiting");
}

// 2. generation_mode === awaiting_generation in summary (status not yet awaiting) -> still held.
{
  const result = buildDerivedNutritionCombinedMessage({
    ...baseInput,
    review: makeReview({ status: "draft_generated", nutritionSummary: { generation_mode: "awaiting_generation" } }),
  });
  assert.equal(result.status, "awaiting_generation", "generation_mode awaiting also holds the message");
  assert.equal(result.athleteMessageDraft, null, "no athlete draft when generation_mode awaiting");
}

// 3. A normal review without a plan still falls through to missing_plan (awaiting gate is specific).
{
  const result = buildDerivedNutritionCombinedMessage({
    ...baseInput,
    review: makeReview({ status: "draft_generated" }),
  });
  assert.equal(result.status, "missing_plan", "non-awaiting review behaves as before");
}

// 4. Per-day audit logic (shared facts + validator): invented number is flagged,
//    exact diary fact passes. This is exactly what the generation-time audit uses.
{
  const day = {
    date: "2026-06-03",
    actual: { kcal: 2487, proteinG: 133, fatG: 97, carbsG: 215, carbsGPerKg: 3.8 },
    nutrition_status: "low_for_load",
    findings: [],
    target: { carbsGMin: 280, carbsGMax: 340 },
  };
  const facts = buildNutritionDayProseFacts(day);
  assert.equal(facts.carbsG, 215, "facts pull actual carbs from the day item");
  assert.ok(facts.planTargetNumbers.includes(280), "facts include plan target carbsGMin");

  const invented = validateNutritionDayProse({
    prose: "Углеводов всего 199 под такую работу — маловато.",
    facts,
  });
  assert.ok(
    invented.some((i) => i.rule === "number_not_in_facts" && i.severity === "error"),
    "invented number (199) is flagged -> would produce a day_prose_rejected note"
  );

  const exact = validateNutritionDayProse({
    prose: "Углеводов 215 под такую работу маловато, ориентир около 280.",
    facts,
  });
  assert.ok(
    !exact.some((i) => i.rule === "number_not_in_facts" && i.severity === "error"),
    "exact diary fact (215) + plan target (280) pass"
  );
}

console.log("PASS check-nutrition-awaiting-generation");
