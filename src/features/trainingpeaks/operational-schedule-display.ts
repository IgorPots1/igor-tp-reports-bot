import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const DEFAULT_COACH_TIMEZONE = "Europe/Belgrade";

export type WeekScope = "this_week" | "next_week" | "default";

const DAY_MONDAY_OFFSET: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

const DAY_SHORT_RU: Record<string, string> = {
  Monday: "пн",
  Tuesday: "вт",
  Wednesday: "ср",
  Thursday: "чт",
  Friday: "пт",
  Saturday: "сб",
  Sunday: "вс",
};

export type ScheduleStructuredPayload = {
  available_days?: string[];
  unavailable_days?: string[];
  resolved_available_dates?: string[];
  duration_days?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
};

export type EpisodeScheduleContext = {
  availableDays: string[];
  availableDates: string[];
  observedAt: string | null;
};

function parseIsoDateFallback(input: string): Date {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function toCoachDateKey(input: Date, timeZone = DEFAULT_COACH_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input);
}

function coachWeekdayIndex(dateKey: string): number | null {
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.getUTCDay();
}

function isoDateFromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function shiftDateKey(dateKey: string, days: number): string {
  const parsed = isoDateFromDateKey(dateKey);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function startOfWeekMondayFromDateKey(dateKey: string): string {
  const weekday = coachWeekdayIndex(dateKey);
  if (weekday === null) {
    return dateKey;
  }
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return shiftDateKey(dateKey, delta);
}

function coachWeekStart(dateKey: string, weekScope: WeekScope): string {
  const monday = startOfWeekMondayFromDateKey(dateKey);
  if (weekScope === "next_week") {
    return shiftDateKey(monday, 7);
  }
  if (weekScope === "this_week") {
    const weekday = coachWeekdayIndex(dateKey);
    if (weekday === 0 || weekday === 6) {
      return shiftDateKey(monday, 7);
    }
    return monday;
  }
  return monday;
}

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readPositiveInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return null;
}

export function detectWeekScopeFromText(text: string): WeekScope | null {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("на следующей неделе") ||
    normalized.includes("следующей неделе") ||
    normalized.includes("на след неделе")
  ) {
    return "next_week";
  }
  if (normalized.includes("на этой неделе") || normalized.includes("на этой")) {
    return "this_week";
  }
  return null;
}

