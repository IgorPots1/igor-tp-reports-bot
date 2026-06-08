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
    "2026-06-01 ккал 2200 белки 130 г жиры 70 г углеводы 280 г",
    "02.06.2026 калории 2150 белок 125 жир 68 углеводы 270",
  ].join("\n");
  const ruRows = parseSyntheticPdfText(ruText);
  assert.ok(ruRows.extractedRows.length >= 2, "RU synthetic lines must parse");

  const enText = [
    "2026-06-03 calories 2300 protein 140g fat 75g carbs 300g",
    "Wed 04.06.2026 kcal 2250 protein 132 fat 72 carbs 290",
  ].join("\n");
  const enRows = parseSyntheticPdfText(enText);
  assert.ok(enRows.extractedRows.length >= 2, "EN synthetic lines must parse");

  const decimalText = "2026-06-05 kcal 2100 protein 120,5 fat 65.5 carbs 260,5";
  const decimalRows = parseSyntheticPdfText(decimalText);
  assert.equal(decimalRows.extractedRows.length >= 1, true, "decimal comma and dot must parse");

  const ambiguousDateText = "ккал 2000 белки 120 жиры 60 углеводы 250";
  const ambiguousRows = parseSyntheticPdfText(ambiguousDateText);
  assert.equal(ambiguousRows.extractedRows.length >= 1, true, "missing date should keep unresolved row");
  assert.equal(ambiguousRows.extractedRows[0]?.day.startsWith("unresolved:"), true, "must keep unresolved day marker");
  assert.equal(ambiguousRows.extractedRows[0]?.notes?.includes("date_missing"), true, "date missing warning expected");

  const duplicateDateText = [
    "2026-06-06 ккал 2200 белки 130 жиры 70 углеводы 280",
    "2026-06-06 ккал 1800 белки 90 жиры 50 углеводы 200",
  ].join("\n");
  const duplicateRows = parseSyntheticPdfText(duplicateDateText);
  assert.equal(duplicateRows.extractedRows.length, 1, "duplicate date must keep one row");
  assert.equal(
    duplicateRows.warnings.some((warning) => warning.includes("duplicate_date:2026-06-06")),
    true,
    "duplicate warning expected"
  );

  const noMacrosText = "просто случайный текст без нужных кбжу";
  const noMacrosRows = parseSyntheticPdfText(noMacrosText);
  assert.equal(noMacrosRows.extractedRows.length, 0, "non-parseable content must fail safely");

  console.log("PASS check-nutrition-pdf-extraction");
}

run();
