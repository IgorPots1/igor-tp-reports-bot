import {
  approveTrainingPeaksAction as approveTrainingPeaksActionInRepository,
  approveTrainingPeaksWeeklyReportIfDraft,
  cancelQueuedTrainingPeaksJob,
  claimTrainingPeaksWeeklyReportForSend as claimTrainingPeaksWeeklyReportForSendInRepository,
  createTrainingPeaksAction as createTrainingPeaksActionInRepository,
  createTrainingPeaksActionRun as createTrainingPeaksActionRunInRepository,
  createTrainingPeaksRaceScanJob,
  createTrainingPeaksWeeklyJob,
  deleteTrainingPeaksOrphanReportsForWeek as deleteTrainingPeaksOrphanReportsForWeekInRepository,
  deleteTrainingPeaksWeeklyReportById,
  disableTrainingPeaksStudentById,
  enableTrainingPeaksStudentById,
  expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent,
  expireTrainingPeaksStudentTelegramLinkCodesByIds,
  findActiveTrainingPeaksJobForWeek,
  findActiveTrainingPeaksJobForStudentWeek,
  getTrainingPeaksWeeklyReportForStudentWeek,
  getTrainingPeaksJobById,
  getTrainingPeaksBusinessChatById,
  getTrainingPeaksStudentById as getTrainingPeaksStudentByIdFromRepository,
  getTrainingPeaksStudentByStudentId as getTrainingPeaksStudentByStudentIdFromRepository,
  getTrainingPeaksStudentByTelegramChatId as getTrainingPeaksStudentByTelegramChatIdFromRepository,
  getTrainingPeaksWeeklyReportById,
  recoverStaleTrainingPeaksRunningJobs,
  recoverStaleTrainingPeaksRunningRaceScanJobs,
  insertTrainingPeaksStudent,
  insertTrainingPeaksStudentTelegramLinkCode,
  linkTrainingPeaksStudentToBusinessChat as linkTrainingPeaksStudentToBusinessChatInRepository,
  listAllTrainingPeaksReports,
  listTrainingPeaksBusinessChatsByUsername as listTrainingPeaksBusinessChatsByUsernameFromRepository,
  listRecentTrainingPeaksBusinessChats as listRecentTrainingPeaksBusinessChatsFromRepository,
  listTrainingPeaksStudentTelegramLinkCodesByCode,
  listRecentTrainingPeaksJobs,
  listRecentTrainingPeaksActions as listRecentTrainingPeaksActionsFromRepository,
  listLatestTrainingPeaksActionRunsByActionIds,
  listTrainingPeaksStudents,
  listTrainingPeaksStudentsIncludingArchived,
  listTrainingPeaksWeeklyReportEligibleStudents as listTrainingPeaksWeeklyReportEligibleStudentsFromRepository,
  listTrainingPeaksWorkoutCacheForDateRange,
  listTrainingPeaksWorkoutCacheScanStatusesForRange,
  listTrainingPeaksStudentsEligibleForHealthMetrics,
  listTrainingPeaksHealthMetricsForStudentDateRange,
  markTrainingPeaksStudentTelegramLinkCodeUsed,
  rejectTrainingPeaksAction as rejectTrainingPeaksActionInRepository,
  requestTrainingPeaksActionExecution as requestTrainingPeaksActionExecutionInRepository,
  cancelTrainingPeaksActionExecution as cancelTrainingPeaksActionExecutionInRepository,
  getTrainingPeaksActionById as getTrainingPeaksActionByIdInRepository,
  claimOneApprovedTrainingPeaksActionForDryRun as claimOneApprovedTrainingPeaksActionForDryRunInRepository,
  completeTrainingPeaksActionDryRun as completeTrainingPeaksActionDryRunInRepository,
  failTrainingPeaksActionDryRun as failTrainingPeaksActionDryRunInRepository,
  setTrainingPeaksStudentWeeklyReportsEnabledById,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type DecideTrainingPeaksActionResult,
  type RequestTrainingPeaksActionExecutionResult,
  type CancelTrainingPeaksActionExecutionResultExtended,
  type TrainingPeaksBusinessChat,
  type TrainingPeaksAction,
  type TrainingPeaksActionWithStudent,
  type TrainingPeaksActionRun,
  type ClaimedTrainingPeaksDryRunAction,
  TrainingPeaksJobConflictError,
  type TrainingPeaksStudentTelegramLinkCode,
  TrainingPeaksTelegramLinkCodeConflictError,
  TrainingPeaksStudentConflictError,
  type TrainingPeaksJob,
  type TrainingPeaksStudent,
  type TrainingPeaksWeek,
  type TrainingPeaksWeeklyReport,
  unlinkTrainingPeaksStudentTelegramById,
  upsertTrainingPeaksBusinessChatFromMessage as upsertTrainingPeaksBusinessChatFromMessageInRepository,
  type UpdateTrainingPeaksStudentTelegramContactInput,
  type UpdateTrainingPeaksStudentTelegramContactParams,
  type UpdateTrainingPeaksWeeklyReportContentInput,
  type UpdateTrainingPeaksWeeklyReportStateInput,
  type UpdateTrainingPeaksWeeklyReportReviewStateInput,
  updateTrainingPeaksStudentTelegramContact as updateTrainingPeaksStudentTelegramContactInRepository,
  updateTrainingPeaksStudentTelegramContactById,
  updateTrainingPeaksWeeklyReportContentById,
  updateTrainingPeaksWeeklyReportReviewState as updateTrainingPeaksWeeklyReportReviewStateInRepository,
  updateTrainingPeaksWeeklyReportStateById,
} from "@/features/trainingpeaks/repository";
import { evaluateTrainingPeaksRecoveryAlert } from "@/features/trainingpeaks/recovery-alerts";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import { parseMoveWorkoutWithAiFallback } from "@/features/trainingpeaks/move-workout-parser-ai";
import { TRAININGPEAKS_TIME_ZONE, resolveTrainingPeaksWeekKeyword } from "@/features/trainingpeaks/week";
import type { TelegramMessage } from "@/features/telegram/types";
import {
  normalizeTrainingPeaksStudentId,
  validateTrainingPeaksStudentId,
} from "@/lib/trainingpeaks-student-id";

export type TrainingPeaksStatus = "ready" | "parsed_only" | "missing";
export type TrainingPeaksRegistryStatus = "no_data" | "ready" | "data_loaded" | "no_report";

export type TrainingPeaksStatusOverviewStudent = {
  studentId: string;
  studentName: string;
  status: TrainingPeaksStatus;
  hasReport: boolean;
};

export type TrainingPeaksStatusOverview = {
  week: TrainingPeaksWeek;
  students: TrainingPeaksStatusOverviewStudent[];
};

export type TrainingPeaksStudentSnapshot = {
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  status: Exclude<TrainingPeaksStatus, "missing">;
};

export type TrainingPeaksReportSnapshot = {
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  reportMarkdown: string;
};

export type TrainingPeaksRegistryStudentSnapshot = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive: boolean;
  weeklyReportEnabled: boolean;
  archivedAt: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramProfileUrl: string | null;
  telegramDeliveryEnabled: boolean;
  dataQualityStatus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  latestWeekFrom: string | null;
  latestWeekTo: string | null;
  latestReportStatus: TrainingPeaksRegistryStatus;
};

export type TrainingPeaksStudentCard =
  | { kind: "not_found" }
  | {
      kind: "ambiguous";
      matches: {
        studentId: string;
        studentName: string;
      }[];
    }
  | {
      kind: "student";
      student: TrainingPeaksRegistryStudentSnapshot;
    };

export type AddTrainingPeaksStudentResult =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; reason: "empty_name" | "invalid_url" | "duplicate_student" | "duplicate_url" | "unknown" };

export type CreateTrainingPeaksStudentInput = {
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  notes?: string | null;
  dataQualityStatus?: string | null;
};

export type CreateTrainingPeaksStudentResult =
  | { ok: true; student: TrainingPeaksStudent }
  | {
      ok: false;
      reason:
        | "empty_student_id"
        | "invalid_student_id"
        | "empty_student_name"
        | "empty_url"
        | "invalid_url"
        | "duplicate_student"
        | "duplicate_url"
        | "unknown";
      message: string;
    };

export type DisableTrainingPeaksStudentResult =
  | { kind: "not_found" }
  | {
      kind: "ambiguous";
      matches: {
        studentId: string;
        studentName: string;
      }[];
    }
  | {
      kind: "student";
      student: TrainingPeaksStudent;
    };

export type EnableTrainingPeaksStudentResult = DisableTrainingPeaksStudentResult;

export type SetTrainingPeaksStudentWeeklyReportsEnabledResult =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; reason: "not_found" | "student_archived"; message: string };

export type UnlinkTrainingPeaksStudentTelegramResult =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; reason: "not_found"; message: string };

export type TrainingPeaksJobRequester = {
  chatId: number | string;
  userId: number | string | null;
};

export type TrainingPeaksMoveWorkoutTimeRefKind = "date" | "weekday" | "relative_day";

export type TrainingPeaksMoveWorkoutTimeRef = {
  kind: TrainingPeaksMoveWorkoutTimeRefKind;
  value: string;
  sourceText: string;
};

export type TrainingPeaksMoveWorkoutWorkoutType =
  | "easy_run"
  | "interval"
  | "tempo"
  | "long_run"
  | "run"
  | "unknown";

export type TrainingPeaksMoveWorkoutDescriptor = {
  raw: string;
  type: TrainingPeaksMoveWorkoutWorkoutType;
  confidence: number;
};

export type ParsedTrainingPeaksMoveWorkoutPayload = {
  actionType: "move_workout";
  source: TrainingPeaksMoveWorkoutTimeRef | null;
  target: TrainingPeaksMoveWorkoutTimeRef;
  workoutDescriptor: TrainingPeaksMoveWorkoutDescriptor | null;
  confidence: number;
  needsClarification: boolean;
  clarificationReason: string | null;
  parser: "deterministic" | "ai_fallback";
  sourceDate?: string;
  source_date?: string;
};

export type ParseTrainingPeaksMoveWorkoutResult =
  | { ok: true; payload: ParsedTrainingPeaksMoveWorkoutPayload; confidence: number }
  | {
      ok: false;
      reason:
        | "not_move_request"
        | "no_target_day"
        | "ambiguous_target_day"
        | "not_explicit_move_request"
        | "needs_clarification"
        | "parse_rejected";
    };

export type CreateTrainingPeaksMoveWorkoutActionFromTelegramInput = {
  chatId: string;
  messageId: string;
  userId?: string | null;
  text: string;
  coachChatId?: string | null;
};

export type CreateTrainingPeaksMoveWorkoutActionFromTelegramResult =
  | {
      ok: true;
      action: TrainingPeaksAction;
      student: TrainingPeaksStudent;
      parsed: ParsedTrainingPeaksMoveWorkoutPayload;
    }
  | {
      ok: false;
      reason:
        | "student_not_found"
        | "not_move_request"
        | "no_target_day"
        | "ambiguous_target_day"
        | "empty_text"
        | "not_explicit_move_request"
        | "needs_clarification"
        | "parse_rejected";
    };

export type DecideTrainingPeaksActionInput = {
  actionId: string;
  decidedByChatId: string;
  decidedByUserId?: string | null;
  decisionMessageId?: string | null;
};

