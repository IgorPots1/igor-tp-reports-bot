import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";
import { buildDerivedNutritionCoachDayByDayText } from "@/features/nutrition/combined-message";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";

function contextFixture(row: { kcal: number; proteinG: number; fatG: number; carbsG: number }, workout: { title: string; type: string }): NutritionStudentContext {
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
    manualMacroRows: [
      { day: "2026-06-01", weekday: "пн", confidence: 1, notes: null, ...row },
      { day: "2026-06-02", weekday: "вт", kcal: 2100, proteinG: 100, fatG: 65, carbsG: 280, confidence: 1, notes: null },
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
          type: workout.type,
          status: "completed",
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

function reviewFromMethodology(methodology: ReturnType<typeof buildNutritionMethodologyContext>): NutritionWeeklyAnalysis {
  return {
    id: "review-macro",
    studentId: "student-kristina",
    reportId: "report-macro",
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

const proteinOkCtx = contextFixture(
  { kcal: 1400, proteinG: 100, fatG: 45, carbsG: 165 },
  { title: "Padel Racket", type: "crosstrain" }
);
const proteinOkMethodology = buildNutritionMethodologyContext({ context: proteinOkCtx });
const proteinOkDay = proteinOkMethodology.dailyAnalysis[0]?.canonicalDailyAnalysis;
assert.ok(proteinOkDay);
assert.equal(proteinOkDay?.macroGuardrails.protein.status, "ok");
assert.equal(proteinOkDay?.macroGuardrails.fat.status, "low");
assert.ok(
  proteinOkDay?.macroGuardrails.carbs.status === "low" || proteinOkDay?.macroGuardrails.carbs.status === "borderline",
  "Padel 1400/165g carbs at 60kg must not be fully OK for carbs"
);
assert.notEqual(proteinOkDay?.nutritionStatus, "adequate");
assert.notEqual(proteinOkDay?.nutritionStatus, "rest_ok");

const strengthLowCtx = contextFixture(
  { kcal: 1400, proteinG: 95, fatG: 40, carbsG: 150 },
  { title: "Strength", type: "strength" }
);
const strengthLowMethodology = buildNutritionMethodologyContext({ context: strengthLowCtx });
const strengthLowDay = strengthLowMethodology.dailyAnalysis[0]?.canonicalDailyAnalysis;
assert.ok(strengthLowDay);
assert.notEqual(strengthLowDay?.nutritionStatus, "adequate");
assert.notEqual(strengthLowDay?.nutritionStatus, "rest_ok");

const rendered = buildDerivedNutritionCoachDayByDayText(reviewFromMethodology(proteinOkMethodology)) ?? "";
assert.match(
  rendered,
  /Белок есть|Белок закрыт хорошо|главный момент не в белке|Жиров в этот день получилось низковато|Углеводов для такого дня низковато|энергии получилось маловато/
);
assert.doesNotMatch(rendered, /День выглядит ровно: белок закрыт, углеводов под эту нагрузку достаточно/);

console.log("PASS check-nutrition-macro-guardrails");
