import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
  formatNutritionAthleteGreetingName,
  type NutritionCombinedMessageResult,
} from "@/features/nutrition/combined-message";
import { humanizeNutritionTrainingLabel } from "@/features/nutrition/narrative-composer";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import { resolveNutritionWeeklyPlanForDisplay } from "@/features/nutrition/repository";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildReview(status: NutritionWeeklyAnalysis["status"] = "draft_generated"): NutritionWeeklyAnalysis {
  return {
    id: "review-1",
    studentId: "student-anna",
    reportId: "report-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    status,
    internalSummary: {},
    tpPastWeekContext: {},
    tpNextWeekContext: {},
    nutritionSummary: {
      avg_kcal: 2200,
      one_focus: {
        statement_ru: "Держим ровную энергию вокруг ключевых тренировок.",
      },
      daily_analysis: [
        {
          date: "2026-06-01",
          weekday_ru: "Понедельник",
          date_label: "01.06",
          training_type: "rest",
          training_label: "день отдыха",
          actual_kcal: 2487,
          protein_g: 104.2,
          fat_g: 132,
          carbs_g: 214.69,
          carbs_g_per_kg: 3.839,
          nutrition_status: "rest_ok",
          hint_for_comment: "Нагрузка и питание в целом согласованы; можно дать краткий поддерживающий комментарий.",
          findings: ["rest_day_macro_distribution", "protein_sufficient"],
          source_quality: { confidence: "low", hasNutritionData: true, hasTrainingContext: false, notes: ["missing_training_context"] },
        },
        {
          date: "2026-06-07",
          weekday_ru: "Воскресенье",
          date_label: "07.06",
          training_type: "long_run",
          training_label: "Бег по пульсу",
          actual_kcal: 2510,
          protein_g: 101,
          fat_g: 66,
          carbs_g: 382,
          carbs_g_per_kg: 6.8,
          nutrition_status: "long_run_ok",
          findings: [],
          source_quality: { confidence: "high" },
        },
      ],
      day_by_day_analysis_text: "Текст fallback day-by-day.",
      do_not_send_reasons: [],
    },
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: "model",
    athleteMessageDraft: "Review draft fallback",
    coachEdits: null,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
  };
}

function buildPlan(input?: {
  status?: NutritionWeeklyPlan["status"];
  includeNextWeekPlan?: boolean;
  draft?: string | null;
  id?: string;
}): NutritionWeeklyPlan {
  const includeNextWeekPlan = input?.includeNextWeekPlan ?? true;
  return {
    id: input?.id ?? "plan-1",
    studentId: "student-anna",
    sourceReportId: "report-1",
    sourceAnalysisId: "review-1",
    planWeekFrom: "2026-06-08",
    planWeekTo: "2026-06-14",
    status: input?.status ?? "draft_generated",
    generationMode: "fallback",
    promptVersion: "nutrition-weekly-plan-v1-ai",
    aiModel: "model",
    coachSummary: "coach summary",
    athleteMessageDraft: input?.draft === undefined ? "Plan athlete draft" : input.draft,
    coachEditedDraft: null,
    approvedAt: null,
    planSummary: {
      plan_focus: {
        title: "Ровные углеводы к ключевым сессиям",
        explanation: "Без резких просадок в дни нагрузки.",
      },
      do_not_send_reasons: [],
      ...(includeNextWeekPlan
        ? {
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
              summary: {
                long_run_source: "none",
                long_run_confidence: "low",
              },
            },
          }
        : {}),
    },
    trainingContextSnapshot: {},
    nutritionContextSnapshot: {},
    safetyFlags: { hard_flags: [], do_not_send_reasons: [], blocked: false },
    supersededByPlanId: null,
    createdAt: "2026-06-09T10:10:00.000Z",
    updatedAt: "2026-06-09T10:10:00.000Z",
  };
}

function assertReady(result: NutritionCombinedMessageResult): void {
  assert.ok(result.athleteMessageDraft, "ready result must have athlete draft");
  assert.equal(result.renderResult.ok, true, "ready result must have ok renderer result");
  assert.equal(result.renderResult.text, result.athleteMessageDraft, "athlete draft must come from renderer text");
  assert.equal(result.sourceReviewId, "review-1");
  assert.equal(result.sourcePlanId, "plan-1");
}

