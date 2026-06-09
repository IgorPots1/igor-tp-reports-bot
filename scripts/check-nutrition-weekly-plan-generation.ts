import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  calculateNutritionPlanWeek,
  generateNutritionWeeklyPlanFallback,
  NUTRITION_WEEKLY_PLAN_PROMPT_VERSION,
} from "@/features/nutrition/weekly-plan-generator";

const root = process.cwd();
const generatorPath = join(root, "src/features/nutrition/weekly-plan-generator.ts");
const generatorSource = readFileSync(generatorPath, "utf8");

function buildFixtureAnalysis(overrides?: Partial<NutritionWeeklyAnalysis>): NutritionWeeklyAnalysis {
  return {
    id: "analysis-fixture-1",
    studentId: "student-uuid-1",
    reportId: "report-fixture-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {
      periodFrom: "2026-06-08",
      periodTo: "2026-06-14",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      workouts: [
        {
          date: "2026-06-09",
          title: "Long run 18 km",
          type: "long_run",
          description: "Easy long run",
          coachComments: null,
          plannedText: null,
        },
        {
          date: "2026-06-11",
          title: "Tempo 6 km",
          type: "tempo",
          description: "Threshold work",
          coachComments: null,
          plannedText: null,
        },
      ],
      keyWorkouts: [{ date: "2026-06-09", title: "Long run 18 km", type: "long_run", confidence: "high" }],
    },
    nutritionSummary: {
      generation_mode: "fallback",
      prompt_version: "nutrition-weekly-review-v2-ai",
      coach_summary_text: "Прошлая неделя: белок ок, углеводы местами низковаты.",
      day_by_day_analysis_text: "02.06 · long run\nНизкие углеводы перед длительной.",
      data_quality_summary: { parsed_days: 7, low_confidence_days: 0, quality_flags: [] },
      one_focus: {
        category: "carbs_around_key_sessions",
        statement_ru: "Поддержать углеводы вокруг ключевых работ",
      },
      methodology_signals: { protein_sufficient: true },
      carb_progression_strategy: "small_step",
    },
    safetyFlags: { hard_flags: [], soft_flags: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "nutrition-weekly-review-fallback-v2",
    athleteMessageDraft: "Черновик прошлой недели",
    coachEdits: null,
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    ...overrides,
  };
}

const planWeek = calculateNutritionPlanWeek("2026-06-07");
assert.equal(planWeek.from, "2026-06-08");
assert.equal(planWeek.to, "2026-06-14");

const facts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis(),
});
assert.equal(facts.planWeek.from, "2026-06-08");
assert.equal(facts.planWeek.to, "2026-06-14");
assert.equal(facts.sourceReview.sourceReportId, "report-fixture-1");
assert.equal(facts.nextWeekTraining.workouts.length, 2);

const mismatchFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceReportId: "other-report-from-url",
  sourceAnalysis: buildFixtureAnalysis({ reportId: "report-fixture-1" }),
});
assert.equal(
  mismatchFacts.sourceReview.sourceReportId,
  "report-fixture-1",
  "analysis reportId must win over URL reportId"
);

assert.doesNotMatch(
  generatorSource,
  /Source report id does not match the selected weekly analysis/,
  "generator must not hard-fail on URL/report mismatch when review has reportId"
);
assert.equal(facts.nextWeekTraining.status, "available");

const generated = generateNutritionWeeklyPlanFallback(facts);
assert.ok(generated.coachSummary.trim().length > 0, "fallback must produce coach_summary");
assert.ok(generated.athleteMessageDraft, "fallback must produce athlete draft when not blocked");
assert.ok(generated.planSummary.plan_focus, "fallback must produce plan_focus");
assert.ok(Array.isArray(generated.planSummary.key_training_days), "fallback must produce key_training_days");
assert.ok(generated.trainingContextSnapshot.planWeekFrom, "fallback must include training snapshot");
assert.ok(generated.nutritionContextSnapshot, "fallback must include nutrition snapshot");
assert.equal(generated.promptVersion, NUTRITION_WEEKLY_PLAN_PROMPT_VERSION);

const blockedFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "vy",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis({
    safetyFlags: { hard_flags: ["very_low_kcal_repeated"], soft_flags: [], blocked: true },
  }),
});
const blockedGenerated = generateNutritionWeeklyPlanFallback(blockedFacts);
assert.equal(blockedGenerated.status, "blocked_safety");
assert.equal(blockedGenerated.athleteMessageDraft, null);

assert.match(generatorSource, /createNutritionWeeklyPlan\(/, "generator must persist via createNutritionWeeklyPlan");
assert.match(generatorSource, /markNutritionWeeklyPlansSuperseded\(/, "generator must mark older plans superseded");
assert.match(
  generatorSource,
  /excludePlanId:\s*plan\.id/,
  "superseded handling must exclude newly created plan"
);

console.log("PASS check-nutrition-weekly-plan-generation");