export type DecideTrainingPeaksActionResultSnapshot = DecideTrainingPeaksActionResult;
export type RequestTrainingPeaksActionExecutionResultSnapshot = RequestTrainingPeaksActionExecutionResult;
export type CancelTrainingPeaksActionExecutionResultSnapshot = CancelTrainingPeaksActionExecutionResultExtended;
export type TrainingPeaksActionRunSnapshot = TrainingPeaksActionRun;
export type ClaimedTrainingPeaksDryRunActionSnapshot = ClaimedTrainingPeaksDryRunAction;
export type TrainingPeaksActionWithStudentSnapshot = TrainingPeaksActionWithStudent;

export type TrainingPeaksBusinessChatSnapshot = TrainingPeaksBusinessChat;
export type TrainingPeaksStudentTelegramLinkCodeSnapshot = TrainingPeaksStudentTelegramLinkCode;

export type ConsumeTrainingPeaksStudentTelegramLinkCodeResult =
  | { kind: "no_candidate" }
  | { kind: "no_match"; code: string }
  | { kind: "expired"; code: string; studentName: string | null }
  | { kind: "used"; code: string; studentName: string | null }
  | { kind: "ambiguous"; code: string; matches: number }
  | { kind: "link_failed"; code: string; studentName: string | null }
  | {
      kind: "linked";
      code: string;
      student: TrainingPeaksStudent;
      chat: TrainingPeaksBusinessChatSnapshot;
    };

export type {
  UpdateTrainingPeaksStudentTelegramContactParams,
  UpdateTrainingPeaksWeeklyReportReviewStateInput,
};

export type RequestTrainingPeaksWeeklyRunResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "scope" | "studentId"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type RequestTrainingPeaksWeeklyRunForStudentResult =
  | { ok: true; job: TrainingPeaksJob; student: TrainingPeaksRegistryStudentSnapshot }
  | {
      ok: false;
      reason:
        | "invalid_format"
        | "invalid_date"
        | "invalid_range"
        | "student_not_found"
        | "student_ambiguous"
        | "student_archived"
        | "student_inactive"
        | "missing_trainingpeaks_url";
      message: string;
      matches?: { studentId: string; studentName: string }[];
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "scope" | "studentId"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type RequestTrainingPeaksRaceScanResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type CancelTrainingPeaksWeeklyRunResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason: "already_started" | "not_found" | "not_cancellable";
    };

export type TrainingPeaksAttentionLevel = "urgent" | "today" | "observe" | "fyi";

export type TrainingPeaksAttentionSignal = {
  level: TrainingPeaksAttentionLevel;
  studentName: string | null;
  reason: string;
};

export type TrainingPeaksAttentionSnapshot = {
  urgent: TrainingPeaksAttentionSignal[];
  today: TrainingPeaksAttentionSignal[];
  observe: TrainingPeaksAttentionSignal[];
  fyi: TrainingPeaksAttentionSignal[];
};

const TP_ADD_STUDENT_COMMAND_PATTERN = /^\/tp_add_student(?:@\w+)?(?:\s+|$)/;
const TP_RUN_WEEK_COMMAND_PATTERN = /^\/tp_run_week(?:@\w+)?(?:\s+|$)/;
const TP_TELEGRAM_LINK_CODE_PATTERN = /\b[A-Z0-9]{2,12}-\d{3,6}\b/gi;
const TP_TELEGRAM_LINK_CODE_DEFAULT_TTL_HOURS = 24;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Explicit reschedule verbs — substring match on normalizeRussianText output. */
const TP_STRICT_MOVE_VERBS = [
  "перенеси",
  "перенести",
  "переставь",
  "переставить",
  "передвинь",
  "сдвинь",
  "перенесем",
  "можно перенести",
  "поставь на",
];

const MOVE_WORKOUT_MIN_ACCEPT_CONFIDENCE = 0.75;

const TP_MOVE_WORKOUT_BLOCKED_CASUAL_PATTERNS: RegExp[] = [
  /^ок(?:\s*[!.]*)?$/,
  /^спасибо\b/,
  /\bзавтра\s+сделаю\b/,
  /\bсегодня\s+не\s+успеваю\b/,
  /^можно\s+завтра\??$/,
  /\bя\s+сегодня\s+не\s+бегу\b/,
  /\bотчет\s+отправил\b/,
  /\bотчёт\s+отправил\b/,
  /\bзавтра\s+пробегу\b/,
  /^а\s+можно\s+завтра\??$/,
  /^давай\s+завтра$/,
  /\bсегодня\s+не\s+получится\b/,
  /\bу\s+меня\s+болит\s+ног/,
];
const TP_RUN_WEEK_USAGE_MESSAGE = [
  "Напиши так:",
  "/tp_run_week last",
  "или",
  "/tp_run_week 2026-04-27 2026-05-03",
].join("\n");

function normalizeStudentQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

function normalizeRussianText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TP_WEEKDAY_ALIASES: Record<string, string> = {
  пн: "monday",
  понедельник: "monday",
  понедельника: "monday",
  вт: "tuesday",
  вторник: "tuesday",
  вторника: "tuesday",
  ср: "wednesday",
  среда: "wednesday",
  среду: "wednesday",
  среды: "wednesday",
  чт: "thursday",
  четверг: "thursday",
  четверга: "thursday",
  пт: "friday",
  пятница: "friday",
  пятницу: "friday",
  пятницы: "friday",
  сб: "saturday",
  суббота: "saturday",
  субботу: "saturday",
  субботы: "saturday",
  вс: "sunday",
  воскресенье: "sunday",
  воскресенья: "sunday",
  воскресеньею: "sunday",
  воскресеньея: "sunday",
};

const TP_PARSER_TIMEZONE = "Europe/Belgrade";
const ISO_YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function getBelgradeDateParts(value: Date): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TP_PARSER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "");
  const weekdayRaw = (parts.find((part) => part.type === "weekday")?.value ?? "").toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const weekday = weekdayMap[weekdayRaw];
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || weekday === undefined) {
    throw new Error(`Unable to derive parser date parts for ${value.toISOString()}`);
  }
  return { year, month, day, weekday };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addLocalDaysIso(isoDate: string, days: number): string {
  const match = isoDate.match(ISO_YMD_PATTERN);
  if (!match) {
    return isoDate;
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  const parts = getBelgradeDateParts(shifted);
  return toIsoDate(parts.year, parts.month, parts.day);
}

function getParserBaseDate(): Date {
  const envBaseDate = process.env.TP_MOVE_DATE_BASE_DATE?.trim();
  if (envBaseDate && ISO_DATE_PATTERN.test(envBaseDate)) {
    const match = envBaseDate.match(ISO_YMD_PATTERN);
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
    }
  }
  return new Date();
}

function resolveRelativeDayIso(
  value: "today" | "tomorrow" | "day_after_tomorrow" | "yesterday",
  baseDate: Date
): string {
  const base = getBelgradeDateParts(baseDate);
  const baseIso = toIsoDate(base.year, base.month, base.day);
  if (value === "today") {
    return baseIso;
  }
  if (value === "tomorrow") {
    return addLocalDaysIso(baseIso, 1);
  }
  if (value === "day_after_tomorrow") {
    return addLocalDaysIso(baseIso, 2);
  }
  return addLocalDaysIso(baseIso, -1);
}

function resolveWeekdayIso(value: string, baseDate: Date, direction: "next" | "previous"): string | null {
  const weekdayMap: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  };
  const target = weekdayMap[value];
  if (target === undefined) {
    return null;
  }
  const base = getBelgradeDateParts(baseDate);
  const baseIso = toIsoDate(base.year, base.month, base.day);
  if (direction === "next") {
    let delta = (target - base.weekday + 7) % 7;
    if (delta === 0) {
      delta = 7;
    }
    return addLocalDaysIso(baseIso, delta);
  }
  const deltaBack = (base.weekday - target + 7) % 7;
  return addLocalDaysIso(baseIso, -deltaBack);
}

function resolveTimeRefToDateIso(
  ref: TrainingPeaksMoveWorkoutTimeRef | null | undefined,
  baseDate: Date,
  direction: "next" | "previous"
): string | null {
  if (!ref) {
    return null;
  }
  if (ref.kind === "date") {
    return ref.value;
  }
  if (ref.kind === "relative_day") {
    if (ref.value === "today" || ref.value === "tomorrow" || ref.value === "day_after_tomorrow" || ref.value === "yesterday") {
      return resolveRelativeDayIso(ref.value, baseDate);
    }
    return null;
  }
  return resolveWeekdayIso(ref.value, baseDate, direction);
}

const TP_RELATIVE_DAY_ALIASES: Record<string, string> = {
  сегодня: "today",
  сегодняшнюю: "today",
  "сегодняшнюю тренировку": "today",
  завтра: "tomorrow",
  завтрашнюю: "tomorrow",
  послезавтра: "day_after_tomorrow",
  вчера: "yesterday",
  вчерашнюю: "yesterday",
  вчерашний: "yesterday",
};

const TP_MONTH_ALIASES: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};

type IndexedTimeRef = TrainingPeaksMoveWorkoutTimeRef & { index: number };

function clampMoveWorkoutConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(2));
}

function parseIsoDateParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

function normalizeTimeRef(ref: TrainingPeaksMoveWorkoutTimeRef): TrainingPeaksMoveWorkoutTimeRef {
  return ref;
}

function toTimeRefWithoutIndex(ref: IndexedTimeRef): TrainingPeaksMoveWorkoutTimeRef {
  return {
    kind: ref.kind,
    value: ref.value,
    sourceText: ref.sourceText,
  };
}

