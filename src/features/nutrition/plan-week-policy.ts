import { TRAININGPEAKS_TIME_ZONE } from "@/features/trainingpeaks/week";

export type NutritionPlanTargetWeekMode = "current_week" | "next_week";

export type NutritionPlanTargetWeek = {
  planWeekFrom: string;
  planWeekTo: string;
  mode: NutritionPlanTargetWeekMode;
  label: string;
};

function parseIsoLocalDate(isoDate: string): Date {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid local date for nutrition plan week policy: ${isoDate}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function getMondayBasedWeekday(date: Date): number {
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function shiftUtcDate(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getCalendarWeekContaining(isoDate: string): { weekFrom: string; weekTo: string } {
  const date = parseIsoLocalDate(isoDate);
  const mondayOffset = getMondayBasedWeekday(date) - 1;
  const weekStart = shiftUtcDate(date, -mondayOffset);
  const weekEnd = shiftUtcDate(weekStart, 6);
  return { weekFrom: formatIsoDate(weekStart), weekTo: formatIsoDate(weekEnd) };
}

function getNextCalendarWeekAfter(isoDate: string): { weekFrom: string; weekTo: string } {
  const date = parseIsoLocalDate(isoDate);
  const mondayOffset = getMondayBasedWeekday(date) - 1;
  const currentWeekStart = shiftUtcDate(date, -mondayOffset);
  const nextWeekStart = shiftUtcDate(currentWeekStart, 7);
  const nextWeekEnd = shiftUtcDate(nextWeekStart, 6);
  return { weekFrom: formatIsoDate(nextWeekStart), weekTo: formatIsoDate(nextWeekEnd) };
}

export function getNutritionAdminLocalDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRAININGPEAKS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Failed to resolve nutrition admin local date.");
  }
  return `${year}-${month}-${day}`;
}

export function resolveNutritionPlanTargetWeek(input: {
  todayLocalDate: string;
  weekStartsOn?: "monday";
}): NutritionPlanTargetWeek {
  void input.weekStartsOn;
  const weekday = getMondayBasedWeekday(parseIsoLocalDate(input.todayLocalDate));
  if (weekday === 7) {
    const week = getNextCalendarWeekAfter(input.todayLocalDate);
    return {
      planWeekFrom: week.weekFrom,
      planWeekTo: week.weekTo,
      mode: "next_week",
      label: "Фокус питания на следующую неделю",
    };
  }

  const week = getCalendarWeekContaining(input.todayLocalDate);
  return {
    planWeekFrom: week.weekFrom,
    planWeekTo: week.weekTo,
    mode: "current_week",
    label: "Фокус питания на текущую неделю",
  };
}

export function getNutritionPlanTargetWeekToday(now = new Date()): NutritionPlanTargetWeek {
  return resolveNutritionPlanTargetWeek({ todayLocalDate: getNutritionAdminLocalDate(now) });
}

/** @deprecated Legacy helper from review weekTo+1 era. Use resolveNutritionPlanTargetWeek for new plans. */
export function calculateNutritionPlanWeekFromReviewEnd(sourceReviewWeekTo: string): {
  from: string;
  to: string;
} {
  const end = parseIsoLocalDate(sourceReviewWeekTo);
  const nextStart = shiftUtcDate(end, 1);
  const nextEnd = shiftUtcDate(nextStart, 6);
  return { from: formatIsoDate(nextStart), to: formatIsoDate(nextEnd) };
}
