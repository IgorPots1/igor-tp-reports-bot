import {
  getTrainingPeaksReplyDraftByIdPrefix,
  getTrainingPeaksStudentById,
  insertTrainingPeaksCoachActionTaken,
  markTrainingPeaksReplyDraftSendOutcome,
  recordTrainingPeaksStudentContactEvent,
  updateTrainingPeaksReplyDraftOutcome,
} from "@/features/trainingpeaks/repository";
import {
  getRequiredTrainingPeaksBusinessConnectionId,
  isTrainingPeaksTelegramBusinessPeerMissingError,
  sendTrainingPeaksTelegramBusinessMessage,
  shortenTrainingPeaksTelegramDeliveryError,
} from "@/features/trainingpeaks/telegram-business";

export type SendTrainingPeaksReplyDraftResult =
  | {
      kind: "sent";
      draftId: string;
      studentName: string;
      deliveredChunks: number;
    }
  | {
      kind:
        | "not_found"
        | "already_final"
        | "missing_draft_text"
        | "student_missing"
        | "student_inactive"
        | "telegram_not_linked"
        | "delivery_disabled"
        | "missing_business_connection"
        | "peer_usage_missing"
        | "delivery_failed"
        | "state_conflict";
      message: string;
      outcome?: "used" | "edited" | "ignored";
      studentName?: string | null;
      errorPreview?: string;
    };

function safeErrorClass(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name.trim().slice(0, 80);
  }
  return "Error";
}

export async function sendTrainingPeaksReplyDraftToStudent(input: {
  draftId: string;
  actorTelegramChatId: string;
}): Promise<SendTrainingPeaksReplyDraftResult> {
  const draft = await getTrainingPeaksReplyDraftByIdPrefix(input.draftId);
  if (!draft) {
    return {
      kind: "not_found",
      message: "Черновик не найден.",
    };
  }

  if (draft.outcome !== "generated") {
    return {
      kind: "already_final",
      outcome: draft.outcome,
      message: "Черновик уже обработан.",
    };
  }

  const draftText = draft.draftText?.trim() ?? "";
  if (!draftText) {
    return {
      kind: "missing_draft_text",
      message: "У черновика нет текста для отправки.",
    };
  }

  const student = await getTrainingPeaksStudentById(draft.studentId);
  if (!student) {
    return {
      kind: "student_missing",
      message: "Ученик не найден в базе.",
    };
  }

  if (!student.isActive) {
    return {
      kind: "student_inactive",
      message: "Ученик архивирован или отключён.",
      studentName: student.studentName,
    };
  }

  if (!student.telegramChatId) {
    return {
      kind: "telegram_not_linked",
      message: "У ученика не привязан Telegram.",
      studentName: student.studentName,
    };
  }

  if (!student.telegramDeliveryEnabled) {
    return {
      kind: "delivery_disabled",
      message: "У ученика отключена Telegram-доставка.",
      studentName: student.studentName,
    };
  }

  let businessConnectionId: string;
  try {
    businessConnectionId = getRequiredTrainingPeaksBusinessConnectionId();
  } catch (error) {
    return {
      kind: "missing_business_connection",
      message: shortenTrainingPeaksTelegramDeliveryError(error),
      studentName: student.studentName,
    };
  }

  const claimedDraft = await updateTrainingPeaksReplyDraftOutcome({
    draftId: draft.id,
    outcome: "used",
  });
  if (!claimedDraft) {
    const reloaded = await getTrainingPeaksReplyDraftByIdPrefix(draft.id);
    if (reloaded && reloaded.outcome !== "generated") {
      return {
        kind: "already_final",
        outcome: reloaded.outcome,
        message: "Черновик уже обработан.",
        studentName: student.studentName,
      };
    }
    return {
      kind: "state_conflict",
      message: "Черновик сейчас нельзя отправить из-за конфликта состояния.",
      studentName: student.studentName,
    };
  }

  try {
    const deliveredChunks = await sendTrainingPeaksTelegramBusinessMessage(
      student.telegramChatId,
      draftText,
      businessConnectionId
    );

    await markTrainingPeaksReplyDraftSendOutcome({
      draftId: claimedDraft.id,
      sendStatus: "sent",
      deliveredChunks,
      actorTelegramChatId: input.actorTelegramChatId,
    });

    await insertTrainingPeaksCoachActionTaken({
      caseId: claimedDraft.caseId,
      studentId: claimedDraft.studentId,
      actionKind: "reply_draft_used",
      source: "telegram_command",
      actorTelegramChatId: input.actorTelegramChatId,
      metadata: {
        delivery: "sent",
        draft_id: claimedDraft.id,
        ...(claimedDraft.metadata.origin !== undefined
          ? { origin: claimedDraft.metadata.origin }
          : {}),
      },
    });

    await recordTrainingPeaksStudentContactEvent({
      studentId: claimedDraft.studentId,
      eventType: "coach_message",
      source: "telegram_business_dm",
      referenceId: claimedDraft.id,
      metadata: {
        draft_short_id: claimedDraft.id.slice(0, 8),
      },
    });

    return {
      kind: "sent",
      draftId: claimedDraft.id,
      studentName: student.studentName,
      deliveredChunks,
    };
  } catch (error) {
    const message = shortenTrainingPeaksTelegramDeliveryError(error);
    const errorClass = safeErrorClass(error);

    await markTrainingPeaksReplyDraftSendOutcome({
      draftId: claimedDraft.id,
      sendStatus: "failed",
      errorClass,
      errorPreview: message,
      actorTelegramChatId: input.actorTelegramChatId,
    });

    if (isTrainingPeaksTelegramBusinessPeerMissingError(error)) {
      return {
        kind: "peer_usage_missing",
        message,
        studentName: student.studentName,
        errorPreview: message,
      };
    }

    return {
      kind: "delivery_failed",
      message,
      studentName: student.studentName,
      errorPreview: message,
    };
  }
}
