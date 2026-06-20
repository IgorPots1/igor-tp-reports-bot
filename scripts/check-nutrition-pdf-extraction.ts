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

  // Bug B: a repeated PDF page header ("Food Diary Report …") must never be
  // collected as a food item. RU detailed day with chrome lines + a real food.
  const ruChrome = [
    "Food Diary Report - Detailed Report Пн, июня 8 - Вс, июня 14, 2026 foods.fatsecret.com",
    "Страница 2",
    "понедельник, июня 1, 2026",
    "Кал Жир Н/жир Углев Клетч Сахар Белк Натри Холес Калий",
    "Завтрак",
    "Гречка 166 1,12 0,241 35,89 4,9 1,62 6,08 7 0 158",
    "Всего 341 11,43 3,323 30,6 0,7 3,21 15,04 212 19 34",
    "Food Diary Report - Detailed Report Пн, июня 8 - Вс, июня 14, 2026 foods.fatsecret.com",
    "Перекус/Другое",
    "Всего 1617 44,97 9,837 176,7 11,11 36,29 112,97 621,1 111,1 811",
  ].join("\n");
  const ruChromeParsed = parseSyntheticPdfText(ruChrome);
  assert.equal(ruChromeParsed.extractedRows.length, 1, "RU detailed day with chrome lines still parses one day");
  const ruItems = ruChromeParsed.extractedRows[0]?.items ?? [];
  assert.ok(
    !ruItems.some((item) => /food diary report|fatsecret/i.test(item.name)),
    "PDF page header must NOT appear as a food item (Bug B)"
  );
  assert.ok(
    ruItems.some((item) => /гречка/i.test(item.name)),
    "real food items must still be collected"
  );

  // English FatSecret "Food Diary Report - Detailed Report" (надя_2.pdf). Same
  // column order as RU (Cals Fat Sat Carbs Fiber Sugar Prot ...), English markers.
  // Includes: top Period Summary (averages — must be excluded), page chrome,
  // Monday split across pages with per-meal Totals + a final day Total, and the
  // other 6 days as header + day Total. Day total = the LAST Total of the day.
  const enDetailedWeek = [
    "Food Diary Report - Detailed Report Mon, June 8 - Sun, June 14, 2026 foods.fatsecret.com",
    "Page 1",
    "Period Summary",
    "Daily Average Cals Fat Carbs Prot",
    "(kcal) (g) (g) (g)",
    "Breakfast 570 17.31 90.2 20.2",
    "Total 1678 51.95 232.3 84.7",
    "Food Diary Report - Detailed Report Mon, June 8 - Sun, June 14, 2026 foods.fatsecret.com",
    "Page 2",
    "Monday, June 8, 2026",
    "Cals Fat Sat Carbs Fiber Sugar Prot Sod Chol Potas",
    "(kcal) (g) (g) (g) (g) (g) (g) (mg) (mg) (mg)",
    "Breakfast",
    "Mushrooms 5 0.07 0.011 0.72 0.2 0.36 0.68 1 0 70",
    "22 g",
    "Total 523 15.57 4.48 74.83 9.22 12.65 28.25 815.55 45.93 878.43",
    "Lunch",
    "Cheese Pizza 248 10.57 4.504 27.3 1.7 3.2 11.1 483 22 145",
    "Total 548 13.11 4.656 79.04 5.36 39.71 32.06 559.36 33.47 918.75",
    "Food Diary Report - Detailed Report Mon, June 8 - Sun, June 14, 2026 foods.fatsecret.com",
    "Page 3",
    "Monday, June 8, 2026",
    "Cals Fat Sat Carbs Fiber Sugar Prot Sod Chol Potas",
    "Dinner",
    "Peanuts 60 5.25 0.867 1.53 0.9 0.42 2.8 32 0 73",
    "Total 521 19.46 7.11 44.24 5.5 10.76 40.74 215.8 82.79 955.02",
    "Snacks/Other",
    "Total 1592 48.14 16.246 198.11 20.08 63.12 101.05 1590.71 162.19 2752.2",
    "Tuesday, June 9, 2026",
    "Total 1492 43.47 14.029 192.65 20.16 76.9 92.57 1796.05 148.88 3362.26",
    "Wednesday, June 10, 2026",
    "Total 1245 54.07 19.846 149.61 16.4 78.03 51.85 2580 83 2031",
    "Thursday, June 11, 2026",
    "Total 1494 40.27 10.177 211.85 25.63 73.54 82.74 1442.19 169.9 2758.1",
    "Friday, June 12, 2026",
    "Total 1774 44.62 17.913 293.19 28.03 109.37 69.82 2363.54 73.64 2497.43",
    "Saturday, June 13, 2026",
    "Total 1883 66.77 23.314 227.73 16.3 77.67 104.11 2844.72 566.24 2406.88",
    "Sunday, June 14, 2026",
    "Total 2264 66.33 28.824 352.94 22.88 169.29 90.78 3506.85 162.02 3125.47",
  ].join("\n");
  const en = parseSyntheticPdfText(enDetailedWeek);
  assert.equal(en.extractedRows.length, 7, "EN detailed FatSecret must produce 7 day rows");
  const enByDate = new Map(en.extractedRows.map((row) => [row.day, row]));
  // Monday: day total (1592) wins over per-meal totals (523/548/521).
  const mon = enByDate.get("2026-06-08");
  assert.equal(mon?.kcal, 1592, "EN Monday kcal must be the day total, not a meal total");
  assert.equal(mon?.fatG, 48.14, "EN Monday fat");
  assert.equal(mon?.carbsG, 198.11, "EN Monday carbs");
  assert.equal(mon?.proteinG, 101.05, "EN Monday protein");
  assert.equal(enByDate.get("2026-06-09")?.kcal, 1492, "EN Tue kcal");
  assert.equal(enByDate.get("2026-06-09")?.proteinG, 92.57, "EN Tue protein");
  assert.equal(enByDate.get("2026-06-10")?.carbsG, 149.61, "EN Wed carbs");
  assert.equal(enByDate.get("2026-06-10")?.proteinG, 51.85, "EN Wed protein");
  assert.equal(enByDate.get("2026-06-11")?.carbsG, 211.85, "EN Thu carbs");
  assert.equal(enByDate.get("2026-06-12")?.kcal, 1774, "EN Fri kcal");
  assert.equal(enByDate.get("2026-06-12")?.carbsG, 293.19, "EN Fri carbs");
  assert.equal(enByDate.get("2026-06-13")?.proteinG, 104.11, "EN Sat protein");
  assert.equal(enByDate.get("2026-06-14")?.kcal, 2264, "EN Sun kcal");
  assert.equal(enByDate.get("2026-06-14")?.carbsG, 352.94, "EN Sun carbs");
  assert.equal(enByDate.get("2026-06-14")?.proteinG, 90.78, "EN Sun protein");
  // Period Summary averages (1678 / 84.7) must NOT become a day row.
  assert.equal(
    en.extractedRows.some((row) => row.kcal === 1678),
    false,
    "Period Summary average must not be parsed as a day"
  );
  assert.equal(en.parsedWeekFrom, "2026-06-08", "EN week start from Monday header");
  assert.equal(en.parsedWeekTo, "2026-06-14", "EN week end from Sunday header");

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
