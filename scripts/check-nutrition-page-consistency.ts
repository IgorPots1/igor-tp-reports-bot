import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeNutritionPageConsistency,
  reviewHasModernMethodology,
} from "../src/features/nutrition/page-consistency";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "../src/features/nutrition/repository";
import { SEND_CALL_IN_RENDER, TELEGRAM_BOT_API_HOST } from "./lib/render-safety-guards";

const root = process.cwd();
const studentPage = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const diagnoseScript = readFileSync(join(root, "scripts/diagnose-nutrition-page-consistency.ts"), "utf8");
const pageConsistencySource = readFileSync(join(root, "src/features/nutrition/page-consistency.ts"), "utf8");

const mainUi = studentPage.slice(0, studentPage.indexOf("admin-nutrition-advanced-stack"));
const coachDetailsStart = mainUi.indexOf("Детали для тренера");
const combinedStart = mainUi.indexOf("Черновик ученику — полный текст");
const coachDetailsUi =
  coachDetailsStart >= 0 && combinedStart > coachDetailsStart
    ? mainUi.slice(coachDetailsStart, combinedStart)
    : "";

function buildStaleReview(): NutritionWeeklyAnalysis {
  return {
    id: "review-stale",
    studentId: "student-1",
    reportId: "report-1",
    weekFrom: "2026-06-08",
    weekTo: "2026-06-14",
    status: "draft_generated",
    internalSummary: {},
    tpPastWeekContext: { workouts: [{ date: "2026-06-09", title: "Run", type: "easy" }] },
    tpNextWeekContext: {},
    nutritionSummary: {
      generation_mode: "fallback",
      coach_summary_text: "Комментарий: можно дать краткий комментарий.",
      daily_analysis: [
        {
          date: "2026-06-02",
          training_type: "rest",
          training_label: "день отдыха",
        },
        {
          date: "2026-06-03",
          training_type: "rest",
          training_label: "день отдыха",
        },
      ],
    },
    safetyFlags: {},
    contextSnapshot: {},
    promptHash: null,
    contextHash: null,
    aiModel: null,
    athleteMessageDraft: null,
    coachEdits: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function buildModernReviewWithStoredLegacyText(): NutritionWeeklyAnalysis {
  return {
    ...buildStaleReview(),
    id: "review-modern-stored-legacy",
    nutritionSummary: {
      generation_mode: "ai",
      methodology_version: "ea_macro_narrative_v1",
      coach_summary_text: "Комментарий: можно дать краткий комментарий.",
      day_by_day_analysis_text: "Комментарий: можно дать краткий комментарий.",
      daily_analysis: [
        {
          date: "2026-06-09",
          training_type: "easy",
          training_label: "лёгкий бег",
          canonicalDailyAnalysis: { date: "2026-06-09" },
          macroGuardrails: { protein: { status: "ok" } },
          energyAvailability: { eaZone: "green" },
          energyFloor: { belowLoadFloor: false },
        },
      ],
    },
  };
}

function buildModernReview(): NutritionWeeklyAnalysis {
  return {
    ...buildStaleReview(),
    id: "review-modern",
    nutritionSummary: {
      generation_mode: "ai",
      methodology_version: "ea_macro_narrative_v1",
      daily_analysis: [
        {
          date: "2026-06-09",
          training_type: "easy",
          training_label: "лёгкий бег",
          canonicalDailyAnalysis: { date: "2026-06-09" },
          macroGuardrails: { protein: { status: "ok" } },
          energyAvailability: { eaZone: "green" },
          energyFloor: { belowLoadFloor: false },
        },
      ],
    },
  };
}

function buildPlan(withPracticalTarget: boolean): NutritionWeeklyPlan {
  return {
    id: "plan-1",
    studentId: "student-1",
    sourceReportId: "report-1",
    sourceAnalysisId: "review-1",
    planWeekFrom: "2026-06-08",
    planWeekTo: "2026-06-14",
    status: "draft_generated",
    generationMode: "fallback",
    promptVersion: null,
    aiModel: null,
    coachSummary: null,
    athleteMessageDraft: null,
    coachEditedDraft: null,
    approvedAt: null,
    planSummary: {
      next_week_plan: {
        days: withPracticalTarget
          ? [{ date: "2026-06-08", practical_target: { target_kcal: 2000 } }]
          : [{ date: "2026-06-08", target_kcal: 2000 }],
      },
    },
    trainingContextSnapshot: {},
    nutritionContextSnapshot: {},
    safetyFlags: {},
    supersededByPlanId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

const staleIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-08",
  selectedWeekTo: "2026-06-14",
  targetPlanWeekFrom: "2026-06-08",
  targetPlanWeekTo: "2026-06-14",
  review: buildStaleReview(),
  plan: null,
  hasReview: true,
});
assert.ok(
  staleIssues.some((issue) => issue.code === "review_stale_methodology"),
  "old review without macroGuardrails must emit review_stale_methodology"
);
assert.ok(
  staleIssues.some((issue) => issue.code === "review_fallback_mode"),
  "fallback review must emit review_fallback_mode"
);
assert.ok(
  staleIssues.some((issue) => issue.code === "daily_dates_mismatch"),
  "daily dates outside selected week must emit daily_dates_mismatch"
);
assert.ok(
  staleIssues.some((issue) => issue.code === "tp_daily_join_mismatch"),
  "TP workouts with all-rest daily rows must emit tp_daily_join_mismatch"
);
assert.ok(
  staleIssues.some((issue) => issue.code === "missing_target_plan"),
  "missing target plan must emit missing_target_plan"
);
assert.ok(
  staleIssues.some((issue) => issue.code === "coach_details_stored_layer"),
  "review present must emit coach_details_stored_layer info"
);

const modernIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-08",
  selectedWeekTo: "2026-06-14",
  targetPlanWeekFrom: "2026-06-08",
  targetPlanWeekTo: "2026-06-14",
  review: buildModernReview(),
  plan: buildPlan(false),
  hasReview: true,
});
assert.ok(
  modernIssues.some((issue) => issue.code === "plan_stale_methodology"),
  "plan without practicalTarget must emit plan_stale_methodology"
);
assert.ok(
  !modernIssues.some((issue) => issue.code === "review_stale_methodology"),
  "modern review must not emit review_stale_methodology"
);

const legacyStoredIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-08",
  selectedWeekTo: "2026-06-14",
  review: buildModernReviewWithStoredLegacyText(),
  hasReview: true,
});
assert.ok(
  !legacyStoredIssues.some((issue) => issue.code === "review_stale_methodology"),
  "stored legacy coach text must not trigger review_stale_methodology when derived facts are modern"
);

const adjustedDateIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-02",
  selectedWeekTo: "2026-06-07",
  reportWeekFrom: "2026-06-02",
  reportWeekTo: "2026-06-07",
  reportMacroDates: ["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"],
  reportDataQuality: {
    date_range_source: "parsed_pdf",
    parsed_week_from: "2026-06-02",
    parsed_week_to: "2026-06-07",
    ui_week_from: "2026-06-08",
    ui_week_to: "2026-06-14",
    date_range_mismatch: true,
    macro_report_overlap_days: 6,
  },
});
assert.ok(
  adjustedDateIssues.some(
    (issue) => issue.code === "report_date_adjusted_from_pdf" && issue.severity === "info"
  ),
  "historical UI mismatch with aligned saved report must downgrade to info"
);
assert.ok(
  !adjustedDateIssues.some(
    (issue) => issue.code === "report_date_mismatch" && issue.severity === "warning"
  ),
  "aligned saved report must not keep active report_date_mismatch warning"
);

const activeMismatchIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-08",
  selectedWeekTo: "2026-06-14",
  reportWeekFrom: "2026-06-08",
  reportWeekTo: "2026-06-14",
  reportMacroDates: ["2026-06-02", "2026-06-03"],
  reportDataQuality: {
    date_range_source: "parsed_pdf",
    parsed_week_from: "2026-06-02",
    parsed_week_to: "2026-06-07",
    ui_week_from: "2026-06-08",
    ui_week_to: "2026-06-14",
    date_range_mismatch: true,
    macro_report_overlap_days: 0,
  },
});
assert.ok(
  activeMismatchIssues.some((issue) => issue.code === "report_date_mismatch" && issue.severity === "warning"),
  "active macro/report mismatch must still warn"
);

const practicalPlanIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-08",
  selectedWeekTo: "2026-06-14",
  targetPlanWeekFrom: "2026-06-08",
  targetPlanWeekTo: "2026-06-14",
  review: buildModernReview(),
  plan: buildPlan(true),
  hasReview: true,
});
assert.ok(
  !practicalPlanIssues.some(
    (issue) => issue.code === "plan_stale_methodology" && issue.severity === "warning"
  ),
  "plan with practicalTarget but missing version must not warn"
);
assert.ok(
  practicalPlanIssues.some(
    (issue) => issue.code === "plan_stale_methodology" && issue.severity === "info"
  ),
  "plan with practicalTarget but missing version may be info only"
);

const wrongWeekIssues = analyzeNutritionPageConsistency({
  selectedWeekFrom: "2026-06-08",
  selectedWeekTo: "2026-06-14",
  targetPlanWeekFrom: "2026-06-08",
  targetPlanWeekTo: "2026-06-14",
  review: buildModernReview(),
  plan: { ...buildPlan(true), planWeekFrom: "2026-06-01", planWeekTo: "2026-06-07" },
  selectedPlanWrongWeek: true,
  hasReview: true,
});
assert.ok(
  wrongWeekIssues.some((issue) => issue.code === "selected_plan_wrong_week"),
  "selected plan from another week must emit selected_plan_wrong_week"
);

assert.equal(reviewHasModernMethodology([]), false);
assert.equal(
  reviewHasModernMethodology([
    {
      date: "2026-06-09",
      trainingType: "easy",
      trainingLabel: "лёгкий бег",
      hasMacroGuardrails: true,
      hasEnergyAvailability: true,
      hasCanonical: true,
      hasEnergyFloor: true,
      isRest: false,
    },
  ]),
  true
);

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
assert.match(mainUi, /analyzeNutritionPageConsistency/, "page must run page consistency analysis");
assert.match(mainUi, /formatNutritionReportDateMismatchCardNotice/, "page must show report date mismatch notice");
assert.match(mainUi, /reportMacroDates/, "page must pass report macro dates into consistency analysis");

assert.match(packageJson, /diagnose:nutrition-page-consistency/, "package.json must include page consistency diagnostic");
assert.match(packageJson, /check:nutrition-page-consistency/, "package.json must include page consistency check");
assert.match(mainUi, /Проверка согласованности/, "page must show consistency check heading");
assert.match(mainUi, /Обзор или фокус требуют обновления/, "page must show consistency warning copy");

assert.match(mainUi, /NutritionDraftCopyBlock[\s\S]*draft=\{combinedMessage\.renderResult\.text\}/, "primary copy block must bind renderResult.text");
assert.doesNotMatch(coachDetailsUi, /NutritionDraftCopyBlock/, "coach details must not expose copy block");

assert.match(studentPage, /copyEnabled=\{false\}/, "stored service drafts must disable copy");
assert.match(studentPage, /Служебный текст, не для отправки напрямую/, "service drafts must warn they are not sendable");

assert.match(mainUi, /buildDerivedNutritionCoachSummary/, "coach details must use derived coach summary helper");
assert.doesNotMatch(
  coachDetailsUi,
  /\{coachSummaryText\}/,
  "main coach details must not display stored coach_summary_text"
);
assert.match(mainUi, /buildDerivedNutritionCoachDayByDayText/, "coach day-by-day prefers derived text");
assert.match(mainUi, /day_by_day_analysis_text/, "coach day-by-day falls back to stored text");
assert.match(mainUi, /Детали для тренера — актуальная сводка/, "coach details must be labeled as derived summary");
assert.match(
  mainUi,
  /Сводка собрана из текущих канонических данных/,
  "coach details must explain derived summary source"
);
assert.match(
  mainUi,
  /Это не текст для отправки ученику/,
  "coach details must warn when review is stale"
);
assert.match(studentPage, /Сохранённый coach_summary_text из БД/, "stored coach summary must remain in collapsed service drafts");
assert.match(pageConsistencySource, /coach_details_stored_layer/, "page consistency helper must keep stored-layer info code");
assert.match(pageConsistencySource, /Старый coach_summary_text — только в служебных черновиках/, "page consistency helper must define stored coach summary audit notice");

