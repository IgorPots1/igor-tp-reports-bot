import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import {
  isEasyLightNutritionTitle,
  hasExplicitNutritionQualityWorkoutEvidence,
  isExplicitNutritionLongRunTitle,
  isNutritionLongRunWorkout,
  NUTRITION_LONG_RUN_MIN_DURATION_MINUTES,
} from "@/features/nutrition/long-run";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";
import { buildNutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";

function basePastContext(workouts: NutritionStudentContext["tpPastWeek"]["workouts"]): NutritionStudentContext {
  return {
    studentName: "Test",
    studentSlug: "test",
    studentUuid: "student-test",
    resolvedCommunicationProfile: {
      formality: "ty",
      formalitySource: "manual",
      tone: "neutral",
      preferredGreeting: null,
      notes: null,
      conflictFlags: [],
    },
    communicationProfilePromptLines: [],
    telegramContextNotes: null,
    coachMemoryItems: [],
    nutritionContextItems: [],
    weightLogs: [],
    currentWeightKg: 58,
    nutritionGoal: null,
    coachContextRu: null,
    athleteReportSignals: [],
    manualMacroRows: [
      { day: "2026-06-06", weekday: "сб", kcal: 1600, proteinG: 90, fatG: 50, carbsG: 140, confidence: 1, notes: null },
      { day: "2026-06-07", weekday: "вс", kcal: 1800, proteinG: 95, fatG: 55, carbsG: 200, confidence: 1, notes: null },
    ],
    dataQuality: {
      parsedDays: 2,
      lowConfidenceDays: 0,
      hasResolvedDates: true,
      unrealisticRows: 0,
      duplicateDays: [],
      qualityFlags: [],
    },
    reportStatus: "ready_for_analysis",
    tpPastWeek: {
      periodFrom: "2026-06-06",
      periodTo: "2026-06-07",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: workouts.length,
      plannedSessions: 0,
      completedSessions: workouts.filter((item) => item.status === "completed").length,
      runningSessions: 1,
      longRun: null,
      keyWorkouts: [],
      workouts,
    },
    tpNextWeek: {
      periodFrom: "2026-06-08",
      periodTo: "2026-06-14",
      cacheStatus: "empty",
      cacheStatusNote: "empty",
      totalSessions: 0,
      plannedSessions: 0,
      completedSessions: 0,
      runningSessions: 0,
      longRun: null,
      keyWorkouts: [],
      workouts: [],
    },
  };
}

assert.equal(NUTRITION_LONG_RUN_MIN_DURATION_MINUTES, 70);

assert.equal(
  isNutritionLongRunWorkout({ title: "Easy run", durationMinutes: 75, mode: "past_review", isCompleted: true }),
  true,
  "75 min easy run => long_run"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "3×15 мин", durationMinutes: 73, mode: "past_review", isCompleted: true }),
  false,
  "73 min interval session must not become long_run by duration"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Tempo 91 min", durationMinutes: 91, mode: "past_review", isCompleted: true }),
  false,
  "91 min tempo session must not become long_run by duration"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Бег в легком темпе", durationMinutes: 75, mode: "past_review", isCompleted: true }),
  true,
  "75 min easy-light title without quality evidence => long_run by duration"
);
assert.equal(isEasyLightNutritionTitle("Легкий бег по темпу"), true);
assert.equal(hasExplicitNutritionQualityWorkoutEvidence("Легкий бег по темпу"), false);
assert.equal(hasExplicitNutritionQualityWorkoutEvidence("3×15 мин"), true);
assert.equal(
  isNutritionLongRunWorkout({ title: "Run", durationMinutes: 80, mode: "past_review", isCompleted: true }),
  true,
  "80 min run => long_run"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Run", durationMinutes: 70, mode: "past_review", isCompleted: true }),
  false,
  "70 min exactly => not long_run by duration"
);
assert.equal(
  isNutritionLongRunWorkout({
    title: "Бег в легком темпе",
    durationMinutes: null,
    mode: "past_review",
    isCompleted: true,
  }),
  false,
  "easy Sunday title without duration => not long_run"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Long Run", mode: "past_review", isCompleted: true }),
  true,
  "Long Run title => long_run"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Длительная 16 км", mode: "past_review", isCompleted: true }),
  true,
  "Длительная title => long_run"
);
assert.equal(
  isNutritionLongRunWorkout({
    title: "Long run 18 km",
    durationMinutes: 90,
    mode: "past_review",
    isCompleted: false,
  }),
  false,
  "planned-only long run in past_review => not long_run"
);
assert.equal(
  isNutritionLongRunWorkout({
    title: "Long run 18 km",
    durationMinutes: 90,
    mode: "target_plan",
    isCompleted: false,
  }),
  true,
  "planned long run in target_plan => long_run"
);

