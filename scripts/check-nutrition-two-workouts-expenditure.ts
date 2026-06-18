import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";
import {
  buildNutritionNextWeekPlan,
  estimatePlanDayExerciseKcal,
} from "@/features/nutrition/weekly-plan-formulas";
import { sumDaySessionsExpenditureKcal } from "@/features/nutrition/activity-energy";

const BW = 60;
type Session = { title: string; type: string; durationHours: number | null; distanceKm?: number | null };

// ── 1. Shared helper: sum, skip null/zero, no double-count ────────────────────
{
  assert.equal(sumDaySessionsExpenditureKcal([10, 20, 30], (n) => n), 60, "сумма всех сессий");
  assert.equal(sumDaySessionsExpenditureKcal([10, null, 30], (n) => n), 40, "null-сессия пропущена");
  assert.equal(sumDaySessionsExpenditureKcal([10, 0, -5], (n) => n), 10, "ноль/отрицательное не вычитают");
  assert.equal(sumDaySessionsExpenditureKcal([], (n: number) => n), 0, "пустой день = 0");
}

// ── 2. REVIEW path e2e: четверг бег+силовая считает ОБЕ сессии ────────────────
function reviewContext(daySessions: Session[]): NutritionStudentContext {
  return {
    studentName: "Nadya",
    studentSlug: "nadya",
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
    currentWeightKg: BW,
    nutritionGoal: null,
    coachContextRu: null,
    athleteReportSignals: [],
    manualMacroRows: [
      { day: "2026-06-04", weekday: "чт", kcal: 2200, proteinG: 100, fatG: 60, carbsG: 270, confidence: 1, notes: null },
      { day: "2026-06-05", weekday: "пт", kcal: 2100, proteinG: 100, fatG: 65, carbsG: 270, confidence: 1, notes: null },
      { day: "2026-06-06", weekday: "сб", kcal: 2100, proteinG: 100, fatG: 65, carbsG: 270, confidence: 1, notes: null },
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
      periodFrom: "2026-06-04",
      periodTo: "2026-06-10",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: daySessions.length,
      plannedSessions: daySessions.length,
      completedSessions: daySessions.length,
      runningSessions: 0,
      longRun: null,
      keyWorkouts: [],
      workouts: daySessions.map((s) => ({
        date: "2026-06-04",
        title: s.title,
        status: "completed" as const,
        type: s.type,
        description: null,
        coachComments: null,
        plannedText: null,
        durationHours: s.durationHours,
        distanceKm: s.distanceKm ?? null,
      })),
    },
    tpNextWeek: {
      periodFrom: "2026-06-11",
      periodTo: "2026-06-17",
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

function reviewExerciseKcal(daySessions: Session[]): { kcal: number | null; type: string | undefined } {
  const m = buildNutritionMethodologyContext({ context: reviewContext(daySessions) });
  const thu = m.dailyAnalysis.find((d) => d.canonicalDailyAnalysis.date === "2026-06-04")?.canonicalDailyAnalysis;
  return { kcal: thu?.energyAvailability.exerciseEnergyKcal ?? null, type: thu?.trainingType };
}

const run: Session = { title: "Бег по пульсу", type: "run", durationHours: 1.0 };
const strength: Session = { title: "Силовая", type: "strength", durationHours: 0.75 };

const runOnly = reviewExerciseKcal([run]); //          1.0×60×8           = 480
const strengthOnly = reviewExerciseKcal([strength]); // 0.75×60×5         = 225
const both = reviewExerciseKcal([run, strength]); //    480 + 225         = 705

assert.equal(runOnly.kcal, 480, `run-only расход ${runOnly.kcal}, ожидалось 480`);
assert.equal(strengthOnly.kcal, 225, `strength-only расход ${strengthOnly.kcal}, ожидалось 225`);
assert.equal(both.kcal, 705, `бег+силовая расход ${both.kcal}, ожидалось 705 (480+225)`);
assert.equal(both.kcal, (runOnly.kcal ?? 0) + (strengthOnly.kcal ?? 0), "ровно сумма, без double-count");
assert.equal(both.type, "easy", `тип дня бег+силовая = ${both.type}, ожидалось easy (не strength)`);

// Demonstrate the fixed under-count: the OLD code used the primary(strength)
// duration with the day's easy coefficient and dropped the run → 0.75×60×8 = 360.
const legacyPrimaryOnly = Math.round(0.75 * BW * 8);
console.log(`Четверг Нади (бег 1.0ч + силовая 0.75ч, 60 кг):`);
console.log(`  ДО (primary-only, баг):  ${legacyPrimaryOnly} ккал  (силовая-длительность под беговой коэф, бег потерян)`);
console.log(`  ПОСЛЕ (сумма сессий):    ${both.kcal} ккал  (бег ${runOnly.kcal} + силовая ${strengthOnly.kcal})`);
assert.ok((both.kcal ?? 0) > legacyPrimaryOnly, "после фикса расход должен вырасти");

// ── 3. PLAN path: lose-target на дне бег+силовая выше, чем на дне только бег ───
function losePlanThuKcal(workouts: Array<{ title: string; type: string; durationHours: number }>): number | null {
  const plan = buildNutritionNextWeekPlan({
    bodyweightKg: BW,
    sex: "female",
    heightCm: 168,
    ageYears: 40,
    goalType: "lose",
    planWeekFrom: "2026-06-11",
    planWeekTo: "2026-06-17",
    trainingContext: {
      cacheStatus: "ok",
      workouts: workouts.map((w) => ({ date: "2026-06-11", ...w })),
    },
  });
  return plan.days.find((d) => d.date === "2026-06-11")?.target_kcal ?? null;
}

const planRunOnly = losePlanThuKcal([{ title: "Бег по пульсу", type: "run", durationHours: 1.0 }]);
const planBoth = losePlanThuKcal([
  { title: "Бег по пульсу", type: "run", durationHours: 1.0 },
  { title: "Силовая", type: "strength", durationHours: 0.75 },
]);
console.log(`\nПлан (lose, 60 кг) target_kcal на 11.06:`);
console.log(`  только бег:    ${planRunOnly}`);
console.log(`  бег+силовая:   ${planBoth}  (выше — вторая сессия учтена в maintenance)`);
assert.ok(planRunOnly != null && planBoth != null, "план посчитан");
assert.ok((planBoth ?? 0) > (planRunOnly ?? 0), "бег+силовая → выше maintenance → выше lose-target");

// Direct per-session estimator sanity (plan side mirrors review intensities).
const planRunKcal = estimatePlanDayExerciseKcal({ dayType: "easy", bodyweightKg: BW, durationHours: 1.0, distanceKm: null, workoutTitle: "Бег по пульсу" });
const planStrengthKcal = estimatePlanDayExerciseKcal({ dayType: "strength", bodyweightKg: BW, durationHours: 0.75, distanceKm: null, workoutTitle: "Силовая" });
assert.ok(planRunKcal > 0 && planStrengthKcal > 0, "обе плановые сессии ненулевые");

console.log("\ncheck-nutrition-two-workouts-expenditure: OK");
