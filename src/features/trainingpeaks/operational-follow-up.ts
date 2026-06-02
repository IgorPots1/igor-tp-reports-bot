const DEFAULT_COACH_TIMEZONE = "Europe/Belgrade";

export type OperationalSignalFollowUpFilter = "pending" | "due" | "overdue" | "all";

export type OperationalSignalFollowUpState =
  | "none"
  | "pending_future"
  | "pending_due"
  | "pending_overdue"
  | "resolved_or_non_pending";

export type OperationalSignalFollowUpNormalized = {
  has_follow_up: boolean;
  status: string | null;
  state: OperationalSignalFollowUpState;
  due_at: string | null;
  due_date: string | null;
  kind: string | null;
  reason: string | null;
  days_overdue: number;
};

function readStringValue(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function parseIsoDateKey(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function toDateKeyInTimezone(input: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(input);
}

function readDateKeyInTimezone(raw: string | null, timeZone: string): string | null {
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return toDateKeyInTimezone(parsed, timeZone);
}

function dayDiff(fromDateKey: string, toDateKey: string): number {
  const [fromYear, fromMonth, fromDay] = fromDateKey.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDateKey.split("-").map(Number);
  const fromUtc = Date.UTC(fromYear ?? 0, (fromMonth ?? 1) - 1, fromDay ?? 1);
  const toUtc = Date.UTC(toYear ?? 0, (toMonth ?? 1) - 1, toDay ?? 1);
  return Math.floor((toUtc - fromUtc) / 86_400_000);
}

export function parseCoachAsOfDate(raw: string): string {
  const normalized = parseIsoDateKey(raw.trim());
  if (!normalized) {
    throw new Error(`invalid --as-of value: ${raw}`);
  }
  return normalized;
}

export function getCoachTodayDateKey(
  timeZone = DEFAULT_COACH_TIMEZONE,
  now: Date = new Date()
): string {
  return toDateKeyInTimezone(now, timeZone);
}

export function normalizeOperationalSignalFollowUp(
  metadata: Record<string, unknown>,
  options: { asOfDate: string; timeZone?: string }
): OperationalSignalFollowUpNormalized {
  const timeZone = options.timeZone ?? DEFAULT_COACH_TIMEZONE;
  const dueAt = readStringValue(metadata.follow_up_due_at);
  const kind = readStringValue(metadata.follow_up_kind);
  const reason = readStringValue(metadata.follow_up_reason);
  const status = readStringValue(metadata.follow_up_status);
  const hasFollowUp = Boolean(dueAt || kind || reason || status);
  if (!hasFollowUp) {
    return {
      has_follow_up: false,
      status: null,
      state: "none",
      due_at: null,
      due_date: null,
      kind: null,
      reason: null,
      days_overdue: 0,
    };
  }

  const statusNormalized = status?.toLowerCase() ?? null;
  const dueDate = readDateKeyInTimezone(dueAt, timeZone);
  if (statusNormalized !== "pending") {
    return {
      has_follow_up: true,
      status,
      state: "resolved_or_non_pending",
      due_at: dueAt,
      due_date: dueDate,
      kind,
      reason,
      days_overdue: 0,
    };
  }

  if (!dueDate) {
    return {
      has_follow_up: true,
      status,
      state: "pending_future",
      due_at: dueAt,
      due_date: null,
      kind,
      reason,
      days_overdue: 0,
    };
  }

  if (dueDate < options.asOfDate) {
    return {
      has_follow_up: true,
      status,
      state: "pending_overdue",
      due_at: dueAt,
      due_date: dueDate,
      kind,
      reason,
      days_overdue: Math.max(0, dayDiff(dueDate, options.asOfDate)),
    };
  }
  if (dueDate === options.asOfDate) {
    return {
      has_follow_up: true,
      status,
      state: "pending_due",
      due_at: dueAt,
      due_date: dueDate,
      kind,
      reason,
      days_overdue: 0,
    };
  }
  return {
    has_follow_up: true,
    status,
    state: "pending_future",
    due_at: dueAt,
    due_date: dueDate,
    kind,
    reason,
    days_overdue: 0,
  };
}

export function matchesOperationalSignalFollowUpFilter(
  followUp: OperationalSignalFollowUpNormalized,
  filter: OperationalSignalFollowUpFilter
): boolean {
  if (filter === "all") {
    return followUp.has_follow_up;
  }
  if (filter === "pending") {
    return (
      followUp.state === "pending_future" ||
      followUp.state === "pending_due" ||
      followUp.state === "pending_overdue"
    );
  }
  if (filter === "due") {
    return followUp.state === "pending_due" || followUp.state === "pending_overdue";
  }
  return followUp.state === "pending_overdue";
}

export function formatFollowUpStateForText(state: OperationalSignalFollowUpState): string {
  if (state === "pending_overdue") {
    return "overdue";
  }
  if (state === "pending_due") {
    return "due";
  }
  if (state === "pending_future") {
    return "pending";
  }
  if (state === "resolved_or_non_pending") {
    return "resolved_or_non_pending";
  }
  return "none";
}

export { DEFAULT_COACH_TIMEZONE };
