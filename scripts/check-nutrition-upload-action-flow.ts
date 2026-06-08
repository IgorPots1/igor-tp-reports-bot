import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const actionsPath = join(root, "src/app/admin/coach-os/nutrition/actions.ts");
const panelPath = join(root, "src/app/admin/coach-os/nutrition/NutritionFileUploadPanel.tsx");
const statePath = join(root, "src/app/admin/coach-os/nutrition/upload-action-state.ts");

const actions = readFileSync(actionsPath, "utf8");
const panel = readFileSync(panelPath, "utf8");
const state = readFileSync(statePath, "utf8");

assert.match(
  actions,
  /export async function previewNutritionFileUploadAction\(\s*_prevState: NutritionFileUploadPreviewActionState,\s*formData: FormData\s*\): Promise<NutritionFileUploadPreviewActionState>/,
  "preview action must return serializable action state"
);

const previewBody = actions.match(
  /export async function previewNutritionFileUploadAction[\s\S]*?export async function saveNutritionFileReportAction/
);
assert.ok(previewBody, "preview action block must exist");
assert.equal(
  /redirect\(/.test(previewBody![0]),
  false,
  "preview action must not call redirect()"
);

const saveBody = actions.match(/export async function saveNutritionFileReportAction[\s\S]*?export async function generateNutritionWeeklyReviewAction/);
assert.ok(saveBody, "save action block must exist");
assert.equal(
  /redirect\(/.test(saveBody![0]),
  true,
  "save action should keep explicit redirect behavior"
);
assert.match(
  saveBody![0],
  /let result:[\s\S]*try[\s\S]*catch[\s\S]*redirect\(withNotice\(redirectTo, "error", message\)\)[\s\S]*redirect\([\s\S]*buildNutritionStudentCardHref/,
  "save action should redirect in success path with report week and id"
);

assert.equal(
  /NEXT_REDIRECT|Error:\s*redirect|redirect\b/.test(panel),
  false,
  "upload panel must not render technical redirect errors"
);

assert.match(
  state,
  /type NutritionFileUploadPreviewActionState[\s\S]*preview: NutritionFileUploadPreviewSnapshot \| null/,
  "preview action state should include serializable preview snapshot"
);

console.log("PASS check-nutrition-upload-action-flow");
