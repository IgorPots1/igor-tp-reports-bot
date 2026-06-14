import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildDerivedNutritionCoachSummary } from "../src/features/nutrition/coach-summary";
import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
import { humanizeNutritionTrainingLabel } from "../src/features/nutrition/narrative-composer";
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
assert.match(derivedSummary, /Длительная|длительн|Ключевая тренировка|Long run|вело/i, "derived summary must include key workout pattern");
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

function buildHighFatReviewWithFoodItems(): NutritionWeeklyAnalysis {
  return {
    ...buildHighFatReview(),
    nutritionSummary: {
      ...asObject(buildHighFatReview().nutritionSummary),
      daily_analysis: [
        {
          date: "2026-06-09",
          weekday_ru: "Вторник",
          date_label: "09.06",
          training_type: "easy",
          training_label: "лёгкий бег",
          nutrition_status: "low_for_load",
          findings: ["high_fat_percent", "high_fat_may_displace_carbs_on_load_day"],
          macroGuardrails: {
            protein: { status: "ok" },
            fat: { status: "high", percentStatus: "high", g: 95, percentEnergy: 47, coachOnlyFindings: ["high_fat_percent"] },
            carbs: { status: "borderline" },
          },
          canonical_daily_analysis: {
            date: "2026-06-09",
            items: [
              { name: "сыр", section: "dinner", kcal: 320, proteinG: 18, fatG: 26, carbsG: 2 },
              { name: "орехи", section: "snack", kcal: 280, proteinG: 8, fatG: 24, carbsG: 6 },
            ],
          },
        },
      ],
    },
  };
}

const highFatFoodSummary = buildDerivedNutritionCoachSummary({ review: buildHighFatReviewWithFoodItems() });
assert.match(highFatFoodSummary, /Заметные источники вечером:/i, "coach summary must show notable evening fat foods");
assert.match(highFatFoodSummary, /сыр|орехи/i, "coach summary must include evening food names coach-only");

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

function buildPolyakovaLikeReview(): NutritionWeeklyAnalysis {
  return {
    ...review,
    id: "review-polyakova-like",
    weekFrom: "2026-06-02",
    weekTo: "2026-06-08",
    nutritionSummary: {
      ...asObject(review.nutritionSummary),
      one_focus: {
        statement_ru: "Данных пока недостаточно для точного тренировка-день анализа, нужен ручной разбор.",
      },
      data_quality_summary: {
        parsed_days: 6,
        low_confidence_days: 0,
      },
      daily_analysis: [
        {
          date: "2026-06-04",
          training_type: "hard",
          training_label: "8 х 4 мин + Cycling",
          nutrition_status: "low_for_load",
          findings: ["low_carbs_for_load_type"],
          macroGuardrails: {
            protein: { status: "ok" },
            fat: { status: "ok" },
            carbs: { status: "low", g: 180, gPerKg: 3.1 },
          },
        },
        {
          date: "2026-06-06",
          training_type: "long_endurance",
          training_label: "длинная выносливостная нагрузка 5:16: Cycling",
          nutrition_status: "low_for_load",
          findings: ["low_carbs_for_load_type"],
          macroGuardrails: {
            protein: { status: "ok" },
            fat: { status: "ok" },
            carbs: { status: "borderline", g: 210, gPerKg: 3.6 },
          },
        },
        {
          date: "2026-06-07",
          training_type: "long_run",
          training_label: "длительная: бег",
          nutrition_status: "long_run_low",
          findings: ["low_carbs_for_load_type"],
          macroGuardrails: {
            protein: { status: "ok" },
            fat: { status: "ok" },
            carbs: { status: "low", g: 190, gPerKg: 3.2 },
          },
        },
        {
          date: "2026-06-02",
          training_type: "easy",
          training_label: "Бег в легком темпе",
          nutrition_status: "below_energy_floor",
          findings: [],
          macroGuardrails: { protein: { status: "ok" }, fat: { status: "ok" }, carbs: { status: "low", g: 170, gPerKg: 2.9 } },
        },
        {
          date: "2026-06-03",
          training_type: "rest",
          training_label: "день отдыха",
          nutrition_status: "rest_ok",
          findings: [],
          macroGuardrails: { protein: { status: "ok" }, fat: { status: "ok" }, carbs: { status: "ok", g: 260, gPerKg: 4.5 } },
        },
        {
          date: "2026-06-05",
          training_type: "cross_training",
          training_label: "Cycling",
          nutrition_status: "low_for_cross_training",
          findings: [],
          macroGuardrails: { protein: { status: "ok" }, fat: { status: "ok" }, carbs: { status: "ok", g: 320, gPerKg: 5.5 } },
        },
      ],
    },
  };
}

const polyakovaSummary = buildDerivedNutritionCoachSummary({ review: buildPolyakovaLikeReview() });
assert.doesNotMatch(polyakovaSummary, /Данных пока недостаточно/, "stale limited-data focus must not leak when facts are sufficient");
assert.match(polyakovaSummary, /Фокус недели: углеводы и энергия вокруг длинных нагрузок/i);
assert.doesNotMatch(polyakovaSummary, /\bCycling\b/);
assert.doesNotMatch(polyakovaSummary, /длительная: длительная/i);
assert.match(polyakovaSummary, /вело 5:16|вело/i);
assert.doesNotMatch(polyakovaSummary, /длительная беговая работа \(вело/i);
assert.doesNotMatch(polyakovaSummary, /беговая работа \(вело/i);
assert.match(polyakovaSummary, /Лучшие по углеводам дни пришлись не на самые тяжёлые тренировки/i);
assert.equal(humanizeNutritionTrainingLabel("длинная выносливостная нагрузка 5:16: Cycling", "long_endurance"), "вело 5:16");

console.log("PASS check-nutrition-derived-coach-summary");
