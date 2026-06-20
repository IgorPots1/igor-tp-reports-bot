import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import {
  composeNutritionDayComment,
  NutritionNarrativeRepetitionState,
} from "@/features/nutrition/narrative-composer";
import { buildNutritionNextWeekPlan, estimatePlanDayExerciseKcal } from "@/features/nutrition/weekly-plan-formulas";
import { resolveNutritionActivityCoefByTitle } from "@/features/nutrition/activity-energy";

// Task 10d:
//  Bug 2 — expenditure scales with intensity (intervals > easy of equal duration),
//          for ALL goals; long runs use distance.
//  Bug 1 — the goal "deficit line" numbers are allowed by the prose validator, and
//          the deterministic rest-day comment is goal-aware (no "спокойно" when a
//          losing athlete's rest day is over the deficit line). maintain unchanged.

// --- Bug 2: intensity coefficient (plan side) ---------------------------------
const BW = 70;
const easyKcal = estimatePlanDayExerciseKcal({ dayType: "easy", bodyweightKg: BW, durationHours: 1, distanceKm: null });
const hardKcal = estimatePlanDayExerciseKcal({ dayType: "hard", bodyweightKg: BW, durationHours: 1, distanceKm: null });
assert.ok(hardKcal > easyKcal, `intervals/hard must burn more than easy for equal duration (${hardKcal} > ${easyKcal})`);
// Long run uses distance (≈ km × bw) when present.
const longKcal = estimatePlanDayExerciseKcal({ dayType: "long_run", bodyweightKg: BW, durationHours: 1.5, distanceKm: 14 });
assert.equal(longKcal, 14 * BW, "long run uses distance × bodyweight when distance is present");
// Попутный баг: long run WITHOUT distance falls back to duration (not 0/null).
const longNoDist = estimatePlanDayExerciseKcal({ dayType: "long_run", bodyweightKg: BW, durationHours: 1.5, distanceKm: null });
assert.ok(longNoDist > 0, "long run without distance still estimates from duration");

// End-to-end on the plan: a losing athlete's interval day gets more kcal + carbs
// than an easy day of the same duration.
const tp = {
  cacheStatus: "ok",
  workouts: [
    { date: "2026-06-23", title: "Лёгкий бег", type: "easy", durationHours: 1.0, status: "planned" },
    { date: "2026-06-25", title: "Интервалы 6x5 мин", type: "intervals", durationHours: 1.0, status: "planned" },
  ],
};
const losePlan = buildNutritionNextWeekPlan({
  bodyweightKg: BW,
  planWeekFrom: "2026-06-22",
  planWeekTo: "2026-06-28",
  trainingContext: tp,
  goalType: "lose",
  sex: "female",
  heightCm: 168,
  ageYears: 40,
});
const easyT = losePlan.day_type_targets.easy!;
const hardT = losePlan.day_type_targets.hard!;
assert.ok(hardT.target_kcal > easyT.target_kcal, `interval day kcal > easy day kcal (${hardT.target_kcal} > ${easyT.target_kcal})`);
assert.ok(hardT.carbs_g > easyT.carbs_g, `interval day carbs > easy day carbs (${hardT.carbs_g} > ${easyT.carbs_g})`);

// maintain plan must NOT be affected by the intensity coefficient (byte-identical).
const maintainPlan = buildNutritionNextWeekPlan({ bodyweightKg: BW, planWeekFrom: "2026-06-22", planWeekTo: "2026-06-28", trainingContext: tp, goalType: "maintain" });
const maintainNoGoal = buildNutritionNextWeekPlan({ bodyweightKg: BW, planWeekFrom: "2026-06-22", planWeekTo: "2026-06-28", trainingContext: tp });
assert.deepEqual(maintainPlan.day_type_targets, maintainNoGoal.day_type_targets, "maintain plan unchanged by intensity coefficient");

