import { createHash } from "node:crypto";

import { normalizeManualMacroInput, type NormalizedManualMacroRow } from "@/features/nutrition/context";
import { extractPdfTextFromBuffer, type PdfTextExtractionErrorCode } from "@/features/nutrition/pdf-extraction";
import { createSupabaseServerClient } from "@/features/supabase/server";

type SupportedNutritionFileKind = "pdf" | "csv" | "txt" | "screenshot" | "unknown";

export type NutritionUploadedFileMeta = {
  originalFileName: string;
  normalizedFileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  storageBucket: string | null;
  storagePath: string | null;
  fileKind: SupportedNutritionFileKind;
  extractionWarnings?: string[];
  extractionErrorCode?: string | null;
  extractionMethod?: string | null;
  extractionPageCount?: number | null;
};

export type ExtractedNutritionDay = {
  date: string | null;
  weekday?: string | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  confidence: number;
  sourceFileName?: string;
  notes?: string;
};

export type NutritionFileExtractionResult = {
  extractedRows: NormalizedManualMacroRow[];
  extractedDays: ExtractedNutritionDay[];
  unsupportedFiles: Array<{ fileName: string; reason: string }>;
  extractionWarnings: string[];
};

export type IntakeNutritionReportFilesResult = {
  fileMetas: NutritionUploadedFileMeta[];
  extraction: NutritionFileExtractionResult;
  sourceType: "manual_text" | "screenshot" | "pdf" | "csv" | "mixed";
};

const MAX_FILE_COUNT = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES_TO_PARSE = 1_000_000;
const DEFAULT_BUCKET = "nutrition-report-files";

const ALLOWED_EXTENSIONS = new Set(["pdf", "csv", "txt", "jpg", "jpeg", "png", "webp", "heic"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function isImageExtension(extension: string): boolean {
  return extension === "jpg" || extension === "jpeg" || extension === "png" || extension === "webp" || extension === "heic";
}

function normalizeFileName(fileName: string): string {
  const stripped = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stripped.slice(0, 120) || "file";
}

function getExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match?.[1]?.toLowerCase() ?? "";
}

function inferFileKind(extension: string): SupportedNutritionFileKind {
  if (extension === "pdf") {
    return "pdf";
  }
  if (extension === "csv") {
    return "csv";
  }
  if (extension === "txt") {
    return "txt";
  }
  if (isImageExtension(extension)) {
    return "screenshot";
  }
  return "unknown";
}

function buildStoragePath(input: {
  studentId: string;
  reportId: string;
  normalizedFileName: string;
  hashPrefix: string;
}): string {
  return `nutrition/${input.studentId}/${input.reportId}/${input.hashPrefix}-${input.normalizedFileName}`;
}

function parseLooseIsoDate(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dotted = normalized.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/);
  if (dotted) {
    const year = dotted[3] ?? new Date().getUTCFullYear().toString();
    const month = dotted[2].padStart(2, "0");
    const day = dotted[1].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseNumberCell(value: string): number | null {
  const normalized = value.replace(",", ".").replace(/[^0-9.\-]/g, "").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type FatSecretPdfDayCandidate = {
  day: string | null;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  confidence: number;
  notes?: string;
};

function isoFromDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

function parseDateFromFatSecretLine(line: string): string | null {
  const directIso = line.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (directIso) {
    return isoFromDateParts(Number(directIso[1]), Number(directIso[2]), Number(directIso[3]));
  }

  const dotted = line.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (dotted) {
    return isoFromDateParts(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
  }

  const monthRu = line.match(
    /\b(\d{1,2})\s+(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])(?:\s+(20\d{2}))?\b/i
  );
  if (monthRu) {
    const m = monthRu[2].toLocaleLowerCase("ru");
    const monthMap: Record<string, number> = {
      января: 1,
      январь: 1,
      февраля: 2,
      февраль: 2,
      марта: 3,
      март: 3,
      апреля: 4,
      апрель: 4,
      мая: 5,
      май: 5,
      июня: 6,
      июнь: 6,
      июля: 7,
      июль: 7,
      августа: 8,
      август: 8,
      сентября: 9,
      сентябрь: 9,
      октября: 10,
      октябрь: 10,
      ноября: 11,
      ноябрь: 11,
      декабря: 12,
      декабрь: 12,
    };
    const month = monthMap[m] ?? null;
    if (!month) {
      return null;
    }
    const year = monthRu[3] ? Number(monthRu[3]) : new Date().getUTCFullYear();
    return isoFromDateParts(year, month, Number(monthRu[1]));
  }

  const weekdayDotted = line.match(
    /\b(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|пн|понедельник|вт|вторник|ср|среда|чт|четверг|пт|пятница|сб|суббота|вс|воскресенье)\b[^0-9]{0,10}(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?/i
  );
  if (weekdayDotted) {
    const year = weekdayDotted[3] ? Number(weekdayDotted[3]) : new Date().getUTCFullYear();
    return isoFromDateParts(year, Number(weekdayDotted[2]), Number(weekdayDotted[1]));
  }

  return null;
}

function parseMacroValue(input: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (!match) {
      continue;
    }
    const parsed = parseNumberCell(match[1] ?? "");
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function parseFatSecretPdfLines(text: string): FatSecretPdfDayCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: FatSecretPdfDayCandidate[] = [];

  for (const line of lines) {
    const day = parseDateFromFatSecretLine(line);
    const lowered = line.toLocaleLowerCase("ru");
    const kcal = parseMacroValue(lowered, [
      /(?:ккал|калори[ия]|calories|kcal)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:ккал|calories|kcal)\b/i,
    ]);
    const proteinG = parseMacroValue(lowered, [
      /(?:белк(?:и|а|ов)?|белок|protein)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:г|g)\s*(?:белк(?:и|а|ов)?|protein)\b/i,
    ]);
    const fatG = parseMacroValue(lowered, [
      /(?:жир(?:ы|а|ов)?|fat)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:г|g)\s*(?:жир(?:ы|а|ов)?|fat)\b/i,
    ]);
    const carbsG = parseMacroValue(lowered, [
      /(?:углевод(?:ы|ов)?|carb(?:s|ohydrate)?s?)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:г|g)\s*(?:углевод(?:ы|ов)?|carb(?:s|ohydrate)?s?)\b/i,
    ]);

    const macroCount = [kcal, proteinG, fatG, carbsG].filter((value) => value !== null).length;
    if (!day && macroCount === 0) {
      continue;
    }

    const confidence = Math.max(0.1, Math.min(0.98, 0.35 + (day ? 0.4 : 0) + macroCount * 0.15));
    const notes: string[] = [];
    if (!day) {
      notes.push("date_missing");
    }
    if (macroCount < 4) {
      notes.push("partial_macros");
    }
    candidates.push({
      day,
      kcal,
      proteinG,
      fatG,
      carbsG,
      confidence,
      notes: notes.length > 0 ? notes.join(", ") : undefined,
    });
  }
  return candidates;
}

