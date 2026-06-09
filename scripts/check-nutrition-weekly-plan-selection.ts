import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const repository = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

assert.match(studentPage, /resolveNutritionWeeklyPlanForDisplay/, "student page must resolve plan display with superseded fallback");
assert.match(studentPage, /supersededPlanNotice/, "student page must show superseded plan notice");
assert.match(
  repository,
  /Вы открыли старую версию фокуса/,
  "superseded notice text must be defined in resolver"
);
assert.doesNotMatch(
  studentPage,
  /const displayPlan = selectedPlanById \?\? latestPlanForWeek/,
  "student page must not blindly prefer URL plan over latest"
);

assert.match(repository, /resolveNutritionWeeklyPlanForDisplay/, "repository must expose plan display resolver");
assert.match(repository, /resolveSupersedingNutritionWeeklyPlan/, "repository must walk superseded_by_plan_id chain");
assert.match(repository, /pickPreferredNutritionWeeklyPlan/, "repository must prefer active plans for latest fallback");
assert.match(
  repository,
  /isActiveNutritionWeeklyPlanStatus/,
  "repository must distinguish active vs superseded/archived plans"
);

assert.match(actions, /planId: plan\.id/, "generate action redirect must use newly generated plan id");

assert.match(packageJson, /check:nutrition-weekly-plan-selection/, "package.json must include selection check");
assert.match(packageJson, /diagnose:nutrition-weekly-plan-selection/, "package.json must include selection diagnostic");

console.log("PASS check-nutrition-weekly-plan-selection");
