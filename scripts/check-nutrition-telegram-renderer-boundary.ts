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
import { humanizeNutritionTrainingLabel } from "@/features/nutrition/narrative-composer";

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
      training_label: "Длительная 18 км",
      workout_title: "Длительная 18 км",
      target_kcal: 2500,
      protein_g: 95,
      fat_g: 65,
      carbs_g: 390,
      kcal_per_kg: 45,
      protein_g_per_kg: 1.7,
      fat_g_per_kg: 1.15,
      carbs_g_per_kg: 7,
      flags: { rest: false, easy: false, hard: false, pre_long: false, long_run: true, strength: false, race: false, key_workout: true, day_before_long_run: false, has_training_context: true },
      long_run_source: "explicit_title",
      long_run_confidence: "high",
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
    long_run_source: "explicit_title",
    long_run_confidence: "high",
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
assert.match(text, /^Привет!/, "ty greeting is name-less «Привет!»");
assert.doesNotMatch(text.split("\n")[0] ?? "", /Надя/, "greeting must not contain the athlete name");
assert.doesNotMatch(text, /прошл[а-я]+\s+недел|по сравнению с прошл/i, "must omit comparison without context");
assert.doesNotMatch(
  text,
  /TrainingPeaks|FatSecret|—|–|\*\*|```|Комментарий:|можно дать|hint_for_comment|source_quality|по этому дню вывод делаю осторожно|данных может быть чуть меньше|Данные по питанию за день неполные|вывод короткий|день без тренировки в план тренировок|день без тренировки в TrainingPeaks/
);
assert.match(
  text,
  /Воскресенье \(14\.06\) · длительн.*18.*км · ~(2450-2550|2500) ккал/,
  "Sunday long run label must be deterministic"
);
assert.doesNotMatch(text, /Воскресенье \(14\.06\) · Бег по пульсу/, "Sunday long run must not expose generic TP label");
assert.match(text, /Вторник \(09\.06\) · Бег по пульсу · ~2200 ккал/, "easy Бег по пульсу row may keep source label");
assert.match(text, /📋 Мини-таблица/, "must show mini-table when TP context is available");
assert.doesNotMatch(text, /План на неделю по типам дней/, "must not show day-type plan with TP context");
assert.match(text, /🍽 Перед ключевыми тренировками/, "pre-training block must be present with hard or long_run");
assert.deepEqual(result.issues.filter((issue) => issue.severity === "error"), [], "Nadezhda-like render must have no errors");

const polyakovaRender = renderNutritionTelegramMessage({
  formality: "ty",
  athleteName: "Анастасия",
  planWeekMode: "current_week",
  interpretation: {
    dayComments: ["🔹 Суббота (06.06) · вело 5:16\n~2200 ккал · белок ~95 г · жиры ~65 г · углеводы ~210 г.\nДля дня с нагрузкой энергии получилось маловато."],
    weekSummaryRu: "Лучшие по углеводам дни пришлись не на самые тяжёлые тренировки.",
    focusLinesRu: ["Поддержать углеводы вокруг длинных нагрузок."],
    weekComparisonLineRu: null,
  },
  nextWeekPlan,
  fallbackPlanLines: ["fallback"],
  hasTargetWeekTrainingContext: true,
  hasPreviousWeeksContext: false,
});
assert.match(polyakovaRender.text ?? "", /^Привет!/, "ty greeting name-less");
assert.doesNotMatch(polyakovaRender.text ?? "", /\bCycling\b/);

// Наряд 2: ты/вы must drive the deterministic scaffolding too, not just the
// greeting — the intro line was hardcoded "твой отчёт" and leaked "ты" for a
// formality=vy student (Hoffman). Both branches are pinned here.
assert.match(text, /Посмотрел твой отчёт за неделю/, "ty render keeps the ты intro line");
const vyRender = renderNutritionTelegramMessage({
  formality: "vy",
  athleteName: "Надя",
  planWeekMode: "next_week",
  interpretation: {
    dayComments: ["🔹 Понедельник (01.06) - день отдыха\n~2500 ккал · белок ~105 г · жиры ~130 г · углеводы ~215 г.\nДень отдыха, по питанию спокойно."],
    weekSummaryRu: "По белку спокойно.",
    focusLinesRu: ["Ровные углеводы к ключевым сессиям."],
    weekComparisonLineRu: null,
  },
  nextWeekPlan,
  fallbackPlanLines: ["fallback"],
  hasTargetWeekTrainingContext: true,
  hasPreviousWeeksContext: false,
});
const vyText = vyRender.text ?? "";
assert.match(vyText, /^Здравствуйте!/, "vy greeting is name-less «Здравствуйте!»");
assert.doesNotMatch(vyText.split("\n")[0] ?? "", /Надя/, "vy greeting must not contain the athlete name");
assert.match(vyText, /Посмотрел ваш отчёт за неделю/, "vy render must use the ваш intro line");
assert.doesNotMatch(vyText, /Посмотрел твой отчёт/, "vy render must not leak the ты intro line");

const easyLabelLongStoredPlan: NutritionNextWeekPlan = {
  ...nextWeekPlan,
  days: [
    {
      date: "2026-06-13",
      weekday_ru: "Суббота",
      training_type: "long_run",
      training_label: "лёгкий бег",
      workout_title: "лёгкий бег",
      target_kcal: 2500,
      protein_g: 95,
      fat_g: 65,
      carbs_g: 390,
      kcal_per_kg: 45,
      protein_g_per_kg: 1.7,
      fat_g_per_kg: 1.15,
      carbs_g_per_kg: 7,
      display_target: {
        kcal_min: 2450,
        kcal_max: 2550,
        carbs_g_min: 370,
        carbs_g_max: 410,
      },
      flags: {
        rest: false,
        easy: false,
        hard: false,
        pre_long: false,
        long_run: true,
        strength: false,
        race: false,
        key_workout: true,
        day_before_long_run: false,
        has_training_context: true,
      },
      long_run_source: "none",
      long_run_confidence: "low",
      pre_training_guidance: null,
      source: "tp_workout",
    },
  ],
};

const easyRowRender = renderNutritionTelegramMessage({
  formality: "ty",
  athleteName: "Анастасия",
  planWeekMode: "current_week",
  todayLocalDate: "2026-06-13",
  miniTableMode: "athlete_remaining_only",
  interpretation: {
    dayComments: ["🔹 Суббота (06.06) · вело 5:16\n~2200 ккал."],
    weekSummaryRu: "Итог",
    focusLinesRu: ["Фокус на оставшиеся дни"],
    weekComparisonLineRu: null,
  },
  nextWeekPlan: easyLabelLongStoredPlan,
  fallbackPlanLines: ["fallback"],
  hasTargetWeekTrainingContext: true,
  hasPreviousWeeksContext: false,
});
const easyRowLine = (easyRowRender.text ?? "")
  .split("\n")
  .find((line) => line.startsWith("🟩") && /л[её]гк/i.test(line));
assert.ok(easyRowLine, "easy label row must render with green icon");
assert.match(easyRowLine ?? "", /~2150-2250 ккал|~2200-2300 ккал|~2100-2300 ккал|~2200 ккал/, "easy row should not keep long target kcal");
assert.match(easyRowLine ?? "", /270-310У|290У/, "easy row should use easy carb target range");
assert.doesNotMatch(easyRowLine ?? "", /370-410У|390У/, "easy row should not have long target carbs");

const emptyNameRender = renderNutritionTelegramMessage({
  formality: "ty",
  athleteName: "",
  planWeekMode: "current_week",
  interpretation: {
    dayComments: ["🔹 Понедельник (01.06) · день отдыха\n~2000 ккал."],
    weekSummaryRu: "Итог недели",
    focusLinesRu: ["Фокус"],
    weekComparisonLineRu: null,
  },
  nextWeekPlan,
  fallbackPlanLines: ["fallback"],
  hasTargetWeekTrainingContext: true,
  hasPreviousWeeksContext: false,
});
assert.match(emptyNameRender.text ?? "", /^Привет!/);

// Regression: a long run held at easy pace ("бег в легком темпе" + long cue)
// must not be labeled "лёгкий бег" — otherwise the 🟥 square and the text
// disagree and trigger red_easy_row. A genuine easy run still reads "лёгкий бег".
{
  const longEasyPace = humanizeNutritionTrainingLabel("Длинный бег в легком темпе 1:40", "long_run");
  assert.doesNotMatch(longEasyPace, /л[её]гк(?:ий|ая)\s+бег/i, "long run at easy pace must not render as лёгкий бег");
  const longEndurEasyPace = humanizeNutritionTrainingLabel("Бег в легком темпе 1:50", "long_endurance");
  assert.doesNotMatch(longEndurEasyPace, /л[её]гк(?:ий|ая)\s+бег/i, "long endurance at easy pace must not render as лёгкий бег");
  const genuineEasy = humanizeNutritionTrainingLabel("Бег в легком темпе", "easy");
  assert.equal(genuineEasy, "лёгкий бег", "genuine easy run still renders лёгкий бег");
}

console.log("PASS check-nutrition-telegram-renderer-boundary");
