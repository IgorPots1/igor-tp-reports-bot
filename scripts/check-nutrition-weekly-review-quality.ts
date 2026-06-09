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
assert.match(draftGenerator, /bodyweight_kg/, "weekly generator output must contain bodyweight_kg");
assert.match(draftGenerator, /carb_progression_strategy/, "weekly generator output must contain carb_progression_strategy");
assert.match(draftGenerator, /coach_summary_text/, "weekly generator must include coach_summary_text");
assert.match(draftGenerator, /day_by_day_analysis_text/, "weekly generator must include day_by_day_analysis_text");
assert.match(draftGenerator, /generation_mode/, "weekly generator must include generation_mode");
assert.match(draftGenerator, /prompt_version/, "weekly generator must include prompt_version");
assert.match(draftGenerator, /generateNutritionWeeklyReviewNarrative/, "weekly generator must include AI narrative layer");
assert.match(draftGenerator, /nutrition-weekly-review-v2-ai/, "weekly generator must use v2 prompt version");
assert.match(draftGenerator, /Return strict JSON only/, "AI prompt must require strict JSON output");
assert.match(draftGenerator, /no strict g\/kg target/i, "AI prompt must ban strict g/kg targets for athlete text");
assert.doesNotMatch(draftGenerator, /Главный фокус недели — главный фокус/i, "generator should avoid duplicated focus template");
assert.doesNotMatch(draftGenerator, /день самой работы/i, "generator should avoid robotic phrase 'день самой работы'");

const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
assert.match(studentPage, /Главный вывод для тренера/, "UI should render coach summary section");
assert.match(studentPage, /Разбор по дням/, "UI should render day-by-day section");
assert.match(studentPage, /Связки тренировка ↔ питание/, "UI should render training links section");
assert.match(studentPage, /<details>/, "UI should collapse technical JSON");
assert.match(studentPage, /Вес не задан — расчёт г\/кг и белок достаточный недоступны\./, "UI should explain missing weight");
assert.match(studentPage, /Safety JSON/, "UI should keep raw safety JSON collapsed");
assert.doesNotMatch(studentPage, /JSON\.stringify\(card\.weeklyAnalysis\.nutritionSummary,\s*null,\s*2\)/, "raw JSON cannot be primary UI");
assert.match(studentPage, /Сгенерировано шаблоном, лучше проверить текст вручную\./, "UI should warn when fallback text is shown");
assert.match(studentPage, /Черновик для ученика/, "UI should keep athlete draft first");
assert.match(studentPage, /Метрики недели/, "UI should keep metrics section");

console.log("PASS check-nutrition-weekly-review-quality");
