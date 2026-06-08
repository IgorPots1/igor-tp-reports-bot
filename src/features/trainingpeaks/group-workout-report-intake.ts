import type { TelegramMessage } from "@/features/telegram/types";
import { classifyTelegramContextLabels } from "@/features/trainingpeaks/telegram-context";
import type {
  TrainingPeaksGroupWorkoutReportIntakeStatus,
  TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";

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

export type GroupWorkoutReportSenderMatchMethod = "telegram_chat_id" | "telegram_username";

export type ResolveGroupWorkoutReportSenderResult = {
  student: TrainingPeaksStudent | null;
  matchMethod: GroupWorkoutReportSenderMatchMethod | null;
};

export type DecideGroupWorkoutReportIntakeInput = {
  message: TelegramMessage;
  featureEnabled: boolean;
  allowedChatIds: Set<string>;
  isCoachTelegramId: (value: number | undefined) => boolean;
  resolveSender: (
    fromUserId: number | undefined,
    fromUsername: string | undefined
  ) => Promise<ResolveGroupWorkoutReportSenderResult>;
  hasExistingBySourceMessage: (sourceChatId: string, sourceMessageId: string) => Promise<boolean>;
};

export type GroupWorkoutReportIntakeDecision = {
  intakeStatus: TrainingPeaksGroupWorkoutReportIntakeStatus;
  shouldPersist: boolean;
  skipReason: string | null;
  messageText: string | null;
  detectedLabels: string[];
  student: TrainingPeaksStudent | null;
  senderMatchMethod: GroupWorkoutReportSenderMatchMethod | null;
  trainingPeaksAthleteId: string | null;
};

function normalizeTelegramUsername(username: string | undefined): string | null {
  const normalized = username?.trim().replace(/^@+/, "") ?? "";
  return normalized || null;
}

function isTelegramServiceMessage(message: TelegramMessage): boolean {
  const rawMessage = message as Record<string, unknown>;
  return TELEGRAM_SERVICE_MESSAGE_KEYS.some((key) => rawMessage[key] !== undefined);
}

function isTelegramBotSender(message: TelegramMessage): boolean {
  const rawFrom = message.from as ({ is_bot?: boolean } | undefined);
  return rawFrom?.is_bot === true;
}

function isGroupWorkoutReportLike(labels: string[]): boolean {
  return (
    labels.includes("report_like") &&
    !labels.includes("move_workout_candidate") &&
    !labels.includes("ack_or_noise")
  );
}

function parseTrainingPeaksAthleteIdFromUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/\/athletes\/(\d+)/i);
  if (!match) {
    return null;
  }

  return match[1] ?? null;
}

function buildDecision(
  input: Omit<GroupWorkoutReportIntakeDecision, "trainingPeaksAthleteId"> & {
    trainingPeaksAthleteId?: string | null;
  }
): GroupWorkoutReportIntakeDecision {
  return {
    intakeStatus: input.intakeStatus,
    shouldPersist: input.shouldPersist,
    skipReason: input.skipReason,
    messageText: input.messageText,
    detectedLabels: input.detectedLabels,
    student: input.student,
    senderMatchMethod: input.senderMatchMethod,
    trainingPeaksAthleteId: input.trainingPeaksAthleteId ?? null,
  };
}

export function isTrainingPeaksGroupWorkoutReportIntakeEnabled(): boolean {
  return process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_INTAKE_ENABLED?.trim() === "true";
}

export function getTrainingPeaksGroupWorkoutReportChatAllowlist(): Set<string> {
  const raw = process.env.TRAININGPEAKS_GROUP_WORKOUT_REPORT_CHAT_ALLOWLIST?.trim();
  if (!raw) {
    return new Set();
  }

  const normalized = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^-?\d+$/.test(value));

  return new Set(normalized);
}

export function isTrainingPeaksGroupWorkoutReportChatAllowed(
  chatId: number,
  allowlist: Set<string>
): boolean {
  return allowlist.has(String(chatId));
}

