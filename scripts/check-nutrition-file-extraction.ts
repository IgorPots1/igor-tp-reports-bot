import assert from "node:assert/strict";

import { extractNutritionRowsFromTextInput } from "@/features/nutrition/file-intake";

function run(): void {
  const txtInput = [
    "Пн 2300 ккал Б 130 Ж 75 У 300",
    "Вт 2200 ккал белок 125 жиры 70 углеводы 280",
    "Ср 2100 ккал protein 120 fat 68 carbs 260",
  ].join("\n");
  const txtParsed = extractNutritionRowsFromTextInput({
    text: txtInput,
    fileKind: "txt",
    weekFrom: "2026-06-01",
    sourceFileName: "notes.txt",
  });
  assert.ok(txtParsed.extractedRows.length >= 3, "txt parser should produce rows");
  assert.equal(txtParsed.extractedRows.some((row) => row.day === "2026-06-01"), true, "must resolve weekday to iso day");

  const csvInput = [
    "date;kcal;protein;fat;carbs",
    "01.06.2026;2150;120;70;280",
    "02.06.2026;2250;128;74;290",
  ].join("\n");
  const csvParsed = extractNutritionRowsFromTextInput({
    text: csvInput,
    fileKind: "csv",
    weekFrom: "2026-06-01",
    sourceFileName: "fatsecret.csv",
  });
  assert.ok(csvParsed.extractedRows.length >= 2, "csv parser should produce rows");
  assert.equal(
    csvParsed.extractedRows.some((row) => row.day === "2026-06-01" && row.kcal === 2150),
    true,
    "csv parser should map date and kcal"
  );

  console.log("PASS check-nutrition-file-extraction");
}

run();
