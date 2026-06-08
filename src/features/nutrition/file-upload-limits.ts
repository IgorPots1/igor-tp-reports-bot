export const MAX_NUTRITION_FILE_COUNT = 10;
export const MAX_NUTRITION_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_NUTRITION_TOTAL_UPLOAD_BYTES = 15 * 1024 * 1024;
export const NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT = "15mb";

export const NUTRITION_FILE_UPLOAD_LIMIT_HINT =
  "До 10 файлов, каждый до 10 MB, суммарно до 15 MB за одну загрузку.";

export function validateNutritionUploadFiles(files: File[]): string | null {
  if (files.length === 0) {
    return null;
  }
  if (files.length > MAX_NUTRITION_FILE_COUNT) {
    return `Слишком много файлов: максимум ${MAX_NUTRITION_FILE_COUNT}.`;
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size <= 0) {
      return `Файл пустой: ${file.name}`;
    }
    if (file.size > MAX_NUTRITION_FILE_SIZE_BYTES) {
      return `Файл слишком большой (${file.name}). Лимит: 10 MB на файл.`;
    }
    totalBytes += file.size;
  }

  if (totalBytes > MAX_NUTRITION_TOTAL_UPLOAD_BYTES) {
    const totalMb = Math.ceil(totalBytes / (1024 * 1024));
    return `Суммарный размер файлов слишком большой (${totalMb} MB). Лимит: 15 MB за одну загрузку.`;
  }

  return null;
}

export function assertNutritionUploadFilesValid(files: File[]): void {
  const error = validateNutritionUploadFiles(files);
  if (error) {
    throw new Error(error);
  }
}
