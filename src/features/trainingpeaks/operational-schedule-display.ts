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
  planned_training_dates?: string[];
  unavailable_dates?: string[];
  planning_status?: "athlete_intends_to_train" | null;
  duration_days?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  display_summary?: string | null;
  latest_summary?: string | null;
  constraint_reason?: string | null;
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

  const explicitPlannedDates = [
    ...readStringArray(payload.resolved_available_dates),
    ...readStringArray(payload.planned_training_dates),
  ].sort();

  if (weekScope === "this_week") {
    const weekStart = coachWeekStart(observedDateKey, "this_week");
    payload.valid_from = weekStart;
    if (explicitPlannedDates.length === 0) {
      payload.valid_until = shiftDateKey(weekStart, 6);
    }
  } else if (weekScope === "next_week") {
    const weekStart = coachWeekStart(observedDateKey, "next_week");
    payload.valid_from = weekStart;
    if (explicitPlannedDates.length === 0) {
      payload.valid_until = shiftDateKey(weekStart, 6);
    }
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

  if (explicitPlannedDates.length > 0) {
    payload.valid_until = explicitPlannedDates[explicitPlannedDates.length - 1] ?? payload.valid_until;
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

  if (unavailableDays.length > 0 && readStringArray(payload.resolved_available_dates).length === 0) {
    const resolvedUnavailable = resolveAvailableDayDates(unavailableDays, observedAt, weekScope);
    if (resolvedUnavailable.length > 0) {
      if (!payload.valid_from) {
        payload.valid_from = resolvedUnavailable[0] ?? null;
        payload.valid_until = resolvedUnavailable[resolvedUnavailable.length - 1] ?? null;
      }
      if (readStringArray(payload.unavailable_dates).length === 0) {
        payload.unavailable_dates = resolvedUnavailable;
      }
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

function formatCompactDateList(dates: string[]): string {
  return dates.map((date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`).join(", ");
}

function intersectIsoDates(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((date) => rightSet.has(date)))].sort();
}

function readOptionalString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

export function filterScheduleDatesOnOrAfter(
  dates: readonly string[],
  asOfDate: string | null | undefined
): string[] {
  if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/u.test(asOfDate)) {
    return [...dates];
  }
  return dates.filter((date) => date >= asOfDate);
}

export function inferOneOffWeekdayConstraintValidUntil(
  structuredPayload: ScheduleStructuredPayload,
  referenceObservedAt: string
): string | null {
  const unavailableDays = readStringArray(structuredPayload.unavailable_days);
  if (unavailableDays.length === 0) {
    return null;
  }
  const resolved = resolveAvailableDayDates(unavailableDays, referenceObservedAt, null);
  return resolved.length > 0 ? (resolved[resolved.length - 1] ?? null) : null;
}

function compactScheduleRestrictionReason(raw: string): string | null {
  const normalized = raw.replace(/^health_context:\s*/iu, "").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return null;
  }
  const firstClause = normalized.split(/\s*;\s*/u)[0]?.trim() ?? normalized;
  if (!firstClause || /^(недоступн|доступн|планирует|учесть)/iu.test(firstClause)) {
    return null;
  }
  if (/голов/i.test(firstClause)) {
    return /бол|раскалыва|раскол/i.test(firstClause) ? "головная боль" : "голова";
  }
  const withoutClarify = firstClause.replace(/\s*\([^)]*\)\s*/gu, " ").replace(/\s+/gu, " ").trim();
  if (withoutClarify.length < 3) {
    return null;
  }
  return withoutClarify;
}

function stripScheduleGreetingNoise(raw: string): string {
  return raw
    .replace(/^(?:игорь|тренер),?\s*(?:привет!?|здравствуй!?)[,!.]?\s*/iu, "")
    .replace(/^по поводу тренировок(?:\s+на этой неделе)?\s*[-—:]\s*/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function summarizeLongScheduleConstraintText(raw: string): string | null {
  const normalized = stripScheduleGreetingNoise(raw.replace(/\s+/gu, " ").trim());
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();

  if (
    /в\s+дороге/iu.test(lower) ||
    (/пятниц|пт/iu.test(lower) && /суббот|сб/iu.test(lower))
  ) {
    if (/не\s+(?:смогу|могу)\s+бегать|бегать\s+не\s+смогу/iu.test(lower)) {
      return "пт–сб в дороге, бегать не сможет";
    }
    return "пт–сб в дороге — учесть в плане";
  }

  const tueBusy = /(?:вторник|вт\b).*?(?:вечер.*?занят|не\s+смогу|занят)/iu.test(lower);
  const thuTravel = /(?:четверг|чт\b).*?(?:уезжа|отъезд|вечер)/iu.test(lower);
  const shortRunPossible = /(?:корот|утром\s+успе)/iu.test(lower);
  if (tueBusy && thuTravel && shortRunPossible) {
    return "вт вечер занята; чт уезжает вечером — возможна только короткая тренировка до отъезда";
  }
  if (tueBusy && thuTravel) {
    return "вт вечер занята; чт уезжает вечером — учесть в плане";
  }

  for (const [dayPattern, shortLabel] of [
    [/сред[ауы]|ср\b/iu, "ср"],
    [/вторник|вт\b/iu, "вт"],
    [/четверг|чт\b/iu, "чт"],
    [/пятниц|пт\b/iu, "пт"],
  ] as const) {
    if (
      dayPattern.test(lower) &&
      (/не\s+(?:смогу|могу)|занят|нет\s+времени|не\s+смогу\s+найти\s+время/iu.test(lower) ||
        /не\s+смогу.*трениров/iu.test(lower))
    ) {
      return `${shortLabel} не может тренироваться — учесть перенос/альтернативу.`;
    }
  }

  return null;
}

function normalizeCompactScheduleConflictText(text: string): string {
  return text.replace(
    /конфликт расписания:\s*([\d.,\s]+)\s+одновременно недоступна и планирует(?:;\s*что сделать:\s*уточнить дату)?/giu,
    "конфликт расписания на $1: недоступна и планирует — уточнить дату"
  );
}

export function compactCoachFacingScheduleSignalText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  const normalizedConflict = normalizeCompactScheduleConflictText(trimmed);
  if (normalizedConflict !== trimmed) {
    return normalizedConflict.replace(/;\s*что сделать:\s*уточнить дату\.?/giu, "");
  }

  if (hasRichSchedulePartText(trimmed.split("; ")[0] ?? trimmed)) {
    return normalizedConflict;
  }

  const restrictionMatch = trimmed.match(/^ограничение(?::|\s*\([^)]*\):)\s*([\s\S]+)$/iu);
  const candidate = restrictionMatch?.[1]?.replace(/\s*\([^)]*\)\s*$/u, "").trim() ?? trimmed;
  const summarized = summarizeLongScheduleConstraintText(candidate);
  if (summarized) {
    return summarized;
  }

  const withoutGreeting = stripScheduleGreetingNoise(candidate);
  if (withoutGreeting.length > 0 && withoutGreeting.length < candidate.length) {
    const reSummarized = summarizeLongScheduleConstraintText(withoutGreeting);
    if (reSummarized) {
      return reSummarized;
    }
    if (withoutGreeting.length <= 100) {
      const lowered = withoutGreeting.charAt(0).toLowerCase() + withoutGreeting.slice(1);
      return lowered.endsWith(".") ? lowered : `${lowered}.`;
    }
  }

  if (trimmed.length > 120) {
    return `${trimmed.slice(0, 117).trimEnd()}...`;
  }
  return trimmed;
}

function extractShortScheduleRestrictionReason(structured: ScheduleStructuredPayload): string | null {
  const candidates = [
    readOptionalString(structured.display_summary),
    readOptionalString(structured.latest_summary),
    readOptionalString(structured.constraint_reason),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const compact = compactScheduleRestrictionReason(candidate);
    if (compact) {
      return compact;
    }
  }
  return null;
}

function formatGenericScheduleRestrictionText(
  range: string | null,
  structured: ScheduleStructuredPayload
): string {
  const reason = extractShortScheduleRestrictionReason(structured);
  if (reason) {
    const summarized = summarizeLongScheduleConstraintText(reason);
    if (summarized) {
      return summarized;
    }
    if (reason.length <= 80 && !reason.includes("\n")) {
      return range ? `ограничение: ${reason} (${range})` : `ограничение: ${reason}`;
    }
    return compactCoachFacingScheduleSignalText(
      range ? `ограничение (${range}): ${reason}` : `ограничение: ${reason}`
    );
  }
  return range ? `ограничение (${range})` : "ограничение плана";
}

export function getSignalMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isAvailabilityScheduleSignalType(signalType: string): boolean {
  return signalType === "schedule_availability_window" || signalType === "plan_generation_constraint";
}

export function isUnavailabilityScheduleSignalType(signalType: string): boolean {
  return signalType === "schedule_unavailability_window";
}

export type ScheduleOperationalSignalRole = "availability" | "unavailability";

export function getScheduleOperationalSignalRole(signalType: string): ScheduleOperationalSignalRole | null {
  if (isAvailabilityScheduleSignalType(signalType)) {
    return "availability";
  }
  if (isUnavailabilityScheduleSignalType(signalType)) {
    return "unavailability";
  }
  return null;
}

function scheduleSignalStructureScore(
  signal: TrainingPeaksStudentOperationalSignal,
  role: ScheduleOperationalSignalRole
): number {
  const structured = signal.structuredPayload as ScheduleStructuredPayload;
  if (role === "availability") {
    const resolvedDates = readStringArray(structured.resolved_available_dates);
    if (resolvedDates.length > 0) {
      return 100 + resolvedDates.length;
    }
    if (readStringArray(structured.available_days).length > 0) {
      return 50;
    }
    if (signal.validFrom || signal.validUntil || structured.valid_from || structured.valid_until) {
      return 25;
    }
    return 0;
  }

  if (signal.validFrom && signal.validUntil) {
    return 100;
  }
  if (structured.valid_from && structured.valid_until) {
    return 90;
  }
  if (readPositiveInt(structured.duration_days)) {
    return 50;
  }
  return 0;
}

function compareScheduleSignalsForCanonicality(
  left: TrainingPeaksStudentOperationalSignal,
  right: TrainingPeaksStudentOperationalSignal,
  role: ScheduleOperationalSignalRole
): number {
  const leftScore = scheduleSignalStructureScore(left, role);
  const rightScore = scheduleSignalStructureScore(right, role);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "1970-01-01T00:00:00.000Z");
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "1970-01-01T00:00:00.000Z");
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return left.id.localeCompare(right.id);
}

export function pickCanonicalScheduleSignalByRole(
  signals: readonly TrainingPeaksStudentOperationalSignal[],
  role: ScheduleOperationalSignalRole
): TrainingPeaksStudentOperationalSignal | null {
  const candidates = signals.filter((signal) => getScheduleOperationalSignalRole(signal.signalType) === role);
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort((left, right) => compareScheduleSignalsForCanonicality(left, right, role))[0] ?? null;
}

export function buildCanonicalEpisodeScheduleContext(
  signals: readonly TrainingPeaksStudentOperationalSignal[]
): EpisodeScheduleContext {
  const availabilitySignal = pickCanonicalScheduleSignalByRole(signals, "availability");
  if (!availabilitySignal) {
    return {
      availableDays: [],
      availableDates: [],
      observedAt: null,
    };
  }

  const structured = availabilitySignal.structuredPayload as ScheduleStructuredPayload;
  const availableDays = readStringArray(structured.available_days);
  const resolvedDates = readStringArray(structured.resolved_available_dates);
  const observedAt =
    getSignalMetadataString(availabilitySignal.metadata, "observed_at") ??
    availabilitySignal.createdAt ??
    null;

  let availableDates = resolvedDates;
  if (availableDates.length === 0 && availableDays.length > 0 && observedAt) {
    const weekScope = detectWeekScopeFromText(
      getSignalMetadataString(availabilitySignal.metadata, "constraint_text") ?? ""
    );
    availableDates = resolveAvailableDayDates(availableDays, observedAt, weekScope);
  }

  return {
    availableDays,
    availableDates,
    observedAt,
  };
}

function isLegacyVagueScheduleUnavailabilityText(text: string): boolean {
  return text === "недоступность" || text.startsWith("недоступность:");
}

function hasRichSchedulePartText(text: string): boolean {
  return (
    text.startsWith("доступна:") ||
    text.startsWith("недоступна:") ||
    text.startsWith("учесть в плане:")
  );
}

export function buildCanonicalEpisodeScheduleDisplayText(input: {
  signals: readonly TrainingPeaksStudentOperationalSignal[];
  asOfDate?: string | null;
}): string {
  const episodeContext = buildCanonicalEpisodeScheduleContext(input.signals);
  const availabilitySignal = pickCanonicalScheduleSignalByRole(input.signals, "availability");
  const unavailabilitySignal = pickCanonicalScheduleSignalByRole(input.signals, "unavailability");

  const parts: string[] = [];
  if (availabilitySignal) {
    const availabilityText = formatScheduleOperationalSignalText({
      signalType: availabilitySignal.signalType,
      validFrom: availabilitySignal.validFrom,
      validUntil: availabilitySignal.validUntil,
      structuredPayload: availabilitySignal.structuredPayload,
      episodeContext,
      asOfDate: input.asOfDate,
    });
    if (availabilityText.trim()) {
      parts.push(availabilityText);
    }
  }

  if (unavailabilitySignal) {
    const unavailabilityText = formatScheduleOperationalSignalText({
      signalType: unavailabilitySignal.signalType,
      validFrom: unavailabilitySignal.validFrom,
      validUntil: unavailabilitySignal.validUntil,
      structuredPayload: unavailabilitySignal.structuredPayload,
      episodeContext,
      asOfDate: input.asOfDate,
    });
    const hasRichSchedulePart = parts.some((part) => hasRichSchedulePartText(part));
    if (isLegacyVagueScheduleUnavailabilityText(unavailabilityText) && hasRichSchedulePart) {
      // Keep canonical rich availability/unavailability and hide stale vague duplicate.
    } else if (unavailabilityText.trim()) {
      parts.push(unavailabilityText);
    }
  }

  return parts.join("; ");
}

export function buildEpisodeScheduleContextIndex(
  signals: TrainingPeaksStudentOperationalSignal[]
): Map<string, EpisodeScheduleContext> {
  const grouped = new Map<string, TrainingPeaksStudentOperationalSignal[]>();

  for (const signal of signals) {
    if (!isAvailabilityScheduleSignalType(signal.signalType)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    if (!episodeKey) {
      continue;
    }
    const dedupeKey = `${signal.studentId}:${episodeKey}`;
    const group = grouped.get(dedupeKey) ?? [];
    group.push(signal);
    grouped.set(dedupeKey, group);
  }

  const index = new Map<string, EpisodeScheduleContext>();
  for (const [dedupeKey, group] of grouped) {
    index.set(dedupeKey, buildCanonicalEpisodeScheduleContext(group));
  }

  return index;
}

export function formatScheduleOperationalSignalText(input: {
  signalType: string;
  validFrom: string | null;
  validUntil: string | null;
  structuredPayload: Record<string, unknown>;
  episodeContext?: EpisodeScheduleContext | null;
  asOfDate?: string | null;
}): string {
  const structured = input.structuredPayload as ScheduleStructuredPayload;
  const availableDays = readStringArray(structured.available_days);
  const resolvedDates = filterScheduleDatesOnOrAfter(
    readStringArray(structured.resolved_available_dates),
    input.asOfDate
  );
  const plannedDates = filterScheduleDatesOnOrAfter(readStringArray(structured.planned_training_dates), input.asOfDate);
  const unavailableDates = filterScheduleDatesOnOrAfter(readStringArray(structured.unavailable_dates), input.asOfDate);
  const planningStatus =
    structured.planning_status === "athlete_intends_to_train" ? "athlete_intends_to_train" : null;
  const durationDays = readPositiveInt(structured.duration_days) ?? null;

  let validFrom = input.validFrom ?? structured.valid_from ?? null;
  let validUntil = input.validUntil ?? structured.valid_until ?? null;

  if (
    isUnavailabilityScheduleSignalType(input.signalType) &&
    durationDays &&
    input.episodeContext?.availableDates.length
  ) {
    const hasExplicitSignalDates = Boolean(input.validFrom || input.validUntil);
    if (!hasExplicitSignalDates) {
      const inferred = inferUnavailabilityAfterAvailableDates({
        availableDates: input.episodeContext.availableDates,
        durationDays,
      });
      if (inferred) {
        validFrom = inferred.validFrom;
        validUntil = inferred.validUntil;
      }
    }
  }

  const range = formatDateRange(validFrom, validUntil);

  if (isAvailabilityScheduleSignalType(input.signalType)) {
    const displayParts: string[] = [];
    const dates =
      plannedDates.length > 0
        ? plannedDates
        : resolvedDates.length > 0
          ? resolvedDates
          : input.episodeContext?.availableDates.length
            ? input.episodeContext.availableDates
            : [];
    if (unavailableDates.length > 0) {
      displayParts.push(`недоступна: ${formatCompactDateList(unavailableDates)}`);
    }
    if (dates.length > 0) {
      const label = plannedDates.length > 0 || planningStatus === "athlete_intends_to_train" ? "планирует" : "доступна";
      const conflictingDates = label === "планирует" ? intersectIsoDates(unavailableDates, dates) : [];
      if (conflictingDates.length > 0) {
        displayParts.push(
          `конфликт расписания на ${formatCompactDateList(conflictingDates)}: недоступна и планирует — уточнить дату`
        );
        return displayParts.join("; ");
      }
      const dateText =
        label === "планирует" ? formatCompactDateList(dates) : formatDayDateList(dates);
      displayParts.push(`${label}: ${dateText}`);
      return displayParts.join("; ");
    }
    if (availableDays.length > 0) {
      const dayLabels = availableDays
        .map((day) => DAY_SHORT_RU[day] ?? day.slice(0, 2))
        .join(", ");
      displayParts.push(range ? `доступна (${range}): ${dayLabels}` : `доступна: ${dayLabels}`);
      return displayParts.join("; ");
    }
    if (displayParts.length > 0) {
      return displayParts.join("; ");
    }
  }

  if (isUnavailabilityScheduleSignalType(input.signalType)) {
    const displayParts: string[] = [];
    if (unavailableDates.length > 0) {
      displayParts.push(`недоступна: ${formatCompactDateList(unavailableDates)}`);
    }
    if (plannedDates.length > 0) {
      displayParts.push(`планирует: ${formatCompactDateList(plannedDates)}`);
    }
    if (displayParts.length > 0) {
      return displayParts.join("; ");
    }
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

  return formatGenericScheduleRestrictionText(range, structured);
}
