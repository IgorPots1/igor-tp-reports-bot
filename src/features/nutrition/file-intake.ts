import { createHash } from "node:crypto";

import {
  normalizeManualMacroInput,
  stripControlCharsForDb,
  type NormalizedManualMacroRow,
  type NutritionFoodItem,
  type NutritionMealSection,
} from "@/features/nutrition/context";
import {
  assertNutritionUploadFilesValid,
  MAX_NUTRITION_FILE_SIZE_BYTES,
} from "@/features/nutrition/file-upload-limits";
import { extractPdfTextFromBuffer, type PdfTextExtractionErrorCode } from "@/features/nutrition/pdf-extraction";
import {
  computeNutritionParsedDateCoverageFromRows,
  type NutritionParsedDateCoverage,
} from "@/features/nutrition/report-date-coverage";
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
  extractionTextLength?: number | null;
  extractionNormalizedTextLength?: number | null;
  extractionDiagnostics?: {
    hasKcalKeyword: boolean;
    hasProteinKeyword: boolean;
    hasFatKeyword: boolean;
    hasCarbsKeyword: boolean;
    dateMatches: number;
    parsedRows: number;
  } | null;
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
  dateCoverage: NutritionParsedDateCoverage;
};

export type IntakeNutritionReportFilesResult = {
  fileMetas: NutritionUploadedFileMeta[];
  extraction: NutritionFileExtractionResult;
  sourceType: "manual_text" | "screenshot" | "pdf" | "csv" | "mixed";
};

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
  source: "daily_total";
  items?: NutritionFoodItem[];
};

const FATSECRET_MEAL_SECTION_PATTERNS: Array<{ pattern: RegExp; section: NutritionMealSection }> = [
  { pattern: /^завтрак/i, section: "breakfast" },
  { pattern: /^обед/i, section: "lunch" },
  { pattern: /^ужин/i, section: "dinner" },
  { pattern: /^перекус/i, section: "snack" },
  { pattern: /^друго/i, section: "snack" },
  // English FatSecret ("Detailed Report") meal headers.
  { pattern: /^breakfast\b/i, section: "breakfast" },
  { pattern: /^lunch\b/i, section: "lunch" },
  { pattern: /^dinner\b/i, section: "dinner" },
  { pattern: /^snacks?\b/i, section: "snack" },
];

function resolveFatSecretMealSection(line: string): NutritionMealSection | null {
  const normalized = line.trim().toLocaleLowerCase("ru");
  for (const { pattern, section } of FATSECRET_MEAL_SECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return section;
    }
  }
  return null;
}

function isFatSecretTotalsLine(line: string): boolean {
  const normalized = line.trim().toLocaleLowerCase("ru");
  return (
    /^всего(?:\s|$)/.test(normalized) ||
    /^total(?:\s|$)/.test(normalized) ||
    /(period\s*summary|итого\s*за\s*период|за\s*период)/i.test(normalized)
  );
}

/**
 * Report chrome lines repeated on every PDF page (English FatSecret detailed
 * report): page header/footer, column headers, the top Period Summary block.
 * These must never be parsed as food items or day totals.
 */
function isFatSecretChromeLine(line: string): boolean {
  const normalized = line.trim().toLocaleLowerCase("en");
  return (
    /food diary report|fatsecret\.com/.test(normalized) ||
    /^page\s+\d+/.test(normalized) ||
    /^cals\s+fat\b/.test(normalized) ||
    /^\(kcal\)/.test(normalized) ||
    /^(period summary|daily average)/.test(normalized)
  );
}

/**
 * Map the numeric tokens of a FatSecret product row to macros.
 * Full RU layout exposes: ккал, жиры, нас.жиры, углеводы, ... , белки.
 * Compact layout is just kcal/fat/carbs/protein.
 */
function pickFoodMacros(values: number[]): {
  kcal: number | null;
  fatG: number | null;
  carbsG: number | null;
  proteinG: number | null;
} {
  if (values.length >= 7) {
    return {
      kcal: values[0] ?? null,
      fatG: values[1] ?? null,
      carbsG: values[3] ?? null,
      proteinG: values[6] ?? null,
    };
  }
  return {
    kcal: values[0] ?? null,
    fatG: values[1] ?? null,
    carbsG: values[2] ?? null,
    proteinG: values[3] ?? null,
  };
}