export function extractNutritionRowsFromFatSecretPdfText(input: {
  text: string;
  sourceFileName?: string;
}): {
  extractedRows: NormalizedManualMacroRow[];
  extractedDays: ExtractedNutritionDay[];
  warnings: string[];
} {
  const parsed = parseFatSecretPdfLines(input.text);
  if (parsed.length === 0) {
    return { extractedRows: [], extractedDays: [], warnings: [] };
  }
  return convertFatSecretPdfCandidates(parsed, input.sourceFileName ?? "pdf_text");
}

type DeduplicatePdfRowsResult = {
  rows: NormalizedManualMacroRow[];
  warnings: string[];
};

function deduplicatePdfRowsByDay(inputRows: NormalizedManualMacroRow[]): DeduplicatePdfRowsResult {
  const unresolvedRows: NormalizedManualMacroRow[] = [];
  const bestByDay = new Map<string, NormalizedManualMacroRow>();
  const duplicateDays = new Set<string>();

  for (const row of inputRows) {
    if (row.day.startsWith("unresolved:")) {
      unresolvedRows.push(row);
      continue;
    }
    const previous = bestByDay.get(row.day);
    if (!previous) {
      bestByDay.set(row.day, row);
      continue;
    }
    duplicateDays.add(row.day);
    if (row.confidence > previous.confidence) {
      bestByDay.set(row.day, row);
    }
  }

  const rows = [...bestByDay.values(), ...unresolvedRows].sort((a, b) => a.day.localeCompare(b.day));
  const warnings = [...duplicateDays].map(
    (day) => `duplicate_date:${day}: сохранена строка с наибольшей уверенностью`
  );
  return { rows, warnings };
}

function mapPdfExtractionErrorReason(errorCode: PdfTextExtractionErrorCode | null): string {
  switch (errorCode) {
    case "password_protected":
      return "pdf_password_protected";
    case "invalid_pdf":
      return "pdf_invalid_or_corrupted";
    case "no_text_content":
      return "pdf_no_text_content";
    case "parse_failed":
      return "pdf_parse_failed";
    default:
      return "pdf_parse_failed";
  }
}

