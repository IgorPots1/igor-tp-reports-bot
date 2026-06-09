import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatNutritionGenerationMode,
  formatNutritionStatus,
  NUTRITION_WEEKLY_PLAN_STATUS_LABELS,
} from "../src/features/nutrition/admin-labels";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const mainUi = studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack"));

assert.match(studentPage, /getNutritionWeeklyPlanById/, "student page must load plan by id");
assert.match(studentPage, /getLatestNutritionWeeklyPlanForStudentWeek/, "student page must load latest plan for week");
assert.match(studentPage, /listNutritionWeeklyPlansForStudentWeek/, "student page must list plans for week");
assert.match(studentPage, /planIdFromQuery/, "student page must read planId search param");
assert.match(studentPage, /calculateNutritionPlanWeek/, "student page must compute plan week from review");

assert.match(mainUi, /name="sourceReportId"/, "plan form must pass sourceReportId from selected review");
assert.match(
  mainUi,
  /Выбранный отчёт отличается от отчёта, по которому создан обзор/,
  "plan card must explain report/review mismatch without blocking"
);
assert.match(mainUi, /formatNutritionTpNextWeekContextLine/, "plan card must show saved review TP next-week context");
assert.match(mainUi, /Черновик ученику — фокус на следующую неделю/, "plan card must distinguish plan draft heading");

const reviewDraftStart = mainUi.indexOf("Черновик ученику — разбор прошлой недели");
const planCardStart = mainUi.indexOf("Фокус питания на следующую неделю");
assert.ok(reviewDraftStart >= 0, "main UI must include review draft heading");
assert.ok(planCardStart >= 0, "main UI must include weekly plan card title");

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

const planCardEnd = mainUi.indexOf("Черновик ученику — разбор прошлой недели");
const planCardUi =
  planCardStart >= 0 && planCardEnd > planCardStart ? mainUi.slice(planCardStart, planCardEnd) : mainUi;
assert.doesNotMatch(planCardUi, /plan_summary|generation_mode/, "plan card must not expose raw plan field names");
assert.doesNotMatch(planCardUi, />\s*draft_generated\s*</, "plan card must not show raw draft_generated label");
assert.doesNotMatch(planCardUi, />\s*blocked_safety\s*</, "plan card must not show raw blocked_safety label");

assert.equal(formatNutritionStatus("draft_generated", "weekly_plan"), NUTRITION_WEEKLY_PLAN_STATUS_LABELS.draft_generated);
assert.equal(formatNutritionStatus("blocked_safety", "weekly_plan"), "заблокировано безопасностью");
assert.equal(formatNutritionGenerationMode("ai"), "AI");
assert.equal(formatNutritionGenerationMode("fallback"), "шаблон");

assert.match(packageJson, /check:nutrition-weekly-plan-ui/, "package.json must include weekly plan UI check");

assert.doesNotMatch(actions, /telegram|sendMessage|sendTelegram/i, "nutrition actions must not import Telegram send paths");

console.log("PASS check-nutrition-weekly-plan-ui");
