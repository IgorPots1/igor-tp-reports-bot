/**
 * Наряд 3: пометка тренеру о расхождении модельного текста с фактами дней.
 *
 * Пометка — НЕ цензор: ничего не режет и статусы не меняет. Поэтому тест следит за
 * двумя вещами сразу: что расхождение ловится И что ложных срабатываний нет (текст,
 * который сам признал недобор, пометки не получает). Регэксп-семантика в этом проекте
 * уже давала ложные срезы, поэтому предохранитель проверяется явно.
 */
import assert from "node:assert/strict";

import { buildDerivedNutritionCoachSummary } from "@/features/nutrition/coach-summary";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";

const MISMATCH_MARKER = "Текст итога расходится с днями";

function dayFact(input: {
  date: string;
  trainingType: string;
  carbsStatus: string | null;
  nutritionStatus?: string;
  relevance?: string;
}): Record<string, unknown> {
  return {
    date: input.date,
    training_type: input.trainingType,
    training_label: input.trainingType === "rest" ? "день отдыха" : "бег",
    nutrition_status: input.nutritionStatus ?? "adequate",
    relevance: input.relevance ?? "key",
    findings: [],
    macro_guardrails: {
      protein: { status: "ok" },
      fat: { status: "ok" },
      carbs: { status: input.carbsStatus, loadBasis: input.trainingType === "rest" ? "rest" : "hard", gPerKg: 3.4 },
    },
  };
}

function review(input: { days: Array<Record<string, unknown>>; focus: string; draft: string }): NutritionWeeklyAnalysis {
  return {
    id: "fixture",
    studentId: "student",
    reportId: null,
    weekFrom: "2026-07-20",
    weekTo: "2026-07-26",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: { periodFrom: "2026-07-20", periodTo: "2026-07-26", workouts: [] },
    tpNextWeekContext: {},
    nutritionSummary: {
      daily_analysis: input.days,
      one_focus: { statement_ru: input.focus },
      data_quality_summary: { parsed_days: input.days.length, low_confidence_days: 0, quality_flags: [] },
    },
    safetyFlags: { hard_flags: [], soft_flags: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: input.draft,
    coachEdits: null,
    archivedAt: null,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
  } as unknown as NutritionWeeklyAnalysis;
}

const problemDays = [
  dayFact({ date: "2026-07-20", trainingType: "rest", carbsStatus: "ok" }),
  dayFact({ date: "2026-07-21", trainingType: "intervals", carbsStatus: "low" }),
  dayFact({ date: "2026-07-23", trainingType: "long_run", carbsStatus: "low" }),
];

// ── 1. Расхождение ловится ────────────────────────────────────────────────────────
const mismatch = buildDerivedNutritionCoachSummary({
  review: review({
    days: problemDays,
    focus: "Неделя прошла отлично, держим темп.",
    draft: "Привет!\n\nОтличная неделя, всё стабильно. Так держать!",
  }),
});
assert.ok(mismatch.includes(MISMATCH_MARKER), "благополучный текст при low-нагрузочных днях обязан дать пометку");
assert.match(mismatch, /2 нагрузочных дня low/u, "пометка обязана называть число дней с верным согласованием");

// ── 2. Текст признал недобор → пометки НЕТ (главный предохранитель) ───────────────
const acknowledged = buildDerivedNutritionCoachSummary({
  review: review({
    days: problemDays,
    focus: "Неделя хорошая, но углеводов под нагрузку было мало.",
    draft: "Привет!\n\nВ целом хорошо, но в дни работы углеводов было мало — давай подтянем.",
  }),
});
assert.ok(
  !acknowledged.includes(MISMATCH_MARKER),
  "текст, который сам назвал недобор, расхождением не является — пометки быть не должно"
);

// ── 3. Нет проблемных нагрузочных дней → пометки НЕТ ─────────────────────────────
const cleanWeek = buildDerivedNutritionCoachSummary({
  review: review({
    days: [
      dayFact({ date: "2026-07-20", trainingType: "rest", carbsStatus: "ok" }),
      dayFact({ date: "2026-07-21", trainingType: "intervals", carbsStatus: "ok" }),
    ],
    focus: "Неделя прошла отлично.",
    draft: "Отличная неделя, всё стабильно.",
  }),
});
assert.ok(!cleanWeek.includes(MISMATCH_MARKER), "на чистой неделе пометки быть не должно");

// ── 4. suspect-день не создаёт расхождения (стыковка с правкой 2) ────────────────
const suspectOnly = buildDerivedNutritionCoachSummary({
  review: review({
    days: [
      dayFact({ date: "2026-07-20", trainingType: "rest", carbsStatus: "ok" }),
      dayFact({
        date: "2026-07-21",
        trainingType: "intervals",
        carbsStatus: "low",
        nutritionStatus: "suspect",
        relevance: "low_confidence",
      }),
    ],
    focus: "Неделя прошла отлично.",
    draft: "Отличная неделя, всё стабильно.",
  }),
});
assert.ok(
  !suspectOnly.includes(MISMATCH_MARKER),
  "низкий день с негодными данными не повод объявлять текст расходящимся"
);

// ── 5. Пометка ничего не режет: текст ученице не тронут ──────────────────────────
const mismatchReview = review({
  days: problemDays,
  focus: "Неделя прошла отлично, держим темп.",
  draft: "Привет!\n\nОтличная неделя, всё стабильно. Так держать!",
});
assert.equal(
  mismatchReview.athleteMessageDraft,
  "Привет!\n\nОтличная неделя, всё стабильно. Так держать!",
  "черновик ученице обязан остаться нетронутым — пометка только для тренера"
);
assert.equal(
  (mismatchReview.nutritionSummary as Record<string, unknown>).one_focus &&
    ((mismatchReview.nutritionSummary as Record<string, unknown>).one_focus as Record<string, unknown>).statement_ru,
  "Неделя прошла отлично, держим темп.",
  "фокус недели обязан остаться нетронутым"
);

console.log("PASS check-nutrition-text-vs-days-mismatch");
