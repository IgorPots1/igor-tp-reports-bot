import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";
import { buildDerivedNutritionCoachDayByDayText } from "@/features/nutrition/combined-message";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import { buildNutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";

function baseContext(workout: { title: string; type: string }, kcal = 1400): NutritionStudentContext {
  return {
    studentName: "Kristina",
    studentSlug: "kristina",
    studentUuid: "student-kristina",
    resolvedCommunicationProfile: {
      formality: "ty",
      formalitySource: "manual",
      tone: "neutral",
      preferredGreeting: null,
      notes: null,
      conflictFlags: [],
    },
    communicationProfilePromptLines: [],
    telegramContextNotes: "female",
    coachMemoryItems: [],
    nutritionContextItems: [],
    weightLogs: [],
    currentWeightKg: 60,
    nutritionGoal: null,
    coachContextRu: null,
    athleteReportSignals: [],
    manualMacroRows: [
      { day: "2026-06-01", weekday: "пн", kcal, proteinG: 100, fatG: 45, carbsG: 130, confidence: 1, notes: null },
      { day: "2026-06-02", weekday: "вт", kcal: 2100, proteinG: 100, fatG: 65, carbsG: 270, confidence: 1, notes: null },
      { day: "2026-06-03", weekday: "ср", kcal: 2100, proteinG: 100, fatG: 65, carbsG: 270, confidence: 1, notes: null },
    ],
    dataQuality: {
      parsedDays: 3,
      lowConfidenceDays: 0,
      hasResolvedDates: true,
      unrealisticRows: 0,
      duplicateDays: [],
      qualityFlags: [],
    },
    reportStatus: "ready_for_analysis",
    tpPastWeek: {
      periodFrom: "2026-06-01",
      periodTo: "2026-06-07",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: 1,
      plannedSessions: 1,
      completedSessions: 1,
      runningSessions: 0,
      longRun: null,
      keyWorkouts: [],
      workouts: [
        {
          date: "2026-06-01",
          title: workout.title,
          status: "completed",
          type: workout.type,
          description: null,
          coachComments: null,
          plannedText: null,
        },
      ],
    },
    tpNextWeek: {
      periodFrom: "2026-06-08",
      periodTo: "2026-06-14",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
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

function reviewFromContext(context: NutritionStudentContext): NutritionWeeklyAnalysis {
  const methodology = buildNutritionMethodologyContext({ context });
  return {
    id: "review-cross",
    studentId: context.studentUuid,
    reportId: "report-cross",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      daily_analysis: methodology.dailyAnalysis,
      methodology_signals: { protein_sufficient: methodology.proteinSufficient },
      do_not_send_reasons: [],
    },
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "deterministic-check",
    athleteMessageDraft: null,
    coachEdits: null,
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
  };
}

assert.equal(classifyTrainingPeaksWorkoutActivity({ title: "Padel Racket" }).family, "crosstrain");
assert.equal(classifyTrainingPeaksWorkoutActivity({ title: "Padel" }).family, "crosstrain");
assert.equal(classifyTrainingPeaksWorkoutActivity({ title: "paddle" }).family, "paddle");

const padelMethodology = buildNutritionMethodologyContext({ context: baseContext({ title: "Padel Racket", type: "crosstrain" }) });
const padelDay = padelMethodology.dailyAnalysis[0]?.canonicalDailyAnalysis;
assert.equal(padelDay?.trainingType, "cross_training");
assert.notEqual(padelDay?.nutritionStatus, "adequate");
assert.ok(padelDay?.findings.includes("below_cross_training_floor"));

const padelText = buildDerivedNutritionCoachDayByDayText(reviewFromContext(baseContext({ title: "Padel Racket", type: "crosstrain" }))) ?? "";
assert.doesNotMatch(padelText, /День выглядит ровно|ничего специально менять не нужно/);
assert.match(padelText, /падел|Падел|кросс-тренировка|нагрузку/);
assert.equal(padelDay?.trainingLabel, "падел");

const strengthText = buildDerivedNutritionCoachDayByDayText(reviewFromContext(baseContext({ title: "Strength", type: "strength" }))) ?? "";
assert.doesNotMatch(strengthText, /День выглядит ровно|ничего специально менять не нужно/);
assert.match(strengthText, /силовой|восстановления/);

const plan = buildNutritionNextWeekPlan({
  bodyweightKg: 60,
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  trainingContext: {
    cacheStatus: "ok",
    workouts: [{ date: "2026-06-09", title: "Padel Racket", type: "crosstrain" }],
  },
});
const planPadelDay = plan.days.find((day) => day.date === "2026-06-09");
assert.equal(planPadelDay?.training_type, "cross_training");
assert.equal(planPadelDay?.target_kcal, 2350);
assert.notEqual(planPadelDay?.target_kcal, null);

const multiWorkoutContext = baseContext({ title: "Strength", type: "strength" });
multiWorkoutContext.manualMacroRows = [
  { day: "2026-06-03", weekday: "ср", kcal: 1400, proteinG: 80, fatG: 40, carbsG: 170, confidence: 1, notes: null },
];
multiWorkoutContext.tpPastWeek.workouts = [
  { date: "2026-06-03", title: "Strength", status: "completed", type: "strength", description: null, coachComments: null, plannedText: null },
  { date: "2026-06-03", title: "Running", status: "completed", type: "run", description: null, coachComments: null, plannedText: null },
  { date: "2026-06-07", title: "Бег по пульсу", status: "planned", type: "run", description: null, coachComments: null, plannedText: null },
];
multiWorkoutContext.tpPastWeek.longRun = null;
const multiMethodology = buildNutritionMethodologyContext({ context: multiWorkoutContext });
const wednesday = multiMethodology.dailyAnalysis.find((day) => day.date === "2026-06-03")?.canonicalDailyAnalysis;
assert.equal(wednesday?.trainingLabel, "силовая + бег");
assert.equal(wednesday?.trainingType, "easy");
const plannedLongRunContext = baseContext({ title: "Padel Racket", type: "crosstrain" });
plannedLongRunContext.manualMacroRows = [
  { day: "2026-06-06", weekday: "сб", kcal: 1600, proteinG: 90, fatG: 50, carbsG: 140, confidence: 1, notes: null },
  { day: "2026-06-07", weekday: "вс", kcal: 1800, proteinG: 95, fatG: 55, carbsG: 200, confidence: 1, notes: null },
];
plannedLongRunContext.tpPastWeek.workouts = [
  { date: "2026-06-06", title: "Padel Racket", status: "completed", type: "crosstrain", description: null, coachComments: null, plannedText: null },
  { date: "2026-06-07", title: "Бег по пульсу", status: "planned", type: "run", description: null, coachComments: null, plannedText: null },
];
plannedLongRunContext.tpPastWeek.longRun = null;
const plannedLongRunMethodology = buildNutritionMethodologyContext({ context: plannedLongRunContext });
const saturday = plannedLongRunMethodology.dailyAnalysis.find((day) => day.date === "2026-06-06")?.canonicalDailyAnalysis;
const sunday = plannedLongRunMethodology.dailyAnalysis.find((day) => day.date === "2026-06-07")?.canonicalDailyAnalysis;
assert.notEqual(saturday?.nutritionStatus, "pre_long_low");
assert.equal(sunday?.trainingType, "rest");

console.log("PASS check-nutrition-cross-training-load");
