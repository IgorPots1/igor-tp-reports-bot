import {
  createTrainingPeaksStudent as createTrainingPeaksStudentInService,
  deleteTrainingPeaksOrphanReportByInternalId,
  deleteTrainingPeaksOrphanReportsForWeek as deleteTrainingPeaksOrphanReportsForWeekInService,
  getTrainingPeaksStudentsRegistryWithLatestReportStatus,
  getTrainingPeaksWeeklyReportByInternalId,
  setTrainingPeaksStudentWeeklyReportsEnabled as setTrainingPeaksStudentWeeklyReportsEnabledInService,
  unlinkTrainingPeaksStudentTelegram as unlinkTrainingPeaksStudentTelegramInService,
  updateTrainingPeaksWeeklyReportContentByInternalId,
  updateTrainingPeaksWeeklyReportStateByInternalId,
} from "@/features/trainingpeaks/service";
import { getFinalTrainingPeaksReportMarkdown, sendTrainingPeaksWeeklyReportToStudent } from "@/features/trainingpeaks/report-delivery";
import type { TrainingPeaksRegistryStudentSnapshot } from "@/features/trainingpeaks/service";
import {
  listAllTrainingPeaksReports,
  type TrainingPeaksWeeklyReport,
} from "@/features/trainingpeaks/repository";

export type TrainingPeaksAdminStudentsView = "active" | "archived" | "all";
export type TrainingPeaksAdminReportStatusFilter = "all" | "ready" | "sent" | "failed" | "unsent";
export type TrainingPeaksAdminTelegramFilter = "all" | "linked" | "unlinked";
export type TrainingPeaksAdminStudentStateFilter = "active" | "archived" | "orphan" | "all";

export type TrainingPeaksAdminStudentRecord = TrainingPeaksRegistryStudentSnapshot;

export type TrainingPeaksAdminReportRecord = {
  report: TrainingPeaksWeeklyReport;
  student: TrainingPeaksRegistryStudentSnapshot | null;
  finalReportMarkdown: string | null;
  isStudentActive: boolean;
  isStudentArchived: boolean;
  isTelegramLinked: boolean;
  canSend: boolean;
  sendBlockedReason: string | null;
};

export type TrainingPeaksAdminReportsResult = {
  reports: TrainingPeaksAdminReportRecord[];
  availableWeeks: string[];
  selectedWeek: string | null;
  summary: {
    totalReports: number;
    readyToSend: number;
    sent: number;
    errors: number;
    withoutTelegram: number;
  };
};

export {
  createTrainingPeaksStudentInService as createTrainingPeaksStudent,
  deleteTrainingPeaksOrphanReportsForWeekInService as deleteTrainingPeaksOrphanReportsForWeek,
  setTrainingPeaksStudentWeeklyReportsEnabledInService as setTrainingPeaksStudentWeeklyReportsEnabled,
  unlinkTrainingPeaksStudentTelegramInService as unlinkTrainingPeaksStudentTelegram,
};

export {
  bindTrainingPeaksAdminStudentTelegramByBusinessChat,
  bindTrainingPeaksAdminStudentTelegramByUsername,
  createTrainingPeaksAdminStudentTelegramLinkCode,
  formatTrainingPeaksAdminLinkCodeExpiresAt,
  formatTrainingPeaksAdminTelegramChatName,
  findTrainingPeaksAdminBusinessChatsByUsername,
  getTrainingPeaksAdminStudentLastKnownBusinessChat,
  listTrainingPeaksAdminRecentBusinessChats,
  normalizeTrainingPeaksAdminTelegramUsername,
  sendTrainingPeaksAdminStudentTelegramTestMessage,
  shortenTrainingPeaksAdminChatId,
  TRAININGPEAKS_ADMIN_TELEGRAM_USERNAME_NOT_FOUND_MESSAGE,
} from "@/features/trainingpeaks/admin-telegram";

function getSendBlockedReason(
  report: TrainingPeaksWeeklyReport,
  student: TrainingPeaksRegistryStudentSnapshot | null,
  finalReportMarkdown: string | null
): string | null {
  if (!finalReportMarkdown) {
    return "Нет текста отчёта";
  }

  if (report.reviewStatus === "sent") {
    return "Уже отправлен";
  }

  if (!student) {
    return "Нет в реестре";
  }

  if (!student.isActive) {
    return "Ученик архивирован";
  }

  if (!student.weeklyReportEnabled) {
    return "Еженедельные отчёты отключены";
  }

  if (!student.telegramChatId) {
    return "Telegram не привязан";
  }

  if (!student.telegramDeliveryEnabled) {
    return "Доставка отключена";
  }

  return null;
}

function createReportRecord(
  report: TrainingPeaksWeeklyReport,
  student: TrainingPeaksRegistryStudentSnapshot | null
): TrainingPeaksAdminReportRecord {
  const finalReportMarkdown = getFinalTrainingPeaksReportMarkdown(report);
  const isStudentActive = student?.isActive === true;
  const isTelegramLinked = Boolean(student?.telegramChatId);
  const sendBlockedReason = getSendBlockedReason(report, student, finalReportMarkdown);

  return {
    report,
    student,
    finalReportMarkdown,
    isStudentActive,
    isStudentArchived: student ? !student.isActive : false,
    isTelegramLinked,
    canSend: sendBlockedReason === null,
    sendBlockedReason,
  };
}

