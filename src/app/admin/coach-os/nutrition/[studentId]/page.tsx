import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import FormActionButton from "@/app/admin/FormActionButton";
import NutritionDraftCopyBlock from "@/app/admin/coach-os/nutrition/NutritionDraftCopyBlock";
import NutritionFileUploadPanel from "@/app/admin/coach-os/nutrition/NutritionFileUploadPanel";
import { formatIsoDate, getSingleSearchParam } from "@/app/admin/lib";
import {
  addNutritionContextNoteAction,
  addNutritionWeightAction,
  approveNutritionPatternAction,
  dismissNutritionPatternAction,
  removeNutritionApprovedPatternAction,
  archiveNutritionAnalysisAction,
  archiveNutritionReportAction,
  generateNutritionWeeklyReviewAction,
  parseNutritionManualMacrosAction,
  previewNutritionFileUploadAction,
  addNutritionRaceEventAction,
  deleteNutritionRaceEventAction,
  saveNutritionFileReportAction,
  saveNutritionManualMacrosAction,
  saveNutritionCoachContextAction,
  saveNutritionProfileAction,
  updateNutritionReportNotesAction,
  updateNutritionReviewProseAction,
  updateNutritionPlanProseAction,
  sendNutritionFormAction,
  sendNutritionReviewLinkAction,
  approveNutritionReviewAction,
} from "@/app/admin/coach-os/nutrition/actions";
import ConfirmSubmitButton from "@/app/admin/coach-os/nutrition/ConfirmSubmitButton";
import {
  getNutritionAdminStudentCard,
  parseNutritionManualMacros,
} from "@/features/nutrition/admin";
import { buildDerivedNutritionCoachSummary } from "@/features/nutrition/coach-summary";
import {
  applyNutritionCoachEdits,
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
  getNutritionDayProseRejections,
} from "@/features/nutrition/combined-message";
import {
  buildNutritionStudentCardHref,
  formatNutritionAthleteReportSignalCategory,
  formatNutritionCarbStrategy,
  formatNutritionCompactDate,
  formatNutritionConflictFlags,
  formatNutritionContextItemType,
  formatNutritionDataQualitySummary,
  formatNutritionDoNotSendReason,
  formatNutritionEnabled,
  formatNutritionFormality,
  formatNutritionFormalitySource,
  formatNutritionGenerationMode,
  formatNutritionPatternAge,
  formatNutritionPlanWeekRange,
  formatNutritionShortId,
  formatNutritionSourceType,
  formatNutritionStatus,
  formatNutritionTone,
  formatNutritionTpCacheNote,
  formatNutritionTpCacheStatus,
  formatNutritionPlanTrainingContextLine,
  formatNutritionPlanTargetWeekHeading,
  formatNutritionCombinedMessageMissingPlanHint,
  formatNutritionTpNextWeekContextLine,
  NUTRITION_CONTEXT_ITEM_TYPE_LABELS,
  pickDefaultNutritionReport,
  formatBusinessWindowBadge,
} from "@/features/nutrition/admin-labels";
import { getTrainingPeaksBusinessChatLastSeenByChatId } from "@/features/trainingpeaks/repository";
import {
  NUTRITION_FILE_PREVIEW_COOKIE,
  parseNutritionFileUploadPreview,
} from "@/features/nutrition/file-preview-cookie";
import { getNutritionPlanTargetWeekToday } from "@/features/nutrition/plan-week-policy";
import {
  analyzeNutritionPageConsistency,
  getActionablePageConsistencyIssues,
  hasStaleReviewIssues,
} from "@/features/nutrition/page-consistency";
import { formatNutritionReportDateMismatchCardNotice } from "@/features/nutrition/report-date-coverage";
import type { NutritionAthleteReportSignal } from "@/features/nutrition/athlete-signals";
import type { NutritionContextItemType, NutritionWeeklyPlan } from "@/features/nutrition/repository";

type NutritionStudentCardPageProps = {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getCurrentWeekWindow(): { weekFrom: string; weekTo: string } {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1, 12, 0, 0));
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 7, 12, 0, 0));
  return {
    weekFrom: monday.toISOString().slice(0, 10),
    weekTo: sunday.toISOString().slice(0, 10),
  };
}

// 1d/1e: one tappable week per real week the student has (report OR analysis).
type NutritionWeekOption = {
  weekFrom: string;
  weekTo: string;
  hasReport: boolean;
  reportReceivedAt: string | null;
  analysisStatus: string | null;
  analysisAt: string | null;
};

function buildNutritionWeekOptions(
  reports: Array<{ weekFrom: string; weekTo: string; createdAt: string; archivedAt: string | null }>,
  analyses: Array<{ weekFrom: string; weekTo: string; status: string; createdAt: string }>
): NutritionWeekOption[] {
  const byWeek = new Map<string, NutritionWeekOption>();
  const key = (from: string, to: string) => `${from}|${to}`;
  for (const report of reports) {
    if (report.archivedAt) continue; // archived reports don't make a week selectable
    const existing = byWeek.get(key(report.weekFrom, report.weekTo));
    if (existing) {
      existing.hasReport = true;
      if (!existing.reportReceivedAt || report.createdAt > existing.reportReceivedAt) {
        existing.reportReceivedAt = report.createdAt;
      }
    } else {
      byWeek.set(key(report.weekFrom, report.weekTo), {
        weekFrom: report.weekFrom,
        weekTo: report.weekTo,
        hasReport: true,
        reportReceivedAt: report.createdAt,
        analysisStatus: null,
        analysisAt: null,
      });
    }
  }
  for (const analysis of analyses) {
    const existing = byWeek.get(key(analysis.weekFrom, analysis.weekTo));
    if (existing) {
      if (!existing.analysisAt || analysis.createdAt > existing.analysisAt) {
        existing.analysisStatus = analysis.status;
        existing.analysisAt = analysis.createdAt;
      }
    } else {
      byWeek.set(key(analysis.weekFrom, analysis.weekTo), {
        weekFrom: analysis.weekFrom,
        weekTo: analysis.weekTo,
        hasReport: false,
        reportReceivedAt: null,
        analysisStatus: analysis.status,
        analysisAt: analysis.createdAt,
      });
    }
  }
  return [...byWeek.values()].sort((a, b) => b.weekFrom.localeCompare(a.weekFrom));
}

function nutritionWeekReviewLabel(status: string | null): string {
  switch (status) {
    case "approved_for_copy":
      return "разбор готов";
    case "draft_generated":
      return "разбор: черновик";
    case "needs_review":
      return "разбор: на проверку";
    case "blocked_safety":
      return "разбор: блок";
    default:
      return "разбора нет";
  }
}

function formatNutritionReceivedDdMm(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getBadgeClass(status: string): string {
  if (status === "ready_for_analysis" || status === "approved_for_copy" || status === "draft_generated") {
    return "admin-badge admin-badge-success";
  }
  if (status === "blocked_safety" || status === "insufficient") {
    return "admin-badge admin-badge-danger";
  }
  if (status === "needs_review" || status === "awaiting_generation") {
    return "admin-badge admin-badge-warning";
  }
  return "admin-badge admin-badge-outline";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Coach-view only: long dashes "—"/"–" → "-" (Igor's style; the athlete text is
// already cleaned by cleanupPlainText/resolveUsableNutritionDayProse, so this is a
// display-only pass for the coach screens — day-by-day divider, summary, Flow C editor).
function coachShortDashes(value: string): string {
  return value.replace(/[—–]/g, "-");
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asAthleteReportSignals(value: unknown): NutritionAthleteReportSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedCategories = new Set(["fatigue", "gi", "illness", "cycle", "injury", "psych"]);
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const row = item as Record<string, unknown>;
    const category = typeof row.category === "string" ? row.category : "";
    const evidence = typeof row.evidence === "string" ? row.evidence : "";
    const keyword = typeof row.keyword === "string" ? row.keyword : "";
    const severity = row.severity === "coach_review" || row.severity === "info" ? row.severity : null;
    if (!allowedCategories.has(category) || !evidence || !keyword || !severity) {
      return [];
    }
    return [
      {
        category: category as NutritionAthleteReportSignal["category"],
        evidence,
        keyword,
        severity,
      },
    ];
  });
}

function formatDoNotSendReasons(safetyFlags: Record<string, unknown>): string[] {
  const hardFlags = asStringArray(safetyFlags.hard_flags);
  return hardFlags.map((flag) => formatNutritionDoNotSendReason(`manual_review_required:${flag}`));
}

function formatTrainingType(type: string | null | undefined): string {
  switch (type) {
    case "long_run":
      return "длительная";
    case "intervals":
      return "интервалы";
    case "tempo":
      return "темпо";
    case "race":
      return "гонка";
    case "easy":
      return "лёгкий бег";
    case "rest":
      return "отдых";
    case "strength":
      return "силовая";
    default:
      return "неизвестно";
  }
}

function getParsedDays(dataQuality: Record<string, unknown>): string {
  const parsedDays = dataQuality.parsed_days ?? dataQuality.parsedDays;
  return typeof parsedDays === "number" ? String(parsedDays) : "—";
}

function getReportMacroDates(dataQuality: Record<string, unknown>): string[] {
  const parsedDates = dataQuality.parsed_dates;
  if (!Array.isArray(parsedDates)) {
    return [];
  }
  return parsedDates.filter((item): item is string => typeof item === "string");
}

function formatWeekdayRu(isoDate: string): string {
  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "—";
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  return weekdays[date.getUTCDay()] ?? "—";
}

function getPlanFocusText(planSummary: Record<string, unknown>): string | null {
  const planFocus = asObject(planSummary.plan_focus);
  const title = typeof planFocus.title === "string" ? planFocus.title.trim() : "";
  const explanation = typeof planFocus.explanation === "string" ? planFocus.explanation.trim() : "";
  if (title && explanation) {
    return `${title}. ${explanation}`;
  }
  return title || explanation || null;
}

function getPlanKeyTrainingDayLines(planSummary: Record<string, unknown>): string[] {
  const keyDays = Array.isArray(planSummary.key_training_days) ? planSummary.key_training_days : [];
  return keyDays
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const day = item as Record<string, unknown>;
      const date = typeof day.date === "string" ? day.date : null;
      const guidance = typeof day.nutrition_guidance === "string" ? day.nutrition_guidance.trim() : "";
      const workoutType = formatTrainingType(typeof day.workout_type === "string" ? day.workout_type : null);
      const workoutTitle = typeof day.workout_title === "string" ? day.workout_title.trim() : "";
      const label = workoutType !== "неизвестно" ? workoutType : workoutTitle || "тренировка";
      if (!date || !guidance) {
        return null;
      }
      return `${formatWeekdayRu(date)} — ${label}: ${guidance}`;
    })
    .filter((line): line is string => Boolean(line));
}

function getPlanDoNotSendReasons(plan: NutritionWeeklyPlan): string[] {
  const fromSummary = asStringArray(asObject(plan.planSummary).do_not_send_reasons);
  const fromSafety = asStringArray(plan.safetyFlags.do_not_send_reasons);
  const hardFlags = asStringArray(plan.safetyFlags.hard_flags).map((flag) =>
    formatNutritionDoNotSendReason(`manual_review_required:${flag}`)
  );
  return [...new Set([...fromSummary, ...fromSafety, ...hardFlags].map((reason) => reason.trim()).filter(Boolean))];
}

const CONTEXT_ITEM_TYPES = Object.keys(NUTRITION_CONTEXT_ITEM_TYPE_LABELS) as NutritionContextItemType[];

