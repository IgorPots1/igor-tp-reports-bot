import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
  type NutritionCombinedMessageResult,
} from "@/features/nutrition/combined-message";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import { resolveNutritionWeeklyPlanForDisplay } from "@/features/nutrition/repository";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

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
          training_type: "rest",
          training_label: "день отдыха",
          actual_kcal: 2487,
          protein_g: 104.2,
          fat_g: 132,
          carbs_g: 214.69,
          carbs_g_per_kg: 3.839,
          nutrition_status: "rest_ok",
          hint_for_comment: "Нагрузка и питание в целом согласованы; можно дать краткий поддерживающий комментарий.",
          findings: ["rest_day_macro_distribution"],
          source_quality: { confidence: "high" },
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
              summary: {
                long_run_source: "none",
                long_run_confidence: "low",
              },
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
  assert.match(ready.athleteMessageDraft ?? "", /~2000 ккал/, "must display-round rest kcal from next_week_plan");
  assert.doesNotMatch(ready.athleteMessageDraft ?? "", /~1950 ккал|2487 ккал|214\.69|104\.2|\d+\.\d+\s*г/, "athlete copy must avoid raw technical numbers");
  assert.match(ready.athleteMessageDraft ?? "", /~2500 ккал/, "actual kcal must be rounded for athlete text");
  assert.match(ready.athleteMessageDraft ?? "", /~3,8 г\/кг/, "g/kg must be formatted with comma and one decimal");
  assert.match(ready.athleteMessageDraft ?? "", /🔹 Понедельник \(01\.06\) — день отдыха/, "must include canonical day-by-day block");
  assert.doesNotMatch(
    ready.athleteMessageDraft ?? "",
    /Комментарий:|можно дать|указать факт|hint|source_quality|по качеству данных здесь возможна неполная картина|Собрала|\*\*|---/,
    "combined message must not leak internal hints or markdown separators"
  );
  assert.equal((ready.athleteMessageDraft ?? "").match(/Анна, привет!/g)?.length, 1, "combined message must have one greeting");
  assert.doesNotMatch(ready.athleteMessageDraft ?? "", /Силовая —/, "strength block must not show without strength day");

  const nadezhdaGreeting = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: "Nadezhda Ponomareva",
  });
  assert.match(nadezhdaGreeting.athleteMessageDraft ?? "", /^Надя, привет!/);
  assert.doesNotMatch(nadezhdaGreeting.athleteMessageDraft ?? "", /Nadezhda Ponomareva, привет/);

  const methodologyReview = buildReview();
  methodologyReview.nutritionSummary = {
    ...asObject(methodologyReview.nutritionSummary),
    daily_analysis: [
      {
        date: "2026-06-01",
        kcal: 2477,
        proteinG: 103.58,
        fatG: 131.91,
        carbsG: 206.93,
        carbsGPerKg: 3.7,
        nutritionStatus: "rest_ok",
        findings: ["protein_sufficient"],
        canonicalDailyAnalysis: {
          date: "2026-06-01",
          weekdayRu: "Понедельник",
          dateLabel: "01.06",
          trainingType: "rest",
          trainingLabel: "день отдыха",
          actual: {
            kcal: 2477,
            proteinG: 103.58,
            fatG: 131.91,
            carbsG: 206.93,
            carbsGPerKg: 3.7,
          },
          nutritionStatus: "rest_ok",
          findings: ["protein_sufficient"],
          sourceQuality: { confidence: "high" },
          hintForComment: "можно дать краткий поддерживающий комментарий.",
        },
      },
    ],
  };
  methodologyReview.athleteMessageDraft =
    "Привет!\nКомментарий: по качеству данных здесь возможна неполная картина.\nможно дать краткий поддерживающий комментарий.";
  const methodologyCombined = buildDerivedNutritionCombinedMessage({
    review: methodologyReview,
    plan,
    formality: "ty",
    studentName: "Nadezhda Ponomareva",
  });
  assert.match(methodologyCombined.athleteMessageDraft ?? "", /🔹 Понедельник \(01\.06\) — день отдыха/);
  assert.doesNotMatch(
    methodologyCombined.athleteMessageDraft ?? "",
    /Комментарий:|можно дать|103\.58|206\.93|Привет!/,
    "methodology daily_analysis must render polished combined lines without stored review draft leakage"
  );
  assert.equal(methodologyCombined.warnings.length, 0, "methodology daily_analysis must not warn about missing canonical facts");

  const coachDayByDay = buildDerivedNutritionCoachDayByDayText(methodologyReview);
  assert.ok(coachDayByDay, "coach day-by-day must render from methodology daily_analysis");
  assert.doesNotMatch(coachDayByDay ?? "", /Комментарий:|можно дать|указать факт/, "coach day-by-day must not leak stored hint text");

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
