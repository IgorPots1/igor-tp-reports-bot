import {
  createTrainingPeaksStudent as createTrainingPeaksStudentInService,
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
};

export {
  createTrainingPeaksStudentInService as createTrainingPeaksStudent,
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

function normalizeReportMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
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
  reviewStatus?: string | null;
}): Promise<TrainingPeaksAdminReportsResult> {
  const [reports, students] = await Promise.all([
    listAllTrainingPeaksReports(),
    getTrainingPeaksStudentsRegistryWithLatestReportStatus({
      includeArchived: true,
    }),
  ]);
  const studentByStudentId = new Map(students.map((student) => [student.studentId, student] as const));
  const availableWeeks = Array.from(
    new Set(reports.map((report) => `${report.weekFrom}..${report.weekTo}`))
  );

  const filteredReports = reports.filter((report) => {
    if (options?.week && `${report.weekFrom}..${report.weekTo}` !== options.week) {
      return false;
    }

    if (options?.reviewStatus && report.reviewStatus !== options.reviewStatus) {
      return false;
    }

    return true;
  });

  const records = filteredReports.map((report) =>
    createReportRecord(report, studentByStudentId.get(report.studentId) ?? null)
  );

  return {
    reports: records,
    availableWeeks,
  };
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

export { sendTrainingPeaksWeeklyReportToStudent };
