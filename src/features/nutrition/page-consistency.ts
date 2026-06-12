import { buildDerivedNutritionCoachDayByDayText } from "@/features/nutrition/combined-message";
import { NUTRITION_REVIEW_METHODOLOGY_VERSION } from "@/features/nutrition/methodology";
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import {
  countDatesOverlappingWeek,
  formatNutritionCompactWeekRange,
  formatNutritionReportDateMismatchCardNotice,
} from "@/features/nutrition/report-date-coverage";

export type NutritionPageConsistencyIssueSeverity = "warning" | "error" | "info";

export type NutritionPageConsistencyIssueCode =
  | "review_stale_methodology"
  | "review_fallback_mode"
  | "daily_dates_mismatch"
  | "report_date_mismatch"
  | "report_date_adjusted_from_pdf"
  | "report_date_ui_fallback"
  | "tp_daily_join_mismatch"
  | "missing_target_plan"
  | "selected_plan_wrong_week"
  | "plan_stale_methodology"
  | "coach_details_stored_layer";

export type NutritionPageConsistencyIssue = {
  severity: NutritionPageConsistencyIssueSeverity;
  code: NutritionPageConsistencyIssueCode;
  message: string;
  action?: string;
};

const STALE_REVIEW_PHRASES = [
  "Данные по питанию за день неполные",
  "Комментарий:",
  "можно дать",
  "указать факт",
] as const;

