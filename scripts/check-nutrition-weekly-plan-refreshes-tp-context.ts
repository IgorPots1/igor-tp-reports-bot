import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatNutritionPlanTrainingContextLine } from "../src/features/nutrition/admin-labels";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  buildNutritionWeeklyPlanTpContextDiff,
  buildNutritionWeeklyPlanTrainingContextSnapshot,
  generateNutritionWeeklyPlanFallback,
  type NutritionWeeklyPlanTpContextRefresh,
} from "@/features/nutrition/weekly-plan-generator";

const root = process.cwd();
const generatorPath = join(root, "src/features/nutrition/weekly-plan-generator.ts");
const generatorSource = readFileSync(generatorPath, "utf8");
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

assert.match(
  generatorSource,
  /buildNutritionTrainingPeaksWeekContext/,
  "generator must import and call fresh Nutrition TP context builder"
);
assert.match(
  generatorSource,
  /tpNextWeekContextOverride/,
  "generator must allow fresh TP context override over saved review context"
);
assert.doesNotMatch(generatorSource, /sendMessage|sendTelegram|bot\.telegram/i, "generator must not send Telegram");
assert.doesNotMatch(
  generatorSource,
  /mutateTrainingPeaks|updateWorkout|moveWorkout|createWorkout|deleteWorkout/i,
  "generator must not mutate TrainingPeaks"
);

const sourceReviewContext = {
  periodFrom: "2026-06-08",
  periodTo: "2026-06-14",
  cacheStatus: "empty",
  cacheStatusNote: "empty",
  workouts: [],
  keyWorkouts: [],
};

const freshContext = {
  periodFrom: "2026-06-08",
  periodTo: "2026-06-14",
  cacheStatus: "ok",
  cacheStatusNote: "ok",
  totalSessions: 4,
  workouts: [
    { date: "2026-06-09", title: "Бег по пульсу", type: "easy_run" },
    { date: "2026-06-10", title: "6 х 6 мин", type: "intervals" },
    { date: "2026-06-11", title: "Бег по пульсу", type: "easy_run" },
    { date: "2026-06-14", title: "Бег по пульсу", type: "easy_run" },
  ],
  keyWorkouts: [{ date: "2026-06-10", title: "6 х 6 мин", type: "intervals", confidence: "high" }],
};

const diff = buildNutritionWeeklyPlanTpContextDiff(sourceReviewContext, freshContext);
assert.equal(diff.sourceReviewCacheStatus, "empty");
assert.equal(diff.freshCacheStatus, "ok");
assert.equal(diff.sourceReviewWorkoutsCount, 0);
assert.equal(diff.freshWorkoutsCount, 4);
assert.equal(diff.sourceReviewKeyWorkoutsCount, 0);
assert.equal(diff.freshKeyWorkoutsCount, 1);
assert.equal(diff.changed, true);

function buildFixtureAnalysis(): NutritionWeeklyAnalysis {
  return {
    id: "analysis-fixture-refresh",
    studentId: "student-uuid-1",
    reportId: "report-fixture-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: sourceReviewContext,
    nutritionSummary: {
      generation_mode: "fallback",
      prompt_version: "nutrition-weekly-review-v2-ai",
      coach_summary_text: "Прошлая неделя ок.",
      day_by_day_analysis_text: "02.06 · easy",
      data_quality_summary: { parsed_days: 7, low_confidence_days: 0, quality_flags: [] },
      one_focus: { category: "general_load_support", statement_ru: "Держать регулярность" },
      methodology_signals: { protein_sufficient: true },
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
  tpNextWeekContextOverride: freshContext,
});

assert.equal(facts.nextWeekTraining.status, "available");
assert.equal(facts.nextWeekTraining.workouts.length, 4);
assert.equal(facts.nextWeekTraining.keyWorkouts.length, 1);
assert.ok(
  facts.nextWeekTraining.workouts.some((workout) => workout.title === "6 х 6 мин"),
  "facts must include key workout 6 х 6 мин from fresh context"
);
assert.ok(
  facts.nextWeekTraining.keyWorkouts.some((workout) => workout.title === "6 х 6 мин"),
  "facts key workouts must include 6 х 6 мин"
);

const tpContextRefresh: NutritionWeeklyPlanTpContextRefresh = {
  source: "fresh_cache",
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  freshContext,
  sourceReviewContext,
  diff,
  warnings: ["Saved review TP context differed from fresh cache; plan used fresh cache."],
};

const generated = generateNutritionWeeklyPlanFallback(facts, tpContextRefresh);
const snapshot = generated.trainingContextSnapshot;
assert.equal(snapshot.source, "fresh_cache");
assert.equal(snapshot.workoutCount, 4);
assert.ok(snapshot.fresh_context, "snapshot must store fresh_context");
assert.ok(snapshot.source_review_context, "snapshot must store source_review_context");
assert.equal((snapshot.diff as Record<string, unknown>).changed, true);
assert.deepEqual(snapshot.warnings, tpContextRefresh.warnings);

const fallbackKeyDays = generated.planSummary.key_training_days as Array<{ workout_title?: string }>;
assert.ok(
  fallbackKeyDays.some((day) => day.workout_title === "6 х 6 мин"),
  "generated fallback must mention 6 х 6 мин in key_training_days"
);

const uiLine = formatNutritionPlanTrainingContextLine(snapshot);
assert.match(uiLine, /TrainingPeaks: 4 тренировки · ключевые: 1/);
assert.match(uiLine, /TP-контекст обновлён перед генерацией: было 0, стало 4/);

const legacySnapshot = buildNutritionWeeklyPlanTrainingContextSnapshot(facts, null);
const legacyLine = formatNutritionPlanTrainingContextLine(legacySnapshot);
assert.match(legacyLine, /TrainingPeaks: 4 тренировки · ключевые: 1/);
assert.doesNotMatch(legacyLine, /TP-контекст обновлён/, "legacy snapshot without diff must not show refresh note");

assert.match(studentPage, /formatNutritionPlanTrainingContextLine/, "student page must render plan training snapshot via helper");
assert.match(packageJson, /check:nutrition-weekly-plan-refreshes-tp-context/, "package.json must include refresh check");

console.log("PASS check-nutrition-weekly-plan-refreshes-tp-context");
