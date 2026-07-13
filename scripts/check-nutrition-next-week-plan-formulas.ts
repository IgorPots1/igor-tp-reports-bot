import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNutritionNextWeekPlan,
  calculateNutritionDayTypeTarget,
  CARB_LOADING_FLOOR_G_PER_KG,
  computeCarbBaseFromReview,
  computeCarbLoadingTargets,
  computeNutritionGoalDayTarget,
  computeRaceDayTarget,
  estimatePlanDayExerciseKcal,
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

// Carbs = the MIDDLE of the review's carb corridor (not its floor); kcal = the macros.
// These numbers moved when the plan stopped aiming at the bottom of the corridor and started
// deriving the kcal from the food (rest 56 kg: 1950 shown / 1660 eaten → 1800 / 1800).
assert.equal(rest?.target_kcal, 1800);
assert.equal(rest?.protein_g, 90);
assert.equal(rest?.fat_g, 60);
assert.equal(rest?.carbs_g, 220);

assert.equal(easy?.target_kcal, 2050);
assert.equal(easy?.protein_g, 90);
assert.equal(easy?.fat_g, 65);
assert.equal(easy?.carbs_g, 270);

assert.equal(hard?.target_kcal, 2350);
assert.equal(hard?.protein_g, 95);
assert.equal(hard?.fat_g, 65);
assert.equal(hard?.carbs_g, 340);

assert.equal(preLong?.target_kcal, 2300);
assert.equal(preLong?.protein_g, 90);
assert.equal(preLong?.fat_g, 65);
assert.equal(preLong?.carbs_g, 340);

assert.equal(longRun?.target_kcal, 2600);
assert.equal(longRun?.protein_g, 95);
assert.equal(longRun?.fat_g, 65);
assert.equal(longRun?.carbs_g, 410);

assert.equal(crossTraining?.target_kcal, 2200);
assert.equal(crossTraining?.protein_g, 90);
assert.equal(crossTraining?.fat_g, 65);
assert.equal(crossTraining?.carbs_g, 310);

// THE invariant, pinned for every goal and every day type: the kcal ARE the macros. The numbers
// above can legitimately be re-tuned; this cannot. It is what the athlete sees on one line
// («~1800 ккал · 90 Б · 60 Ж · 220 У»), and it silently drifted for two weeks because nothing
// asserted it. Tolerance is the rounding grid only (kcal to 50, macros to 5/10).
for (const bodyweightKg of [50, 55, 56, 60, 70, 74]) {
  for (const dayType of ["rest", "easy", "hard", "pre_long", "long_run", "cross_training", "strength"] as const) {
    const exerciseKcal = estimatePlanDayExerciseKcal({ dayType, bodyweightKg, durationHours: null, distanceKm: null });
    for (const goalType of ["maintain", "lose", "gain"] as const) {
      const target = computeNutritionGoalDayTarget({
        goalType,
        dayType,
        bodyweightKg,
        sex: "female",
        heightCm: 168,
        ageYears: 32,
        exerciseKcal,
      });
      assert.ok(target, `${goalType}/${dayType}/${bodyweightKg}kg must produce a target`);
      const fromMacros = target.protein_g * 4 + target.fat_g * 9 + target.carbs_g * 4;
      const drift = Math.abs(fromMacros - target.target_kcal);
      assert.ok(
        drift <= 25,
        `${goalType}/${dayType}/${bodyweightKg}kg: kcal ${target.target_kcal} but the food is ${fromMacros} (${drift} kcal apart)`
      );
    }
  }
}

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

