import {
  approveTrainingPeaksAction as approveTrainingPeaksActionInRepository,
  approveTrainingPeaksWeeklyReportIfDraft,
  cancelQueuedTrainingPeaksJob,
  claimTrainingPeaksWeeklyReportForSend as claimTrainingPeaksWeeklyReportForSendInRepository,
  createTrainingPeaksAction as createTrainingPeaksActionInRepository,
  createTrainingPeaksWeeklyJob,
  deleteTrainingPeaksOrphanReportsForWeek as deleteTrainingPeaksOrphanReportsForWeekInRepository,
  deleteTrainingPeaksWeeklyReportById,
  disableTrainingPeaksStudentById,
  enableTrainingPeaksStudentById,
  expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent,
  expireTrainingPeaksStudentTelegramLinkCodesByIds,
  findActiveTrainingPeaksJobForWeek,
  getTrainingPeaksJobById,
  getTrainingPeaksBusinessChatById,
  getTrainingPeaksStudentById as getTrainingPeaksStudentByIdFromRepository,
  getTrainingPeaksStudentByStudentId as getTrainingPeaksStudentByStudentIdFromRepository,
  getTrainingPeaksStudentByTelegramChatId as getTrainingPeaksStudentByTelegramChatIdFromRepository,
  getTrainingPeaksWeeklyReportById,
  recoverStaleTrainingPeaksRunningJobs,
  insertTrainingPeaksStudent,
  insertTrainingPeaksStudentTelegramLinkCode,
  linkTrainingPeaksStudentToBusinessChat as linkTrainingPeaksStudentToBusinessChatInRepository,
  listAllTrainingPeaksReports,
  listTrainingPeaksBusinessChatsByUsername as listTrainingPeaksBusinessChatsByUsernameFromRepository,
  listRecentTrainingPeaksBusinessChats as listRecentTrainingPeaksBusinessChatsFromRepository,
  listTrainingPeaksStudentTelegramLinkCodesByCode,
  listRecentTrainingPeaksJobs,
  listTrainingPeaksStudents,
  listTrainingPeaksStudentsIncludingArchived,
  markTrainingPeaksStudentTelegramLinkCodeUsed,
  rejectTrainingPeaksAction as rejectTrainingPeaksActionInRepository,
  setTrainingPeaksStudentWeeklyReportsEnabledById,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type DecideTrainingPeaksActionResult,
  type TrainingPeaksBusinessChat,
  type TrainingPeaksAction,
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
import type { TelegramMessage } from "@/features/telegram/types";
import { resolveTrainingPeaksWeekKeyword } from "@/features/trainingpeaks/week";
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

export type TrainingPeaksMoveWorkoutTarget =
  | { kind: "relative_day"; value: "tomorrow" | "day_after_tomorrow"; sourceText: string }
  | {
      kind: "weekday";
      value: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
      sourceText: string;
    };

export type ParsedTrainingPeaksMoveWorkoutPayload = {
  actionType: "move_workout";
  target: TrainingPeaksMoveWorkoutTarget;
};

export type ParseTrainingPeaksMoveWorkoutResult =
  | { ok: true; payload: ParsedTrainingPeaksMoveWorkoutPayload; confidence: "high" }
  | { ok: false; reason: "not_move_request" | "no_target_day" | "ambiguous_target_day" };

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
      reason: "student_not_found" | "not_move_request" | "no_target_day" | "ambiguous_target_day" | "empty_text";
    };

export type DecideTrainingPeaksActionInput = {
  actionId: string;
  decidedByChatId: string;
  decidedByUserId?: string | null;
  decisionMessageId?: string | null;
};

export type DecideTrainingPeaksActionResultSnapshot = DecideTrainingPeaksActionResult;

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

const TP_ADD_STUDENT_COMMAND_PATTERN = /^\/tp_add_student(?:@\w+)?(?:\s+|$)/;
const TP_RUN_WEEK_COMMAND_PATTERN = /^\/tp_run_week(?:@\w+)?(?:\s+|$)/;
const TP_TELEGRAM_LINK_CODE_PATTERN = /\b[A-Z0-9]{2,12}-\d{3,6}\b/gi;
const TP_TELEGRAM_LINK_CODE_DEFAULT_TTL_HOURS = 24;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TP_MOVE_WORKOUT_VERBS = ["перенеси", "перенести", "передвинь", "сдвинь"];
const TP_MOVE_WORKOUT_OBJECTS = ["тренировку", "тренировка", "бег", "занятие", "занятия"];
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

