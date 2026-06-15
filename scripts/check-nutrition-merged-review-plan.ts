import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFromReviewProse,
} from "@/features/nutrition/weekly-plan-generator";
import { buildDerivedNutritionCombinedMessage } from "@/features/nutrition/combined-message";

// Task 6: review + next-week plan are written in ONE Claude call. This check
// guards the merge contract:
//  - the review (draft-generator) call asks for and persists next_week_plan_text,
//    grounded in the deterministic next_week_plan numbers;
//  - the plan record is built from that prose + formula numbers, with NO OpenAI
//    call when prose is present, and stays held/blocked when the review was;
//  - the combined message renders the plan section in the Claude voice.

const root = process.cwd();
const draftGeneratorSource = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
const planGeneratorSource = readFileSync(join(root, "src/features/nutrition/weekly-plan-generator.ts"), "utf8");
const actionsSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

// --- 1. One Claude call returns review fields + next_week_plan_text -----------
assert.match(
  draftGeneratorSource,
  /Return strict JSON only with keys:[^\n]*next_week_plan_text/,
  "review prompt must request next_week_plan_text in the same JSON response"
);
assert.match(
  draftGeneratorSource,
  /next_week_plan:\s*input\.nextWeekPlan/,
  "review facts payload must include the deterministic next_week_plan numbers"
);
assert.match(
  draftGeneratorSource,
  /buildNutritionNextWeekPlan\(\{[\s\S]*trainingContext:\s*context\.tpNextWeek/,
  "plan numbers must be built from the review's next-week TP context"
);
assert.match(
  draftGeneratorSource,
  /next_week_plan_text:\s*narrative\.next_week_plan_text/,
  "review must persist next_week_plan_text in nutrition_summary"
);
// Plan prose obeys the same athlete-facing guardrails as the athlete draft.
assert.match(
  draftGeneratorSource,
  /next_week_plan_text подчиняется тем же запретам/,
  "plan prose must be held to the same safety guardrails as the athlete draft"
);

// --- 2. Plan record built from prose + formulas, no OpenAI --------------------
// The claudePlanProse branch must short-circuit before the OpenAI call.
const planFn = planGeneratorSource.slice(
  planGeneratorSource.indexOf("export async function generateNutritionWeeklyPlan(")
);
const proseBranchIdx = planFn.indexOf("generateNutritionWeeklyPlanFromReviewProse");
const openAiCallIdx = planFn.indexOf("generateNutritionWeeklyPlanWithAi(");
assert.ok(proseBranchIdx >= 0, "generateNutritionWeeklyPlan must support the claudePlanProse path");
assert.ok(openAiCallIdx >= 0, "generateNutritionWeeklyPlan must keep OpenAI as a fallback");
assert.ok(
  proseBranchIdx < openAiCallIdx,
  "claudePlanProse path must short-circuit before any OpenAI call"
);

function buildFixtureAnalysis(overrides?: Partial<NutritionWeeklyAnalysis>): NutritionWeeklyAnalysis {
  return {
    id: "analysis-merge-1",
    studentId: "student-uuid-1",
    reportId: "report-merge-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {
      periodFrom: "2026-06-08",
      periodTo: "2026-06-14",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      workouts: [
        { date: "2026-06-09", title: "Long run 18 km", type: "long_run", description: null, coachComments: null, plannedText: null },
        { date: "2026-06-11", title: "Intervals 6x6", type: "intervals", description: null, coachComments: null, plannedText: null },
      ],
      keyWorkouts: [{ date: "2026-06-09", title: "Long run 18 km", type: "long_run", confidence: "high" }],
    },
    nutritionSummary: {
      generation_mode: "ai",
      one_focus: { category: "carbs_around_key_sessions", statement_ru: "Углеводы вокруг ключевых работ" },
      methodology_signals: { protein_sufficient: true },
      data_quality_summary: { parsed_days: 7, low_confidence_days: 0, quality_flags: [] },
    },
    safetyFlags: { hard_flags: [], soft_flags: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "claude-sonnet-4-6",
    athleteMessageDraft: "Прошлая неделя",
    coachEdits: null,
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    ...overrides,
  };
}

const facts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis(),
  todayLocalDate: "2026-06-10",
});

const claudeProse = "На следующей неделе главный акцент — догрузиться углеводами перед длительной: около 300 г в день перед бегом.";
const fromProse = generateNutritionWeeklyPlanFromReviewProse({
  facts,
  claudePlanProse: claudeProse,
  claudePlanAiModel: "claude-sonnet-4-6",
});
assert.equal(fromProse.generationMode, "ai", "plan built from Claude prose must be marked AI");
assert.equal(fromProse.aiModel, "claude-sonnet-4-6", "plan must record the answering Claude model");
assert.equal(fromProse.athleteMessageDraft, claudeProse, "plan athlete draft must be the Claude plan prose");
assert.equal(
  (fromProse.planSummary.next_week_plan as { formula_version?: unknown }).formula_version,
  "nutrition_next_week_plan_v1",
  "plan numbers must still come from the deterministic formulas"
);

