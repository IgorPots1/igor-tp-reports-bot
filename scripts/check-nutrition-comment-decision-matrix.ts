import assert from "node:assert/strict";

import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import { buildDerivedNutritionCoachDayByDayText } from "@/features/nutrition/combined-message";

function review(day: Record<string, unknown>): NutritionWeeklyAnalysis {
  return {
    id: "review-decision",
    studentId: "student-decision",
    reportId: "report-decision",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      daily_analysis: [
        {
          date: "2026-06-01",
          weekday_ru: "Понедельник",
          date_label: "01.06",
          training_type: "easy",
          training_label: "лёгкая тренировка",
          actual_kcal: 1400,
          protein_g: 100,
          fat_g: 45,
          carbs_g: 130,
          carbs_g_per_kg: 2.2,
          source_quality: { confidence: "high", hasNutritionData: true, hasTrainingContext: true, notes: [] },
          ...day,
        },
      ],
      do_not_send_reasons: [],
    },
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "deterministic-check",
    athleteMessageDraft: null,
    coachEdits: null,
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
  };
}

function textFor(day: Record<string, unknown>): string {
  return buildDerivedNutritionCoachDayByDayText(review(day)) ?? "";
}

const floorText = textFor({
  training_type: "easy",
  nutrition_status: "below_energy_floor",
  findings: ["protein_sufficient", "below_load_energy_floor", "protein_ok_but_energy_low"],
});
assert.doesNotMatch(floorText, /День выглядит ровно|ничего специально менять не нужно|Белок в этот день закрыт хорошо/);
assert.match(floorText, /энергии получилось маловато|питание вокруг тренировки/);

const crossText = textFor({
  training_type: "cross_training",
  training_label: "Padel Racket",
  nutrition_status: "low_for_cross_training",
  findings: ["below_cross_training_floor", "low_energy_with_cross_training", "below_load_energy_floor"],
  canonical_daily_analysis: {
    nutritionStatus: "low_for_cross_training",
    findings: ["below_cross_training_floor", "low_energy_with_cross_training", "below_load_energy_floor"],
    macroGuardrails: {
      protein: { status: "borderline" },
      fat: { status: "borderline" },
      carbs: { status: "low" },
    },
  },
});
assert.doesNotMatch(crossText, /День выглядит ровно|ничего специально менять не нужно/);
assert.match(crossText, /Падел|кросс-тренировка/);
assert.match(crossText, /углевод/i);
assert.match(crossText, /белок|жир/i);

const strengthText = textFor({
  training_type: "strength",
  training_label: "силовая",
  nutrition_status: "low_for_strength",
  findings: ["below_strength_floor", "low_energy_with_strength", "below_load_energy_floor"],
  canonical_daily_analysis: {
    nutritionStatus: "low_for_strength",
    findings: ["below_strength_floor", "low_energy_with_strength", "below_load_energy_floor"],
    macroGuardrails: {
      protein: { status: "borderline" },
      fat: { status: "low" },
      carbs: { status: "low" },
    },
  },
});
assert.doesNotMatch(strengthText, /Белок в этот день закрыт хорошо|День выглядит ровно/);
assert.match(strengthText, /силовой|восстановления/);
assert.match(strengthText, /белок|углевод/i);

const hardCarbsText = textFor({
  training_type: "hard",
  training_label: "интервалы",
  nutrition_status: "low_for_load",
  findings: ["low_carbs_for_hard_session"],
});
assert.match(hardCarbsText, /Углеводов за день получилось/);

const suspectText = textFor({
  nutrition_status: "suspect",
  findings: ["suspect_macro_values", "below_load_energy_floor"],
  source_quality: { confidence: "low", hasNutritionData: true, hasTrainingContext: true, notes: ["suspect_macro_values"] },
});
assert.match(suspectText, /проверить исходный отчёт вручную/);
assert.doesNotMatch(suspectText, /энергодоступность|RED-S|LEA|дефицит|медицинский риск|ешь на \d+/i);

const allText = [floorText, crossText, strengthText, hardCarbsText, suspectText].join("\n");
assert.doesNotMatch(allText, /энергодоступность|RED-S|LEA|дефицит энергии|дефицит калорий|опасная зона|медицинский риск|ешь на \d+/i);

console.log("PASS check-nutrition-comment-decision-matrix");