// Корявые слова (1a, only-safe): repair FatSecret glue artifacts in a parsed food
// name. A lost space before a capitalized word right after a short preposition
// ("Bbq сПенне" → "с Пенне", "сМолодым" → "с Молодым"). Deliberately narrow — only
// single prepositions before a Cyrillic capital — so brand CamelCase (ВкусВилл) and
// CAPS words are NOT touched (brand/quality cleanup is the model's job, per prompt).
// Also truncate the 120-char cap at a word boundary (no "Молодым Карт[офелем]" stub).
const NUTRITION_GLUED_PREPOSITION_RE = /(^|\s)(с|со|в|во|из|на|по|от|до|за|для|при|у|к|о|об)([А-ЯЁ])/gu;
function tidyParsedFoodName(raw: string): string {
  // Defense in depth: drop C0 control chars (NUL from broken PDF extraction) at
  // the parse source, so a dirty name never propagates into jsonb / prose / memory.
  const cleaned = stripControlCharsForDb(raw)
    .replace(/[.…]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(NUTRITION_GLUED_PREPOSITION_RE, "$1$2 $3")
    .trim();
  if (cleaned.length <= 120) {
    return cleaned;
  }
  const cut = cleaned.slice(0, 120);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim();
}

function parseFatSecretFoodItemLine(line: string, section: NutritionMealSection | null): NutritionFoodItem | null {
  if (isFatSecretTotalsLine(line) || resolveFatSecretMealSection(line)) {
    return null;
  }
  const firstNumberMatch = line.match(/-?\d+(?:[.,]\d+)?/);
  if (!firstNumberMatch || firstNumberMatch.index === undefined) {
    return null;
  }
  const name = tidyParsedFoodName(line.slice(0, firstNumberMatch.index));
  if (name.length < 2 || !/[a-zа-яё]/i.test(name)) {
    return null;
  }
  const numericTokens = line.slice(firstNumberMatch.index).match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  const values = numericTokens
    .map((token) => parseNumberCell(token))
    .filter((value): value is number => value !== null);
  if (values.length < 3) {
    return null;
  }
  const macros = pickFoodMacros(values);
  return {
    name,
    section,
    kcal: macros.kcal,
    fatG: macros.fatG,
    carbsG: macros.carbsG,
    proteinG: macros.proteinG,
    source: "fatsecret_pdf_ru_detailed",
  };
}

const RU_MONTHS_GENITIVE: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};

