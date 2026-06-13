import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNutritionInterpretationValidationFacts,
} from "@/features/nutrition/interpretation-contract";
import {
  analyzeProductionText,
  analyzeShadowInterpretation,
  auditFatVisibility,
  auditRepetitionBudget,
  buildCanonicalFactsReadiness,
  buildFatReviewerFactsLines,
  buildReviewerPack,
  compareNutritionOutputs,
  NUTRITION_AUDIT_VERDICTS,
} from "@/features/nutrition/interpretation-audit";
import type { NutritionWeeklyInterpretation } from "@/features/nutrition/interpretation-contract";

const root = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function buildFacts(dates: string[], hasPrev: boolean, macros?: Record<string, { kcal: number; proteinG: number; fatG: number; carbsG: number }>) {
  const dailyAnalysis = dates.map((date) => ({
    date,
    actual: macros?.[date] ?? { kcal: 2000, proteinG: 110, fatG: 60, carbsG: 250 },
    flags: { hard: false, longRun: false },
  }));
  return buildNutritionInterpretationValidationFacts({ dailyAnalysis, hasPreviousWeeksContext: hasPrev });
}

function run(): void {
  const auditSource = readSource("scripts/audit-nutrition-interpretation-shadow.ts");
  const helperSource = readSource("src/features/nutrition/interpretation-audit.ts");
  const combinedSource = readSource("src/features/nutrition/combined-message.ts");

  // 1. audit script has read-only default.
  assert.match(auditSource, /read-only by default and never writes to the DB/i, "audit must document read-only default");
  assert.match(auditSource, /readOnly:\s*true/, "summary must report readOnly true");
  assert.doesNotMatch(auditSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, "audit must not perform DB writes");

  // 2. output report paths under reports/nutrition-interpretation-shadow-audit/.
  assert.match(auditSource, /reports", "nutrition-interpretation-shadow-audit/, "output dir must be under reports/nutrition-interpretation-shadow-audit");

  // 3. reviewer pack excludes raw full extracted PDF text.
  assert.match(helperSource, /MUST NOT include raw[\s\S]*extracted PDF text/i, "reviewer pack must exclude raw PDF text");
  assert.doesNotMatch(auditSource, /raw_text/, "audit must not embed report raw_text");
  assert.doesNotMatch(helperSource, /raw_text/, "reviewer pack helper must not embed report raw_text");

  // 4. named missing students do not hard-fail whole audit.
  assert.match(auditSource, /student not found/, "named-missing students should be recorded as skipped");
  assert.match(auditSource, /skipped\.push/, "audit must collect skipped cases instead of throwing");

  // 5. verdict categories are constrained.
  assert.deepEqual(
    [...NUTRITION_AUDIT_VERDICTS].sort(),
    ["blocked", "derived_better", "needs_prompt_tuning", "shadow_candidate"],
    "verdict categories must be the four constrained values"
  );

  // 6. Pyrite optional path does not require dependency.
  assert.match(auditSource, /required:\s*false/, "pyrite must be optional");
  assert.doesNotMatch(auditSource, /require\(["']pyrite|from ["']pyrite/, "audit must not import pyrite");

  // 7. production render is not switched.
  assert.match(auditSource, /productionRenderSwitched:\s*false/, "audit must report production render not switched");
  assert.doesNotMatch(combinedSource, /interpretation_shadow/, "production composer must still ignore shadow metadata");

  // 8. no Telegram send.
  for (const source of [auditSource, helperSource]) {
    assert.doesNotMatch(source, /sendTrainingPeaks\w*ToStudent|telegram\.send|bot\.send/i, "no Telegram send paths");
  }

  // 9. no TrainingPeaks mutation.
  assert.doesNotMatch(auditSource, /moveWorkout|createWorkout|updateWorkout|deleteWorkout|tp.*mutat/i, "no TP mutation");

  // 10. no DB write unless explicit apply+confirm exists.
  assert.match(auditSource, /NUTRITION_AUDIT_APPLY_CONFIRM\s*=\s*"GENERATE NUTRITION AUDIT FIXTURES"/, "apply confirm gate must exist");
  assert.match(auditSource, /--apply requires --confirm/, "apply must require confirm");

  // --- Functional metric/verdict tests ---
  const dates = ["2026-06-02", "2026-06-03", "2026-06-04"];

  // Readiness extraction from canonical daily analysis.
  const dailyAnalysis = [
    { date: "2026-06-02", actual: { kcal: 1900, proteinG: 110, fatG: 55, carbsG: 230 }, flags: { hard: true, longRun: false }, macro_guardrails: { protein: "ok" } },
    { date: "2026-06-03", actual: { kcal: 2100, proteinG: 120, fatG: 60, carbsG: 260 }, flags: { hard: false, longRun: true }, energy_availability: { status: "ok" } },
    { date: "2026-06-04", actual: { kcal: 1800, proteinG: 100, fatG: 50, carbsG: 210 }, flags: { hard: false, longRun: false } },
  ];
  const readiness = buildCanonicalFactsReadiness({
    dailyAnalysis,
    coachContextPresent: true,
    athleteSignalsCount: 1,
    previousWeeksContextPresent: false,
  });
  assert.equal(readiness.dailyCount, 3);
  assert.deepEqual(readiness.keyWorkoutDates, ["2026-06-02", "2026-06-03"]);
  assert.deepEqual(readiness.longRunDates, ["2026-06-03"]);
  assert.ok(Array.isArray(readiness.longEnduranceDays));
  assert.equal(readiness.macroGuardrails, true);
  assert.equal(readiness.energyAvailability, true);

  const facts = buildFacts(dates, false);

  // shadow_candidate: clean, mentions key workout, distinct comments, production repeats.
  const goodInterpretation: NutritionWeeklyInterpretation = {
    daily_blocks: [
      { date: "2026-06-02", comment_ru: "В интервальный день энергии было на нижней границе, перед нагрузкой можно добавить углеводов." },
      { date: "2026-06-03", comment_ru: "В длительный день питание держалось ровно, белок ближе к норме, это рабочий вариант." },
      { date: "2026-06-04", comment_ru: "День восстановления выглядит спокойным, можно слегка снизить объём без потери качества." },
    ],
    week_summary_ru: "По неделе питание рабочее, но в ключевые дни энергию стоит поддержать чуть точнее.",
    one_focus_statement_ru: "Поддержать углеводы вокруг ключевых тренировок без резких скачков.",
    week_comparison_line_ru: null,
  };
  const goodReadiness = buildCanonicalFactsReadiness({
    dailyAnalysis,
    coachContextPresent: true,
    athleteSignalsCount: 0,
    previousWeeksContextPresent: false,
  });
  const goodShadow = analyzeShadowInterpretation({ mode: "ai", interpretation: goodInterpretation, issues: [], facts });
  assert.equal(goodShadow.validationOk, true);
  const repetitiveProduction = analyzeProductionText({
    text: "Питание выглядит ровно. Питание выглядит ровно. Держим темп вокруг интервалов и длительной.",
    warnings: [],
  });
  const goodComparison = compareNutritionOutputs({
    production: repetitiveProduction,
    shadow: goodShadow,
    interpretation: goodInterpretation,
    readiness: goodReadiness,
  });
  assert.equal(goodComparison.verdict, "shadow_candidate", `expected shadow_candidate, got ${goodComparison.verdict}`);
  assert.equal(goodComparison.shadowMentionsKeyWorkout, true);

  // blocked: greeting structure.
  const greetingInterpretation: NutritionWeeklyInterpretation = {
    ...goodInterpretation,
    daily_blocks: [
      { date: "2026-06-02", comment_ru: "Привет! В интервальный день энергии маловато." },
      ...goodInterpretation.daily_blocks.slice(1),
    ],
  };
  // Build issues via validator to mirror runtime behaviour.
  const greetingComparison = compareNutritionOutputs({
    production: repetitiveProduction,
    shadow: analyzeShadowInterpretation({ mode: "ai", interpretation: greetingInterpretation, issues: [{ severity: "error", code: "forbidden_greeting", message: "x" }], facts }),
    interpretation: greetingInterpretation,
    readiness: goodReadiness,
  });
  assert.equal(greetingComparison.verdict, "blocked", "greeting must block");
  assert.ok(greetingComparison.shadowRiskSignals.includes("greeting_structure"));

  // needs_prompt_tuning: misses key workout.
  const noKeyInterpretation: NutritionWeeklyInterpretation = {
    daily_blocks: [
      { date: "2026-06-02", comment_ru: "День выглядит спокойным, можно поддержать привычный режим питания." },
      { date: "2026-06-03", comment_ru: "Ещё один ровный день, питание держится в комфортном коридоре по ощущениям." },
      { date: "2026-06-04", comment_ru: "Спокойный день восстановления, объём можно слегка снизить без потери." },
    ],
    week_summary_ru: "Неделя в целом ровная, серьёзных перекосов не видно по дням.",
    one_focus_statement_ru: "Сохранить привычный режим питания и сон на этой неделе.",
    week_comparison_line_ru: null,
  };
  const noKeyComparison = compareNutritionOutputs({
    production: repetitiveProduction,
    shadow: analyzeShadowInterpretation({ mode: "ai", interpretation: noKeyInterpretation, issues: [], facts }),
    interpretation: noKeyInterpretation,
    readiness: goodReadiness,
  });
  assert.equal(noKeyComparison.verdict, "needs_prompt_tuning", `expected needs_prompt_tuning, got ${noKeyComparison.verdict}`);
  assert.ok(noKeyComparison.shadowRiskSignals.includes("shadow_misses_key_workout"));

  const roleMismatchDaily = [
    { date: "2026-06-02", actual: { kcal: 2000, proteinG: 110, fatG: 60, carbsG: 250 }, flags: { hard: true, longRun: false }, training_type: "hard" },
    { date: "2026-06-03", actual: { kcal: 2100, proteinG: 120, fatG: 60, carbsG: 260 }, flags: { hard: false, longRun: false, longEndurance: true }, training_type: "long_endurance" },
    { date: "2026-06-04", actual: { kcal: 1800, proteinG: 100, fatG: 50, carbsG: 210 }, flags: { hard: false, longRun: false }, training_type: "easy" },
    {
      date: "2026-06-05",
      actual: { kcal: 1900, proteinG: 105, fatG: 55, carbsG: 220 },
      flags: { hard: false, longRun: false },
      training_type: "easy",
      macro_guardrails: { protein: { status: "ok" } },
      energy_availability: { status: "ok" },
    },
    {
      date: "2026-06-06",
      actual: { kcal: 1950, proteinG: 108, fatG: 58, carbsG: 230 },
      flags: { hard: false, longRun: false },
      training_type: "rest",
      macro_guardrails: { protein: { status: "ok" } },
      energy_availability: { status: "ok" },
    },
  ];
  const roleMismatchReadiness = buildCanonicalFactsReadiness({
    dailyAnalysis: roleMismatchDaily,
    coachContextPresent: true,
    athleteSignalsCount: 0,
    previousWeeksContextPresent: false,
  });
  const roleMismatchInterpretation: NutritionWeeklyInterpretation = {
    daily_blocks: [
      { date: "2026-06-02", comment_ru: "Лёгкий день, питание выглядит ровно." },
      { date: "2026-06-03", comment_ru: "День отдыха прошёл спокойно." },
      { date: "2026-06-04", comment_ru: "Ровный день." },
      { date: "2026-06-05", comment_ru: "Ровный день." },
      { date: "2026-06-06", comment_ru: "Ровный день." },
    ],
    week_summary_ru: "Данных пока недостаточно, нужен ручной разбор.",
    one_focus_statement_ru: "Данных пока недостаточно, нужен ручной разбор.",
    week_comparison_line_ru: null,
  };
  const roleMismatchComparison = compareNutritionOutputs({
    production: repetitiveProduction,
    shadow: analyzeShadowInterpretation({
      mode: "ai",
      interpretation: roleMismatchInterpretation,
      issues: [],
      facts: buildNutritionInterpretationValidationFacts({ dailyAnalysis: roleMismatchDaily, hasPreviousWeeksContext: false }),
    }),
    interpretation: roleMismatchInterpretation,
    readiness: roleMismatchReadiness,
  });
  assert.equal(roleMismatchComparison.verdict, "needs_prompt_tuning");
  assert.ok(roleMismatchComparison.shadowRiskSignals.includes("shadow_day_role_mismatch"));
  assert.ok(roleMismatchComparison.shadowRiskSignals.includes("shadow_unnecessary_manual_review"));

  // blocked: phantom comparison when no previous weeks context.
  const phantomInterpretation: NutritionWeeklyInterpretation = {
    ...goodInterpretation,
    week_comparison_line_ru: "По сравнению с прошлой неделей стало ровнее.",
  };
  const phantomComparison = compareNutritionOutputs({
    production: repetitiveProduction,
    shadow: analyzeShadowInterpretation({ mode: "ai", interpretation: phantomInterpretation, issues: [{ severity: "error", code: "phantom_week_comparison", message: "x" }], facts }),
    interpretation: phantomInterpretation,
    readiness: goodReadiness,
  });
  assert.equal(phantomComparison.shadowHasPhantomComparison, true);
  assert.equal(phantomComparison.verdict, "blocked", "phantom comparison must block");

  // null interpretation => blocked.
  const nullComparison = compareNutritionOutputs({
    production: repetitiveProduction,
    shadow: analyzeShadowInterpretation({ mode: "disabled", interpretation: null, issues: [{ severity: "error", code: "invalid_shape", message: "x" }], facts }),
    interpretation: null,
    readiness: goodReadiness,
  });
  assert.equal(nullComparison.verdict, "blocked", "null interpretation must block");

  // Reviewer pack excludes raw text and includes both outputs.
  const pack = buildReviewerPack({
    studentName: "Test Athlete",
    weekFrom: "2026-06-02",
    weekTo: "2026-06-08",
    athleteContextLines: ["coach_context_ru present"],
    factsSummaryLines: ["canonical days: 3"],
    productionText: "Производный текст для ученика.",
    interpretation: goodInterpretation,
  });
  assert.match(pack, /Output A — current derived composer/);
  assert.match(pack, /Output B — shadow interpretation pieces/);
  assert.match(pack, /production_switch_recommendation/);
  assert.doesNotMatch(pack, /raw_text/);

  const highFatDaily = [
    {
      date: "2026-06-06",
      actual: { kcal: 2200, proteinG: 95, fatG: 95, carbsG: 180 },
      macro_guardrails: {
        fat: { status: "high", percentStatus: "high", g: 95, percentEnergy: 47 },
        protein: { status: "ok" },
        carbs: { status: "borderline" },
      },
    },
  ];
  const fatAuditHidden = auditFatVisibility({
    dailyAnalysis: highFatDaily,
    athleteText: "Главный фокус — углеводы вокруг нагрузки.",
    coachSummaryText: "Жиры: высокий процент энергии из жиров (сб). Athlete-facing скрыто по политике coach_only.",
    fatFeedbackPolicy: "coach_only",
  });
  assert.ok(fatAuditHidden.signals.includes("fat_visibility_consistency"));
  assert.ok(fatAuditHidden.signals.includes("fat_policy_respected"));
  assert.equal(fatAuditHidden.issues.length, 0);

  const fatAuditLeak = auditFatVisibility({
    dailyAnalysis: highFatDaily,
    athleteText: "Жиры высоковаты, при этом углеводов под нагрузку не хватает.",
    coachSummaryText: "Жиры: высокий процент энергии из жиров (сб).",
    fatFeedbackPolicy: "coach_only",
  });
  assert.ok(fatAuditLeak.issues.some((issue) => issue.startsWith("fat_policy_respected")));

  const fatFactsLines = buildFatReviewerFactsLines({
    dailyAnalysis: highFatDaily,
    fatFeedbackPolicy: "coach_only",
    coachSummaryText: "Жиры: высокий процент",
    athleteText: "test",
  });
  assert.ok(fatFactsLines.some((line) => line.includes("fat visibility policy")));
  assert.ok(fatFactsLines.some((line) => line.includes("fat %energy")));

  assert.equal(auditRepetitionBudget("энергии маловато. энергии маловато. энергии маловато.").length, 1);

  console.log("PASS check-nutrition-interpretation-shadow-audit");
}

run();
