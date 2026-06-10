import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const diagnoseScript = readFileSync(join(root, "scripts/diagnose-nutrition-page-consistency.ts"), "utf8");

const mainUi = studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack"));
const coachDetailsStart = mainUi.indexOf("Детали для тренера");
const combinedStart = mainUi.indexOf("Черновик ученику — полный текст");
const coachDetailsUi =
  coachDetailsStart >= 0 && combinedStart > coachDetailsStart
    ? mainUi.slice(coachDetailsStart, combinedStart)
    : "";

assert.match(mainUi, /buildDerivedNutritionCombinedMessage/, "primary full text must come from derived combined message");
assert.match(mainUi, /combinedMessage\.renderResult\.text/, "primary full text must use renderResult.text");
assert.match(
  mainUi,
  /combinedMessage\.status === "missing_plan"/,
  "missing plan must show generate-focus hint in primary block"
);
assert.match(
  mainUi,
  /formatNutritionCombinedMessageMissingPlanHint/,
  "missing plan hint must use policy helper"
);

assert.match(mainUi, /NutritionDraftCopyBlock[\s\S]*draft=\{combinedMessage\.renderResult\.text\}/, "primary copy block must bind renderResult.text");
assert.doesNotMatch(coachDetailsUi, /NutritionDraftCopyBlock/, "coach details must not expose copy block");

assert.match(studentPage, /copyEnabled=\{false\}/, "stored service drafts must disable copy");
assert.match(studentPage, /Служебный текст, не для отправки напрямую/, "service drafts must warn they are not sendable");

assert.match(mainUi, /coach_summary_text/, "coach details still read stored coach_summary_text");
assert.match(mainUi, /buildDerivedNutritionCoachDayByDayText/, "coach day-by-day prefers derived text");
assert.match(mainUi, /day_by_day_analysis_text/, "coach day-by-day falls back to stored text");

assert.match(diagnoseScript, /buildDerivedNutritionCombinedMessage/, "page consistency diagnostic must mirror combined render");
assert.match(diagnoseScript, /getNutritionAdminStudentCard/, "page consistency diagnostic must mirror page card selection");
assert.match(diagnoseScript, /resolveNutritionWeeklyPlanForDisplay/, "page consistency diagnostic must mirror plan resolution");
assert.match(diagnoseScript, /--student-name/, "page consistency diagnostic must accept student name");
assert.match(diagnoseScript, /Daily analysis vs TP context/, "page consistency diagnostic must compare daily vs TP");

assert.match(packageJson, /diagnose:nutrition-page-consistency/, "package.json must include page consistency diagnostic");
assert.match(packageJson, /check:nutrition-page-consistency/, "package.json must include page consistency check");

assert.doesNotMatch(mainUi, /telegram|sendMessage|sendTelegram/i, "nutrition page must not auto-send Telegram");

console.log("PASS check-nutrition-page-consistency");