function convertFatSecretPdfCandidates(
  candidates: FatSecretPdfDayCandidate[],
  sourceFileName: string
): { extractedRows: NormalizedManualMacroRow[]; extractedDays: ExtractedNutritionDay[]; warnings: string[] } {
  const baseRows: NormalizedManualMacroRow[] = candidates.map((candidate, index) => ({
    day: candidate.day ?? `unresolved:${index + 1}`,
    weekday: null,
    kcal: candidate.kcal,
    proteinG: candidate.proteinG,
    fatG: candidate.fatG,
    carbsG: candidate.carbsG,
    confidence: candidate.confidence,
    notes: candidate.notes ?? null,
  }));
  const deduplicated = deduplicatePdfRowsByDay(baseRows);
  const extractedDays: ExtractedNutritionDay[] = deduplicated.rows.map((row) => ({
    date: row.day.startsWith("unresolved:") ? null : row.day,
    weekday: row.weekday,
    kcal: row.kcal,
    protein_g: row.proteinG,
    fat_g: row.fatG,
    carbs_g: row.carbsG,
    confidence: row.confidence,
    sourceFileName,
    notes: row.notes ?? undefined,
  }));
  return { extractedRows: deduplicated.rows, extractedDays, warnings: deduplicated.warnings };
}

function deduplicateRowsAcrossUpload(input: {
  rows: NormalizedManualMacroRow[];
  days: ExtractedNutritionDay[];
}): {
  rows: NormalizedManualMacroRow[];
  days: ExtractedNutritionDay[];
  warnings: string[];
} {
  const unresolvedRows: Array<{ row: NormalizedManualMacroRow; day: ExtractedNutritionDay }> = [];
  const resolvedByDay = new Map<string, { row: NormalizedManualMacroRow; day: ExtractedNutritionDay }>();
  const duplicateDays = new Set<string>();

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const day = input.days[index];
    if (!row || !day) {
      continue;
    }
    if (row.day.startsWith("unresolved:")) {
      unresolvedRows.push({ row, day });
      continue;
    }
    const existing = resolvedByDay.get(row.day);
    if (!existing) {
      resolvedByDay.set(row.day, { row, day });
      continue;
    }
    duplicateDays.add(row.day);
    if (row.confidence > existing.row.confidence) {
      resolvedByDay.set(row.day, { row, day });
    }
  }

  const mergedPairs = [...resolvedByDay.values(), ...unresolvedRows].sort((a, b) =>
    a.row.day.localeCompare(b.row.day)
  );
  return {
    rows: mergedPairs.map((pair) => pair.row),
    days: mergedPairs.map((pair) => pair.day),
    warnings: [...duplicateDays].map(
      (day) => `duplicate_date:${day}: сохранена строка с наибольшей уверенностью среди загруженных файлов`
    ),
  };
}

function parseCsvRows(rawText: string): ExtractedNutritionDay[] {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delimiter).map((cell) => cell.trim().toLowerCase());
  const dateIdx = header.findIndex((cell) => /^(date|day|дата|день)$/.test(cell));
  const kcalIdx = header.findIndex((cell) => /(kcal|calories|кал|ккал)/.test(cell));
  const proteinIdx = header.findIndex((cell) => /(protein|бел|б)/.test(cell));
  const fatIdx = header.findIndex((cell) => /(^fat$|жир|ж\b|^f$)/.test(cell));
  const carbsIdx = header.findIndex((cell) => /(carb|углев|угл|^c$|carbohydrate)/.test(cell));
  if (dateIdx < 0 && kcalIdx < 0 && proteinIdx < 0 && fatIdx < 0 && carbsIdx < 0) {
    return [];
  }

  const result: ExtractedNutritionDay[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter).map((cell) => cell.trim());
    if (cells.length === 0) {
      continue;
    }
    const date = dateIdx >= 0 ? parseLooseIsoDate(cells[dateIdx] ?? "") : null;
    const kcal = kcalIdx >= 0 ? parseNumberCell(cells[kcalIdx] ?? "") : null;
    const protein = proteinIdx >= 0 ? parseNumberCell(cells[proteinIdx] ?? "") : null;
    const fat = fatIdx >= 0 ? parseNumberCell(cells[fatIdx] ?? "") : null;
    const carbs = carbsIdx >= 0 ? parseNumberCell(cells[carbsIdx] ?? "") : null;
    const macroCount = [kcal, protein, fat, carbs].filter((value) => value !== null).length;
    if (!date && macroCount === 0) {
      continue;
    }
    result.push({
      date,
      kcal,
      protein_g: protein,
      fat_g: fat,
      carbs_g: carbs,
      confidence: date ? 0.92 : 0.55,
      notes: date ? undefined : "date_missing",
    });
  }
  return result;
}