function parseRussianDetailedDateHeader(line: string): string | null {
  const normalized = line.trim().toLocaleLowerCase("ru");
  const match = normalized.match(
    /^(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\s*,\s*([а-яё]+)\s+(\d{1,2})\s*,\s*(20\d{2})$/i
  );
  if (!match) {
    return null;
  }
  const month = RU_MONTHS_GENITIVE[match[1] ?? ""] ?? null;
  if (!month) {
    return null;
  }
  return isoFromDateParts(Number(match[3]), month, Number(match[2]));
}

const EN_MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/**
 * English FatSecret detailed day header, e.g. "Monday, June 8, 2026".
 * Anchored so a food/page-chrome line that merely contains a date is not treated
 * as a day header. The page header ("Food Diary Report … Mon, June 8 - …") starts
 * with "Food" and is a range, so it does not match.
 */
function parseEnglishDetailedDateHeader(line: string): string | null {
  const normalized = line.trim();
  const match = normalized.match(
    /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*,\s*([a-z]+)\s+(\d{1,2})\s*,\s*(20\d{2})$/i
  );
  if (!match) {
    return null;
  }
  const month = EN_MONTHS[(match[1] ?? "").toLocaleLowerCase("en")] ?? null;
  if (!month) {
    return null;
  }
  return isoFromDateParts(Number(match[3]), month, Number(match[2]));
}

/** RU or EN FatSecret "detailed report" day header. */
function parseFatSecretDetailedDateHeader(line: string): string | null {
  return parseRussianDetailedDateHeader(line) ?? parseEnglishDetailedDateHeader(line);
}

function parseRussianFatSecretDetailedDailyTotals(text: string): {
  candidates: FatSecretPdfDayCandidate[];
  warnings: string[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentDate: string | null = null;
  let inDaySection = false;
  let currentDayLines: string[] = [];
  const warnings: string[] = [];
  const candidates: FatSecretPdfDayCandidate[] = [];

  const flushCurrentDay = () => {
    if (!currentDate) {
      return;
    }
    const mealSectionSeen = currentDayLines.some((line) =>
      /(завтрак|обед|ужин|перекус|breakfast|lunch|dinner|snack)/i.test(line)
    );
    const totalLines = currentDayLines.filter((line) =>
      /^(всего|total)(?:\s|$)/i.test(line.trim().toLocaleLowerCase("ru"))
    );
    const validTotals: Array<{ kcal: number; fatG: number; carbsG: number; proteinG: number }> = [];

    for (const totalLine of totalLines) {
      const numericTokens = totalLine.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
      const values = numericTokens.map((token) => parseNumberCell(token)).filter((value): value is number => value !== null);
      if (values.length < 7) {
        continue;
      }
      const kcal = values[0] ?? null;
      const fatG = values[1] ?? null;
      const carbsG = values[3] ?? null;
      const proteinG = values[6] ?? null;
      if (kcal === null || fatG === null || carbsG === null || proteinG === null) {
        continue;
      }
      if (kcal < 500) {
        continue;
      }
      validTotals.push({ kcal, fatG, carbsG, proteinG });
    }

    if (validTotals.length === 0) {
      warnings.push(`missing_daily_total_for_date:${currentDate}`);
      return;
    }

    // Guard against treating single meal subtotal as a day total.
    if (validTotals.length === 1 && totalLines.length === 1 && mealSectionSeen) {
      warnings.push(`missing_daily_total_for_date:${currentDate}`);
      return;
    }

    const items: NutritionFoodItem[] = [];
    let activeSection: NutritionMealSection | null = null;
    for (const line of currentDayLines) {
      if (isFatSecretChromeLine(line)) {
        continue;
      }
      const section = resolveFatSecretMealSection(line);
      if (section) {
        activeSection = section;
        continue;
      }
      if (isFatSecretTotalsLine(line)) {
        continue;
      }
      const item = parseFatSecretFoodItemLine(line, activeSection);
      if (item) {
        items.push(item);
      }
    }

    const best = validTotals[validTotals.length - 1];
    candidates.push({
      day: currentDate,
      kcal: best.kcal,
      fatG: best.fatG,
      carbsG: best.carbsG,
      proteinG: best.proteinG,
      confidence: 0.94,
      notes: "fatsecret_ru_detailed_daily_total",
      source: "daily_total",
      ...(items.length > 0 ? { items } : {}),
    });
  };

  for (const line of lines) {
    const parsedDate = parseFatSecretDetailedDateHeader(line);
    if (parsedDate) {
      inDaySection = true;
      if (!currentDate) {
        currentDate = parsedDate;
        currentDayLines = [];
        continue;
      }
      if (parsedDate !== currentDate) {
        flushCurrentDay();
        currentDate = parsedDate;
        currentDayLines = [];
      }
      continue;
    }
    if (!inDaySection) {
      continue;
    }
    currentDayLines.push(line);
  }
  flushCurrentDay();

  if (candidates.length > 0) {
    warnings.push("fatsecret_ru_detailed_daily_totals_parsed");
  }
  return { candidates, warnings };
}

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
  const directIso = line.match(/(?:^|[^\d])(20\d{2})-(\d{1,2})-(\d{1,2})(?:$|[^\d])/);
  if (directIso) {
    return isoFromDateParts(Number(directIso[1]), Number(directIso[2]), Number(directIso[3]));
  }

  const dotted = line.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})[./](20\d{2})(?:$|[^\d])/);
  if (dotted) {
    return isoFromDateParts(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
  }

  const monthEn = line.match(
    /\b(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)?\s*([a-z]{3,9})\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/i
  );
  if (monthEn) {
    const key = monthEn[1].toLocaleLowerCase("en");
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const month = monthMap[key] ?? null;
    if (month) {
      const year = monthEn[3] ? Number(monthEn[3]) : new Date().getUTCFullYear();
      return isoFromDateParts(year, month, Number(monthEn[2]));
    }
  }

  const monthRu = line.match(
    /(\d{1,2})\s+(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])(?:\s+(20\d{2}))?/i
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
    /(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|пн|понедельник|вт|вторник|ср|среда|чт|четверг|пт|пятница|сб|суббота|вс|воскресенье)[^0-9]{0,10}(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?/i
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

function hasDatePattern(line: string): boolean {
  return (
    /(?:^|[^\d])20\d{2}-\d{1,2}-\d{1,2}(?:$|[^\d])/.test(line) ||
    /(?:^|[^\d])\d{1,2}[./]\d{1,2}(?:[./](?:20)?\d{2})?(?:$|[^\d])/.test(line) ||
    /(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)/i.test(
      line
    ) ||
    /(?:январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])/i.test(
      line
    )
  );
}

function parseFatSecretPdfLines(text: string): FatSecretPdfDayCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const loweredFullText = text.toLocaleLowerCase("ru");
  const candidates: FatSecretPdfDayCandidate[] = [];
  const parsedFoodLikeRows: Array<{ line: string; day: string | null }> = [];
  const tabularCandidates: FatSecretPdfDayCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lowered = line.toLocaleLowerCase("ru");
    const looksLikeHeader =
      /(date|day|дата)/.test(lowered) &&
      /(kcal|calories|ккал|калории)/.test(lowered) &&
      /(protein|белк)/.test(lowered) &&
      /(fat|жир)/.test(lowered) &&
      /(carb|углев)/.test(lowered);
    if (!looksLikeHeader) {
      continue;
    }
    for (let rowIndex = index + 1; rowIndex <= Math.min(lines.length - 1, index + 16); rowIndex += 1) {
      const rowLine = lines[rowIndex] ?? "";
      const day = parseDateFromFatSecretLine(rowLine);
      if (!day) {
        if (rowLine.length === 0) {
          break;
        }
        continue;
      }
      const rowWithoutDate = rowLine
        .replace(/20\d{2}-\d{1,2}-\d{1,2}/g, " ")
        .replace(/\d{1,2}[./]\d{1,2}[./](?:20)?\d{2}/g, " ")
        .replace(/\d{1,2}[./]\d{1,2}(?!\d)/g, " ");
      const numberMatches = rowWithoutDate.match(/([0-9]+(?:[.,][0-9]+)?)/g) ?? [];
      if (numberMatches.length < 4) {
        continue;
      }
      const values = numberMatches.map((value) => parseNumberCell(value)).filter((value): value is number => value !== null);
      if (values.length < 4) {
        continue;
      }
      const [kcal, fatG, carbsG, proteinG] = values;
      tabularCandidates.push({
        day,
        kcal,
        proteinG,
        fatG,
        carbsG,
        confidence: 0.9,
        notes: undefined,
        source: "daily_total",
      });
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const contextLine = [line, lines[index + 1] ?? ""].join(" | ");
    const day = parseDateFromFatSecretLine(line);
    const lowered = line.toLocaleLowerCase("ru");
    const isTotalLine =
      /(total|daily total|day total|итого|всего|суточн(?:ый|ые)|за день)/i.test(lowered) ||
      /(foods?\s*(?:totals?|summary))/i.test(lowered);
    const looksLikeFoodRow =
      /(breakfast|lunch|dinner|snack|meal|serving|grams?|portion|порци|завтрак|обед|ужин|перекус)/i.test(
        lowered
      ) && !isTotalLine;

    const kcal = parseMacroValue(contextLine.toLocaleLowerCase("ru"), [
      /(?:ккал|калори(?:и|я|й)|calories|kcal)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:ккал|calories|kcal)\b/i,
    ]);
    const proteinG = parseMacroValue(contextLine.toLocaleLowerCase("ru"), [
      /(?:белк(?:и|а|ов)?|белок|protein)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:г|g)\s*(?:белк(?:и|а|ов)?|protein)\b/i,
    ]);
    const fatG = parseMacroValue(contextLine.toLocaleLowerCase("ru"), [
      /(?:жир(?:ы|а|ов)?|fat)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:г|g)\s*(?:жир(?:ы|а|ов)?|fat)\b/i,
    ]);
    const carbsG = parseMacroValue(contextLine.toLocaleLowerCase("ru"), [
      /(?:углевод(?:ы|ов)?|carb(?:s|ohydrate)?s?)\s*[:=-]?\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(?:г|g)\s*(?:углевод(?:ы|ов)?|carb(?:s|ohydrate)?s?)\b/i,
    ]);

    const macroCount = [kcal, proteinG, fatG, carbsG].filter((value) => value !== null).length;
    if (!day && macroCount === 0) {
      continue;
    }

    if (looksLikeFoodRow && macroCount > 0) {
      parsedFoodLikeRows.push({ line, day });
    }

    if (!isTotalLine) {
      continue;
    }

    const confidence = Math.max(
      0.1,
      Math.min(0.98, 0.45 + (day ? 0.25 : 0) + (macroCount === 4 ? 0.25 : macroCount * 0.1))
    );
    const notes: string[] = [];
    if (!day) {
      notes.push("date_missing");
    }
    if (macroCount < 4) {
      notes.push("partial_macros");
    }
    if (!hasDatePattern(line) && !day) {
      notes.push("date_not_near_total");
    }
    candidates.push({
      day,
      kcal,
      proteinG,
      fatG,
      carbsG,
      confidence,
      notes: notes.length > 0 ? notes.join(", ") : undefined,
      source: "daily_total",
    });
  }

  if (candidates.length === 0 && parsedFoodLikeRows.length > 0) {
    return [];
  }

  const hasLikelyFatSecret =
    /(fatsecret|food diary|foods|nutrition report|дневник питания)/i.test(loweredFullText) ||
    [/calories?/i, /protein/i, /fat/i, /carbs?/i, /ккал|калори/i, /белк/i, /жир/i, /углев/i].filter((pattern) =>
      pattern.test(loweredFullText)
    )
      .length >= 2;
  if (!hasLikelyFatSecret) {
    return [];
  }

  return [...tabularCandidates, ...candidates];
}

