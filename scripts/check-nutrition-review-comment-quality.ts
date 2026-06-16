import assert from "node:assert/strict";

import {
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
} from "@/features/nutrition/combined-message";
import { NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES } from "@/features/nutrition/narrative-guardrails";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";

function minimalPlan(): NutritionWeeklyPlan {
  return {
    id: "plan-kristina-comment-quality",
    studentId: "student-kristina",
    sourceReportId: "report-kristina",
    sourceAnalysisId: "review-kristina-comment-quality",
    planWeekFrom: "2026-06-08",
    planWeekTo: "2026-06-14",
    status: "draft_generated",
    generationMode: "fallback",
    promptVersion: "nutrition-weekly-plan-v1-ai",
    aiModel: "model",
    coachSummary: "coach summary",
    athleteMessageDraft: "Plan draft",
    coachEditedDraft: null,
    approvedAt: null,
    planSummary: {
      plan_focus: {
        title: "Ровная энергия к нагрузке",
        explanation: "Поддерживаем питание вокруг ключевых дней.",
      },
      next_week_plan: {
        formula_version: "nutrition_next_week_plan_v1",
        day_type_targets: {
          rest: { target_kcal: 1950, protein_g: 90, fat_g: 60, carbs_g: 250 },
          easy: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 290 },
          hard: { target_kcal: 2400, protein_g: 95, fat_g: 65, carbs_g: 340 },
          pre_long: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 310 },
          long_run: { target_kcal: 2500, protein_g: 95, fat_g: 65, carbs_g: 390 },
          strength: { target_kcal: 2200, protein_g: 100, fat_g: 65, carbs_g: 290 },
        },
        days: [
          {
            date: "2026-06-08",
            weekday_ru: "Понедельник",
            training_type: "rest",
            training_label: "день отдыха",
            target_kcal: 1950,
            protein_g: 90,
            fat_g: 60,
            carbs_g: 250,
          },
        ],
        summary: { long_run_source: "none", long_run_confidence: "low" },
      },
      do_not_send_reasons: [],
    },
    trainingContextSnapshot: {},
    nutritionContextSnapshot: {},
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    supersededByPlanId: null,
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
  };
}

function kristinaMacroGuardrails(input: {
  proteinStatus: string;
  proteinGPerKg: number;
  fatStatus: string;
  fatGPerKg: number;
  carbsStatus: string;
  carbsGPerKg: number;
  loadBasis: string;
}): Record<string, unknown> {
  return {
    protein: { status: input.proteinStatus, gPerKg: input.proteinGPerKg, floorGPerKg: 1.5 },
    fat: { status: input.fatStatus, gPerKg: input.fatGPerKg, floorGPerKg: 1 },
    carbs: {
      status: input.carbsStatus,
      gPerKg: input.carbsGPerKg,
      rangeMinGPerKg: 4.5,
      rangeMaxGPerKg: 6.5,
      loadBasis: input.loadBasis,
    },
  };
}

function dayRow(input: {
  date: string;
  weekday: string;
  dateLabel: string;
  trainingType: string;
  trainingLabel: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  carbsGPerKg: number;
  nutritionStatus: string;
  findings: string[];
  macroGuardrails: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    date: input.date,
    weekday_ru: input.weekday,
    date_label: input.dateLabel,
    training_type: input.trainingType,
    training_label: input.trainingLabel,
    actual_kcal: input.kcal,
    protein_g: input.proteinG,
    fat_g: input.fatG,
    carbs_g: input.carbsG,
    carbs_g_per_kg: input.carbsGPerKg,
    nutrition_status: input.nutritionStatus,
    findings: input.findings,
    canonical_daily_analysis: {
      date: input.date,
      weekdayRu: input.weekday,
      dateLabel: input.dateLabel,
      trainingType: input.trainingType,
      trainingLabel: input.trainingLabel,
      nutritionStatus: input.nutritionStatus,
      findings: input.findings,
      macroGuardrails: input.macroGuardrails,
      actual: {
        kcal: input.kcal,
        proteinG: input.proteinG,
        fatG: input.fatG,
        carbsG: input.carbsG,
        carbsGPerKg: input.carbsGPerKg,
      },
    },
    source_quality: { confidence: "high", hasNutritionData: true, hasTrainingContext: true, notes: [] },
  };
}

