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
];
for (const rule of requiredPromptRules) {
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

console.log("PASS check-nutrition-weekly-plan-safety");
