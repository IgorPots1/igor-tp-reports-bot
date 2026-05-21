import {
  getTrainingPeaksStudentThreadByChatThread,
  insertTrainingPeaksStudentThread,
  listTrainingPeaksStudentsByTelegramChatId,
  listTrainingPeaksStudentsByTelegramUsername,
  TrainingPeaksStudentThreadConflictError,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentThread,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import type { TelegramMessage } from "@/features/telegram/types";

export type TopicAutoLinkMatchMethod = "telegram_chat_id" | "telegram_username";

type TopicAutoLinkLogEvent =
  | "auto_linked"
  | "unlinked_topic_no_student_match"
  | "ambiguous_auto_link_candidate"
  | "topic_link_conflict";

export type TopicAutoLinkOutcome =
  | { kind: "skipped"; reason: "coach" | "bot" | "service" | "no_sender" | "not_group_topic" }
  | { kind: "no_match" }
  | { kind: "ambiguous"; matchMethod: TopicAutoLinkMatchMethod; candidateCount: number }
  | { kind: "conflict"; existingStudentId: string | null }
  | {
      kind: "linked";
      student: TrainingPeaksStudent;
      thread: TrainingPeaksStudentThread;
      matchMethod: TopicAutoLinkMatchMethod;
    };

const TELEGRAM_SERVICE_MESSAGE_KEYS = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
  "write_access_allowed",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
] as const;

function normalizeTelegramUsername(username: string | undefined): string | null {
  const normalized = username?.trim().replace(/^@+/, "") ?? "";
  return normalized || null;
}

function isCoachTelegramId(value: number | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return new Set(getTrainingPeaksCoachChatIds()).has(String(value));
}

function isTelegramBotSender(message: TelegramMessage): boolean {
  const rawFrom = message.from as ({ is_bot?: boolean } | undefined);
  return rawFrom?.is_bot === true;
}

function isTelegramServiceMessage(message: TelegramMessage): boolean {
  const rawMessage = message as Record<string, unknown>;
  return TELEGRAM_SERVICE_MESSAGE_KEYS.some((key) => rawMessage[key] !== undefined);
}

function logTopicAutoLinkEvent(
  event: TopicAutoLinkLogEvent,
  metadata: Record<string, unknown>
): void {
  console.info("TrainingPeaks topic auto-link", {
    event,
    ...metadata,
  });
}

export function isTopicAutoLinkEligibleMessage(message: TelegramMessage): boolean {
  const chatType = message.chat.type;

  if (chatType !== "group" && chatType !== "supergroup") {
    return false;
  }

  if (!message.is_topic_message || message.message_thread_id === undefined) {
    return false;
  }

  if (!message.from?.id) {
    return false;
  }

  if (isTelegramBotSender(message)) {
    return false;
  }

  if (isCoachTelegramId(message.from.id)) {
    return false;
  }

  if (isTelegramServiceMessage(message)) {
    return false;
  }

  return true;
}

export async function resolveConfidentStudentMatchForAutoLink(input: {
  fromId: number | undefined;
  fromUsername: string | undefined;
}): Promise<
  | { kind: "none" }
  | { kind: "one"; student: TrainingPeaksStudent; matchMethod: TopicAutoLinkMatchMethod }
  | { kind: "ambiguous"; matchMethod: TopicAutoLinkMatchMethod; candidateCount: number }
> {
  if (input.fromId !== undefined) {
    const studentsByChatId = await listTrainingPeaksStudentsByTelegramChatId(String(input.fromId));

    if (studentsByChatId.length > 1) {
      return {
        kind: "ambiguous",
        matchMethod: "telegram_chat_id",
        candidateCount: studentsByChatId.length,
      };
    }

    if (studentsByChatId.length === 1) {
      return {
        kind: "one",
        student: studentsByChatId[0]!,
        matchMethod: "telegram_chat_id",
      };
    }
  }

  const normalizedUsername = normalizeTelegramUsername(input.fromUsername);

  if (normalizedUsername) {
    const studentsByUsername = await listTrainingPeaksStudentsByTelegramUsername(normalizedUsername);

    if (studentsByUsername.length > 1) {
      return {
        kind: "ambiguous",
        matchMethod: "telegram_username",
        candidateCount: studentsByUsername.length,
      };
    }

    if (studentsByUsername.length === 1) {
      return {
        kind: "one",
        student: studentsByUsername[0]!,
        matchMethod: "telegram_username",
      };
    }
  }

  return { kind: "none" };
}