function parseTrainingPeaksMoveWorkoutRequest(
  rawText: string
): ParseTrainingPeaksMoveWorkoutResult {
  const normalized = normalizeRussianText(rawText);

  if (!normalized) {
    return { ok: false, reason: "not_move_request" };
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const hasMoveVerb = TP_MOVE_WORKOUT_VERBS.some((verb) => tokens.includes(verb));
  const hasWorkoutObject = TP_MOVE_WORKOUT_OBJECTS.some((item) => tokens.includes(item));

  if (!hasMoveVerb || !hasWorkoutObject) {
    return { ok: false, reason: "not_move_request" };
  }

  const dayTokenMatchers: { testToken: RegExp; target: TrainingPeaksMoveWorkoutTarget }[] = [
    {
      testToken: /^послезавтра$/,
      target: { kind: "relative_day", value: "day_after_tomorrow", sourceText: "послезавтра" },
    },
    {
      testToken: /^завтра$/,
      target: { kind: "relative_day", value: "tomorrow", sourceText: "завтра" },
    },
    {
      testToken: /^понедельник(?:а|у|ом|е)?$/,
      target: { kind: "weekday", value: "monday", sourceText: "понедельник" },
    },
    {
      testToken: /^вторник(?:а|у|ом|е)?$/,
      target: { kind: "weekday", value: "tuesday", sourceText: "вторник" },
    },
    {
      testToken: /^сред(?:а|у|е|ой)$/,
      target: { kind: "weekday", value: "wednesday", sourceText: "среда" },
    },
    {
      testToken: /^четверг(?:а|у|ом|е)?$/,
      target: { kind: "weekday", value: "thursday", sourceText: "четверг" },
    },
    {
      testToken: /^пятниц(?:а|у|е|ей)$/,
      target: { kind: "weekday", value: "friday", sourceText: "пятница" },
    },
    {
      testToken: /^суббот(?:а|у|е|ой)$/,
      target: { kind: "weekday", value: "saturday", sourceText: "суббота" },
    },
    {
      testToken: /^воскресень(?:е|я|ю|ем)$/,
      target: { kind: "weekday", value: "sunday", sourceText: "воскресенье" },
    },
  ];

  const matchedTargets = dayTokenMatchers
    .filter(({ testToken }) => tokens.some((token) => testToken.test(token)))
    .map(({ target }) => target);

  if (matchedTargets.length === 0) {
    return { ok: false, reason: "no_target_day" };
  }

  const uniqueTargets = new Map<string, TrainingPeaksMoveWorkoutTarget>();
  for (const target of matchedTargets) {
    const key = `${target.kind}:${target.value}`;
    if (!uniqueTargets.has(key)) {
      uniqueTargets.set(key, target);
    }
  }

  if (uniqueTargets.size !== 1) {
    return { ok: false, reason: "ambiguous_target_day" };
  }

  const target = Array.from(uniqueTargets.values())[0]!;
  return {
    ok: true,
    payload: {
      actionType: "move_workout",
      target,
    },
    confidence: "high",
  };
}

function formatTrainingPeaksMoveWorkoutTargetSummary(target: TrainingPeaksMoveWorkoutTarget): string {
  if (target.kind === "relative_day") {
    return target.value === "tomorrow" ? "на завтра" : "на послезавтра";
  }

  const weekdayLabelByValue: Record<TrainingPeaksMoveWorkoutTarget["value"], string> = {
    monday: "на понедельник",
    tuesday: "на вторник",
    wednesday: "на среду",
    thursday: "на четверг",
    friday: "на пятницу",
    saturday: "на субботу",
    sunday: "на воскресенье",
    tomorrow: "на завтра",
    day_after_tomorrow: "на послезавтра",
  };

  return weekdayLabelByValue[target.value];
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

function parseTrainingPeaksWeekRange(rawInput: string):
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

export async function requestTrainingPeaksWeeklyRun(
  rawInput: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksWeeklyRunResult> {
  const parsedInput = parseTrainingPeaksWeekRange(rawInput);

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
        activeJob: activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status,
              weekFrom: activeJob.weekFrom,
              weekTo: activeJob.weekTo,
            }
          : null,
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

  const parsed = parseTrainingPeaksMoveWorkoutRequest(trimmedText);
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
    confidence: parsed.confidence,
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

export async function recoverStaleTrainingPeaksJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobs(timeoutMinutes);
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
