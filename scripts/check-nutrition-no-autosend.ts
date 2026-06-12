import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = [
  "src/features/nutrition/repository.ts",
  "src/features/nutrition/context.ts",
  "src/features/nutrition/draft-generator.ts",
  "src/features/nutrition/interpretation-generator.ts",
  "src/features/nutrition/interpretation-contract.ts",
  "src/features/nutrition/interpretation-audit.ts",
  "src/features/nutrition/combined-message.ts",
  "scripts/audit-nutrition-interpretation-shadow.ts",
  "scripts/diagnose-nutrition-interpretation-shadow-case.ts",
  "src/features/nutrition/admin.ts",
  "src/app/admin/coach-os/nutrition/actions.ts",
  "src/app/admin/coach-os/nutrition/page.tsx",
  "src/app/admin/coach-os/nutrition/[studentId]/page.tsx",
  "scripts/check-nutrition-combined-message.ts",
];

const forbiddenPatterns = [
  /sendTrainingPeaksWeeklyReportToStudent/,
  /sendTrainingPeaksReplyDraftToStudent/,
  /sendTrainingPeaksAdminStudentTelegramTestMessage/,
  /telegram\.send/i,
  /bot\.send/i,
];

for (const file of files) {
  const body = readFileSync(join(root, file), "utf8");
  for (const forbidden of forbiddenPatterns) {
    assert.doesNotMatch(body, forbidden, `${file} must not introduce autosend paths`);
  }
}

console.log("PASS check-nutrition-no-autosend");