const polyakovaContext = basePastContext([
  {
    date: "2026-06-06",
    title: "Cycling",
    status: "completed",
    type: "bike",
    description: null,
    coachComments: null,
    plannedText: null,
    durationHours: 5.25,
  },
  {
    date: "2026-06-07",
    title: "Бег в легком темпе",
    status: "completed",
    type: "run",
    description: null,
    coachComments: null,
    plannedText: null,
    durationHours: null,
  },
]);
const polyakovaMethodology = buildNutritionMethodologyContext({ context: polyakovaContext });
const polyakovaSaturday = polyakovaMethodology.dailyAnalysis.find((day) => day.date === "2026-06-06");
const polyakovaSunday = polyakovaMethodology.dailyAnalysis.find((day) => day.date === "2026-06-07");
assert.notEqual(polyakovaSaturday?.canonicalDailyAnalysis.trainingType, "pre_long");
assert.notEqual(polyakovaSaturday?.trainingType, "pre_long");
assert.equal(polyakovaSaturday?.trainingType, "long_endurance");
assert.equal(polyakovaSaturday?.canonicalDailyAnalysis.trainingType, "long_endurance");
assert.notEqual(polyakovaSunday?.trainingType, "long_run");
assert.notEqual(polyakovaSunday?.canonicalDailyAnalysis.trainingType, "long_run");

const targetPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 58,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    workouts: [
      { date: "2026-06-13", title: "Easy spin", type: "easy" },
      { date: "2026-06-14", title: "Long run 18 km", type: "run", durationHours: 1.5 },
    ],
  },
});
assert.ok(targetPlan.days.some((day) => day.date === "2026-06-13" && day.training_type === "pre_long"));
assert.ok(targetPlan.days.some((day) => day.date === "2026-06-14" && day.training_type === "long_run"));

const sundayEasyPlan = buildNutritionNextWeekPlan({
  bodyweightKg: 58,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    workouts: [{ date: "2026-06-14", title: "Бег по пульсу", type: "easy_run" }],
  },
});
const sundayEasyDay = sundayEasyPlan.days.find((day) => day.date === "2026-06-14");
assert.notEqual(sundayEasyDay?.training_type, "long_run", "Sunday easy without duration/title must not be long_run");
assert.ok(
  !sundayEasyPlan.days.some((day) => day.training_type === "pre_long"),
  "pre_long only when next day is true long_run"
);

const longEndurancePlan = buildNutritionNextWeekPlan({
  bodyweightKg: 58,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    workouts: [
      { date: "2026-06-13", title: "Easy jog", type: "run" },
      { date: "2026-06-14", title: "Cycling", type: "bike", durationHours: 5.25, distanceKm: 70 },
    ],
  },
});
assert.ok(longEndurancePlan.days.some((day) => day.date === "2026-06-14" && day.training_type === "long_endurance"));
assert.ok(longEndurancePlan.days.some((day) => day.date === "2026-06-13" && day.training_type === "pre_long"));

const shortBikePlan = buildNutritionNextWeekPlan({
  bodyweightKg: 58,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    workouts: [{ date: "2026-06-10", title: "Cycling", type: "bike", durationHours: 0.84 }],
  },
});
assert.ok(shortBikePlan.days.some((day) => day.date === "2026-06-10" && day.training_type === "cross_training"));

assert.equal(isExplicitNutritionLongRunTitle("long intervals"), false, "plain long intervals should not match");

console.log("PASS check-nutrition-long-run-classification");
