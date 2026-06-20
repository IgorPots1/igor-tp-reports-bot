import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyNutritionGoalToDayTarget,
  calculateNutritionDayTypeTarget,
  buildNutritionNextWeekPlan,
} from "@/features/nutrition/weekly-plan-formulas";
import { selectNutritionWeeklyFocus } from "@/features/nutrition/methodology";

// Task 10: student goal (lose/maintain/gain) drives the methodology.
// lose = moderate periodized deficit + high protein + controlled fat; maintain
// is byte-identical to the previous behavior; goal never weakens safety.

const BW = 60;

// --- 1. applyNutritionGoalToDayTarget ----------------------------------------
const restIdeal = calculateNutritionDayTypeTarget({ bodyweightKg: BW, dayType: "rest" });
const hardIdeal = calculateNutritionDayTypeTarget({ bodyweightKg: BW, dayType: "hard" });
assert.ok(restIdeal && hardIdeal, "ideal targets must exist for bw>0");

// maintain → unchanged.
assert.deepEqual(
  applyNutritionGoalToDayTarget(restIdeal, { goalType: "maintain", dayType: "rest", bodyweightKg: BW }),
  restIdeal,
  "maintain must not change the target"
);

const restLose = applyNutritionGoalToDayTarget(restIdeal, { goalType: "lose", dayType: "rest", bodyweightKg: BW })!;
const hardLose = applyNutritionGoalToDayTarget(hardIdeal, { goalType: "lose", dayType: "hard", bodyweightKg: BW })!;
// Deficit: lose kcal below maintenance, and rest is cut MORE than hard (periodization).
assert.ok(restLose.target_kcal < restIdeal.target_kcal, "lose rest kcal must be below maintenance");
assert.ok(hardLose.target_kcal < hardIdeal.target_kcal, "lose hard kcal must be below maintenance");
assert.ok(
  restIdeal.target_kcal - restLose.target_kcal > hardIdeal.target_kcal - hardLose.target_kcal,
  "rest day must be cut more than hard day (fuel for the work required)"
);
// Protein HIGH (>=1.8 g/kg), fat controlled (20-30% energy), carbs floored.
assert.ok(restLose.protein_g_per_kg >= 1.8, "lose protein must be high (>=1.8 g/kg)");
const fatPct = (restLose.fat_g * 9) / restLose.target_kcal;
assert.ok(fatPct >= 0.19 && fatPct <= 0.31, `lose fat must be 20-30% energy (got ${(fatPct * 100).toFixed(0)}%)`);
assert.ok(restLose.carbs_g >= 2.0 * BW - 10, "lose carbs floored ~2 g/kg for CNS");
// Hard day keeps more carbs than rest day (periodization).
assert.ok(hardLose.carbs_g > restLose.carbs_g, "lose hard-day carbs must exceed rest-day carbs");
// gain → surplus.
const restGain = applyNutritionGoalToDayTarget(restIdeal, { goalType: "gain", dayType: "rest", bodyweightKg: BW })!;
assert.ok(restGain.target_kcal > restIdeal.target_kcal, "gain kcal must exceed maintenance");

// Safety floor: a tiny athlete's lose target never drops below the absolute floor.
const tinyRest = calculateNutritionDayTypeTarget({ bodyweightKg: 45, dayType: "rest" })!;
const tinyLose = applyNutritionGoalToDayTarget(tinyRest, { goalType: "lose", dayType: "rest", bodyweightKg: 45 })!;
assert.ok(tinyLose.target_kcal >= 1400, "lose deficit clamped to absolute kcal floor (>=1400)");

// --- 2. buildNutritionNextWeekPlan: lose vs maintain --------------------------
const ctx = {
  cacheStatus: "ok",
  workouts: [
    { date: "2026-06-09", title: "Интервалы 6x6", type: "intervals", status: "completed" },
    { date: "2026-06-08", title: "Отдых", type: "rest", status: "completed" },
  ],
  keyWorkouts: [{ date: "2026-06-09", title: "Интервалы 6x6", type: "intervals" }],
};
const maintainPlan = buildNutritionNextWeekPlan({
  bodyweightKg: BW,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: ctx,
  goalType: "maintain",
});
const losePlan = buildNutritionNextWeekPlan({
  bodyweightKg: BW,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: ctx,
  goalType: "lose",
});
const maintRest = maintainPlan.day_type_targets.rest!;
const loseRest = losePlan.day_type_targets.rest!;
assert.ok(loseRest.target_kcal < maintRest.target_kcal, "lose plan rest kcal must be below maintain plan");
assert.ok(loseRest.protein_g_per_kg >= 1.8, "lose plan protein high");
// maintain plan must equal the pre-goal formula path (regression guard).
const maintRestNoGoal = buildNutritionNextWeekPlan({
  bodyweightKg: BW,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: ctx,
}).day_type_targets.rest!;
assert.deepEqual(maintRest, maintRestNoGoal, "maintain (default) must equal the no-goal formula output");