export function extractNutritionRowsFromFatSecretPdfText(input: {
  text: string;
  sourceFileName?: string;
}): {
  extractedRows: NormalizedManualMacroRow[];
  extractedDays: ExtractedNutritionDay[];
  warnings: string[];
  parsedWeekFrom: string | null;
  parsedWeekTo: string | null;
  parsedDateCount: number;
  parsedDateMin: string | null;
  parsedDateMax: string | null;
  dateCoverage: NutritionParsedDateCoverage["dateCoverage"];
  diagnostics: {
    extractedTextLength: number;
    normalizedTextLength: number;
    hasKcalKeyword: boolean;
    hasProteinKeyword: boolean;
    hasFatKeyword: boolean;
    hasCarbsKeyword: boolean;
    dateMatches: number;
    parsedRows: number;
  };
} {
  const lowered = input.text.toLocaleLowerCase("ru");
  const ruDetailedParsed = parseRussianFatSecretDetailedDailyTotals(input.text);
  const diagnostics = {
    extractedTextLength: input.text.length,
    normalizedTextLength: input.text.replace(/\s+/g, " ").trim().length,
    hasKcalKeyword: /(kcal|calories|ккал|кал)/i.test(lowered),
    hasProteinKeyword: /(protein|белк|белок|белки)/i.test(lowered),
    hasFatKeyword: /(fat|жир|жиры)/i.test(lowered),
    hasCarbsKeyword: /(carbs|carbohydrate|углев|углеводы)/i.test(lowered),
    dateMatches: (input.text.match(/(20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}(?:[./](?:20)?\d{2})?)/g) ?? []).length,
    parsedRows: 0,
  };
  if (ruDetailedParsed.candidates.length > 0) {
    const converted = convertFatSecretPdfCandidates(ruDetailedParsed.candidates, input.sourceFileName ?? "pdf_text");
    diagnostics.parsedRows = converted.extractedRows.length;
    const warnings = [...converted.warnings, ...ruDetailedParsed.warnings];
    const coverage = computeNutritionParsedDateCoverageFromRows(converted.extractedRows, {
      source: "pdf_rows",
    });
    return { ...converted, ...coverage, warnings, diagnostics };
  }
  const parsed = parseFatSecretPdfLines(input.text);
  if (parsed.length === 0) {
    const hasMacroKeywords =
      [diagnostics.hasKcalKeyword, diagnostics.hasProteinKeyword, diagnostics.hasFatKeyword, diagnostics.hasCarbsKeyword].filter(Boolean)
        .length >= 2;
    const warnings = hasMacroKeywords
      ? ["daily_totals_not_found", "parsed_food_rows_but_no_day_totals", "fatsecret_layout_not_recognized"]
      : ["fatsecret_layout_not_recognized"];
    const emptyCoverage = computeNutritionParsedDateCoverageFromRows([]);
    return {
      extractedRows: [],
      extractedDays: [],
      ...emptyCoverage,
      warnings,
      diagnostics,
    };
  }
  const converted = convertFatSecretPdfCandidates(parsed, input.sourceFileName ?? "pdf_text");
  diagnostics.parsedRows = converted.extractedRows.length;
  const hasLowConfidence = converted.extractedRows.some((row) => row.confidence < 0.65);
  const warnings = [...converted.warnings];
  if (hasLowConfidence) {
    warnings.push("low_confidence_pdf_parse");
  }
  const coverage = computeNutritionParsedDateCoverageFromRows(converted.extractedRows, {
    source: "pdf_rows",
  });
  return { ...converted, ...coverage, warnings, diagnostics };
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
  const warnings = [...duplicateDays].flatMap((day) => [
    "duplicate_day_totals",
    `duplicate_date:${day}: сохранена строка с наибольшей уверенностью`,
  ]);
  return { rows, warnings };
}

