import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyNutritionGoalToDayTarget,
  buildNutritionNextWeekPlan,
  calculateNutritionDayTypeTarget,
  computeNutritionGoalDayTarget,
  estimatePlanDayExerciseKcal,
  estimateRestingMetabolicRate,
} from "@/features/nutrition/weekly-plan-formulas";

// Task 10++: the lose/gain deficit/surplus is anchored on a CORRECTED maintenance
// = BMR (Mifflin when height/age known, else Cunningham/FFM) + the day's actual TP
// expenditure, with an energy-availability floor (FFM·30 + exercise). maintain is
// byte-identical; the review evaluates the actual day against the same deficit line.

const BW = 70;

// --- 1. BMR: Mifflin when height+age known, Cunningham fallback otherwise -------
const mifflinF = estimateRestingMetabolicRate({ bodyweightKg: BW, sex: "female", heightCm: 168, ageYears: 38 });
const mifflinM = estimateRestingMetabolicRate({ bodyweightKg: BW, sex: "male", heightCm: 168, ageYears: 38 });
const cunningham = estimateRestingMetabolicRate({ bodyweightKg: BW, sex: "female", heightCm: null, ageYears: null });
assert.equal(mifflinF.source, "mifflin", "height+age → Mifflin");
assert.equal(cunningham.source, "cunningham_ffm", "no height/age → Cunningham fallback");
assert.equal(mifflinM.rmrKcal - mifflinF.rmrKcal, 166, "Mifflin male − female = +5 − (−161) = 166 (sex matters)");
assert.ok(mifflinF.rmrKcal > 800 && mifflinF.rmrKcal < 2000, "RMR in a sane range");
assert.ok(cunningham.rmrKcal > 800, "Cunningham fallback positive");

// --- 2. Corrected maintenance lowers the lose anchor vs the inflated fixed base --
const tp = {
  cacheStatus: "ok",
  workouts: [
    { date: "2026-06-22", title: "Лёгкий бег", type: "easy", durationHours: 0.83, status: "planned" },
    { date: "2026-06-24", title: "Интервалы 6x800", type: "intervals", durationHours: 1.0, status: "planned" },
    { date: "2026-06-27", title: "Длительная", type: "long_run", durationHours: 1.5, distanceKm: 14, status: "planned" },
  ],
};
const planArgs = {
  bodyweightKg: BW,
  planWeekFrom: "2026-06-22",
  planWeekTo: "2026-06-28",
  trainingContext: tp,
} as const;

const losePlanMifflin = buildNutritionNextWeekPlan({
  ...planArgs,
  goalType: "lose",
  sex: "female",
  heightCm: 168,
  ageYears: 38,
});
const losePlanFallback = buildNutritionNextWeekPlan({ ...planArgs, goalType: "lose", sex: "female" });
const maintainPlan = buildNutritionNextWeekPlan({ ...planArgs, goalType: "maintain" });

const mLongRun = maintainPlan.day_type_targets.long_run!;
const loseLongMifflin = losePlanMifflin.day_type_targets.long_run!;
// The whole point: a losing athlete's long day is NOT pushed to the inflated
// fixed-coefficient number (45 kcal/kg = 3150). Corrected base keeps it realistic.
//
// Правило тренера (2026-07-28): в длительную дефицита НЕТ, поэтому длинный день у
// худеющей теперь РАВЕН поддержанию, а не ниже него — строгое «<» тут и падало.
// Смысл проверки сохранён: длинный день не должен ПРЕВЫШАТЬ поддержание, то есть
// снятие дефицита не имеет права превратиться в профицит.
assert.ok(
  loseLongMifflin.target_kcal <= mLongRun.target_kcal,
  `lose long-day must not exceed the fixed-coefficient maintain long-day (${loseLongMifflin.target_kcal} vs ${mLongRun.target_kcal})`
);
// Documented behaviour: the Cunningham fallback (no height/age) runs at/above
// Mifflin on training days — fill height/age for losing athletes to pull them down.
const loseLongFallback = losePlanFallback.day_type_targets.long_run!;
assert.ok(
  loseLongFallback.target_kcal >= loseLongMifflin.target_kcal,
  `Cunningham fallback long-day >= Mifflin (${loseLongFallback.target_kcal} >= ${loseLongMifflin.target_kcal})`
);

// Periodization holds on the corrected base: rest cut hardest, training fueled.
const loseRest = losePlanMifflin.day_type_targets.rest!;
const loseHard = losePlanMifflin.day_type_targets.hard!;
assert.ok(loseHard.target_kcal > loseRest.target_kcal, "training day fueled above rest day");
assert.ok(loseRest.protein_g_per_kg >= 1.8, "high protein on the corrected base too");

// --- 3. Energy-availability floor: sex changes FFM·30, target never below it ----
const ffmFemale = BW * 0.78;
const restFloorFemale = Math.max(ffmFemale * 30, 26 * BW, 1400);
assert.ok(
  loseRest.target_kcal >= Math.round(restFloorFemale) - 50,
  `lose rest day held at/above the EA + absolute floor (${loseRest.target_kcal} vs ~${Math.round(restFloorFemale)})`
);
// A deep deficit cannot push a day below the EA floor.
const deepRestIdeal = calculateNutritionDayTypeTarget({ bodyweightKg: BW, dayType: "rest" })!;
const clamped = applyNutritionGoalToDayTarget(deepRestIdeal, {
  goalType: "lose",
  dayType: "rest",
  bodyweightKg: BW,
  maintenanceKcal: 1500, // artificially low maintenance
  exerciseKcal: 0,
  sex: "female",
})!;
assert.ok(clamped.target_kcal >= Math.round(restFloorFemale) - 50, "EA/absolute floor clamps a deep deficit");