export function parseDurationDaysFromText(text: string): number | null {
  const match = text.match(/на\s+(\d{1,2})\s+дн/iu);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveDayToIsoDate(
  day: string,
  observedAt: string,
  weekScope: WeekScope | null
): string | null {
  const offset = DAY_MONDAY_OFFSET[day];
  if (offset === undefined) {
    return null;
  }
  const observedDateKey = toCoachDateKey(parseIsoDateFallback(observedAt));

  if (weekScope === "this_week" || weekScope === "next_week") {
    const weekStart = coachWeekStart(observedDateKey, weekScope);
    return shiftDateKey(weekStart, offset);
  }

  const weekday = coachWeekdayIndex(observedDateKey);
  if (weekday === null) {
    return null;
  }
  const targetDow = offset === 6 ? 0 : offset + 1;
  let delta = (targetDow - weekday + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return shiftDateKey(observedDateKey, delta);
}

export function resolveAvailableDayDates(
  availableDays: string[],
  observedAt: string,
  weekScope: WeekScope | null
): string[] {
  const dates = availableDays
    .map((day) => resolveDayToIsoDate(day, observedAt, weekScope))
    .filter((value): value is string => Boolean(value));
  return [...new Set(dates)].sort();
}

export function shiftIsoDate(isoDateKey: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(isoDateKey)) {
    return null;
  }
  return shiftDateKey(isoDateKey, days);
}

export function inferUnavailabilityAfterAvailableDates(input: {
  availableDates: string[];
  durationDays: number;
}): { validFrom: string; validUntil: string } | null {
  if (input.availableDates.length === 0 || input.durationDays <= 0) {
    return null;
  }
  const sorted = [...input.availableDates].sort();
  const lastAvailable = sorted[sorted.length - 1]!;
  const validFrom = shiftIsoDate(lastAvailable, 1);
  if (!validFrom) {
    return null;
  }
  const validUntil = shiftIsoDate(validFrom, input.durationDays - 1);
  if (!validUntil) {
    return null;
  }
  return { validFrom, validUntil };
}

export function enrichScheduleStructuredPayload(
  text: string,
  observedAt: string,
  payload: ScheduleStructuredPayload
): void {
  const normalized = text.toLowerCase();
  const weekScope = detectWeekScopeFromText(normalized);
  const availableDays = readStringArray(payload.available_days);
  const unavailableDays = readStringArray(payload.unavailable_days);
  const observedDateKey = toCoachDateKey(parseIsoDateFallback(observedAt));

  if (weekScope === "this_week") {
    const weekStart = coachWeekStart(observedDateKey, "this_week");
    payload.valid_from = weekStart;
    payload.valid_until = shiftDateKey(weekStart, 6);
  } else if (weekScope === "next_week") {
    const weekStart = coachWeekStart(observedDateKey, "next_week");
    payload.valid_from = weekStart;
    payload.valid_until = shiftDateKey(weekStart, 6);
  }

  if (availableDays.length > 0) {
    const resolved = resolveAvailableDayDates(availableDays, observedAt, weekScope);
    if (resolved.length > 0) {
      payload.resolved_available_dates = resolved;
      if (!weekScope && !payload.valid_from) {
        payload.valid_from = resolved[0] ?? null;
      }
      if (!weekScope && !payload.valid_until) {
        payload.valid_until = resolved[resolved.length - 1] ?? null;
      }
    }
  }

  const durationDays = parseDurationDaysFromText(normalized) ?? readPositiveInt(payload.duration_days);
  if (durationDays) {
    payload.duration_days = durationDays;
  }

  const hasPostponedCue = normalized.includes("потом");
  const hasRunUnavailability = /точно бегать не смогу|не смогу бегать|бегать не смогу/iu.test(normalized);
  if (durationDays && hasRunUnavailability && !payload.valid_from) {
    if (normalized.includes("сегодня")) {
      const today = observedDateKey;
      payload.valid_from = today;
      payload.valid_until = shiftIsoDate(today, durationDays - 1);
    } else if (hasPostponedCue && payload.resolved_available_dates && payload.resolved_available_dates.length > 0) {
      const inferred = inferUnavailabilityAfterAvailableDates({
        availableDates: payload.resolved_available_dates,
        durationDays,
      });
      if (inferred) {
        payload.valid_from = inferred.validFrom;
        payload.valid_until = inferred.validUntil;
      }
    }
  }

  if (unavailableDays.length > 0 && !payload.resolved_available_dates) {
    const resolvedUnavailable = resolveAvailableDayDates(unavailableDays, observedAt, weekScope);
    if (resolvedUnavailable.length > 0 && !payload.valid_from) {
      payload.valid_from = resolvedUnavailable[0] ?? null;
      payload.valid_until = resolvedUnavailable[resolvedUnavailable.length - 1] ?? null;
    }
  }
}

function formatDayDateList(dates: string[]): string {
  return dates
    .map((date) => {
      const parsed = isoDateFromDateKey(date);
      const dow = parsed.getUTCDay();
      const dayName = (
        {
          1: "Monday",
          2: "Tuesday",
          3: "Wednesday",
          4: "Thursday",
          5: "Friday",
          6: "Saturday",
          0: "Sunday",
        } as Record<number, string>
      )[dow];
      const short = dayName ? DAY_SHORT_RU[dayName] ?? dayName.slice(0, 2).toLowerCase() : null;
      const displayDate = `${date.slice(8, 10)}.${date.slice(5, 7)}`;
      return short ? `${short} ${displayDate}` : displayDate;
    })
    .join(", ");
}

function formatDateRange(validFrom: string | null, validUntil: string | null): string | null {
  const fmt = (value: string): string => `${value.slice(8, 10)}.${value.slice(5, 7)}`;
  if (validFrom && validUntil) {
    return validFrom === validUntil ? fmt(validFrom) : `${fmt(validFrom)}—${fmt(validUntil)}`;
  }
  if (validFrom) {
    return `с ${fmt(validFrom)}`;
  }
  if (validUntil) {
    return `до ${fmt(validUntil)}`;
  }
  return null;
}

export function getSignalMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isAvailabilityScheduleSignalType(signalType: string): boolean {
  return signalType === "schedule_availability_window" || signalType === "plan_generation_constraint";
}

function isUnavailabilityScheduleSignalType(signalType: string): boolean {
  return signalType === "schedule_unavailability_window";
}

export function buildEpisodeScheduleContextIndex(
  signals: TrainingPeaksStudentOperationalSignal[]
): Map<string, EpisodeScheduleContext> {
  const index = new Map<string, EpisodeScheduleContext>();

  for (const signal of signals) {
    if (!isAvailabilityScheduleSignalType(signal.signalType)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    if (!episodeKey) {
      continue;
    }
    const dedupeKey = `${signal.studentId}:${episodeKey}`;
    const structured = signal.structuredPayload as ScheduleStructuredPayload;
    const availableDays = readStringArray(structured.available_days);
    const resolvedDates = readStringArray(structured.resolved_available_dates);
    const observedAt =
      getSignalMetadataString(signal.metadata, "observed_at") ??
      signal.createdAt ??
      null;

    const existing = index.get(dedupeKey) ?? {
      availableDays: [],
      availableDates: [],
      observedAt: null,
    };
    existing.availableDays = [...new Set([...existing.availableDays, ...availableDays])];
    existing.availableDates = [...new Set([...existing.availableDates, ...resolvedDates])];
    if (!existing.observedAt && observedAt) {
      existing.observedAt = observedAt;
    }
    if (existing.availableDates.length === 0 && availableDays.length > 0 && observedAt) {
      const weekScope = detectWeekScopeFromText(
        getSignalMetadataString(signal.metadata, "constraint_text") ?? ""
      );
      existing.availableDates = resolveAvailableDayDates(availableDays, observedAt, weekScope);
    }
    index.set(dedupeKey, existing);
  }

  return index;
}

export function formatScheduleOperationalSignalText(input: {
  signalType: string;
  validFrom: string | null;
  validUntil: string | null;
  structuredPayload: Record<string, unknown>;
  episodeContext?: EpisodeScheduleContext | null;
}): string {
  const structured = input.structuredPayload as ScheduleStructuredPayload;
  const availableDays = readStringArray(structured.available_days);
  const resolvedDates = readStringArray(structured.resolved_available_dates);
  const durationDays = readPositiveInt(structured.duration_days) ?? null;

  let validFrom = input.validFrom ?? structured.valid_from ?? null;
  let validUntil = input.validUntil ?? structured.valid_until ?? null;

  if (
    isUnavailabilityScheduleSignalType(input.signalType) &&
    durationDays &&
    !validFrom &&
    input.episodeContext?.availableDates.length
  ) {
    const inferred = inferUnavailabilityAfterAvailableDates({
      availableDates: input.episodeContext.availableDates,
      durationDays,
    });
    if (inferred) {
      validFrom = inferred.validFrom;
      validUntil = inferred.validUntil;
    }
  }

  const range = formatDateRange(validFrom, validUntil);

  if (isAvailabilityScheduleSignalType(input.signalType)) {
    const dates =
      resolvedDates.length > 0
        ? resolvedDates
        : input.episodeContext?.availableDates.length
          ? input.episodeContext.availableDates
          : [];
    if (dates.length > 0) {
      return `доступна: ${formatDayDateList(dates)}`;
    }
    if (availableDays.length > 0) {
      const dayLabels = availableDays
        .map((day) => DAY_SHORT_RU[day] ?? day.slice(0, 2))
        .join(", ");
      return range ? `доступна (${range}): ${dayLabels}` : `доступна: ${dayLabels}`;
    }
  }

  if (isUnavailabilityScheduleSignalType(input.signalType)) {
    if (range) {
      return `недоступна: ${range}`;
    }
    if (durationDays) {
      const lastDay = input.episodeContext?.availableDays.find((day) => day === "Thursday");
      if (lastDay) {
        return `недоступность: ${durationDays} дня после четверга`;
      }
      return `недоступность: ${durationDays} дн.`;
    }
    if (availableDays.length > 0) {
      const dayLabels = availableDays.map((day) => DAY_SHORT_RU[day] ?? day).join(", ");
      return `недоступна: ${dayLabels}`;
    }
    return "недоступность";
  }

  if (input.signalType === "plan_generation_constraint") {
    const constraintDates =
      resolvedDates.length > 0
        ? resolvedDates
        : input.episodeContext?.availableDates.length
          ? input.episodeContext.availableDates
          : [];
    if (constraintDates.length > 0) {
      return `учесть в плане: ${formatDayDateList(constraintDates)}`;
    }
    if (availableDays.length > 0) {
      const dayLabels = availableDays.map((day) => DAY_SHORT_RU[day] ?? day).join(", ");
      return range ? `учесть в плане (${range}): ${dayLabels}` : `учесть в плане: ${dayLabels}`;
    }
  }

  return range ? `ограничение (${range})` : "ограничение плана";
}
