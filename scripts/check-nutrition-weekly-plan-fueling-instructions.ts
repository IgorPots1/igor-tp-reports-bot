import assert from "node:assert/strict";

import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFallback,
} from "@/features/nutrition/weekly-plan-generator";

function buildAnalysis(tpNextWeekContext: Record<string, unknown>): NutritionWeeklyAnalysis {
  return {
    id: "analysis-fueling",
    studentId: "student-uuid-1",
    reportId: "report-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext,
    nutritionSummary: {
      data_quality_summary: { parsed_days: 7, low_confidence_days: 0, quality_flags: [] },
      one_focus: { category: "carbs", statement_ru: "Поддержать углеводы" },
      methodology_signals: { protein_sufficient: true },
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
  };
}

const withGelFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildAnalysis({
    cacheStatus: "ok",
    workouts: [
      {
        date: "2026-06-09",
        title: "Long run",
        type: "long_run",
        plannedText: "Long run, 1 gel every 30 min + sports drink",
      },
    ],
    keyWorkouts: [{ date: "2026-06-09", title: "Long run", type: "long_run", confidence: "high" }],
  }),
});
assert.equal(withGelFacts.nextWeekTraining.workouts[0]?.fuelingInstructionPresent, true);

const withoutGelFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildAnalysis({
    cacheStatus: "ok",
    workouts: [
      {
        date: "2026-06-09",
        title: "Long run easy",
        type: "long_run",
        plannedText: "Long run easy no special notes",
      },
    ],
    keyWorkouts: [{ date: "2026-06-09", title: "Long run easy", type: "long_run", confidence: "high" }],
  }),
});
assert.equal(withoutGelFacts.nextWeekTraining.workouts[0]?.fuelingInstructionPresent, false);

const withGelGenerated = generateNutritionWeeklyPlanFallback(withGelFacts);
assert.doesNotMatch(
  withGelGenerated.athleteMessageDraft ?? "",
  /2\s*гел/i,
  "athlete draft must not invent gel counts"
);
assert.match(
  withGelGenerated.athleteMessageDraft ?? "",
  /питание во время/i,
  "athlete draft may reference existing during-run fueling cautiously"
);

const emptyTpFacts = buildNutritionWeeklyPlanFactsFromSources({
  studentId: "student-uuid-1",
  studentName: "Nadezhda",
  formality: "ty",
  weightKg: 56,
  sourceAnalysis: buildAnalysis({
    cacheStatus: "empty",
    workouts: [],
    keyWorkouts: [],
  }),
});
const emptyTpGenerated = generateNutritionWeeklyPlanFallback(emptyTpFacts);
assert.equal((emptyTpGenerated.planSummary.key_training_days as unknown[]).length, 0);
assert.match(emptyTpGenerated.coachSummary, /TrainingPeaks/i);
assert.doesNotMatch(emptyTpGenerated.athleteMessageDraft ?? "", /2026-06-\d{2}/);

console.log("PASS check-nutrition-weekly-plan-fueling-instructions");