export async function decideTrainingPeaksGroupWorkoutReportIntake(
  input: DecideGroupWorkoutReportIntakeInput
): Promise<GroupWorkoutReportIntakeDecision> {
  if (!input.featureEnabled) {
    return buildDecision({
      intakeStatus: "skipped_feature_disabled",
      shouldPersist: false,
      skipReason: "feature disabled",
      messageText: null,
      detectedLabels: [],
      student: null,
      senderMatchMethod: null,
    });
  }

  if (!isTrainingPeaksGroupWorkoutReportChatAllowed(input.message.chat.id, input.allowedChatIds)) {
    return buildDecision({
      intakeStatus: "skipped_group_not_allowed",
      shouldPersist: false,
      skipReason: "group chat not in allowlist",
      messageText: null,
      detectedLabels: [],
      student: null,
      senderMatchMethod: null,
    });
  }

  if (isTelegramBotSender(input.message) || isTelegramServiceMessage(input.message)) {
    return buildDecision({
      intakeStatus: "skipped_bot_or_service",
      shouldPersist: false,
      skipReason: "bot or service sender",
      messageText: null,
      detectedLabels: [],
      student: null,
      senderMatchMethod: null,
    });
  }

  if (input.isCoachTelegramId(input.message.from?.id)) {
    return buildDecision({
      intakeStatus: "skipped_coach_message",
      shouldPersist: false,
      skipReason: "coach message",
      messageText: null,
      detectedLabels: [],
      student: null,
      senderMatchMethod: null,
    });
  }

  const messageText = (input.message.text ?? input.message.caption ?? "").trim();
  if (!messageText) {
    return buildDecision({
      intakeStatus: "skipped_not_report_like",
      shouldPersist: false,
      skipReason: "empty text",
      messageText: null,
      detectedLabels: [],
      student: null,
      senderMatchMethod: null,
    });
  }

  const detectedLabels = classifyTelegramContextLabels(messageText);
  if (!isGroupWorkoutReportLike(detectedLabels)) {
    return buildDecision({
      intakeStatus: "skipped_not_report_like",
      shouldPersist: false,
      skipReason: "not report-like",
      messageText,
      detectedLabels,
      student: null,
      senderMatchMethod: null,
    });
  }

  const sender = await input.resolveSender(
    input.message.from?.id,
    normalizeTelegramUsername(input.message.from?.username) ?? undefined
  );

  if (!sender.student) {
    const alreadyExists = await input.hasExistingBySourceMessage(
      String(input.message.chat.id),
      String(input.message.message_id)
    );
    if (alreadyExists) {
      return buildDecision({
        intakeStatus: "duplicate_source_message",
        shouldPersist: false,
        skipReason: "duplicate source message",
        messageText,
        detectedLabels,
        student: null,
        senderMatchMethod: sender.matchMethod,
      });
    }

    return buildDecision({
      intakeStatus: "skipped_unknown_student",
      shouldPersist: true,
      skipReason: "unknown student sender",
      messageText,
      detectedLabels,
      student: null,
      senderMatchMethod: sender.matchMethod,
    });
  }

  if (!sender.student.isActive) {
    const alreadyExists = await input.hasExistingBySourceMessage(
      String(input.message.chat.id),
      String(input.message.message_id)
    );
    if (alreadyExists) {
      return buildDecision({
        intakeStatus: "duplicate_source_message",
        shouldPersist: false,
        skipReason: "duplicate source message",
        messageText,
        detectedLabels,
        student: sender.student,
        senderMatchMethod: sender.matchMethod,
      });
    }

    return buildDecision({
      intakeStatus: "skipped_inactive_student",
      shouldPersist: true,
      skipReason: "inactive student",
      messageText,
      detectedLabels,
      student: sender.student,
      senderMatchMethod: sender.matchMethod,
    });
  }

  const trainingPeaksAthleteId = parseTrainingPeaksAthleteIdFromUrl(
    sender.student.trainingPeaksAthleteUrl
  );
  if (!trainingPeaksAthleteId) {
    const alreadyExists = await input.hasExistingBySourceMessage(
      String(input.message.chat.id),
      String(input.message.message_id)
    );
    if (alreadyExists) {
      return buildDecision({
        intakeStatus: "duplicate_source_message",
        shouldPersist: false,
        skipReason: "duplicate source message",
        messageText,
        detectedLabels,
        student: sender.student,
        senderMatchMethod: sender.matchMethod,
      });
    }

    return buildDecision({
      intakeStatus: "skipped_missing_tp_link",
      shouldPersist: true,
      skipReason: "missing trainingpeaks athlete link",
      messageText,
      detectedLabels,
      student: sender.student,
      senderMatchMethod: sender.matchMethod,
    });
  }

  const alreadyExists = await input.hasExistingBySourceMessage(
    String(input.message.chat.id),
    String(input.message.message_id)
  );
  if (alreadyExists) {
    return buildDecision({
      intakeStatus: "duplicate_source_message",
      shouldPersist: false,
      skipReason: "duplicate source message",
      messageText,
      detectedLabels,
      student: sender.student,
      senderMatchMethod: sender.matchMethod,
      trainingPeaksAthleteId,
    });
  }

  return buildDecision({
    intakeStatus: "candidate_stored",
    shouldPersist: true,
    skipReason: null,
    messageText,
    detectedLabels,
    student: sender.student,
    senderMatchMethod: sender.matchMethod,
    trainingPeaksAthleteId,
  });
}