function kristinaReview(): NutritionWeeklyAnalysis {
  return {
    id: "review-kristina-comment-quality",
    studentId: "student-kristina",
    reportId: "report-kristina",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      methodology_signals: { protein_sufficient: true },
      daily_analysis: [
        dayRow({
          date: "2026-06-01",
          weekday: "Понедельник",
          dateLabel: "01.06",
          trainingType: "easy",
          trainingLabel: "Бег по пульсу",
          kcal: 1600,
          proteinG: 115,
          fatG: 45,
          carbsG: 175,
          carbsGPerKg: 2.97,
          nutritionStatus: "below_energy_floor",
          findings: ["below_load_energy_floor", "protein_ok_but_energy_low", "low_carbs_for_load_type", "fat_below_floor"],
          macroGuardrails: kristinaMacroGuardrails({
            proteinStatus: "ok",
            proteinGPerKg: 1.9,
            fatStatus: "low",
            fatGPerKg: 0.76,
            carbsStatus: "low",
            carbsGPerKg: 2.97,
            loadBasis: "easy",
          }),
        }),
        dayRow({
          date: "2026-06-02",
          weekday: "Вторник",
          dateLabel: "02.06",
          trainingType: "cross_training",
          trainingLabel: "Padel Racket",
          kcal: 1400,
          proteinG: 80,
          fatG: 50,
          carbsG: 165,
          carbsGPerKg: 2.76,
          nutritionStatus: "low_for_cross_training",
          findings: ["below_load_energy_floor", "low_energy_with_cross_training", "below_cross_training_floor"],
          macroGuardrails: kristinaMacroGuardrails({
            proteinStatus: "borderline",
            proteinGPerKg: 1.35,
            fatStatus: "borderline",
            fatGPerKg: 0.8,
            carbsStatus: "low",
            carbsGPerKg: 2.76,
            loadBasis: "cross_training",
          }),
        }),
        dayRow({
          date: "2026-06-03",
          weekday: "Среда",
          dateLabel: "03.06",
          trainingType: "easy",
          trainingLabel: "силовая + бег",
          kcal: 1400,
          proteinG: 80,
          fatG: 40,
          carbsG: 170,
          carbsGPerKg: 2.84,
          nutritionStatus: "low_for_strength",
          findings: ["below_load_energy_floor", "low_energy_with_strength", "below_strength_floor"],
          macroGuardrails: kristinaMacroGuardrails({
            proteinStatus: "borderline",
            proteinGPerKg: 1.36,
            fatStatus: "low",
            fatGPerKg: 0.71,
            carbsStatus: "low",
            carbsGPerKg: 2.84,
            loadBasis: "easy",
          }),
        }),
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

// Task 10c: day blocks now have internal blank lines (header / numbers / divider /
// feedback), so split on the day-header marker and take the feedback after the divider.
function feedbackAfterDivider(block: string): string {
  const lines = block.split("\n");
  const dividerIdx = lines.findIndex((l) => /^\s*[—–-](\s*[—–-])+\s*$/.test(l.trim()));
  const feedbackLines = dividerIdx >= 0 ? lines.slice(dividerIdx + 1) : lines.slice(2);
  return feedbackLines.map((l) => l.trim()).filter(Boolean).join(" ").trim();
}
function dayBlocks(derived: string): string[] {
  return derived.split(/\n(?=🔹 )/).filter((b) => b.includes("🔹"));
}
function dayComment(derived: string, dateLabel: string): string {
  const block = dayBlocks(derived).find((item) => item.includes(`(${dateLabel})`)) ?? "";
  return feedbackAfterDivider(block);
}

const review = kristinaReview();
const derived = buildDerivedNutritionCoachDayByDayText(review) ?? "";
const padelComment = dayComment(derived, "02.06");
const strengthComment = dayComment(derived, "03.06");
const runComment = dayComment(derived, "01.06");

assert.match(padelComment, /Падел|падел|кросс-тренировка/i);
assert.match(padelComment, /энерг|низким|пустым/);
assert.match(padelComment, /углевод/i);
assert.match(padelComment, /белок|углевод/i);

assert.match(strengthComment, /силовой|восстановления|двойн|нагрузка получилась двойная/i);
assert.match(strengthComment, /белок|энерг|углевод/i);
assert.doesNotMatch(strengthComment, /День выглядит ровно/);

assert.match(runComment, /энерг/i);
assert.match(runComment, /углевод|Белок закрыт/i);

const uniqueComments = new Set([padelComment, strengthComment, runComment]);
assert.ok(uniqueComments.size >= 2, "load-day comments should not be identical templates");

const combined = buildDerivedNutritionCombinedMessage({
  review,
  plan: minimalPlan(),
  formality: "ty",
  studentName: "Kristina Pamparaite",
  profilePreferences: {},
});
const athleteText = combined.athleteMessageDraft ?? "";
assert.match(athleteText, /Белок по неделе|Белок в целом|нижней границе/i);
assert.match(athleteText, /Главный паттерн недели|Главный фокус|энерг|углевод/i);
assert.doesNotMatch(athleteText, /RED-S|LEA|энергодоступност|дефицит/i);

function polyakovaLikeDayRow(input: {
  date: string;
  weekday: string;
  dateLabel: string;
  trainingType: string;
  trainingLabel: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  carbsGPerKg: number;
  nutritionStatus: string;
  findings: string[];
}): Record<string, unknown> {
  const macroGuardrails = kristinaMacroGuardrails({
    proteinStatus: "ok",
    proteinGPerKg: 1.63,
    fatStatus: "ok",
    fatGPerKg: 1.5,
    carbsStatus: input.carbsGPerKg < 3 ? "low" : "ok",
    carbsGPerKg: input.carbsGPerKg,
    loadBasis: input.trainingType,
  });
  return dayRow({
    ...input,
    macroGuardrails,
    findings: input.findings,
  });
}

function polyakovaLikeReview(): NutritionWeeklyAnalysis {
  return {
    ...kristinaReview(),
    id: "review-polyakova-like",
    weekFrom: "2026-06-02",
    weekTo: "2026-06-07",
    nutritionSummary: {
      methodology_version: "ea_macro_narrative_v1",
      methodology_signals: { protein_sufficient: true },
      daily_analysis: [
        polyakovaLikeDayRow({
          date: "2026-06-02",
          weekday: "Вторник",
          dateLabel: "02.06",
          trainingType: "easy",
          trainingLabel: "Бег в легком темпе",
          kcal: 1683,
          proteinG: 94,
          fatG: 87,
          carbsG: 137,
          carbsGPerKg: 2.37,
          nutritionStatus: "below_energy_floor",
          findings: ["below_load_energy_floor"],
        }),
        polyakovaLikeDayRow({
          date: "2026-06-03",
          weekday: "Среда",
          dateLabel: "03.06",
          trainingType: "rest",
          trainingLabel: "день отдыха",
          kcal: 1969,
          proteinG: 94,
          fatG: 63,
          carbsG: 245,
          carbsGPerKg: 4.22,
          nutritionStatus: "below_energy_floor",
          findings: ["below_load_energy_floor"],
        }),
      ].map((row) => ({
        ...row,
        source_quality: {
          confidence: "low",
          hasNutritionData: true,
          hasTrainingContext: true,
          notes: ["missing_training_context", "partial_week"],
        },
      })),
      do_not_send_reasons: [],
    },
  };
}

const polyakovaDerived = buildDerivedNutritionCoachDayByDayText(polyakovaLikeReview()) ?? "";
assert.doesNotMatch(
  polyakovaDerived,
  /Данные по питанию за день неполные/,
  "complete parsed week with TP-stale notes must not emit nutrition incomplete phrase"
);

const draftGeneratorSource = readFileSync(
  join(process.cwd(), "src/features/nutrition/draft-generator.ts"),
  "utf8"
);
assert.match(draftGeneratorSource, /NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES/);
assert.ok(NUTRITION_REVIEW_NARRATIVE_PROMPT_LINES.length >= 5, "narrative guardrails must stay aligned with nutrition audit");

console.log("PASS check-nutrition-review-comment-quality");
