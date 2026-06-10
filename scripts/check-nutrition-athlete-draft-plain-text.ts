import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFallback,
} from "@/features/nutrition/weekly-plan-generator";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import { buildDerivedNutritionCombinedMessage } from "@/features/nutrition/combined-message";

function buildReviewContext(overrides?: Partial<NutritionStudentContext>): NutritionStudentContext {
  return {
    studentName: "Анна",
    studentSlug: "anna",
    studentUuid: "student-anna",
    resolvedCommunicationProfile: {
      formality: "ty",
      formalitySource: "manual",
      tone: "neutral",
      preferredGreeting: "Анна, привет!",
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
      { day: "2026-06-01", weekday: "пн", kcal: 1950, proteinG: 102, fatG: 58, carbsG: 240, confidence: 1, notes: null },
      { day: "2026-06-02", weekday: "вт", kcal: 2200, proteinG: 106, fatG: 62, carbsG: 300, confidence: 1, notes: null },
      { day: "2026-06-03", weekday: "ср", kcal: 2400, proteinG: 110, fatG: 65, carbsG: 340, confidence: 1, notes: null },
      { day: "2026-06-04", weekday: "чт", kcal: 2200, proteinG: 104, fatG: 63, carbsG: 315, confidence: 1, notes: null },
      { day: "2026-06-05", weekday: "пт", kcal: 2500, proteinG: 111, fatG: 65, carbsG: 390, confidence: 1, notes: null },
    ],
    dataQuality: {
      parsedDays: 5,
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
      longRun: { date: "2026-06-05", title: "Длительная", durationHours: 1.8, distanceKm: 18 },
      keyWorkouts: [{ date: "2026-06-03", title: "Интервалы", type: "run", confidence: "high" }],
      workouts: [
        { date: "2026-06-03", title: "Интервалы", status: "completed", type: "intervals", description: null, coachComments: null, plannedText: null },
        { date: "2026-06-05", title: "Длительная", status: "completed", type: "long_run", description: null, coachComments: null, plannedText: null },
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
      longRun: { date: "2026-06-14", title: "Длительная", durationHours: 1.9, distanceKm: 20 },
      keyWorkouts: [{ date: "2026-06-10", title: "Темпо", type: "tempo", confidence: "high" }],
      workouts: [
        { date: "2026-06-10", title: "Темпо", type: "tempo" },
        { date: "2026-06-14", title: "Длительная", type: "long_run" },
      ],
    },
    ...overrides,
  };
}

function assertAthleteDraftPlainText(draft: string, label: string): void {
  assert.ok(draft.trim().length > 0, `${label}: draft must be non-empty`);
  assert.doesNotMatch(draft, /\*\*|---|```/, `${label}: no markdown separators`);
  assert.doesNotMatch(draft, /если будут вопросы[, ]+пишит/i, `${label}: avoid weak closing phrase`);
  assert.doesNotMatch(
    draft.toLowerCase(),
    /red-s|reds|lea|энергодоступность|дефицит энергии|опасная зона|медицинский риск|анемия|расстройств/,
    `${label}: no diagnostic terms`
  );
  assert.doesNotMatch(
    draft.toLowerCase(),
    /похуд|сбросить вес|урезать калори|меньше есть|дефицит калорий/,
    `${label}: no restrictive language`
  );
  assert.doesNotMatch(
    draft.toLowerCase(),
    /\bты\b[\s\S]*\bвы\b|\bвы\b[\s\S]*\bты\b/,
    `${label}: no mixed formality`
  );
  assert.doesNotMatch(
    draft.toLowerCase(),
    /\b(before|after|during|meal plan|deficit|weight loss)\b/,
    `${label}: avoid broad English phrases in athlete draft`
  );
  assert.doesNotMatch(
    draft.toLowerCase(),
    /(до|во время|после)\s+тренировк[\s\S]{0,30}\d+\s*г/,
    `${label}: day-by-day section must avoid intra-day grams timing`
  );
}

async function run(): Promise<void> {
  const reviewGenerated = await generateNutritionWeeklyAnalysis({ context: buildReviewContext() });
  const reviewDraft = reviewGenerated.athlete_message_draft ?? "";
  assertAthleteDraftPlainText(reviewDraft, "weekly review draft");

  const sourceAnalysis = {
    id: "analysis-plain-text",
    studentId: "student-anna",
    reportId: "report-plain-text",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {
      cacheStatus: "ok",
      workouts: [
        { date: "2026-06-09", title: "Лёгкий бег", type: "easy_run" },
        { date: "2026-06-10", title: "Темпо", type: "tempo" },
        { date: "2026-06-14", title: "Длительная", type: "long_run" },
      ],
      keyWorkouts: [{ date: "2026-06-10", title: "Темпо", type: "tempo", confidence: "high" }],
      longRun: { date: "2026-06-14", title: "Длительная" },
    },
    nutritionSummary: {
      one_focus: {
        category: "carbs_around_key_sessions",
        statement_ru: "Поддержать углеводы вокруг ключевых тренировок",
      },
      methodology_signals: { protein_sufficient: true },
      data_quality_summary: { parsed_days: 7, low_confidence_days: 0, quality_flags: [] },
      do_not_send_reasons: [],
      carb_progression_strategy: "small_step",
    },
    safetyFlags: { hard_flags: [], soft_flags: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "nutrition-weekly-review-fallback-v2",
    athleteMessageDraft: reviewDraft,
    coachEdits: null,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
  } satisfies NutritionWeeklyAnalysis;
  const planFacts = buildNutritionWeeklyPlanFactsFromSources({
    studentId: "student-anna",
    studentName: "Анна",
    formality: "ty",
    weightKg: 56,
    sourceAnalysis,
  });
  const planGenerated = generateNutritionWeeklyPlanFallback(planFacts);
  const planDraft = planGenerated.athleteMessageDraft ?? "";
  assertAthleteDraftPlainText(planDraft, "weekly plan draft");
  assert.match(planDraft, /~2000 ккал/, "weekly plan draft should display-round deterministic rest target");
  assert.doesNotMatch(planDraft, /~1950 ккал/, "weekly plan draft should not expose raw 1950 target");

  const combined = buildDerivedNutritionCombinedMessage({
    review: sourceAnalysis,
    plan: {
      id: "plan-plain-text",
      studentId: "student-anna",
      sourceReportId: sourceAnalysis.reportId,
      sourceAnalysisId: sourceAnalysis.id,
      planWeekFrom: "2026-06-08",
      planWeekTo: "2026-06-14",
      status: "draft_generated",
      generationMode: "fallback",
      promptVersion: "nutrition-weekly-plan-v1-ai",
      aiModel: "nutrition-weekly-plan-fallback-v2",
      coachSummary: planGenerated.coachSummary,
      athleteMessageDraft: planGenerated.athleteMessageDraft,
      coachEditedDraft: null,
      approvedAt: null,
      planSummary: planGenerated.planSummary,
      trainingContextSnapshot: planGenerated.trainingContextSnapshot,
      nutritionContextSnapshot: planGenerated.nutritionContextSnapshot,
      safetyFlags: planGenerated.safetyFlags,
      supersededByPlanId: null,
      createdAt: "2026-06-09T10:05:00.000Z",
      updatedAt: "2026-06-09T10:05:00.000Z",
    },
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(combined.status, "ready");
  assert.ok(combined.athleteMessageDraft, "combined draft should exist in ready status");
  assert.equal(combined.renderResult.ok, true, "combined draft must come from ok renderer result");
  assert.equal(combined.renderResult.text, combined.athleteMessageDraft, "combined copy must equal renderer text");
  const combinedDraft = combined.athleteMessageDraft ?? "";
  assertAthleteDraftPlainText(combinedDraft, "combined draft");
  assert.doesNotMatch(combinedDraft, /—|–|TrainingPeaks|FatSecret/, "combined draft must be Telegram-clean");
  assert.doesNotMatch(
    combinedDraft,
    /Комментарий:|можно дать|указать факт|hint|source_quality|Собрала|\d+\.\d+\s*г|Данные по питанию за день неполные|вывод короткий|день без тренировки в план тренировок|день без тренировки в TrainingPeaks/,
    "combined draft must not leak internal hints or raw decimal macros"
  );
  assert.match(combinedDraft, /На следующем разборе посмотрим, как это отразится на энергии и восстановлении\./);

  console.log("PASS check-nutrition-athlete-draft-plain-text");
}

void run();