// --- 3. Goal-aware focus (Bug C) ----------------------------------------------
const baseMethodology = (signals: Record<string, boolean>) =>
  ({
    carbProgressionStrategy: "maintain",
    focusCandidateSignals: {
      severeEnergyAvailability: false,
      longRunUnderfueling: false,
      hardSessionUnderfueling: false,
      postHardRecoverySupport: false,
      carbsAroundKeySessions: false,
      weeklyConsistency: false,
      proteinSupport: false,
      limitedData: false,
      highFat: false,
      ...signals,
    },
  }) as unknown as Parameters<typeof selectNutritionWeeklyFocus>[0]["methodology"];

assert.equal(
  selectNutritionWeeklyFocus({ methodology: baseMethodology({ highFat: true }), blockedSafety: false, goalType: "lose" }).category,
  "lose_high_fat",
  "lose + high fat → lose_high_fat focus (not maintenance)"
);
assert.equal(
  selectNutritionWeeklyFocus({ methodology: baseMethodology({}), blockedSafety: false, goalType: "lose" }).category,
  "lose_steady_deficit",
  "lose + no underfueling/highfat → lose_steady_deficit (not vague maintenance)"
);
// Fuel-for-work still wins on hard-day underfueling even for lose.
assert.equal(
  selectNutritionWeeklyFocus({ methodology: baseMethodology({ hardSessionUnderfueling: true }), blockedSafety: false, goalType: "lose" }).category,
  "hard_session_underfueling",
  "lose must still flag hard-day underfueling (fuel for the work required)"
);
// maintain unchanged: same signals → maintenance fallback.
assert.equal(
  selectNutritionWeeklyFocus({ methodology: baseMethodology({}), blockedSafety: false, goalType: "maintain" }).category,
  "maintenance",
  "maintain keeps the existing maintenance fallback"
);
// Goal NEVER overrides safety.
assert.equal(
  selectNutritionWeeklyFocus({ methodology: baseMethodology({ highFat: true }), blockedSafety: true, goalType: "lose" }).category,
  "blocked_safety",
  "goal=lose must NOT override a safety block"
);

// --- 4. Prompt + safety wiring (source scan) ----------------------------------
const draftSrc = readFileSync(join(process.cwd(), "src/features/nutrition/draft-generator.ts"), "utf8");
assert.match(draftSrc, /nutrition_goal: input\.context\.nutritionGoalType/, "goal must be in the model facts");
assert.match(draftSrc, /ЦЕЛЬ УЧЕНИКА[\s\S]*lose[\s\S]*ХВАЛИ высокий белок[\s\S]*высокий жир/i, "lose prompt rules present");
assert.match(draftSrc, /ЦЕЛЬ lose НЕ отменяет safety/i, "lose-does-not-bypass-safety rule present");
// lose week-focus must carry the "why this structure" framing tied to the goal.
assert.match(draftSrc, /ЦЕЛЬ lose — РАМКА в next_week_plan_text[\s\S]*работают на твою цель[\s\S]*ТОЛЬКО для lose/i, "lose focus must explain the week is structured for the loss goal");
// safety-flags builder takes no goal input → goal cannot weaken it.
const ctxSrc = readFileSync(join(process.cwd(), "src/features/nutrition/context.ts"), "utf8");
const safetyFn = ctxSrc.slice(ctxSrc.indexOf("export function buildNutritionSafetyFlags"), ctxSrc.indexOf("export function buildNutritionSafetyFlags") + 600);
assert.doesNotMatch(safetyFn, /goalType|nutritionGoal/, "safety-flag builder must not depend on goal (cannot be weakened by it)");

const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
assert.match(packageJson, /check:nutrition-goal-targets/, "package.json must register this check");

console.log("PASS check-nutrition-goal-targets");
