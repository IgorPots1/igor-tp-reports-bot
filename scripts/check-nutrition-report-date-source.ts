import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildNutritionDailyFactsForNarrative } from "../src/features/nutrition/draft-generator";
import { extractNutritionRowsFromFatSecretPdfText } from "../src/features/nutrition/file-intake";
import type { NutritionStudentContext } from "../src/features/nutrition/context";
import {
  buildNutritionReportDateQualityMetadata,
  compareNutritionReportDateRanges,
  computeNutritionParsedDateCoverageFromRows,
  formatNutritionReportDateMismatchNotice,
  getCalendarWeekContaining,
  resolveNutritionEffectiveReportWeek,
  snapParsedDatesToCalendarWeek,
} from "../src/features/nutrition/report-date-coverage";

const root = process.cwd();
const adminSource = readFileSync(join(root, "src/features/nutrition/admin.ts"), "utf8");
const actionsSource = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const polyakovaWeekText = [
  "понедельник, июня 2, 2026",
  "Всего 1419 47,69 3,694 164,02 6,7 23,45 80,11 231,1 8 283",
  "вторник, июня 3, 2026",
  "Всего 1384 42,18 3,895 168,72 7 9,24 81,13 1315,15 257,15 1211",
  "среда, июня 4, 2026",
  "Всего 1605 44,17 9,094 149,75 7,3 12,6 99 1499 148 1019",
  "четверг, июня 5, 2026",
  "Всего 1740 61,12 5,239 199,1 9,06 7,16 96,06 388 170 267",
  "пятница, июня 6, 2026",
  "Всего 1956 57,98 2,121 135,26 2,12 43,84 86,27 228,8 131,8 339",
  "суббота, июня 7, 2026",
  "Всего 1763 84,68 12,052 151,92 6,98 47,38 97,11 1966 532 995",
].join("\n");

const parsedPolyakova = extractNutritionRowsFromFatSecretPdfText({
  text: polyakovaWeekText,
  sourceFileName: "polyakova-fatsecret.pdf",
});

assert.equal(parsedPolyakova.parsedWeekFrom, "2026-06-02", "Polyakova PDF must parse week from 2026-06-02");
assert.equal(parsedPolyakova.parsedWeekTo, "2026-06-07", "Polyakova PDF must parse week to 2026-06-07");
assert.equal(parsedPolyakova.extractedRows.length, 6, "Polyakova PDF must parse six daily rows");

const uiMismatch = compareNutritionReportDateRanges({
  uiWeekFrom: "2026-06-08",
  uiWeekTo: "2026-06-14",
  parsedWeekFrom: "2026-06-02",
  parsedWeekTo: "2026-06-07",
});
assert.equal(uiMismatch.mismatch, true, "UI 08..14 vs parsed 02..07 must mismatch");
assert.equal(uiMismatch.overlapDays, 0, "UI 08..14 vs parsed 02..07 must have zero overlap");

// Layer A snapping: effective report week snaps to the FULL calendar week (пн–вс)
// containing the parsed days. Parsed 06-02..06-07 (Tue–Sun) → week 06-01..06-07.
const effectiveMismatch = resolveNutritionEffectiveReportWeek({
  uiWeekFrom: "2026-06-08",
  uiWeekTo: "2026-06-14",
  parsedWeekFrom: "2026-06-02",
  parsedWeekTo: "2026-06-07",
  parsedDates: ["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"],
});
assert.equal(effectiveMismatch.effectiveWeekFrom, "2026-06-01", "snap weekFrom back to Monday");
assert.equal(effectiveMismatch.effectiveWeekTo, "2026-06-07", "snap weekTo to Sunday");
assert.equal(effectiveMismatch.dateRangeSource, "parsed_pdf");

// The mismatch notice shows the RAW parsed PDF range (what the file contained),
// NOT the snapped report week — coach clarity.
const mismatchNotice = formatNutritionReportDateMismatchNotice({
  uiWeekFrom: "2026-06-08",
  uiWeekTo: "2026-06-14",
  parsedWeekFrom: "2026-06-02",
  parsedWeekTo: "2026-06-07",
  dateRangeSource: effectiveMismatch.dateRangeSource,
  mismatch: uiMismatch.mismatch,
});
assert.ok(mismatchNotice?.includes("02.06—07.06"), "notice must mention RAW parsed dates");
assert.ok(mismatchNotice?.includes("08.06—14.06"), "notice must mention UI dates");

