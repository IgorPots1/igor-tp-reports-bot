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
  "no **, no ---, no code fences",
];
for (const rule of requiredPromptRules) {
  if (rule.includes("**")) {
    assert.match(generatorSource, /\*\*.*---.*code fences/i, `AI prompt must include: ${rule}`);
    continue;
  }
  assert.match(generatorSource, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `AI prompt must include: ${rule}`);
}
// The athlete-draft diagnostic-term ban: assert each critical term is present on
// one banned-terms line, tolerant to extra terms (the line is a superset:
// RED-S/REDs/LEA/энергодоступность/дефицит энергии/медицинский риск/диагноз/анемия/
// расстройство). Order-independent so voice-alignment edits that ADD terms don't
// break the guard.
for (const term of ["RED-S", "REDs", "LEA", "дефицит энергии", "анемия", "расстройств"]) {
  assert.match(generatorSource, new RegExp(term, "i"), `AI prompt must ban diagnostic term in athlete draft: ${term}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Week without training (athlete is ill) + HEALTHY scan. The plan must be a real
// maintenance plan, and the coach-facing gate must not lie about the cache.
function buildEmptyWeekFacts(scanState: "ok" | "failed") {
  return buildNutritionWeeklyPlanFactsFromSources({
    studentId: "student-uuid-3",
    studentName: "Тест",
    formality: "ty",
    weightKg: 56,
    planWeekOverride: { from: "2026-07-13", to: "2026-07-20", mode: "next_week" },
    nextWeekScanState: scanState,
    nextWeekScanError: scanState === "failed" ? "403 from TrainingPeaks" : null,
    coachReportNoteRu: "Заболела, тренировок на неделе не будет.",
    sourceAnalysis: {
      id: "analysis-sick",
      studentId: "student-uuid-3",
      reportId: "report-sick",
      weekFrom: "2026-07-06",
      weekTo: "2026-07-12",
      status: "needs_review",
      internalSummary: {},
      tpPastWeekContext: {},
      // The plan week is empty in TP: she is ill and nothing is scheduled.
      tpNextWeekContext: { cacheStatus: "empty", workouts: [], keyWorkouts: [], longRun: null },
      nutritionSummary: {
        data_quality_summary: { parsed_days: 7 },
        do_not_send_reasons: [],
      },
      safetyFlags: { hard_flags: [], soft_flags: [], blocked: false },
      contextSnapshot: {},
      promptHash: null,
      contextHash: null,
      aiModel: null,
      athleteMessageDraft: null,
      coachEdits: null,
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:00.000Z",
    } satisfies NutritionWeeklyAnalysis,
  });
}

const sickFacts = buildEmptyWeekFacts("ok");
const sickPlan = generateNutritionWeeklyPlanFallback(sickFacts);
const sickReasons = sickPlan.planSummary.do_not_send_reasons as string[];

// The lie: telling the coach of a sick athlete that the week may just be unwritten and
// "кэш обновляется каждые 3 часа". The scan is healthy; the week is empty because she
// is ill. No cache story may appear.
for (const lie of [/кэш/i, /расписана ли неделя/i, /запусти скан/i, /не подтянулись/i]) {
  assert.ok(
    !sickReasons.some((reason) => lie.test(reason)),
    `no-training week with a healthy scan must not blame the cache: ${lie}`
  );
}
assert.deepEqual(sickReasons, [], "a maintenance plan has nothing that blocks sending");

// Numbers exist (this is the whole point: target_kcal was null on every day).
assert.ok(
  sickFacts.nextWeekPlan.days.every((day) => day.target_kcal !== null),
  "no-training week: every day must carry a real target"
);
assert.equal(sickFacts.nextWeekPlan.summary.no_training_week_maintenance, true);

// Framing: no talk of load days on a week that has none.
const loadTalk = /дни нагрузки|дней нагрузки|под нагрузку|ключевой тренировк|ключевые работ/i;
const planFocus = sickPlan.planSummary.plan_focus;
assert.ok(!loadTalk.test(planFocus.title), "plan focus title must not invent load days");
assert.ok(!loadTalk.test(planFocus.explanation), "plan focus explanation must not invent load days");
for (const action of sickPlan.planSummary.simple_actions) {
  assert.ok(!loadTalk.test(action), `simple action must not invent load days: ${action}`);
}
assert.ok(!loadTalk.test(sickPlan.athleteMessageDraft ?? ""), "athlete draft must not invent load days");
assert.match(sickPlan.coachSummary, /поддерживающ/i, "coach summary must frame the week as maintenance");
assert.equal(sickPlan.planSummary.key_training_days.length, 0);
// Still surfaced to the coach: only he knows if this is a recovery week or one he has
// simply not written yet.
assert.equal(sickPlan.status, "needs_review");

// The other branch is untouched: a FAILED scan is still an honest data gap, and it must
// keep saying so (and must not be dressed up as a recovery week).
const brokenFacts = buildEmptyWeekFacts("failed");
const brokenPlan = generateNutritionWeeklyPlanFallback(brokenFacts);
const brokenReasons = brokenPlan.planSummary.do_not_send_reasons as string[];
assert.ok(
  brokenReasons.some((reason) => /сбой доступа|403/i.test(reason)),
  "a failed scan must still be reported as a TP access failure"
);
assert.ok(
  brokenFacts.nextWeekPlan.days.every((day) => day.target_kcal === null),
  "a failed scan must not produce invented targets"
);
assert.equal(brokenPlan.status, "needs_review");
assert.equal(brokenFacts.nextWeekPlan.summary.no_training_week_maintenance, false);

// The coach note must reach the plan facts (the model reads it for tone).
assert.match(sickFacts.sourceReview.coachReportNoteRu ?? "", /Заболела/);

console.log("PASS check-nutrition-weekly-plan-safety");
