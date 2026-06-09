import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDerivedNutritionCombinedMessage,
  type NutritionCombinedMessageResult,
} from "@/features/nutrition/combined-message";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import { resolveNutritionWeeklyPlanForDisplay } from "@/features/nutrition/repository";

function buildReview(status: NutritionWeeklyAnalysis["status"] = "draft_generated"): NutritionWeeklyAnalysis {
  return {
    id: "review-1",
    studentId: "student-anna",
    reportId: "report-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status,
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      avg_kcal: 2200,
      one_focus: {
        statement_ru: "Держим ровную энергию вокруг ключевых тренировок.",
      },
      daily_analysis: [
        {
          date: "2026-06-01",
          weekday_ru: "Понедельник",
          date_label: "01.06",
          training_label: "день отдыха",
          actual_kcal: 2477,
          protein_g: 104,
          fat_g: 132,
          carbs_g: 207,
          carbs_g_per_kg: 3.7,
          hint_for_comment: "Хорошо держится белок, но углеводы можно распределить ровнее.",
          findings: ["rest_day_macro_distribution"],
        },
      ],
      day_by_day_analysis_text: "Текст fallback day-by-day.",
      do_not_send_reasons: [],
    },
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "model",
    athleteMessageDraft: "Review draft fallback",
    coachEdits: null,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
  };
}

function buildPlan(input?: {
  status?: NutritionWeeklyPlan["status"];
  includeNextWeekPlan?: boolean;
  draft?: string | null;
  id?: string;
}): NutritionWeeklyPlan {
  const includeNextWeekPlan = input?.includeNextWeekPlan ?? true;
  return {
    id: input?.id ?? "plan-1",
    studentId: "student-anna",
    sourceReportId: "report-1",
    sourceAnalysisId: "review-1",
    planWeekFrom: "2026-06-08",
    planWeekTo: "2026-06-14",
    status: input?.status ?? "draft_generated",
    generationMode: "fallback",
    promptVersion: "nutrition-weekly-plan-v1-ai",
    aiModel: "model",
    coachSummary: "coach summary",
    athleteMessageDraft: input?.draft === undefined ? "Plan athlete draft" : input.draft,
    coachEditedDraft: null,
    approvedAt: null,
    planSummary: {
      plan_focus: {
        title: "Ровные углеводы к ключевым сессиям",
        explanation: "Без резких просадок в дни нагрузки.",
      },
      do_not_send_reasons: [],
      ...(includeNextWeekPlan
        ? {
            next_week_plan: {
              formula_version: "nutrition_next_week_plan_v1",
              day_type_targets: {
                rest: { target_kcal: 1950, protein_g: 90, fat_g: 60, carbs_g: 250 },
                easy: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 290 },
                hard: { target_kcal: 2400, protein_g: 95, fat_g: 65, carbs_g: 340 },
                pre_long: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 310 },
                long_run: { target_kcal: 2500, protein_g: 95, fat_g: 65, carbs_g: 390 },
                strength: { target_kcal: 2200, protein_g: 100, fat_g: 65, carbs_g: 290 },
              },
              days: [
                {
                  date: "2026-06-08",
                  weekday_ru: "Понедельник",
                  training_type: "rest",
                  training_label: "день отдыха",
                  target_kcal: 1950,
                  protein_g: 90,
                  fat_g: 60,
                  carbs_g: 250,
                },
              ],
            },
          }
        : {}),
    },
    trainingContextSnapshot: {},
    nutritionContextSnapshot: {},
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    supersededByPlanId: null,
    createdAt: "2026-06-09T10:10:00.000Z",
    updatedAt: "2026-06-09T10:10:00.000Z",
  };
}

function assertReady(result: NutritionCombinedMessageResult): void {
  assert.ok(result.athleteMessageDraft, "ready result must have athlete draft");
  assert.equal(result.sourceReviewId, "review-1");
  assert.equal(result.sourcePlanId, "plan-1");
}

async function run(): Promise<void> {
  const root = process.cwd();
  const packageJson = readFileSync(join(root, "package.json"), "utf8");
  const pageSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
  const helperSource = readFileSync(join(root, "src/features/nutrition/combined-message.ts"), "utf8");
  const repoSource = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");

  assert.match(packageJson, /check:nutrition-combined-message/, "package.json must include combined message check script");
  assert.match(pageSource, /Черновик ученику — полный текст/, "UI must include combined copy block title");
  assert.match(pageSource, /buildDerivedNutritionCombinedMessage/, "UI must use combined helper");
  assert.match(pageSource, /displayPlan/, "UI combined block must use resolved display plan");
  assert.match(helperSource, /daily_analysis/, "helper must use canonical daily analysis facts");
  assert.match(helperSource, /next_week_plan/, "helper must use deterministic next_week_plan values");

  const review = buildReview();
  const plan = buildPlan();
  const ready = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(ready.status, "ready");
  assertReady(ready);
  assert.match(ready.athleteMessageDraft ?? "", /~1950 ккал/, "must preserve exact deterministic rest kcal from next_week_plan");
  assert.match(ready.athleteMessageDraft ?? "", /🔹 Понедельник \(01\.06\) — день отдыха/, "must include canonical day-by-day block");

  const needsReview = buildDerivedNutritionCombinedMessage({
    review: buildReview("needs_review"),
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(needsReview.status, "needs_review", "needs_review source should keep warning state");

  const missingReview = buildDerivedNutritionCombinedMessage({
    review: null,
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(missingReview.status, "missing_review");
  assert.equal(missingReview.athleteMessageDraft, null);

  const missingPlan = buildDerivedNutritionCombinedMessage({
    review,
    plan: null,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(missingPlan.status, "missing_plan");
  assert.equal(missingPlan.athleteMessageDraft, null);

  const blockedByReview = buildDerivedNutritionCombinedMessage({
    review: {
      ...review,
      status: "blocked_safety",
      safetyFlags: { hard_flags: ["very_low_kcal_repeated"], blocked: true },
    },
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(blockedByReview.status, "blocked_safety");
  assert.equal(blockedByReview.athleteMessageDraft, null);

  const blockedByPlan = buildDerivedNutritionCombinedMessage({
    review,
    plan: buildPlan({
      status: "blocked_safety",
      draft: null,
    }),
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(blockedByPlan.status, "blocked_safety");
  assert.equal(blockedByPlan.athleteMessageDraft, null);

  const noCanonicalPlan = buildDerivedNutritionCombinedMessage({
    review,
    plan: buildPlan({ includeNextWeekPlan: false }),
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(noCanonicalPlan.status, "ready");
  assert.ok(
    noCanonicalPlan.warnings.some((warning) => /нет canonical next_week_plan/i.test(warning)),
    "missing next_week_plan must produce warning"
  );

  assert.match(repoSource, /resolveNutritionWeeklyPlanForDisplay/, "repository must resolve latest display plan");
  assert.match(repoSource, /resolveSupersedingNutritionWeeklyPlan/, "repository must keep superseded resolution");
  assert.equal(typeof resolveNutritionWeeklyPlanForDisplay, "function", "display plan resolver must remain callable");

  assert.doesNotMatch(helperSource, /sendTelegram|sendMessage|telegram\.send/i, "combined helper must not send Telegram");
  assert.doesNotMatch(
    helperSource,
    /moveWorkout|mutateTrainingPeaks|updateWorkout|executeMove/i,
    "combined helper must not mutate TrainingPeaks"
  );
  assert.doesNotMatch(helperSource, /create table|nutrition_weekly_messages|migration/i, "combined helper must not introduce DB migration/table");

  console.log("PASS check-nutrition-combined-message");
}

void run();
