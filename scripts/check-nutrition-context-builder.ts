import assert from "node:assert/strict";

import {
  buildNutritionStudentContext,
  normalizeManualMacroInput,
} from "@/features/nutrition/context";

async function run(): Promise<void> {
  const parsed = normalizeManualMacroInput(
    [
      "Пн 2200 ккал Б120 Ж70 У250",
      "Вт 2400 ккал Б130 Ж65 У310",
      "Ср 2100 ккал белок 110 жиры 60 углеводы 260",
    ].join("\n"),
    "2026-06-01"
  );
  assert.equal(parsed.length, 3);
  assert.ok(parsed.every((row) => row.day && row.confidence > 0));

  const studentId = process.env.NUTRITION_CHECK_STUDENT_ID?.trim();
  if (!studentId) {
    console.log("PASS check-nutrition-context-builder (parser assertions only; set NUTRITION_CHECK_STUDENT_ID for integration path)");
    return;
  }

  const context = await buildNutritionStudentContext({
    studentId,
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    manualRows: parsed,
  });

  assert.equal(typeof context.studentSlug, "string");
  assert.ok(Array.isArray(context.coachMemoryItems));
  assert.ok(Array.isArray(context.nutritionContextItems));
  assert.ok(context.tpPastWeek.cacheStatus === "ok" || context.tpPastWeek.cacheStatus === "empty" || context.tpPastWeek.cacheStatus === "stale");
  assert.ok(context.tpNextWeek.cacheStatus === "ok" || context.tpNextWeek.cacheStatus === "empty" || context.tpNextWeek.cacheStatus === "stale");
  console.log("PASS check-nutrition-context-builder");
}

void run();
