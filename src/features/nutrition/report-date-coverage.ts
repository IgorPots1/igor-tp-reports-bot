import type { NormalizedManualMacroRow } from "@/features/nutrition/context";

export type NutritionDateCoverageSource = "pdf_rows" | "fallback_ui_week" | "unknown";

export type NutritionParsedDateCoverage = {
  parsedWeekFrom: string | null;
  parsedWeekTo: string | null;
  parsedDateCount: number;
  parsedDateMin: string | null;
  parsedDateMax: string | null;
  dateCoverage: {
    source: NutritionDateCoverageSource;
    dates: string[];
    missingDatesInRange?: string[];
    warnings: string[];
  };
};

export type NutritionReportDateRangeComparison = {
  overlapDays: number;
  mismatch: boolean;
  severity: "none" | "warning" | "error";
  message: string | null;
};

export type NutritionEffectiveReportWeek = {
  effectiveWeekFrom: string;
  effectiveWeekTo: string;
  dateRangeSource: "parsed_pdf" | "ui_fallback";
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function listIsoDateRange(weekFrom: string, weekTo: string): string[] {
  const dates: string[] = [];
  let cursor = weekFrom;
  while (cursor <= weekTo) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function countWeekRangeOverlapDays(input: {
  leftFrom: string;
  leftTo: string;
  rightFrom: string;
  rightTo: string;
}): number {
  const overlapFrom = input.leftFrom > input.rightFrom ? input.leftFrom : input.rightFrom;
  const overlapTo = input.leftTo < input.rightTo ? input.leftTo : input.rightTo;
  if (overlapFrom > overlapTo) {
    return 0;
  }
  return listIsoDateRange(overlapFrom, overlapTo).length;
}

export function countDatesOverlappingWeek(dates: string[], weekFrom: string, weekTo: string): number {
  return dates.filter((date) => date >= weekFrom && date <= weekTo).length;
}

function resolveParsedDatesFromRows(rows: NormalizedManualMacroRow[]): string[] {
  return [...new Set(rows.map((row) => row.day).filter((day) => ISO_DATE_PATTERN.test(day)))].sort();
}

export function computeNutritionParsedDateCoverageFromRows(
  rows: NormalizedManualMacroRow[],
  options?: {
    uiWeekFrom?: string;
    uiWeekTo?: string;
    source?: NutritionDateCoverageSource;
  }
): NutritionParsedDateCoverage {
  const dates = resolveParsedDatesFromRows(rows);
  const parsedWeekFrom = dates[0] ?? null;
  const parsedWeekTo = dates[dates.length - 1] ?? null;
  const warnings: string[] = [];

  let source: NutritionDateCoverageSource = options?.source ?? "unknown";
  if (parsedWeekFrom && parsedWeekTo) {
    source = options?.source ?? "pdf_rows";
  } else if (options?.uiWeekFrom && options?.uiWeekTo) {
    source = "fallback_ui_week";
  }

  let missingDatesInRange: string[] | undefined;
  if (parsedWeekFrom && parsedWeekTo) {
    const expectedDates = listIsoDateRange(parsedWeekFrom, parsedWeekTo);
    missingDatesInRange = expectedDates.filter((date) => !dates.includes(date));
    if (missingDatesInRange.length > 0) {
      warnings.push(`parsed_dates_incomplete:${missingDatesInRange.join(",")}`);
    }
  }

  if (options?.uiWeekFrom && options?.uiWeekTo && parsedWeekFrom && parsedWeekTo) {
    const comparison = compareNutritionReportDateRanges({
      uiWeekFrom: options.uiWeekFrom,
      uiWeekTo: options.uiWeekTo,
      parsedWeekFrom,
      parsedWeekTo,
    });
    if (comparison.mismatch && comparison.message) {
      warnings.push(comparison.message);
    }
  }

  return {
    parsedWeekFrom,
    parsedWeekTo,
    parsedDateCount: dates.length,
    parsedDateMin: parsedWeekFrom,
    parsedDateMax: parsedWeekTo,
    dateCoverage: {
      source,
      dates,
      missingDatesInRange,
      warnings,
    },
  };
}

export function compareNutritionReportDateRanges(input: {
  uiWeekFrom: string;
  uiWeekTo: string;
  parsedWeekFrom: string | null;
  parsedWeekTo: string | null;
}): NutritionReportDateRangeComparison {
  if (!input.parsedWeekFrom || !input.parsedWeekTo) {
    return {
      overlapDays: 0,
      mismatch: false,
      severity: "none",
      message: null,
    };
  }

  const overlapDays = countWeekRangeOverlapDays({
    leftFrom: input.uiWeekFrom,
    leftTo: input.uiWeekTo,
    rightFrom: input.parsedWeekFrom,
    rightTo: input.parsedWeekTo,
  });

  if (overlapDays >= 5) {
    return {
      overlapDays,
      mismatch: false,
      severity: "none",
      message: null,
    };
  }

  if (overlapDays >= 1) {
    return {
      overlapDays,
      mismatch: true,
      severity: "warning",
      message: `ui_parsed_week_partial_overlap:${input.uiWeekFrom}..${input.uiWeekTo}_vs_${input.parsedWeekFrom}..${input.parsedWeekTo}`,
    };
  }

  return {
    overlapDays: 0,
    mismatch: true,
    severity: "warning",
    message: `ui_parsed_week_no_overlap:${input.uiWeekFrom}..${input.uiWeekTo}_vs_${input.parsedWeekFrom}..${input.parsedWeekTo}`,
  };
}

export function resolveNutritionEffectiveReportWeek(input: {
  uiWeekFrom: string;
  uiWeekTo: string;
  parsedWeekFrom: string | null;
  parsedWeekTo: string | null;
}): NutritionEffectiveReportWeek {
  if (input.parsedWeekFrom && input.parsedWeekTo) {
    return {
      effectiveWeekFrom: input.parsedWeekFrom,
      effectiveWeekTo: input.parsedWeekTo,
      dateRangeSource: "parsed_pdf",
    };
  }
  return {
    effectiveWeekFrom: input.uiWeekFrom,
    effectiveWeekTo: input.uiWeekTo,
    dateRangeSource: "ui_fallback",
  };
}

export function buildNutritionReportDateQualityMetadata(input: {
  uiWeekFrom: string;
  uiWeekTo: string;
  parsedCoverage: NutritionParsedDateCoverage;
  existing?: Record<string, unknown>;
}): Record<string, unknown> {
  const comparison = compareNutritionReportDateRanges({
    uiWeekFrom: input.uiWeekFrom,
    uiWeekTo: input.uiWeekTo,
    parsedWeekFrom: input.parsedCoverage.parsedWeekFrom,
    parsedWeekTo: input.parsedCoverage.parsedWeekTo,
  });
  const effectiveWeek = resolveNutritionEffectiveReportWeek({
    uiWeekFrom: input.uiWeekFrom,
    uiWeekTo: input.uiWeekTo,
    parsedWeekFrom: input.parsedCoverage.parsedWeekFrom,
    parsedWeekTo: input.parsedCoverage.parsedWeekTo,
  });
  const macroReportOverlapDays =
    input.parsedCoverage.parsedWeekFrom && input.parsedCoverage.parsedWeekTo
      ? countWeekRangeOverlapDays({
          leftFrom: effectiveWeek.effectiveWeekFrom,
          leftTo: effectiveWeek.effectiveWeekTo,
          rightFrom: input.parsedCoverage.parsedWeekFrom,
          rightTo: input.parsedCoverage.parsedWeekTo,
        })
      : 0;

  return {
    ...(input.existing ?? {}),
    date_range_source: effectiveWeek.dateRangeSource,
    parsed_week_from: input.parsedCoverage.parsedWeekFrom,
    parsed_week_to: input.parsedCoverage.parsedWeekTo,
    ui_week_from: input.uiWeekFrom,
    ui_week_to: input.uiWeekTo,
    date_range_mismatch: comparison.mismatch,
    date_range_overlap_days: comparison.overlapDays,
    macro_report_overlap_days: macroReportOverlapDays,
    parsed_date_count: input.parsedCoverage.parsedDateCount,
    parsed_dates: input.parsedCoverage.dateCoverage.dates,
    ...(comparison.mismatch
      ? {
          date_range_mismatch_reason: comparison.message,
        }
      : {}),
  };
}

export function formatNutritionCompactWeekRange(weekFrom: string, weekTo: string): string {
  const formatPart = (isoDate: string) => {
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return isoDate;
    }
    return `${match[3]}.${match[2]}`;
  };
  return `${formatPart(weekFrom)}—${formatPart(weekTo)}`;
}

export function formatNutritionReportDateMismatchNotice(input: {
  uiWeekFrom: string;
  uiWeekTo: string;
  effectiveWeekFrom: string;
  effectiveWeekTo: string;
  dateRangeSource: "parsed_pdf" | "ui_fallback";
  mismatch: boolean;
}): string | null {
  if (input.dateRangeSource === "ui_fallback") {
    return "Даты в PDF не распознаны, использована выбранная неделя.";
  }
  if (!input.mismatch) {
    return null;
  }
  return `PDF распознан как ${formatNutritionCompactWeekRange(input.effectiveWeekFrom, input.effectiveWeekTo)}. Выбранная неделя была ${formatNutritionCompactWeekRange(input.uiWeekFrom, input.uiWeekTo)}, поэтому отчёт сохранён по датам из PDF.`;
}

export function formatNutritionReportDateMismatchCardNotice(dataQuality: Record<string, unknown>): string | null {
  const dateRangeSource =
    typeof dataQuality.date_range_source === "string" ? dataQuality.date_range_source : null;
  const mismatch = dataQuality.date_range_mismatch === true;
  const uiWeekFrom = typeof dataQuality.ui_week_from === "string" ? dataQuality.ui_week_from : null;
  const uiWeekTo = typeof dataQuality.ui_week_to === "string" ? dataQuality.ui_week_to : null;
  const parsedWeekFrom =
    typeof dataQuality.parsed_week_from === "string" ? dataQuality.parsed_week_from : null;
  const parsedWeekTo = typeof dataQuality.parsed_week_to === "string" ? dataQuality.parsed_week_to : null;

  if (dateRangeSource === "ui_fallback") {
    return "Даты в PDF не распознаны, использована выбранная неделя.";
  }
  if (!mismatch || !uiWeekFrom || !uiWeekTo || !parsedWeekFrom || !parsedWeekTo) {
    return null;
  }
  return `PDF за ${formatNutritionCompactWeekRange(parsedWeekFrom, parsedWeekTo)}, но при загрузке была выбрана неделя ${formatNutritionCompactWeekRange(uiWeekFrom, uiWeekTo)}. Отчёт сохранён по датам PDF.`;
}

export function detectNutritionMacroReviewWeekMismatch(input: {
  reviewWeekFrom: string;
  reviewWeekTo: string;
  macroDates: string[];
}): boolean {
  if (input.macroDates.length === 0) {
    return false;
  }
  return countDatesOverlappingWeek(input.macroDates, input.reviewWeekFrom, input.reviewWeekTo) === 0;
}
