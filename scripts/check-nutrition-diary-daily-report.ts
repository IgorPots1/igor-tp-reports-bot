import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { calculateNutritionDataQuality, classifyNutritionReportStatus } from "@/features/nutrition/context";
import {
  extractNutritionRowsFromFatSecretPdfText,
  parseRussianDailyReportDiaryPdf,
} from "@/features/nutrition/file-intake";
import { extractPdfTextFromBuffer } from "@/features/nutrition/pdf-extraction";

// Второй формат дневника («Отчет за 28 сентября 2026», колонки Ккал | Б | Ж | У).
// Фикстура — реальная выгрузка, на которой отчёты падали в insufficient с 28.09.2026.
const FIXTURE = join(process.cwd(), "scripts/fixtures/nutrition/diary-ru-daily-report-2026-09-28.pdf");
const FIXTURE_SHA256 = "b65a3e517bc62c9305664b8bc2fac5d9e68e0ddce41fee82fd6d4173728012b8";

// Эталон: числа из строки «Итого» дневника питания каждого дня и число позиций.
const EXPECTED_DAYS = [
  { day: "2026-09-28", kcal: 1932, proteinG: 120.1, fatG: 79.0, carbsG: 184.5, items: 20, weightKg: 74.0 },
  { day: "2026-09-29", kcal: 1760, proteinG: 106.8, fatG: 45.8, carbsG: 246.8, items: 20, weightKg: 73.9 },
  { day: "2026-09-30", kcal: 1507, proteinG: 101.1, fatG: 34.4, carbsG: 216.5, items: 9, weightKg: 73.9 },
  { day: "2026-10-01", kcal: 1003, proteinG: 68.0, fatG: 39.1, carbsG: 104.1, items: 7, weightKg: 73.9 },
  { day: "2026-10-02", kcal: 1773, proteinG: 91.8, fatG: 100.0, carbsG: 114.5, items: 8, weightKg: 73.9 },
  { day: "2026-10-03", kcal: 1648, proteinG: 113.8, fatG: 58.1, carbsG: 164.0, items: 14, weightKg: 73.9 },
  { day: "2026-10-04", kcal: 1229, proteinG: 84.3, fatG: 44.8, carbsG: 121.0, items: 7, weightKg: 73.8 },
];

// Контрольные позиции: порядок Б-Ж-У в этом формате, не Ж-У-Б как у FatSecret.
const EXPECTED_ITEMS = [
  { day: "2026-09-28", name: "Онигири со снежным крабом и", kcal: 220, carbsG: 28.0, proteinG: 4.5, fatG: 9.5 },
  { day: "2026-09-29", name: "Набор Суши Шок", kcal: 412, carbsG: 70.0, proteinG: 12.0, fatG: 10.0 },
  { day: "2026-10-02", name: "Яичница с Сыром, Колбасой,", kcal: 548, carbsG: 5.2, proteinG: 28.6, fatG: 39.0 },
  { day: "2026-10-04", name: "Макароны с тушёнкой", kcal: 403, carbsG: 37.11, proteinG: 25.21, fatG: 17.06 },
];