function mapPdfExtractionErrorReason(errorCode: PdfTextExtractionErrorCode | null): string {
  switch (errorCode) {
    case "password_protected":
      return "pdf_password_protected";
    case "invalid_pdf":
      return "pdf_invalid_or_corrupted";
    case "no_text_content":
      return "pdf_text_empty";
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
    ...(candidate.items && candidate.items.length > 0 ? { items: candidate.items } : {}),
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
  weekTo?: string;
  files: File[];
  persistFiles?: boolean;
}): Promise<IntakeNutritionReportFilesResult> {
  if (input.files.length === 0) {
    return {
      fileMetas: [],
      extraction: {
        extractedRows: [],
        extractedDays: [],
        unsupportedFiles: [],
        extractionWarnings: [],
        dateCoverage: computeNutritionParsedDateCoverageFromRows([]),
      },
      sourceType: "manual_text",
    };
  }

  assertNutritionUploadFilesValid(input.files);

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
    if (file.size > MAX_NUTRITION_FILE_SIZE_BYTES) {
      throw new Error(`Файл слишком большой (${file.name}). Лимит: 10 MB на файл.`);
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
      extractionTextLength: null,
      extractionNormalizedTextLength: null,
      extractionDiagnostics: null,
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
      metaRef.extractionTextLength = converted.diagnostics.extractedTextLength;
      metaRef.extractionNormalizedTextLength = converted.diagnostics.normalizedTextLength;
      metaRef.extractionDiagnostics = {
        hasKcalKeyword: converted.diagnostics.hasKcalKeyword,
        hasProteinKeyword: converted.diagnostics.hasProteinKeyword,
        hasFatKeyword: converted.diagnostics.hasFatKeyword,
        hasCarbsKeyword: converted.diagnostics.hasCarbsKeyword,
        dateMatches: converted.diagnostics.dateMatches,
        parsedRows: converted.diagnostics.parsedRows,
      };
      if (converted.extractedRows.length === 0) {
        unsupportedFiles.push({
          fileName: file.name,
          reason: "daily_totals_not_found",
        });
        const warning = `${file.name}: daily_totals_not_found`;
        metaRef.extractionWarnings = [...(metaRef.extractionWarnings ?? []), warning, ...converted.warnings];
        extractionWarnings.push(warning, ...converted.warnings.map((item) => `${file.name}: ${item}`));
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

  const dateCoverage = computeNutritionParsedDateCoverageFromRows(dedupedMerged.rows, {
    uiWeekFrom: input.weekFrom,
    uiWeekTo: input.weekTo,
    source: dedupedMerged.rows.some((row) => !row.day.startsWith("unresolved:")) ? "pdf_rows" : "unknown",
  });

  return {
    fileMetas,
    extraction: {
      extractedRows: dedupedMerged.rows,
      extractedDays: dedupedMerged.days,
      unsupportedFiles,
      extractionWarnings,
      dateCoverage,
    },
    sourceType: resolveSourceType(fileMetas.map((meta) => meta.fileKind)),
  };
}
