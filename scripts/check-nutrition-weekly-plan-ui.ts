import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatNutritionGenerationMode,
  formatNutritionPlanTrainingContextLine,
  formatNutritionStatus,
  NUTRITION_WEEKLY_PLAN_STATUS_LABELS,
} from "../src/features/nutrition/admin-labels";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const mainUi = studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack"));

assert.match(studentPage, /resolveNutritionWeeklyPlanForDisplay/, "student page must resolve plan display");
assert.match(studentPage, /plansForWeek/, "student page must list plans for week");
assert.match(studentPage, /planIdFromQuery/, "student page must read planId search param");
assert.match(studentPage, /calculateNutritionPlanWeek/, "student page must compute plan week from review");

assert.match(mainUi, /name="sourceReportId"/, "plan form must pass sourceReportId from selected review");
assert.match(
  mainUi,
  /Выбранный отчёт отличается от отчёта, по которому создан обзор/,
  "plan card must explain report/review mismatch without blocking"
);
assert.match(mainUi, /formatNutritionTpNextWeekContextLine/, "plan card must show saved review TP next-week context when no plan");
assert.match(
  mainUi,
  /formatNutritionPlanTrainingContextLine/,
  "plan card must show generated plan TP context from training snapshot"
);
assert.match(mainUi, /Черновик ученику — фокус на следующую неделю/, "plan card must distinguish plan draft heading");
assert.match(mainUi, /Черновик ученику — полный текст/, "main UI must expose combined copy block title");
assert.match(mainUi, /Основной текст для отправки/, "combined block must be labeled as primary copy source");
assert.match(mainUi, /buildDerivedNutritionCombinedMessage/, "main UI must derive combined copy from review and plan");
assert.match(mainUi, /displayPlan/, "main UI combined block must use resolved display plan");

const reviewDraftStart = mainUi.indexOf("Исходный черновик обзора — служебно");
const planCardStart = mainUi.indexOf("Фокус питания на следующую неделю");
const combinedDraftStart = mainUi.indexOf("Черновик ученику — полный текст");
assert.ok(reviewDraftStart >= 0, "main UI must include secondary review draft heading");
assert.match(mainUi, /используйте блок «полный текст» выше/, "secondary review draft must warn against athlete copy");
assert.ok(planCardStart >= 0, "main UI must include weekly plan card title");
assert.ok(combinedDraftStart >= 0, "main UI must include combined draft heading");
assert.ok(
  combinedDraftStart < reviewDraftStart,
  "combined draft should appear above separate review/plan drafts"
);

assert.match(actions, /planId: plan\.id/, "generate action must redirect to newly generated plan id");
assert.match(actions, /getOptionalFormValue\(formData,\s*"sourceReportId"\)/, "plan action must read sourceReportId");
assert.doesNotMatch(
  actions,
  /sourceReportId:\s*reportId/,
  "plan action must not pass URL reportId as sourceReportId"
);
assert.match(mainUi, /generateNutritionWeeklyPlanAction/, "main UI must use generateNutritionWeeklyPlanAction");
assert.match(mainUi, /NutritionDraftCopyBlock/, "main UI must use NutritionDraftCopyBlock for plan draft");
assert.match(mainUi, /Сгенерировать фокус/, "main UI must include generate focus button");
assert.match(mainUi, /Сначала сгенерируйте разбор прошлой недели/, "main UI must show empty state without review");

assert.match(mainUi, /formatNutritionStatus\([^,]+,\s*"weekly_plan"\)/, "main UI must use weekly_plan status labels");
assert.match(mainUi, /formatNutritionGenerationMode/, "main UI must format generation mode labels");

assert.match(studentPage, /summary>Все сохранённые фокусы питания</, "advanced must include full plan history");
assert.match(studentPage, /summary>Technical JSON — nutrition weekly plan</, "advanced must include collapsed plan technical JSON");

assert.doesNotMatch(mainUi, /generateAndSaveNutritionWeeklyPlan/, "page must not call generator directly");
assert.doesNotMatch(mainUi, /telegram|sendMessage|sendTelegram/i, "main UI must not reference Telegram send");
assert.doesNotMatch(mainUi, /mutateTrainingPeaks|updateWorkout|moveWorkout/i, "main UI must not reference TP mutation");
assert.doesNotMatch(studentPage, /generateNutritionWeeklyPlanAction\(\)/, "page must not auto-generate on load");

assert.match(
  mainUi,
  /!card\.weeklyAnalysis[\s\S]*Сначала сгенерируйте разбор прошлой недели/,
  "generate UI must be gated on selected review"
);

const planCardEnd = mainUi.indexOf("Исходный черновик обзора — служебно");
const planCardUi =
  planCardStart >= 0 && planCardEnd > planCardStart ? mainUi.slice(planCardStart, planCardEnd) : mainUi;
assert.doesNotMatch(planCardUi, /plan_summary|generation_mode/, "plan card must not expose raw plan field names");
assert.doesNotMatch(planCardUi, />\s*draft_generated\s*</, "plan card must not show raw draft_generated label");
assert.doesNotMatch(planCardUi, />\s*blocked_safety\s*</, "plan card must not show raw blocked_safety label");

assert.equal(formatNutritionStatus("draft_generated", "weekly_plan"), NUTRITION_WEEKLY_PLAN_STATUS_LABELS.draft_generated);
assert.equal(formatNutritionStatus("blocked_safety", "weekly_plan"), "заблокировано безопасностью");
assert.equal(formatNutritionGenerationMode("ai"), "AI");
assert.equal(formatNutritionGenerationMode("fallback"), "шаблон");

const refreshedPlanLine = formatNutritionPlanTrainingContextLine({
  status: "available",
  workoutCount: 4,
  keyWorkouts: [{ date: "2026-06-10", title: "6 х 6 мин", type: "intervals" }],
  diff: {
    changed: true,
    source_review_workouts_count: 0,
    fresh_workouts_count: 4,
    source_review_key_workouts_count: 0,
    fresh_key_workouts_count: 1,
  },
});
assert.match(refreshedPlanLine, /TrainingPeaks: 4 тренировки · ключевые: 1/);
assert.match(refreshedPlanLine, /TP-контекст обновлён перед генерацией: было 0, стало 4/);

assert.match(packageJson, /check:nutrition-weekly-plan-ui/, "package.json must include weekly plan UI check");

assert.doesNotMatch(actions, /telegram|sendMessage|sendTelegram/i, "nutrition actions must not import Telegram send paths");

console.log("PASS check-nutrition-weekly-plan-ui");