// Regression: an interval run whose title mentions a recovery jog ("отдых бегом")
// must be a hard day, not easy/rest (family "run" must not swallow it).
const intervalRecoveryPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 56,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-10", title: "4 x 4 мин (отдых бегом)", type: "run" }],
    keyWorkouts: [],
    longRun: null,
  },
});
assert.ok(
  intervalRecoveryPlan.days.some((day) => day.date === "2026-06-10" && day.training_type === "hard"),
  "interval run titled 'отдых бегом' must be a hard day, not easy/rest"
);

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
const sundayEasyDay = sundayDefaultPlan.days.find((day) => day.date === "2026-06-14");
assert.equal(sundayEasyDay?.training_type, "easy", "Sunday easy run without duration/title must not default to long_run");
assert.equal(sundayEasyDay?.training_label, "Бег по пульсу", "Sunday easy must preserve original TP title");
assert.equal(sundayEasyDay?.long_run_source, "none");
assert.equal(sundayDefaultPlan.summary.long_run_source, "none");
assert.ok(
  !sundayDefaultPlan.days.some((day) => day.training_type === "pre_long"),
  "pre_long only when next day is true long_run"
);

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
// Padel = light intermittent cross → light-cross corridor 3.5–5, middle 4.25 g/kg.
assert.equal(padelDay?.target_kcal, 2050);
assert.ok(padelDay?.target_kcal !== null, "Padel day with bodyweight must not render kcal n/d");

// --- S2 fix: race-day target — мини-таблица больше не «н/д» ---
// 10K / short race → intense (hard) base, NOT null.
const race10 = computeRaceDayTarget({ bodyweightKg: 60, distanceKm: 10, title: "Ночной забег" });
assert.ok(race10 && race10.target_kcal != null, "race 10 км must have a target (not н/д)");
assert.equal(race10?.carbs_g, 360, "race 10 км carbs at intense level (6 г/кг × 60)");
assert.equal(race10?.target_kcal, 2450, "race 10 км kcal = its macros (hard corridor middle, no loading)");
// Half-marathon → carbs raised to loading high (8 г/кг), kcal bumped.
const raceHM = computeRaceDayTarget({ bodyweightKg: 60, distanceKm: 21.1, title: "Полумарафон" });
assert.equal(raceHM?.carbs_g, 480, "HM carbs at loading high (8 г/кг × 60)");
assert.ok((raceHM?.target_kcal ?? 0) > (race10?.target_kcal ?? 0), "HM kcal higher than 10K (loading)");
// Unknown distance → intense base, never null.
const raceUnknown = computeRaceDayTarget({ bodyweightKg: 60, distanceKm: null, title: "Старт" });
assert.ok(raceUnknown && raceUnknown.target_kcal != null, "unknown-distance race still has a target");
assert.equal(raceUnknown?.carbs_g, 360, "unknown distance → intense base carbs");
// No bodyweight → null (consistent with other day types).
assert.equal(computeRaceDayTarget({ bodyweightKg: null, distanceKm: 10 }), null, "no bodyweight → null");

// Plan integration: a race-day in the plan renders КБЖУ, not н/д.
const racePlan = buildNutritionNextWeekPlan({
  bodyweightKg: 60,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-13", title: "Ночной забег", type: "race", distanceKm: 10 }],
  },
});
const raceDay = racePlan.days.find((day) => day.date === "2026-06-13");
assert.equal(raceDay?.training_type, "race", "race workout → race day type");
assert.ok(raceDay?.target_kcal != null, "race day in plan must not render kcal н/д");
assert.ok(raceDay?.carbs_g != null && raceDay?.protein_g != null && raceDay?.fat_g != null, "race day Б/Ж/У not н/д");

// --- Carb-loading base from real review days ---
// Mean of usable days; >50 g counted, ≤50 g dropped as under-recorded.
assert.equal(
  computeCarbBaseFromReview([240, 260, 70]),
  190,
  "base = mean of all days > 50 g (240+260+70)/3"
);
// A day at/below 50 g (forgotten dinner) is excluded; a real low day (70 g) stays.
assert.equal(
  computeCarbBaseFromReview([300, 200, 40, 70]),
  190,
  "≤50 g day excluded, 70 g real-low day kept: (300+200+70)/3"
);
assert.equal(computeCarbBaseFromReview([50, 50]), null, "all days ≤50 g (boundary) → null");
assert.equal(computeCarbBaseFromReview([0, 10, 30]), null, "all garbage days → null");
assert.equal(computeCarbBaseFromReview([]), null, "no days → null");
assert.equal(computeCarbBaseFromReview([250, 250]), 250, "Nadia-like base ≈ 250");