function toManualRows(days: ExtractedNutritionDay[]): NormalizedManualMacroRow[] {
  return days.map((day, index) => ({
    day: day.date ?? `unresolved:${index + 1}`,
    weekday: day.weekday ?? null,
    kcal: day.kcal,
    proteinG: day.protein_g,
    fatG: day.fat_g,
    carbsG: day.carbs_g,
    confidence: Math.max(0.1, Math.min(1, day.confidence)),
    notes: day.notes ?? null,
  }));
}

export function extractNutritionRowsFromTextInput(input: {
  text: string;
  fileKind: "txt" | "csv";
  weekFrom: string;
  sourceFileName?: string;
}): {
  extractedRows: NormalizedManualMacroRow[];
  extractedDays: ExtractedNutritionDay[];
} {
  const csvDays = input.fileKind === "csv" ? parseCsvRows(input.text) : [];
  const lineRows = normalizeManualMacroInput(input.text, input.weekFrom);
  const csvRows = toManualRows(csvDays);
  const merged = csvRows.length > 0 ? [...csvRows, ...lineRows] : lineRows;
  const extractedDays = merged.map((row) => ({
    date: row.day.startsWith("unresolved:") ? null : row.day,
    weekday: row.weekday,
    kcal: row.kcal,
    protein_g: row.proteinG,
    fat_g: row.fatG,
    carbs_g: row.carbsG,
    confidence: row.confidence,
    sourceFileName: input.sourceFileName,
    notes: row.notes ?? undefined,
  }));
  return { extractedRows: merged, extractedDays };
}

function resolveBucketName(): string {
  const bucket = process.env.NUTRITION_REPORT_STORAGE_BUCKET?.trim();
  return bucket || DEFAULT_BUCKET;
}

function resolveSourceType(fileKinds: SupportedNutritionFileKind[]): IntakeNutritionReportFilesResult["sourceType"] {
  const unique = [...new Set(fileKinds.filter((kind) => kind !== "unknown"))];
  if (unique.length === 0) {
    return "manual_text";
  }
  if (unique.length > 1) {
    return "mixed";
  }
  const single = unique[0];
  if (single === "pdf") {
    return "pdf";
  }
  if (single === "csv") {
    return "csv";
  }
  if (single === "screenshot") {
    return "screenshot";
  }
  return "mixed";
}

