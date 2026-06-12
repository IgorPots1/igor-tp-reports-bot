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
assert.match(contextSource, /currentWeightKg:\s*essentials\.profile\?\.currentWeightKg\s*\?\?\s*latestConfirmedWeight\s*\?\?\s*latestWeight\s*\?\?\s*null/, "weight resolution must include profile -> latest confirmed log -> latest log");

const methodologySource = readFileSync(join(root, "src/features/nutrition/methodology.ts"), "utf8");
assert.match(methodologySource, /forcedLongRunDate/, "methodology must force long-run date override");
assert.match(methodologySource, /(?:x\|х\|×\|\\\*)/, "methodology must support x/х/×/* interval patterns");
assert.match(methodologySource, /canonicalDailyAnalysis/, "methodology must build canonicalDailyAnalysis facts");
assert.match(methodologySource, /weekdayRu/, "methodology canonical facts must include weekdayRu");
assert.match(methodologySource, /dateLabel/, "methodology canonical facts must include dateLabel");
assert.match(methodologySource, /hintForComment/, "methodology canonical facts must include hintForComment");
assert.match(methodologySource, /sourceQuality/, "methodology canonical facts must include sourceQuality");

console.log("PASS check-nutrition-methodology-wiring");
