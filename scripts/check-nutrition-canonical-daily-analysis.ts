import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";

function buildMockContext(): NutritionStudentContext {
  return {
    studentName: "Nadezhda",
    studentSlug: "nadezhda",
    studentUuid: "student-nadya",
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
      { day: "2026-06-01", weekday: "пн", kcal: 1900, proteinG: 105, fatG: 58, carbsG: 200, confidence: 1, notes: null },
      { day: "2026-06-02", weekday: "вт", kcal: 1800, proteinG: 102, fatG: 55, carbsG: 185, confidence: 1, notes: null },
      { day: "2026-06-03", weekday: "ср", kcal: 2050, proteinG: 110, fatG: 60, carbsG: 215, confidence: 1, notes: null },
      { day: "2026-06-04", weekday: "чт", kcal: 1750, proteinG: 100, fatG: 53, carbsG: 170, confidence: 1, notes: null },
      { day: "2026-06-05", weekday: "пт", kcal: 1700, proteinG: 100, fatG: 52, carbsG: 165, confidence: 1, notes: null },
      { day: "2026-06-06", weekday: "сб", kcal: 1680, proteinG: 98, fatG: 51, carbsG: 160, confidence: 1, notes: null },
      { day: "2026-06-07", weekday: "вс", kcal: 1573, proteinG: 108, fatG: 47, carbsG: 179, confidence: 1, notes: null },
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
      runningSessions: 5,
      longRun: { date: "2026-06-07", title: "Длительная 16.6 км", durationHours: 1.7, distanceKm: 16.6 },
      keyWorkouts: [
        { date: "2026-06-03", title: "Интервалы 7×5 мин", type: "run", confidence: "high" },
        { date: "2026-06-07", title: "Длительная 16.6 км", type: "run", confidence: "high" },
      ],
      workouts: [
        {
          date: "2026-06-03",
          title: "Интервалы 7×5 мин",
          status: "completed",
          type: "run",
          description: "Ключевая интервальная работа",
          coachComments: null,
          plannedText: null,
        },
        {
          date: "2026-06-07",
          title: "Длительная 16.6 км",
          status: "completed",
          type: "run",
          description: "Лёгкая длительная",
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
      totalSessions: 3,
      plannedSessions: 3,
      completedSessions: 0,
      runningSessions: 3,
      longRun: { date: "2026-06-14", title: "Длительная", durationHours: 1.8, distanceKm: 18 },
      keyWorkouts: [{ date: "2026-06-10", title: "Tempo", type: "run", confidence: "high" }],
      workouts: [],
    },
  };
}

function assertCanonicalShape(day: Record<string, unknown>): void {
  const canonical = day.canonicalDailyAnalysis as Record<string, unknown>;
  assert.ok(canonical && typeof canonical === "object", "canonicalDailyAnalysis must exist");
  assert.equal(typeof canonical.date, "string");
  assert.equal(typeof canonical.weekdayRu, "string");
  assert.equal(typeof canonical.dateLabel, "string");
  assert.equal(typeof canonical.trainingType, "string");
  assert.equal(typeof canonical.trainingLabel, "string");
  assert.ok(canonical.actual && typeof canonical.actual === "object");
  assert.ok(canonical.flags && typeof canonical.flags === "object");
  assert.ok(canonical.energyAvailability && typeof canonical.energyAvailability === "object");
  assert.ok(canonical.energyFloor && typeof canonical.energyFloor === "object");
  assert.ok(canonical.macroGuardrails && typeof canonical.macroGuardrails === "object");
  assert.equal(typeof canonical.nutritionStatus, "string");
  assert.equal(typeof canonical.relevance, "string");
  assert.equal(typeof canonical.hintForComment, "string");
  assert.ok(Array.isArray(canonical.findings));
  assert.ok(canonical.sourceQuality && typeof canonical.sourceQuality === "object");
}

async function run(): Promise<void> {
  const root = process.cwd();
  const methodologySource = readFileSync(join(root, "src/features/nutrition/methodology.ts"), "utf8");
  assert.doesNotMatch(methodologySource, /from\s+["']openai["']/i, "canonical daily facts must not depend on OpenAI");
  assert.doesNotMatch(methodologySource, /sendTelegram|telegramSend|bot\.sendMessage/, "canonical daily facts must not send Telegram");
  assert.doesNotMatch(methodologySource, /moveWorkout|executeMove|tpActionExecute|mutateTrainingPeaks/i, "canonical facts must not mutate TP");

  const context = buildMockContext();
  const methodology = buildNutritionMethodologyContext({ context });
  assert.ok(methodology.dailyAnalysis.length >= 7);
  methodology.dailyAnalysis.forEach((day) => assertCanonicalShape(day as unknown as Record<string, unknown>));

  const hardDay = methodology.dailyAnalysis.find((day) => day.date === "2026-06-03");
  const preLongDay = methodology.dailyAnalysis.find((day) => day.date === "2026-06-06");
  const longRunDay = methodology.dailyAnalysis.find((day) => day.date === "2026-06-07");

  assert.ok(hardDay, "hard day fixture missing");
  assert.ok(preLongDay, "pre-long day fixture missing");
  assert.ok(longRunDay, "long-run day fixture missing");

  assert.equal(hardDay?.canonicalDailyAnalysis.trainingType, "hard");
  assert.ok(
    hardDay?.canonicalDailyAnalysis.nutritionStatus === "low_for_load" ||
      hardDay?.canonicalDailyAnalysis.findings.includes("low_carbs_for_hard_session"),
    "03.06 must be low_for_load or carry low carbs finding"
  );
  assert.equal(preLongDay?.canonicalDailyAnalysis.trainingType, "pre_long");
  assert.ok(
    preLongDay?.canonicalDailyAnalysis.nutritionStatus === "pre_long_low" ||
      preLongDay?.canonicalDailyAnalysis.nutritionStatus === "below_energy_availability" ||
      preLongDay?.canonicalDailyAnalysis.nutritionStatus === "below_energy_floor",
    "pre-long day must stay flagged, with EA/floor allowed to outrank carb-specific status"
  );
  assert.ok(
    preLongDay?.canonicalDailyAnalysis.findings.includes("low_carbs_before_long_run") ||
      preLongDay?.canonicalDailyAnalysis.findings.includes("ea_red_screen") ||
      preLongDay?.canonicalDailyAnalysis.findings.includes("below_load_energy_floor"),
    "pre-long day must retain actionable finding"
  );
  assert.equal(longRunDay?.canonicalDailyAnalysis.trainingType, "long_run");
  assert.ok(
    longRunDay?.canonicalDailyAnalysis.nutritionStatus === "long_run_low" ||
      longRunDay?.canonicalDailyAnalysis.nutritionStatus === "below_energy_availability" ||
      longRunDay?.canonicalDailyAnalysis.nutritionStatus === "below_energy_floor",
    "long-run day must stay flagged, with EA/floor allowed to outrank long-run status"
  );
  assert.ok(
    longRunDay?.canonicalDailyAnalysis.findings.includes("low_energy_long_run_day"),
    "07.06 must include long-run energy finding"
  );

  assert.equal(typeof hardDay?.canonicalDailyAnalysis.actual.carbsGPerKg, "number");
  assert.equal(typeof longRunDay?.canonicalDailyAnalysis.actual.proteinGPerKg, "number");
  assert.equal(typeof longRunDay?.canonicalDailyAnalysis.energyAvailability.eaZone, "string");
  assert.equal(typeof longRunDay?.canonicalDailyAnalysis.macroGuardrails.protein.status, "string");
  assert.equal(typeof longRunDay?.canonicalDailyAnalysis.macroGuardrails.fat.status, "string");
  assert.equal(typeof longRunDay?.canonicalDailyAnalysis.macroGuardrails.carbs.status, "string");
  assert.ok(longRunDay?.canonicalDailyAnalysis.findings.includes("estimated_ffm_used"));

  console.log("PASS check-nutrition-canonical-daily-analysis");
}

void run();
