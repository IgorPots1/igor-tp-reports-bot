import assert from "node:assert/strict";

import {
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
} from "@/features/nutrition/combined-message";
import { NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS } from "@/features/nutrition/narrative-guardrails";
import {
  humanizeNutritionTrainingLabel,
  isCombinedLoadLabel,
  isKeyIntervalTitle,
  isKeyTempoTitle,
  reconcileNarrativeRoleWithCarbLoadBasis,
  resolveNutritionNarrativeWorkoutRole,
  composeNutritionDayComment,
  buildNutritionDayNarrativeParts,
  NutritionNarrativeRepetitionState,
  buildNutritionTargetWeekMainStepLine,
} from "@/features/nutrition/narrative-composer";
import {
  isEasyLightNutritionTitle,
  isNutritionLongRunWorkout,
} from "@/features/nutrition/long-run";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";
import type { NutritionStudentContext } from "@/features/nutrition/context";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";

function assertRole(title: string, expected: string, options?: { trainingType?: string; durationMinutes?: number }) {
  const role = resolveNutritionNarrativeWorkoutRole({
    trainingType: options?.trainingType ?? "easy",
    trainingLabel: title,
    durationMinutes: options?.durationMinutes,
    mode: "past_review",
    isCompleted: true,
  }).role;
  assert.equal(role, expected, `${title} => ${expected}`);
}

assertRole("15 х 1,5 мин", "key_interval");
assertRole("15 x 1.5 min", "key_interval");
assertRole("20 х 1 мин", "key_interval");
assertRole("6 х 6 мин", "key_interval");
assertRole("7 х 5 мин", "key_interval");
assertRole("8 х 3 мин", "key_interval");
assertRole("10 х 400 м", "key_interval");
assertRole("5 x 1000", "key_interval");
assertRole("темповая 30 мин", "key_tempo");
assertRole("порог 3 х 10 мин", "key_tempo", { trainingType: "hard" });
assert.equal(resolveNutritionNarrativeWorkoutRole({ trainingType: "easy", trainingLabel: "Легкий бег по темпу", mode: "past_review", isCompleted: true }).role, "easy_run");
assert.equal(isKeyTempoTitle("Легкий бег по темпу"), false);
assert.ok(isEasyLightNutritionTitle("Бег в легком темпе"));
assert.equal(
  reconcileNarrativeRoleWithCarbLoadBasis({ role: "easy_run", isKey: false, reason: "easy_type" }, "hard").role,
  "key_tempo",
  "easy_run role must reconcile with hard carb load basis"
);
assertRole("длительная 90 мин", "long_run", { durationMinutes: 90 });
assert.equal(
  isNutritionLongRunWorkout({ title: "Easy run", durationMinutes: 70, mode: "past_review", isCompleted: true }),
  false,
  "70 min => not long"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Easy run", durationMinutes: 75, mode: "past_review", isCompleted: true }),
  false,
  "75 min < 80 => not long (Поток D-7: threshold raised to 80)"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Easy run", durationMinutes: 85, mode: "past_review", isCompleted: true }),
  true,
  "85 min >= 80 => long"
);
assert.equal(
  isNutritionLongRunWorkout({ title: "Sunday easy", mode: "past_review", isCompleted: true }),
  false,
  "Sunday easy without duration/title => not long"
);
assert.ok(isCombinedLoadLabel("силовая + бег"));
assert.ok(isCombinedLoadLabel("Padel + run"));
assert.equal(resolveNutritionNarrativeWorkoutRole({ trainingType: "easy", trainingLabel: "силовая + бег", mode: "past_review", isCompleted: true }).role, "combined_load");
assert.equal(humanizeNutritionTrainingLabel("Padel Racket", "cross_training"), "падел");
assert.equal(humanizeNutritionTrainingLabel("Cycling", "cross_training"), "вело");
assert.equal(humanizeNutritionTrainingLabel("длинная выносливостная нагрузка 5:16: Cycling", "long_endurance"), "вело 5:16");
assert.equal(humanizeNutritionTrainingLabel("длительная: бег", "long_run"), "длительный бег");
assert.equal(humanizeNutritionTrainingLabel("8 х 4 мин + Cycling", "hard"), "8 х 4 мин + вело");

