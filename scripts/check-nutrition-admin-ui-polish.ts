import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatNutritionCarbStrategy,
  formatNutritionDataQualitySummary,
  formatNutritionGenerationMode,
} from "../src/features/nutrition/admin-labels";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const uploadPanel = readFileSync(join(root, "src/app/admin/coach-os/nutrition/NutritionFileUploadPanel.tsx"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const globalsCss = readFileSync(join(root, "src/app/globals.css"), "utf8");

assert.match(studentPage, /Отчёт питания за неделю[\s\S]*admin-nutrition-mini-table/, "main flow must show compact saved reports table");
assert.match(studentPage, /admin-nutrition-selected-card/, "main flow must show selected report summary");
assert.doesNotMatch(
  studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack")),
  /Все сохранённые отчёты/,
  "full report history label must not appear before advanced section"
);

assert.match(studentPage, /admin-nutrition-advanced-stack[\s\S]*admin-nutrition-advanced-inner/, "advanced section must use nested stack");
assert.match(studentPage, /summary>Профиль и вес</, "advanced must include profile and weight nested section");
assert.match(studentPage, /summary>Контекстные заметки</, "advanced must include context notes nested section");
assert.match(studentPage, /summary>Ручной ввод макросов</, "advanced must include manual macros nested section");
assert.match(studentPage, /summary>Кэш TrainingPeaks</, "advanced must include TP cache nested section");
assert.match(studentPage, /summary>Все сохранённые отчёты</, "advanced must include full reports history");
assert.match(studentPage, /summary>Все сохранённые обзоры</, "advanced must include full reviews history");
assert.match(studentPage, /summary>Technical JSON</, "technical JSON must remain in collapsed details");

assert.match(uploadPanel, /Шаг 1 — загрузить и распознать/, "upload panel must label preview step");
assert.match(uploadPanel, /Шаг 2 — сохранить распознанный отчёт/, "upload panel must label save step");
assert.match(uploadPanel, /activePreview &&[\s\S]*admin-nutrition-upload-step-save/, "save step must appear only after preview");

assert.doesNotMatch(
  studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack")),
  /parsed_days:|low_confidence_days:|small_step|>\s*fallback\s*</,
  "main UI must avoid raw technical enum labels"
);

assert.match(globalsCss, /\.admin-nutrition-compact-grid/, "globals must include compact grid styles");
assert.match(globalsCss, /\.admin-nutrition-inline-meta/, "globals must include inline meta styles");
assert.match(globalsCss, /\.admin-nutrition-mini-table/, "globals must include mini table styles");

assert.doesNotMatch(actions, /telegram|sendMessage|sendTelegram/i, "nutrition actions must not import Telegram send paths");
assert.doesNotMatch(uploadPanel, /telegram|sendMessage|sendTelegram/i, "upload panel must not import Telegram send paths");

assert.equal(formatNutritionGenerationMode("ai"), "AI");
assert.equal(formatNutritionGenerationMode("fallback"), "шаблон");
assert.equal(formatNutritionCarbStrategy("small_step"), "маленький шаг");
assert.match(
  formatNutritionDataQualitySummary({ parsedDays: 7, lowConfidenceDays: 0 }),
  /7 дней распознано, низкая уверенность: 0/
);

console.log("PASS check-nutrition-admin-ui-polish");
