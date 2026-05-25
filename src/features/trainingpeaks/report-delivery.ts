import {
  claimTrainingPeaksWeeklyReportForSend,
  getTrainingPeaksStudentByStudentId,
  getTrainingPeaksWeeklyReportByInternalId,
  updateTrainingPeaksWeeklyReportStateByInternalId,
} from "@/features/trainingpeaks/service";
import {
  recordTrainingPeaksStudentContactEvent,
  type TrainingPeaksWeeklyReport,
} from "@/features/trainingpeaks/repository";
import {
  getRequiredTrainingPeaksBusinessConnectionId,
  sendTrainingPeaksTelegramBusinessMessage,
  shortenTrainingPeaksTelegramDeliveryError,
} from "@/features/trainingpeaks/telegram-business";

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
        | "weekly_reports_disabled"
        | "telegram_not_linked"
        | "delivery_disabled"
        | "missing_business_connection"
        | "missing_report_markdown"
        | "state_conflict"
        | "delivery_failed";
      message: string;
      studentName?: string | null;
    };

export const shortenTrainingPeaksDeliveryError = shortenTrainingPeaksTelegramDeliveryError;

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

  if (!student.weeklyReportEnabled) {
    const message = "У ученика отключены еженедельные отчёты.";
    await markReportDeliveryFailed(report.id, message);
    return {
      ok: false,
      reason: "weekly_reports_disabled",
      message,
      studentName: student.studentName,
    };
  }

  if (!student.telegramChatId) {
    const message = "У ученика не привязан Telegram.";
    await markReportDeliveryFailed(report.id, message);
    return {
      ok: false,
      reason: "telegram_not_linked",
      message,
      studentName: student.studentName,
    };
  }

  if (!student.telegramDeliveryEnabled) {
    const message = "У ученика отключена доставка отчётов.";
    await markReportDeliveryFailed(report.id, message);
    return {
      ok: false,
      reason: "delivery_disabled",
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
    businessConnectionId = getRequiredTrainingPeaksBusinessConnectionId();
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
    const deliveredChunks = await sendTrainingPeaksTelegramBusinessMessage(
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

    try {
      await recordTrainingPeaksStudentContactEvent({
        studentId: student.id,
        eventType: "report_sent",
        source: "admin_report_send",
        referenceId: claimedReport.id,
        metadata: {
          report_id: claimedReport.id,
          telegram_chat_id: student.telegramChatId,
          delivered_chunks: deliveredChunks,
          used_edited_report: Boolean(persistedReport?.editedReportMarkdown?.trim()),
        },
      });
    } catch (contactError) {
      console.warn("Failed to record TrainingPeaks report_sent contact event", {
        reportId: claimedReport.id,
        studentId: student.id,
        error: contactError,
      });
    }

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