async function run(): Promise<void> {
  const bytes = readFileSync(FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_SHA256, "fixture PDF changed");

  // Боевой путь целиком: тот же pdfjs-извлекатель, что в intakeNutritionReportFiles.
  const pdf = await extractPdfTextFromBuffer(new Uint8Array(bytes));
  assert.equal(pdf.ok, true, "PDF text extraction failed");
  assert.equal(pdf.pageCount, 14);

  const extracted = extractNutritionRowsFromFatSecretPdfText({ text: pdf.text, sourceFileName: "fixture.pdf" });
  assert.equal(extracted.extractedRows.length, 7, `expected exactly 7 days, got ${extracted.extractedRows.length}`);
  assert.deepEqual(
    extracted.extractedRows.map((row) => row.day),
    EXPECTED_DAYS.map((expected) => expected.day),
    "parsed day set mismatch"
  );
  for (const warning of ["daily_totals_not_found", "parsed_food_rows_but_no_day_totals", "fatsecret_layout_not_recognized"]) {
    assert.equal(extracted.warnings.includes(warning), false, `unexpected warning ${warning}`);
  }
  assert.equal(extracted.warnings.includes("diary_ru_daily_report_parsed"), true, "format marker warning expected");
  assert.equal(extracted.diagnostics.parsedRows, 7);
  // Окно ровное: пн 28.09 – вс 04.10, без хвоста с прошлой недели.
  assert.equal(extracted.parsedWeekFrom, "2026-09-28");
  assert.equal(extracted.parsedWeekTo, "2026-10-04");
  assert.deepEqual(extracted.dateCoverage.missingDatesInRange, []);

  const byDay = new Map(extracted.extractedRows.map((row) => [row.day, row]));
  for (const expected of EXPECTED_DAYS) {
    const row = byDay.get(expected.day);
    assert.ok(row, `day ${expected.day} missing`);
    assert.equal(row.kcal, expected.kcal, `${expected.day} kcal`);
    assert.equal(row.proteinG, expected.proteinG, `${expected.day} protein`);
    assert.equal(row.fatG, expected.fatG, `${expected.day} fat`);
    assert.equal(row.carbsG, expected.carbsG, `${expected.day} carbs`);
    assert.equal(row.items?.length ?? 0, expected.items, `${expected.day} item count`);
    for (const item of row.items ?? []) {
      assert.equal(item.source, "diary_pdf_ru_daily_report", `${expected.day} item source`);
      assert.ok(item.section, `${expected.day} item without meal section: ${item.name}`);
    }
  }

  for (const expected of EXPECTED_ITEMS) {
    const item = byDay.get(expected.day)?.items?.find((candidate) => candidate.name === expected.name);
    assert.ok(item, `control item «${expected.name}» on ${expected.day} not found`);
    assert.equal(item.kcal, expected.kcal, `«${expected.name}» kcal`);
    assert.equal(item.carbsG, expected.carbsG, `«${expected.name}» carbs`);
    assert.equal(item.proteinG, expected.proteinG, `«${expected.name}» protein`);
    assert.equal(item.fatG, expected.fatG, `«${expected.name}» fat`);
  }

  // Тот же отчёт больше не падает в insufficient: флагов качества нет, статус готов к разбору.
  const quality = calculateNutritionDataQuality(extracted.extractedRows);
  assert.deepEqual(quality.qualityFlags, []);
  assert.equal(quality.lowConfidenceDays, 0);
  assert.equal(classifyNutritionReportStatus(quality), "ready_for_analysis");

  // Строки «Активности» со временем не должны просочиться в еду.
  const allNames = extracted.extractedRows.flatMap((row) => row.items ?? []).map((item) => item.name);
  for (const activity of ["Шаги", "Приготовление еды (готовка)", "Вождение (езда на", "Прогулка с собакой"]) {
    assert.equal(allNames.includes(activity), false, `activity row parsed as food: ${activity}`);
  }

  const parsed = parseRussianDailyReportDiaryPdf(pdf.text);
  assert.ok(parsed);
  assert.deepEqual(
    parsed.days.map((day) => [day.day, day.currentWeightKg]),
    EXPECTED_DAYS.map((expected) => [expected.day, expected.weightKg]),
    "header weights mismatch"
  );

  // Layout-раскладка (колонки через 2+ пробела) читается так же, как pdfjs-склейка.
  const layoutText = [
    "Отчет за 28 сентября 2026",
    "Текущий вес     74,0",
    "Дневник питания",
    "Время приема    Порция    Калории    Белки(г)    Жиры(г)    Углеводы(г)",
    "ЗАВТРАК",
    "Банан                20:20     80 г        71      0,87       0,26         18,27",
    "Итого                          1932    120,1    79,0    184,5",
    "Суточная норма                 1750    140      54      175",
    "Активность",
    "Шаги                 20:23     421",
    "Итого                          421     0",
  ].join("\n");
  const layout = extractNutritionRowsFromFatSecretPdfText({ text: layoutText });
  assert.equal(layout.extractedRows.length, 1);
  assert.equal(layout.extractedRows[0]?.kcal, 1932);
  assert.equal(layout.extractedRows[0]?.proteinG, 120.1);
  assert.equal(layout.extractedRows[0]?.carbsG, 184.5);
  assert.deepEqual(
    layout.extractedRows[0]?.items?.map((item) => [item.name, item.kcal, item.proteinG, item.fatG, item.carbsG]),
    [["Банан", 71, 0.87, 0.26, 18.27]]
  );

  // День без строки «Итого» в дневнике не подменяется итогом «Активности».
  const noDiaryTotal = parseRussianDailyReportDiaryPdf(
    [
      "Отчет за 5 октября 2026",
      "Дневник питания",
      "Время приема Порция Калории Белки(г) Жиры(г) Углеводы(г)",
      "ЗАВТРАК",
      "Банан 20:20 80 г 71 0,87 0,26 18,27",
      "Активность",
      "Итого 421 0",
    ].join("\n")
  );
  assert.ok(noDiaryTotal);
  assert.equal(noDiaryTotal.days.length, 0);
  assert.deepEqual(noDiaryTotal.warnings, ["missing_daily_total_for_date:2026-10-05"]);

  // FatSecret-текст не опознаётся как новый формат — старый разбор остаётся как был.
  const fatSecret = ["понедельник, июня 1, 2026", "Всего 1617 44,97 9,837 176,7 11,11 36,29 112,97 621,1 111,1 811"].join("\n");
  assert.equal(parseRussianDailyReportDiaryPdf(fatSecret), null);
  const fatSecretExtracted = extractNutritionRowsFromFatSecretPdfText({ text: fatSecret });
  assert.equal(fatSecretExtracted.extractedRows[0]?.proteinG, 112.97);
  assert.equal(fatSecretExtracted.warnings.includes("fatsecret_ru_detailed_daily_totals_parsed"), true);

  console.log("check-nutrition-diary-daily-report: OK (7 days, 85 items, 4 control items)");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
