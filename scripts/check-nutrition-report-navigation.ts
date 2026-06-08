import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNutritionNextActionHref,
  buildNutritionStudentCardHref,
  pickDefaultNutritionReport,
} from "../src/features/nutrition/admin-labels";

const root = process.cwd();
const dashboardPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/page.tsx"), "utf8");
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const repository = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");

assert.match(
  dashboardPage,
  /row\.nextActionHref[\s\S]*Link[\s\S]*href=\{row\.nextActionHref\}[\s\S]*formatNutritionNextAction\(row\.nextAction\)/,
  "dashboard next action must render as Link when href is present"
);

assert.match(
  studentPage,
  /pickDefaultNutritionReport\(card\.reports, reportIdFromQuery\)/,
  "student card must pick report from query param"
);

assert.match(
  studentPage,
  /defaultValue=\{selectedReportId/,
  "weekly review report select must default to selected report"
);

assert.match(
  actions,
  /buildNutritionStudentCardHref\([\s\S]*reportId: result\.report\.id/,
  "save actions must redirect with report week and id"
);

assert.match(
  repository,
  /nextActionHref: buildNutritionNextActionHref/,
  "dashboard rows must include nextActionHref"
);

const studentId = "student-uuid-1";
const href = buildNutritionNextActionHref({
  studentId,
  nextAction: "Generate weekly nutrition review",
  report: {
    id: "report-uuid-1",
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
  },
  analysis: null,
});
assert.ok(href, "generate review action must produce href");
assert.match(href!, /\/admin\/coach-os\/nutrition\/student-uuid-1\?/);
assert.match(href!, /weekFrom=2026-06-01/);
assert.match(href!, /weekTo=2026-06-07/);
assert.match(href!, /reportId=report-uuid-1/);

const saveRedirect = buildNutritionStudentCardHref({
  studentId,
  weekFrom: "2026-06-01",
  weekTo: "2026-06-07",
  reportId: "report-uuid-1",
  notice: "Отчёт сохранён",
});
assert.match(saveRedirect, /weekFrom=2026-06-01/);
assert.match(saveRedirect, /reportId=report-uuid-1/);
assert.match(saveRedirect, /notice=/);

const picked = pickDefaultNutritionReport(
  [
    { id: "old-insufficient", status: "insufficient", createdAt: "2026-06-08T10:00:00.000Z" },
    { id: "ready-report", status: "ready_for_analysis", createdAt: "2026-06-07T10:00:00.000Z" },
  ],
  null
);
assert.equal(picked, "ready-report", "ready report should win over newer insufficient report");

const pickedFromQuery = pickDefaultNutritionReport(
  [{ id: "ready-report", status: "ready_for_analysis", createdAt: "2026-06-07T10:00:00.000Z" }],
  "ready-report"
);
assert.equal(pickedFromQuery, "ready-report", "query report id should be respected when present");

console.log("PASS check-nutrition-report-navigation");