export default async function CoachOsNutritionStudentCardPage({
  params,
  searchParams,
}: NutritionStudentCardPageProps) {
  const { studentId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const rawText = getSingleSearchParam(resolvedSearchParams.macroText) ?? "";
  const weekFromParam = getSingleSearchParam(resolvedSearchParams.weekFrom);
  const weekToParam = getSingleSearchParam(resolvedSearchParams.weekTo);
  const defaultWeek = getCurrentWeekWindow();
  let weekFrom = weekFromParam ?? defaultWeek.weekFrom;
  let weekTo = weekToParam ?? defaultWeek.weekTo;
  if (!weekFromParam && !weekToParam) {
    const { getNutritionStudentDefaultWeek } = await import("@/features/nutrition/repository");
    const nutritionWeek = await getNutritionStudentDefaultWeek(studentId);
    if (nutritionWeek) {
      weekFrom = nutritionWeek.weekFrom;
      weekTo = nutritionWeek.weekTo;
    }
  }
  const reportIdFromQuery = getSingleSearchParam(resolvedSearchParams.reportId);
  const reviewIdFromQuery = getSingleSearchParam(resolvedSearchParams.reviewId);
  const planIdFromQuery = getSingleSearchParam(resolvedSearchParams.planId);

  const card = await getNutritionAdminStudentCard({
    studentId,
    weekFrom,
    weekTo,
    reviewId: reviewIdFromQuery,
  });

  if (!card.student) {
    notFound();
  }

  // Business 24h-window status for the "send form" button (open/closed at render).
  // Non-critical: a failure here must NEVER take down the whole card — degrade to
  // no badge (null) and keep rendering focus / generation / copy / send.
  let windowLastSeenAt: string | null = null;
  try {
    if (card.student.telegramChatId) {
      windowLastSeenAt =
        (await getTrainingPeaksBusinessChatLastSeenByChatId([card.student.telegramChatId])).get(
          card.student.telegramChatId
        ) ?? null;
    }
  } catch (e) {
    console.warn("[nutrition.card] window badge failed", e);
  }

  // Task: history + archive screen — reports (incl. archived) and weekly analyses.
  const { listNutritionReportsForStudent, listNutritionWeeklyAnalysesForStudentHistory } = await import(
    "@/features/nutrition/repository"
  );
  const [reportHistory, analysisHistory] = await Promise.all([
    listNutritionReportsForStudent(studentId, { includeArchived: true, limit: 30 }),
    listNutritionWeeklyAnalysesForStudentHistory(studentId, { limit: 30 }),
  ]);

  // 1d/1e: tappable real weeks (report OR analysis), freshest first; + prev/next.
  const weekOptions = buildNutritionWeekOptions(reportHistory, analysisHistory);
  const selectedWeekIndex = weekOptions.findIndex((w) => w.weekFrom === weekFrom && w.weekTo === weekTo);
  const selectedWeekOption = selectedWeekIndex >= 0 ? weekOptions[selectedWeekIndex] : null;
  const newerWeekOption = selectedWeekIndex > 0 ? weekOptions[selectedWeekIndex - 1] : null;
  const olderWeekOption =
    selectedWeekIndex >= 0 && selectedWeekIndex < weekOptions.length - 1 ? weekOptions[selectedWeekIndex + 1] : null;

  const selectedReportId = pickDefaultNutritionReport(card.reports, reportIdFromQuery);
  const selectedReport = card.reports.find((report) => report.id === selectedReportId) ?? null;
  const selectedReviewId = card.weeklyAnalysis?.id ?? null;

  const targetPlanWeek = card.weeklyAnalysis ? getNutritionPlanTargetWeekToday() : null;
  const planWeek = targetPlanWeek
    ? { from: targetPlanWeek.planWeekFrom, to: targetPlanWeek.planWeekTo, mode: targetPlanWeek.mode }
    : null;
  let planIdWarning: string | null = null;
  let supersededPlanNotice: string | null = null;
  let plansForWeek: NutritionWeeklyPlan[] = [];
  let displayPlan: NutritionWeeklyPlan | null = null;
  let planSelectedById = false;

  if (planWeek) {
    const { resolveNutritionWeeklyPlanForDisplay } = await import("@/features/nutrition/repository");
    const planResolution = await resolveNutritionWeeklyPlanForDisplay({
      studentId,
      planWeekFrom: planWeek.from,
      planWeekTo: planWeek.to,
      planIdFromQuery,
    });
    planIdWarning = planResolution.planIdWarning;
    supersededPlanNotice = planResolution.supersededPlanNotice;
    plansForWeek = planResolution.plansForWeek;
    displayPlan = planResolution.displayPlan;
    planSelectedById = planResolution.planSelectedById;
  }

  const selectedPlanId = displayPlan?.id ?? null;
  const visiblePlansForWeek = plansForWeek.slice(0, 3);
  const hiddenPlanCount = Math.max(0, plansForWeek.length - visiblePlansForWeek.length);

  const studentCardPath = buildNutritionStudentCardHref({
    studentId,
    weekFrom,
    weekTo,
    reportId: selectedReportId,
    reviewId: selectedReviewId,
    planId: selectedPlanId,
  });

  const parsedPreview = rawText
    ? await parseNutritionManualMacros({
        studentId,
        weekFrom,
        weekTo,
        rawText,
      })
    : null;
  const cookieStore = await cookies();
  const fileUploadPreview = parseNutritionFileUploadPreview(cookieStore.get(NUTRITION_FILE_PREVIEW_COOKIE)?.value);
  const activeFilePreview =
    fileUploadPreview &&
    fileUploadPreview.studentId === studentId &&
    fileUploadPreview.weekFrom === weekFrom &&
    fileUploadPreview.weekTo === weekTo
      ? fileUploadPreview
      : null;
  // The coach must see HIS OWN text in the editor, not the model line he replaced. The overlay
  // is merged once, here, so every derived thing below — the textareas, the focus and opening
  // defaults, the rejection banner — speaks about the text that will actually be sent.
  const effectiveWeeklyAnalysis = card.weeklyAnalysis ? applyNutritionCoachEdits(card.weeklyAnalysis) : null;
  const weeklyNutritionSummary = asObject(effectiveWeeklyAnalysis?.nutritionSummary);
  const dailyAnalysis = Array.isArray(weeklyNutritionSummary.daily_analysis)
    ? (weeklyNutritionSummary.daily_analysis as Array<Record<string, unknown>>)
    : [];
  const importantDays = dailyAnalysis.filter((day) => {
    const relevance = typeof day.relevance === "string" ? day.relevance : "";
    return relevance === "high" || relevance === "medium";
  });
  const trainingLinks = Array.isArray(weeklyNutritionSummary.training_nutrition_links)
    ? (weeklyNutritionSummary.training_nutrition_links as string[])
    : [];
  const oneFocus = asObject(weeklyNutritionSummary.one_focus);
  // Flow C v1-B: per-block prose for the inline review editor. The textarea stays bound to
  // the RAW canonical athlete_prose — that is the only editable source, and writing the
  // validated render back into it would overwrite the model prose with its own fallback.
  // But raw != what the athlete gets: the render-time gate drops a day to the dry
  // deterministic comment when it carries a number that is not a fact of that day, markdown,
  // a leaked tech token… — for MODEL prose and for a COACH edit alike.
  //
  // Which days were dropped comes from the RENDER ITSELF (getNutritionDayProseRejections), not
  // from re-running the validator on the raw day. Re-running it here was wrong in both
  // directions: the gate judges the CLEANED prose (so a day the raw check condemns can render
  // fine) and it also rejects markdown/tech tokens (which the raw check never sees). Only the
  // render knows what the athlete actually got.
  const proseRejectionByDate = new Map(
    getNutritionDayProseRejections(effectiveWeeklyAnalysis)
      .filter((rejection): rejection is typeof rejection & { date: string } => typeof rejection.date === "string")
      .map((rejection) => [rejection.date, rejection])
  );
  type NutritionReviewProseBlock = {
    date: string;
    label: string;
    prose: string;
    isReplaced: boolean;
    rejectionReasons: string[];
    willSendProse: string;
  };
  const reviewProseBlocks = dailyAnalysis
    .map((day): NutritionReviewProseBlock | null => {
      const date = typeof day.date === "string" ? day.date : null;
      if (!date) {
        return null;
      }
      const weekday = typeof day.weekday_ru === "string" ? day.weekday_ru : null;
      const dateLabel = typeof day.date_label === "string" ? day.date_label : null;
      const rawProse = typeof day.athlete_prose === "string" ? day.athlete_prose : "";
      const rejection = proseRejectionByDate.get(date);
      return {
        date,
        label: [weekday, dateLabel].filter(Boolean).join(" · ") || date,
        prose: coachShortDashes(rawProse),
        isReplaced: rejection != null,
        rejectionReasons: rejection?.messages ?? [],
        willSendProse: coachShortDashes(rejection?.willSendProse ?? ""),
      };
    })
    .filter((block): block is NutritionReviewProseBlock => block !== null);
  const replacedProseBlocks = reviewProseBlocks.filter((block) => block.isReplaced);
  const reviewFocusStatement = coachShortDashes(typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : "");
  const reviewOpeningNote = coachShortDashes(
    typeof weeklyNutritionSummary.athlete_opening_note_ru === "string"
      ? weeklyNutritionSummary.athlete_opening_note_ru
      : ""
  );
  const methodologySignals = asObject(weeklyNutritionSummary.methodology_signals);
  const dataQualitySummary = asObject(weeklyNutritionSummary.data_quality_summary);
  const coachSummaryText =
    typeof weeklyNutritionSummary.coach_summary_text === "string"
      ? weeklyNutritionSummary.coach_summary_text
      : null;
  const dayByDayAnalysisText =
    typeof weeklyNutritionSummary.day_by_day_analysis_text === "string"
      ? weeklyNutritionSummary.day_by_day_analysis_text
      : null;
  const generationMode =
    typeof weeklyNutritionSummary.generation_mode === "string"
      ? weeklyNutritionSummary.generation_mode
      : "fallback";
  const promptVersion =
    typeof weeklyNutritionSummary.prompt_version === "string"
      ? weeklyNutritionSummary.prompt_version
      : card.weeklyAnalysis?.promptHash ?? "—";
  const bodyweightKg =
    typeof weeklyNutritionSummary.bodyweight_kg === "number"
      ? weeklyNutritionSummary.bodyweight_kg
      : card.context.currentWeightKg;
  const carbStrategy =
    typeof weeklyNutritionSummary.carb_progression_strategy === "string"
      ? weeklyNutritionSummary.carb_progression_strategy
      : typeof oneFocus.progression_strategy === "string"
        ? oneFocus.progression_strategy
        : null;
  const oneFocusText = typeof oneFocus.statement_ru === "string" ? oneFocus.statement_ru : null;
  const athleteReportSignals = asAthleteReportSignals(weeklyNutritionSummary.athlete_report_signals);
  const patternCandidates = (
    Array.isArray(weeklyNutritionSummary.pattern_candidates) ? weeklyNutritionSummary.pattern_candidates : []
  )
    .map((item) => asObject(item))
    .map((item) => ({
      code: typeof item.code === "string" ? item.code : "",
      text: typeof item.text === "string" ? item.text : "",
      sinceWeek: typeof item.since_week === "string" ? item.since_week : "",
      weeksObserved: typeof item.weeks_observed === "number" ? item.weeks_observed : 0,
    }))
    .filter((item) => item.code && item.text);
  const approvedPatternsTodayIso = new Date().toISOString();
  const approvedPatterns = (card.profile?.nutritionMemory?.approved_patterns ?? []).map((item) => ({
    text: item.text,
    sinceWeek: item.since_week,
    ageLabel: formatNutritionPatternAge(item.since_week, approvedPatternsTodayIso),
    staleness: card.approvedPatternsStaleness?.[item.text] ?? null,
  }));
  const hardSafetyFlags = asStringArray(card.weeklyAnalysis?.safetyFlags?.hard_flags);
  const hasSafetyFlags = hardSafetyFlags.length > 0;
  const reviewSelectedById = Boolean(reviewIdFromQuery && card.weeklyAnalysis?.id === reviewIdFromQuery);
  const profileWeightKg = card.profile?.currentWeightKg ?? card.weightLogs[0]?.weightKg ?? null;
  const profileFormality = formatNutritionFormality(card.context.resolvedCommunicationProfile.formality);
  const recentReports = [...card.reports].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const visibleReports = recentReports.slice(0, 5);
  const hiddenReportCount = Math.max(0, recentReports.length - visibleReports.length);
  const reviewSourceReportId = card.weeklyAnalysis?.reportId ?? null;
  const reviewReportMismatch = Boolean(
    card.weeklyAnalysis && selectedReportId && reviewSourceReportId && selectedReportId !== reviewSourceReportId
  );
  const savedReviewTpNextWeek = card.weeklyAnalysis ? asObject(card.weeklyAnalysis.tpNextWeekContext) : {};
  const displayPlanSummary = displayPlan ? asObject(displayPlan.planSummary) : {};
  const displayPlanTrainingSnapshot = displayPlan ? asObject(displayPlan.trainingContextSnapshot) : {};
  const displayPlanFocusText = getPlanFocusText(displayPlanSummary);
  const displayPlanKeyDayLines = getPlanKeyTrainingDayLines(displayPlanSummary);
  const displayPlanSimpleActions = asStringArray(displayPlanSummary.simple_actions);
  const displayPlanSafetyNotes = asStringArray(displayPlanSummary.safety_notes);
  const displayPlanDoNotSendReasons = displayPlan ? getPlanDoNotSendReasons(displayPlan) : [];
  const combinedMessage = buildDerivedNutritionCombinedMessage({
    review: card.weeklyAnalysis,
    plan: displayPlan,
    formality: card.context.resolvedCommunicationProfile.formality,
    studentName: card.student.studentName,
    profilePreferences: card.profile?.preferences ?? null,
    planWeekMode: planWeek?.mode,
  });
  const derivedCoachDayByDayTextRaw = buildDerivedNutritionCoachDayByDayText(card.weeklyAnalysis);
  // Coach day-by-day carries the "— — —" day divider raw (the athlete render cleans it,
  // this coach view does not) → normalize long dashes for the coach screen.
  const derivedCoachDayByDayText =
    derivedCoachDayByDayTextRaw != null ? coachShortDashes(derivedCoachDayByDayTextRaw) : null;
  const coachDayByDayDisplayText = derivedCoachDayByDayText ?? dayByDayAnalysisText;
  const combinedDoNotSendReasons = [
    ...new Set([
      ...formatDoNotSendReasons(asObject(card.weeklyAnalysis?.safetyFlags)),
      ...displayPlanDoNotSendReasons,
    ]),
  ];
  const selectedPlanWrongWeek = Boolean(
    displayPlan &&
      planWeek &&
      planSelectedById &&
      (displayPlan.planWeekFrom !== planWeek.from || displayPlan.planWeekTo !== planWeek.to)
  );
  const pageConsistencyIssues = analyzeNutritionPageConsistency({
    selectedWeekFrom: weekFrom,
    selectedWeekTo: weekTo,
    targetPlanWeekFrom: planWeek?.from ?? null,
    targetPlanWeekTo: planWeek?.to ?? null,
    review: card.weeklyAnalysis,
    plan: displayPlan,
    selectedPlanWrongWeek,
    hasReview: Boolean(card.weeklyAnalysis),
    reportDataQuality: selectedReport ? asObject(selectedReport.dataQuality) : null,
    reportWeekFrom: selectedReport?.weekFrom ?? null,
    reportWeekTo: selectedReport?.weekTo ?? null,
    reportMacroDates: selectedReport ? getReportMacroDates(asObject(selectedReport.dataQuality)) : [],
  });
  const selectedReportDateNotice = selectedReport
    ? formatNutritionReportDateMismatchCardNotice(asObject(selectedReport.dataQuality))
    : null;
  const actionableConsistencyIssues = getActionablePageConsistencyIssues(pageConsistencyIssues);
  const derivedCoachSummaryTextRaw = card.weeklyAnalysis
    ? buildDerivedNutritionCoachSummary({
        review: card.weeklyAnalysis,
        plan: displayPlan,
        consistencyIssues: pageConsistencyIssues,
      })
    : null;
  const derivedCoachSummaryText =
    derivedCoachSummaryTextRaw != null ? coachShortDashes(derivedCoachSummaryTextRaw) : null;
  const showCoachDetailsStaleHint = hasStaleReviewIssues(pageConsistencyIssues);

  return (
    <section className="admin-section admin-nutrition-page">
      <div className="admin-section-header">
        <div>
          <Link className="admin-backlink" href="/admin/coach-os/nutrition">
            ← Питание
          </Link>
          <h2>Карточка питания · {card.student.studentName}</h2>
          <p className="admin-muted">
            {card.student.studentId} · {card.student.id}
          </p>
        </div>
        <span className={`admin-badge ${card.student.isActive ? "admin-badge-success" : "admin-badge-warning"}`}>
          {card.student.isActive ? "Активен" : "Архив"}
        </span>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>{error ?? notice}</div>
      )}

      <article className="admin-card admin-card-compact admin-nutrition-card-wide admin-nutrition-profile-compact">
        <h3>Неделя и профиль</h3>
        <div className="admin-nutrition-week-row">
          <span className="admin-nutrition-week-label">Неделя:</span>
          {newerWeekOption ? (
            <Link
              className="admin-button admin-button-secondary admin-button-compact"
              href={buildNutritionStudentCardHref({
                studentId,
                weekFrom: newerWeekOption.weekFrom,
                weekTo: newerWeekOption.weekTo,
              })}
              aria-label="Следующая неделя"
            >
              ‹
            </Link>
          ) : (
            <span className="admin-button admin-button-secondary admin-button-compact admin-button-disabled">‹</span>
          )}
          <strong>{formatNutritionPlanWeekRange(weekFrom, weekTo)}</strong>
          {olderWeekOption ? (
            <Link
              className="admin-button admin-button-secondary admin-button-compact"
              href={buildNutritionStudentCardHref({
                studentId,
                weekFrom: olderWeekOption.weekFrom,
                weekTo: olderWeekOption.weekTo,
              })}
              aria-label="Предыдущая неделя"
            >
              ›
            </Link>
          ) : (
            <span className="admin-button admin-button-secondary admin-button-compact admin-button-disabled">›</span>
          )}
          {selectedWeekOption?.reportReceivedAt ? (
            <span className="admin-nutrition-week-received admin-muted">
              отчёт получен {formatNutritionReceivedDdMm(selectedWeekOption.reportReceivedAt)}
            </span>
          ) : null}
        </div>
        {weekOptions.length > 0 ? (
          <ul className="admin-nutrition-week-list">
            {weekOptions.map((option) => {
              const isSelected = option.weekFrom === weekFrom && option.weekTo === weekTo;
              return (
                <li key={`${option.weekFrom}-${option.weekTo}`}>
                  <Link
                    className={`admin-nutrition-week-pill${isSelected ? " admin-nutrition-week-pill-active" : ""}`}
                    href={buildNutritionStudentCardHref({
                      studentId,
                      weekFrom: option.weekFrom,
                      weekTo: option.weekTo,
                    })}
                  >
                    <span className="admin-nutrition-week-pill-range">
                      {formatNutritionPlanWeekRange(option.weekFrom, option.weekTo)}
                    </span>
                    <span className="admin-muted">
                      {option.hasReport ? "отчёт" : "нет отчёта"} · {nutritionWeekReviewLabel(option.analysisStatus)}
                      {option.reportReceivedAt ? ` · получен ${formatNutritionReceivedDdMm(option.reportReceivedAt)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-muted">Недель с отчётом или разбором пока нет.</p>
        )}
        <details className="admin-nutrition-week-manual">
          <summary className="admin-muted">Ввести неделю вручную</summary>
          <form className="admin-form-inline admin-nutrition-week-row" method="get">
            {selectedReportId ? <input type="hidden" name="reportId" value={selectedReportId} /> : null}
            {selectedReviewId ? <input type="hidden" name="reviewId" value={selectedReviewId} /> : null}
            {selectedPlanId ? <input type="hidden" name="planId" value={selectedPlanId} /> : null}
            <label className="admin-form-field">
              <span>с</span>
              <input className="admin-input" type="date" name="weekFrom" defaultValue={weekFrom} />
            </label>
            <label className="admin-form-field">
              <span>по</span>
              <input className="admin-input" type="date" name="weekTo" defaultValue={weekTo} />
            </label>
            <button className="admin-button admin-button-secondary" type="submit">
              Показать
            </button>
          </form>
        </details>
        <p className="admin-nutrition-inline-meta">
          Питание: {formatNutritionEnabled(card.profile?.enabled ?? false).toLowerCase()} · Вес:{" "}
          {profileWeightKg ?? "—"} кг · Стиль: {profileFormality}
        </p>
      </article>

      <article className="admin-card admin-card-compact admin-nutrition-card-wide">
        <h3>Контекст для разбора питания</h3>
        <p className="admin-muted admin-nutrition-helper">
          1–3 предложения для AI: что сейчас важно учесть по ученику. Постоянный контекст, виден только в сводке тренеру (ученику не цитируется). Не история болезни, а рабочий контекст.
        </p>
        <form className="admin-form-stack" action={saveNutritionCoachContextAction}>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="redirectTo" value={studentCardPath} />
          <label className="admin-form-field">
            <span>Контекст для разбора питания</span>
            <textarea
              className="admin-textarea admin-textarea-compact"
              name="coachContextRu"
              rows={3}
              maxLength={500}
              placeholder="Например: недавно подняли объём, после болезни, готовится к старту, нужен мягкий тон."
              defaultValue={card.profile?.coachContextRu ?? ""}
            />
          </label>
          <FormActionButton className="admin-button" pendingText="Сохраняю…">
            Сохранить контекст
          </FormActionButton>
        </form>
      </article>

      <article className="admin-card admin-card-compact admin-nutrition-card-wide">
        <h3>Старты (углеводная загрузка)</h3>
        <p className="admin-muted admin-nutrition-helper">
          Старты подтягиваются автоматически из скана TP (/tp_races). Здесь можно добавить старт вручную, если он не отсканирован или появился поздно — ручная пометка переопределяет скан.
        </p>
        {(card.context.raceEvents ?? []).length > 0 ? (
          <ul className="admin-nutrition-race-list">
            {card.context.raceEvents.map((race) => (
              <li key={`${race.eventDate}-${race.source}`}>
                <span>
                  {race.eventDate} — {race.title ?? "Старт"}
                  {race.distanceKm ? ` · ${race.distanceKm} км` : ""}{" "}
                  <span className="admin-muted">({race.source === "manual" ? "вручную" : "скан"})</span>
                </span>
                {race.source === "manual" ? (
                  <form action={deleteNutritionRaceEventAction} className="admin-form-inline">
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="redirectTo" value={studentCardPath} />
                    <input type="hidden" name="raceDate" value={race.eventDate} />
                    <FormActionButton className="admin-button admin-button-secondary" pendingText="Удаляю…">
                      Убрать
                    </FormActionButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">Стартов в окне разбора/плана не найдено.</p>
        )}
        <form className="admin-form-stack" action={addNutritionRaceEventAction}>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="redirectTo" value={studentCardPath} />
          <label className="admin-form-field">
            <span>Дата старта (ГГГГ-ММ-ДД)</span>
            <input className="admin-input" name="raceDate" placeholder="2026-06-20" />
          </label>
          <label className="admin-form-field">
            <span>Дистанция, км (опц. — определяет протокол загрузки)</span>
            <input className="admin-input" name="raceDistanceKm" type="number" step="0.1" placeholder="21.1" />
          </label>
          <label className="admin-form-field">
            <span>Название (опц.)</span>
            <input className="admin-input" name="raceTitle" placeholder="Ночной забег" />
          </label>
          <FormActionButton className="admin-button" pendingText="Сохраняю…">
            Добавить старт вручную
          </FormActionButton>
        </form>
      </article>

      {actionableConsistencyIssues.length > 0 ? (
        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Проверка согласованности</h3>
          <div className="admin-alert admin-alert-warning">
            <strong>⚠️ Обзор или фокус требуют обновления</strong>
            <p className="admin-muted">
              Этот обзор создан до текущей методики питания или не совпадает с выбранной неделей. Перегенерируйте
              обзор, затем сгенерируйте фокус.
            </p>
          </div>
          <ul className="admin-list">
            {actionableConsistencyIssues.map((issue) => (
              <li key={issue.code}>
                {issue.message}
                {issue.action ? ` → ${issue.action}` : ""}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <div className="admin-card admin-card-compact">
        <div className="admin-inline-actions">
          <form action={sendNutritionFormAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="redirectTo" value={studentCardPath} />
            <FormActionButton
              className="admin-button admin-button-secondary admin-button-compact"
              pendingText="Отправка…"
            >
              Отправить форму этому ученику
            </FormActionButton>
          </form>
          {(() => {
            const w = formatBusinessWindowBadge(windowLastSeenAt);
            return (
              <span className="admin-muted" style={{ fontSize: 13 }}>
                {w.icon} {w.label}
                {w.isOpen
                  ? " — дойдёт сейчас."
                  : w.unknown
                    ? " — дойдёт, когда ученица напишет."
                    : " — дойдёт, когда ученица напишет (окно 24 ч)."}
              </span>
            );
          })()}
        </div>
      </div>

      <div className="admin-grid admin-grid-student-detail">
        <NutritionFileUploadPanel
          studentId={studentId}
          weekFrom={weekFrom}
          weekTo={weekTo}
          redirectTo={studentCardPath}
          initialPreview={activeFilePreview}
          previewAction={previewNutritionFileUploadAction}
          saveAction={saveNutritionFileReportAction}
        />

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Отчёт питания за неделю</h3>
          {!selectedReport ? (
            <p className="admin-muted">Сначала сохраните или выберите отчёт питания за эту неделю.</p>
          ) : (
            <>
              <p className="admin-nutrition-selected-card">
                Выбран: <code className="admin-nutrition-code">{formatNutritionShortId(selectedReport.id)}</code> ·{" "}
                {formatNutritionStatus(selectedReport.status, "report")} ·{" "}
                {formatNutritionSourceType(selectedReport.sourceType)} · создан{" "}
                {formatNutritionCompactDate(selectedReport.createdAt)}
              </p>
              {selectedReportDateNotice ? (
                <p className="admin-alert admin-alert-warning admin-nutrition-helper">{selectedReportDateNotice}</p>
              ) : null}
              {/* Inline-редактирование заметок СУЩЕСТВУЮЩЕГО отчёта (в т.ч. авто-
                  загруженного ученицей). Слова ученицы → raw_text, заметка тренера
                  → coach_notes_ru; оба доезжают в контекст разбора. НЕ путать с
                  «Текстом макросов» ручного ввода — это другое поле. */}
              <details className="admin-nutrition-helper">
                <summary>Заметки к отчёту (слова ученицы / тренера)</summary>
                <form className="admin-form-stack" action={updateNutritionReportNotesAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="reportId" value={selectedReport.id} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <label className="admin-form-field">
                    <span>Слова ученицы (что прислала сама)</span>
                    <textarea
                      className="admin-textarea admin-textarea-compact"
                      name="studentNotes"
                      rows={2}
                      defaultValue={selectedReport.rawText ?? ""}
                      placeholder="Слова ученицы как есть: «очень старалась», «не было аппетита из-за жары». Разбор учтёт их тоном."
                    />
                  </label>
                  <label className="admin-form-field">
                    <span>Заметка тренера (для разбора, не отправляется ученице)</span>
                    <textarea
                      className="admin-textarea admin-textarea-compact"
                      name="coachNotesRu"
                      rows={2}
                      defaultValue={selectedReport.coachNotesRu ?? ""}
                      placeholder="Контекст для разбора: травма, поездка, особый режим питания на этой неделе."
                    />
                  </label>
                  <FormActionButton className="admin-button admin-button-secondary" pendingText="Сохраняю…">
                    Сохранить заметки к отчёту
                  </FormActionButton>
                </form>
              </details>
            </>
          )}

          {recentReports.length > 0 ? (
            <>
              <p className="admin-muted">Сохранённые отчёты за неделю:</p>
              <div className="admin-nutrition-mini-table">
                {visibleReports.map((report) => {
                  const isSelected = report.id === selectedReportId;
                  const reportHref = buildNutritionStudentCardHref({
                    studentId,
                    weekFrom,
                    weekTo,
                    reportId: report.id,
                    reviewId: isSelected ? selectedReviewId : null,
                  });
                  return (
                    <div
                      key={report.id}
                      className={`admin-nutrition-mini-table-row${isSelected ? " admin-nutrition-mini-table-row-selected" : ""}`}
                    >
                      {isSelected ? (
                        <span className="admin-nutrition-mini-table-badge">выбран</span>
                      ) : (
                        <Link className="admin-backlink" href={reportHref}>
                          открыть
                        </Link>
                      )}
                      <span>
                        {formatNutritionCompactDate(report.createdAt)} ·{" "}
                        {formatNutritionStatus(report.status, "report")} ·{" "}
                        {formatNutritionSourceType(report.sourceType)} · {getParsedDays(report.dataQuality)} дней
                      </span>
                    </div>
                  );
                })}
              </div>
              {hiddenReportCount > 0 ? (
                <details>
                  <summary>Показать все отчёты ({recentReports.length})</summary>
                  <div className="admin-nutrition-mini-table">
                    {recentReports.slice(5).map((report) => {
                      const isSelected = report.id === selectedReportId;
                      const reportHref = buildNutritionStudentCardHref({
                        studentId,
                        weekFrom,
                        weekTo,
                        reportId: report.id,
                        reviewId: isSelected ? selectedReviewId : null,
                      });
                      return (
                        <div
                          key={report.id}
                          className={`admin-nutrition-mini-table-row${isSelected ? " admin-nutrition-mini-table-row-selected" : ""}`}
                        >
                          {isSelected ? (
                            <span className="admin-nutrition-mini-table-badge">выбран</span>
                          ) : (
                            <Link className="admin-backlink" href={reportHref}>
                              открыть
                            </Link>
                          )}
                          <span>
                            {formatNutritionCompactDate(report.createdAt)} ·{" "}
                            {formatNutritionStatus(report.status, "report")} ·{" "}
                            {formatNutritionSourceType(report.sourceType)} · {getParsedDays(report.dataQuality)} дней
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <p className="admin-muted">Отчётов за период {weekFrom} — {weekTo} пока нет.</p>
          )}
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Разбор прошлой недели</h3>
          <form className="admin-nutrition-review-row" action={generateNutritionWeeklyReviewAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="weekFrom" value={weekFrom} />
            <input type="hidden" name="weekTo" value={weekTo} />
            <input type="hidden" name="redirectTo" value={studentCardPath} />
            <label className="admin-form-field">
              <span>Отчёт</span>
              {card.reports.length > 0 ? (
                <select className="admin-input" name="reportId" required defaultValue={selectedReportId ?? undefined}>
                  {card.reports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {formatNutritionCompactDate(report.createdAt)} · {formatNutritionStatus(report.status, "report")} ·{" "}
                      {formatNutritionShortId(report.id)}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="admin-input" name="reportId" placeholder="Сначала сохраните отчёт" required disabled />
              )}
            </label>
            <FormActionButton className="admin-button" pendingText="Генерирую…" disabled={!selectedReportId}>
              Сгенерировать обзор
            </FormActionButton>
          </form>

          {!card.weeklyAnalysis ? (
            <p className="admin-muted admin-nutrition-helper">Обзор ещё не сгенерирован.</p>
          ) : (
            <p className="admin-nutrition-inline-meta admin-nutrition-helper">
              Сохранённый обзор: {formatNutritionGenerationMode(generationMode)} ·{" "}
              {formatNutritionStatus(card.weeklyAnalysis.status, "analysis")} · обновлён{" "}
              {formatNutritionCompactDate(card.weeklyAnalysis.updatedAt)} · review{" "}
              <code className="admin-nutrition-code">{formatNutritionShortId(card.weeklyAnalysis.id)}</code>
              {reviewSelectedById ? " · выбран по ссылке" : ""}
            </p>
          )}
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide admin-nutrition-plan-card">
          <h3>{planWeek ? formatNutritionPlanTargetWeekHeading(planWeek.mode) : "Фокус питания"}</h3>
          {!card.weeklyAnalysis ? (
            <p className="admin-muted admin-nutrition-helper">Сначала сгенерируйте разбор прошлой недели.</p>
          ) : (
            <>
              {supersededPlanNotice ? (
                <p className="admin-muted admin-nutrition-helper">{supersededPlanNotice}</p>
              ) : null}
              {planIdWarning ? <p className="admin-muted admin-nutrition-helper">{planIdWarning}</p> : null}
              {reviewReportMismatch ? (
                <p className="admin-muted admin-nutrition-helper">
                  Выбранный отчёт отличается от отчёта, по которому создан обзор. Фокус будет построен по сохранённому
                  обзору.
                </p>
              ) : null}
              {planWeek ? (
                <p className="admin-nutrition-inline-meta">
                  Неделя: {formatNutritionPlanWeekRange(planWeek.from, planWeek.to)}
                  {" "}
                  · Основан на: обзор{" "}
                  <code className="admin-nutrition-code">{formatNutritionShortId(card.weeklyAnalysis.id)}</code>
                  {card.weeklyAnalysis.reportId || selectedReportId ? (
                    <>
                      {" "}
                      · отчёт{" "}
                      <code className="admin-nutrition-code">
                        {formatNutritionShortId(card.weeklyAnalysis.reportId ?? selectedReportId)}
                      </code>
                    </>
                  ) : null}
                </p>
              ) : null}
              <p className="admin-nutrition-inline-meta admin-nutrition-helper">
                {displayPlan
                  ? formatNutritionPlanTrainingContextLine(displayPlanTrainingSnapshot)
                  : formatNutritionTpNextWeekContextLine(savedReviewTpNextWeek)}
              </p>

              <p className="admin-muted admin-nutrition-helper">
                План на неделю генерируется вместе с разбором прошлой недели одним вызовом модели. Чтобы обновить план,
                нажмите «Сгенерировать обзор» выше — план пересоберётся в том же голосе.
              </p>

              {!displayPlan ? (
                <p className="admin-muted admin-nutrition-helper">Сохранённого фокуса на эту неделю пока нет.</p>
              ) : (
                <>
                  <p className="admin-nutrition-inline-meta admin-nutrition-helper">
                    Сохранённый фокус: {formatNutritionGenerationMode(displayPlan.generationMode)} ·{" "}
                    {formatNutritionStatus(displayPlan.status, "weekly_plan")} · обновлён{" "}
                    {formatNutritionCompactDate(displayPlan.updatedAt)} · plan{" "}
                    <code className="admin-nutrition-code">{formatNutritionShortId(displayPlan.id)}</code>
                    {planSelectedById ? " · выбран по ссылке" : ""}
                  </p>

                  <div className="admin-nutrition-plan-sections">
                    <section>
                      <h4>Главный фокус</h4>
                      {displayPlanFocusText ? (
                        <p className="admin-nutrition-text-block">{displayPlanFocusText}</p>
                      ) : (
                        <p className="admin-muted">Главный фокус не сформирован.</p>
                      )}
                    </section>

                    <section>
                      <h4>Ключевые дни</h4>
                      {displayPlanKeyDayLines.length === 0 ? (
                        <p className="admin-muted">Ключевые дни не выделены.</p>
                      ) : (
                        <ul className="admin-list">
                          {displayPlanKeyDayLines.map((line, idx) => (
                            <li key={`plan-key-day-${idx}`}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {displayPlanSimpleActions.length > 0 ? (
                      <section>
                        <h4>Простые действия</h4>
                        <ul className="admin-list">
                          {displayPlanSimpleActions.map((action, idx) => (
                            <li key={`plan-action-${idx}`}>{action}</li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {displayPlanSafetyNotes.length > 0 || displayPlan.status === "blocked_safety" ? (
                      <section>
                        <h4>Заметки безопасности</h4>
                        {displayPlanSafetyNotes.length === 0 ? (
                          <p className="admin-muted">Заметки не добавлены.</p>
                        ) : (
                          <ul className="admin-list">
                            {displayPlanSafetyNotes.map((note, idx) => (
                              <li key={`plan-safety-${idx}`}>{note}</li>
                            ))}
                          </ul>
                        )}
                      </section>
                    ) : null}
                  </div>

                  {displayPlan.athleteMessageDraft ? null : (
                    <>
                      <p className="admin-muted">Черновик ученику не создан — проверьте причины ниже.</p>
                      {displayPlanDoNotSendReasons.length > 0 ? (
                        <ul className="admin-list">
                          {displayPlanDoNotSendReasons.map((reason, idx) => (
                            <li key={`plan-dnr-${idx}`}>{reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}

                  {plansForWeek.length > 0 ? (
                    <details className="admin-nutrition-plan-history">
                      <summary>Другие версии фокуса за эту неделю</summary>
                      <div className="admin-nutrition-mini-table">
                        {visiblePlansForWeek.map((plan) => {
                          const isSelected = plan.id === displayPlan.id;
                          const planHref = buildNutritionStudentCardHref({
                            studentId,
                            weekFrom,
                            weekTo,
                            reportId: selectedReportId,
                            reviewId: selectedReviewId,
                            planId: plan.id,
                          });
                          return (
                            <div
                              key={plan.id}
                              className={`admin-nutrition-mini-table-row${isSelected ? " admin-nutrition-mini-table-row-selected" : ""}`}
                            >
                              {isSelected ? (
                                <span className="admin-nutrition-mini-table-badge">выбран</span>
                              ) : (
                                <Link className="admin-backlink" href={planHref}>
                                  открыть
                                </Link>
                              )}
                              <span>
                                {formatNutritionCompactDate(plan.updatedAt)} ·{" "}
                                {formatNutritionStatus(plan.status, "weekly_plan")} ·{" "}
                                {formatNutritionGenerationMode(plan.generationMode)} ·{" "}
                                <code className="admin-nutrition-code">{formatNutritionShortId(plan.id)}</code>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {hiddenPlanCount > 0 ? (
                        <p className="admin-muted">Ещё {hiddenPlanCount} версий — см. «Дополнительно».</p>
                      ) : null}
                    </details>
                  ) : null}
                </>
              )}
            </>
          )}
        </article>

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Черновик ученику — полный текст</h3>
          <p className="admin-muted">Основной текст для отправки ученику. Копируйте именно этот блок.</p>
          {replacedProseBlocks.length > 0 ? (
            <div className="admin-alert admin-alert-error">
              <strong>
                {replacedProseBlocks.length} из {reviewProseBlocks.length} дн. уйдут ученице НЕ тем текстом, что в
                редакторе.
              </strong>{" "}
              Проза этих дней не проходит проверку чисел и молча заменяется на сухой автокомментарий:{" "}
              {replacedProseBlocks.map((block) => block.label).join(", ")}. Открой «Редактировать текст для ученицы» —
              там показано, что именно уйдёт и почему.
            </div>
          ) : null}
          {(card.weeklyAnalysis && reviewProseBlocks.length > 0) || displayPlan ? (
            <details className="admin-nutrition-helper" open={replacedProseBlocks.length > 0}>
              <summary>
                ✏️ Редактировать текст для ученицы
                {replacedProseBlocks.length > 0 ? ` — ⚠️ ${replacedProseBlocks.length} дн. будет заменено` : ""}
              </summary>
              {card.weeklyAnalysis && reviewProseBlocks.length > 0 ? (
                <>
                  <p className="admin-muted admin-nutrition-helper">
                    Разбор по дням: правки ложатся в карточки ученицы по дням — вёрстка сохраняется, числа и таргеты
                    не трогаются. ⚠️ Не вписывай числа/граммы, которых нет в фактах дня: такой день не пройдёт
                    проверку и уйдёт сухим автокомментарием — не твоим текстом и не исходным. Дни, которые сейчас
                    заменяются, помечены ниже красным (видно и что именно уйдёт вместо них).
                  </p>
                  <form className="admin-form-stack" action={updateNutritionReviewProseAction}>
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="analysisId" value={card.weeklyAnalysis.id} />
                    <input type="hidden" name="redirectTo" value={studentCardPath} />
                    <label className="admin-form-field">
                      <span>Тёплое открытие (без цифр)</span>
                      <textarea
                        className="admin-textarea admin-textarea-compact"
                        name="athleteOpeningNoteRu"
                        rows={2}
                        defaultValue={reviewOpeningNote}
                      />
                    </label>
                    <label className="admin-form-field">
                      <span>Фокус недели</span>
                      <textarea
                        className="admin-textarea admin-textarea-compact"
                        name="oneFocusStatementRu"
                        rows={2}
                        defaultValue={reviewFocusStatement}
                      />
                    </label>
                    {reviewProseBlocks.map((block) => (
                      <div key={block.date}>
                        <label className="admin-form-field">
                          <span>
                            {block.label}
                            {block.isReplaced ? " · ⚠️ уйдёт НЕ этот текст" : ""}
                          </span>
                          <textarea
                            className="admin-textarea admin-textarea-compact"
                            name={`prose__${block.date}`}
                            rows={3}
                            defaultValue={block.prose}
                          />
                        </label>
                        {block.isReplaced ? (
                          <div className="admin-alert admin-alert-error" style={{ marginTop: 6 }}>
                            <strong>Этот текст ученице НЕ уйдёт.</strong> Проверка отклонила его:
                            <ul className="admin-list">
                              {block.rejectionReasons.map((reason, idx) => (
                                <li key={`prose-reject-${block.date}-${idx}`}>{reason}</li>
                              ))}
                            </ul>
                            <p className="admin-muted">Вместо него ученице уйдёт:</p>
                            <p className="admin-nutrition-text-block">
                              {block.willSendProse || "(за этот день ничего не уйдёт)"}
                            </p>
                            <p className="admin-muted">
                              Убери из текста числа, которых нет в фактах этого дня (и клинические термины) — тогда
                              уйдёт твой текст.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <FormActionButton className="admin-button admin-button-secondary" pendingText="Сохраняю…">
                      Сохранить правки разбора
                    </FormActionButton>
                  </form>
                </>
              ) : null}
              {displayPlan ? (
                <>
                  <p className="admin-muted admin-nutrition-helper">
                    Текст плана на следующую неделю — один блок (не по дням). Правка ложится в текст ученицы поверх
                    оригинала (исходный сохраняется — очистишь поле, вернётся он). ⚠️ Не вписывай числа/граммы: они
                    идут в мини-таблицу отдельно и тут не нужны.
                  </p>
                  <form className="admin-form-stack" action={updateNutritionPlanProseAction}>
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="planId" value={displayPlan.id} />
                    <input type="hidden" name="redirectTo" value={studentCardPath} />
                    <label className="admin-form-field">
                      <span>Текст плана на след. неделю</span>
                      <textarea
                        className="admin-textarea"
                        name="planProse"
                        rows={6}
                        defaultValue={displayPlan.coachEditedDraft ?? displayPlan.athleteMessageDraft ?? ""}
                      />
                    </label>
                    <FormActionButton className="admin-button admin-button-secondary" pendingText="Сохраняю…">
                      Сохранить правки плана
                    </FormActionButton>
                  </form>
                </>
              ) : null}
            </details>
          ) : null}
          {combinedMessage.status === "awaiting_generation" ? (
            <>
              <div className="admin-alert admin-alert-error">
                <strong>Разбор ещё не сгенерирован живой моделью.</strong> Поставлен в очередь — текст ученику не
                сформирован и не готов к отправке. Перегенерируй разбор.
              </div>
              <form action={generateNutritionWeeklyReviewAction}>
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="weekFrom" value={weekFrom} />
                <input type="hidden" name="weekTo" value={weekTo} />
                <input type="hidden" name="reportId" value={selectedReportId ?? ""} />
                <input type="hidden" name="redirectTo" value={studentCardPath} />
                <FormActionButton className="admin-button" pendingText="Перегенерирую…" disabled={!selectedReportId}>
                  Перегенерировать
                </FormActionButton>
              </form>
            </>
          ) : combinedMessage.status === "missing_review" ? (
            <p className="admin-muted">Сначала сгенерируйте разбор прошлой недели.</p>
          ) : combinedMessage.status === "missing_plan" ? (
            <p className="admin-muted">
              {planWeek
                ? formatNutritionCombinedMessageMissingPlanHint(planWeek.mode)
                : "Сначала сгенерируйте фокус, чтобы собрать полный текст."}
            </p>
          ) : combinedMessage.status === "blocked_safety" ? (
            <>
              <div className="admin-alert admin-alert-error">
                <strong>Полный текст скрыт: нужна ручная проверка.</strong> Полный текст ученику не сформирован: есть
                причины для ручной проверки.
              </div>
              {combinedDoNotSendReasons.length > 0 ? (
                <ul className="admin-list">
                  {combinedDoNotSendReasons.map((reason, idx) => (
                    <li key={`combined-dnr-${idx}`}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : combinedMessage.renderResult.issues.some((issue) => issue.severity === "error") ? (
            <>
              <div className="admin-alert admin-alert-error">
                <strong>Полный текст заблокирован renderer-проверкой.</strong> Исправьте issues ниже перед копированием.
              </div>
              <details>
                <summary>
                  Ошибки: {combinedMessage.renderResult.issues.filter((issue) => issue.severity === "error").length} ·
                  предупреждения:{" "}
                  {combinedMessage.renderResult.issues.filter((issue) => issue.severity === "warning").length} ·
                  символов: {combinedMessage.renderResult.charCount}
                </summary>
                <ul className="admin-list">
                  {combinedMessage.renderResult.issues.map((issue) => (
                    <li key={`${issue.rule}-${issue.severity}`}>
                      {issue.severity === "error" ? "Ошибка" : "Warning"}: {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : combinedMessage.renderResult.text ? (
            <>
              {combinedMessage.status === "needs_review" ? (
                <p className="admin-badge admin-badge-warning">Нужна проверка тренера перед отправкой</p>
              ) : null}
              {combinedMessage.renderResult.issues.length > 0 || combinedMessage.warnings.length > 0 ? (
                <details>
                  <summary>
                    Предупреждения: {combinedMessage.renderResult.issues.filter((issue) => issue.severity === "warning").length + combinedMessage.warnings.length} ·
                    символов: {combinedMessage.renderResult.charCount}
                  </summary>
                  <ul className="admin-list">
                    {combinedMessage.warnings.map((warning, idx) => (
                      <li key={`combined-warning-${idx}`}>{warning}</li>
                    ))}
                    {combinedMessage.renderResult.issues.map((issue) => (
                      <li key={`${issue.rule}-${issue.severity}`}>{issue.message}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {combinedMessage.athleteMessageDraftParts.length > 1 ? (
                combinedMessage.athleteMessageDraftParts.map((part, idx) => (
                  <div key={`combined-part-${idx}`} className="admin-nutrition-draft-part">
                    <p className="admin-muted admin-nutrition-draft-part-label">
                      {idx === 0
                        ? `Сообщение 1 — разбор недели (${part.length} симв.)`
                        : `Сообщение 2 — план на неделю (${part.length} симв.)`}
                    </p>
                    <NutritionDraftCopyBlock
                      draft={part}
                      generationMode={displayPlan?.generationMode ?? generationMode}
                    />
                  </div>
                ))
              ) : (
                <NutritionDraftCopyBlock
                  draft={combinedMessage.renderResult.text}
                  generationMode={displayPlan?.generationMode ?? generationMode}
                />
              )}

              {/* Send the review deep link — only for an APPROVED review. */}
              {card.weeklyAnalysis?.status === "approved_for_copy" ? (
                <div
                  className="admin-inline-actions"
                  style={{ marginTop: 14, flexWrap: "wrap", gap: 8 }}
                >
                  <form action={sendNutritionReviewLinkAction}>
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="redirectTo" value={studentCardPath} />
                    <FormActionButton className="admin-button" pendingText="Отправка…">
                      Отправить разбор ученику
                    </FormActionButton>
                  </form>
                  {(() => {
                    const w = formatBusinessWindowBadge(windowLastSeenAt);
                    return (
                      <span className="admin-muted" style={{ fontSize: 13 }}>
                        {w.icon} {w.label}
                        {w.isOpen ? " — дойдёт сейчас." : " — дойдёт, когда ученица напишет (окно 24 ч)."}
                      </span>
                    );
                  })()}
                </div>
              ) : card.weeklyAnalysis?.status === "draft_generated" ||
                card.weeklyAnalysis?.status === "needs_review" ? (
                <div className="admin-inline-actions" style={{ marginTop: 14, flexWrap: "wrap", gap: 8 }}>
                  {/* Approve a reviewed draft → enables "send to athlete". Never for blocked_safety. */}
                  <form action={approveNutritionReviewAction}>
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="analysisId" value={card.weeklyAnalysis.id} />
                    <input type="hidden" name="redirectTo" value={studentCardPath} />
                    <FormActionButton className="admin-button" pendingText="Одобряю…">
                      Одобрить разбор
                    </FormActionButton>
                  </form>
                  <span className="admin-muted" style={{ fontSize: 13 }}>
                    После одобрения появится «Отправить разбор ученику».
                  </span>
                </div>
              ) : (
                <p className="admin-muted" style={{ marginTop: 12 }}>
                  Отправить разбор ученику можно после одобрения.
                </p>
              )}
            </>
          ) : (
            <p className="admin-muted">Полный текст ученику не сформирован: есть причины для ручной проверки.</p>
          )}
        </article>

        {patternCandidates.length > 0 && card.weeklyAnalysis ? (
          <article className="admin-card admin-card-compact admin-nutrition-card-wide">
            <h3>Память ученика — предложенные паттерны</h3>
            <p className="admin-muted admin-nutrition-helper">
              Система заметила повторяющиеся паттерны. Подтвердите, чтобы добавить в память ученика (будет подтягиваться
              в каждый разбор и озвучиваться по-доброму). Неподтверждённое не сохраняется.
            </p>
            <ul className="admin-list">
              {patternCandidates.map((candidate) => (
                <li key={`pattern-${candidate.code}`} className="admin-nutrition-pattern-row">
                  <span>
                    Заметил паттерн: <strong>{candidate.text}</strong> — повторяется {candidate.weeksObserved} нед.
                    {candidate.sinceWeek ? ` (с ${formatNutritionCompactDate(candidate.sinceWeek)})` : ""}
                  </span>
                  <span className="admin-card-actions admin-card-actions-compact">
                    <form action={approveNutritionPatternAction}>
                      <input type="hidden" name="studentId" value={studentId} />
                      <input type="hidden" name="analysisId" value={card.weeklyAnalysis.id} />
                      <input type="hidden" name="code" value={candidate.code} />
                      <input type="hidden" name="patternText" value={candidate.text} />
                      <input type="hidden" name="sinceWeek" value={candidate.sinceWeek} />
                      <input type="hidden" name="redirectTo" value={studentCardPath} />
                      <FormActionButton className="admin-button" pendingText="Сохраняю…">
                        В память
                      </FormActionButton>
                    </form>
                    <form action={dismissNutritionPatternAction}>
                      <input type="hidden" name="studentId" value={studentId} />
                      <input type="hidden" name="analysisId" value={card.weeklyAnalysis.id} />
                      <input type="hidden" name="code" value={candidate.code} />
                      <input type="hidden" name="redirectTo" value={studentCardPath} />
                      <FormActionButton className="admin-button admin-button-secondary" pendingText="Отклоняю…">
                        Отклонить
                      </FormActionButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        {approvedPatterns.length > 0 ? (
          <article className="admin-card admin-card-compact admin-nutrition-card-wide">
            <h3>Память ученика — одобренные паттерны</h3>
            <p className="admin-muted admin-nutrition-helper">
              Подтягивается в каждый разбор как история. Снятия/экспирации нет — уберите вручную, когда паттерн больше
              не актуален. Лимит {approvedPatterns.length >= 4 ? "достигнут (4)" : `4 (сейчас ${approvedPatterns.length})`}.
            </p>
            <ul className="admin-list">
              {approvedPatterns.map((pattern) => (
                <li key={`approved-pattern-${pattern.text}`} className="admin-nutrition-pattern-row">
                  <span>
                    <strong>{pattern.text}</strong>
                    {pattern.ageLabel ? ` — ${pattern.ageLabel}` : ""}
                    {pattern.staleness?.stale === true ? (
                      <>
                        {" "}
                        <span className="admin-badge admin-badge-warning">
                          не повторяется 2 недели — снять?
                        </span>
                      </>
                    ) : null}
                  </span>
                  <span className="admin-card-actions admin-card-actions-compact">
                    <form action={removeNutritionApprovedPatternAction}>
                      <input type="hidden" name="studentId" value={studentId} />
                      <input type="hidden" name="patternText" value={pattern.text} />
                      <input type="hidden" name="redirectTo" value={studentCardPath} />
                      <FormActionButton
                        className={
                          pattern.staleness?.stale === true ? "admin-button" : "admin-button admin-button-secondary"
                        }
                        pendingText="Убираю…"
                      >
                        Убрать
                      </FormActionButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        <article className="admin-card admin-card-compact admin-nutrition-card-wide">
          <h3>Детали для тренера — актуальная сводка</h3>
          {/* Самочувствие ученицы + вес показываем НЕЗАВИСИМО от разбора: чек-ин
              грузится отдельно (card.context.weeklyCheckin) и должен быть виден,
              как только ученица его прислала, даже если обзор ещё не сгенерирован. */}
          <dl className="admin-meta-list admin-meta-list-compact admin-nutrition-compact-grid">
            {card.context.weeklyCheckin && (
              <div>
                <dt>Самочувствие за неделю (чек-ин)</dt>
                <dd>
                  Энергия {card.context.weeklyCheckin.energy ?? "—"} · Самочувствие{" "}
                  {card.context.weeklyCheckin.wellbeing ?? "—"} · Комфорт еды{" "}
                  {card.context.weeklyCheckin.eatingComfort ?? "—"}
                </dd>
              </div>
            )}
            {/* Слова ученицы из формы («Заметка тренеру» → raw_text). Показываем
                БЕЗУСЛОВНО рядом со шкалами — это контекст (самочувствие/обстоятельства),
                который доходит до модели, но раньше был закопан в свёрнутый <details>. */}
            {card.context.athleteCommentRu && (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt>Заметка ученицы (из формы)</dt>
                <dd style={{ whiteSpace: "pre-wrap" }}>{card.context.athleteCommentRu}</dd>
              </div>
            )}
            <div>
              <dt>Вес (кг)</dt>
              <dd>{bodyweightKg ?? "—"}</dd>
            </div>
          </dl>
          {!card.weeklyAnalysis ? (
            <p className="admin-muted">Обзор ещё не сгенерирован.</p>
          ) : (
            <div className="admin-nutrition-coach-section">
              <p className="admin-muted admin-nutrition-helper">
                Сводка собрана из текущих канонических данных. Старый сохранённый текст доступен ниже в служебных
                черновиках.
              </p>
              {showCoachDetailsStaleHint ? (
                <p className="admin-muted admin-nutrition-helper">
                  Это не текст для отправки ученику. Если выше есть предупреждение об устаревшем обзоре, перегенерируйте
                  обзор и фокус.
                </p>
              ) : null}
              <section>
                <h4>Главный вывод для тренера</h4>
                {derivedCoachSummaryText ? (
                  <p className="admin-nutrition-text-block">{derivedCoachSummaryText}</p>
                ) : (
                  <p className="admin-muted">Главный вывод не сформирован.</p>
                )}
              </section>

              {athleteReportSignals.length > 0 ? (
                <section>
                  <h4>Сигналы из комментария ученика</h4>
                  <div className="admin-nutrition-chip-row">
                    {athleteReportSignals.map((signal, idx) => (
                      <span key={`signal-chip-${idx}`} className="admin-badge admin-badge-outline">
                        {formatNutritionAthleteReportSignalCategory(signal.category)}
                      </span>
                    ))}
                  </div>
                  <ul className="admin-list admin-nutrition-signal-evidence-list">
                    {athleteReportSignals.map((signal, idx) => (
                      <li key={`signal-evidence-${idx}`}>
                        <strong>{formatNutritionAthleteReportSignalCategory(signal.category)}:</strong>{" "}
                        <span className="admin-muted">{signal.evidence}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section>
                <h4>Разбор по дням</h4>
                {coachDayByDayDisplayText ? (
                  <>
                    <p className="admin-nutrition-text-block">{coachDayByDayDisplayText}</p>
                    {derivedCoachDayByDayText &&
                    dayByDayAnalysisText &&
                    derivedCoachDayByDayText !== dayByDayAnalysisText ? (
                      <details>
                        <summary className="admin-muted">Исходный сохранённый разбор (служебно)</summary>
                        <p className="admin-nutrition-text-block">{dayByDayAnalysisText}</p>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="admin-muted">Разбор по дням не сформирован.</p>
                )}
              </section>

              <section>
                <h4>Связки тренировка ↔ питание</h4>
                {trainingLinks.length === 0 ? (
                  <p className="admin-muted">Связки не сформированы.</p>
                ) : (
                  <ul className="admin-list">
                    {trainingLinks.map((line, idx) => (
                      <li key={`training-link-${idx}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4>Метрики недели</h4>
                <dl className="admin-meta-list admin-meta-list-compact admin-nutrition-compact-grid">
                  <div>
                    <dt>Качество данных</dt>
                    <dd>
                      {formatNutritionDataQualitySummary({
                        parsedDays:
                          typeof dataQualitySummary.parsed_days === "number" ? dataQualitySummary.parsed_days : null,
                        lowConfidenceDays:
                          typeof dataQualitySummary.low_confidence_days === "number"
                            ? dataQualitySummary.low_confidence_days
                            : null,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>Средние ккал/Б/Ж/У</dt>
                    <dd>
                      {(weeklyNutritionSummary.avg_kcal as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_protein_g as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_fat_g as number | null) ?? "—"} /{" "}
                      {(weeklyNutritionSummary.avg_carbs_g as number | null) ?? "—"}
                    </dd>
                  </div>
                  {/* Вес и чек-ин теперь показаны выше, вне review-гейта. */}
                  {selectedReport?.rawText && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <dt>Заметка ученицы</dt>
                      <dd className="admin-muted" style={{ whiteSpace: "pre-wrap" }}>
                        {selectedReport.rawText}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Белок достаточный</dt>
                    <dd>
                      {bodyweightKg === null
                        ? "Вес не задан — расчёт г/кг и белок достаточный недоступны."
                        : methodologySignals.protein_sufficient === true
                          ? "Да"
                          : "Нет/неизвестно"}
                    </dd>
                  </div>
                  <div>
                    <dt>Один фокус</dt>
                    <dd>{oneFocusText ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Стратегия углеводов</dt>
                    <dd>{formatNutritionCarbStrategy(carbStrategy)}</dd>
                  </div>
                  <div>
                    <dt>TP прошлой недели</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpPastWeek.cacheStatus)}</dd>
                  </div>
                  <div>
                    <dt>TP следующей недели</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpNextWeek.cacheStatus)}</dd>
                  </div>
                </dl>
              </section>

              {hasSafetyFlags && (
                <section>
                  <h4>Флаги безопасности</h4>
                  <p className="admin-nutrition-text-block">
                    {formatDoNotSendReasons(card.weeklyAnalysis.safetyFlags).join(", ")}
                  </p>
                </section>
              )}
            </div>
          )}
        </article>

        <details className="admin-card admin-card-compact admin-nutrition-card-wide admin-nutrition-advanced-stack">
          <summary>Дополнительно</summary>
          <div className="admin-nutrition-advanced-inner">
            <details>
              <summary>Исходные служебные черновики</summary>
              <div className="admin-form-stack">
                <p className="admin-muted">
                  Служебный текст, не для отправки напрямую. Для отправки ученику используйте блок «Черновик ученику —
                  полный текст» выше.
                </p>

                <section>
                  <h4>Сохранённый coach_summary_text из БД</h4>
                  {!card.weeklyAnalysis ? (
                    <p className="admin-muted">Обзор ещё не сгенерирован.</p>
                  ) : coachSummaryText ? (
                    <p className="admin-nutrition-text-block">{coachSummaryText}</p>
                  ) : (
                    <p className="admin-muted">Сохранённый coach_summary_text не найден.</p>
                  )}
                </section>

                <section>
                  <h4>Служебный черновик обзора из БД</h4>
                  {!card.weeklyAnalysis ? (
                    <p className="admin-muted">Обзор ещё не сгенерирован.</p>
                  ) : card.weeklyAnalysis.status === "awaiting_generation" ? (
                    <div className="admin-alert admin-alert-error">
                      <strong>Ожидает генерации живой моделью.</strong> Черновик не сформирован — перегенерируй разбор
                      выше. Это не финальный текст.
                    </div>
                  ) : card.weeklyAnalysis.status === "blocked_safety" ? (
                    <div className="admin-alert admin-alert-error">
                      <strong>Блок безопасности.</strong> Черновик скрыт. Проверьте флаги перед ручным просмотром.
                    </div>
                  ) : card.weeklyAnalysis.athleteMessageDraft ? (
                    <NutritionDraftCopyBlock
                      draft={card.weeklyAnalysis.athleteMessageDraft}
                      generationMode={generationMode}
                      copyEnabled={false}
                    />
                  ) : (
                    <p className="admin-muted">Черновик скрыт (блок безопасности или мало данных).</p>
                  )}
                </section>

                <section>
                  <h4>Служебный черновик фокуса из БД</h4>
                  {!displayPlan ? (
                    <p className="admin-muted">Сохранённого фокуса на эту неделю пока нет.</p>
                  ) : displayPlan.athleteMessageDraft ? (
                    <NutritionDraftCopyBlock
                      draft={displayPlan.athleteMessageDraft}
                      generationMode={displayPlan.generationMode}
                      copyEnabled={false}
                    />
                  ) : (
                    <p className="admin-muted">Черновик фокуса не создан.</p>
                  )}
                </section>
              </div>
            </details>

            <details>
              <summary>Профиль и вес</summary>
              <div className="admin-form-stack">
                <dl className="admin-meta-list admin-meta-list-compact admin-nutrition-compact-grid">
                  <div>
                    <dt>Недельные отчёты</dt>
                    <dd>{formatNutritionEnabled(card.student.weeklyReportEnabled)}</dd>
                  </div>
                  <div>
                    <dt>Telegram</dt>
                    <dd>{formatNutritionEnabled(card.student.telegramDeliveryEnabled)}</dd>
                  </div>
                  <div>
                    <dt>Формальность</dt>
                    <dd>{formatNutritionFormality(card.context.resolvedCommunicationProfile.formality)}</dd>
                  </div>
                  <div>
                    <dt>Источник стиля</dt>
                    <dd>{formatNutritionFormalitySource(card.context.resolvedCommunicationProfile.formalitySource)}</dd>
                  </div>
                  <div>
                    <dt>Тон</dt>
                    <dd>{formatNutritionTone(card.context.resolvedCommunicationProfile.tone)}</dd>
                  </div>
                  <div>
                    <dt>Конфликты</dt>
                    <dd>{formatNutritionConflictFlags(card.context.resolvedCommunicationProfile.conflictFlags)}</dd>
                  </div>
                </dl>
                <form className="admin-form-stack" action={saveNutritionProfileAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <label className="admin-form-field">
                    <span>Питание</span>
                    <select name="enabled" className="admin-input" defaultValue={card.profile?.enabled ? "true" : "false"}>
                      <option value="false">Выключено</option>
                      <option value="true">Включено</option>
                    </select>
                  </label>
                  <label className="admin-form-field">
                    <span>Цель питания (влияет на расчёт)</span>
                    <select
                      className="admin-input"
                      name="nutritionGoalType"
                      defaultValue={card.profile?.nutritionGoalType ?? "maintain"}
                    >
                      <option value="maintain">Поддержание</option>
                      <option value="lose">Снижение веса</option>
                      <option value="gain">Набор формы</option>
                    </select>
                  </label>
                  <label className="admin-form-field">
                    <span>Целевой вес (кг) — только для снижения, опц.</span>
                    <input
                      className="admin-input"
                      name="targetWeightKg"
                      type="number"
                      step="0.1"
                      defaultValue={card.profile?.targetWeightKg ?? ""}
                    />
                  </label>
                  <label className="admin-form-field">
                    <span>Цель (текстом, опц.)</span>
                    <input className="admin-input" name="goal" defaultValue={card.profile?.goal ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Приложение</span>
                    <input className="admin-input" name="trackingApp" defaultValue={card.profile?.trackingApp ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Текущий вес (кг)</span>
                    <input className="admin-input" name="currentWeightKg" type="number" step="0.1" defaultValue={card.profile?.currentWeightKg ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Пол (для снижения/набора, опц.)</span>
                    <select className="admin-input" name="sex" defaultValue={card.profile?.sex ?? ""}>
                      <option value="">—</option>
                      <option value="female">Женский</option>
                      <option value="male">Мужской</option>
                    </select>
                  </label>
                  <label className="admin-form-field">
                    <span>Рост (см) — уточняет BMR, опц.</span>
                    <input className="admin-input" name="heightCm" type="number" step="0.5" defaultValue={card.profile?.heightCm ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Возраст (лет) — уточняет BMR, опц.</span>
                    <input className="admin-input" name="ageYears" type="number" step="1" defaultValue={card.profile?.ageYears ?? ""} />
                  </label>
                  <label className="admin-form-field">
                    <span>Аллергии / непереносимость (безопасность)</span>
                    <textarea className="admin-textarea admin-textarea-compact" name="toleranceNotes" rows={2} defaultValue={card.profile?.toleranceNotes ?? ""} />
                  </label>
                  <label className="admin-form-field admin-form-field-inline">
                    <input type="checkbox" name="ownRegime" value="true" defaultChecked={card.profile?.ownRegime ?? false} />
                    <span>Свой режим питания — не оценивать калорийность/жир как проблему</span>
                  </label>
                  <label className="admin-form-field admin-form-field-inline">
                    <input type="checkbox" name="excludeOtherActivities" value="true" defaultChecked={card.profile?.excludeOtherActivities ?? false} />
                    <span>Игнорировать активности типа «Other» из TrainingPeaks (не учитывать в питании)</span>
                  </label>
                  <FormActionButton className="admin-button" pendingText="Сохраняю…">
                    Сохранить профиль
                  </FormActionButton>
                </form>
                <form className="admin-form-inline" action={addNutritionWeightAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <input className="admin-input" name="weightKg" type="number" step="0.1" placeholder="кг" required />
                  <input className="admin-input" name="source" defaultValue="manual" />
                  <FormActionButton className="admin-button" pendingText="Добавляю…">
                    Добавить вес
                  </FormActionButton>
                </form>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Вес</th>
                        <th>Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.weightLogs.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="admin-empty-cell">
                            Записей веса пока нет.
                          </td>
                        </tr>
                      ) : (
                        card.weightLogs.map((row) => (
                          <tr key={row.id}>
                            <td>{formatIsoDate(row.loggedAt)}</td>
                            <td>{row.weightKg}</td>
                            <td>{row.source}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>

            <details>
              <summary>Контекстные заметки</summary>
              <div className="admin-form-stack">
                <form className="admin-form-inline" action={addNutritionContextNoteAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <select className="admin-input" name="itemType" defaultValue="note">
                    {CONTEXT_ITEM_TYPES.map((itemType) => (
                      <option key={itemType} value={itemType}>
                        {formatNutritionContextItemType(itemType)}
                      </option>
                    ))}
                  </select>
                  <input className="admin-input" name="text" placeholder="Заметка…" required />
                  <FormActionButton className="admin-button" pendingText="Добавляю…">
                    Добавить
                  </FormActionButton>
                </form>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Тип</th>
                        <th>Текст</th>
                        <th>Приоритет</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.contextItems.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="admin-empty-cell">
                            Заметок пока нет.
                          </td>
                        </tr>
                      ) : (
                        card.contextItems.map((item) => (
                          <tr key={item.id}>
                            <td>{formatNutritionContextItemType(item.itemType)}</td>
                            <td>{item.text}</td>
                            <td>{item.priority}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>

            <details>
              <summary>Ручной ввод макросов</summary>
              <div className="admin-form-stack">
                <form className="admin-form-stack" action={parseNutritionManualMacrosAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  {selectedReportId ? <input type="hidden" name="reportId" value={selectedReportId} /> : null}
                  <div className="admin-nutrition-kv-grid">
                    <label className="admin-form-field">
                      <span>Неделя с</span>
                      <input className="admin-input" type="date" name="weekFrom" defaultValue={weekFrom} />
                    </label>
                    <label className="admin-form-field">
                      <span>Неделя по</span>
                      <input className="admin-input" type="date" name="weekTo" defaultValue={weekTo} />
                    </label>
                  </div>
                  <label className="admin-form-field">
                    <span>Текст макросов</span>
                    <textarea className="admin-textarea admin-textarea-compact" name="rawText" rows={4} defaultValue={rawText} />
                  </label>
                  <FormActionButton className="admin-button admin-button-secondary" pendingText="Разбираю…">
                    Разобрать макросы
                  </FormActionButton>
                </form>
                <form className="admin-form-stack" action={saveNutritionManualMacrosAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="weekFrom" value={weekFrom} />
                  <input type="hidden" name="weekTo" value={weekTo} />
                  <input type="hidden" name="rawText" value={rawText} />
                  <input type="hidden" name="redirectTo" value={studentCardPath} />
                  <FormActionButton className="admin-button" pendingText="Сохраняю…" disabled={!rawText}>
                    Сохранить разбор
                  </FormActionButton>
                </form>
                {parsedPreview && (
                  <>
                    <div className="admin-card-actions admin-card-actions-compact">
                      <span className={getBadgeClass(parsedPreview.status)}>
                        {formatNutritionStatus(parsedPreview.status, "report")}
                      </span>
                      <span className="admin-muted">
                        {formatNutritionDataQualitySummary({
                          parsedDays: parsedPreview.quality.parsedDays,
                          lowConfidenceDays: parsedPreview.quality.lowConfidenceDays,
                        })}
                      </span>
                    </div>
                    <div className="admin-table-wrap">
                      <table className="admin-table admin-table-compact">
                        <thead>
                          <tr>
                            <th>День</th>
                            <th>ккал</th>
                            <th>Белки</th>
                            <th>Жиры</th>
                            <th>Углев.</th>
                            <th>Уверен.</th>
                            <th>Заметки</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedPreview.rows.map((row) => (
                            <tr key={`${row.day}-${row.weekday ?? "na"}`}>
                              <td>{row.day}</td>
                              <td>{row.kcal ?? "—"}</td>
                              <td>{row.proteinG ?? "—"}</td>
                              <td>{row.fatG ?? "—"}</td>
                              <td>{row.carbsG ?? "—"}</td>
                              <td>{row.confidence.toFixed(2)}</td>
                              <td>{row.notes ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </details>

            <details>
              <summary>Кэш TrainingPeaks</summary>
              <div className="admin-form-stack">
                <div className="admin-nutrition-kv-grid">
                  <dl className="admin-nutrition-kv">
                    <dt>Прошлая неделя</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpPastWeek.cacheStatus)}</dd>
                  </dl>
                  <dl className="admin-nutrition-kv">
                    <dt>Следующая неделя</dt>
                    <dd>{formatNutritionTpCacheStatus(card.context.tpNextWeek.cacheStatus)}</dd>
                  </dl>
                  <dl className="admin-nutrition-kv">
                    <dt>Ключ. тренировки (прош.)</dt>
                    <dd>{card.context.tpPastWeek.keyWorkouts.length}</dd>
                  </dl>
                  <dl className="admin-nutrition-kv">
                    <dt>Ключ. тренировки (след.)</dt>
                    <dd>{card.context.tpNextWeek.keyWorkouts.length}</dd>
                  </dl>
                </div>
                <p className="admin-muted">{formatNutritionTpCacheNote(card.context.tpPastWeek.cacheStatusNote)}</p>
                <p className="admin-muted">{formatNutritionTpCacheNote(card.context.tpNextWeek.cacheStatusNote)}</p>
              </div>
            </details>

            <details id="nutrition-all-reports">
              <summary>Все сохранённые отчёты</summary>
              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead>
                    <tr>
                      <th>Создан</th>
                      <th>Статус</th>
                      <th>ID</th>
                      <th>Источник</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.reports.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="admin-empty-cell">
                          Отчётов за период нет.
                        </td>
                      </tr>
                    ) : (
                      recentReports.map((report) => {
                        const isSelected = report.id === selectedReportId;
                        const reportHref = buildNutritionStudentCardHref({
                          studentId,
                          weekFrom,
                          weekTo,
                          reportId: report.id,
                          reviewId: isSelected ? selectedReviewId : null,
                        });
                        return (
                          <tr key={report.id}>
                            <td>{formatNutritionCompactDate(report.createdAt)}</td>
                            <td>
                              <span className={getBadgeClass(report.status)}>
                                {formatNutritionStatus(report.status, "report")}
                              </span>
                            </td>
                            <td>
                              <code className="admin-nutrition-code">{formatNutritionShortId(report.id)}</code>
                            </td>
                            <td>{formatNutritionSourceType(report.sourceType)}</td>
                            <td>
                              {isSelected ? (
                                <span className="admin-muted">выбран</span>
                              ) : (
                                <Link className="admin-backlink" href={reportHref}>
                                  Выбрать
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </details>

            {card.weeklyAnalyses.length > 0 && (
              <details>
                <summary>Все сохранённые обзоры</summary>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Обновлён</th>
                        <th>Статус</th>
                        <th>ID</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.weeklyAnalyses.map((analysis) => {
                        const isSelected = analysis.id === selectedReviewId;
                        const analysisHref = buildNutritionStudentCardHref({
                          studentId,
                          weekFrom,
                          weekTo,
                          reportId: analysis.reportId ?? selectedReportId,
                          reviewId: analysis.id,
                        });
                        return (
                          <tr key={analysis.id}>
                            <td>{formatNutritionCompactDate(analysis.updatedAt)}</td>
                            <td>
                              <span className={getBadgeClass(analysis.status)}>
                                {formatNutritionStatus(analysis.status, "analysis")}
                              </span>
                            </td>
                            <td>
                              <code className="admin-nutrition-code">{formatNutritionShortId(analysis.id)}</code>
                            </td>
                            <td>
                              {isSelected ? (
                                <span className="admin-muted">выбран</span>
                              ) : (
                                <Link className="admin-backlink" href={analysisHref}>
                                  Открыть
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {plansForWeek.length > 0 && (
              <details>
                <summary>Все сохранённые фокусы питания</summary>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Обновлён</th>
                        <th>Статус</th>
                        <th>Режим</th>
                        <th>ID</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {plansForWeek.map((plan) => {
                        const isSelected = plan.id === displayPlan?.id;
                        const planHref = buildNutritionStudentCardHref({
                          studentId,
                          weekFrom,
                          weekTo,
                          reportId: selectedReportId,
                          reviewId: selectedReviewId,
                          planId: plan.id,
                        });
                        return (
                          <tr key={plan.id}>
                            <td>{formatNutritionCompactDate(plan.updatedAt)}</td>
                            <td>
                              <span className={getBadgeClass(plan.status)}>
                                {formatNutritionStatus(plan.status, "weekly_plan")}
                              </span>
                            </td>
                            <td>{formatNutritionGenerationMode(plan.generationMode)}</td>
                            <td>
                              <code className="admin-nutrition-code">{formatNutritionShortId(plan.id)}</code>
                            </td>
                            <td>
                              {isSelected ? (
                                <span className="admin-muted">выбран</span>
                              ) : (
                                <Link className="admin-backlink" href={planHref}>
                                  Открыть
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {displayPlan && (
              <details>
                <summary>Technical JSON — nutrition weekly plan</summary>
                <textarea
                  className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                  rows={10}
                  readOnly
                  value={JSON.stringify(displayPlan, null, 2)}
                />
              </details>
            )}

            {card.weeklyAnalysis && (
              <details>
                <summary>Technical JSON</summary>
                <div className="admin-form-stack">
                  <p className="admin-muted">Prompt: {promptVersion}</p>
                  <details>
                    <summary>Safety JSON</summary>
                    <textarea
                      className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                      rows={3}
                      readOnly
                      value={JSON.stringify(card.weeklyAnalysis.safetyFlags, null, 2)}
                    />
                  </details>
                  <details>
                    <summary>Важные дни (technical)</summary>
                    {importantDays.length === 0 ? (
                      <p className="admin-muted">Ключевые дни не выделены.</p>
                    ) : (
                      <ul className="admin-list">
                        {importantDays.map((day, idx) => {
                          const date = typeof day.date === "string" ? day.date : "—";
                          const trainingType = formatTrainingType(typeof day.trainingType === "string" ? day.trainingType : null);
                          const findings = Array.isArray(day.findings) ? (day.findings as string[]) : [];
                          const line = findings[0] ?? "сигнал без деталей";
                          return (
                            <li key={`${date}-${idx}`}>
                              {date} · {trainingType} · {line}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </details>
                  <details>
                    <summary>nutritionSummary JSON</summary>
                    <textarea
                      className="admin-textarea admin-textarea-compact admin-textarea-readonly"
                      rows={10}
                      readOnly
                      value={JSON.stringify(
                        {
                          internalSummary: card.weeklyAnalysis.internalSummary,
                          nutritionSummary: card.weeklyAnalysis.nutritionSummary,
                          safetyFlags: card.weeklyAnalysis.safetyFlags,
                        },
                        null,
                        2
                      )}
                    />
                  </details>
                </div>
              </details>
            )}
          </div>
        </details>

        <details className="admin-nutrition-history">
          <summary>
            История отчётов и разборов ({reportHistory.length} отчётов · {analysisHistory.length} разборов)
          </summary>
          <div className="admin-form-stack">
            <p className="admin-muted">
              Архив обратим: скрытое не участвует в «последнем отчёте», «прошлой неделе» и памяти разборов; одобренные
              паттерны сохраняются. Данные не удаляются.
            </p>

            <h4>Отчёты-файлы</h4>
            {reportHistory.length === 0 ? (
              <p className="admin-muted">Отчётов пока нет.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Неделя</th>
                    <th>Загружен</th>
                    <th>Статус</th>
                    <th>Состояние</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reportHistory.map((report) => (
                    <tr key={report.id} className={report.archivedAt ? "admin-muted" : undefined}>
                      <td>
                        {report.weekFrom}–{report.weekTo}
                      </td>
                      <td>{formatNutritionCompactDate(report.createdAt)}</td>
                      <td>{formatNutritionStatus(report.status, "report")}</td>
                      <td>{report.archivedAt ? "в архиве" : "активен"}</td>
                      <td>
                        <form action={archiveNutritionReportAction}>
                          <input type="hidden" name="studentId" value={studentId} />
                          <input type="hidden" name="redirectTo" value={studentCardPath} />
                          <input type="hidden" name="reportId" value={report.id} />
                          <input type="hidden" name="archived" value={report.archivedAt ? "false" : "true"} />
                          <ConfirmSubmitButton
                            confirmMessage={
                              report.archivedAt
                                ? undefined
                                : `Архивировать отчёт за ${report.weekFrom}–${report.weekTo}? Его можно вернуть.`
                            }
                          >
                            {report.archivedAt ? "Вернуть" : "Архивировать"}
                          </ConfirmSubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4>Разборы (по неделям)</h4>
            {analysisHistory.length === 0 ? (
              <p className="admin-muted">Разборов пока нет.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Неделя</th>
                    <th>Обновлён</th>
                    <th>Статус</th>
                    <th>Состояние</th>
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {analysisHistory.map((analysis) => (
                    <tr key={analysis.id} className={analysis.archivedAt ? "admin-muted" : undefined}>
                      <td>
                        {analysis.weekFrom}–{analysis.weekTo}
                      </td>
                      <td>{formatNutritionCompactDate(analysis.updatedAt)}</td>
                      <td>{formatNutritionStatus(analysis.status, "analysis")}</td>
                      <td>{analysis.archivedAt ? "в архиве" : "активен"}</td>
                      <td>
                        {/* Switch the whole card to THIS review's week (week selector). */}
                        {analysis.id === selectedReviewId ? (
                          <span className="admin-muted">открыт</span>
                        ) : analysis.archivedAt ? (
                          <span className="admin-muted">—</span>
                        ) : (
                          <Link
                            className="admin-backlink"
                            href={buildNutritionStudentCardHref({
                              studentId,
                              weekFrom: analysis.weekFrom,
                              weekTo: analysis.weekTo,
                              reportId: analysis.reportId ?? null,
                              reviewId: analysis.id,
                            })}
                          >
                            Открыть
                          </Link>
                        )}
                      </td>
                      <td>
                        <form action={archiveNutritionAnalysisAction}>
                          <input type="hidden" name="studentId" value={studentId} />
                          <input type="hidden" name="redirectTo" value={studentCardPath} />
                          <input type="hidden" name="analysisId" value={analysis.id} />
                          <input type="hidden" name="archived" value={analysis.archivedAt ? "false" : "true"} />
                          <ConfirmSubmitButton
                            confirmMessage={
                              analysis.archivedAt
                                ? undefined
                                : `Архивировать разбор за ${analysis.weekFrom}–${analysis.weekTo}? Его можно вернуть; одобренные паттерны останутся.`
                            }
                          >
                            {analysis.archivedAt ? "Вернуть" : "Архивировать"}
                          </ConfirmSubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