assert.match(diagnoseScript, /analyzeNutritionPageConsistency/, "page consistency diagnostic must use shared helper");
assert.match(diagnoseScript, /buildDerivedNutritionCombinedMessage/, "page consistency diagnostic must mirror combined render");
assert.match(diagnoseScript, /getNutritionAdminStudentCard/, "page consistency diagnostic must mirror page card selection");
assert.match(diagnoseScript, /resolveNutritionWeeklyPlanForDisplay/, "page consistency diagnostic must mirror plan resolution");
assert.match(diagnoseScript, /--student-name/, "page consistency diagnostic must accept student name");
assert.match(diagnoseScript, /Daily analysis vs TP context/, "page consistency diagnostic must compare daily vs TP");

assert.match(pageConsistencySource, /report_date_mismatch/, "page consistency helper must detect report date mismatch");
assert.match(pageConsistencySource, /report_date_adjusted_from_pdf/, "page consistency helper must downgrade aligned historical mismatch");
assert.match(pageConsistencySource, /NUTRITION_REVIEW_METHODOLOGY_VERSION/, "page consistency helper must respect methodology version for stale review");
assert.match(diagnoseScript, /asNonemptyObject\(canonical\.macroGuardrails\)/, "diagnostic must resolve nested macroGuardrails");
assert.match(pageConsistencySource, /formatNutritionReportDateMismatchCardNotice/, "page consistency helper must use report date notice formatter");

assert.match(packageJson, /diagnose:nutrition-report-date-coverage/, "package.json must include report date coverage diagnostic");
assert.match(packageJson, /check:nutrition-report-date-source/, "package.json must include report date source check");

// Guards + rationale live in scripts/lib/render-safety-guards.ts (shared with
// check-nutrition-weekly-plan-ui, which carried an identical copy of the old word-level guard).
assert.doesNotMatch(studentPage, SEND_CALL_IN_RENDER, "nutrition page must not call a sender while rendering (bind it to a form action instead)");
assert.doesNotMatch(studentPage, TELEGRAM_BOT_API_HOST, "nutrition page must not hit the Telegram Bot API directly");

// Positive controls — prove the narrowed guard STILL catches a real regression. Without these,
// someone could loosen the pattern later and the check would stay green while the invariant died.
assert.match(
  `${studentPage}\n  await sendNutritionFormButtonToStudent(card.student.id);\n`,
  SEND_CALL_IN_RENDER,
  "guard must still catch a real sender call added to the render path"
);
assert.match(
  `${studentPage}\n  await sendTelegramMessage(card.student.telegramChatId, draft);\n`,
  SEND_CALL_IN_RENDER,
  "guard must still catch a raw Telegram send added to the render path"
);
assert.match(
  `${studentPage}\n  await fetch("https://api.telegram.org/bot123/sendMessage");\n`,
  TELEGRAM_BOT_API_HOST,
  "guard must still catch a direct Bot API fetch"
);

// Negative controls — the exact shapes that made the old guard cry wolf must stay green, and the
// coach-triggered send path must remain allowed.
assert.doesNotMatch("if (card.student.telegramChatId) {", SEND_CALL_IN_RENDER, "reading telegramChatId is data, not a send");
assert.doesNotMatch("<dt>Telegram</dt>", SEND_CALL_IN_RENDER, "a UI label is not a send");
assert.doesNotMatch("<form action={sendNutritionFormAction}>", SEND_CALL_IN_RENDER, "binding a sender to a form action is the ALLOWED coach-triggered path");

// page-consistency.ts is a PURE helper: it has no business even naming Telegram, so the broad
// word-level ban is correct there and stays.
assert.doesNotMatch(pageConsistencySource, /telegram|sendMessage|sendTelegram/i, "page consistency helper must not send Telegram");
assert.doesNotMatch(pageConsistencySource, /moveWorkout|mutateTrainingPeaks|updateWorkout/i, "page consistency helper must not mutate TrainingPeaks");

console.log("PASS check-nutrition-page-consistency");
