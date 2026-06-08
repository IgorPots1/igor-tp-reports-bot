import type { NutritionFileUploadPreviewSnapshot } from "@/features/nutrition/file-preview-cookie";

export type NutritionFileUploadPreviewActionState = {
  ok: boolean;
  notice: string | null;
  error: string | null;
  preview: NutritionFileUploadPreviewSnapshot | null;
  refreshKey: string | null;
};

export const NUTRITION_FILE_UPLOAD_PREVIEW_INITIAL_STATE: NutritionFileUploadPreviewActionState = {
  ok: false,
  notice: null,
  error: null,
  preview: null,
  refreshKey: null,
};