function getReportWeekValue(report: Pick<TrainingPeaksWeeklyReport, "weekFrom" | "weekTo">): string {
  return `${report.weekFrom}..${report.weekTo}`;
}

function resolveSelectedWeek(
  requestedWeek: string | null | undefined,
  availableWeeks: string[]
): string | null {
  if (!requestedWeek) {
    return availableWeeks[0] ?? null;
  }

  if (availableWeeks.includes(requestedWeek)) {
    return requestedWeek;
  }

  const matchedByWeekFrom = availableWeeks.find((weekValue) => weekValue.startsWith(`${requestedWeek}..`));
  return matchedByWeekFrom ?? availableWeeks[0] ?? null;
}

function isReportSent(record: TrainingPeaksAdminReportRecord): boolean {
  return record.report.reviewStatus === "sent" || Boolean(record.report.sentAt);
}

function hasReportDeliveryError(record: TrainingPeaksAdminReportRecord): boolean {
  return record.report.reviewStatus === "failed" || Boolean(record.report.deliveryError);
}

function isTelegramUnavailable(record: TrainingPeaksAdminReportRecord): boolean {
  return !record.student?.telegramChatId;
}

function matchesReportStatusFilter(
  record: TrainingPeaksAdminReportRecord,
  filter: TrainingPeaksAdminReportStatusFilter
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "ready") {
    return record.canSend;
  }

  if (filter === "sent") {
    return isReportSent(record);
  }

  if (filter === "failed") {
    return hasReportDeliveryError(record);
  }

  return !isReportSent(record);
}

function matchesTelegramFilter(
  record: TrainingPeaksAdminReportRecord,
  filter: TrainingPeaksAdminTelegramFilter
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "linked") {
    return record.isTelegramLinked;
  }

  return !record.isTelegramLinked;
}

function matchesStudentStateFilter(
  record: TrainingPeaksAdminReportRecord,
  filter: TrainingPeaksAdminStudentStateFilter
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "orphan") {
    return record.student === null;
  }

  if (filter === "archived") {
    return record.isStudentArchived;
  }

  return record.isStudentActive;
}

function normalizeReportStatusFilter(
  value: string | null | undefined
): TrainingPeaksAdminReportStatusFilter {
  switch (value) {
    case "ready":
    case "sent":
    case "failed":
    case "unsent":
    case "all":
      return value;
    default:
      return "all";
  }
}

function normalizeTelegramFilter(
  value: string | null | undefined
): TrainingPeaksAdminTelegramFilter {
  switch (value) {
    case "linked":
    case "unlinked":
    case "all":
      return value;
    default:
      return "all";
  }
}

function normalizeStudentStateFilter(
  value: string | null | undefined
): TrainingPeaksAdminStudentStateFilter {
  switch (value) {
    case "active":
    case "archived":
    case "orphan":
    case "all":
      return value;
    default:
      return "active";
  }
}

function normalizeReportMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export type TrainingPeaksAdminWeeklyReportRoster = {
  inGeneration: TrainingPeaksAdminStudentRecord[];
  activeReportsDisabled: TrainingPeaksAdminStudentRecord[];
  archived: TrainingPeaksAdminStudentRecord[];
};

export async function listTrainingPeaksAdminWeeklyReportRoster(): Promise<TrainingPeaksAdminWeeklyReportRoster> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus({
    includeArchived: true,
  });

  const inGeneration: TrainingPeaksAdminStudentRecord[] = [];
  const activeReportsDisabled: TrainingPeaksAdminStudentRecord[] = [];
  const archived: TrainingPeaksAdminStudentRecord[] = [];

  for (const student of students) {
    if (!student.isActive) {
      archived.push(student);
      continue;
    }

    if (student.weeklyReportEnabled) {
      inGeneration.push(student);
      continue;
    }

    activeReportsDisabled.push(student);
  }

  return { inGeneration, activeReportsDisabled, archived };
}

export async function listTrainingPeaksAdminStudents(
  view: TrainingPeaksAdminStudentsView = "active"
): Promise<TrainingPeaksAdminStudentRecord[]> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus({
    includeArchived: view !== "active",
  });

  if (view === "archived") {
    return students.filter((student) => !student.isActive);
  }

  if (view === "all") {
    return students;
  }

  return students.filter((student) => student.isActive);
}

