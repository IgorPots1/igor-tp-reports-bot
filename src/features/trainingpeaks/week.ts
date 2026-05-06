import type { TrainingPeaksWeek } from "@/features/trainingpeaks/repository";

export const TRAININGPEAKS_TIME_ZONE = "Europe/Belgrade";

function getDatePart(parts: Intl.DateTimeFormatPart[], type: "year" | "month" | "day"): number {
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Failed to read ${type} for TrainingPeaks week calculation.`);
  }

  return parsed;
}

function getZonedDateAsUtc(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRAININGPEAKS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return new Date(
    Date.UTC(
      getDatePart(parts, "year"),
      getDatePart(parts, "month") - 1,
      getDatePart(parts, "day")
    )
  );
}

function shiftUtcDate(date: Date, days: number): Date {
  const shiftedDate = new Date(date.getTime());
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);
  return shiftedDate;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMondayBasedWeekday(date: Date): number {
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function getTrainingPeaksWeekByOffset(weekOffset: number, now = new Date()): TrainingPeaksWeek {
  const zonedToday = getZonedDateAsUtc(now);
  const mondayOffset = getMondayBasedWeekday(zonedToday) - 1;
  const currentWeekStart = shiftUtcDate(zonedToday, -mondayOffset);
  const weekStart = shiftUtcDate(currentWeekStart, weekOffset * 7);
  const weekEnd = shiftUtcDate(weekStart, 6);

  return {
    weekFrom: formatIsoDate(weekStart),
    weekTo: formatIsoDate(weekEnd),
  };
}

export function getCurrentTrainingPeaksWeek(now = new Date()): TrainingPeaksWeek {
  return getTrainingPeaksWeekByOffset(0, now);
}

export function getPreviousTrainingPeaksWeek(now = new Date()): TrainingPeaksWeek {
  return getTrainingPeaksWeekByOffset(-1, now);
}

export function getWeekBeforePreviousTrainingPeaksWeek(now = new Date()): TrainingPeaksWeek {
  return getTrainingPeaksWeekByOffset(-2, now);
}

export function resolveTrainingPeaksWeekKeyword(
  keyword: string,
  now = new Date()
): TrainingPeaksWeek | null {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("en-US");

  if (normalizedKeyword === "current") {
    return getCurrentTrainingPeaksWeek(now);
  }

  if (normalizedKeyword === "last" || normalizedKeyword === "previous") {
    return getPreviousTrainingPeaksWeek(now);
  }

  return null;
}
