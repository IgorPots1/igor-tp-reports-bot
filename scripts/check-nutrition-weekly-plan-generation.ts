import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFallback,
  NUTRITION_WEEKLY_PLAN_PROMPT_VERSION,
} from "@/features/nutrition/weekly-plan-generator";
import { resolveNutritionPlanTargetWeek } from "@/features/nutrition/plan-week-policy";

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

const targetWeek = resolveNutritionPlanTargetWeek({ todayLocalDate: "2026-06-10" });
assert.equal(targetWeek.planWeekFrom, "2026-06-08");
assert.equal(targetWeek.planWeekTo, "2026-06-14");

const facts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis(),
  todayLocalDate: "2026-06-10",
});
assert.equal(facts.planWeek.from, targetWeek.planWeekFrom);
assert.equal(facts.planWeek.to, targetWeek.planWeekTo);
assert.equal(facts.planWeekMode, "current_week");
assert.equal(facts.sourceReview.sourceReportId, "report-fixture-1");
assert.equal(facts.nextWeekTraining.workouts.length, 2);

const mismatchFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceReportId: "other-report-from-url",
  sourceAnalysis: buildFixtureAnalysis({ reportId: "report-fixture-1" }),
  todayLocalDate: "2026-06-10",
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
assert.ok(generated.planSummary.next_week_plan, "fallback must produce next_week_plan");
assert.equal(
  (generated.planSummary.next_week_plan as { formula_version?: unknown }).formula_version,
  "nutrition_next_week_plan_v1",
  "next_week_plan must include formula version"
);
assert.equal(
  ((generated.planSummary.next_week_plan as { day_type_targets?: unknown }).day_type_targets as {
    rest?: { target_kcal?: unknown };
  })?.rest?.target_kcal,
  1950,
  "rest target kcal for 56kg must stay 1950 from deterministic formulas"
);
assert.equal(
  (generated.planSummary.next_week_plan as { bodyweight_kg?: unknown }).bodyweight_kg,
  56,
  "next_week_plan must include bodyweight when available"
);
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
  todayLocalDate: "2026-06-10",
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
assert.match(
  generatorSource,
  /Используй exact значения для логики, но в athlete draft kcal показывай display-rounded до ближайших 100/,
  "AI prompt must preserve canonical logic while display-rounding athlete kcal"
);
assert.match(
  generatorSource,
  /если rest target_kcal=1950 во facts, пиши ~2000 ккал/i,
  "AI prompt must display-round deterministic rest target example"
);
assert.match(
  generatorSource,
  /Ничего не пересчитывай и не придумывай/i,
  "AI prompt must ban recalculation"
);
assert.match(
  generatorSource,
  /no \*\*, no ---, no code fences/i,
  "AI prompt must enforce athlete plain-text format"
);
assert.doesNotMatch(
  generatorSource,
  /calculate formulas|compute formulas|classify day/i,
  "AI prompt must not ask model to calculate formulas or classify days"
);

console.log("PASS check-nutrition-weekly-plan-generation");