async function run(): Promise<void> {
  const root = process.cwd();
  const packageJson = readFileSync(join(root, "package.json"), "utf8");
  const pageSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
  const helperSource = readFileSync(join(root, "src/features/nutrition/combined-message.ts"), "utf8");
  const repoSource = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");

  assert.match(packageJson, /check:nutrition-combined-message/, "package.json must include combined message check script");
  assert.match(pageSource, /Черновик ученику — полный текст/, "UI must include combined copy block title");
  assert.match(pageSource, /buildDerivedNutritionCombinedMessage/, "UI must use combined helper");
  assert.match(pageSource, /displayPlan/, "UI combined block must use resolved display plan");
  assert.match(pageSource, /analyzeNutritionPageConsistency/, "UI must include page consistency guardrails");
  assert.match(pageSource, /Проверка согласованности/, "UI must show page consistency warning block");
  assert.match(pageSource, /copyEnabled=\{false\}/, "stored service drafts must remain copy disabled");
  assert.match(pageSource, /Детали для тренера — актуальная сводка/, "coach details must be labeled as derived summary");
  assert.match(pageSource, /buildDerivedNutritionCoachSummary/, "page must use derived coach summary helper");
  assert.match(helperSource, /daily_analysis/, "helper must use canonical daily analysis facts");
  assert.match(helperSource, /next_week_plan/, "helper must use deterministic next_week_plan values");

  const review = buildReview();
  const plan = buildPlan();
  const ready = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(ready.status, "ready");
  assertReady(ready);
  // Task 10c: message is split into two Telegram-sized parts at the past/future
  // boundary — part 1 = last-week review, part 2 = next-week plan; each ≤ 4096.
  assert.equal(ready.athleteMessageDraftParts.length, 2, "ready message must split into two parts");
  const [reviewPart, planPart] = ready.athleteMessageDraftParts;
  assert.ok(reviewPart.length <= 4096 && planPart.length <= 4096, "each Telegram part must fit the 4096-char cap");
  assert.match(reviewPart, /📊 Разбор по дням/, "part 1 holds the day-by-day review");
  assert.match(reviewPart, /📌 Итог недели/, "part 1 ends with the week summary");
  assert.doesNotMatch(reviewPart, /📋 Мини-таблица/, "part 1 must not contain the plan table");
  assert.match(planPart, /Фокус на (эту|следующую) неделю/, "part 2 holds the week focus");
  assert.match(planPart, /📋 Мини-таблица|План на неделю по типам дней/, "part 2 holds the plan");
  assert.match(ready.athleteMessageDraft ?? "", /~2000 ккал/, "must display-round rest kcal from next_week_plan");
  assert.doesNotMatch(ready.athleteMessageDraft ?? "", /~1950 ккал|2487 ккал|214\.69|104\.2|\d+\.\d+\s*г/, "athlete copy must avoid raw technical numbers");
  assert.match(ready.athleteMessageDraft ?? "", /~2500 ккал/, "actual kcal must be rounded for athlete text");
  // Task 10c: compact, phone-readable numbers line (ккал · Б · Ж · У) — no per-kg.
  assert.match(ready.athleteMessageDraft ?? "", /· Б \d+ г · Ж \d+ г · У \d+ г/, "day numbers line uses compact Б/Ж/У format");
  // Task 10c: phone-readable structure — section heading + blank, then per-day
  // blocks (header / blank / numbers / blank / visible divider / blank / feedback),
  // copy-paste-safe (no markdown), one blank line between days.
  assert.match(ready.athleteMessageDraft ?? "", /📊 Разбор по дням\n\n🔹 /, "day section heading then blank line then first day");
  assert.match(ready.athleteMessageDraft ?? "", /🔹 Понедельник \(01\.06\)[^\n]*\n\n[^\n]*ккал · Б [^\n]*\n\n- - -\n\n/, "per-day block: header / numbers / divider / feedback with blank lines");
  assert.doesNotMatch(ready.athleteMessageDraft ?? "", /^\s*-{3,}\s*$/m, "divider must not be a markdown horizontal rule");
  assert.match(ready.athleteMessageDraft ?? "", /🔹 Понедельник \(01\.06\) · день отдыха/, "must include canonical day-by-day block");
  assert.match(ready.athleteMessageDraft ?? "", /День отдыха получился спокойным/, "rest day must render natural non-caution text");
  assert.match(ready.athleteMessageDraft ?? "", /🔹 Воскресенье \(07\.06\) · длительная/, "long_run daily label must be athlete-safe");
  assert.doesNotMatch(ready.athleteMessageDraft ?? "", /Воскресенье \(07\.06\) · Бег по пульсу/, "long_run daily label must not expose generic TP title");
  assert.doesNotMatch(
    ready.athleteMessageDraft ?? "",
    /Комментарий:|можно дать|указать факт|hint|source_quality|по качеству данных здесь возможна неполная картина|по этому дню вывод делаю осторожно|данных может быть чуть меньше|Данные по питанию за день неполные|вывод короткий|день без тренировки в план тренировок|день без тренировки в TrainingPeaks|Собрала|\*\*|---|—|–|TrainingPeaks|FatSecret/,
    "combined message must not leak internal hints or markdown separators"
  );
  assert.equal((ready.athleteMessageDraft ?? "").match(/Привет!/g)?.length, 1, "combined message must have exactly one (name-less) greeting");
  assert.doesNotMatch(ready.athleteMessageDraft ?? "", /Силовая —/, "strength block must not show without strength day");

  const nadezhdaGreeting = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: "Nadezhda Ponomareva",
  });
  assert.match(nadezhdaGreeting.athleteMessageDraft ?? "", /^Привет!/, "greeting is name-less");
  assert.doesNotMatch((nadezhdaGreeting.athleteMessageDraft ?? "").split("\n")[0] ?? "", /Надя|Nadezhda/, "greeting line carries no name");

  assert.equal(formatNutritionAthleteGreetingName({ studentName: "Polyakova Anastasia" }), "Анастасия");
  const polyakovaGreeting = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: "Polyakova Anastasia",
  });
  assert.match(polyakovaGreeting.athleteMessageDraft ?? "", /^Привет!/, "greeting is name-less");
  assert.doesNotMatch((polyakovaGreeting.athleteMessageDraft ?? "").split("\n")[0] ?? "", /Анастасия|Polyakova/, "greeting line carries no name");
  assert.doesNotMatch(polyakovaGreeting.athleteMessageDraft ?? "", /\bCycling\b/);

  const noNameGreeting = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: "Polyakova",
  });
  assert.match(noNameGreeting.athleteMessageDraft ?? "", /^Привет!/);

  assert.equal(humanizeNutritionTrainingLabel("длинная выносливостная нагрузка 5:16: Cycling", "long_endurance"), "вело 5:16");
  assert.equal(humanizeNutritionTrainingLabel("длительная: бег", "long_run"), "длительный бег");

  const methodologyReview = buildReview();
  methodologyReview.nutritionSummary = {
    ...asObject(methodologyReview.nutritionSummary),
    daily_analysis: [
      {
        date: "2026-06-01",
        kcal: 2477,
        proteinG: 103.58,
        fatG: 131.91,
        carbsG: 206.93,
        carbsGPerKg: 3.7,
        nutritionStatus: "rest_ok",
        findings: ["protein_sufficient"],
        canonicalDailyAnalysis: {
          date: "2026-06-01",
          weekdayRu: "Понедельник",
          dateLabel: "01.06",
          trainingType: "rest",
          trainingLabel: "день отдыха",
          actual: {
            kcal: 2477,
            proteinG: 103.58,
            fatG: 131.91,
            carbsG: 206.93,
            carbsGPerKg: 3.7,
          },
          nutritionStatus: "rest_ok",
          findings: ["protein_sufficient"],
          sourceQuality: { confidence: "high" },
          hintForComment: "можно дать краткий поддерживающий комментарий.",
        },
      },
    ],
  };
  methodologyReview.athleteMessageDraft =
    "Привет!\nКомментарий: по качеству данных здесь возможна неполная картина.\nможно дать краткий поддерживающий комментарий.";
  const methodologyCombined = buildDerivedNutritionCombinedMessage({
    review: methodologyReview,
    plan,
    formality: "ty",
    studentName: "Nadezhda Ponomareva",
  });
  assert.match(methodologyCombined.athleteMessageDraft ?? "", /🔹 Понедельник \(01\.06\) · день отдыха/);
  assert.doesNotMatch(
    methodologyCombined.athleteMessageDraft ?? "",
    // NB: "Привет!" is now the legitimate name-less greeting, so it's no longer a
    // leakage marker — the distinctive stored-draft junk below still pins leakage.
    /Комментарий:|можно дать|103\.58|206\.93/,
    "methodology daily_analysis must render polished combined lines without stored review draft leakage"
  );
  assert.equal(methodologyCombined.warnings.length, 0, "methodology daily_analysis must not warn about missing canonical facts");

  const actualNutritionIssueReview = buildReview();
  actualNutritionIssueReview.nutritionSummary = {
    ...asObject(actualNutritionIssueReview.nutritionSummary),
    daily_analysis: [
      {
        date: "2026-06-01",
        weekday_ru: "Понедельник",
        date_label: "01.06",
        training_type: "rest",
        training_label: "день отдыха",
        actual_kcal: 1800,
        protein_g: 90,
        fat_g: 60,
        carbs_g: 0,
        nutrition_status: "adequate",
        findings: [],
        source_quality: { confidence: "low", hasNutritionData: false, hasTrainingContext: false, notes: ["missing_nutrition_data"] },
      },
    ],
  };
  const actualNutritionIssueCombined = buildDerivedNutritionCombinedMessage({
    review: actualNutritionIssueReview,
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.match(
    actualNutritionIssueCombined.athleteMessageDraft ?? "",
    /Данные по питанию за день неполные/,
    "actual nutrition data issue may render incomplete-data caution"
  );

  const coachDayByDay = buildDerivedNutritionCoachDayByDayText(methodologyReview);
  assert.ok(coachDayByDay, "coach day-by-day must render from methodology daily_analysis");
  assert.doesNotMatch(coachDayByDay ?? "", /Комментарий:|можно дать|указать факт/, "coach day-by-day must not leak stored hint text");

  const needsReview = buildDerivedNutritionCombinedMessage({
    review: buildReview("needs_review"),
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(needsReview.status, "needs_review", "needs_review source should keep warning state");

  const missingReview = buildDerivedNutritionCombinedMessage({
    review: null,
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(missingReview.status, "missing_review");
  assert.equal(missingReview.athleteMessageDraft, null);
  assert.equal(missingReview.renderResult.ok, false);

  const missingPlan = buildDerivedNutritionCombinedMessage({
    review,
    plan: null,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(missingPlan.status, "missing_plan");
  assert.equal(missingPlan.athleteMessageDraft, null);
  assert.equal(missingPlan.renderResult.ok, false);

  const blockedByReview = buildDerivedNutritionCombinedMessage({
    review: {
      ...review,
      status: "blocked_safety",
      safetyFlags: { hard_flags: ["very_low_kcal_repeated"], blocked: true },
    },
    plan,
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(blockedByReview.status, "blocked_safety");
  assert.equal(blockedByReview.athleteMessageDraft, null);

  const blockedByPlan = buildDerivedNutritionCombinedMessage({
    review,
    plan: buildPlan({
      status: "blocked_safety",
      draft: null,
    }),
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(blockedByPlan.status, "blocked_safety");
  assert.equal(blockedByPlan.athleteMessageDraft, null);

  const noCanonicalPlan = buildDerivedNutritionCombinedMessage({
    review,
    plan: buildPlan({ includeNextWeekPlan: false }),
    formality: "ty",
    studentName: "Анна",
  });
  assert.equal(noCanonicalPlan.status, "ready");
  assert.ok(
    noCanonicalPlan.warnings.some((warning) => /нет canonical next_week_plan/i.test(warning)),
    "missing next_week_plan must produce warning"
  );

  assert.match(repoSource, /resolveNutritionWeeklyPlanForDisplay/, "repository must resolve latest display plan");
  assert.match(repoSource, /resolveSupersedingNutritionWeeklyPlan/, "repository must keep superseded resolution");
  assert.equal(typeof resolveNutritionWeeklyPlanForDisplay, "function", "display plan resolver must remain callable");

  assert.doesNotMatch(helperSource, /sendTelegram|sendMessage|telegram\.send/i, "combined helper must not send Telegram");
  assert.doesNotMatch(
    helperSource,
    /moveWorkout|mutateTrainingPeaks|updateWorkout|executeMove/i,
    "combined helper must not mutate TrainingPeaks"
  );
  assert.doesNotMatch(helperSource, /create table|nutrition_weekly_messages|migration/i, "combined helper must not introduce DB migration/table");

  const draftGenerator = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
  assert.match(draftGenerator, /athlete_report_signals/, "review generator must persist athlete report signals");
  assert.doesNotMatch(helperSource, /coach_context_ru/, "combined athlete message must not expose coach context field");
  assert.doesNotMatch(helperSource, /interpretation_shadow/, "production combined message must not switch to shadow interpretation");
  assert.match(pageSource, /buildDerivedNutritionCombinedMessage/, "UI copy block must remain derived composer primary");

  console.log("PASS check-nutrition-combined-message");
}

void run();
