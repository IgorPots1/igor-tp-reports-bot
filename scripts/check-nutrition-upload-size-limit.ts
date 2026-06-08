import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_NUTRITION_FILE_SIZE_BYTES,
  MAX_NUTRITION_TOTAL_UPLOAD_BYTES,
  NUTRITION_FILE_UPLOAD_LIMIT_HINT,
  NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT,
} from "@/features/nutrition/file-upload-limits";

const root = process.cwd();

function parseBodySizeLimitBytes(value: string): number {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);
  if (!match) {
    throw new Error(`Unsupported body size limit format: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "b";
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  return amount * (multipliers[unit] ?? 1);
}

const nextConfigBody = readFileSync(join(root, "next.config.ts"), "utf8");
assert.match(
  nextConfigBody,
  /bodySizeLimit:\s*NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT/,
  "next.config.ts must use shared nutrition server action body size limit"
);
assert.equal(NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT, "15mb", "server action body size limit must be 15mb");

const configuredBodyLimitBytes = parseBodySizeLimitBytes(NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT);
assert.ok(
  configuredBodyLimitBytes >= MAX_NUTRITION_TOTAL_UPLOAD_BYTES,
  "server action body limit must cover total nutrition upload limit"
);
assert.ok(
  configuredBodyLimitBytes >= MAX_NUTRITION_FILE_SIZE_BYTES,
  "server action body limit must cover single-file nutrition upload limit"
);

const fileIntakeBody = readFileSync(join(root, "src/features/nutrition/file-intake.ts"), "utf8");
assert.match(fileIntakeBody, /assertNutritionUploadFilesValid\(/, "file intake must validate total upload size");
assert.match(
  fileIntakeBody,
  /MAX_NUTRITION_FILE_SIZE_BYTES/,
  "file intake must enforce per-file nutrition upload limit"
);

const pageBody = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const uploadPanelBody = readFileSync(
  join(root, "src/app/admin/coach-os/nutrition/NutritionFileUploadPanel.tsx"),
  "utf8"
);
assert.ok(
  /NUTRITION_FILE_UPLOAD_LIMIT_HINT/.test(pageBody) || /NUTRITION_FILE_UPLOAD_LIMIT_HINT/.test(uploadPanelBody),
  "nutrition upload UI must show upload limit hint"
);
assert.ok(
  /NutritionReportUploadForm/.test(pageBody) || /NutritionReportUploadForm/.test(uploadPanelBody),
  "nutrition upload UI must use client upload guard form"
);

const uploadFormBody = readFileSync(
  join(root, "src/app/admin/coach-os/nutrition/NutritionReportUploadForm.tsx"),
  "utf8"
);
assert.match(uploadFormBody, /validateNutritionUploadFiles/, "upload form must validate files before submit");

assert.match(NUTRITION_FILE_UPLOAD_LIMIT_HINT, /10 MB/, "upload limit hint must mention per-file limit");
assert.match(NUTRITION_FILE_UPLOAD_LIMIT_HINT, /15 MB/, "upload limit hint must mention total upload limit");

console.log("PASS check-nutrition-upload-size-limit");
