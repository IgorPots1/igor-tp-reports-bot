import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { buildNutritionMethodologyContext, selectNutritionWeeklyFocus } from "@/features/nutrition/methodology";

type Workout = NutritionStudentContext["tpPastWeek"]["workouts"][number];

function macroRows(): NutritionStudentContext["manualMacroRows"] {
  const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"];
  return days.map((day) => ({
    day,
    weekday: null,
    kcal: 1850,
    proteinG: 108,
    fatG: 58,
    carbsG: 200,
    confidence: 1,
    notes: null,
  }));
}

function buildContext(overrides?: Partial<NutritionStudentContext>): NutritionStudentContext {
  return {
    studentName: "Тест",
    studentSlug: "test",
    studentUuid: "student-1",
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
    currentWeightKg: 56,
    nutritionGoal: null,
    coachContextRu: null,
    narrativePreferences: undefined,
    athleteReportSignals: [],
    manualMacroRows: macroRows(),
    dataQuality: {
      parsedDays: 7,
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
    ...overrides,
  } as NutritionStudentContext;
}

async function run(): Promise<void> {
  // 1. Genuine no-training week (noTrainingWeek=true): NOT limited data, focus not
  //    "limited_data", review is attempted (gate open) and the coach caveat note is set.
  {
    const ctx = buildContext({ noTrainingWeek: true });
    const methodology = buildNutritionMethodologyContext({ context: ctx });
    assert.equal(
      methodology.focusCandidateSignals.limitedData,
      false,
      "no-training week must NOT be limited data (empty cache is expected)"
    );
    const focus = selectNutritionWeeklyFocus({ methodology, blockedSafety: false });
    assert.notEqual(focus.category, "limited_data", "no-training week must not route to limited_data focus");

    const generated = await generateNutritionWeeklyAnalysis({ context: ctx });
    const notes = generated.internal_summary?.notes ?? [];
    assert.ok(
      notes.some((n) => n.startsWith("no_training_week:")),
      "coach caveat note present for no-training week"
    );
    // Gate is open -> AI is attempted; no key in test env -> awaiting_generation
    // (NOT the forceNeedsReview dry fallback that a real data gap would produce).
    assert.equal(
      generated.generation_mode,
      "awaiting_generation",
      "no-training week opens the AI gate (attempted, held without a key)"
    );
    // Days are rest/maintenance — no "under load" status.
    for (const day of methodology.dailyAnalysis) {
      assert.notEqual(day.nutritionStatus, "low_for_load", "no-training day must not be low_for_load");
    }
  }

  // 2. Data gap (empty cache, NO neighbor workouts -> noTrainingWeek false): stays
  //    limited data / forced needs-review dry fallback, as before.
  {
    const ctx = buildContext({ noTrainingWeek: false });
    const methodology = buildNutritionMethodologyContext({ context: ctx });
    assert.equal(methodology.focusCandidateSignals.limitedData, true, "true data gap stays limited data");
    const generated = await generateNutritionWeeklyAnalysis({ context: ctx });
    const notes = generated.internal_summary?.notes ?? [];
    assert.equal(generated.generation_mode, "fallback", "data gap is not held — it's the forceNeedsReview fallback");
    assert.ok(
      notes.includes("methodology_facts_incomplete_for_ai_generation"),
      "data gap surfaces methodology_facts_incomplete_for_ai_generation"
    );
    assert.ok(
      !notes.some((n) => n.startsWith("no_training_week:")),
      "no maintenance caveat for a real data gap"
    );
  }

  // 3. Missed/mixed week: a PLANNED-but-not-completed workout collapses to rest at
  //    the day level (must not pull load), even on a low-carb day.
  {
    const workouts: Workout[] = [
      {
        date: "2026-06-03",
        title: "Easy run",
        status: "completed",
        type: "run",
        description: "easy",
        coachComments: null,
        plannedText: null,
        durationHours: 0.6,
        distanceKm: 7,
      },
      {
        date: "2026-06-05",
        title: "Intervals 8x400",
        status: "planned", // planned but NOT completed -> skipped
        type: "run",
        description: "8x400",
        coachComments: null,
        plannedText: null,
        durationHours: 1,
        distanceKm: 10,
      },
    ];
    const rows = macroRows().map((r) => (r.day === "2026-06-05" ? { ...r, kcal: 1450, carbsG: 110 } : r));
    const ctx = buildContext({
      manualMacroRows: rows,
      tpPastWeek: {
        ...buildContext().tpPastWeek,
        cacheStatus: "ok",
        cacheStatusNote: "ok",
        totalSessions: 2,
        completedSessions: 1,
        plannedSessions: 2,
        workouts,
      },
    });
    const methodology = buildNutritionMethodologyContext({ context: ctx });
    const missedDay = methodology.dailyAnalysis.find((d) => d.date === "2026-06-05");
    assert.ok(missedDay, "missed day present in analysis");
    assert.equal(missedDay?.trainingType, "rest", "planned-but-skipped day collapses to rest");
    assert.notEqual(missedDay?.nutritionStatus, "low_for_load", "skipped day must not be faulted as low under load");
  }

  // 4. Coach decision (Igor): very-low-kcal days no longer hard-block (on a
  //    no-training week or otherwise). The signal is recorded but the week is
  //    analyzed normally with an honest "критически мало" note.
  {
    const ctx = buildContext({
      noTrainingWeek: true,
      manualMacroRows: macroRows().map((r) => ({ ...r, kcal: 1100, carbsG: 70 })),
    });
    const generated = await generateNutritionWeeklyAnalysis({ context: ctx });
    assert.equal(generated.safety_flags.blocked, false, "very-low kcal no longer hard-blocks (coach decision)");
    assert.notEqual(generated.status, "blocked_safety", "week is analyzed normally, not blocked");
  }

  console.log("PASS check-nutrition-no-training-week");
}

void run();