const uiPartialOverlap = compareNutritionReportDateRanges({
  uiWeekFrom: "2026-06-01",
  uiWeekTo: "2026-06-07",
  parsedWeekFrom: "2026-06-02",
  parsedWeekTo: "2026-06-07",
});
assert.equal(uiPartialOverlap.overlapDays, 6, "UI 01..07 vs parsed 02..07 must overlap six days");
assert.equal(uiPartialOverlap.mismatch, false, "UI 01..07 vs parsed 02..07 should not be treated as hard mismatch");

const effectivePartial = resolveNutritionEffectiveReportWeek({
  uiWeekFrom: "2026-06-01",
  uiWeekTo: "2026-06-07",
  parsedWeekFrom: "2026-06-02",
  parsedWeekTo: "2026-06-07",
  parsedDates: ["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"],
});
assert.equal(effectivePartial.effectiveWeekFrom, "2026-06-01", "snap weekFrom back to Monday");
assert.equal(effectivePartial.effectiveWeekTo, "2026-06-07", "snap weekTo to Sunday");

const noParsedDates = resolveNutritionEffectiveReportWeek({
  uiWeekFrom: "2026-06-08",
  uiWeekTo: "2026-06-14",
  parsedWeekFrom: null,
  parsedWeekTo: null,
});
assert.equal(noParsedDates.effectiveWeekFrom, "2026-06-08");
assert.equal(noParsedDates.effectiveWeekTo, "2026-06-14");
assert.equal(noParsedDates.dateRangeSource, "ui_fallback");

// --- Layer A snapping unit cases (Туркина fix / Трофимова byte-identical / стык) ---
// Туркина: partial 4-day PDF (Mon–Thu 08-11) → full week 08-14 (fixes the plan-window
// slide; was 08-11 → план 12-18 instead of 15-21).
assert.deepEqual(
  snapParsedDatesToCalendarWeek(["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"]),
  { weekFrom: "2026-06-08", weekTo: "2026-06-14" },
  "Туркина: 4-дневный PDF 08-11 → полная неделя 08-14"
);
// Трофимова: full Mon–Sun PDF (08-14) → unchanged (byte-identical).
assert.deepEqual(
  snapParsedDatesToCalendarWeek([
    "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14",
  ]),
  { weekFrom: "2026-06-08", weekTo: "2026-06-14" },
  "Трофимова: полный пн–вс PDF не меняется"
);
// Edge: PDF straddling two weeks → dominant week by majority of days.
assert.deepEqual(
  snapParsedDatesToCalendarWeek(["2026-06-13", "2026-06-15", "2026-06-16", "2026-06-17"]),
  { weekFrom: "2026-06-15", weekTo: "2026-06-21" },
  "стык: большинство дней (3 из 4) в неделе 15-21 → она и выбирается"
);
// Edge: straddle tie → earliest week.
assert.deepEqual(
  snapParsedDatesToCalendarWeek(["2026-06-13", "2026-06-14", "2026-06-15", "2026-06-16"]),
  { weekFrom: "2026-06-08", weekTo: "2026-06-14" },
  "стык-ничья (2/2) → ранняя неделя"
);
// Empty → null (no parsed dates).
assert.equal(snapParsedDatesToCalendarWeek([]), null, "нет дат → null");
// getCalendarWeekContaining: Monday-anchored.
assert.deepEqual(getCalendarWeekContaining("2026-06-19"), { weekFrom: "2026-06-15", weekTo: "2026-06-21" });
assert.deepEqual(getCalendarWeekContaining("2026-06-08"), { weekFrom: "2026-06-08", weekTo: "2026-06-14" });

const metadata = buildNutritionReportDateQualityMetadata({
  uiWeekFrom: "2026-06-08",
  uiWeekTo: "2026-06-14",
  parsedCoverage: computeNutritionParsedDateCoverageFromRows(parsedPolyakova.extractedRows, {
    uiWeekFrom: "2026-06-08",
    uiWeekTo: "2026-06-14",
    source: "pdf_rows",
  }),
});
assert.equal(metadata.date_range_source, "parsed_pdf");
assert.equal(metadata.date_range_mismatch, true);
assert.equal(metadata.parsed_week_from, "2026-06-02");
assert.equal(metadata.parsed_week_to, "2026-06-07");

