import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const adminSource = readFileSync(join(root, "src/features/nutrition/admin.ts"), "utf8");
assert.match(adminSource, /nutritionSummary:\s*\{[\s\S]*daily_analysis:\s*generated\.daily_analysis/, "weekly review must persist daily_analysis in nutrition_summary");
assert.match(adminSource, /training_nutrition_links:\s*generated\.training_nutrition_links/, "weekly review must persist training_nutrition_links in nutrition_summary");
assert.match(adminSource, /one_focus:\s*generated\.one_focus/, "weekly review must persist one_focus in nutrition_summary");
assert.match(adminSource, /methodology_signals:\s*generated\.methodology_signals/, "weekly review must persist methodology_signals in nutrition_summary");
assert.match(adminSource, /bodyweight_kg:\s*context\.currentWeightKg/, "weekly review must persist bodyweight_kg in nutrition_summary");
assert.match(adminSource, /carb_progression_strategy:\s*generated\.one_focus\.progression_strategy/, "weekly review must persist carb_progression_strategy");

const pageSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
assert.match(pageSource, /weeklyNutritionSummary\.daily_analysis/, "UI must read daily_analysis from saved nutritionSummary");
assert.match(pageSource, /weeklyNutritionSummary\.training_nutrition_links/, "UI must read training_nutrition_links from saved nutritionSummary");
assert.match(pageSource, /weeklyNutritionSummary\.one_focus/, "UI must read one_focus from saved nutritionSummary");
assert.match(pageSource, /weeklyNutritionSummary\.methodology_signals/, "UI must read methodology_signals from saved nutritionSummary");
assert.match(pageSource, /weeklyNutritionSummary\.bodyweight_kg/, "UI must read bodyweight_kg from saved nutritionSummary");
assert.match(pageSource, /weeklyNutritionSummary\.carb_progression_strategy/, "UI must read carb_progression_strategy from saved nutritionSummary");
assert.match(pageSource, /formatNutritionTpNextWeekContextLine/, "UI must show saved review TP next-week context on plan card");
assert.match(pageSource, /Вес не задан — расчёт г\/кг и белок достаточный недоступны\./, "UI must show missing weight guidance");
assert.match(pageSource, /<details>[\s\S]*Technical JSON/, "technical JSON should be collapsed");
assert.match(pageSource, /<details>[\s\S]*Safety JSON/, "safety JSON should be collapsed");

assert.match(adminSource, /weekFrom: effectiveWeekFrom/, "weekly review must persist report week, not UI week");
assert.match(adminSource, /weekFrom: effectiveWeek\.effectiveWeekFrom/, "file report save must persist parsed effective week");

const reportDateCoverageSource = readFileSync(join(root, "src/features/nutrition/report-date-coverage.ts"), "utf8");
assert.match(reportDateCoverageSource, /compareNutritionReportDateRanges/, "report date coverage must compare UI vs parsed week");
assert.match(reportDateCoverageSource, /resolveNutritionEffectiveReportWeek/, "report date coverage must resolve effective week");

const draftGeneratorSource = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
assert.match(draftGeneratorSource, /date_range_mismatch_detected/, "draft generator must flag macro/review week mismatch");
const contextSource = readFileSync(join(root, "src/features/nutrition/context.ts"), "utf8");
// Вес резолвится ТОЛЬКО единым хелпером (новейший лог на дату разбора -> профиль -> null).
// Копипаста порядка обратно в context.ts / weekly-plan-generator.ts — регресс: раньше их
// было три разных варианта в четырёх местах.
assert.match(
  contextSource,
  /const weightResolution = resolveNutritionWeight\(\{[\s\S]*asOfDate: input\.weekTo,/,
  "context must resolve weight via resolveNutritionWeight anchored to weekTo"
);
assert.match(contextSource, /currentWeightKg:\s*weightResolution\.weightKg/, "context weight must come from the resolver");
assert.doesNotMatch(
  contextSource,
  /currentWeightKg:\s*essentials\.profile\?\.currentWeightKg\s*\?\?/,
  "context must NOT fall back to the old profile-first weight order"
);
const planGeneratorSource = readFileSync(join(root, "src/features/nutrition/weekly-plan-generator.ts"), "utf8");
assert.match(
  planGeneratorSource,
  /const weightResolution = resolveNutritionWeight\(\{[\s\S]*asOfDate: input\.sourceAnalysis\.weekTo,/,
  "plan must resolve weight via resolveNutritionWeight anchored to the source review week"
);
assert.doesNotMatch(
  planGeneratorSource,
  /essentials\.profile\?\.currentWeightKg\s*\?\?\s*latestConfirmedWeight/,
  "plan must NOT keep its own copy of the old weight order"
);
const dashboardSource = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
assert.match(dashboardSource, /currentWeightKg: resolveNutritionWeight\(\{/, "dashboard list must show the resolved weight");

const methodologySource = readFileSync(join(root, "src/features/nutrition/methodology.ts"), "utf8");
assert.match(methodologySource, /isNutritionLongRunWorkout/, "methodology must classify long_run via shared helper");
assert.match(contextSource, /isNutritionLongRunWorkout/, "TP context must classify long_run via shared helper");
// Interval pattern detection (x/х/×/*) was refactored out of methodology.ts into
// shared helpers (context.ts / long-run.ts / weekly-plan-formulas.ts); methodology
// classifies intervals through them. Assert the pattern lives in the shared helper.
assert.match(contextSource, /\(\?:x\|х\|×\|\\\*\)/, "interval pattern x/х/×/* must be supported in the shared TP context helper");
assert.match(methodologySource, /canonicalDailyAnalysis/, "methodology must build canonicalDailyAnalysis facts");
assert.match(methodologySource, /weekdayRu/, "methodology canonical facts must include weekdayRu");
assert.match(methodologySource, /dateLabel/, "methodology canonical facts must include dateLabel");
assert.match(methodologySource, /hintForComment/, "methodology canonical facts must include hintForComment");
assert.match(methodologySource, /sourceQuality/, "methodology canonical facts must include sourceQuality");

console.log("PASS check-nutrition-methodology-wiring");
