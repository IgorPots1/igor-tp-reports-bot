import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const draftGenerator = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
assert.match(draftGenerator, /day_by_day_training_aware_analysis/, "weekly generator must include day-by-day methodology guardrail");
assert.match(draftGenerator, /no_hallucinated_workouts_or_gels/, "weekly generator must ban workout/fueling hallucinations");
assert.match(draftGenerator, /carb_reference_not_prescriptive/, "weekly generator must keep carb band non-prescriptive");
assert.match(draftGenerator, /small_step_progression_if_low_carbs/, "weekly generator must enforce gradual progression");
assert.match(draftGenerator, /no_english/, "weekly generator must enforce russian-only draft");
assert.match(draftGenerator, /one_focus/, "weekly generator output must contain one_focus");
assert.match(draftGenerator, /daily_analysis/, "weekly generator output must contain daily_analysis");
assert.match(draftGenerator, /training_nutrition_links/, "weekly generator output must contain training_nutrition_links");

const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
assert.match(studentPage, /Сводка для тренера/, "UI should render coach summary section");
assert.match(studentPage, /Важные дни/, "UI should render important days section");
assert.match(studentPage, /Связки тренировка ↔ питание/, "UI should render training links section");
assert.match(studentPage, /<details>/, "UI should collapse technical JSON");
assert.doesNotMatch(studentPage, /JSON\.stringify\(card\.weeklyAnalysis\.nutritionSummary,\s*null,\s*2\)/, "raw JSON cannot be primary UI");

console.log("PASS check-nutrition-weekly-review-quality");
