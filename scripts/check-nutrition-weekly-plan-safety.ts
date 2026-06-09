import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFallback,
} from "@/features/nutrition/weekly-plan-generator";

const root = process.cwd();
const filesToScan = [
  join(root, "src/features/nutrition/weekly-plan-generator.ts"),
  join(root, "src/app/admin/coach-os/nutrition/actions.ts"),
];

const telegramForbiddenPatterns = [
  /sendTrainingPeaksWeeklyReportToStudent/,
  /sendTrainingPeaksReplyDraftToStudent/,
  /sendTrainingPeaksAdminStudentTelegramTestMessage/,
  /telegram\.send/i,
  /bot\.send/i,
  /sendTelegram/i,
  /sendMessageToStudent/i,
];

const tpMutationForbiddenPatterns = [
  /executeTrainingPeaks/i,
  /mutateTrainingPeaks/i,
  /writeTrainingPeaks/i,
  /createTrainingPeaksWorkout/i,
  /updateTrainingPeaksWorkout/i,
  /deleteTrainingPeaksWorkout/i,
  /moveTrainingPeaksWorkout/i,
  /applyTrainingPeaks/i,
  /from\("trainingpeaks_workouts"\)\.(insert|update|upsert|delete)/i,
];

for (const file of filesToScan) {
  const body = readFileSync(file, "utf8");
  for (const forbidden of telegramForbiddenPatterns) {
    assert.doesNotMatch(body, forbidden, `${file} must not introduce Telegram autosend paths`);
  }
  for (const forbidden of tpMutationForbiddenPatterns) {
    assert.doesNotMatch(body, forbidden, `${file} must not introduce TrainingPeaks mutation paths`);
  }
}

const generatorSource = readFileSync(filesToScan[0], "utf8");
const requiredPromptRules = [
  "No medical advice",
  "No diagnosis",
  "No menu",
  "No weight loss",
  "Do not invent gels",
  "Copy-only",
  "No RED-S/REDs/LEA/дефицит энергии/анемия/расстройство",
  "no **, no ---, no code fences",
];
for (const rule of requiredPromptRules) {
  if (rule.includes("**")) {
    assert.match(generatorSource, /\*\*.*---.*code fences/i, `AI prompt must include: ${rule}`);
    continue;
  }
  assert.match(generatorSource, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `AI prompt must include: ${rule}`);
}

const blockedFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Test",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: {
    id: "analysis-blocked",
    studentId: "student-uuid-1",
    reportId: "report-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "blocked_safety",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: { cacheStatus: "empty", workouts: [] },
    nutritionSummary: {
      data_quality_summary: { parsed_days: 7 },
      do_not_send_reasons: ["manual_review_required:very_low_kcal_repeated"],
    },
    safetyFlags: { hard_flags: ["very_low_kcal_repeated"], soft_flags: [], blocked: true },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: null,
    coachEdits: null,
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
  } satisfies NutritionWeeklyAnalysis,
});
const blockedGenerated = generateNutritionWeeklyPlanFallback(blockedFacts);
assert.equal(blockedGenerated.athleteMessageDraft, null, "blocked source review must not create sendable athlete draft");
assert.equal(blockedGenerated.status, "blocked_safety");

const allowedFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-2",
  studentName: "Тест",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: {
    id: "analysis-open",
    studentId: "student-uuid-2",
    reportId: "report-open",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {
      cacheStatus: "ok",
      workouts: [{ date: "2026-06-10", title: "Интервалы", type: "intervals" }],
      keyWorkouts: [{ date: "2026-06-10", title: "Интервалы", type: "intervals", confidence: "high" }],
      longRun: null,
    },
    nutritionSummary: {
      data_quality_summary: { parsed_days: 7 },
      do_not_send_reasons: [],
      one_focus: { category: "carbs_around_key_sessions", statement_ru: "Поддержать углеводы вокруг ключевых работ" },
    },
    safetyFlags: { hard_flags: [], soft_flags: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: null,
    coachEdits: null,
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
  } satisfies NutritionWeeklyAnalysis,
});
const allowedGenerated = generateNutritionWeeklyPlanFallback(allowedFacts);
const athleteDraft = allowedGenerated.athleteMessageDraft ?? "";
assert.doesNotMatch(athleteDraft, /\*\*|---|```/, "athlete weekly-plan draft must remain plain text");
assert.doesNotMatch(
  athleteDraft.toLowerCase(),
  /red-s|reds|lea|дефицит энергии|анемия|расстройств/,
  "athlete weekly-plan draft must avoid diagnostic language"
);

console.log("PASS check-nutrition-weekly-plan-safety");
