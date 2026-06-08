import { Buffer } from "node:buffer";

import type { NutritionUploadedFileMeta } from "@/features/nutrition/file-intake";
import type { NutritionDataQuality } from "@/features/nutrition/context";

export const NUTRITION_FILE_PREVIEW_COOKIE = "nutrition_file_preview";

export type NutritionFilePreviewRow = {
  day: string;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  confidence: number;
  notes: string | null;
};

export type NutritionFileUploadPreviewSnapshot = {
  studentId: string;
  weekFrom: string;
  weekTo: string;
  status: "parsed" | "insufficient" | "needs_review" | "ready_for_analysis";
  quality: NutritionDataQuality;
  rows: NutritionFilePreviewRow[];
  extractionWarnings: string[];
  unsupportedFiles: Array<{ fileName: string; reason: string }>;
  files: Array<{
    originalFileName: string;
    fileKind: NutritionUploadedFileMeta["fileKind"];
    extractionMethod: string | null;
    extractionErrorCode: string | null;
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
    extractionWarnings: string[];
  }>;
};

const MAX_ROWS = 60;
const MAX_WARNINGS = 60;
const MAX_FILES = 12;

export function serializeNutritionFileUploadPreview(snapshot: NutritionFileUploadPreviewSnapshot): string {
  const safePayload: NutritionFileUploadPreviewSnapshot = {
    ...snapshot,
    rows: snapshot.rows.slice(0, MAX_ROWS),
    extractionWarnings: snapshot.extractionWarnings.slice(0, MAX_WARNINGS),
    unsupportedFiles: snapshot.unsupportedFiles.slice(0, MAX_WARNINGS),
    files: snapshot.files.slice(0, MAX_FILES).map((file) => ({
      ...file,
      extractionWarnings: file.extractionWarnings.slice(0, 8),
    })),
  };
  return Buffer.from(JSON.stringify(safePayload), "utf8").toString("base64url");
}

export function parseNutritionFileUploadPreview(rawValue: string | undefined): NutritionFileUploadPreviewSnapshot | null {
  if (!rawValue) {
    return null;
  }
  try {
    const decoded = Buffer.from(rawValue, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as NutritionFileUploadPreviewSnapshot;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.studentId || !parsed.weekFrom || !parsed.weekTo || !Array.isArray(parsed.rows)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