// --- 4. Plan and review share ONE goal-target source (no drift) ----------------
// The review computes the same deficit line per day via computeNutritionGoalDayTarget.
const longExercise = estimatePlanDayExerciseKcal({
  dayType: "long_run",
  bodyweightKg: BW,
  durationHours: 1.5,
  distanceKm: 14,
});
const reviewLong = computeNutritionGoalDayTarget({
  goalType: "lose",
  dayType: "long_run",
  bodyweightKg: BW,
  sex: "female",
  heightCm: 168,
  ageYears: 38,
  exerciseKcal: longExercise,
})!;
const planLongDay = losePlanMifflin.days.find((d) => d.training_type === "long_run")!;
assert.equal(
  reviewLong.target_kcal,
  planLongDay.target_kcal,
  `review deficit line must equal the plan day target (${reviewLong.target_kcal} vs ${planLongDay.target_kcal})`
);
// maintain → computeNutritionGoalDayTarget returns the ideal unchanged.
const maintainTarget = computeNutritionGoalDayTarget({
  goalType: "maintain",
  dayType: "rest",
  bodyweightKg: BW,
  sex: "female",
  heightCm: 168,
  ageYears: 38,
  exerciseKcal: 0,
})!;
assert.deepEqual(
  maintainTarget,
  calculateNutritionDayTypeTarget({ bodyweightKg: BW, dayType: "rest" }),
  "maintain goal target == fixed-coefficient ideal"
);

// --- 5. maintain is unaffected by anthropometrics (regression guard) ------------
const maintainWithAnthro = buildNutritionNextWeekPlan({
  ...planArgs,
  goalType: "maintain",
  sex: "female",
  heightCm: 168,
  ageYears: 38,
});
assert.deepEqual(
  maintainWithAnthro.day_type_targets,
  maintainPlan.day_type_targets,
  "passing sex/height/age must NOT change the maintain plan (byte-identical)"
);
// And maintain == the no-goal formula output.
const noGoal = buildNutritionNextWeekPlan({ ...planArgs });
assert.deepEqual(maintainPlan.day_type_targets, noGoal.day_type_targets, "maintain (default) == no-goal output");

// --- 6. Review facts carry the deficit line; prompt evaluates against it --------
const draftSrc = readFileSync(join(process.cwd(), "src/features/nutrition/draft-generator.ts"), "utf8");
assert.match(draftSrc, /goal_day_target: goalDayTarget/, "per-day facts must carry goal_day_target (the deficit line)");
assert.match(draftSrc, /over_goal_line/, "facts must flag intake above the goal line");
assert.match(draftSrc, /ДЕФИЦИТНАЯ ЛИНИЯ[\s\S]*goal_day_target[\s\S]*а НЕ относительно поддержания/i, "prompt must evaluate the day against the deficit line, not maintenance");
assert.match(draftSrc, /рест-день в 2500–2800 ккал как «спокойный/i, "prompt must forbid calling a high rest day 'calm' for a losing athlete");
// Part E: vegetables > fruits/dried fruit, and no time-anchored advice.
assert.match(draftSrc, /приоритет ОВОЩИ[\s\S]*НЕ фрукты\/сухофрукты/i, "lose food rule: vegetables over fruit/dried fruit");
// bdb141e turned the blanket ban on timing advice into a conditional one: the review may anchor to
// the REAL start time when it is known (time_of_day, a fact), and must not invent one when it is
// not. The old assertion still greps for the deleted blanket sentence; the invariant it guarded —
// no timing advice without a known time — is alive and is what gets pinned here, on both halves:
// the null case, and the plan side (planned workouts carry no time at all).
assert.match(
  draftSrc,
  /Если time_of_day НЕ задано \(null\)[\s\S]{0,120}НЕ выдумывай время[\s\S]{0,160}без «когда именно»/i,
  "unknown training time → day-level guidance only, never an invented «когда именно»"
);
assert.match(
  draftSrc,
  /Никогда не привязывай тайминг к ПЛАНОВОЙ тренировке/i,
  "plan side must never anchor timing to a planned workout (no time exists there)"
);
// Structure is goal-independent: lose stays per-day, never collapses to a generic summary.
assert.match(draftSrc, /ЕДИНЫЙ ФОРМАТ для ВСЕХ целей[\s\S]*ПОДНЕВНАЯ[\s\S]*НЕ структуру/i, "review structure must be per-day for all goals (lose included)");
assert.match(draftSrc, /НЕ сворачивай разбор худеющего[\s\S]*что хорошо \/ что подтянуть/i, "must forbid collapsing a lose review into a generic 'good/improve' summary");

// --- 7. anthropometrics threaded through the profile + context -----------------
const repoSrc = readFileSync(join(process.cwd(), "src/features/nutrition/repository.ts"), "utf8");
assert.match(repoSrc, /export function normalizeNutritionSex/, "repository must expose normalizeNutritionSex");
assert.match(repoSrc, /sex: normalizeNutritionSex\(row\.sex\)/, "profile mapping must read sex");
const ctxSrc = readFileSync(join(process.cwd(), "src/features/nutrition/context.ts"), "utf8");
assert.match(ctxSrc, /sex: essentials\.profile\?\.sex \?\? null/, "context must load sex from the profile");
const methodologySrc = readFileSync(join(process.cwd(), "src/features/nutrition/methodology.ts"), "utf8");
assert.match(methodologySrc, /if \(context\.sex === "female" \|\| context\.sex === "male"\)/, "asSex must prefer the explicit profile field");

const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
assert.match(packageJson, /check:nutrition-goal-methodology/, "package.json must register this check");

console.log("PASS check-nutrition-goal-methodology");