export async function listTrainingPeaksAdminReports(options?: {
  week?: string | null;
  reportStatus?: string | null;
  telegramStatus?: string | null;
  studentState?: string | null;
}): Promise<TrainingPeaksAdminReportsResult> {
  const [reports, students] = await Promise.all([
    listAllTrainingPeaksReports(),
    getTrainingPeaksStudentsRegistryWithLatestReportStatus({
      includeArchived: true,
    }),
  ]);
  const studentByStudentId = new Map(students.map((student) => [student.studentId, student] as const));
  const availableWeeks = Array.from(
    new Set(reports.map((report) => getReportWeekValue(report)))
  );
  const selectedWeek = resolveSelectedWeek(options?.week, availableWeeks);
  const normalizedReportStatus = normalizeReportStatusFilter(options?.reportStatus);
  const normalizedTelegramStatus = normalizeTelegramFilter(options?.telegramStatus);
  const normalizedStudentState = normalizeStudentStateFilter(options?.studentState);
  const records = reports.map((report) =>
    createReportRecord(report, studentByStudentId.get(report.studentId) ?? null)
  );

  const filteredReports = records.filter((record) => {
    if (selectedWeek && getReportWeekValue(record.report) !== selectedWeek) {
      return false;
    }

    if (!matchesReportStatusFilter(record, normalizedReportStatus)) {
      return false;
    }

    if (!matchesTelegramFilter(record, normalizedTelegramStatus)) {
      return false;
    }

    if (!matchesStudentStateFilter(record, normalizedStudentState)) {
      return false;
    }

    return true;
  });

  return {
    reports: filteredReports,
    availableWeeks,
    selectedWeek,
    summary: {
      totalReports: filteredReports.length,
      readyToSend: filteredReports.filter((record) => record.canSend).length,
      sent: filteredReports.filter((record) => isReportSent(record)).length,
      errors: filteredReports.filter((record) => hasReportDeliveryError(record)).length,
      withoutTelegram: filteredReports.filter((record) => isTelegramUnavailable(record)).length,
    },
  };
}

export function getTrainingPeaksAdminReportStudentState(
  record: Pick<TrainingPeaksAdminReportRecord, "student" | "isStudentActive" | "isStudentArchived">
): TrainingPeaksAdminStudentStateFilter {
  if (!record.student) {
    return "orphan";
  }

  if (record.isStudentArchived) {
    return "archived";
  }

  return "active";
}

export async function getTrainingPeaksAdminReportById(
  reportId: string
): Promise<TrainingPeaksAdminReportRecord | null> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    return null;
  }

  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus({
    includeArchived: true,
  });
  return createReportRecord(
    report,
    students.find((student) => student.studentId === report.studentId) ?? null
  );
}

export async function getTrainingPeaksAdminStudentById(
  studentId: string
): Promise<TrainingPeaksAdminStudentRecord | null> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus({
    includeArchived: true,
  });

  return students.find((student) => student.id === studentId) ?? null;
}

export async function listTrainingPeaksAdminReportsForStudent(
  studentId: string
): Promise<TrainingPeaksAdminReportRecord[]> {
  const reports = await listAllTrainingPeaksReports();
  const student = await getTrainingPeaksAdminStudentById(studentId);

  if (!student) {
    return [];
  }

  return reports
    .filter((report) => report.studentId === student.studentId)
    .map((report) => createReportRecord(report, student));
}

export async function saveTrainingPeaksAdminReportEdit(
  reportId: string,
  nextMarkdown: string
): Promise<
  | { ok: true; report: TrainingPeaksWeeklyReport }
  | { ok: false; message: string }
> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    return {
      ok: false,
      message: "Отчёт не найден.",
    };
  }

  if (report.reviewStatus === "sent") {
    return {
      ok: false,
      message: "Отправленный отчёт нельзя редактировать в v1.",
    };
  }

  const normalizedMarkdown = normalizeReportMarkdown(nextMarkdown);

  if (!normalizedMarkdown) {
    return {
      ok: false,
      message: "Текст отчёта не может быть пустым.",
    };
  }

  const generatedMarkdown = report.reportMarkdown?.trim();
  if (!generatedMarkdown) {
    return {
      ok: false,
      message: "В отчёте нет исходного сгенерированного текста.",
    };
  }

  const editedReportMarkdown = normalizedMarkdown === generatedMarkdown ? null : normalizedMarkdown;
  const editedAt = editedReportMarkdown ? new Date().toISOString() : null;
  const updatedReport = await updateTrainingPeaksWeeklyReportContentByInternalId(reportId, {
    editedReportMarkdown,
    editedAt,
  });

  if (!updatedReport) {
    return {
      ok: false,
      message: "Отчёт не найден.",
    };
  }

  await updateTrainingPeaksWeeklyReportStateByInternalId(reportId, {
    reviewStatus: "draft",
    approvedAt: null,
    sentAt: null,
    sentToChatId: null,
    deliveryError: null,
  });

  const refreshedReport = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  return {
    ok: true,
    report: refreshedReport ?? updatedReport,
  };
}

export async function deleteTrainingPeaksAdminOrphanReport(reportId: string): Promise<
  | { ok: true; report: TrainingPeaksWeeklyReport }
  | { ok: false; message: string }
> {
  return deleteTrainingPeaksOrphanReportByInternalId(reportId);
}

export { sendTrainingPeaksWeeklyReportToStudent };