function buildMinimalContext(weekFrom: string, weekTo: string, macroDates: string[]): NutritionStudentContext {
  const manualMacroRows = macroDates.map((day) => ({
    day,
    weekday: null,
    kcal: 1800,
    proteinG: 90,
    fatG: 60,
    carbsG: 200,
    confidence: 1,
    notes: null,
  }));
  return {
    studentName: "Test Athlete",
    studentSlug: "test-athlete",
    studentUuid: "student-uuid",
    resolvedCommunicationProfile: {
      formality: "ty",
      source: "unknown",
      preferredGreeting: null,
      tone: "neutral",
      conflictFlags: [],
    },
    communicationProfilePromptLines: [],
    telegramContextNotes: null,
    coachMemoryItems: [],
    nutritionContextItems: [],
    weightLogs: [],
    currentWeightKg: 60,
    nutritionGoal: null,
    coachContextRu: null,
    athleteReportSignals: [],
    manualMacroRows,
    dataQuality: {
      parsedDays: manualMacroRows.length,
      lowConfidenceDays: 0,
      hasResolvedDates: true,
      qualityFlags: [],
    },
    reportStatus: "ready_for_analysis",
    tpPastWeek: {
      periodFrom: weekFrom,
      periodTo: weekTo,
      cacheStatus: "ok",
      workouts: [{ date: "2026-06-09", title: "Run", status: "completed", type: "easy" }],
      notes: [],
    },
    tpNextWeek: {
      periodFrom: "2026-06-15",
      periodTo: "2026-06-21",
      cacheStatus: "ok",
      workouts: [],
      notes: [],
    },
  };
}

const mismatchFacts = buildNutritionDailyFactsForNarrative({
  context: buildMinimalContext("2026-06-08", "2026-06-14", ["2026-06-02", "2026-06-03"]),
  dailyAnalysis: [
    { date: "2026-06-02", trainingType: "rest", nutritionStatus: "rest_ok", kcal: 1800 },
    { date: "2026-06-03", trainingType: "rest", nutritionStatus: "rest_ok", kcal: 1750 },
  ],
});
assert.ok(
  mismatchFacts.every((day) => {
    const sourceQuality = day.source_quality as Record<string, unknown>;
    const notes = Array.isArray(sourceQuality.notes) ? sourceQuality.notes : [];
    return notes.includes("date_range_mismatch_detected");
  }),
  "macros outside selected week must carry date_range_mismatch_detected"
);

const legitRestFacts = buildNutritionDailyFactsForNarrative({
  context: buildMinimalContext("2026-06-02", "2026-06-07", ["2026-06-02", "2026-06-03"]),
  dailyAnalysis: [
    { date: "2026-06-02", trainingType: "rest", nutritionStatus: "rest_ok", kcal: 1800 },
    { date: "2026-06-03", trainingType: "rest", nutritionStatus: "rest_ok", kcal: 1750 },
  ],
});
assert.ok(
  legitRestFacts.every((day) => {
    const sourceQuality = day.source_quality as Record<string, unknown>;
    const notes = Array.isArray(sourceQuality.notes) ? sourceQuality.notes : [];
    return !notes.includes("date_range_mismatch_detected");
  }),
  "legitimate overlapping rest week must not emit date mismatch warning"
);

assert.match(adminSource, /resolveNutritionEffectiveReportWeek/, "admin save must resolve effective week from parsed dates");
assert.match(adminSource, /buildNutritionReportDateQualityMetadata/, "admin save must persist date quality metadata");
assert.match(adminSource, /weekFrom: effectiveWeek\.effectiveWeekFrom/, "admin save must persist parsed effective week");
assert.match(actionsSource, /weekFrom: result\.effectiveWeekFrom/, "save action redirect must use effective week");
assert.match(actionsSource, /result\.dateMismatchNotice/, "save action must surface parsed/UI mismatch notice");
assert.match(packageJson, /check:nutrition-report-date-source/, "package.json must include date source check");
assert.match(packageJson, /diagnose:nutrition-report-date-coverage/, "package.json must include date coverage diagnostic");

console.log("PASS check-nutrition-report-date-source");
