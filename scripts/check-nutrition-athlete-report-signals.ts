import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  detectNutritionAthleteReportSignals,
  detectNutritionAthleteReportSignalsFromTexts,
  nutritionAthleteReportSignalsRequireCoachReview,
} from "@/features/nutrition/athlete-signals";
import type { NutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS } from "@/features/nutrition/narrative-guardrails";

const root = process.cwd();

function buildMockContext(overrides?: Partial<NutritionStudentContext>): NutritionStudentContext {
  return {
    studentName: "Анна",
    studentSlug: "anna",
    studentUuid: "student-anna",
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
      { day: "2026-06-01", weekday: "пн", kcal: 1850, proteinG: 108, fatG: 58, carbsG: 210, confidence: 1, notes: null },
      { day: "2026-06-02", weekday: "вт", kcal: 1820, proteinG: 102, fatG: 56, carbsG: 195, confidence: 1, notes: null },
      { day: "2026-06-03", weekday: "ср", kcal: 2250, proteinG: 112, fatG: 62, carbsG: 255, confidence: 1, notes: null },
      { day: "2026-06-04", weekday: "чт", kcal: 1730, proteinG: 101, fatG: 52, carbsG: 165, confidence: 1, notes: null },
      { day: "2026-06-05", weekday: "пт", kcal: 1470, proteinG: 104, fatG: 48, carbsG: 115, confidence: 1, notes: null },
      { day: "2026-06-06", weekday: "сб", kcal: 1600, proteinG: 103, fatG: 50, carbsG: 135, confidence: 1, notes: null },
      { day: "2026-06-07", weekday: "вс", kcal: 1520, proteinG: 109, fatG: 46, carbsG: 122, confidence: 1, notes: null },
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
      totalSessions: 6,
      plannedSessions: 6,
      completedSessions: 6,
      runningSessions: 5,
      longRun: { date: "2026-06-07", title: "Длительная 100 мин", durationHours: 1.67, distanceKm: 17 },
      keyWorkouts: [{ date: "2026-06-03", title: "Интервалы 7х5 мин", type: "run", confidence: "high" }],
      workouts: [
        {
          date: "2026-06-03",
          title: "Интервалы 7х5 мин",
          status: "completed",
          type: "run",
          description: null,
          coachComments: null,
          plannedText: null,
        },
      ],
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
  };
}

async function run(): Promise<void> {
  const fatigue = detectNutritionAthleteReportSignals("На неделе была сильная усталость после интервалов.");
  assert.ok(fatigue.some((signal) => signal.category === "fatigue"), "must detect fatigue");

  const gi = detectNutritionAthleteReportSignals("После длительной был дискомфорт в ЖКТ и тошнота.");
  assert.ok(gi.some((signal) => signal.category === "gi"), "must detect gi");

  const illness = detectNutritionAthleteReportSignals("Заболела в среду, была температура и кашель.");
  assert.ok(illness.some((signal) => signal.category === "illness"), "must detect illness");

  const cycle = detectNutritionAthleteReportSignals("На этой неделе был цикл, ПМС чувствовался сильнее.");
  assert.ok(cycle.some((signal) => signal.category === "cycle"), "must detect cycle");

  const injury = detectNutritionAthleteReportSignals("Потянула стопу, колено болит после пробежки.");
  assert.ok(injury.some((signal) => signal.category === "injury"), "must detect injury");

  const psych = detectNutritionAthleteReportSignals("Был сильный стресс, эмоционально тяжело на работе.");
  assert.ok(psych.some((signal) => signal.category === "psych"), "must detect psych");

  const falsePositive = detectNutritionAthleteReportSignals("Неделя прошла ровно, питание стабильное.");
  assert.equal(falsePositive.length, 0, "should avoid obvious false positives on neutral text");

  const evidenceSample = detectNutritionAthleteReportSignals(
    "Комментарий: на этой неделе была сильная усталость после интервалов и длительной."
  )[0];
  assert.ok(evidenceSample, "evidence sample must exist");
  assert.ok(evidenceSample.evidence.length <= 120, "evidence must be trimmed");
  assert.match(evidenceSample.evidence, /усталост/i, "evidence should include keyword neighborhood");

  const merged = detectNutritionAthleteReportSignalsFromTexts([
    "Заболела в среду",
    "На этой неделе была усталость",
  ]);
  assert.ok(merged.some((signal) => signal.category === "illness"));
  assert.ok(merged.some((signal) => signal.category === "fatigue"));
  assert.ok(nutritionAthleteReportSignalsRequireCoachReview(merged), "illness should require coach review");

  const illnessOnly = detectNutritionAthleteReportSignals("Заболел, горло болит");
  const generatedIllness = await generateNutritionWeeklyAnalysis({
    context: buildMockContext({ athleteReportSignals: illnessOnly }),
  });
  assert.equal(generatedIllness.status, "needs_review", "illness/cycle/injury must set needs_review");
  assert.ok(
    generatedIllness.internal_summary.notes.includes("athlete_report_signals_require_coach_review"),
    "coach-only reason must be recorded"
  );

  const athleteDraft = generatedIllness.athlete_message_draft ?? "";
  for (const term of NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS) {
    assert.doesNotMatch(athleteDraft.toLowerCase(), new RegExp(term.toLowerCase()), `athlete draft must avoid ${term}`);
  }

  const draftGenerator = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
  assert.match(draftGenerator, /athlete_report_signals/, "facts payload must include athlete_report_signals");

  const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
  assert.match(studentPage, /Сигналы из комментария ученика/, "UI must show athlete signal chips section");

  const noAutosend = readFileSync(join(root, "scripts/check-nutrition-no-autosend.ts"), "utf8");
  assert.doesNotMatch(noAutosend, /sendTelegram|sendMessage/i, "no-autosend check must stay telegram-send free");

  console.log("PASS check-nutrition-athlete-report-signals");
}

void run();