// --- Carb-loading targets: clamp + ramp ---
// Nadia: base 250, weight 55, corridorUpper 8, N=2 → ceiling 440, target 325.
// Ramp last lead day = full target; race day = target. 325/55 = 5.9 г/кг (below
// corridor lower 6 — that's OK, it comes from a real base, no forced jump).
const nadiaLoad = computeCarbLoadingTargets({ baseG: 250, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2 });
assert.deepEqual(nadiaLoad.leadDays, [288, 325], "Nadia lead-day ramp [288, 325]");
assert.equal(nadiaLoad.raceDay, 325, "Nadia race-day carbs 325");

// Base above the ceiling → hold the base (don't cut), flat ramp.
const richBase = computeCarbLoadingTargets({ baseG: 500, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2 });
assert.equal(richBase.raceDay, 500, "base above ceiling holds the base (target = base = 500)");
assert.deepEqual(richBase.leadDays, [500, 500], "base above ceiling → flat ramp [500, 500]");

// Marathon, N=3: 3 interpolated points, last = target. base 300, corridorUpper 9,
// weight 60 → ceiling 540, target = min(390, 540) = 390. Ramp 330/360/390.
const marathonLoad = computeCarbLoadingTargets({ baseG: 300, weightKg: 60, corridorUpperGkg: 9, leadDayCount: 3 });
assert.equal(marathonLoad.leadDays.length, 3, "marathon ramp has N=3 points");
assert.deepEqual(marathonLoad.leadDays, [330, 360, 390], "marathon ramp [330, 360, 390]");
assert.equal(marathonLoad.raceDay, 390, "marathon race-day = target 390");
assert.equal(marathonLoad.leadDays[2], marathonLoad.raceDay, "last lead day == race-day target");

// Floor: a loading day must not drop below the easy-run carbs. Nadia real base
// 236.91, 55 kg, easy carbs = 290 → raw ramp пт 272 floored to 290; сб 308, старт 308.
const flooredLoad = computeCarbLoadingTargets({ baseG: 236.91, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2, floorG: 290 });
assert.deepEqual(flooredLoad.leadDays, [290, 308], "floor lifts ramp пт 272→290, keeps сб 308");
assert.equal(flooredLoad.raceDay, 308, "race day stays above floor (308)");
// No floor (default 0) leaves the raw ramp.
const unflooredLoad = computeCarbLoadingTargets({ baseG: 236.91, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2 });
assert.deepEqual(unflooredLoad.leadDays, [272, 308], "no floor → raw ramp [272, 308]");