// --- Non-run activities: coach-approved coefficients (kcal/kg/h) ---------------
assert.equal(resolveNutritionActivityCoefByTitle("Walk 60 мин"), 3.5, "walk coef 3.5");
assert.equal(resolveNutritionActivityCoefByTitle("Hike"), 6, "hike coef 6");
assert.equal(resolveNutritionActivityCoefByTitle("Tennis"), 7, "tennis coef 7");
assert.equal(resolveNutritionActivityCoefByTitle("Padel"), 7, "padel coef 7");
assert.equal(resolveNutritionActivityCoefByTitle("Swim"), 7, "swim coef 7");
assert.equal(resolveNutritionActivityCoefByTitle("Cycling"), 5, "bike coef 5 (mostly easy/recreational)");
assert.equal(resolveNutritionActivityCoefByTitle("Strength"), 5, "strength coef 5 (conservative)");
assert.equal(resolveNutritionActivityCoefByTitle("Лёгкий бег"), null, "run titles fall through to intensity defaults");
// Walking must cost markedly less than an easy run of equal duration.
const walkKcal = estimatePlanDayExerciseKcal({ dayType: "cross_training", bodyweightKg: 70, durationHours: 1, distanceKm: null, workoutTitle: "Walk" });
const easyRunKcal = estimatePlanDayExerciseKcal({ dayType: "easy", bodyweightKg: 70, durationHours: 1, distanceKm: null });
assert.ok(walkKcal < easyRunKcal * 0.6, `walk (${walkKcal}) must be markedly below easy run (${easyRunKcal})`);
// Strength-day protein accent is prompted (all goals, no timing).
const draftSrc = readFileSync(join(process.cwd(), "src/features/nutrition/draft-generator.ts"), "utf8");
assert.match(draftSrc, /Силовая тренировка[\s\S]*белок в приоритете[\s\S]*Для ВСЕХ целей/i, "strength-day protein accent rule present for all goals");

// --- Bug 1a: goal_day_target numbers are allowed by the prose validator --------
const facts = buildNutritionDayProseFacts({
  date: "2026-06-11",
  actual: { kcal: 2525, proteinG: 115, fatG: 128, carbsG: 230 },
  goal_day_target: { goal: "lose", target_kcal: 1800, protein_g: 135, fat_g: 60, carbs_g: 180 },
});
assert.ok(facts.planTargetNumbers.includes(1800), "deficit-line kcal (1800) must be an allowed prose number");
assert.ok(facts.planTargetNumbers.includes(180), "deficit-line carbs must be an allowed prose number");

// --- Bug 1b: deterministic rest-day comment is goal-aware ----------------------
const restInput = {
  trainingType: "rest",
  trainingLabel: "день отдыха",
  athleteTrainingLabel: "день отдыха",
  nutritionStatus: "rest_ok",
  findings: [],
  macro: { proteinStatus: null, fatStatus: null, carbsStatus: null, fatG: 128 },
  hasNutritionCompletenessIssue: false,
  hasEnergyIssue: false,
  roleInfo: { role: "rest" as const, isKey: false, reason: "rest_day" },
};
const loseRest = composeNutritionDayComment(
  { ...restInput, goalType: "lose", goalDayTargetKcal: 1800, actualKcal: 2525, actualFatG: 128 },
  new NutritionNarrativeRepetitionState()
);
assert.match(loseRest, /многовато/, "lose rest day over the deficit line reads as «многовато»");
assert.match(loseRest, /жиров/i, "high fat is voiced on a lose rest day");
assert.doesNotMatch(loseRest, /спокойн|ровно/i, "lose rest day must not read as calm");
// maintain (no goal fields) → the override never fires; behaviour unchanged.
const maintainRest = composeNutritionDayComment(restInput, new NutritionNarrativeRepetitionState());
assert.doesNotMatch(maintainRest, /ориентир в такие дни около/, "maintain rest comment must be untouched by the goal override");

console.log("PASS check-nutrition-intensity-rest-eval");