export async function tryAutoLinkTrainingPeaksTopic(
  message: TelegramMessage
): Promise<TopicAutoLinkOutcome> {
  if (!isTopicAutoLinkEligibleMessage(message)) {
    if (!message.from?.id) {
      return { kind: "skipped", reason: "no_sender" };
    }

    if (isTelegramBotSender(message)) {
      return { kind: "skipped", reason: "bot" };
    }

    if (isCoachTelegramId(message.from.id)) {
      return { kind: "skipped", reason: "coach" };
    }

    if (isTelegramServiceMessage(message)) {
      return { kind: "skipped", reason: "service" };
    }

    return { kind: "skipped", reason: "not_group_topic" };
  }

  const telegramChatId = String(message.chat.id);
  const telegramMessageThreadId = message.message_thread_id!;
  const fromId = message.from!.id;
  const fromUsername = message.from?.username ?? null;
  const safeMetadata = {
    chatId: telegramChatId,
    messageThreadId: telegramMessageThreadId,
    messageId: message.message_id,
    fromId: String(fromId),
    fromUsername,
  };

  const existingThread = await getTrainingPeaksStudentThreadByChatThread(
    telegramChatId,
    telegramMessageThreadId
  );

  if (existingThread) {
    const match = await resolveConfidentStudentMatchForAutoLink({
      fromId,
      fromUsername: message.from?.username,
    });

    if (match.kind === "one" && match.student.id === existingThread.studentId) {
      return {
        kind: "linked",
        student: match.student,
        thread: existingThread,
        matchMethod: match.matchMethod,
      };
    }

    logTopicAutoLinkEvent("topic_link_conflict", {
      ...safeMetadata,
      existingStudentId: existingThread.studentId,
      matchedStudentId: match.kind === "one" ? match.student.id : null,
    });

    return {
      kind: "conflict",
      existingStudentId: existingThread.studentId,
    };
  }

  const match = await resolveConfidentStudentMatchForAutoLink({
    fromId,
    fromUsername: message.from?.username,
  });

  if (match.kind === "none") {
    logTopicAutoLinkEvent("unlinked_topic_no_student_match", safeMetadata);
    return { kind: "no_match" };
  }

  if (match.kind === "ambiguous") {
    logTopicAutoLinkEvent("ambiguous_auto_link_candidate", {
      ...safeMetadata,
      matchMethod: match.matchMethod,
      candidateCount: match.candidateCount,
    });

    return {
      kind: "ambiguous",
      matchMethod: match.matchMethod,
      candidateCount: match.candidateCount,
    };
  }

  try {
    const thread = await insertTrainingPeaksStudentThread({
      studentId: match.student.id,
      telegramChatId,
      telegramMessageThreadId,
      chatTitle: message.chat.title ?? null,
      threadTitle: message.forum_topic_created?.name ?? message.forum_topic_edited?.name ?? null,
      linkedByUserId: `auto_link:${fromId}`,
    });

    logTopicAutoLinkEvent("auto_linked", {
      ...safeMetadata,
      studentId: match.student.id,
      studentSlug: match.student.studentId,
      matchMethod: match.matchMethod,
      threadId: thread.id,
    });

    return {
      kind: "linked",
      student: match.student,
      thread,
      matchMethod: match.matchMethod,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksStudentThreadConflictError) {
      const conflictedThread = await getTrainingPeaksStudentThreadByChatThread(
        telegramChatId,
        telegramMessageThreadId
      );

      logTopicAutoLinkEvent("topic_link_conflict", {
        ...safeMetadata,
        existingStudentId: conflictedThread?.studentId ?? null,
        matchedStudentId: match.student.id,
      });

      return {
        kind: "conflict",
        existingStudentId: conflictedThread?.studentId ?? null,
      };
    }

    throw error;
  }
}
