import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { buildNutritionSafetyFlags } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import {
  buildNutritionMethodologyContext,
  detectWorkoutFuelingInstructions,
  selectNutritionWeeklyFocus,
} from "@/features/nutrition/methodology";

function buildMockContext(overrides?: Partial<NutritionStudentContext>): NutritionStudentContext {
  return {
    studentName: "Nadezhda",
    studentSlug: "nadezhda",
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
    manualMacroRows: [
      {
        day: "2026-06-01",
        weekday: "пн",
        kcal: 1900,
        proteinG: 110,
        fatG: 60,
        carbsG: 210,
        confidence: 1,
        notes: null,
      },
      {
        day: "2026-06-02",
        weekday: "вт",
        kcal: 1800,
        proteinG: 100,
        fatG: 55,
        carbsG: 170,
        confidence: 1,
        notes: null,
      },
      {
        day: "2026-06-03",
        weekday: "ср",
        kcal: 2300,
        proteinG: 115,
        fatG: 65,
        carbsG: 260,
        confidence: 1,
        notes: null,
      },
      {
        day: "2026-06-04",
        weekday: "чт",
        kcal: 1700,
        proteinG: 100,
        fatG: 50,
        carbsG: 160,
        confidence: 1,
        notes: null,
      },
      {
        day: "2026-06-05",
        weekday: "пт",
        kcal: 1450,
        proteinG: 100,
        fatG: 45,
        carbsG: 110,
        confidence: 1,
        notes: null,
      },
      {
        day: "2026-06-06",
        weekday: "сб",
        kcal: 1650,
        proteinG: 105,
        fatG: 50,
        carbsG: 140,
        confidence: 1,
        notes: null,
      },
      {
        day: "2026-06-07",
        weekday: "вс",
        kcal: 1500,
        proteinG: 110,
        fatG: 45,
        carbsG: 120,
        confidence: 1,
        notes: null,
      },
    ],
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
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: 5,
      plannedSessions: 5,
      completedSessions: 5,
      runningSessions: 4,
      longRun: {
        date: "2026-06-07",
        title: "Long run 100 min",
        durationHours: 1.67,
        distanceKm: 17,
      },
      keyWorkouts: [
        { date: "2026-06-04", title: "Intervals", type: "run", confidence: "high" },
        { date: "2026-06-07", title: "Long run", type: "run", confidence: "high" },
      ],
      workouts: [
        {
          date: "2026-06-04",
          title: "Intervals 8x400",
          status: "completed",
          type: "run",
          description: "8x400",
          coachComments: null,
          plannedText: null,
        },
        {
          date: "2026-06-07",
          title: "Long run 100 min",
          status: "completed",
          type: "run",
          description: "long easy run",
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
      totalSessions: 4,
      plannedSessions: 4,
      completedSessions: 0,
      runningSessions: 4,
      longRun: { date: "2026-06-14", title: "Long run", durationHours: 1.7, distanceKm: 18 },
      keyWorkouts: [{ date: "2026-06-10", title: "Tempo", type: "run", confidence: "high" }],
      workouts: [],
    },
    ...overrides,
  };
}

async function run(): Promise<void> {
  const withGel = detectWorkoutFuelingInstructions("Long run, 1 gel every 30 min + sports drink");
  assert.equal(withGel.hasFuelingInstruction, true);
  assert.equal(withGel.hasGelInstruction, true);
  assert.equal(withGel.normalizedType, "gels");

  const withoutGel = detectWorkoutFuelingInstructions("Long run easy no special notes");
  assert.equal(withoutGel.hasFuelingInstruction, false);

  const baseContext = buildMockContext();
  const methodology = buildNutritionMethodologyContext({ context: baseContext });
  assert.equal(methodology.proteinSufficient, true, "protein should be sufficient >1.6 g/kg avg");

  const focus = selectNutritionWeeklyFocus({ methodology, blockedSafety: false });
  assert.notEqual(focus.category, "protein_support", "protein cannot be one focus when sufficient");
  assert.equal(focus.category, "long_run_underfueling");
  assert.equal(methodology.dailyAnalysis.some((day) => day.trainingType === "long_run" && day.duringRunFuelPlanned === false), true);

  const lowCarbsContext = buildMockContext({
    manualMacroRows: buildMockContext().manualMacroRows.map((row) => ({ ...row, carbsG: 130, kcal: 1450 })),
  });
  const lowCarbsMethodology = buildNutritionMethodologyContext({ context: lowCarbsContext });
  assert.equal(lowCarbsMethodology.carbProgressionStrategy, "small_step");

  const missingTpContext = buildMockContext({
    tpPastWeek: {
      ...buildMockContext().tpPastWeek,
      cacheStatus: "empty",
      workouts: [],
      keyWorkouts: [],
      longRun: null,
    },
  });
  const missingTpMethodology = buildNutritionMethodologyContext({ context: missingTpContext });
  const missingTpFocus = selectNutritionWeeklyFocus({ methodology: missingTpMethodology, blockedSafety: false });
  assert.equal(missingTpFocus.category, "limited_data");

  const restOnlyContext = buildMockContext({
    manualMacroRows: [
      ...buildMockContext().manualMacroRows.map((row) => ({ ...row, carbsG: 220, kcal: 2100 })),
      {
        day: "2026-06-08",
        weekday: "пн",
        kcal: 1200,
        proteinG: 90,
        fatG: 45,
        carbsG: 95,
        confidence: 1,
        notes: null,
      },
    ],
    tpPastWeek: {
      ...buildMockContext().tpPastWeek,
      workouts: [],
      keyWorkouts: [],
      longRun: null,
    },
  });
  const restMethodology = buildNutritionMethodologyContext({ context: restOnlyContext });
  const restDay = restMethodology.dailyAnalysis.find((day) => day.date === "2026-06-08");
  assert.ok(restDay);
  assert.notEqual(restDay?.relevance, "high", "isolated rest-day low intake should not be high relevance");

  const safetyRows = buildMockContext().manualMacroRows.map((row) => ({ ...row, kcal: 1100, carbsG: 70 }));
  const safetyContext = buildMockContext({
    manualMacroRows: safetyRows,
    telegramContextNotes: "есть риск рпп, нужна аккуратность",
  });
  const safety = buildNutritionSafetyFlags({
    studentName: safetyContext.studentName,
    studentNotes: [safetyContext.telegramContextNotes ?? ""],
    nutritionContextItems: [],
    rows: safetyContext.manualMacroRows,
    weightLogs: [],
  });
  assert.equal(safety.blocked, true);
  const generatedSafety = await generateNutritionWeeklyAnalysis({ context: safetyContext });
  assert.equal(generatedSafety.status, "blocked_safety");
  assert.equal(generatedSafety.athlete_message_draft, null);

  const generatedTy = await generateNutritionWeeklyAnalysis({ context: baseContext });
  const draftTy = generatedTy.athlete_message_draft ?? "";
  assert.ok(draftTy.length > 0);
  assert.doesNotMatch(draftTy, /[A-Za-z]{3,}/, "draft should avoid English text");
  assert.doesNotMatch(draftTy.toLowerCase(), /\bвы\b/, "ty draft should not mix vy");
  assert.doesNotMatch(draftTy.toLowerCase(), /похуд|сниже|дефицит|уреза/, "draft should avoid weight-loss language");

  const vyContext = buildMockContext({
    resolvedCommunicationProfile: {
      ...buildMockContext().resolvedCommunicationProfile,
      formality: "vy",
    },
  });
  const generatedVy = await generateNutritionWeeklyAnalysis({ context: vyContext });
  const draftVy = generatedVy.athlete_message_draft ?? "";
  assert.doesNotMatch(draftVy.toLowerCase(), /\bты\b/, "vy draft should not mix ty");

  console.log("PASS check-nutrition-methodology");
}

void run();
