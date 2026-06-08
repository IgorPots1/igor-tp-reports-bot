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

  assert.equal(safety.blocked, true);
  assert.ok(safety.hardFlags.length > 0);

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
  assert.equal(generated.safety_flags.blocked, true);
  assert.equal(generated.athlete_message_draft, null);
  assert.ok(generated.do_not_send_reasons.length > 0);
  console.log("PASS check-nutrition-safety-blocks");
}

void run();
