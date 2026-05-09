import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";
import {
  claimTrainingPeaksWeeklyReportForSend,
  getTrainingPeaksStudentByStudentId,
  getTrainingPeaksWeeklyReportByInternalId,
  updateTrainingPeaksWeeklyReportStateByInternalId,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksWeeklyReport } from "@/features/trainingpeaks/repository";

const TELEGRAM_MESSAGE_LIMIT = 4000;

export type SendTrainingPeaksWeeklyReportResult =
  | {
      ok: true;
      reportId: string;
      studentName: string;
      deliveredChunks: number;
      usedEditedReport: boolean;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "already_sent"
        | "student_missing"
        | "student_inactive"
        | "telegram_not_linked"
        | "missing_business_connection"
        | "missing_report_markdown"
        | "state_conflict"
        | "delivery_failed";
      message: string;
      studentName?: string | null;
    };

function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalizedText = text.trim();

  if (normalizedText.length <= limit) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let rest = normalizedText;

  while (rest.length > 0) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n\n", limit);
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf("\n", limit);
    }
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf(" ", limit);
    }
    if (boundary <= 0) {
      boundary = limit;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

export function shortenTrainingPeaksDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Неизвестная ошибка доставки в Telegram";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function getFinalTrainingPeaksReportMarkdown(
  report: Pick<TrainingPeaksWeeklyReport, "reportMarkdown" | "editedReportMarkdown">
): string | null {
  const edited = report.editedReportMarkdown?.trim();
  if (edited) {
    return edited;
  }

  const generated = report.reportMarkdown?.trim();
  return generated || null;
}

function getRequiredBusinessConnectionId(): string {
  const value = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

  if (!value) {
    throw new Error("Не настроен TELEGRAM_BUSINESS_CONNECTION_ID.");
  }

  return value;
}

async function sendTelegramBusinessReport(
  chatId: string,
  text: string,
  businessConnectionId: string
): Promise<number> {
  const chunks = splitTelegramMessage(text);

  for (const [index, chunk] of chunks.entries()) {
    try {
      await sendTelegramMessageStrict(chatId, chunk, {
        businessConnectionId,
      });
    } catch (error) {
      throw new Error(
        `Не удалось отправить часть ${index + 1} из ${chunks.length}: ${shortenTrainingPeaksDeliveryError(error)}`
      );
    }
  }

  return chunks.length;
}

async function markReportDeliveryFailed(reportId: string, message: string): Promise<void> {
  await updateTrainingPeaksWeeklyReportStateByInternalId(reportId, {
    reviewStatus: "failed",
    deliveryError: message,
  });
}

export async function sendTrainingPeaksWeeklyReportToStudent(
  reportId: string
): Promise<SendTrainingPeaksWeeklyReportResult> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    return {
      ok: false,
      reason: "not_found",
      message: "Отчёт не найден.",
    };
  }

  if (report.reviewStatus === "sent") {
    return {
      ok: false,
      reason: "already_sent",
      message: `Отчёт уже отправлен ученику: ${report.studentName}.`,
      studentName: report.studentName,
    };
  }

  const student = await getTrainingPeaksStudentByStudentId(report.studentId);

  if (!student) {
    const message = "Не могу отправить: ученик не найден в Supabase.";
    await markReportDeliveryFailed(report.id, message);
    return {
      ok: false,
      reason: "student_missing",
      message,
      studentName: report.studentName,
    };
  }

  if (!student.isActive) {
    const message = "Не могу отправить: ученик архивирован или отключён.";
    await markReportDeliveryFailed(report.id, message);
    return {
      ok: false,
      reason: "student_inactive",
      message,
      studentName: student.studentName,
    };
  }

  if (!student.telegramDeliveryEnabled || !student.telegramChatId) {
    const message = "У ученика не подключена доставка отчётов в Telegram.";
    await markReportDeliveryFailed(report.id, message);
    return {
      ok: false,
      reason: "telegram_not_linked",
      message,
      studentName: student.studentName,
    };
  }

  const claimedReport = await claimTrainingPeaksWeeklyReportForSend(report.id);

  if (!claimedReport) {
    const currentReport = await getTrainingPeaksWeeklyReportByInternalId(report.id);
    if (currentReport?.reviewStatus === "sent") {
      return {
        ok: false,
        reason: "already_sent",
        message: `Отчёт уже отправлен ученику: ${student.studentName}.`,
        studentName: student.studentName,
      };
    }

    return {
      ok: false,
      reason: "state_conflict",
      message: `Отчёт сейчас нельзя отправить из-за текущего статуса: ${currentReport?.reviewStatus ?? report.reviewStatus}.`,
      studentName: student.studentName,
    };
  }

  const persistedReport = await getTrainingPeaksWeeklyReportByInternalId(claimedReport.id);
  const finalReportMarkdown = getFinalTrainingPeaksReportMarkdown(persistedReport ?? claimedReport);

  if (!finalReportMarkdown) {
    const message = "В сохранённом отчёте нет текста для отправки.";
    await markReportDeliveryFailed(claimedReport.id, message);
    return {
      ok: false,
      reason: "missing_report_markdown",
      message,
      studentName: student.studentName,
    };
  }

  let businessConnectionId: string;

  try {
    businessConnectionId = getRequiredBusinessConnectionId();
  } catch (error) {
    const message = shortenTrainingPeaksDeliveryError(error);
    await markReportDeliveryFailed(claimedReport.id, message);
    return {
      ok: false,
      reason: "missing_business_connection",
      message,
      studentName: student.studentName,
    };
  }

  try {
    const deliveredChunks = await sendTelegramBusinessReport(
      student.telegramChatId,
      finalReportMarkdown,
      businessConnectionId
    );

    await updateTrainingPeaksWeeklyReportStateByInternalId(claimedReport.id, {
      reviewStatus: "sent",
      sentAt: new Date().toISOString(),
      sentToChatId: student.telegramChatId,
      deliveryError: null,
    });

    return {
      ok: true,
      reportId: claimedReport.id,
      studentName: student.studentName,
      deliveredChunks,
      usedEditedReport: Boolean(persistedReport?.editedReportMarkdown?.trim()),
    };
  } catch (error) {
    const message = shortenTrainingPeaksDeliveryError(error);
    await markReportDeliveryFailed(claimedReport.id, message);
    return {
      ok: false,
      reason: "delivery_failed",
      message,
      studentName: student.studentName,
    };
  }
}