export type AnalyzeNutritionPageConsistencyInput = {
  selectedWeekFrom: string;
  selectedWeekTo: string;
  targetPlanWeekFrom?: string | null;
  targetPlanWeekTo?: string | null;
  review?: NutritionWeeklyAnalysis | null;
  plan?: NutritionWeeklyPlan | null;
  selectedPlanWrongWeek?: boolean;
  hasReview?: boolean;
  reportDataQuality?: Record<string, unknown> | null;
  reportWeekFrom?: string | null;
  reportWeekTo?: string | null;
  reportMacroDates?: string[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asNonemptyObject(value: unknown): Record<string, unknown> | null {
  const object = asObject(value);
  return Object.keys(object).length > 0 ? object : null;
}

function summarizeDailyRow(item: unknown): {
  date: string;
  trainingType: string;
  trainingLabel: string;
  hasMacroGuardrails: boolean;
  hasEnergyAvailability: boolean;
  hasCanonical: boolean;
  hasEnergyFloor: boolean;
  isRest: boolean;
} {
  const day = asObject(item);
  const canonical = asObject(day.canonicalDailyAnalysis) ?? asObject(day.canonical_daily_analysis);
  const loadClassification = asObject(day.loadClassification) ?? asObject(canonical.loadClassification);
  const trainingType =
    (typeof day.training_type === "string" ? day.training_type : null) ??
    (typeof day.trainingType === "string" ? day.trainingType : null) ??
    (typeof loadClassification.trainingType === "string" ? loadClassification.trainingType : null) ??
    "unknown";
  const trainingLabel =
    (typeof day.training_label === "string" ? day.training_label : null) ??
    (typeof day.trainingLabel === "string" ? day.trainingLabel : null) ??
    "";
  const macroGuardrails =
    asNonemptyObject(day.macro_guardrails) ??
    asNonemptyObject(day.macroGuardrails) ??
    asNonemptyObject(canonical.macroGuardrails) ??
    asNonemptyObject(canonical.macro_guardrails);
  const energyAvailability =
    asNonemptyObject(day.energy_availability) ??
    asNonemptyObject(day.energyAvailability) ??
    asNonemptyObject(canonical.energyAvailability) ??
    asNonemptyObject(canonical.energy_availability);
  const energyFloor =
    asNonemptyObject(day.energy_floor) ??
    asNonemptyObject(day.energyFloor) ??
    asNonemptyObject(canonical.energyFloor) ??
    asNonemptyObject(canonical.energy_floor);
  return {
    date: typeof day.date === "string" ? day.date : "",
    trainingType,
    trainingLabel,
    hasMacroGuardrails: macroGuardrails !== null,
    hasEnergyAvailability: energyAvailability !== null,
    hasCanonical: Object.keys(canonical).length > 0,
    hasEnergyFloor: energyFloor !== null,
    isRest: trainingType === "rest" || /отдых/i.test(trainingLabel),
  };
}

function findStalePhrases(text: string): string[] {
  return STALE_REVIEW_PHRASES.filter((phrase) => text.includes(phrase));
}

function countTpWorkouts(tpContext: Record<string, unknown>): number {
  const workouts = tpContext.workouts;
  if (Array.isArray(workouts)) {
    return workouts.length;
  }
  if (typeof tpContext.plannedSessions === "number") {
    return tpContext.plannedSessions;
  }
  if (typeof tpContext.totalSessions === "number") {
    return tpContext.totalSessions;
  }
  return 0;
}

function planHasPracticalTarget(planSummary: Record<string, unknown>): boolean {
  const nextWeekPlan = asObject(planSummary.next_week_plan);
  const days = Array.isArray(nextWeekPlan.days) ? nextWeekPlan.days : [];
  return days.some((item) => {
    const day = asObject(item);
    return Boolean(day.practical_target) || Boolean(day.practicalTarget);
  });
}

function isDateInWeek(date: string, weekFrom: string, weekTo: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  return date >= weekFrom && date <= weekTo;
}

export function reviewHasModernMethodology(dailyRows: ReturnType<typeof summarizeDailyRow>[]): boolean {
  if (dailyRows.length === 0) {
    return false;
  }
  return dailyRows.some(
    (row) => row.hasMacroGuardrails && row.hasEnergyAvailability && row.hasCanonical && row.hasEnergyFloor
  );
}

export function analyzeNutritionPageConsistency(
  input: AnalyzeNutritionPageConsistencyInput
): NutritionPageConsistencyIssue[] {
  const issues: NutritionPageConsistencyIssue[] = [];
  const review = input.review ?? null;
  const plan = input.plan ?? null;
  const hasReview = input.hasReview ?? Boolean(review);

  const reportMacroDates = input.reportMacroDates ?? [];
  const reportDataQuality = input.reportDataQuality ?? null;
  if (reportDataQuality) {
    const cardNotice = formatNutritionReportDateMismatchCardNotice(reportDataQuality);
    if (cardNotice) {
      const dateRangeSource =
        typeof reportDataQuality.date_range_source === "string" ? reportDataQuality.date_range_source : null;
      const historicalMismatch = reportDataQuality.date_range_mismatch === true;
      const parsedWeekFrom =
        typeof reportDataQuality.parsed_week_from === "string" ? reportDataQuality.parsed_week_from : null;
      const parsedWeekTo =
        typeof reportDataQuality.parsed_week_to === "string" ? reportDataQuality.parsed_week_to : null;
      const effectiveWeekFrom = input.reportWeekFrom ?? parsedWeekFrom;
      const effectiveWeekTo = input.reportWeekTo ?? parsedWeekTo;
      const macroOverlap =
        reportMacroDates.length > 0 && effectiveWeekFrom && effectiveWeekTo
          ? countDatesOverlappingWeek(reportMacroDates, effectiveWeekFrom, effectiveWeekTo)
          : 0;
      const macroReportOverlapDays =
        typeof reportDataQuality.macro_report_overlap_days === "number"
          ? reportDataQuality.macro_report_overlap_days
          : 0;
      const savedWithParsedWeek =
        dateRangeSource === "parsed_pdf" &&
        effectiveWeekFrom === parsedWeekFrom &&
        effectiveWeekTo === parsedWeekTo;
      const effectivelyAligned =
        savedWithParsedWeek &&
        macroOverlap > 0 &&
        (macroReportOverlapDays >= macroOverlap || macroOverlap >= 5);

      if (dateRangeSource === "ui_fallback") {
        issues.push({
          severity: "warning",
          code: "report_date_ui_fallback",
          message: cardNotice,
        });
      } else if (effectivelyAligned && historicalMismatch && parsedWeekFrom && parsedWeekTo) {
        issues.push({
          severity: "info",
          code: "report_date_adjusted_from_pdf",
          message: `Отчёт сохранён по датам PDF (${formatNutritionCompactWeekRange(parsedWeekFrom, parsedWeekTo)}). Daily macros совпадают с текущей неделей отчёта.`,
        });
      } else {
        issues.push({
          severity: "warning",
          code: "report_date_mismatch",
          message: cardNotice,
          action: historicalMismatch ? "Перезагрузите PDF или проверьте неделю" : undefined,
        });
      }
    }
  }

  if (
    reportMacroDates.length > 0 &&
    input.reportWeekFrom &&
    input.reportWeekTo &&
    countDatesOverlappingWeek(reportMacroDates, input.reportWeekFrom, input.reportWeekTo) === 0
  ) {
    issues.push({
      severity: "warning",
      code: "report_date_mismatch",
      message:
        "Даты daily macros не совпадают с week_from/week_to отчёта. Пересохраните отчёт или перегенерируйте обзор.",
      action: "Пересохраните отчёт",
    });
  }

  if (review) {
    const summary = asObject(review.nutritionSummary);
    const dailyAnalysis = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
    const dailyRows = dailyAnalysis.map(summarizeDailyRow);
    const generationMode =
      typeof summary.generation_mode === "string" ? summary.generation_mode : "fallback";
    const methodologyVersion =
      typeof summary.methodology_version === "string" ? summary.methodology_version : null;
    const coachSummaryText =
      typeof summary.coach_summary_text === "string" ? summary.coach_summary_text : "";
    const dayByDayText =
      typeof summary.day_by_day_analysis_text === "string" ? summary.day_by_day_analysis_text : "";
    const athleteDraft = review.athleteMessageDraft ?? "";
    const storedText = [coachSummaryText, dayByDayText, athleteDraft].join("\n");
    const storedStalePhrases = findStalePhrases(storedText);
    const derivedCoachDayByDay = buildDerivedNutritionCoachDayByDayText(review) ?? "";
    const primaryStalePhrases = findStalePhrases(derivedCoachDayByDay);

    if (generationMode === "fallback" || generationMode === "template") {
      issues.push({
        severity: "warning",
        code: "review_fallback_mode",
        message: "Обзор создан в шаблонном режиме — проверьте вручную или перегенерируйте.",
        action: "Перегенерируйте обзор",
      });
    }

    const modernEnough = reviewHasModernMethodology(dailyRows);
    if (dailyRows.length > 0 && !modernEnough) {
      issues.push({
        severity: "warning",
        code: "review_stale_methodology",
        message: "Обзор создан до обновления методики питания (нет macroGuardrails / energyAvailability).",
        action: "Перегенерируйте обзор",
      });
    } else {
      const storedLayerOnlyStale =
        methodologyVersion === NUTRITION_REVIEW_METHODOLOGY_VERSION &&
        modernEnough &&
        primaryStalePhrases.length === 0 &&
        storedStalePhrases.length > 0;
      if (storedLayerOnlyStale) {
        // Legacy stored coach/day-by-day text may still contain old phrases while derived facts are current.
      } else if (primaryStalePhrases.length > 0) {
        issues.push({
          severity: "warning",
          code: "review_stale_methodology",
          message: `Обзор содержит устаревшие формулировки (${primaryStalePhrases.join(", ")}).`,
          action: "Перегенерируйте обзор",
        });
      } else if (storedStalePhrases.length > 0) {
        issues.push({
          severity: "warning",
          code: "review_stale_methodology",
          message: `Обзор содержит устаревшие формулировки (${storedStalePhrases.join(", ")}).`,
          action: "Перегенерируйте обзор",
        });
      }
    }

    const datedRows = dailyRows.filter((row) => row.date);
    if (datedRows.length > 0) {
      const outsideWeek = datedRows.filter(
        (row) => !isDateInWeek(row.date, input.selectedWeekFrom, input.selectedWeekTo)
      );
      const allOutside = outsideWeek.length === datedRows.length;
      const anyOutside = outsideWeek.length > 0;
      if (anyOutside || allOutside) {
        issues.push({
          severity: "warning",
          code: "daily_dates_mismatch",
          message: "Даты дневного разбора не совпадают с выбранной неделей. Перегенерируйте обзор для этой недели.",
          action: "Перегенерируйте обзор",
        });
      }
    }

    const savedPastTp = asObject(review.tpPastWeekContext);
    const tpWorkoutCount = countTpWorkouts(savedPastTp);
    const workoutLinkedDays = dailyRows.filter((row) => !row.isRest).length;
    if (tpWorkoutCount > 0 && workoutLinkedDays === 0 && dailyRows.length > 0) {
      issues.push({
        severity: "warning",
        code: "tp_daily_join_mismatch",
        message:
          "TrainingPeaks видит тренировки за эту неделю, но дневной разбор их не использует. Перегенерируйте обзор.",
        action: "Перегенерируйте обзор",
      });
    }

    issues.push({
      severity: "info",
      code: "coach_details_stored_layer",
      message:
        "Детали для тренера — служебный сохранённый обзор. Для отправки ученику используйте только «Черновик ученику — полный текст».",
    });
  }

  if (hasReview && input.targetPlanWeekFrom && input.targetPlanWeekTo) {
    if (!plan) {
      issues.push({
        severity: "warning",
        code: "missing_target_plan",
        message: "Сохранённого фокуса на эту неделю пока нет.",
        action: "Сгенерируйте фокус",
      });
    } else if (input.selectedPlanWrongWeek) {
      issues.push({
        severity: "warning",
        code: "selected_plan_wrong_week",
        message: "Выбранный фокус относится к другой неделе. Для полного текста сгенерируйте фокус на текущую неделю.",
        action: "Сгенерируйте фокус",
      });
    } else {
      const planSummary = asObject(plan.planSummary);
      const nextWeekPlan = asObject(planSummary.next_week_plan);
      const hasNextWeekPlan = Boolean(nextWeekPlan.days);
      const hasPracticalTarget = planHasPracticalTarget(planSummary);
      if (hasNextWeekPlan && !hasPracticalTarget) {
        issues.push({
          severity: "warning",
          code: "plan_stale_methodology",
          message: "Фокус создан до обновления практичных ориентиров. Перегенерируйте фокус.",
          action: "Перегенерируйте фокус",
        });
      } else if (
        hasNextWeekPlan &&
        hasPracticalTarget &&
        typeof planSummary.methodology_version !== "string"
      ) {
        issues.push({
          severity: "info",
          code: "plan_stale_methodology",
          message: "Фокус с практичными ориентирами сохранён без methodology_version — это допустимо.",
        });
      }
    }
  }

  return issues;
}

export function getActionablePageConsistencyIssues(
  issues: NutritionPageConsistencyIssue[]
): NutritionPageConsistencyIssue[] {
  return issues.filter((issue) => issue.severity === "warning" || issue.severity === "error");
}

export function hasStaleReviewIssues(issues: NutritionPageConsistencyIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.code === "review_stale_methodology" ||
      issue.code === "review_fallback_mode" ||
      issue.code === "daily_dates_mismatch" ||
      issue.code === "tp_daily_join_mismatch"
  );
}
