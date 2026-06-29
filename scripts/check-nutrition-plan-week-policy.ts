import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import {
  getNutritionAdminLocalDate,
  getNutritionPlanTargetWeekToday,
  resolveNutritionPlanTargetWeek,
} from "@/features/nutrition/plan-week-policy";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFallback,
} from "@/features/nutrition/weekly-plan-generator";

const root = process.cwd();
const generatorSource = readFileSync(join(root, "src/features/nutrition/weekly-plan-generator.ts"), "utf8");
const pageSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const actionsSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function assertTargetWeek(
  todayLocalDate: string,
  expected: { from: string; to: string; mode: "current_week" | "next_week" }
): void {
  const resolved = resolveNutritionPlanTargetWeek({ todayLocalDate });
  assert.equal(resolved.planWeekFrom, expected.from, `${todayLocalDate} from`);
  assert.equal(resolved.planWeekTo, expected.to, `${todayLocalDate} to`);
  assert.equal(resolved.mode, expected.mode, `${todayLocalDate} mode`);
}

// Mon→next Mon = 8 days (bridge Monday). plan_week.to is the following Monday,
// not Sunday — so adjacent plans overlap by one Monday instead of leaving a gap.
assertTargetWeek("2026-06-09", { from: "2026-06-08", to: "2026-06-15", mode: "current_week" });
assertTargetWeek("2026-06-10", { from: "2026-06-08", to: "2026-06-15", mode: "current_week" });
assertTargetWeek("2026-06-13", { from: "2026-06-08", to: "2026-06-15", mode: "current_week" });
assertTargetWeek("2026-06-14", { from: "2026-06-15", to: "2026-06-22", mode: "next_week" });
assertTargetWeek("2026-06-15", { from: "2026-06-15", to: "2026-06-22", mode: "current_week" });

assert.match(
  resolveNutritionPlanTargetWeek({ todayLocalDate: "2026-06-10" }).label,
  /текущую неделю/
);
assert.match(
  resolveNutritionPlanTargetWeek({ todayLocalDate: "2026-06-14" }).label,
  /следующую неделю/
);

const belgradeSunday = new Date("2026-06-14T22:30:00.000Z");
assert.equal(getNutritionAdminLocalDate(belgradeSunday), "2026-06-15");
assert.equal(getNutritionPlanTargetWeekToday(belgradeSunday).mode, "current_week");

function buildFixtureAnalysis(): NutritionWeeklyAnalysis {
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
      workouts: [{ date: "2026-06-09", title: "Long run 18 km", type: "long_run" }],
      keyWorkouts: [{ date: "2026-06-09", title: "Long run 18 km", type: "long_run", confidence: "high" }],
    },
    nutritionSummary: {
      generation_mode: "fallback",
      prompt_version: "nutrition-weekly-review-v2-ai",
      coach_summary_text: "Прошлая неделя ок.",
      day_by_day_analysis_text: "02.06 · long run",
      data_quality_summary: { parsed_days: 7, low_confidence_days: 0, quality_flags: [] },
      one_focus: { category: "carbs_around_key_sessions", statement_ru: "Поддержать углеводы" },
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
  };
}

const facts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis(),
  todayLocalDate: "2026-06-10",
});
assert.equal(facts.planWeek.from, "2026-06-08");
assert.equal(facts.planWeek.to, "2026-06-15");
assert.equal(facts.planWeekMode, "current_week");

const sundayFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis(),
  todayLocalDate: "2026-06-14",
});
assert.equal(sundayFacts.planWeek.from, "2026-06-15");
assert.equal(sundayFacts.planWeek.to, "2026-06-22");
assert.equal(sundayFacts.planWeekMode, "next_week");

const generated = generateNutritionWeeklyPlanFallback(facts);
assert.ok(generated.planSummary.next_week_plan, "fallback must include next_week_plan for target week");
assert.equal(
  (generated.planSummary.next_week_plan as { days?: Array<{ date?: string }> }).days?.[0]?.date,
  "2026-06-08",
  "next_week_plan days must align with target week"
);

assert.match(generatorSource, /resolveNutritionPlanTargetWeek|getNutritionPlanTargetWeekToday/, "generator must use target week resolver");
assert.doesNotMatch(
  generatorSource,
  /calculateNutritionPlanWeek\(input\.sourceAnalysis\.weekTo\)/,
  "generator must not derive target week from sourceReview.weekTo"
);
assert.match(generatorSource, /buildNutritionTrainingPeaksWeekContext\([\s\S]*planWeek\.from/, "fresh TP context must use target week");

assert.match(pageSource, /getNutritionPlanTargetWeekToday/, "student page must resolve target plan week from admin local date");
assert.match(pageSource, /formatNutritionPlanTargetWeekHeading/, "student page must render dynamic plan week heading");
// Task 6: the plan is generated together with the review (one button), so the
// standalone dynamic generate button is gone; the plan card explains the merged
// flow while the dynamic plan week heading above is still rendered.
assert.match(pageSource, /План на неделю генерируется вместе с разбором/, "student page must explain merged review+plan generation");
assert.doesNotMatch(pageSource, /calculateNutritionPlanWeek/, "student page must not use legacy review weekTo+1 helper");

assert.match(actionsSource, /formatNutritionPlanTargetWeekNotice/, "generate action must use dynamic success notice");
assert.match(actionsSource, /getNutritionPlanTargetWeekToday/, "generate action must resolve target week");

assert.match(packageJson, /check:nutrition-plan-week-policy/, "package.json must include plan week policy check");

console.log("PASS check-nutrition-plan-week-policy");
