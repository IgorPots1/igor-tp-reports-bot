import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNutritionDashboardOpenHref,
  buildNutritionStudentCardHref,
} from "../src/features/nutrition/admin-labels";

const root = process.cwd();
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const dashboardPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/page.tsx"), "utf8");
const admin = readFileSync(join(root, "src/features/nutrition/admin.ts"), "utf8");
const repository = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");

assert.match(actions, /reviewId: result\.analysis\.id/, "generate action must redirect with reviewId");
assert.match(studentPage, /reviewId: reviewIdFromQuery/, "student card must pass reviewId into loader");
assert.match(studentPage, /name="reviewId"/, "week form must preserve reviewId");
assert.match(studentPage, /getNutritionStudentDefaultWeek/, "student card must default to latest nutrition week");
assert.match(admin, /getNutritionWeeklyAnalysisById\(input\.reviewId\)/, "card loader must fetch review by id");
assert.match(repository, /export async function getNutritionStudentDefaultWeek/, "repository must expose default week");
assert.match(dashboardPage, /buildNutritionDashboardOpenHref/, "dashboard must open card with nutrition context");

const studentId = "student-uuid-1";
const redirectHref = buildNutritionStudentCardHref({
  studentId,
  weekFrom: "2026-06-01",
  weekTo: "2026-06-07",
  reportId: "report-uuid-1",
  reviewId: "review-uuid-1",
  notice: "Недельный обзор сгенерирован.",
});
assert.match(redirectHref, /reviewId=review-uuid-1/);
assert.match(redirectHref, /weekFrom=2026-06-01/);
assert.match(redirectHref, /reportId=report-uuid-1/);

const openHref = buildNutritionDashboardOpenHref({
  studentId,
  latestReportId: "report-uuid-1",
  latestReportWeekFrom: "2026-06-01",
  latestReportWeekTo: "2026-06-07",
  lastAnalysisId: "review-uuid-1",
  lastAnalysisWeekFrom: "2026-06-01",
  lastAnalysisWeekTo: "2026-06-07",
});
assert.match(openHref, /reviewId=review-uuid-1/);
assert.match(openHref, /weekFrom=2026-06-01/);

console.log("PASS check-nutrition-review-persistence-flow");
