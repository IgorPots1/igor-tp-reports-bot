import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNutritionNextWeekPlan,
  calculateNutritionDayTypeTarget,
} from "@/features/nutrition/weekly-plan-formulas";

const root = process.cwd();
const formulasPath = join(root, "src/features/nutrition/weekly-plan-formulas.ts");
const formulasSource = readFileSync(formulasPath, "utf8");

assert.doesNotMatch(formulasSource, /from\s+["']openai["']/i, "formula module must not import OpenAI");
assert.doesNotMatch(formulasSource, /sendTelegram|telegramSend|bot\.sendMessage/i, "formula module must not send Telegram");
assert.doesNotMatch(
  formulasSource,
  /mutateTrainingPeaks|updateWorkout|moveWorkout|createWorkout|deleteWorkout|executeMove/i,
  "formula module must not mutate TrainingPeaks"
);

const rest = calculateNutritionDayTypeTarget({ bodyweightKg: 56, dayType: "rest" });
const easy = calculateNutritionDayTypeTarget({ bodyweightKg: 56, dayType: "easy" });
const hard = calculateNutritionDayTypeTarget({ bodyweightKg: 56, dayType: "hard" });
const preLong = calculateNutritionDayTypeTarget({ bodyweightKg: 56, dayType: "pre_long" });
const longRun = calculateNutritionDayTypeTarget({ bodyweightKg: 56, dayType: "long_run" });
const crossTraining = calculateNutritionDayTypeTarget({ bodyweightKg: 56, dayType: "cross_training" });

assert.ok(rest);
assert.ok(easy);
assert.ok(hard);
assert.ok(preLong);
assert.ok(longRun);
assert.ok(crossTraining);

assert.equal(rest?.target_kcal, 1950);
assert.equal(rest?.protein_g, 90);
assert.equal(rest?.fat_g, 60);
assert.equal(rest?.carbs_g, 250);

assert.equal(easy?.target_kcal, 2200);
assert.equal(easy?.protein_g, 90);
assert.equal(easy?.fat_g, 65);
assert.equal(easy?.carbs_g, 290);

assert.equal(hard?.target_kcal, 2400);
assert.equal(hard?.protein_g, 95);
assert.equal(hard?.fat_g, 65);
assert.equal(hard?.carbs_g, 340);

assert.equal(preLong?.target_kcal, 2200);
assert.equal(preLong?.protein_g, 90);
assert.equal(preLong?.fat_g, 65);
assert.equal(preLong?.carbs_g, 310);

assert.equal(longRun?.target_kcal, 2500);
assert.equal(longRun?.protein_g, 95);
assert.equal(longRun?.fat_g, 65);
assert.equal(longRun?.carbs_g, 390);

assert.equal(crossTraining?.target_kcal, 2200);
assert.equal(crossTraining?.protein_g, 90);
assert.equal(crossTraining?.fat_g, 65);
assert.equal(crossTraining?.carbs_g, 290);

const nadezhdaLikeContext = {
  cacheStatus: "ok",
  workouts: [
    { date: "2026-06-09", title: "Бег по пульсу", type: "easy_run" },
    { date: "2026-06-10", title: "6 х 6 мин", type: "intervals" },
    { date: "2026-06-11", title: "Лёгкий бег", type: "easy_run" },
    { date: "2026-06-14", title: "Длительная 18 км", type: "long_run" },
  ],
  keyWorkouts: [{ date: "2026-06-10", title: "6 х 6 мин", type: "intervals", confidence: "high" }],
  longRun: { date: "2026-06-14", title: "Длительная 18 км" },
};

const plan = buildNutritionNextWeekPlan({
  bodyweightKg: 56,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: nadezhdaLikeContext,
});

assert.equal(plan.formula_version, "nutrition_next_week_plan_v1");
assert.equal(plan.days.length, 7);
assert.equal(plan.summary.total_days, 7);
assert.ok(plan.summary.has_training_context);
assert.ok(plan.summary.key_days_count >= 1);
assert.ok(plan.summary.hard_dates.includes("2026-06-10"));
assert.ok(plan.days.some((day) => day.training_type === "rest"), "rest days must be generated for no-workout dates");
assert.ok(plan.days.some((day) => day.date === "2026-06-13" && day.training_type === "pre_long"));
assert.ok(plan.days.some((day) => day.date === "2026-06-10" && day.flags.key_workout));
assert.ok(plan.days.some((day) => day.date === "2026-06-10" && day.workout_title === "6 х 6 мин"));
assert.ok(
  plan.days.some(
    (day) =>
      day.date === "2026-06-10" &&
      day.ideal_target?.carbs_g != null &&
      day.practical_target?.carbs_g != null &&
      day.practical_target.carbs_g <= day.ideal_target.carbs_g
  ),
  "practical target must not exceed ideal target"
);
assert.ok(
  plan.days.some(
    (day) =>
      day.date === "2026-06-10" &&
      day.display_target.carbs_g_min != null &&
      day.display_target.carbs_g_max != null
  ),
  "display target carb range must be present"
);
assert.equal(plan.summary.long_run_source, "explicit_title");
assert.equal(plan.summary.long_run_confidence, "high");
assert.ok(plan.day_type_ideal_targets.hard?.carbs_g === 340);

const sundayDefaultPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 56,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [
      { date: "2026-06-10", title: "6 х 6 мин", type: "intervals" },
      { date: "2026-06-14", title: "Бег по пульсу", type: "easy_run" },
    ],
    keyWorkouts: [{ date: "2026-06-10", title: "6 х 6 мин", type: "intervals", confidence: "high" }],
    longRun: null,
  },
});
const sundayLongRunDay = sundayDefaultPlan.days.find((day) => day.date === "2026-06-14");
assert.equal(sundayLongRunDay?.training_type, "long_run", "Sunday running session should default to long_run");
assert.equal(sundayLongRunDay?.training_label, "Бег по пульсу", "Sunday default must preserve original TP title");
assert.equal(sundayLongRunDay?.long_run_source, "default_sunday");
assert.equal(sundayLongRunDay?.long_run_confidence, "medium");
assert.equal(sundayDefaultPlan.summary.long_run_source, "default_sunday");
assert.ok(sundayDefaultPlan.days.some((day) => day.date === "2026-06-13" && day.training_type === "pre_long"));

const explicitOtherDayPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 56,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [
      { date: "2026-06-12", title: "Long run 18 km", type: "run" },
      { date: "2026-06-14", title: "Бег по пульсу", type: "easy_run" },
    ],
    keyWorkouts: [],
    longRun: null,
  },
});
assert.equal(explicitOtherDayPlan.days.find((day) => day.date === "2026-06-12")?.training_type, "long_run");
assert.equal(explicitOtherDayPlan.days.find((day) => day.date === "2026-06-14")?.training_type, "easy");
assert.equal(explicitOtherDayPlan.summary.long_run_source, "explicit_title");

const missingBodyweight = buildNutritionNextWeekPlan({
  bodyweightKg: null,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: nadezhdaLikeContext,
});

assert.equal(missingBodyweight.summary.missing_bodyweight, true);
assert.ok(missingBodyweight.warnings.includes("missing_bodyweight"));
assert.ok(
  missingBodyweight.days.every(
    (day) =>
      day.target_kcal === null && day.protein_g === null && day.fat_g === null && day.carbs_g === null
  )
);

const noTpContext = buildNutritionNextWeekPlan({
  bodyweightKg: 56,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: { cacheStatus: "empty", workouts: [] },
});
assert.ok(noTpContext.warnings.includes("training_context_missing"));
assert.equal(noTpContext.days.length, 7);
assert.ok(noTpContext.days.every((day) => day.training_type === "unknown"));

const padelPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 60,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-10", title: "Padel Racket", type: "crosstrain" }],
  },
});
const padelDay = padelPlan.days.find((day) => day.date === "2026-06-10");
assert.equal(padelDay?.training_type, "cross_training");
assert.equal(padelDay?.target_kcal, 2350);
assert.ok(padelDay?.target_kcal !== null, "Padel day with bodyweight must not render kcal n/d");

console.log("PASS check-nutrition-next-week-plan-formulas");
