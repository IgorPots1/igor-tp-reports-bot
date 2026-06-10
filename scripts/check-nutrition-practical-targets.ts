import assert from "node:assert/strict";

import { buildNutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
import { renderNutritionTelegramMessage } from "@/features/nutrition/telegram-renderer";

const plan = buildNutritionNextWeekPlan({
  bodyweightKg: 60,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [
      { date: "2026-06-10", title: "8 х 3 мин", type: "intervals" },
      { date: "2026-06-12", title: "Padel Racket", type: "crosstrain" },
      { date: "2026-06-14", title: "Длительная 18 км", type: "long_run" },
    ],
    keyWorkouts: [{ date: "2026-06-10", title: "8 х 3 мин", type: "intervals", confidence: "high" }],
    longRun: { date: "2026-06-14", title: "Длительная 18 км" },
  },
  previousWeekDailyAnalysis: [
    { trainingType: "hard", actual: { kcal: 1600, proteinG: 98, fatG: 50, carbsG: 180 } },
    { trainingType: "hard", actual: { kcal: 1700, proteinG: 100, fatG: 55, carbsG: 200 } },
    { trainingType: "cross_training", actual: { kcal: 1500, proteinG: 95, fatG: 45, carbsG: 165 } },
    { trainingType: "long_run", actual: { kcal: 1800, proteinG: 105, fatG: 55, carbsG: 220 } },
    { trainingType: "easy", actual: { kcal: 1700, proteinG: 95, fatG: 55, carbsG: 190 } },
  ],
});

const hardDay = plan.days.find((day) => day.date === "2026-06-10");
assert.ok(hardDay, "hard day missing");
assert.ok(hardDay?.ideal_target && hardDay.practical_target, "ideal/practical targets must exist");
assert.ok(
  (hardDay?.practical_target?.carbs_g ?? 999) < (hardDay?.ideal_target?.carbs_g ?? 0),
  "practical carbs should step up and not force full ideal immediately"
);
assert.ok(
  (hardDay?.practical_target?.fat_g ?? 0) >= 60,
  "practical fat must respect floor around 1.0 g/kg at 60kg"
);
assert.ok(hardDay?.display_target.carbs_g_min != null && hardDay?.display_target.carbs_g_max != null);

const crossDay = plan.days.find((day) => day.date === "2026-06-12");
assert.ok(crossDay, "cross day missing");
assert.equal(crossDay?.training_type, "cross_training");
assert.ok(crossDay?.target_kcal != null, "cross day must not render as kcal n/d when weight exists");

const render = renderNutritionTelegramMessage({
  formality: "ty",
  athleteName: "Кристина",
  planWeekMode: "current_week",
  interpretation: {
    dayComments: ["🔹 Понедельник (01.06) · лёгкая тренировка\n~1700 ккал · белок ~95 г · жиры ~55 г · углеводы ~190 г.\nДля дня с нагрузкой энергии получилось маловато."],
    weekSummaryRu: "Главный паттерн недели: энергии и углеводов часто не хватало под нагрузку.",
    focusLinesRu: ["Главный шаг - поднять энергию и углеводы в дни нагрузки."],
    weekComparisonLineRu: null,
  },
  nextWeekPlan: plan,
  fallbackPlanLines: ["fallback"],
  hasTargetWeekTrainingContext: true,
  hasPreviousWeeksContext: false,
});
assert.ok(render.ok);
const text = render.text ?? "";
assert.match(text, /ориентиры, не обязательство/i);
assert.match(text, /Мини-таблица/);
assert.match(text, /~\d{4}-\d{4} ккал/);
assert.doesNotMatch(text, /обязательно выйти|нужно съесть ровно/i);

console.log("PASS check-nutrition-practical-targets");
