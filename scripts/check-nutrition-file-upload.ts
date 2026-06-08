import assert from "node:assert/strict";

import { intakeNutritionReportFiles } from "@/features/nutrition/file-intake";

function makeFile(content: string, name: string, type: string): File {
  return new File([content], name, { type });
}

async function run(): Promise<void> {
  const txt = makeFile("Пн 2200 ккал Б120 Ж70 У280", "fatsecret-week.txt", "text/plain");
  const csv = makeFile(
    "date,kcal,protein,fat,carbs\n2026-06-01,2100,118,66,270\n2026-06-02,2250,124,72,290",
    "fatsecret.csv",
    "text/csv"
  );

  const intake = await intakeNutritionReportFiles({
    studentId: "00000000-0000-0000-0000-000000000001",
    reportId: "00000000-0000-0000-0000-000000000002",
    weekFrom: "2026-06-01",
    files: [txt, csv],
    persistFiles: false,
  });

  assert.equal(intake.fileMetas.length, 2, "expected 2 file metadata entries");
  assert.equal(intake.fileMetas.every((item) => item.storagePath === null), true, "preview mode must not persist file paths");
  assert.equal(intake.fileMetas.every((item) => item.sha256.length === 64), true, "sha256 must be present");
  assert.equal(intake.sourceType, "mixed", "txt+csv should resolve to mixed source type");
  assert.ok(intake.extraction.extractedRows.length >= 2, "expected extracted rows from txt/csv");

  const duplicateCsvA = makeFile(
    "date,kcal,protein,fat,carbs\n2026-06-01,2100,118,66,270",
    "fatsecret-a.csv",
    "text/csv"
  );
  const duplicateCsvB = makeFile(
    "date,kcal,protein,fat,carbs\n2026-06-01,2300,130,74,300",
    "fatsecret-b.csv",
    "text/csv"
  );
  const duplicateIntake = await intakeNutritionReportFiles({
    studentId: "00000000-0000-0000-0000-000000000001",
    reportId: "00000000-0000-0000-0000-000000000003",
    weekFrom: "2026-06-01",
    files: [duplicateCsvA, duplicateCsvB],
    persistFiles: false,
  });
  assert.equal(
    duplicateIntake.extraction.extractedRows.filter((row) => row.day === "2026-06-01").length,
    1,
    "duplicate dates across files must be deduplicated"
  );
  assert.equal(
    duplicateIntake.extraction.extractionWarnings.some((warning) => warning.includes("duplicate_date:2026-06-01")),
    true,
    "duplicate warning must be reported"
  );

  console.log("PASS check-nutrition-file-upload");
}

void run();
