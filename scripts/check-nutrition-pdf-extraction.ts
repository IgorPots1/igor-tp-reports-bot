import assert from "node:assert/strict";

import { extractNutritionRowsFromFatSecretPdfText } from "@/features/nutrition/file-intake";
import { calculateNutritionDataQuality, classifyNutritionReportStatus } from "@/features/nutrition/context";

function parseSyntheticPdfText(text: string) {
  return extractNutritionRowsFromFatSecretPdfText({
    text,
    sourceFileName: "synthetic-fatsecret-pdf.txt",
  });
}

function run(): void {
  const ruDetailedSplitAcrossPages = [
    "понедельник, июня 1, 2026",
    "Кал Жир Н/жир Углев Клетч Сахар Белк Натри Холес Калий",
    "Завтрак",
    "Всего 341 11,43 3,323 30,6 0,7 3,21 15,04 212 19 34",
    "Перекус/Другое",
    "Всего 499 17,38 3,382 50,71 5,7 31,79 36,61 50 0 224",
    "Страница 2",
    "понедельник, июня 1, 2026",
    "Всего 1617 44,97 9,837 176,7 11,11 36,29 112,97 621,1 111,1 811",
  ].join("\n");
  const case1 = parseSyntheticPdfText(ruDetailedSplitAcrossPages);
  assert.equal(case1.extractedRows.length, 1, "RU detailed split day should parse exactly one day total");
  assert.equal(case1.extractedRows[0]?.day, "2026-06-01", "RU detailed date should map to ISO");
  assert.equal(case1.extractedRows[0]?.kcal, 1617, "RU detailed day total kcal mismatch");
  assert.equal(case1.extractedRows[0]?.fatG, 44.97, "RU detailed day total fat mismatch");
  assert.equal(case1.extractedRows[0]?.carbsG, 176.7, "RU detailed day total carbs mismatch");
  assert.equal(case1.extractedRows[0]?.proteinG, 112.97, "RU detailed day total protein mismatch");
  assert.equal(case1.warnings.includes("fatsecret_ru_detailed_daily_totals_parsed"), true, "RU parser marker warning expected");

  const ruDetailedWeek = [
    "понедельник, июня 1, 2026",
    "Всего 1617 44,97 9,837 176,7 11,11 36,29 112,97 621,1 111,1 811",
    "вторник, июня 2, 2026",
    "Всего 1419 47,69 3,694 164,02 6,7 23,45 80,11 231,1 8 283",
    "среда, июня 3, 2026",
    "Всего 1384 42,18 3,895 168,72 7 9,24 81,13 1315,15 257,15 1211",
    "четверг, июня 4, 2026",
    "Всего 1605 44,17 9,094 149,75 7,3 12,6 99 1499 148 1019",
    "пятница, июня 5, 2026",
    "Всего 1740 61,12 5,239 199,1 9,06 7,16 96,06 388 170 267",
    "суббота, июня 6, 2026",
    "Всего 1956 57,98 2,121 135,26 2,12 43,84 86,27 228,8 131,8 339",
    "воскресенье, июня 7, 2026",
    "Всего 1763 84,68 12,052 151,92 6,98 47,38 97,11 1966 532 995",
  ].join("\n");
  const case2 = parseSyntheticPdfText(ruDetailedWeek);
  assert.equal(case2.extractedRows.length, 7, "RU detailed 7-day layout must produce 7 rows");
  const case2ByDate = new Map(case2.extractedRows.map((row) => [row.day, row]));
  assert.equal(case2ByDate.get("2026-06-01")?.kcal, 1617);
  assert.equal(case2ByDate.get("2026-06-02")?.fatG, 47.69);
  assert.equal(case2ByDate.get("2026-06-03")?.carbsG, 168.72);
  assert.equal(case2ByDate.get("2026-06-04")?.proteinG, 99);
  assert.equal(case2ByDate.get("2026-06-05")?.kcal, 1740);
  assert.equal(case2ByDate.get("2026-06-06")?.carbsG, 135.26);
  assert.equal(case2ByDate.get("2026-06-07")?.proteinG, 97.11);

  const quality = calculateNutritionDataQuality(case2.extractedRows);
  assert.equal(classifyNutritionReportStatus(quality), "ready_for_analysis", "7 resolved high-confidence rows must be ready");

  const periodSummaryOnly = [
    "Period Summary",
    "Cреднесуточная норма Кал Жир Углев Белк",
    "Всего 1641 54,68 163,64 93,24",
  ].join("\n");
  const case3 = parseSyntheticPdfText(periodSummaryOnly);
  assert.equal(case3.extractedRows.length, 0, "Period Summary must not become daily row");

  const mealOnly = [
    "понедельник, июня 1, 2026",
    "Завтрак",
    "Всего 341 11,43 3,323 30,6 0,7 3,21 15,04 212 19 34",
  ].join("\n");
  const case4 = parseSyntheticPdfText(mealOnly);
  assert.equal(case4.extractedRows.length, 0, "single meal total without final day marker must not become day row");

  const ruText = [
    "FatSecret Food Diary",
    "2026-06-01 Итого: ккал 2200 белки 130 г жиры 70 г углеводы 280 г",
    "02.06.2026 Daily Total калории 2150 белок 125 жир 68 углеводы 270",
  ].join("\n");
  const ruRows = parseSyntheticPdfText(ruText);
  assert.ok(ruRows.extractedRows.length >= 2, "RU synthetic lines must parse");

  const enText = [
    "FatSecret Foods",
    "Jun 3, 2026 Daily Total calories 2300 protein 140g fat 75g carbs 300g",
    "Wed 04.06.2026 Total kcal 2250 protein 132 fat 72 carbs 290",
  ].join("\n");
  const enRows = parseSyntheticPdfText(enText);
  assert.ok(enRows.extractedRows.length >= 2, "EN synthetic lines must parse");

  const decimalText = "2026-06-05 Daily Total kcal 2100 protein 120,5 fat 65.5 carbs 260,5";
  const decimalRows = parseSyntheticPdfText(decimalText);
  assert.equal(decimalRows.extractedRows.length >= 1, true, "decimal comma and dot must parse");

  const ambiguousDateText = "Daily Total ккал 2000 белки 120 жиры 60 углеводы 250";
  const ambiguousRows = parseSyntheticPdfText(ambiguousDateText);
  assert.equal(ambiguousRows.extractedRows.length >= 1, true, "missing date should keep unresolved row");
  assert.equal(ambiguousRows.extractedRows[0]?.day.startsWith("unresolved:"), true, "must keep unresolved day marker");
  assert.equal(ambiguousRows.extractedRows[0]?.notes?.includes("date_missing"), true, "date missing warning expected");

  const duplicateDateText = [
    "2026-06-06 Daily Total ккал 2200 белки 130 жиры 70 углеводы 280",
    "2026-06-06 Daily Total ккал 1800 белки 90 жиры 50 углеводы 200",
  ].join("\n");
  const duplicateRows = parseSyntheticPdfText(duplicateDateText);
  assert.equal(duplicateRows.extractedRows.length, 1, "duplicate date must keep one row");
  assert.equal(
    duplicateRows.warnings.some((warning) => warning.includes("duplicate_date:2026-06-06")),
    true,
    "duplicate warning expected"
  );
  assert.equal(
    duplicateRows.warnings.includes("duplicate_day_totals"),
    true,
    "duplicate day totals warning expected"
  );

  const foodRowsWithoutDailyTotalText = [
    "FatSecret Food Diary",
    "Jun 1, 2026 Breakfast Oatmeal 250 calories protein 12 fat 7 carbs 38",
    "Jun 1, 2026 Lunch Chicken 450 calories protein 40 fat 12 carbs 20",
  ].join("\n");
  const foodRowsWithoutDailyTotal = parseSyntheticPdfText(foodRowsWithoutDailyTotalText);
  assert.equal(foodRowsWithoutDailyTotal.extractedRows.length, 0, "food rows without daily total must not produce day rows");
  assert.equal(
    foodRowsWithoutDailyTotal.warnings.includes("daily_totals_not_found"),
    true,
    "must warn on missing daily totals"
  );
  assert.equal(
    foodRowsWithoutDailyTotal.warnings.includes("parsed_food_rows_but_no_day_totals"),
    true,
    "must warn when only food rows were found"
  );

  const emptyPdfText = "";
  const emptyParsed = parseSyntheticPdfText(emptyPdfText);
  assert.equal(emptyParsed.extractedRows.length, 0, "empty text should produce no rows");
  assert.equal(
    emptyParsed.warnings.includes("fatsecret_layout_not_recognized"),
    true,
    "empty text should expose layout warning"
  );

  const tabularText = [
    "Date Calories Fat Carbs Protein",
    "01.06.2026 2200 70 280 130",
    "02.06.2026 2100 68 265 124",
  ].join("\n");
  const tabularRows = parseSyntheticPdfText(tabularText);
  assert.equal(tabularRows.extractedRows.length >= 2, true, "tabular daily summary should parse");
  assert.equal(
    tabularRows.extractedRows.some((row) => row.kcal === 2200 && row.proteinG === 130),
    true,
    "tabular mapping should keep macro columns"
  );

  const unrealisticValuesText = "2026-06-07 Daily Total kcal 50 protein 2 fat 1 carbs 5";
  const unrealisticRows = parseSyntheticPdfText(unrealisticValuesText);
  assert.equal(unrealisticRows.extractedRows.length, 1, "parser still extracts explicit totals");
  assert.equal(unrealisticRows.extractedRows[0]?.kcal, 50, "explicit values should be preserved for downstream quality checks");

  const noMacrosText = "просто случайный текст без нужных кбжу";
  const noMacrosRows = parseSyntheticPdfText(noMacrosText);
  assert.equal(noMacrosRows.extractedRows.length, 0, "non-parseable content must fail safely");

  console.log("PASS check-nutrition-pdf-extraction");
}

run();
