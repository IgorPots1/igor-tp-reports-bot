import assert from "node:assert/strict";

import { extractNutritionRowsFromFatSecretPdfText } from "@/features/nutrition/file-intake";

function parseSyntheticPdfText(text: string) {
  return extractNutritionRowsFromFatSecretPdfText({
    text,
    sourceFileName: "synthetic-fatsecret-pdf.txt",
  });
}

function run(): void {
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
