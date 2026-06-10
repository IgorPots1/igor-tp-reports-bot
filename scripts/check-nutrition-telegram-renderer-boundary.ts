import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupPlainText,
  renderNutritionTelegramMessage,
  validateTelegramReadyNutritionMessage,
  type NutritionTelegramRenderResult,
} from "@/features/nutrition/telegram-renderer";
import type { NutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";

function assertHasError(result: ReturnType<typeof validateTelegramReadyNutritionMessage>, rule: string): void {
  assert.ok(
    result.some((issue) => issue.rule === rule && issue.severity === "error"),
    `must catch ${rule}`
  );
}

function assertHasWarning(result: ReturnType<typeof validateTelegramReadyNutritionMessage>, rule: string): void {
  assert.ok(
    result.some((issue) => issue.rule === rule && issue.severity === "warning"),
    `must warn ${rule}`
  );
}

const messy = cleanupPlainText(
  [
    "**Заголовок**",
    "---",
    "> цитата",
    "[текст](https://example.com)",
    "30-60 минут — нормально",
    "```json",
    "{}",
    "```",
  ].join("\n")
);
assert.doesNotMatch(messy, /\*\*|---|```|—|–|\[|\]\(/, "cleanup must remove markdown and long dashes");
assert.match(messy, /30-60 минут - нормально/, "cleanup must keep numeric range readable");
assert.match(messy, /текст/, "cleanup must keep link text");

assertHasError(
  validateTelegramReadyNutritionMessage({
    text: "По сравнению с прошлой неделей стало ровнее.",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: false,
    hasKeyTraining: false,
  }),
  "phantom_previous_comparison"
);
assertHasError(
  validateTelegramReadyNutritionMessage({
    text: "TrainingPeaks видно в тексте.",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: false,
    hasKeyTraining: false,
  }),
  "internal_terms"
);
assertHasError(
  validateTelegramReadyNutritionMessage({
    text: "**markdown**",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: false,
    hasKeyTraining: false,
  }),
  "markdown"
);
assertHasError(
  validateTelegramReadyNutritionMessage({
    text: "текст — текст",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: false,
    hasKeyTraining: false,
  }),
  "plain_dashes"
);
assertHasError(
  validateTelegramReadyNutritionMessage({
    text: "🟥 Воскресенье (14.06) · Бег по пульсу · ~2500 ккал · 95Б · 65Ж · 390У",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: true,
    hasKeyTraining: true,
  }),
  "long_run_label"
);
assert.deepEqual(
  validateTelegramReadyNutritionMessage({
    text: "🟩 Вторник (09.06) · Бег по пульсу · ~2200 ккал · 90Б · 65Ж · 290У",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: true,
    hasKeyTraining: true,
    longRunTargetKcalText: "~2500 ккал",
  }).filter((issue) => issue.rule === "long_run_label"),
  [],
  "easy Бег по пульсу row must not trigger long_run label rule"
);
assertHasError(
  validateTelegramReadyNutritionMessage({
    text: "📋 План на неделю по типам дней\n...\n📋 Мини-таблица\n...",
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: true,
    hasKeyTraining: true,
  }),
  "plan_and_mini_table"
);
assert.deepEqual(
  validateTelegramReadyNutritionMessage({
    text: "а".repeat(3928),
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: false,
    hasKeyTraining: false,
  }),
  [],
  "near-limit text must not warn or block"
);
assertHasWarning(
  validateTelegramReadyNutritionMessage({
    text: "а".repeat(4097),
    hasPreviousWeeksContext: false,
    hasTargetWeekTrainingContext: false,
    hasKeyTraining: false,
  }),
  "telegram_length"
);

const source = readFileSync(join(process.cwd(), "src/features/nutrition/telegram-renderer.ts"), "utf8");
assert.match(source, /export type NutritionTelegramRenderResult/, "renderer result type must exist");
assert.match(source, /cleanupPlainText/, "renderer must expose cleanup boundary");
assert.match(source, /validateTelegramReadyNutritionMessage/, "renderer must expose validator boundary");

const nextWeekPlan: NutritionNextWeekPlan = {
  formula_version: "nutrition_next_week_plan_v1",
  bodyweight_kg: 56,
  rounding: { kcal: "nearest_50", carbs_g: "nearest_10", protein_g: "nearest_5", fat_g: "nearest_5" },
  day_type_targets: {
    rest: { target_kcal: 1950, protein_g: 90, fat_g: 60, carbs_g: 250, kcal_per_kg: 35, protein_g_per_kg: 1.6, fat_g_per_kg: 1.1, carbs_g_per_kg: 4.5 },
    easy: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 290, kcal_per_kg: 39, protein_g_per_kg: 1.6, fat_g_per_kg: 1.15, carbs_g_per_kg: 5.2 },
    hard: { target_kcal: 2400, protein_g: 95, fat_g: 65, carbs_g: 340, kcal_per_kg: 43, protein_g_per_kg: 1.7, fat_g_per_kg: 1.15, carbs_g_per_kg: 6 },
    pre_long: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 310, kcal_per_kg: 39, protein_g_per_kg: 1.6, fat_g_per_kg: 1.15, carbs_g_per_kg: 5.5 },
    long_run: { target_kcal: 2500, protein_g: 95, fat_g: 65, carbs_g: 390, kcal_per_kg: 45, protein_g_per_kg: 1.7, fat_g_per_kg: 1.15, carbs_g_per_kg: 7 },
    strength: null,
  },
  days: [
    {
      date: "2026-06-08",
      weekday_ru: "Понедельник",
      training_type: "rest",
      training_label: "день отдыха",
      workout_title: null,
      target_kcal: 1950,
      protein_g: 90,
      fat_g: 60,
      carbs_g: 250,
      kcal_per_kg: 35,
      protein_g_per_kg: 1.6,
      fat_g_per_kg: 1.1,
      carbs_g_per_kg: 4.5,
      flags: { rest: true, easy: false, hard: false, pre_long: false, long_run: false, strength: false, race: false, key_workout: false, day_before_long_run: false, has_training_context: true },
      long_run_source: "none",
      long_run_confidence: "low",
      pre_training_guidance: null,
      source: "tp_workout",
    },
    {
      date: "2026-06-09",
      weekday_ru: "Вторник",
      training_type: "easy",
      training_label: "Бег по пульсу",
      workout_title: "Бег по пульсу",
      target_kcal: 2200,
      protein_g: 90,
      fat_g: 65,
      carbs_g: 290,
      kcal_per_kg: 39,
      protein_g_per_kg: 1.6,
      fat_g_per_kg: 1.15,
      carbs_g_per_kg: 5.2,
      flags: { rest: false, easy: true, hard: false, pre_long: false, long_run: false, strength: false, race: false, key_workout: false, day_before_long_run: false, has_training_context: true },
      long_run_source: "none",
      long_run_confidence: "low",
      pre_training_guidance: null,
      source: "tp_workout",
    },
    {
      date: "2026-06-10",
      weekday_ru: "Среда",
      training_type: "hard",
      training_label: "Темпо",
      workout_title: "Темпо",
      target_kcal: 2400,
      protein_g: 95,
      fat_g: 65,
      carbs_g: 340,
      kcal_per_kg: 43,
      protein_g_per_kg: 1.7,
      fat_g_per_kg: 1.15,
      carbs_g_per_kg: 6,
      flags: { rest: false, easy: false, hard: true, pre_long: false, long_run: false, strength: false, race: false, key_workout: true, day_before_long_run: false, has_training_context: true },
      long_run_source: "none",
      long_run_confidence: "low",
      pre_training_guidance: null,
      source: "tp_workout",
    },
    {
      date: "2026-06-14",
      weekday_ru: "Воскресенье",
      training_type: "long_run",
      training_label: "Бег по пульсу",
      workout_title: "Бег по пульсу",
      target_kcal: 2500,
      protein_g: 95,
      fat_g: 65,
      carbs_g: 390,
      kcal_per_kg: 45,
      protein_g_per_kg: 1.7,
      fat_g_per_kg: 1.15,
      carbs_g_per_kg: 7,
      flags: { rest: false, easy: false, hard: false, pre_long: false, long_run: true, strength: false, race: false, key_workout: true, day_before_long_run: false, has_training_context: true },
      long_run_source: "default_sunday",
      long_run_confidence: "medium",
      pre_training_guidance: null,
      source: "tp_workout",
    },
  ],
  summary: {
    has_training_context: true,
    total_days: 3,
    days_with_training: 2,
    key_days_count: 2,
    long_run_dates: ["2026-06-14"],
    long_run_source: "default_sunday",
    long_run_confidence: "medium",
    hard_dates: ["2026-06-10"],
    missing_bodyweight: false,
  },
  warnings: [],
};

const result: NutritionTelegramRenderResult = renderNutritionTelegramMessage({
  formality: "ty",
  athleteName: "Надя",
  planWeekMode: "next_week",
  interpretation: {
    dayComments: [
      "🔹 Понедельник (01.06) - день отдыха\n~2500 ккал · белок ~105 г · жиры ~130 г · углеводы ~215 г.\nДень отдыха. По питанию всё спокойно, явного конфликта с нагрузкой нет.",
    ],
    weekSummaryRu: "По белку всё спокойно. Главный фокус - держать углеводы рядом с ключевыми тренировками.",
    focusLinesRu: ["Ровные углеводы к ключевым сессиям", "Без резких просадок в дни нагрузки."],
    weekComparisonLineRu: "По сравнению с прошлой неделей стало лучше.",
  },
  nextWeekPlan,
  fallbackPlanLines: ["fallback"],
  hasTargetWeekTrainingContext: true,
  hasPreviousWeeksContext: false,
});

assert.equal(result.ok, true, "Nadezhda-like render must be copy-ready");
assert.ok(result.text, "Nadezhda-like render must include text");
const text = result.text ?? "";
assert.match(text, /^Надя, привет!/);
assert.doesNotMatch(text, /прошл[а-я]+\s+недел|по сравнению с прошл/i, "must omit comparison without context");
assert.doesNotMatch(
  text,
  /TrainingPeaks|FatSecret|—|–|\*\*|```|Комментарий:|можно дать|hint_for_comment|source_quality|по этому дню вывод делаю осторожно|данных может быть чуть меньше/
);
assert.match(text, /Воскресенье \(14\.06\) · длительная · ~2500 ккал/, "Sunday long run label must be deterministic");
assert.doesNotMatch(text, /Воскресенье \(14\.06\) · Бег по пульсу/, "Sunday long run must not expose generic TP label");
assert.match(text, /Вторник \(09\.06\) · Бег по пульсу · ~2200 ккал/, "easy Бег по пульсу row may keep source label");
assert.match(text, /📋 Мини-таблица/, "must show mini-table when TP context is available");
assert.doesNotMatch(text, /План на неделю по типам дней/, "must not show day-type plan with TP context");
assert.match(text, /🍽 Перед ключевыми тренировками/, "pre-training block must be present with hard or long_run");
assert.deepEqual(result.issues.filter((issue) => issue.severity === "error"), [], "Nadezhda-like render must have no errors");

console.log("PASS check-nutrition-telegram-renderer-boundary");