function uniqueTimeRefs(refs: IndexedTimeRef[]): IndexedTimeRef[] {
  const seen = new Set<string>();
  const deduped: IndexedTimeRef[] = [];
  for (const item of refs) {
    const key = `${item.kind}:${item.value}:${item.sourceText}:${item.index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped.sort((a, b) => a.index - b.index);
}

function extractDateRefs(normalized: string): IndexedTimeRef[] {
  const result: IndexedTimeRef[] = [];
  const now = new Date();

  const isoInlinePattern = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let isoMatch = isoInlinePattern.exec(normalized);
  while (isoMatch) {
    const isoValue = isoMatch[1];
    if (isoValue && ISO_DATE_PATTERN.test(isoValue) && typeof isoMatch.index === "number") {
      result.push({ kind: "date", value: isoValue, sourceText: isoMatch[0], index: isoMatch.index });
    }
    isoMatch = isoInlinePattern.exec(normalized);
  }

  const dottedPattern = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g;
  let match = dottedPattern.exec(normalized);
  while (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const yearRaw = match[3] ? Number(match[3]) : now.getUTCFullYear();
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const iso = parseIsoDateParts(year, month, day);
    if (iso && typeof match.index === "number") {
      result.push({ kind: "date", value: iso, sourceText: match[0], index: match.index });
    }
    match = dottedPattern.exec(normalized);
  }

  const monthNames = Object.keys(TP_MONTH_ALIASES).join("|");
  const monthPattern = new RegExp(`(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?`, "g");
  let monthMatch = monthPattern.exec(normalized);
  while (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = TP_MONTH_ALIASES[monthMatch[2] ?? ""] ?? 0;
    const year = monthMatch[3] ? Number(monthMatch[3]) : now.getUTCFullYear();
    const iso = parseIsoDateParts(year, month, day);
    if (iso && typeof monthMatch.index === "number") {
      result.push({ kind: "date", value: iso, sourceText: monthMatch[0], index: monthMatch.index });
    }
    monthMatch = monthPattern.exec(normalized);
  }

  return uniqueTimeRefs(result);
}

function extractWeekdayAndRelativeRefs(normalized: string): IndexedTimeRef[] {
  const refs: IndexedTimeRef[] = [];
  const tokenPattern = /[а-яa-z]+/g;
  let tokenMatch = tokenPattern.exec(normalized);
  while (tokenMatch) {
    const token = tokenMatch[0];
    const weekday = TP_WEEKDAY_ALIASES[token];
    if (weekday) {
      refs.push({ kind: "weekday", value: weekday, sourceText: token, index: tokenMatch.index });
      tokenMatch = tokenPattern.exec(normalized);
      continue;
    }
    const relative = TP_RELATIVE_DAY_ALIASES[token];
    if (relative) {
      refs.push({ kind: "relative_day", value: relative, sourceText: token, index: tokenMatch.index });
    }
    tokenMatch = tokenPattern.exec(normalized);
  }
  return uniqueTimeRefs(refs);
}

function extractWorkoutDescriptor(rawText: string, normalized: string): TrainingPeaksMoveWorkoutDescriptor | null {
  if (normalized.includes("легк")) {
    return { raw: rawText.trim(), type: "easy_run", confidence: 0.9 };
  }
  if (normalized.includes("интервальн") || normalized.includes("интервалы")) {
    return { raw: rawText.trim(), type: "interval", confidence: 0.9 };
  }
  if (normalized.includes("темпов") || normalized.includes("темп")) {
    return { raw: rawText.trim(), type: "tempo", confidence: 0.88 };
  }
  if (normalized.includes("длительн") || normalized.includes("лонгран") || normalized.includes("long run")) {
    return { raw: rawText.trim(), type: "long_run", confidence: 0.9 };
  }
  if (normalized.includes("бег") || normalized.includes("пробеж")) {
    return { raw: rawText.trim(), type: "run", confidence: 0.8 };
  }
  if (normalized.includes("трениров") || normalized.includes("заняти")) {
    return {
      raw: rawText.trim(),
      type: "unknown",
      confidence: 0.65,
    };
  }

  return null;
}

function logIgnoredTrainingPeaksMoveParser(kind: string, rawText: string): void {
  if (process.env.TRAININGPEAKS_MOVE_PARSER_DEBUG?.trim() === "1") {
    console.debug(`[trainingpeaks-move-parser] ignored_non_action ${kind}: ${JSON.stringify(rawText)}`);
  }
}

function matchesCasualNonMoveTrainingChat(normalized: string): boolean {
  return TP_MOVE_WORKOUT_BLOCKED_CASUAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasStrictMoveVerb(normalized: string): boolean {
  return TP_STRICT_MOVE_VERBS.some((verb) => normalized.includes(verb));
}

function hasStrictWorkoutObject(normalized: string): boolean {
  if (normalized.includes("workout")) {
    return true;
  }
  if (normalized.includes("тренировк")) {
    return true;
  }
  if (normalized.includes("пробежк")) {
    return true;
  }
  if (normalized.includes("интервальн")) {
    return true;
  }
  if (normalized.includes("темпов")) {
    return true;
  }
  if (normalized.includes("длительн")) {
    return true;
  }
  if (normalized.includes("легк")) {
    return true;
  }
  return /(?:^|[\s,.])(?:легкий\s+|интервальн\w*\s+|темпов\w*\s+|длительн\w*\s+)?бег(?:[\s,.]|$)/u.test(normalized);
}

function hasExplicitMoveTargetReference(normalized: string): boolean {
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(normalized)) {
    return true;
  }
  if (/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/.test(normalized)) {
    return true;
  }
  const monthNames = Object.keys(TP_MONTH_ALIASES).join("|");
  if (new RegExp(`\\d{1,2}\\s+(${monthNames})`).test(normalized)) {
    return true;
  }
  for (const rel of Object.keys(TP_RELATIVE_DAY_ALIASES)) {
    if (normalized.includes(rel)) {
      return true;
    }
  }
  const weekdayNeedles = [
    "понедельник",
    "понедельника",
    "вторник",
    "вторника",
    "среду",
    "среда",
    "среды",
    "четверг",
    "четверга",
    "пятницу",
    "пятница",
    "пятницы",
    "субботу",
    "суббота",
    "субботы",
    "воскресенье",
    "воскресенья",
  ];
  for (const w of weekdayNeedles) {
    if (normalized.includes(w)) {
      return true;
    }
  }
  const shortAliases = new Set(["пн", "вт", "ср", "чт", "пт", "сб", "вс"]);
  return normalized.split(/[\s,.!?;:]+/).some((token) => shortAliases.has(token));
}

function passesStrictMoveWorkoutIntentGate(normalized: string): boolean {
  if (!normalized || matchesCasualNonMoveTrainingChat(normalized)) {
    return false;
  }
  return hasStrictMoveVerb(normalized) && hasStrictWorkoutObject(normalized) && hasExplicitMoveTargetReference(normalized);
}

export function passesTrainingPeaksStrictMoveWorkoutIntentGate(rawText: string): boolean {
  const normalized = normalizeRussianText(rawText);
  return Boolean(normalized && passesStrictMoveWorkoutIntentGate(normalized));
}

function isParseableMoveWorkoutTimeRef(ref: TrainingPeaksMoveWorkoutTimeRef): boolean {
  if (!ref?.kind || typeof ref.value !== "string" || !ref.value.trim()) {
    return false;
  }
  if (ref.kind === "date") {
    return ISO_DATE_PATTERN.test(ref.value);
  }
  if (ref.kind === "relative_day") {
    return ["yesterday", "today", "tomorrow", "day_after_tomorrow"].includes(ref.value);
  }
  if (ref.kind === "weekday") {
    return ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(ref.value);
  }
  return false;
}

function acceptsMoveWorkoutParseResult(
  payload: ParsedTrainingPeaksMoveWorkoutPayload,
  confidence: number,
  normalizedMessage: string
): boolean {
  if (payload.actionType !== "move_workout") {
    return false;
  }
  if (payload.needsClarification) {
    return false;
  }
  if (confidence < MOVE_WORKOUT_MIN_ACCEPT_CONFIDENCE) {
    return false;
  }
  if (!payload.target || !isParseableMoveWorkoutTimeRef(payload.target)) {
    return false;
  }
  if (!passesStrictMoveWorkoutIntentGate(normalizedMessage)) {
    return false;
  }
  return true;
}

function resolveDeterministicMoveWorkout(
  rawText: string
): ParseTrainingPeaksMoveWorkoutResult & { deterministicReason?: string } {
  const parserBaseDate = getParserBaseDate();
  const normalized = normalizeRussianText(rawText);
  if (!normalized || !passesStrictMoveWorkoutIntentGate(normalized)) {
    return { ok: false, reason: "not_move_request" };
  }

  const refs = uniqueTimeRefs([...extractDateRefs(normalized), ...extractWeekdayAndRelativeRefs(normalized)]);
  const pairPattern = /с\s+(.+?)\s+на\s+(.+?)(?=$|[,.!?])/g;
  const pairMatches: Array<{ source: IndexedTimeRef; target: IndexedTimeRef }> = [];
  let pairMatch = pairPattern.exec(normalized);
  while (pairMatch) {
    const sourceInSegment = uniqueTimeRefs([
      ...extractDateRefs(pairMatch[1] ?? ""),
      ...extractWeekdayAndRelativeRefs(pairMatch[1] ?? ""),
    ]);
    const targetInSegment = uniqueTimeRefs([
      ...extractDateRefs(pairMatch[2] ?? ""),
      ...extractWeekdayAndRelativeRefs(pairMatch[2] ?? ""),
    ]);
    if (sourceInSegment.length === 1 && targetInSegment.length === 1) {
      pairMatches.push({ source: sourceInSegment[0]!, target: targetInSegment[0]! });
    }
    pairMatch = pairPattern.exec(normalized);
  }

  let source: TrainingPeaksMoveWorkoutTimeRef | null = null;
  let target: TrainingPeaksMoveWorkoutTimeRef | null = null;
  let needsClarification = false;
  let clarificationReason: string | null = null;

  if (pairMatches.length > 1) {
    return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple source-target pairs" };
  }

  if (pairMatches.length === 1) {
    source = normalizeTimeRef(pairMatches[0]!.source);
    target = normalizeTimeRef(pairMatches[0]!.target);
  } else {
    const targetCandidatePattern = /на\s+([а-яa-z0-9./-]+(?:\s+[а-яa-z0-9./-]+)?)/g;
    const targetCandidates: IndexedTimeRef[] = [];
    let targetMatch = targetCandidatePattern.exec(normalized);
    while (targetMatch) {
      const chunk = targetMatch[1] ?? "";
      const refsInChunk = uniqueTimeRefs([...extractDateRefs(chunk), ...extractWeekdayAndRelativeRefs(chunk)]).map((item) => ({
        ...item,
        index: targetMatch!.index + item.index,
      }));
      if (refsInChunk.length === 1) {
        targetCandidates.push(refsInChunk[0]!);
      }
      targetMatch = targetCandidatePattern.exec(normalized);
    }

    const uniqueTargets = uniqueTimeRefs(targetCandidates);
    if (uniqueTargets.length === 1) {
      target = normalizeTimeRef(uniqueTargets[0]!);
      const sourceCandidates = refs.filter((item) => {
        if (item.index === uniqueTargets[0]!.index) {
          return false;
        }
        return !(item.kind === uniqueTargets[0]!.kind && item.value === uniqueTargets[0]!.value);
      });
      if (sourceCandidates.length === 1) {
        source = normalizeTimeRef(sourceCandidates[0]!);
      } else if (sourceCandidates.length > 1) {
        needsClarification = true;
        clarificationReason = "source day is ambiguous";
      }
    } else if (uniqueTargets.length > 1) {
      return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple explicit targets" };
    } else if (refs.length === 1) {
      target = normalizeTimeRef(refs[0]!);
    } else if (refs.length === 2) {
      const rel = refs.filter((item) => item.kind === "relative_day");
      if (rel.length === 2 && rel.some((item) => item.value === "today") && rel.some((item) => item.value === "tomorrow")) {
        source = normalizeTimeRef(rel.find((item) => item.value === "today")!);
        target = normalizeTimeRef(rel.find((item) => item.value === "tomorrow")!);
      } else {
        return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple time references" };
      }
    } else if (refs.length > 1) {
      return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple time references" };
    }
  }

  if (!target) {
    return { ok: false, reason: "no_target_day" };
  }

  if (target.kind === "relative_day" && target.value === "today" && !source) {
    needsClarification = true;
    clarificationReason = clarificationReason ?? "target day equals today";
  }

  const workoutDescriptor = extractWorkoutDescriptor(rawText, normalized);
  const baseConfidence = source ? 0.92 : 0.8;
  const descriptorBonus = workoutDescriptor ? 0.04 : -0.08;
  const clarificationPenalty = needsClarification ? -0.2 : 0;
  const confidence = clampMoveWorkoutConfidence(baseConfidence + descriptorBonus + clarificationPenalty);
  const normalizedSource = source ? toTimeRefWithoutIndex(source as IndexedTimeRef) : null;
  const normalizedTarget = toTimeRefWithoutIndex(target as IndexedTimeRef);

  const payload: ParsedTrainingPeaksMoveWorkoutPayload = {
    actionType: "move_workout",
    source: normalizedSource,
    target: normalizedTarget,
    workoutDescriptor,
    confidence,
    needsClarification,
    clarificationReason,
    parser: "deterministic",
  };

  const targetDateIso = resolveTimeRefToDateIso(normalizedTarget, parserBaseDate, "next");
  if (targetDateIso && normalizedTarget.kind !== "date") {
    payload.target = { ...normalizedTarget, kind: "date", value: targetDateIso };
  }

  const sourceDateIso = resolveTimeRefToDateIso(normalizedSource, parserBaseDate, "previous");
  if (sourceDateIso && normalizedSource) {
    payload.source = { ...normalizedSource, kind: "date", value: sourceDateIso };
    payload.sourceDate = sourceDateIso;
    payload.source_date = sourceDateIso;
  } else if (normalizedSource?.kind === "date") {
    payload.sourceDate = normalizedSource.value;
    payload.source_date = normalizedSource.value;
  }

  return {
    ok: true,
    payload,
    confidence,
  };
}

export async function parseTrainingPeaksMoveWorkoutRequest(
  rawText: string
): Promise<ParseTrainingPeaksMoveWorkoutResult> {
  const normalized = normalizeRussianText(rawText);
  if (!normalized || !passesStrictMoveWorkoutIntentGate(normalized)) {
    logIgnoredTrainingPeaksMoveParser("intent_gate_failed", rawText);
    return { ok: false, reason: "not_explicit_move_request" };
  }

  const deterministic = resolveDeterministicMoveWorkout(rawText);

  if (deterministic.ok && deterministic.payload.needsClarification) {
    logIgnoredTrainingPeaksMoveParser("deterministic_needs_clarification", rawText);
    return { ok: false, reason: "needs_clarification" };
  }

  if (
    deterministic.ok &&
    acceptsMoveWorkoutParseResult(deterministic.payload, deterministic.confidence, normalized)
  ) {
    return deterministic;
  }

  const aiFallback = await parseMoveWorkoutWithAiFallback(rawText);

  if (!aiFallback) {
    if (
      deterministic.ok &&
      acceptsMoveWorkoutParseResult(deterministic.payload, deterministic.confidence, normalized)
    ) {
      return deterministic;
    }
    return deterministic.ok ? { ok: false, reason: "parse_rejected" } : { ok: false, reason: deterministic.reason };
  }

  if (aiFallback.needsClarification) {
    logIgnoredTrainingPeaksMoveParser("ai_needs_clarification", rawText);
    return { ok: false, reason: "needs_clarification" };
  }

  const aiConfidence = clampMoveWorkoutConfidence(aiFallback.confidence);
  const aiPayload: ParsedTrainingPeaksMoveWorkoutPayload = {
    ...aiFallback,
    actionType: "move_workout",
    parser: "ai_fallback",
    sourceDate: aiFallback.source?.kind === "date" ? aiFallback.source.value : undefined,
    source_date: aiFallback.source?.kind === "date" ? aiFallback.source.value : undefined,
  };

  const parserBaseDate = getParserBaseDate();
  const aiResolvedTargetDate = resolveTimeRefToDateIso(aiPayload.target, parserBaseDate, "next");
  if (aiResolvedTargetDate && aiPayload.target.kind !== "date") {
    aiPayload.target = { ...aiPayload.target, kind: "date", value: aiResolvedTargetDate };
  }
  if (aiPayload.source) {
    const aiResolvedSourceDate = resolveTimeRefToDateIso(aiPayload.source, parserBaseDate, "previous");
    if (aiResolvedSourceDate) {
      aiPayload.source = { ...aiPayload.source, kind: "date", value: aiResolvedSourceDate };
      aiPayload.sourceDate = aiResolvedSourceDate;
      aiPayload.source_date = aiResolvedSourceDate;
    }
  }

  if (!acceptsMoveWorkoutParseResult(aiPayload, aiConfidence, normalized)) {
    logIgnoredTrainingPeaksMoveParser("parse_acceptance_failed", rawText);
    return { ok: false, reason: "parse_rejected" };
  }

  return {
    ok: true,
    payload: aiPayload,
    confidence: aiConfidence,
  };
}

function formatTrainingPeaksMoveWorkoutTargetSummary(target: TrainingPeaksMoveWorkoutTimeRef): string {
  if (target.kind === "date") {
    return `на ${target.value}`;
  }
  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return "на завтра";
    }
    if (target.value === "day_after_tomorrow") {
      return "на послезавтра";
    }
    if (target.value === "today") {
      return "на сегодня";
    }
  }
  const weekdayLabelByValue: Record<string, string> = {
    monday: "на понедельник",
    tuesday: "на вторник",
    wednesday: "на среду",
    thursday: "на четверг",
    friday: "на пятницу",
    saturday: "на субботу",
    sunday: "на воскресенье",
  };
  return weekdayLabelByValue[target.value] ?? `на ${target.sourceText}`;
}

function getTrainingPeaksTelegramLinkCodePrefix(studentName: string): string {
  const normalized = studentName
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();

  return normalized.slice(0, 4) || "TP";
}

function createTrainingPeaksTelegramLinkCodeValue(studentName: string): string {
  const prefix = getTrainingPeaksTelegramLinkCodePrefix(studentName);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
}

function extractTrainingPeaksTelegramLinkCodeCandidates(text: string): string[] {
  const matches = text.toUpperCase().match(TP_TELEGRAM_LINK_CODE_PATTERN) ?? [];
  return Array.from(new Set(matches.map((match) => match.trim()).filter(Boolean)));
}

function compareStudentReports(
  left: TrainingPeaksWeeklyReport,
  right: TrainingPeaksWeeklyReport
): number {
  return (
    right.weekFrom.localeCompare(left.weekFrom) ||
    right.weekTo.localeCompare(left.weekTo) ||
    right.syncedAt.localeCompare(left.syncedAt)
  );
}

function pickMatchingStudentReport(
  reports: TrainingPeaksWeeklyReport[],
  studentQuery: string
): TrainingPeaksWeeklyReport | null {
  const normalizedQuery = normalizeStudentQuery(studentQuery);

  if (!normalizedQuery) {
    return null;
  }

  const exactMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return normalizedStudentName === normalizedQuery || normalizedStudentId === normalizedQuery;
  });

  if (exactMatches.length > 0) {
    return exactMatches.sort(compareStudentReports)[0] ?? null;
  }

  const prefixMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return (
      normalizedStudentName.startsWith(normalizedQuery) ||
      normalizedStudentId.startsWith(normalizedQuery)
    );
  });

  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  const containsMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return (
      normalizedStudentName.includes(normalizedQuery) ||
      normalizedStudentId.includes(normalizedQuery)
    );
  });

  return containsMatches.length === 1 ? containsMatches[0] : null;
}

function hasReportMarkdown(reportMarkdown: string | null): boolean {
  return Boolean(reportMarkdown?.trim());
}

function hasSummaryJson(summaryJson: unknown | null): boolean {
  return summaryJson !== null;
}

function normalizeReportStatus(report: TrainingPeaksWeeklyReport): Exclude<TrainingPeaksStatus, "missing"> {
  if (report.status === "ready" || report.status === "parsed_only") {
    return report.status;
  }

  return hasReportMarkdown(report.reportMarkdown) ? "ready" : "parsed_only";
}

function getLatestWeekFromReports(reports: TrainingPeaksWeeklyReport[]): TrainingPeaksWeek | null {
  const latestReport = reports[0];
  return latestReport
    ? {
        weekFrom: latestReport.weekFrom,
        weekTo: latestReport.weekTo,
      }
    : null;
}

function getLatestReportByStudent(
  reports: TrainingPeaksWeeklyReport[]
): Map<string, TrainingPeaksWeeklyReport> {
  const latestByStudent = new Map<string, TrainingPeaksWeeklyReport>();

  for (const report of reports) {
    if (!latestByStudent.has(report.studentId)) {
      latestByStudent.set(report.studentId, report);
    }
  }

  return latestByStudent;
}

function getSortedStudents(
  latestByStudent: Map<string, TrainingPeaksWeeklyReport>
): TrainingPeaksWeeklyReport[] {
  return Array.from(latestByStudent.values()).sort((left, right) =>
    left.studentName.localeCompare(right.studentName, "ru")
  );
}

function getWeekReportByStudent(
  reports: TrainingPeaksWeeklyReport[],
  week: TrainingPeaksWeek
): Map<string, TrainingPeaksWeeklyReport> {
  return new Map(
    reports
      .filter((report) => report.weekFrom === week.weekFrom && report.weekTo === week.weekTo)
      .map((report) => [report.studentId, report])
  );
}

function stripTpAddStudentCommandPrefix(rawInput: string): string {
  return rawInput.replace(TP_ADD_STUDENT_COMMAND_PATTERN, "").trim();
}

function stripTpRunWeekCommandPrefix(rawInput: string): string {
  return rawInput.replace(TP_RUN_WEEK_COMMAND_PATTERN, "").trim();
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isValidTrainingPeaksAthleteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseTrainingPeaksWeeklyRunWeekInput(rawInput: string):
  | { ok: true; weekFrom: string; weekTo: string }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    } {
  const normalizedInput = stripTpRunWeekCommandPrefix(rawInput);
  const tokens = normalizedInput ? normalizedInput.split(/\s+/) : [];

  if (tokens.length === 1) {
    const resolvedWeek = resolveTrainingPeaksWeekKeyword(tokens[0] ?? "");

    if (!resolvedWeek) {
      return {
        ok: false,
        reason: "invalid_format",
        message: TP_RUN_WEEK_USAGE_MESSAGE,
      };
    }

    return {
      ok: true,
      weekFrom: resolvedWeek.weekFrom,
      weekTo: resolvedWeek.weekTo,
    };
  }

  if (tokens.length !== 2) {
    return {
      ok: false,
      reason: "invalid_format",
      message: TP_RUN_WEEK_USAGE_MESSAGE,
    };
  }

  const [weekFrom, weekTo] = tokens;

  if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: TP_RUN_WEEK_USAGE_MESSAGE,
    };
  }

  if (weekFrom > weekTo) {
    return {
      ok: false,
      reason: "invalid_range",
      message: TP_RUN_WEEK_USAGE_MESSAGE,
    };
  }

  return {
    ok: true,
    weekFrom,
    weekTo,
  };
}

function parseTpAddStudentInput(rawInput: string): { studentName: string; trainingPeaksAthleteUrl: string } {
  const normalizedInput = stripTpAddStudentCommandPrefix(rawInput);
  const separatorIndex = normalizedInput.indexOf("|");

  if (separatorIndex < 0) {
    return {
      studentName: normalizedInput.trim(),
      trainingPeaksAthleteUrl: "",
    };
  }

  return {
    studentName: normalizedInput.slice(0, separatorIndex).trim(),
    trainingPeaksAthleteUrl: normalizedInput.slice(separatorIndex + 1).trim(),
  };
}

function getRegistryStudentStatus(report: TrainingPeaksWeeklyReport | null): TrainingPeaksRegistryStatus {
  if (!report) {
    return "no_data";
  }

  if (hasReportMarkdown(report.reportMarkdown)) {
    return "ready";
  }

  if (hasSummaryJson(report.summaryJson)) {
    return "data_loaded";
  }

  return "no_report";
}

function findMatchingTrainingPeaksStudents(
  students: TrainingPeaksRegistryStudentSnapshot[],
  studentQuery: string
): TrainingPeaksRegistryStudentSnapshot[] {
  const normalizedQuery = normalizeStudentQuery(studentQuery);

  if (!normalizedQuery) {
    return [];
  }

  const exactMatches = students.filter((student) => {
    const normalizedStudentName = normalizeStudentQuery(student.studentName);
    const normalizedStudentId = normalizeStudentQuery(student.studentId);
    return normalizedStudentName === normalizedQuery || normalizedStudentId === normalizedQuery;
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const prefixMatches = students.filter((student) => {
    const normalizedStudentName = normalizeStudentQuery(student.studentName);
    const normalizedStudentId = normalizeStudentQuery(student.studentId);
    return (
      normalizedStudentName.startsWith(normalizedQuery) ||
      normalizedStudentId.startsWith(normalizedQuery)
    );
  });

  if (prefixMatches.length > 0) {
    return prefixMatches;
  }

  return students.filter((student) => {
    const normalizedStudentName = normalizeStudentQuery(student.studentName);
    const normalizedStudentId = normalizeStudentQuery(student.studentId);
    return (
      normalizedStudentName.includes(normalizedQuery) ||
      normalizedStudentId.includes(normalizedQuery)
    );
  });
}

async function resolveTrainingPeaksRegistryStudent(
  studentQuery: string
): Promise<TrainingPeaksStudentCard> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const matches = findMatchingTrainingPeaksStudents(students, studentQuery);

  if (matches.length === 0) {
    return { kind: "not_found" };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      matches: matches.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
      })),
    };
  }

  const student = matches[0];

  if (!student) {
    return { kind: "not_found" };
  }

  return {
    kind: "student",
    student,
  };
}

async function getTrainingPeaksRegistryStudentByInternalId(
  id: string,
  options?: {
    includeArchived?: boolean;
  }
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus(options);
  return students.find((student) => student.id === id) ?? null;
}

export async function getTrainingPeaksStatusOverview(
  requestedWeek?: TrainingPeaksWeek
): Promise<TrainingPeaksStatusOverview | null> {
  const reports = await listAllTrainingPeaksReports();
  const week = requestedWeek ?? getLatestWeekFromReports(reports);

  if (!week) {
    return null;
  }

  const latestByStudent = getLatestReportByStudent(reports);
  const weekReportsByStudent = getWeekReportByStudent(reports, week);

  return {
    week,
    students: getSortedStudents(latestByStudent).map((student) => {
      const report = weekReportsByStudent.get(student.studentId);

      return {
        studentId: student.studentId,
        studentName: student.studentName,
        status: report ? normalizeReportStatus(report) : "missing",
        hasReport: report ? hasReportMarkdown(report.reportMarkdown) : false,
      };
    }),
  };
}

export async function getTrainingPeaksStudentSnapshots(): Promise<TrainingPeaksStudentSnapshot[]> {
  const reports = await listAllTrainingPeaksReports();

  return getSortedStudents(getLatestReportByStudent(reports)).map((report) => ({
    studentId: report.studentId,
    studentName: report.studentName,
    weekFrom: report.weekFrom,
    weekTo: report.weekTo,
    status: normalizeReportStatus(report),
  }));
}

export async function addTrainingPeaksStudentFromCommand(
  rawInput: string
): Promise<AddTrainingPeaksStudentResult> {
  const { studentName, trainingPeaksAthleteUrl } = parseTpAddStudentInput(rawInput);

  if (!studentName) {
    return { ok: false, reason: "empty_name" };
  }

  if (!trainingPeaksAthleteUrl.startsWith("https://")) {
    return { ok: false, reason: "invalid_url" };
  }

  try {
    const student = await insertTrainingPeaksStudent({
      studentId: studentName,
      studentName,
      trainingPeaksAthleteUrl,
    });

    return {
      ok: true,
      student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksStudentConflictError) {
      return {
        ok: false,
        reason: error.reason === "trainingpeaks_athlete_url" ? "duplicate_url" : "duplicate_student",
      };
    }

    console.error("Failed to add TrainingPeaks student", {
      rawInput,
      error,
    });

    return { ok: false, reason: "unknown" };
  }
}

export async function createTrainingPeaksStudent(
  input: CreateTrainingPeaksStudentInput
): Promise<CreateTrainingPeaksStudentResult> {
  const studentId = normalizeTrainingPeaksStudentId(input.studentId);
  const studentName = input.studentName.trim();
  const trainingPeaksAthleteUrl = input.trainingPeaksAthleteUrl.trim();
  const notes = normalizeOptionalText(input.notes);
  const dataQualityStatus = normalizeOptionalText(input.dataQualityStatus);

  const studentIdError = validateTrainingPeaksStudentId(studentId);

  if (studentIdError) {
    return {
      ok: false,
      reason: studentId ? "invalid_student_id" : "empty_student_id",
      message: studentIdError,
    };
  }

  if (!studentName) {
    return {
      ok: false,
      reason: "empty_student_name",
      message: "Укажи имя ученика.",
    };
  }

  if (!trainingPeaksAthleteUrl) {
    return {
      ok: false,
      reason: "empty_url",
      message: "Укажи ссылку на TrainingPeaks athlete.",
    };
  }

  if (!isValidTrainingPeaksAthleteUrl(trainingPeaksAthleteUrl)) {
    return {
      ok: false,
      reason: "invalid_url",
      message: "Ссылка на TrainingPeaks athlete должна выглядеть как URL.",
    };
  }

  try {
    const student = await insertTrainingPeaksStudent({
      studentId,
      studentName,
      trainingPeaksAthleteUrl,
      isActive: true,
      weeklyReportEnabled: true,
      telegramDeliveryEnabled: false,
      dataQualityStatus,
      notes,
    });

    return {
      ok: true,
      student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksStudentConflictError) {
      return {
        ok: false,
        reason: error.reason === "trainingpeaks_athlete_url" ? "duplicate_url" : "duplicate_student",
        message:
          error.reason === "trainingpeaks_athlete_url"
            ? "Ученик с таким TrainingPeaks URL уже существует."
            : "Ученик с таким техническим кодом уже существует.",
      };
    }

    console.error("Failed to create TrainingPeaks student from admin", {
      input: {
        ...input,
        notes,
        dataQualityStatus,
        trainingPeaksAthleteUrl,
        studentId,
        studentName,
      },
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      message: "Не удалось создать ученика. Попробуй ещё раз.",
    };
  }
}

export async function setTrainingPeaksStudentWeeklyReportsEnabled(
  id: string,
  enabled: boolean
): Promise<SetTrainingPeaksStudentWeeklyReportsEnabledResult> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  if (enabled && !existingStudent.isActive) {
    return {
      ok: false,
      reason: "student_archived",
      message: "Нельзя включить недельные отчёты для архивного ученика.",
    };
  }

  const student = await setTrainingPeaksStudentWeeklyReportsEnabledById(id, enabled);

  if (!student) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  return {
    ok: true,
    student,
  };
}

export async function unlinkTrainingPeaksStudentTelegram(
  id: string
): Promise<UnlinkTrainingPeaksStudentTelegramResult> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  const student = await unlinkTrainingPeaksStudentTelegramById(id);

  if (!student) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  return {
    ok: true,
    student,
  };
}

export async function listTrainingPeaksWeeklyReportEligibleStudents(): Promise<
  Pick<TrainingPeaksStudent, "studentId" | "studentName">[]
> {
  const students = await listTrainingPeaksWeeklyReportEligibleStudentsFromRepository();
  return students.map((student) => ({
    studentId: student.studentId,
    studentName: student.studentName,
  }));
}

export async function requestTrainingPeaksWeeklyRun(
  rawInput: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksWeeklyRunResult> {
  const parsedInput = parseTrainingPeaksWeeklyRunWeekInput(rawInput);

  if (!parsedInput.ok) {
    return parsedInput;
  }

  try {
    const job = await createTrainingPeaksWeeklyJob({
      weekFrom: parsedInput.weekFrom,
      weekTo: parsedInput.weekTo,
      requestedByChatId: String(requester.chatId),
      requestedByUserId: requester.userId === null ? null : String(requester.userId),
    });

    return {
      ok: true,
      job,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksJobForWeek(
        "weekly_reports",
        parsedInput.weekFrom,
        parsedInput.weekTo
      );

      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob ? mapActiveTrainingPeaksJobSnapshot(activeJob) : null,
        message: "Такая задача уже ожидает выполнения или сейчас выполняется.",
      };
    }

    console.error("Failed to request TrainingPeaks weekly job", {
      rawInput,
      requester,
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу TrainingPeaks. Попробуй позже.",
    };
  }
}

const TP_RUN_STUDENT_COMMAND_PATTERN = /^\/tp_run_student(?:@\w+)?(?:\s+|$)/;

function stripTpRunStudentCommandPrefix(rawInput: string): string {
  return rawInput.replace(TP_RUN_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseTpRunStudentCommand(rawInput: string):
  | { ok: true; studentQuery: string; weekFrom: string; weekTo: string }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    } {
  const normalizedInput = stripTpRunStudentCommandPrefix(rawInput);

  if (!normalizedInput) {
    return {
      ok: false,
      reason: "invalid_format",
      message:
        "Напиши так: /tp_run_student levan 2026-05-11 2026-05-17 или /tp_run_student \"Alena Kovaldova\" 2026-05-11 2026-05-17",
    };
  }

  const quotedMatch = normalizedInput.match(/^"([^"]+)"\s+(\S+)\s+(\S+)$/);
  if (quotedMatch) {
    const [, studentQuery, weekFrom, weekTo] = quotedMatch;
    if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
      return {
        ok: false,
        reason: "invalid_date",
        message: "Даты недели нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
      };
    }
    if (weekFrom > weekTo) {
      return {
        ok: false,
        reason: "invalid_range",
        message: "Дата начала недели не может быть позже даты окончания.",
      };
    }
    return { ok: true, studentQuery: studentQuery.trim(), weekFrom, weekTo };
  }

  const tokens = normalizedInput.split(/\s+/);
  if (tokens.length < 3) {
    return {
      ok: false,
      reason: "invalid_format",
      message:
        "Напиши так: /tp_run_student levan 2026-05-11 2026-05-17 или /tp_run_student \"Alena Kovaldova\" 2026-05-11 2026-05-17",
    };
  }

  const weekTo = tokens[tokens.length - 1] ?? "";
  const weekFrom = tokens[tokens.length - 2] ?? "";
  const studentQuery = tokens.slice(0, -2).join(" ").trim();

  if (!studentQuery) {
    return {
      ok: false,
      reason: "invalid_format",
      message: "После /tp_run_student нужно указать ученика.",
    };
  }

  if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Даты недели нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }

  if (weekFrom > weekTo) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала недели не может быть позже даты окончания.",
    };
  }

  return { ok: true, studentQuery, weekFrom, weekTo };
}

function validateStudentForSingleWeeklyJob(
  match: TrainingPeaksStudentCard
):
  | { ok: true; student: TrainingPeaksRegistryStudentSnapshot }
  | {
      ok: false;
      reason:
        | "student_not_found"
        | "student_ambiguous"
        | "student_archived"
        | "student_inactive"
        | "missing_trainingpeaks_url";
      message: string;
      matches?: { studentId: string; studentName: string }[];
    } {
  if (match.kind === "not_found") {
    return { ok: false, reason: "student_not_found", message: "Ученик не найден." };
  }

  if (match.kind === "ambiguous") {
    return {
      ok: false,
      reason: "student_ambiguous",
      message: `Нашлось несколько учеников: ${match.matches.map((entry) => entry.studentName).join(", ")}. Уточни имя или slug.`,
      matches: match.matches,
    };
  }

  const { student } = match;

  if (student.archivedAt) {
    return {
      ok: false,
      reason: "student_archived",
      message: `Ученик ${student.studentName} в архиве. Восстанови его перед генерацией отчёта.`,
    };
  }

  if (!student.isActive) {
    return {
      ok: false,
      reason: "student_inactive",
      message: `Ученик ${student.studentName} неактивен.`,
    };
  }

  if (!student.trainingPeaksAthleteUrl.trim()) {
    return {
      ok: false,
      reason: "missing_trainingpeaks_url",
      message: `У ученика ${student.studentName} нет ссылки TrainingPeaks athlete.`,
    };
  }

  return { ok: true, student };
}

function mapActiveTrainingPeaksJobSnapshot(
  job: TrainingPeaksJob
): Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "scope" | "studentId"> {
  return {
    id: job.id,
    status: job.status,
    weekFrom: job.weekFrom,
    weekTo: job.weekTo,
    scope: job.scope,
    studentId: job.studentId,
  };
}

export async function requestTrainingPeaksWeeklyRunForStudent(
  rawInput: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksWeeklyRunForStudentResult> {
  const parsedInput = parseTpRunStudentCommand(rawInput);

  if (!parsedInput.ok) {
    return parsedInput;
  }

  const studentMatch = await resolveTrainingPeaksRegistryStudent(parsedInput.studentQuery);
  const validatedStudent = validateStudentForSingleWeeklyJob(studentMatch);

  if (!validatedStudent.ok) {
    return validatedStudent;
  }

  try {
    const job = await createTrainingPeaksWeeklyJob({
      scope: "single_student",
      studentId: validatedStudent.student.studentId,
      weekFrom: parsedInput.weekFrom,
      weekTo: parsedInput.weekTo,
      requestedByChatId: String(requester.chatId),
      requestedByUserId: requester.userId === null ? null : String(requester.userId),
    });

    return {
      ok: true,
      job,
      student: validatedStudent.student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksJobForStudentWeek(
        "weekly_reports",
        validatedStudent.student.studentId,
        parsedInput.weekFrom,
        parsedInput.weekTo
      );

      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob ? mapActiveTrainingPeaksJobSnapshot(activeJob) : null,
        message: "Такая задача для этого ученика уже ожидает выполнения или сейчас выполняется.",
      };
    }

    console.error("Failed to request TrainingPeaks single-student weekly job", {
      rawInput,
      requester,
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу TrainingPeaks. Попробуй позже.",
    };
  }
}

export async function requestTrainingPeaksWeeklyRunForStudentByInternalId(input: {
  studentInternalId: string;
  weekFrom: string;
  weekTo: string;
  requestedByChatId?: string | null;
  requestedByUserId?: string | null;
}): Promise<RequestTrainingPeaksWeeklyRunForStudentResult> {
  if (!isIsoDate(input.weekFrom) || !isIsoDate(input.weekTo)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Даты недели нужно передать в формате YYYY-MM-DD.",
    };
  }

  if (input.weekFrom > input.weekTo) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала недели не может быть позже даты окончания.",
    };
  }

  const studentRecord = await getTrainingPeaksStudentByIdFromRepository(input.studentInternalId);

  if (!studentRecord) {
    return { ok: false, reason: "student_not_found", message: "Ученик не найден." };
  }

  return requestTrainingPeaksWeeklyRunForStudent(
    `/tp_run_student ${studentRecord.studentId} ${input.weekFrom} ${input.weekTo}`,
    {
      chatId: input.requestedByChatId ?? "admin",
      userId: input.requestedByUserId ?? null,
    }
  );
}

export async function getTrainingPeaksWeeklyReportForStudentWeekFromService(
  studentId: string,
  weekFrom: string,
  weekTo: string
) {
  return getTrainingPeaksWeeklyReportForStudentWeek(studentId, weekFrom, weekTo);
}

export async function requestTrainingPeaksRaceScan(
  fromDate: string,
  toDate: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksRaceScanResult> {
  if (!ISO_DATE_PATTERN.test(fromDate) || !ISO_DATE_PATTERN.test(toDate)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Период нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }
  if (fromDate > toDate) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала периода не может быть позже даты окончания.",
    };
  }

  try {
    const job = await createTrainingPeaksRaceScanJob({
      fromDate,
      toDate,
      requestedByChatId: String(requester.chatId),
      requestedByUserId: requester.userId === null ? null : String(requester.userId),
    });
    return { ok: true, job };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksJobForWeek("race_scan_events", fromDate, toDate);
      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status,
              weekFrom: activeJob.weekFrom,
              weekTo: activeJob.weekTo,
            }
          : null,
        message: "Такая задача по забегам уже ожидает выполнения или сейчас выполняется.",
      };
    }
    console.error("Failed to request TrainingPeaks race scan job", {
      fromDate,
      toDate,
      requester,
      error,
    });
    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу сканирования забегов. Попробуй позже.",
    };
  }
}

export async function getActiveTrainingPeaksWeeklyJobForWeek(
  week: TrainingPeaksWeek
): Promise<Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo"> | null> {
  const activeJob = await findActiveTrainingPeaksJobForWeek("weekly_reports", week.weekFrom, week.weekTo);

  if (!activeJob) {
    return null;
  }

  return {
    id: activeJob.id,
    status: activeJob.status,
    weekFrom: activeJob.weekFrom,
    weekTo: activeJob.weekTo,
  };
}

export async function cancelTrainingPeaksWeeklyRun(
  jobId: string
): Promise<CancelTrainingPeaksWeeklyRunResult> {
  const cancelledJob = await cancelQueuedTrainingPeaksJob(jobId);

  if (cancelledJob) {
    return {
      ok: true,
      job: cancelledJob,
    };
  }

  const existingJob = await getTrainingPeaksJobById(jobId);

  if (!existingJob) {
    return {
      ok: false,
      reason: "not_found",
    };
  }

  if (existingJob.status === "running") {
    return {
      ok: false,
      reason: "already_started",
    };
  }

  return {
    ok: false,
    reason: "not_cancellable",
  };
}

export { TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE };

export async function getTrainingPeaksJobsStatus(): Promise<TrainingPeaksJob[]> {
  return listRecentTrainingPeaksJobs(10);
}

function getIsoTimeMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isWithinLookbackHours(value: string | null | undefined, lookbackHours: number): boolean {
  const timeMs = getIsoTimeMs(value);
  if (timeMs === null) {
    return false;
  }
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  return timeMs >= cutoffMs;
}

function pushUniqueAttentionSignal(
  list: TrainingPeaksAttentionSignal[],
  signal: TrainingPeaksAttentionSignal
): void {
  const key = `${signal.level}:${signal.studentName ?? ""}:${signal.reason}`;
  const exists = list.some(
    (item) =>
      `${item.level}:${item.studentName ?? ""}:${item.reason}` === key
  );
  if (!exists) {
    list.push(signal);
  }
}

function getBelgradeIsoDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRAININGPEAKS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Unable to derive Belgrade date.");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftBelgradeIsoDate(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return getBelgradeIsoDate(shifted);
}

function getYesterdayBelgradeIsoDate(now = new Date()): string {
  const today = getBelgradeIsoDate(now);
  return shiftBelgradeIsoDate(today, -1);
}

function formatMissedRunningWorkoutReason(count: number): string {
  const lastTwoDigits = Math.abs(count) % 100;
  const lastDigit = Math.abs(count) % 10;
  const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? "беговых тренировок"
    : lastDigit >= 2 && lastDigit <= 4
      ? "беговые тренировки"
      : "беговых тренировок";
  return `вчера ${count} ${noun}, выполнения не найдено`;
}

export async function getTrainingPeaksAttentionSnapshot(): Promise<TrainingPeaksAttentionSnapshot> {
  const [actions, jobs] = await Promise.all([
    listRecentTrainingPeaksActionsFromRepository(50),
    listRecentTrainingPeaksJobs(40),
  ]);
  const latestRunsByActionId = await listLatestTrainingPeaksActionRunsByActionIds(
    actions.map((action) => action.id)
  );

  const urgent: TrainingPeaksAttentionSignal[] = [];
  const today: TrainingPeaksAttentionSignal[] = [];
  const observe: TrainingPeaksAttentionSignal[] = [];
  const fyi: TrainingPeaksAttentionSignal[] = [];

  for (const action of actions) {
    const studentName = action.studentName?.trim() || null;

    if (action.status === "pending_coach") {
      pushUniqueAttentionSignal(today, {
        level: "today",
        studentName,
        reason: "ждёт решения по переносу тренировки",
      });
    }

    if (
      action.executionStatus === "failed" &&
      isWithinLookbackHours(action.updatedAt, 48)
    ) {
      const latestRun = latestRunsByActionId.get(action.id);
      const isResolvedAction = action.status === "rejected";

      if (isResolvedAction) {
        continue;
      }

      if (latestRun) {
        if (latestRun.status === "completed") {
          continue;
        }

        if (latestRun.status === "failed" && isWithinLookbackHours(latestRun.createdAt, 48)) {
          pushUniqueAttentionSignal(urgent, {
            level: "urgent",
            studentName,
            reason: "выполнение переноса завершилось с ошибкой",
          });
        }
        continue;
      }

      pushUniqueAttentionSignal(urgent, {
        level: "urgent",
        studentName,
        reason: "выполнение переноса завершилось с ошибкой",
      });
    }

    // Stuck detection is temporarily disabled: we need a more reliable source of truth
    // before surfacing intermediate statuses in /tp_attention.
  }

  const yesterdayDate = getYesterdayBelgradeIsoDate();
  const [activeStudents, yesterdayWorkoutRows, yesterdayScanStatuses] = await Promise.all([
    listTrainingPeaksStudents(),
    listTrainingPeaksWorkoutCacheForDateRange({
      from: yesterdayDate,
      to: yesterdayDate,
    }),
    listTrainingPeaksWorkoutCacheScanStatusesForRange({
      from: yesterdayDate,
      to: yesterdayDate,
    }),
  ]);

  const scanStatusByStudentId = new Map<string, (typeof yesterdayScanStatuses)[number]>();
  for (const status of yesterdayScanStatuses) {
    if (!scanStatusByStudentId.has(status.studentId)) {
      scanStatusByStudentId.set(status.studentId, status);
    }
  }

  const rowsByStudentId = new Map<string, (typeof yesterdayWorkoutRows)>();
  for (const row of yesterdayWorkoutRows) {
    const rows = rowsByStudentId.get(row.studentId) ?? [];
    rows.push(row);
    rowsByStudentId.set(row.studentId, rows);
  }

  let missingScanCount = 0;
  for (const student of activeStudents) {
    const studentName = student.studentName?.trim() || null;
    const scanStatus = scanStatusByStudentId.get(student.id);

    if (!scanStatus) {
      missingScanCount += 1;
      continue;
    }

    if (scanStatus.status === "failed") {
      pushUniqueAttentionSignal(observe, {
        level: "observe",
        studentName,
        reason: "скан тренировок за вчера завершился с ошибкой",
      });
      continue;
    }

    if (scanStatus.status !== "ok") {
      continue;
    }

    const studentRows = rowsByStudentId.get(student.id) ?? [];
    if (studentRows.length === 0) {
      continue;
    }

    let missedRunningPlannedCount = 0;
    for (const row of studentRows) {
      if (!row.isPlanned || row.isCompleted) {
        continue;
      }

      const classification = classifyTrainingPeaksWorkoutActivity({
        title: row.title,
        sportOrTypeCode: row.sportOrTypeCode,
        workoutTypeValueId: row.workoutTypeValueId,
        workoutSubTypeId: row.workoutSubTypeId,
        sourceSnapshot: row.sourceSnapshot,
      });

      if (classification.isRunning) {
        missedRunningPlannedCount += 1;
      }
    }

    if (missedRunningPlannedCount === 1) {
      pushUniqueAttentionSignal(today, {
        level: "today",
        studentName,
        reason: "вчера была беговая тренировка, выполнения не найдено",
      });
      continue;
    }

    if (missedRunningPlannedCount > 1) {
      pushUniqueAttentionSignal(today, {
        level: "today",
        studentName,
        reason: formatMissedRunningWorkoutReason(missedRunningPlannedCount),
      });
    }
  }

  if (missingScanCount > 0) {
    pushUniqueAttentionSignal(fyi, {
      level: "fyi",
      studentName: null,
      reason: `Нет свежего скана тренировок за вчера для ${missingScanCount} учеников`,
    });
  }

  const recoveryAlertTargetDate = yesterdayDate;
  const recoveryAlertFromDate = shiftBelgradeIsoDate(recoveryAlertTargetDate, -2);
  const eligibleRecoveryProfiles = await listTrainingPeaksStudentsEligibleForHealthMetrics();
  for (const profile of eligibleRecoveryProfiles) {
    const metrics = await listTrainingPeaksHealthMetricsForStudentDateRange({
      studentId: profile.studentId,
      from: recoveryAlertFromDate,
      to: recoveryAlertTargetDate,
    });
    const alert = evaluateTrainingPeaksRecoveryAlert({
      profile,
      metrics,
      targetDate: recoveryAlertTargetDate,
      lookbackDays: 3,
    });
    if (!alert) {
      continue;
    }
    pushUniqueAttentionSignal(observe, {
      level: "observe",
      studentName: profile.studentName?.trim() || null,
      reason: alert.message,
    });
  }

  for (const job of jobs) {
    if (job.status !== "failed") {
      continue;
    }
    if (!isWithinLookbackHours(job.updatedAt, 48)) {
      continue;
    }

    if (job.jobType === "race_scan_events") {
      pushUniqueAttentionSignal(urgent, {
        level: "urgent",
        studentName: null,
        reason: "последний запуск сканирования забегов завершился с ошибкой",
      });
      continue;
    }

    pushUniqueAttentionSignal(urgent, {
      level: "urgent",
      studentName: null,
      reason: "последний запуск TP завершился с ошибкой",
    });
  }

  return {
    urgent,
    today,
    observe,
    fyi,
  };
}

function trimTelegramBusinessText(value: string | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

export async function upsertTrainingPeaksBusinessChatFromMessage(
  message: Pick<TelegramMessage, "business_connection_id" | "chat" | "text" | "caption">
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  const businessConnectionId = message.business_connection_id?.trim();
  const chatId = message.chat?.id;

  if (!businessConnectionId || chatId === undefined || chatId === null) {
    return null;
  }

  return upsertTrainingPeaksBusinessChatFromMessageInRepository({
    businessConnectionId,
    chatId: String(chatId),
    username: message.chat.username?.trim() || null,
    firstName: message.chat.first_name?.trim() || null,
    lastName: message.chat.last_name?.trim() || null,
    lastText: trimTelegramBusinessText(message.text ?? message.caption),
    lastSeenAt: new Date().toISOString(),
  });
}

export async function listRecentTrainingPeaksBusinessChats(
  limit = 10
): Promise<TrainingPeaksBusinessChatSnapshot[]> {
  return listRecentTrainingPeaksBusinessChatsFromRepository(limit);
}

export async function findTrainingPeaksBusinessChatsByUsername(
  username: string,
  limit = 10
): Promise<TrainingPeaksBusinessChatSnapshot[]> {
  return listTrainingPeaksBusinessChatsByUsernameFromRepository(username, limit);
}

export async function getTrainingPeaksBusinessChatByInternalId(
  id: string
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  return getTrainingPeaksBusinessChatById(id);
}

export async function linkTrainingPeaksStudentToBusinessChat(
  studentId: string,
  chatId: string,
  businessConnectionId: string
): Promise<{ student: TrainingPeaksStudent; chat: TrainingPeaksBusinessChatSnapshot } | null> {
  return linkTrainingPeaksStudentToBusinessChatInRepository(studentId, chatId, businessConnectionId);
}

export async function createTrainingPeaksStudentTelegramLinkCode(
  studentId: string,
  options?: {
    expiresInHours?: number;
  }
): Promise<
  | {
      student: TrainingPeaksRegistryStudentSnapshot;
      linkCode: TrainingPeaksStudentTelegramLinkCodeSnapshot;
    }
  | null
> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    return null;
  }

  await expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent(student.id);
  const expiresInHours = Math.max(1, Math.floor(options?.expiresInHours ?? TP_TELEGRAM_LINK_CODE_DEFAULT_TTL_HOURS));
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createTrainingPeaksTelegramLinkCodeValue(student.studentName);

    try {
      const linkCode = await insertTrainingPeaksStudentTelegramLinkCode({
        studentId: student.id,
        code,
        expiresAt,
      });

      return {
        student,
        linkCode,
      };
    } catch (error) {
      if (error instanceof TrainingPeaksTelegramLinkCodeConflictError) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to generate unique TrainingPeaks Telegram link code");
}

async function getStudentNameByInternalId(id: string): Promise<string | null> {
  const student = await getTrainingPeaksStudentByIdFromRepository(id);
  return student?.studentName ?? null;
}

export async function consumeTrainingPeaksStudentTelegramLinkCode(
  text: string,
  businessConnectionId: string,
  chatId: string
): Promise<ConsumeTrainingPeaksStudentTelegramLinkCodeResult> {
  const candidateCodes = extractTrainingPeaksTelegramLinkCodeCandidates(text);

  if (candidateCodes.length === 0) {
    return { kind: "no_candidate" };
  }

  const allMatchingCodes = await listTrainingPeaksStudentTelegramLinkCodesByCode(candidateCodes);
  const now = Date.now();
  const expiredActiveCodes = allMatchingCodes.filter(
    (code) => code.status === "active" && new Date(code.expiresAt).getTime() <= now
  );

  if (expiredActiveCodes.length > 0) {
    await expireTrainingPeaksStudentTelegramLinkCodesByIds(expiredActiveCodes.map((code) => code.id));
  }

  for (const candidateCode of candidateCodes) {
    const candidateMatches = allMatchingCodes.filter((code) => code.code === candidateCode);
    const activeMatches = candidateMatches.filter(
      (code) => code.status === "active" && new Date(code.expiresAt).getTime() > now
    );

    if (activeMatches.length === 1) {
      const activeCode = activeMatches[0]!;
      const linked = await linkTrainingPeaksStudentToBusinessChatInRepository(
        activeCode.studentId,
        chatId,
        businessConnectionId
      );

      if (!linked) {
        return {
          kind: "link_failed",
          code: candidateCode,
          studentName: await getStudentNameByInternalId(activeCode.studentId),
        };
      }

      await markTrainingPeaksStudentTelegramLinkCodeUsed(activeCode.id, {
        businessConnectionId,
        chatId,
      });

      return {
        kind: "linked",
        code: candidateCode,
        student: linked.student,
        chat: linked.chat,
      };
    }
  }

  for (const candidateCode of candidateCodes) {
    const candidateMatches = allMatchingCodes.filter((code) => code.code === candidateCode);
    const activeMatches = candidateMatches.filter(
      (code) => code.status === "active" && new Date(code.expiresAt).getTime() > now
    );

    if (activeMatches.length > 1) {
      return {
        kind: "ambiguous",
        code: candidateCode,
        matches: activeMatches.length,
      };
    }

    const usedMatch = candidateMatches.find((code) => code.status === "used");

    if (usedMatch) {
      return {
        kind: "used",
        code: candidateCode,
        studentName: await getStudentNameByInternalId(usedMatch.studentId),
      };
    }

    const expiredMatch = candidateMatches.find(
      (code) => code.status === "expired" || new Date(code.expiresAt).getTime() <= now
    );

    if (expiredMatch) {
      return {
        kind: "expired",
        code: candidateCode,
        studentName: await getStudentNameByInternalId(expiredMatch.studentId),
      };
    }
  }

  return {
    kind: "no_match",
    code: candidateCodes[0]!,
  };
}

export async function createTrainingPeaksMoveWorkoutActionFromTelegram(
  input: CreateTrainingPeaksMoveWorkoutActionFromTelegramInput
): Promise<CreateTrainingPeaksMoveWorkoutActionFromTelegramResult> {
  const trimmedText = input.text.trim();

  if (!trimmedText) {
    return { ok: false, reason: "empty_text" };
  }

  const student = await getTrainingPeaksStudentByTelegramChatIdFromRepository(input.chatId);
  if (!student) {
    return { ok: false, reason: "student_not_found" };
  }

  const parsed = await parseTrainingPeaksMoveWorkoutRequest(trimmedText);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  const action = await createTrainingPeaksActionInRepository({
    studentId: student.id,
    actionType: "move_workout",
    status: "pending_coach",
    sourceChatId: input.chatId,
    sourceMessageId: input.messageId,
    sourceUserId: input.userId ?? null,
    rawText: trimmedText,
    parsedPayload: parsed.payload,
    confidence: String(parsed.confidence),
    coachChatId: input.coachChatId ?? null,
  });

  return {
    ok: true,
    action,
    student,
    parsed: parsed.payload,
  };
}

export function formatTrainingPeaksMoveWorkoutActionSummary(
  payload: ParsedTrainingPeaksMoveWorkoutPayload
): string {
  return `move_workout ${formatTrainingPeaksMoveWorkoutTargetSummary(payload.target)}`;
}

export async function approveTrainingPeaksAction(
  input: DecideTrainingPeaksActionInput
): Promise<DecideTrainingPeaksActionResultSnapshot> {
  return approveTrainingPeaksActionInRepository({
    actionId: input.actionId,
    decidedByChatId: input.decidedByChatId,
    decidedByUserId: input.decidedByUserId ?? null,
    decisionMessageId: input.decisionMessageId ?? null,
  });
}

export async function rejectTrainingPeaksAction(
  input: DecideTrainingPeaksActionInput
): Promise<DecideTrainingPeaksActionResultSnapshot> {
  return rejectTrainingPeaksActionInRepository({
    actionId: input.actionId,
    decidedByChatId: input.decidedByChatId,
    decidedByUserId: input.decidedByUserId ?? null,
    decisionMessageId: input.decisionMessageId ?? null,
  });
}

export async function requestTrainingPeaksActionExecution(input: {
  actionId: string;
  requestedByChatId: string;
  requestedByUserId?: string | null;
  requestMessageId?: string | null;
}): Promise<RequestTrainingPeaksActionExecutionResultSnapshot> {
  return requestTrainingPeaksActionExecutionInRepository({
    actionId: input.actionId,
    requestedByChatId: input.requestedByChatId,
    requestedByUserId: input.requestedByUserId ?? null,
    requestMessageId: input.requestMessageId ?? null,
  });
}

export async function cancelTrainingPeaksActionExecution(input: {
  actionId: string;
  cancelledByChatId: string;
  cancelledByUserId?: string | null;
  cancelMessageId?: string | null;
}): Promise<CancelTrainingPeaksActionExecutionResultSnapshot> {
  return cancelTrainingPeaksActionExecutionInRepository({
    actionId: input.actionId,
    cancelledByChatId: input.cancelledByChatId,
    cancelledByUserId: input.cancelledByUserId ?? null,
    cancelMessageId: input.cancelMessageId ?? null,
  });
}

export async function listRecentTrainingPeaksActions(
  limit = 15
): Promise<TrainingPeaksActionWithStudentSnapshot[]> {
  return listRecentTrainingPeaksActionsFromRepository(limit);
}

export async function getTrainingPeaksActionWithStudentById(
  actionId: string
): Promise<TrainingPeaksActionWithStudentSnapshot | null> {
  const action = await getTrainingPeaksActionByIdInRepository(actionId);
  if (!action) {
    return null;
  }
  let studentName: string | null = null;
  if (action.studentId) {
    const student = await getTrainingPeaksStudentByIdFromRepository(action.studentId);
    studentName = student?.studentName ?? null;
  }
  return { ...action, studentName };
}

export async function claimOneApprovedTrainingPeaksActionForDryRun(
  claimedBy: string
): Promise<ClaimedTrainingPeaksDryRunActionSnapshot | null> {
  return claimOneApprovedTrainingPeaksActionForDryRunInRepository(claimedBy);
}

export async function createTrainingPeaksActionDryRun(
  actionId: string,
  runnerId: string
): Promise<TrainingPeaksActionRunSnapshot> {
  return createTrainingPeaksActionRunInRepository({
    actionId,
    runType: "dry_run",
    dryRun: true,
    runnerId,
  });
}

export async function completeTrainingPeaksActionDryRun(
  actionId: string,
  input: {
    runId: string;
    logJson?: unknown;
    screenshotBeforePath?: string | null;
    screenshotAfterPath?: string | null;
  }
): Promise<void> {
  return completeTrainingPeaksActionDryRunInRepository(actionId, input);
}

export async function failTrainingPeaksActionDryRun(
  actionId: string,
  input: {
    runId: string;
    errorMessage: string;
    logJson?: unknown;
  }
): Promise<void> {
  return failTrainingPeaksActionDryRunInRepository(actionId, input);
}

export async function recoverStaleTrainingPeaksJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobs(timeoutMinutes);
}

export async function recoverStaleTrainingPeaksRaceScanJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningRaceScanJobs(timeoutMinutes);
}

export async function getTrainingPeaksStudentsRegistryWithLatestReportStatus(options?: {
  includeArchived?: boolean;
}): Promise<TrainingPeaksRegistryStudentSnapshot[]> {
  const [students, reports] = await Promise.all([
    options?.includeArchived ? listTrainingPeaksStudentsIncludingArchived() : listTrainingPeaksStudents(),
    listAllTrainingPeaksReports(),
  ]);
  const latestByStudent = getLatestReportByStudent(reports);

  return students
    .map((student) => {
      const latestReport = latestByStudent.get(student.studentId) ?? null;

      return {
        id: student.id,
        studentId: student.studentId,
        studentName: student.studentName,
        trainingPeaksAthleteUrl: student.trainingPeaksAthleteUrl,
        isActive: student.isActive,
        weeklyReportEnabled: student.weeklyReportEnabled,
        archivedAt: student.archivedAt,
        telegramChatId: student.telegramChatId,
        telegramUsername: student.telegramUsername,
        telegramProfileUrl: student.telegramProfileUrl,
        telegramDeliveryEnabled: student.telegramDeliveryEnabled,
        dataQualityStatus: student.dataQualityStatus,
        notes: student.notes,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt,
        latestWeekFrom: latestReport?.weekFrom ?? null,
        latestWeekTo: latestReport?.weekTo ?? null,
        latestReportStatus: getRegistryStudentStatus(latestReport),
      };
    })
    .sort((left, right) => left.studentName.localeCompare(right.studentName, "ru"));
}

export async function getTrainingPeaksStudentCard(
  studentQuery: string
): Promise<TrainingPeaksStudentCard> {
  return resolveTrainingPeaksRegistryStudent(studentQuery);
}

export async function getTrainingPeaksStudentCardByInternalId(
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  return getTrainingPeaksRegistryStudentByInternalId(id);
}

export async function getTrainingPeaksStudentById(studentId: string): Promise<TrainingPeaksStudent | null> {
  return getTrainingPeaksStudentByIdFromRepository(studentId);
}

export async function getTrainingPeaksStudentByStudentId(
  studentId: string
): Promise<TrainingPeaksStudent | null> {
  return getTrainingPeaksStudentByStudentIdFromRepository(studentId);
}

export async function disableTrainingPeaksStudent(
  studentQuery: string
): Promise<DisableTrainingPeaksStudentResult> {
  const match = await resolveTrainingPeaksRegistryStudent(studentQuery);

  if (match.kind !== "student") {
    return match;
  }

  const student = await disableTrainingPeaksStudentById(match.student.id);

  return {
    kind: "student",
    student,
  };
}

export async function disableTrainingPeaksStudentByInternalId(
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });

  if (!existingStudent) {
    return null;
  }

  await disableTrainingPeaksStudentById(id);
  return getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });
}

export async function enableTrainingPeaksStudent(
  studentQuery: string
): Promise<EnableTrainingPeaksStudentResult> {
  const match = await resolveTrainingPeaksRegistryStudent(studentQuery);

  if (match.kind !== "student") {
    return match;
  }

  const student = await enableTrainingPeaksStudentById(match.student.id);

  return {
    kind: "student",
    student,
  };
}

export async function enableTrainingPeaksStudentByInternalId(
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });

  if (!existingStudent) {
    return null;
  }

  await enableTrainingPeaksStudentById(id);
  return getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });
}

export async function getTrainingPeaksReportMarkdown(
  studentQuery: string,
  week?: TrainingPeaksWeek
): Promise<string | null> {
  const report = await getTrainingPeaksReportSnapshot(studentQuery, week);
  return report?.reportMarkdown ?? null;
}

export async function getTrainingPeaksReportSnapshot(
  studentQuery: string,
  week?: TrainingPeaksWeek
): Promise<TrainingPeaksReportSnapshot | null> {
  const reports = await listAllTrainingPeaksReports();
  const filteredReports = week
    ? reports.filter((report) => report.weekFrom === week.weekFrom && report.weekTo === week.weekTo)
    : reports;
  const report = pickMatchingStudentReport(filteredReports, studentQuery);
  const reportMarkdown = report?.reportMarkdown?.trim();

  if (!report || !reportMarkdown) {
    return null;
  }

  return {
    studentId: report.studentId,
    studentName: report.studentName,
    weekFrom: report.weekFrom,
    weekTo: report.weekTo,
    reportMarkdown,
  };
}

export async function getTrainingPeaksLatestReportSnapshotByInternalId(
  id: string
): Promise<TrainingPeaksReportSnapshot | null> {
  const student = await getTrainingPeaksRegistryStudentByInternalId(id);

  if (!student) {
    return null;
  }

  return getTrainingPeaksReportSnapshot(student.studentId);
}

export async function updateTrainingPeaksStudentTelegramContactByInternalId(
  id: string,
  input: UpdateTrainingPeaksStudentTelegramContactInput
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return null;
  }

  await updateTrainingPeaksStudentTelegramContactById(id, input);
  return getTrainingPeaksRegistryStudentByInternalId(id);
}

export async function updateTrainingPeaksStudentTelegramContact(
  studentId: string,
  input: UpdateTrainingPeaksStudentTelegramContactParams
): Promise<TrainingPeaksStudent | null> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(studentId);

  if (!existingStudent) {
    return null;
  }

  return updateTrainingPeaksStudentTelegramContactInRepository(studentId, input);
}

export async function getTrainingPeaksWeeklyReportByInternalId(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  return getTrainingPeaksWeeklyReportById(id);
}

export async function updateTrainingPeaksWeeklyReportStateByInternalId(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportStateInput
): Promise<TrainingPeaksWeeklyReport | null> {
  const existingReport = await getTrainingPeaksWeeklyReportById(id);

  if (!existingReport) {
    return null;
  }

  return updateTrainingPeaksWeeklyReportStateById(id, input);
}

export async function updateTrainingPeaksWeeklyReportContentByInternalId(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportContentInput
): Promise<TrainingPeaksWeeklyReport | null> {
  const existingReport = await getTrainingPeaksWeeklyReportById(id);

  if (!existingReport) {
    return null;
  }

  return updateTrainingPeaksWeeklyReportContentById(id, input);
}

export async function deleteTrainingPeaksOrphanReportsForWeek(
  weekFrom: string,
  weekTo: string
): Promise<
  | {
      ok: true;
      deletedCount: number;
      weekFrom: string;
      weekTo: string;
    }
  | {
      ok: false;
      message: string;
    }
> {
  if (!ISO_DATE_PATTERN.test(weekFrom) || !ISO_DATE_PATTERN.test(weekTo)) {
    return {
      ok: false,
      message: "Некорректный диапазон недели.",
    };
  }

  const deletedCount = await deleteTrainingPeaksOrphanReportsForWeekInRepository(weekFrom, weekTo);

  return {
    ok: true,
    deletedCount,
    weekFrom,
    weekTo,
  };
}

export async function deleteTrainingPeaksOrphanReportByInternalId(
  id: string
): Promise<
  | {
      ok: true;
      report: TrainingPeaksWeeklyReport;
    }
  | {
      ok: false;
      message: string;
    }
> {
  const report = await getTrainingPeaksWeeklyReportById(id);

  if (!report) {
    return {
      ok: false,
      message: "Отчёт не найден.",
    };
  }

  const student = await getTrainingPeaksStudentByStudentIdFromRepository(report.studentId);

  if (student) {
    return {
      ok: false,
      message: "Можно удалить только orphan-отчёт, если ученика нет в реестре.",
    };
  }

  const deletedReport = await deleteTrainingPeaksWeeklyReportById(id);

  if (!deletedReport) {
    return {
      ok: false,
      message: "Отчёт не найден.",
    };
  }

  return {
    ok: true,
    report: deletedReport,
  };
}

export async function updateTrainingPeaksWeeklyReportReviewState(
  reportId: string,
  input: UpdateTrainingPeaksWeeklyReportReviewStateInput
): Promise<TrainingPeaksWeeklyReport | null> {
  const existingReport = await getTrainingPeaksWeeklyReportById(reportId);

  if (!existingReport) {
    return null;
  }

  return updateTrainingPeaksWeeklyReportReviewStateInRepository(reportId, input);
}

export async function approveTrainingPeaksWeeklyReportDraftByInternalId(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  return approveTrainingPeaksWeeklyReportIfDraft(id);
}

export async function claimTrainingPeaksWeeklyReportForSend(
  reportId: string
): Promise<TrainingPeaksWeeklyReport | null> {
  return claimTrainingPeaksWeeklyReportForSendInRepository(reportId);
}