export async function intakeNutritionReportFiles(input: {
  studentId: string;
  reportId: string;
  weekFrom: string;
  files: File[];
  persistFiles?: boolean;
}): Promise<IntakeNutritionReportFilesResult> {
  if (input.files.length === 0) {
    return {
      fileMetas: [],
      extraction: { extractedRows: [], extractedDays: [], unsupportedFiles: [], extractionWarnings: [] },
      sourceType: "manual_text",
    };
  }

  if (input.files.length > MAX_FILE_COUNT) {
    throw new Error(`Слишком много файлов: максимум ${MAX_FILE_COUNT}.`);
  }

  const bucket = resolveBucketName();
  const persistFiles = input.persistFiles ?? true;
  const supabase = persistFiles ? createSupabaseServerClient() : null;
  const fileMetas: NutritionUploadedFileMeta[] = [];
  const extractedRows: NormalizedManualMacroRow[] = [];
  const extractedDays: ExtractedNutritionDay[] = [];
  const unsupportedFiles: Array<{ fileName: string; reason: string }> = [];
  const extractionWarnings: string[] = [];

  for (const file of input.files) {
    const extension = getExtension(file.name);
    const mimeType = file.type.toLowerCase();
    const normalizedFileName = normalizeFileName(file.name);

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error(`Неподдерживаемый тип файла: ${file.name}`);
    }
    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`Неподдерживаемый mime type: ${file.name}`);
    }
    if (file.size <= 0) {
      throw new Error(`Файл пустой: ${file.name}`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Файл слишком большой (${file.name}). Лимит: 10 MB.`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = buildStoragePath({
      studentId: input.studentId,
      reportId: input.reportId,
      normalizedFileName,
      hashPrefix: sha256.slice(0, 12),
    });
    if (persistFiles) {
      if (!supabase) {
        throw new Error("Supabase client is not initialized for file upload.");
      }
      const uploadResult = await supabase.storage.from(bucket).upload(storagePath, bytes, {
        upsert: false,
        contentType: mimeType || undefined,
      });
      if (uploadResult.error) {
        throw new Error(
          `Не удалось загрузить файл в Storage (${file.name}). Проверьте private bucket '${bucket}' и права service_role.`
        );
      }
    }

    const fileKind = inferFileKind(extension);
    fileMetas.push({
      originalFileName: file.name,
      normalizedFileName,
      mimeType: mimeType || "application/octet-stream",
      extension,
      sizeBytes: file.size,
      sha256,
      storageBucket: persistFiles ? bucket : null,
      storagePath: persistFiles ? storagePath : null,
      fileKind,
      extractionWarnings: [],
      extractionErrorCode: null,
      extractionMethod: null,
      extractionPageCount: null,
    });
    const metaRef = fileMetas[fileMetas.length - 1];

    if (fileKind === "txt" || fileKind === "csv") {
      const text = Buffer.from(bytes.slice(0, MAX_TEXT_BYTES_TO_PARSE)).toString("utf8");
      const extracted = extractNutritionRowsFromTextInput({
        text,
        fileKind,
        weekFrom: input.weekFrom,
        sourceFileName: file.name,
      });
      const merged = extracted.extractedRows;
      if (merged.length > 0) {
        extractedRows.push(...merged);
        extractedDays.push(...extracted.extractedDays);
      } else {
        unsupportedFiles.push({ fileName: file.name, reason: "text_parsed_but_no_macros_found" });
      }
      continue;
    }

    if (fileKind === "pdf") {
      const pdfExtraction = await extractPdfTextFromBuffer(bytes);
      metaRef.extractionMethod = pdfExtraction.extractionMethod;
      metaRef.extractionPageCount = pdfExtraction.pageCount;
      metaRef.extractionErrorCode = pdfExtraction.errorCode;
      if (pdfExtraction.warnings.length > 0) {
        metaRef.extractionWarnings = [...pdfExtraction.warnings];
        extractionWarnings.push(...pdfExtraction.warnings.map((warning) => `${file.name}: ${warning}`));
      }
      if (!pdfExtraction.ok) {
        unsupportedFiles.push({
          fileName: file.name,
          reason: mapPdfExtractionErrorReason(pdfExtraction.errorCode),
        });
        continue;
      }

      const converted = extractNutritionRowsFromFatSecretPdfText({
        text: pdfExtraction.text,
        sourceFileName: file.name,
      });
      if (converted.extractedRows.length === 0) {
        unsupportedFiles.push({
          fileName: file.name,
          reason: "pdf_text_parsed_but_no_macros_found",
        });
        const warning = `${file.name}: PDF прочитан как текст, но дневные КБЖУ не распознаны.`;
        metaRef.extractionWarnings = [...(metaRef.extractionWarnings ?? []), warning];
        extractionWarnings.push(warning);
        continue;
      }
      extractedRows.push(...converted.extractedRows);
      extractedDays.push(...converted.extractedDays);
      if (converted.warnings.length > 0) {
        metaRef.extractionWarnings = [...(metaRef.extractionWarnings ?? []), ...converted.warnings];
        extractionWarnings.push(...converted.warnings.map((warning) => `${file.name}: ${warning}`));
      }
      continue;
    }

    if (fileKind === "screenshot") {
      unsupportedFiles.push({
        fileName: file.name,
        reason: "ocr_not_enabled",
      });
      extractionWarnings.push(`${file.name}: OCR для скриншотов отключён, нужна ручная проверка.`);
      continue;
    }

    unsupportedFiles.push({ fileName: file.name, reason: "unsupported_file_kind" });
  }

  const dedupedMerged = deduplicateRowsAcrossUpload({
    rows: extractedRows,
    days: extractedDays,
  });
  if (dedupedMerged.warnings.length > 0) {
    extractionWarnings.push(...dedupedMerged.warnings);
  }

  return {
    fileMetas,
    extraction: {
      extractedRows: dedupedMerged.rows,
      extractedDays: dedupedMerged.days,
      unsupportedFiles,
      extractionWarnings,
    },
    sourceType: resolveSourceType(fileMetas.map((meta) => meta.fileKind)),
  };
}
