import assert from "node:assert/strict";

import {
  buildNutritionSafetyFlags,
  normalizeManualMacroInput,
} from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import type { NutritionStudentContext } from "@/features/nutrition/context";

async function run(): Promise<void> {
  const rows = normalizeManualMacroInput(
    ["Пн 1100 ккал Б70 Ж40 У60", "Вт 1150 ккал Б80 Ж45 У70", "Ср 1200 ккал Б82 Ж46 У75"].join("\n"),
    "2026-06-01"
  );
  const safety = buildNutritionSafetyFlags({
    studentName: "Test Student",
    studentNotes: ["есть риск рпп, требуется осторожность"],
    nutritionContextItems: [],
    rows,
    weightLogs: [
      {
        id: "w1",
        studentId: "s1",
        weightKg: 63,
        loggedAt: "2026-05-20T00:00:00.000Z",
        source: "manual",
        confirmedByCoach: true,
        rawText: null,
        createdAt: "2026-05-20T00:00:00.000Z",
      },
      {
        id: "w2",
        studentId: "s1",
        weightKg: 59,
        loggedAt: "2026-06-03T00:00:00.000Z",
        source: "manual",
        confirmedByCoach: true,
        rawText: null,
        createdAt: "2026-06-03T00:00:00.000Z",
      },
    ],
  });

  // Coach decision (Igor): рпп-note + very-low-kcal + rapid weight loss are now
  // recorded as a non-blocking coach record (hardFlags stay populated) but they
  // DO NOT hard-block — the week generates like any other student's.
  assert.equal(safety.blocked, false, "signals no longer hard-block (coach decision)");
  assert.ok(safety.hardFlags.length > 0, "signals are still recorded for the coach");
  assert.equal(safety.doNotSendReasons.length, 0, "safety no longer forces do-not-send");

  const mockContext: NutritionStudentContext = {
    studentName: "Test Student",
    studentSlug: "test-student",
    studentUuid: "student-uuid",
    resolvedCommunicationProfile: {
      formality: "vy",
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
    currentWeightKg: null,
    nutritionGoal: null,
    coachContextRu: null,
    athleteReportSignals: [],
    manualMacroRows: rows,
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
      cacheStatus: "stale",
      cacheStatusNote: "stale",
      totalSessions: 0,
      plannedSessions: 0,
      completedSessions: 0,
      runningSessions: 0,
      longRun: null,
      keyWorkouts: [],
      workouts: [],
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

  const generated = await generateNutritionWeeklyAnalysis({ context: mockContext });
  assert.equal(generated.safety_flags.blocked, false, "generation is not safety-blocked anymore");
  assert.notEqual(generated.status, "blocked_safety", "status is never blocked_safety under the new policy");

  const illnessSignals = (await import("@/features/nutrition/athlete-signals")).detectNutritionAthleteReportSignals(
    "Заболела, была температура"
  );
  const generatedIllnessSignals = await generateNutritionWeeklyAnalysis({
    context: {
      ...mockContext,
      telegramContextNotes: null,
      manualMacroRows: rows.map((row) => ({ ...row, kcal: 1850, carbsG: 210 })),
      athleteReportSignals: illnessSignals,
      tpPastWeek: {
        periodFrom: "2026-06-01",
        periodTo: "2026-06-07",
        cacheStatus: "ok",
        cacheStatusNote: "ok",
        totalSessions: 2,
        plannedSessions: 2,
        completedSessions: 2,
        runningSessions: 2,
        longRun: null,
        keyWorkouts: [{ date: "2026-06-03", title: "Интервалы", type: "run", confidence: "high" }],
        workouts: [
          {
            date: "2026-06-03",
            title: "Интервалы",
            status: "completed",
            type: "run",
            description: null,
            coachComments: null,
            plannedText: null,
          },
        ],
      },
      dataQuality: {
        parsedDays: 3,
        lowConfidenceDays: 0,
        hasResolvedDates: true,
        unrealisticRows: 0,
        duplicateDays: [],
        qualityFlags: [],
      },
    },
  });
  assert.equal(generatedIllnessSignals.status, "needs_review", "illness signals should require coach review without hard block");
  // Illness (soft) must not trigger a HARD safety block — the real property here.
  assert.equal(generatedIllnessSignals.safety_flags.blocked, false, "illness signals alone must not hard-block (safety)");
  // Task 3: with no live model available in the test env, the review is held for
  // regeneration rather than handed a template draft as if ready (Igor decision #3).
  assert.equal(
    generatedIllnessSignals.generation_mode,
    "awaiting_generation",
    "model unavailable -> awaiting_generation (draft held, not auto-blocked by safety)"
  );
  assert.equal(generatedIllnessSignals.athlete_message_draft, null, "held athlete draft when model unavailable");

  console.log("PASS check-nutrition-safety-blocks");
}

void run();