// Safety-blocked review must NOT leak a Claude plan draft.
const blockedFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildFixtureAnalysis({ safetyFlags: { hard_flags: ["illness_mention"], soft_flags: [], blocked: true } }),
  todayLocalDate: "2026-06-10",
});
const blockedPlan = generateNutritionWeeklyPlanFromReviewProse({
  facts: blockedFacts,
  claudePlanProse: claudeProse,
  claudePlanAiModel: "claude-sonnet-4-6",
});
assert.equal(blockedPlan.athleteMessageDraft, null, "safety-blocked plan must not expose an athlete draft");
assert.notEqual(blockedPlan.generationMode, "ai", "safety-blocked plan must not be marked AI-ready from prose");

// --- 3. One button: review action chains the plan from the same call ----------
assert.match(
  actionsSource,
  /claudePlanProse:\s*result\.generated\.next_week_plan_text/,
  "review action must build the plan from the same Claude call"
);
assert.match(actionsSource, /preferSavedTpContext:\s*true/, "merged plan must reuse the saved review TP context");
assert.match(
  actionsSource,
  /reviewStatus === "draft_generated" \|\| reviewStatus === "needs_review"/,
  "plan must be created only for a real review (not awaiting/blocked)"
);

// --- 4. Combined message renders the plan section in the Claude voice ---------
const review = buildFixtureAnalysis({
  nutritionSummary: {
    ...buildFixtureAnalysis().nutritionSummary,
    daily_analysis: [
      {
        date: "2026-06-01",
        weekday_ru: "Понедельник",
        date_label: "01.06",
        training_type: "rest",
        training_label: "день отдыха",
        actual: { kcal: 2000, proteinG: 100, fatG: 60, carbsG: 240, carbsGPerKg: 4.2 },
        nutrition_status: "rest_ok",
        findings: [],
        // Igor's voice uses "—" constantly; the render gate must normalize it
        // (not drop the day to the dry deterministic comment).
        athlete_prose: "День отдыха — питание ровное, белок закрыт хорошо, ничего срочного.",
      },
    ],
  },
}) as NutritionWeeklyAnalysis;

const planWithClaudeProse: NutritionWeeklyPlan = {
  id: "plan-merge-1",
  studentId: "student-uuid-1",
  sourceReportId: "report-merge-1",
  sourceAnalysisId: "analysis-merge-1",
  planWeekFrom: "2026-06-08",
  planWeekTo: "2026-06-14",
  status: "draft_generated",
  generationMode: "ai",
  promptVersion: "nutrition-weekly-plan-v1-ai",
  aiModel: "claude-sonnet-4-6",
  coachSummary: "coach",
  athleteMessageDraft: "ПЛАНОВЫЙ_АКЦЕНT_МАРКЕР: догрузись углеводами перед длительной.",
  coachEditedDraft: null,
  approvedAt: null,
  planSummary: {
    plan_focus: { title: "Детерминированный заголовок", explanation: "Детерминированное пояснение." },
    do_not_send_reasons: [],
    next_week_plan: {
      formula_version: "nutrition_next_week_plan_v1",
      days: [
        {
          date: "2026-06-09",
          weekday_ru: "Вторник",
          training_type: "long_run",
          training_label: "длительная",
          target_kcal: 2500,
          protein_g: 95,
          fat_g: 65,
          carbs_g: 390,
          flags: { has_training_context: true, key_workout: true },
          source: "tp_workout",
        },
      ],
      day_type_targets: { rest: { target_kcal: 1950, protein_g: 90, fat_g: 60, carbs_g: 250 } },
      summary: { has_training_context: true, long_run_source: "tp_workout", long_run_confidence: "high" },
    },
  },
  trainingContextSnapshot: { workoutCount: 2 },
  nutritionContextSnapshot: {},
  safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
  supersededByPlanId: null,
  createdAt: "2026-06-09T10:10:00.000Z",
  updatedAt: "2026-06-09T10:10:00.000Z",
} as unknown as NutritionWeeklyPlan;

const combined = buildDerivedNutritionCombinedMessage({
  review,
  plan: planWithClaudeProse,
  formality: "ty",
  studentName: "Надя",
  planWeekMode: "next_week",
});
assert.match(
  combined.renderResult.text ?? "",
  /ПЛАНОВЫЙ_АКЦЕНT_МАРКЕР/,
  "combined message must use the Claude plan prose for the focus section"
);
assert.doesNotMatch(
  combined.renderResult.text ?? "",
  /Детерминированный заголовок/,
  "deterministic plan_focus must not override the Claude plan voice"
);
// Day-by-day REVIEW prose written by Claude (with an em-dash) must survive the
// render gate as live prose (dash normalized to a hyphen), not collapse to the
// dry deterministic comment. This guards the latent em-dash regression.
assert.match(
  combined.renderResult.text ?? "",
  /День отдыха - питание ровное, белок закрыт хорошо/,
  "Claude day prose with an em-dash must render live (dash normalized), not fall back to the template"
);

assert.match(packageJson, /check:nutrition-merged-review-plan/, "package.json must register this check");

console.log("PASS check-nutrition-merged-review-plan");
