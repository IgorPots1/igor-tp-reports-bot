import {
  approveTrainingPeaksWeeklyReportIfDraft,
  cancelQueuedTrainingPeaksJob,
  claimTrainingPeaksWeeklyReportForSend as claimTrainingPeaksWeeklyReportForSendInRepository,
  createTrainingPeaksWeeklyJob,
  disableTrainingPeaksStudentById,
  enableTrainingPeaksStudentById,
  findActiveTrainingPeaksJobForWeek,
  getTrainingPeaksJobById,
  getTrainingPeaksBusinessChatById,
  getTrainingPeaksStudentById as getTrainingPeaksStudentByIdFromRepository,
  getTrainingPeaksWeeklyReportById,
  recoverStaleTrainingPeaksRunningJobs,
  insertTrainingPeaksStudent,
  linkTrainingPeaksStudentToBusinessChat as linkTrainingPeaksStudentToBusinessChatInRepository,
  listAllTrainingPeaksReports,
  listRecentTrainingPeaksBusinessChats as listRecentTrainingPeaksBusinessChatsFromRepository,
  listRecentTrainingPeaksJobs,
  listTrainingPeaksStudents,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type TrainingPeaksBusinessChat,
  TrainingPeaksJobConflictError,
  TrainingPeaksStudentConflictError,
  type TrainingPeaksJob,
  type TrainingPeaksStudent,
  type TrainingPeaksWeek,
  type TrainingPeaksWeeklyReport,
  upsertTrainingPeaksBusinessChatFromMessage as upsertTrainingPeaksBusinessChatFromMessageInRepository,
  type UpdateTrainingPeaksStudentTelegramContactInput,
  type UpdateTrainingPeaksStudentTelegramContactParams,
  type UpdateTrainingPeaksWeeklyReportStateInput,
  type UpdateTrainingPeaksWeeklyReportReviewStateInput,
  updateTrainingPeaksStudentTelegramContact as updateTrainingPeaksStudentTelegramContactInRepository,
  updateTrainingPeaksStudentTelegramContactById,
  updateTrainingPeaksWeeklyReportReviewState as updateTrainingPeaksWeeklyReportReviewStateInRepository,
  updateTrainingPeaksWeeklyReportStateById,
} from "@/features/trainingpeaks/repository";
import type { TelegramMessage } from "@/features/telegram/types";
import { resolveTrainingPeaksWeekKeyword } from "@/features/trainingpeaks/week";

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
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramProfileUrl: string | null;
  telegramDeliveryEnabled: boolean;
  dataQualityStatus: string | null;
  notes: string | null;
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

export type TrainingPeaksJobRequester = {
  chatId: number | string;
  userId: number | string | null;
};

export type TrainingPeaksBusinessChatSnapshot = TrainingPeaksBusinessChat;

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
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TP_RUN_WEEK_USAGE_MESSAGE = [
  "Напиши так:",
  "/tp_run_week last",
  "или",
  "/tp_run_week 2026-04-27 2026-05-03",
].join("\n");

function normalizeStudentQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
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
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
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

export async function recoverStaleTrainingPeaksJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobs(timeoutMinutes);
}

export async function getTrainingPeaksStudentsRegistryWithLatestReportStatus(): Promise<
  TrainingPeaksRegistryStudentSnapshot[]
> {
  const [students, reports] = await Promise.all([
    listTrainingPeaksStudents(),
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
        telegramChatId: student.telegramChatId,
        telegramUsername: student.telegramUsername,
        telegramProfileUrl: student.telegramProfileUrl,
        telegramDeliveryEnabled: student.telegramDeliveryEnabled,
        dataQualityStatus: student.dataQualityStatus,
        notes: student.notes,
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
  const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(id);

  if (!existingStudent) {
    return null;
  }

  await disableTrainingPeaksStudentById(id);
  return getTrainingPeaksRegistryStudentByInternalId(id);
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
  const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(id);

  if (!existingStudent) {
    return null;
  }

  await enableTrainingPeaksStudentById(id);
  return getTrainingPeaksRegistryStudentByInternalId(id);
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
