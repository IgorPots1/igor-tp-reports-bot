import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedNutritionCoachSummary } from "../src/features/nutrition/coach-summary";
import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
import { NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS } from "../src/features/nutrition/narrative-guardrails";
import { analyzeNutritionPageConsistency } from "../src/features/nutrition/page-consistency";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "../src/features/nutrition/repository";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const coachSummarySource = readFileSync(join(root, "src/features/nutrition/coach-summary.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const mainUi = studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack"));
const coachDetailsStart = mainUi.indexOf("Детали для тренера");
const combinedStart = mainUi.indexOf("Черновик ученику — полный текст");
const coachDetailsUi =
  coachDetailsStart >= 0 && combinedStart > coachDetailsStart
    ? mainUi.slice(coachDetailsStart, combinedStart)
    : "";

const STALE_STORED_SUMMARY = "Комментарий: можно дать краткий комментарий.";

function buildModernReviewWithStoredLegacyText(): NutritionWeeklyAnalysis {
  return {
    id: "review-modern-stored-legacy",
    studentId: "student-1",
    reportId: "report-1",
    weekFrom: "2026-06-08",
    weekTo: "2026-06-14",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: { workouts: [{ date: "2026-06-09", title: "Run", type: "easy" }] },
    tpNextWeekContext: {},
    nutritionSummary: {
      generation_mode: "ai",
      methodology_version: "ea_macro_narrative_v1",
      coach_summary_text: STALE_STORED_SUMMARY,
      avg_kcal: 2200,
      avg_protein_g: 95,
      avg_fat_g: 70,
      avg_carbs_g: 250,
      one_focus: {
        statement_ru: "Держим ровную энергию вокруг ключевых тренировок.",
      },
      daily_analysis: [
        {
          date: "2026-06-09",
          training_type: "long_run",
          training_label: "длительный бег",
          canonicalDailyAnalysis: { date: "2026-06-09" },
          macroGuardrails: {
            protein: { status: "ok" },
            fat: { status: "ok" },
            carbs: { status: "borderline" },
          },
          energyAvailability: { eaZone: "green" },
          energyFloor: { belowLoadFloor: false },
          nutrition_status: "long_run_ok",
          findings: [],
        },
      ],
      data_quality_summary: {
        parsed_days: 6,
        low_confidence_days: 1,
      },
    },
    safetyFlags: {},
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: null,
    coachEdits: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function buildReviewWithoutFacts(): NutritionWeeklyAnalysis {
  return {
    ...buildModernReviewWithStoredLegacyText(),
    id: "review-no-facts",
    nutritionSummary: {
      generation_mode: "fallback",
      coach_summary_text: STALE_STORED_SUMMARY,
      daily_analysis: [],
    },
  };
}

function buildPlan(): NutritionWeeklyPlan {
  return {
    id: "plan-1",
    studentId: "student-1",
    sourceReportId: "report-1",
    sourceAnalysisId: "review-modern-stored-legacy",
    planWeekFrom: "2026-06-08",
    planWeekTo: "2026-06-14",
    status: "draft_generated",
    generationMode: "fallback",
    promptVersion: null,
    aiModel: null,
    coachSummary: null,
    athleteMessageDraft: "Plan draft",
    coachEditedDraft: null,
    approvedAt: null,
    planSummary: {
      plan_focus: {
        title: "Ровные углеводы",
        explanation: "Без резких просадок.",
      },
    },
    trainingContextSnapshot: {},
    nutritionContextSnapshot: {},
    safetyFlags: {},
    supersededByPlanId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

const review = buildModernReviewWithStoredLegacyText();
const plan = buildPlan();
const consistencyIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: review.weekFrom,
  selectedWeekTo: review.weekTo,
  targetPlanWeekFrom: plan.planWeekFrom,
  targetPlanWeekTo: plan.planWeekTo,
  review,
  plan,
  hasReview: true,
});

const derivedSummary = buildDerivedNutritionCoachSummary({
  review,
  plan,
  consistencyIssues,
});

assert.notEqual(
  derivedSummary,
  STALE_STORED_SUMMARY,
  "derived summary must not equal stored stale coach_summary_text fixture"
);
assert.doesNotMatch(
  derivedSummary,
  /Комментарий:|можно дать|указать факт/,
  "derived summary must not leak stale stored phrases"
);
assert.match(derivedSummary, /Качество данных:/, "derived summary must include data quality");
assert.match(derivedSummary, /Главный|Фокус недели|Средние макросы/, "derived summary must include weekly pattern or macro/focus");
assert.match(derivedSummary, /Длительная|Ключевая тренировка|Long run/, "derived summary must include key workout pattern");
assert.match(derivedSummary, /Средние макросы:/, "derived summary must include macro pattern");
assert.match(derivedSummary, /Фокус недели:/, "derived summary must include one focus");

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildHighFatReview(): NutritionWeeklyAnalysis {
  return {
    ...review,
    nutritionSummary: {
      ...asObject(review.nutritionSummary),
      narrative_preferences: { fatFeedbackPolicy: "coach_only" },
      daily_analysis: [
        {
          date: "2026-06-09",
          weekday_ru: "Вторник",
          date_label: "09.06",
          training_type: "easy",
          training_label: "лёгкий бег",
          actual_kcal: 2200,
          protein_g: 95,
          fat_g: 95,
          carbs_g: 180,
          carbs_g_per_kg: 3.2,
          nutrition_status: "low_for_load",
          findings: ["high_fat_percent", "high_fat_may_displace_carbs_on_load_day"],
          macroGuardrails: {
            protein: { status: "ok" },
            fat: { status: "high", percentStatus: "high", g: 95, percentEnergy: 47, coachOnlyFindings: ["high_fat_percent"] },
            carbs: { status: "borderline" },
          },
        },
      ],
    },
  };
}

const highFatSummary = buildDerivedNutritionCoachSummary({ review: buildHighFatReview() });
assert.match(highFatSummary, /Жиры:.*высокий процент энергии из жиров/i, "coach summary must surface high fat");
assert.match(highFatSummary, /Athlete-facing скрыто по политике coach_only/i);

const noFactsSummary = buildDerivedNutritionCoachSummary({
  review: buildReviewWithoutFacts(),
});
assert.match(
  noFactsSummary,
  /Канонические дни недели не найдены/,
  "old reviews without current facts must warn instead of crash"
);
assert.doesNotMatch(noFactsSummary, /Комментарий:|можно дать/, "no-facts summary must not trust stored coach text");

const combined = buildDerivedNutritionCombinedMessage({
  review,
  plan,
  formality: "ty",
  studentName: "Анна",
});
const athleteText = combined.athleteMessageDraft ?? "";
for (const term of NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS) {
  assert.doesNotMatch(
    athleteText,
    new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    `athlete text must not leak forbidden term: ${term}`
  );
}

assert.match(packageJson, /check:nutrition-derived-coach-summary/, "package.json must include derived coach summary check");
assert.match(studentPage, /buildDerivedNutritionCoachSummary/, "page must use derived coach summary helper");
assert.match(mainUi, /Детали для тренера — актуальная сводка/, "coach details must use derived summary heading");
assert.match(
  mainUi,
  /Сводка собрана из текущих канонических данных/,
  "coach details must explain derived summary source"
);
assert.match(mainUi, /derivedCoachSummaryText/, "coach details must render derived summary variable");
assert.doesNotMatch(
  coachDetailsUi,
  /\{coachSummaryText\}/,
  "main coach details must not display stored coach_summary_text"
);
assert.match(
  studentPage,
  /Сохранённый coach_summary_text из БД/,
  "stored coach summary must remain in collapsed service drafts"
);
assert.match(studentPage, /Исходные служебные черновики/, "stored coach summary must stay in service drafts section");

assert.doesNotMatch(coachSummarySource, /coach_summary_text/, "derived helper must not read stored coach_summary_text");
assert.doesNotMatch(coachSummarySource, /sendTelegram|sendMessage|telegram\.send/i, "derived helper must not send Telegram");
assert.doesNotMatch(
  coachSummarySource,
  /moveWorkout|mutateTrainingPeaks|updateWorkout|executeMove/i,
  "derived helper must not mutate TrainingPeaks"
);

console.log("PASS check-nutrition-derived-coach-summary");
