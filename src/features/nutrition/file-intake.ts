import { createHash } from "node:crypto";

import { normalizeManualMacroInput, type NormalizedManualMacroRow } from "@/features/nutrition/context";
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
    });

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

    if (fileKind === "pdf" || fileKind === "screenshot") {
      unsupportedFiles.push({
        fileName: file.name,
        reason: "ocr_or_pdf_extraction_not_enabled",
      });
      extractionWarnings.push(`${file.name}: распознавание PDF/скриншотов пока недоступно, нужна ручная проверка.`);
      continue;
    }

    unsupportedFiles.push({ fileName: file.name, reason: "unsupported_file_kind" });
  }

  return {
    fileMetas,
    extraction: {
      extractedRows,
      extractedDays,
      unsupportedFiles,
      extractionWarnings,
    },
    sourceType: resolveSourceType(fileMetas.map((meta) => meta.fileKind)),
  };
}