// --- Plan integration: carb loading from real base on lead + race days (HM+) ---
// Nadia-like: base ≈ 250 (prev week all ~250), 55 kg, HM 21.1 km on Sun 28.06.
// Raw ramp 288→325; easy-run floor (290) lifts 26.06 to 290; race day 28.06 = 325.
// All loading days stay ≥ the easy-run carbs (290).
const loadingPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 55,
  planWeekFrom: "2026-06-22",
  planWeekTo: "2026-06-28",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-28", title: "Угличский полумарафон", type: "race", distanceKm: 21.1 }],
  },
  previousWeekDailyAnalysis: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-06-${15 + i}`,
    actual: { carbsG: 250 },
  })),
});
const lead1 = loadingPlan.days.find((day) => day.date === "2026-06-26");
const lead2 = loadingPlan.days.find((day) => day.date === "2026-06-27");
const raceLoadDay = loadingPlan.days.find((day) => day.date === "2026-06-28");
// The loading floor is its OWN number (CARB_LOADING_FLOOR_G_PER_KG), not the easy-day target: a
// start line must not move because a training-day setting was re-tuned. 5.3 × 55 = 290 g.
const loadingFloorCarbs = Math.round((CARB_LOADING_FLOOR_G_PER_KG * 55) / 10) * 10;
assert.equal(loadingFloorCarbs, 290, "loading floor at 55 kg is 290 g");
assert.equal(lead1?.carbs_g, 290, "lead day -2 lifted from its raw 288 ramp to the 290 g loading floor");
assert.equal(lead2?.carbs_g, 325, "lead day -1 carbs reach full target 325");
assert.equal(raceLoadDay?.carbs_g, 325, "race day carbs = base-relative target 325 (not ceiling 440)");
assert.equal(raceLoadDay?.training_type, "race", "race day type");
for (const d of [lead1, lead2, raceLoadDay]) {
  assert.ok((d?.carbs_g ?? 0) >= loadingFloorCarbs, `loading day ${d?.date} carbs ≥ loading floor ${loadingFloorCarbs}`);
}

// The floor only LIFTS from below — it must never cut a well-fuelled athlete down, and it must
// never override the base-driven ramp when that ramp already clears it.
const lowBase = computeCarbLoadingTargets({ baseG: 180, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2, floorG: loadingFloorCarbs });
assert.ok(
  lowBase.leadDays.every((grams: number) => grams >= 290) && lowBase.raceDay >= 290,
  `a low base (180 g) must still toe the start at the floor, got ${lowBase.leadDays.join("/")} → ${lowBase.raceDay}`
);
const highBase = computeCarbLoadingTargets({ baseG: 320, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2, floorG: loadingFloorCarbs });
assert.equal(highBase.raceDay, 416, "a high base keeps its base-driven target (320 × 1.3), untouched by the floor");
assert.deepEqual(highBase.leadDays, [368, 416], "the base-driven ramp is not flattened by the floor");
const ceilingCapped = computeCarbLoadingTargets({ baseG: 400, weightKg: 55, corridorUpperGkg: 8, leadDayCount: 2, floorG: loadingFloorCarbs });
assert.equal(ceilingCapped.raceDay, 440, "the corridor ceiling (8 × 55) still caps the top — the floor never raises above it");

// Recovery is NOT loading: the day after a start stays on the easy-day target, which is exactly
// the coupling this change breaks. Both numbers exist; they are different numbers.
const easyFloorCarbs = calculateNutritionDayTypeTarget({ bodyweightKg: 55, dayType: "easy" })?.carbs_g ?? 0;
assert.equal(easyFloorCarbs, 260, "recovery floor stays the easy-day target (260 g at 55 kg)");
assert.notEqual(easyFloorCarbs, loadingFloorCarbs, "loading and recovery floors must be independent");
assert.equal(lead1?.flags.carb_loading, true, "lead day -2 marked carb_loading");
assert.equal(lead2?.flags.carb_loading, true, "lead day -1 marked carb_loading");
assert.equal(raceLoadDay?.flags.carb_loading, true, "race day marked carb_loading");
assert.equal(raceLoadDay?.race_protocol?.loading_hydration_note, true, "race protocol carries hydration-note flag");
// kcal recomputed from the three macros (protein/fat unchanged), rounded to 50.
for (const day of [lead1, lead2, raceLoadDay]) {
  assert.ok(day && day.protein_g != null && day.fat_g != null && day.carbs_g != null && day.target_kcal != null);
  const expectedKcal = Math.round((4 * day.carbs_g + 4 * day.protein_g + 9 * day.fat_g) / 50) * 50;
  assert.equal(day.target_kcal, expectedKcal, `kcal recomputed from macros on ${day.date}`);
  assert.ok(
    day.display_target.carbs_g_min === Math.round((day.carbs_g - 20) / 10) * 10,
    `display carb range tracks loading carbs on ${day.date}`
  );
}

// Recovery day after a SUNDAY race (28.06) → Monday 29.06 appended for display,
// WITHOUT changing the Mon–Sun window (8 days only because of the tail recovery).
assert.equal(loadingPlan.days.length, 8, "Sunday race appends the Monday recovery day (7 + 1)");
const recoveryDay = loadingPlan.days.find((day) => day.date === "2026-06-29");
assert.ok(recoveryDay, "recovery day 29.06 present");
assert.equal(recoveryDay?.flags.recovery, true, "29.06 flagged recovery");
assert.ok((recoveryDay?.carbs_g ?? 0) >= easyFloorCarbs, "recovery carbs ≥ easy-run (glycogen)");
assert.ok(
  (recoveryDay?.protein_g ?? 0) >= Math.round((1.8 * 55) / 5) * 5,
  "recovery protein at upper repair band (~1.8 г/кг)"
);
assert.ok(
  recoveryDay && recoveryDay.target_kcal === Math.round((4 * recoveryDay.carbs_g! + 4 * recoveryDay.protein_g! + 9 * recoveryDay.fat_g!) / 50) * 50,
  "recovery kcal recomputed from macros"
);
// A NON-Sunday race keeps 7 days (recovery is in-window).
const midweekRacePlan = buildNutritionNextWeekPlan({
  bodyweightKg: 55,
  planWeekFrom: "2026-06-22",
  planWeekTo: "2026-06-28",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-24", title: "Старт", type: "race", distanceKm: 10 }],
  },
  previousWeekDailyAnalysis: Array.from({ length: 7 }, () => ({ actual: { carbsG: 250 } })),
});
assert.equal(midweekRacePlan.days.length, 7, "mid-week race keeps 7 days (recovery in-window)");
assert.equal(
  midweekRacePlan.days.find((day) => day.date === "2026-06-25")?.flags.recovery,
  true,
  "day after mid-week race (25.06) elevated in place"
);

// Fallback: no real base (all garbage prev-week days) → standard race-day target
// (ceiling 8 г/кг × 55 = 440), NOT base-relative loading. No carb_loading flag.
const noBasePlan = buildNutritionNextWeekPlan({
  bodyweightKg: 55,
  planWeekFrom: "2026-06-22",
  planWeekTo: "2026-06-28",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-28", title: "Угличский полумарафон", type: "race", distanceKm: 21.1 }],
  },
  previousWeekDailyAnalysis: [{ date: "2026-06-15", actual: { carbsG: 20 } }],
});
const noBaseRace = noBasePlan.days.find((day) => day.date === "2026-06-28");
// No real base → the loading override never runs; the existing race-day practical
// target stands (here capped by the baseline jump, not the base-relative 325).
assert.notEqual(noBaseRace?.flags.carb_loading, true, "no base → race day not flagged carb_loading");
assert.notEqual(noBaseRace?.carbs_g, 325, "no base → carbs are NOT the base-relative loading target");

// Short race (10K): loading=null → NO carb-loading override (by design).
const shortRacePlan = buildNutritionNextWeekPlan({
  bodyweightKg: 55,
  planWeekFrom: "2026-06-22",
  planWeekTo: "2026-06-28",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-28", title: "Десятка", type: "race", distanceKm: 10 }],
  },
  previousWeekDailyAnalysis: Array.from({ length: 7 }, () => ({ actual: { carbsG: 250 } })),
});
const shortRaceDay = shortRacePlan.days.find((day) => day.date === "2026-06-28");
assert.notEqual(shortRaceDay?.flags.carb_loading, true, "10K race → no carb-loading (loading=null)");
assert.equal(shortRaceDay?.carbs_g, 330, "10K race keeps intense base carbs (6 г/кг × 55)");

console.log("PASS check-nutrition-next-week-plan-formulas");