function macroGuardrails(carbsStatus: string, carbsGPerKg: number, loadBasis: string): Record<string, unknown> {
  return {
    protein: { status: "ok", gPerKg: 1.7, floorGPerKg: 1.5 },
    fat: { status: "ok", gPerKg: 1.1, floorGPerKg: 1 },
    carbs: { status: carbsStatus, gPerKg: carbsGPerKg, rangeMinGPerKg: 4.5, rangeMaxGPerKg: 6.5, loadBasis },
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

function narrativeFixtureReview(): NutritionWeeklyAnalysis {
  return {
    id: "review-narrative-fixture",
    studentId: "student-fixture",
    reportId: "report-fixture",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      methodology_version: "ea_macro_narrative_v1",
      methodology_signals: { protein_sufficient: true },
      avg_protein_g_per_kg: 1.6,
      daily_analysis: [
        dayRow({
          date: "2026-06-01",
          weekday: "Понедельник",
          dateLabel: "01.06",
          trainingType: "hard",
          trainingLabel: "6 х 5 мин",
          kcal: 1500,
          proteinG: 100,
          fatG: 50,
          carbsG: 160,
          carbsGPerKg: 2.8,
          nutritionStatus: "below_energy_floor",
          findings: ["below_load_energy_floor", "low_carbs_for_load_type"],
          macroGuardrails: macroGuardrails("low", 2.8, "hard"),
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
          carbsG: 150,
          carbsGPerKg: 2.6,
          nutritionStatus: "low_for_cross_training",
          findings: ["below_load_energy_floor", "low_energy_with_cross_training"],
          macroGuardrails: macroGuardrails("low", 2.6, "cross_training"),
        }),
        dayRow({
          date: "2026-06-03",
          weekday: "Среда",
          dateLabel: "03.06",
          trainingType: "cross_training",
          trainingLabel: "Padel Racket",
          kcal: 1350,
          proteinG: 78,
          fatG: 48,
          carbsG: 145,
          carbsGPerKg: 2.5,
          nutritionStatus: "low_for_cross_training",
          findings: ["below_load_energy_floor", "low_energy_with_cross_training"],
          macroGuardrails: macroGuardrails("low", 2.5, "cross_training"),
        }),
        dayRow({
          date: "2026-06-04",
          weekday: "Четверг",
          dateLabel: "04.06",
          trainingType: "easy",
          trainingLabel: "Бег в легком темпе",
          kcal: 1600,
          proteinG: 95,
          fatG: 55,
          carbsG: 170,
          carbsGPerKg: 2.9,
          nutritionStatus: "below_energy_floor",
          findings: ["below_load_energy_floor"],
          macroGuardrails: macroGuardrails("low", 2.9, "easy"),
        }),
        dayRow({
          date: "2026-06-05",
          weekday: "Пятница",
          dateLabel: "05.06",
          trainingType: "rest",
          trainingLabel: "день отдыха",
          kcal: 1900,
          proteinG: 90,
          fatG: 60,
          carbsG: 220,
          carbsGPerKg: 3.8,
          nutritionStatus: "rest_ok",
          findings: ["protein_sufficient"],
          macroGuardrails: macroGuardrails("ok", 3.8, "rest"),
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

function minimalPlanWithInterval(): NutritionWeeklyPlan {
  return {
    id: "plan-narrative-fixture",
    studentId: "student-fixture",
    sourceReportId: "report-fixture",
    sourceAnalysisId: "review-narrative-fixture",
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
        title: "Ровная энергия",
        explanation: "Поддержка нагрузки.",
      },
      next_week_plan: {
        formula_version: "nutrition_next_week_plan_v1",
        day_type_targets: {
          rest: { target_kcal: 1950, protein_g: 90, fat_g: 60, carbs_g: 250 },
          easy: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 290 },
          hard: { target_kcal: 2400, protein_g: 95, fat_g: 65, carbs_g: 340 },
          pre_long: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 310 },
          long_run: { target_kcal: 2500, protein_g: 95, fat_g: 65, carbs_g: 390 },
        },
        days: [
          {
            date: "2026-06-10",
            weekday_ru: "Вторник",
            training_type: "hard",
            training_label: "6 х 5 мин",
            workout_title: "6 х 5 мин",
            target_kcal: 2400,
            protein_g: 95,
            fat_g: 65,
            carbs_g: 340,
            flags: { key_workout: true, hard: true, has_training_context: true },
          },
          {
            date: "2026-06-12",
            weekday_ru: "Четверг",
            training_type: "cross_training",
            training_label: "Cycling",
            workout_title: "Cycling",
            target_kcal: 2200,
            protein_g: 90,
            fat_g: 65,
            carbs_g: 290,
            flags: { cross_training: true, has_training_context: true },
          },
        ],
        summary: { long_run_source: "none", long_run_confidence: "low", has_training_context: true },
      },
      do_not_send_reasons: [],
    },
    trainingContextSnapshot: { workoutCount: 2 },
    nutritionContextSnapshot: {},
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    supersededByPlanId: null,
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

const review = narrativeFixtureReview();
const derived = buildDerivedNutritionCoachDayByDayText(review) ?? "";
const intervalComment = dayComment(derived, "01.06");
assert.match(intervalComment, /ключевая|интервальная|главная беговая/i);

const padel1 = dayComment(derived, "02.06");
const padel2 = dayComment(derived, "03.06");
assert.notEqual(padel1, padel2, "padel comments across days must not be identical");
assert.doesNotMatch(derived, /Padel Racket/i);
assert.doesNotMatch(derived, /\bCycling\b/);

const allComments = dayBlocks(derived).map((block) => feedbackAfterDivider(block));
const exactCounts = new Map<string, number>();
for (const comment of allComments) {
  const key = comment.toLocaleLowerCase("ru");
  exactCounts.set(key, (exactCounts.get(key) ?? 0) + 1);
}
for (const [, count] of exactCounts) {
  assert.ok(count <= 2, "repeated exact sentence count must be <= 2");
}

const proteinClosedCount = (derived.match(/Белок закрыт/gi) ?? []).length;
assert.ok(proteinClosedCount <= 3, "Белок закрыт phrase count must be <= 3");

const combined = buildDerivedNutritionCombinedMessage({
  review,
  plan: minimalPlanWithInterval(),
  formality: "ty",
  studentName: "Fixture Athlete",
});
const athleteText = combined.athleteMessageDraft ?? "";
// The weekly summary now rotates its phrasing per week (buildNutritionWeeklySummary picks from a
// pool seeded by weekFrom), so the opener is no longer a single literal. This still asserts what
// it always meant to: the athlete message carries a weekly-summary headline. The full opener set
// is covered by check-nutrition-weekly-summary-variety.
assert.match(
  athleteText,
  /Главный паттерн недели|Паттерн недели|Главное за неделю|Главный фокус|Фокус на неделю|Неделя держалась ровно|Неделя в целом собрана|Почти вся неделя ровная|Неделя вышла|Неделя собралась хорошо|Ровная неделя/
);
assert.doesNotMatch(athleteText, /понедельник, вторник, среда, четверг, пятница, суббота, воскресенье/i);
assert.match(athleteText, /6 х 5 мин/);
assert.doesNotMatch(athleteText, /длительная/i, "focus must not mention long run when absent");
assert.match(athleteText, /ориентиры, не обязательство/i);

for (const term of NUTRITION_ATHLETE_FORBIDDEN_MEDICAL_TERMS) {
  if (term === "дефицит") {
    assert.doesNotMatch(athleteText, /дефицит/i);
    continue;
  }
  assert.doesNotMatch(athleteText, new RegExp(term, "i"));
}

assert.ok(isKeyIntervalTitle("15 х 1,5 мин"));
assert.ok(isKeyTempoTitle("темповая 30 мин"));

assert.equal(
  resolveNutritionNarrativeWorkoutRole({
    trainingType: "long_endurance",
    trainingLabel: "длинная выносливостная нагрузка 5:16: Cycling",
    mode: "past_review",
    isCompleted: true,
  }).role,
  "long_endurance",
  "long_endurance_cycling_not_called_running"
);
assert.doesNotMatch(
  humanizeNutritionTrainingLabel("длинная выносливостная нагрузка 5:16: Cycling", "long_endurance"),
  /бегов/i
);

const preLongHighKcalParts = buildNutritionDayNarrativeParts({
  macro: {
    proteinStatus: "ok",
    fatStatus: "ok",
    carbsStatus: "borderline",
    fatPercentStatus: null,
    carbsGPerKg: 4.1,
  },
  roleInfo: { role: "rest", isKey: false, reason: "rest_day" },
  nutritionStatus: "pre_long_low",
  hasEnergyIssue: true,
  loadDay: true,
  fatFeedbackPolicy: "coach_only",
  athleteTrainingLabel: "день отдыха",
  findings: ["low_carbs_before_long_run"],
});
assert.doesNotMatch(
  [preLongHighKcalParts.energyLine, preLongHighKcalParts.carbLine, preLongHighKcalParts.proteinLine].join(" "),
  /энергии под нагрузку маловато/i,
  "pre_long_high_kcal_low_carbs_does_not_say_energy_low"
);
assert.match(
  preLongHighKcalParts.energyLine ?? "",
  /Калорийность высокая|не был «пустым»/i,
  "pre_long_high_kcal_mentions_energy_ok_and_carbs_lower_bound"
);
assert.match(preLongHighKcalParts.carbLine ?? "", /нижняя граница/i);

const longEnduranceComment = composeNutritionDayComment(
  {
    trainingType: "long_endurance",
    trainingLabel: "длинная выносливостная нагрузка 5:16: Cycling",
    athleteTrainingLabel: "вело 5:16",
    nutritionStatus: "adequate",
    findings: [],
    macro: {
      proteinStatus: "ok",
      fatStatus: "ok",
      carbsStatus: "ok",
      fatPercentStatus: null,
      carbsGPerKg: 5.5,
    },
    hasNutritionCompletenessIssue: false,
    hasEnergyIssue: false,
    roleInfo: {
      role: "long_endurance",
      isKey: true,
      reason: "long_endurance_type",
    },
    fatFeedbackPolicy: "coach_only",
  },
  new NutritionNarrativeRepetitionState()
);
assert.match(longEnduranceComment, /главная длинная нагрузка недели.*вело 5:16/i);
assert.doesNotMatch(longEnduranceComment, /беговая работа \(вело/i);
assert.doesNotMatch(longEnduranceComment, /длительная беговая работа/i);

const remainingMainStep = buildNutritionTargetWeekMainStepLine(
  {
    formula_version: "nutrition_next_week_plan_v1",
    day_type_targets: {
      rest: { target_kcal: 1950, protein_g: 90, fat_g: 60, carbs_g: 250 },
      easy: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 290 },
      hard: { target_kcal: 2400, protein_g: 95, fat_g: 65, carbs_g: 340 },
      pre_long: { target_kcal: 2200, protein_g: 90, fat_g: 65, carbs_g: 310 },
      long_run: { target_kcal: 2500, protein_g: 95, fat_g: 65, carbs_g: 390 },
    },
    days: [
      {
        date: "2026-06-13",
        weekday_ru: "Суббота",
        training_type: "easy",
        training_label: "лёгкий бег",
        workout_title: "лёгкий бег",
        target_kcal: 2200,
        protein_g: 90,
        fat_g: 65,
        carbs_g: 290,
        flags: { easy: true, has_training_context: true },
      },
    ],
  },
  "current_week",
  { todayLocalDate: "2026-06-14", miniTableMode: "athlete_remaining_only" }
);
assert.match(remainingMainStep, /На оставшиеся дни фокус простой/i, "remaining_only_focus_no_before_key_if_no_future_key");
assert.doesNotMatch(remainingMainStep, /особенно перед ключевой/i, "remaining_only_focus_no_past_key_workout");

const khadizhatEasyRunContext: NutritionStudentContext = {
  studentName: "Khadizhat",
  studentSlug: "khadizhat",
  studentUuid: "student-khadizhat",
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
  currentWeightKg: 62,
  nutritionGoal: null,
  coachContextRu: null,
  athleteReportSignals: [],
  manualMacroRows: [
    { day: "2026-06-01", weekday: "вс", kcal: 2100, proteinG: 95, fatG: 60, carbsG: 295, confidence: 1, notes: null },
  ],
  dataQuality: { parsedDays: 1, lowConfidenceDays: 0, hasResolvedDates: true, unrealisticRows: 0, duplicateDays: [], qualityFlags: [] },
  reportStatus: "ready_for_analysis",
  tpPastWeek: {
    periodFrom: "2026-06-01",
    periodTo: "2026-06-07",
    cacheStatus: "ok",
    cacheStatusNote: "ok",
    totalSessions: 1,
    plannedSessions: 0,
    completedSessions: 1,
    runningSessions: 1,
    longRun: null,
    keyWorkouts: [],
    workouts: [
      {
        date: "2026-06-01",
        title: "Бег в легком темпе",
        status: "completed",
        type: "run",
        description: null,
        coachComments: null,
        plannedText: null,
        durationHours: 0.75,
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
};
const khadizhatEasyMethodology = buildNutritionMethodologyContext({ context: khadizhatEasyRunContext });
const khadizhatEasyDay = khadizhatEasyMethodology.dailyAnalysis.find((day) => day.date === "2026-06-01");
assert.equal(khadizhatEasyDay?.canonicalDailyAnalysis.trainingType, "easy");
assert.equal(khadizhatEasyDay?.canonicalDailyAnalysis.macroGuardrails.carbs.loadBasis, "easy");
assert.notEqual(khadizhatEasyDay?.canonicalDailyAnalysis.macroGuardrails.carbs.status, "low");

const easyRunComment = composeNutritionDayComment(
  {
    trainingType: "easy",
    trainingLabel: "Бег в легком темпе",
    athleteTrainingLabel: "лёгкий бег",
    nutritionStatus: "adequate",
    findings: [],
    macro: {
      proteinStatus: "ok",
      fatStatus: "ok",
      carbsStatus: khadizhatEasyDay?.canonicalDailyAnalysis.macroGuardrails.carbs.status ?? "ok",
      carbsGPerKg: 4.76,
    },
    hasNutritionCompletenessIssue: false,
    hasEnergyIssue: false,
    roleInfo: resolveNutritionNarrativeWorkoutRole({
      trainingType: "easy",
      trainingLabel: "Бег в легком темпе",
      mode: "past_review",
      isCompleted: true,
    }),
    fatFeedbackPolicy: "coach_only",
  },
  new NutritionNarrativeRepetitionState()
);
assert.doesNotMatch(easyRunComment, /углеводов.*маловато/i, "4.76 g/kg easy day must not say carbs low");

console.log("PASS check-nutrition-review-narrative-quality");
