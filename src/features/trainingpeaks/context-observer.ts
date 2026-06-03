import {
  getTrainingPeaksStudentById,
  getTrainingPeaksStudentByTelegramChatId,
  getTrainingPeaksStudentByTelegramUsername,
  getTrainingPeaksStudentThreadByChatThread,
  hasTrainingPeaksTelegramContextObservationForChatTextHash,
  insertTrainingPeaksTelegramContextObservation,
  listActiveTrainingPeaksStudentMemoryItems,
  listRecentTrainingPeaksStudentContactEvents,
  listTrainingPeaksStudentsByTelegramChatId,
  recordTrainingPeaksStudentContactEvent,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
import { processCoachMemoryForObservation } from "@/features/trainingpeaks/coach-memory-extraction";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { passesTrainingPeaksStrictMoveWorkoutIntentGate } from "@/features/trainingpeaks/service";
import { buildTelegramContextTextPreview, sha256TelegramContextText } from "@/features/trainingpeaks/telegram-context";
import { tryAutoLinkTrainingPeaksTopic } from "@/features/trainingpeaks/topic-auto-link";
import type { TelegramMessage } from "@/features/telegram/types";

export type TrainingPeaksObserverLabel =
  | "noise_or_ack"
  | "move_workout_candidate"
  | "question_to_coach"
  | "possibly_training_report"
  | "possibly_pain_or_health"
  | "unclassified"
  | "third_party_in_linked_topic";

type TrainingPeaksObserverSourceType = "private_dm" | "group_topic" | "group_general";
type ObserverSenderRole = "linked_student" | "third_party_in_linked_topic" | "known_student";
type ObserverSenderMatchMethod = "telegram_chat_id" | "telegram_username" | "no_reliable_match";
type PersistedObservationLabel =
  | "question_to_coach"
  | "move_workout_candidate"
  | "pain_or_health"
  | "race_context"
  | "schedule_context"
  | "report_like"
  | "ack_or_noise"
  | "unknown"
  | "third_party_in_linked_topic";

const GROUP_GENERAL_MEANINGFUL_LABELS: TrainingPeaksObserverLabel[] = [
  "question_to_coach",
  "possibly_pain_or_health",
  "possibly_training_report",
  "move_workout_candidate",
];

type BuildObservationLogPayloadInput = {
  studentId: string | null;
  sourceType: TrainingPeaksObserverSourceType;
  chatId: string;
  messageThreadId: number | null;
  messageId: number;
  fromId: string | null;
  fromUsername: string | null;
  isTopicMessage: boolean;
  labels: TrainingPeaksObserverLabel[];
  scores?: Partial<Record<TrainingPeaksObserverLabel, number>>;
  messageLength: number;
  hasAttachment: boolean;
  text: string | null;
  senderRole?: ObserverSenderRole;
  senderMatchMethod?: ObserverSenderMatchMethod;
};

type TrainingPeaksObserverRouteResult =
  | { handled: false }
  | {
      handled: true;
      reason:
        | "coach_group_reply_contact_recorded"
        | "coach_group_reply_contact_skipped"
        | "known_student_private_dm"
        | "unknown_private_dm"
        | "linked_group_topic"
        | "unlinked_group_topic_auto_link"
        | "known_student_group_general"
        | "skipped_group_general";
    };

type CoachGroupReplyResolverDeps = {
  listStudentsByTelegramChatId: (telegramChatId: string) => Promise<Array<{ id: string }>>;
  getThreadStudentIdByChatThread: (input: {
    chatId: string;
    messageThreadId: number;
  }) => Promise<string | null>;
};

export type CoachGroupReplyContactResolverInput = {
  message: TelegramMessage;
} & CoachGroupReplyResolverDeps;

type CoachGroupTopicNoReplyContactCandidateInput = {
  message: TelegramMessage;
  fromId: number | undefined;
  text: string | null;
  isCoachTelegramId: (value: number | undefined) => boolean;
  isTelegramBotSender: (message: TelegramMessage) => boolean;
  isTelegramServiceMessage: (message: TelegramMessage) => boolean;
};

const TRAINING_REPORT_KEYWORDS = [
  "тренировка",
  "пробежка",
  "темп",
  "интервалы",
  "пульс",
  "hr",
  "км",
  "km",
  "workout",
  "run",
  "pace",
];
const PAIN_OR_HEALTH_KEYWORDS = [
  "боль",
  "болит",
  "колено",
  "спина",
  "ахилл",
  "устал",
  "заболел",
  "температура",
  "hurts",
  "pain",
  "sick",
  "injury",
];
const QUESTION_PHRASES = [
  "подскажи",
  "что думаешь",
  "как думаешь",
  "можно ли",
  "можно?",
  "тренер",
  "coach",
];
const NOISE_ACK_PATTERNS: RegExp[] = [
  /^ok$/i,
  /^okay$/i,
  /^ок$/i,
  /^окей$/i,
  /^спасибо$/i,
  /^спс$/i,
  /^thanks$/i,
  /^thank you$/i,
  /^done$/i,
  /^сделал$/i,
  /^сделано$/i,
  /^принято$/i,
  /^[👍👌🙏]$/u,
];
const OBSERVER_TRAINING_REPORT_MIN_LENGTH = 24;
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

function normalizeObserverText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function isCoachTelegramId(value: number | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return new Set(getTrainingPeaksCoachChatIds()).has(String(value));
}

function getTelegramMessageText(message: TelegramMessage): string | null {
  const normalized = (message.text ?? message.caption ?? "").trim();
  return normalized || null;
}

function detectTelegramAttachment(message: TelegramMessage): boolean {
  const rawMessage = message as Record<string, unknown>;
  return [
    "photo",
    "document",
    "voice",
    "audio",
    "video",
    "video_note",
    "sticker",
    "animation",
    "contact",
    "location",
    "venue",
    "poll",
  ].some((key) => rawMessage[key] !== undefined);
}

function isTelegramBotSender(message: TelegramMessage): boolean {
  const rawFrom = message.from as ({ is_bot?: boolean } | undefined);
  return rawFrom?.is_bot === true;
}

function isTelegramServiceMessage(message: TelegramMessage): boolean {
  const rawMessage = message as Record<string, unknown>;
  return TELEGRAM_SERVICE_MESSAGE_KEYS.some((key) => rawMessage[key] !== undefined);
}

function isGeneralGroupMessage(message: TelegramMessage): boolean {
  const chatType = message.chat.type;
  if (chatType !== "group" && chatType !== "supergroup") {
    return false;
  }

  return !message.is_topic_message && message.message_thread_id === undefined;
}

function isGroupOrSupergroupMessage(message: TelegramMessage): boolean {
  return message.chat.type === "group" || message.chat.type === "supergroup";
}

function logGeneralGroupObservationEvent(input: {
  studentId: string | null;
  chatId: string;
  messageId: number;
  reason: string;
  dedupSkipped?: boolean;
}): void {
  console.info("TrainingPeaks general group context observation", {
    event: "trainingpeaks_general_group_context_observation_persisted_or_skipped",
    studentId: input.studentId,
    chatId: input.chatId,
    messageId: input.messageId,
    reason: input.reason,
    dedupSkipped: input.dedupSkipped ?? false,
  });
}

type CoachGroupReplyContactCandidateInput = {
  message: TelegramMessage;
  fromId: number | undefined;
  text: string | null;
  isCoachTelegramId: (value: number | undefined) => boolean;
  isTelegramBotSender: (message: TelegramMessage) => boolean;
  isTelegramServiceMessage: (message: TelegramMessage) => boolean;
};

export function isCoachGroupReplyContactCandidate(input: CoachGroupReplyContactCandidateInput): boolean {
  if (!isGroupOrSupergroupMessage(input.message)) {
    return false;
  }
  if (!input.isCoachTelegramId(input.fromId)) {
    return false;
  }
  if (!input.message.reply_to_message) {
    return false;
  }
  if (!input.text || input.text.startsWith("/")) {
    return false;
  }
  if (input.isTelegramBotSender(input.message) || input.isTelegramServiceMessage(input.message)) {
    return false;
  }
  return true;
}

export function isCoachGroupTopicNoReplyContactCandidate(
  input: CoachGroupTopicNoReplyContactCandidateInput
): boolean {
  if (!isGroupOrSupergroupMessage(input.message)) {
    return false;
  }
  if (!input.isCoachTelegramId(input.fromId)) {
    return false;
  }
  if (!input.message.is_topic_message || input.message.message_thread_id === undefined) {
    return false;
  }
  if (input.message.reply_to_message) {
    return false;
  }
  if (!input.text || input.text.startsWith("/")) {
    return false;
  }
  if (input.isTelegramBotSender(input.message) || input.isTelegramServiceMessage(input.message)) {
    return false;
  }
  return true;
}

async function getThreadStudentIdByChatThread(input: {
  chatId: string;
  messageThreadId: number;
}): Promise<string | null> {
  const linkedThread = await getTrainingPeaksStudentThreadByChatThread(input.chatId, input.messageThreadId);
  return linkedThread?.studentId ?? null;
}

export async function resolveCoachGroupReplyContactStudentId(
  input: CoachGroupReplyContactResolverInput
): Promise<string | null> {
  const repliedMessage = input.message.reply_to_message;
  if (!repliedMessage) {
    return null;
  }

  const repliedFromId = repliedMessage.from?.id;
  if (repliedFromId === undefined || isCoachTelegramId(repliedFromId)) {
    return null;
  }

  if (isTelegramBotSender(repliedMessage) || isTelegramServiceMessage(repliedMessage)) {
    return null;
  }

  const directMatches = await input.listStudentsByTelegramChatId(String(repliedFromId));
  if (directMatches.length === 1) {
    return directMatches[0]!.id;
  }

  if (directMatches.length > 1) {
    return null;
  }

  const threadId = repliedMessage.message_thread_id ?? input.message.message_thread_id;
  if (threadId !== undefined) {
    const threadStudentId = await input.getThreadStudentIdByChatThread({
      chatId: String(repliedMessage.chat.id),
      messageThreadId: threadId,
    });
    if (threadStudentId) {
      return threadStudentId;
    }
  }

  return null;
}

async function recordCoachGroupReplyContactIfSafe(input: {
  message: TelegramMessage;
  fromId: number | undefined;
  text: string | null;
}): Promise<TrainingPeaksObserverRouteResult | null> {
  if (
    !isCoachGroupReplyContactCandidate({
      ...input,
      isCoachTelegramId,
      isTelegramBotSender,
      isTelegramServiceMessage,
    })
  ) {
    return null;
  }

  const studentId = await resolveCoachGroupReplyContactStudentId({
    message: input.message,
    listStudentsByTelegramChatId: async (telegramChatId) => listTrainingPeaksStudentsByTelegramChatId(telegramChatId),
    getThreadStudentIdByChatThread,
  });
  if (!studentId) {
    return {
      handled: true,
      reason: "coach_group_reply_contact_skipped",
    };
  }

  const chatId = String(input.message.chat.id);
  const messageId = String(input.message.message_id);
  const recentContactEvents = await listRecentTrainingPeaksStudentContactEvents({
    studentId,
    limit: 5,
  });
  const duplicateEvent = recentContactEvents.find(
    (event) =>
      event.eventType === "coach_message" &&
      event.source.startsWith("telegram_group_") &&
      event.referenceId === messageId &&
      event.metadata &&
      typeof event.metadata === "object" &&
      (event.metadata as Record<string, unknown>).chat_id === chatId
  );
  if (duplicateEvent) {
    return {
      handled: true,
      reason: "coach_group_reply_contact_skipped",
    };
  }

  const source =
    input.message.is_topic_message || input.message.message_thread_id !== undefined
      ? "telegram_group_topic"
      : "telegram_group_general";

  await recordTrainingPeaksStudentContactEvent({
    studentId,
    eventType: "coach_message",
    source,
    referenceId: messageId,
    metadata: {
      chat_id: chatId,
      message_id: input.message.message_id,
      message_thread_id: input.message.message_thread_id ?? null,
      replied_message_id: input.message.reply_to_message?.message_id ?? null,
      replied_from_id: input.message.reply_to_message?.from?.id ?? null,
      direction: "coach_outgoing_reply",
    },
  });

  return {
    handled: true,
    reason: "coach_group_reply_contact_recorded",
  };
}

async function recordCoachGroupTopicNoReplyContactIfSafe(input: {
  message: TelegramMessage;
  fromId: number | undefined;
  text: string | null;
}): Promise<TrainingPeaksObserverRouteResult | null> {
  if (
    !isCoachGroupTopicNoReplyContactCandidate({
      ...input,
      isCoachTelegramId,
      isTelegramBotSender,
      isTelegramServiceMessage,
    })
  ) {
    return null;
  }

  const threadId = input.message.message_thread_id;
  if (threadId === undefined) {
    return null;
  }

  const studentId = await getThreadStudentIdByChatThread({
    chatId: String(input.message.chat.id),
    messageThreadId: threadId,
  });
  if (!studentId) {
    return null;
  }

  const chatId = String(input.message.chat.id);
  const messageId = String(input.message.message_id);
  const recentContactEvents = await listRecentTrainingPeaksStudentContactEvents({
    studentId,
    limit: 5,
  });
  const duplicateEvent = recentContactEvents.find(
    (event) =>
      event.eventType === "coach_message" &&
      event.source === "telegram_group_topic" &&
      event.referenceId === messageId &&
      event.metadata &&
      typeof event.metadata === "object" &&
      (event.metadata as Record<string, unknown>).chat_id === chatId
  );
  if (duplicateEvent) {
    return {
      handled: true,
      reason: "coach_group_reply_contact_skipped",
    };
  }

  await recordTrainingPeaksStudentContactEvent({
    studentId,
    eventType: "coach_message",
    source: "telegram_group_topic",
    referenceId: messageId,
    metadata: {
      chat_id: chatId,
      message_id: input.message.message_id,
      message_thread_id: threadId,
      replied_message_id: null,
      replied_from_id: null,
      direction: "coach_outgoing_topic",
    },
  });

  return {
    handled: true,
    reason: "coach_group_reply_contact_recorded",
  };
}

export function isTrainingPeaksContextObserverEnabled(): boolean {
  const value = process.env.TRAININGPEAKS_CONTEXT_OBSERVER_ENABLED?.trim();
  return value === "true" || value === "1";
}

export function buildObservationLogPayload(input: BuildObservationLogPayloadInput) {
  return {
    studentId: input.studentId,
    sourceType: input.sourceType,
    chatId: input.chatId,
    messageThreadId: input.messageThreadId,
    messageId: input.messageId,
    fromId: input.fromId,
    fromUsername: input.fromUsername,
    isTopicMessage: input.isTopicMessage,
    labels: input.labels,
    scores: input.scores ?? {},
    messageLength: input.messageLength,
    hasAttachment: input.hasAttachment,
    textSha256: sha256TelegramContextText(input.text),
    textPreview: buildTelegramContextTextPreview(input.text),
    senderRole: input.senderRole ?? null,
    senderMatchMethod: input.senderMatchMethod ?? null,
  };
}

function mapObserverLabelsToPersistedLabels(labels: TrainingPeaksObserverLabel[]): PersistedObservationLabel[] {
  const mapped = new Set<PersistedObservationLabel>();

  for (const label of labels) {
    switch (label) {
      case "noise_or_ack":
        mapped.add("ack_or_noise");
        break;
      case "possibly_training_report":
        mapped.add("report_like");
        break;
      case "possibly_pain_or_health":
        mapped.add("pain_or_health");
        break;
      case "unclassified":
        mapped.add("unknown");
        break;
      case "question_to_coach":
      case "move_workout_candidate":
      case "third_party_in_linked_topic":
        mapped.add(label);
        break;
    }
  }

  return mapped.size > 0 ? [...mapped] : ["unknown"];
}

function shouldSkipGroupGeneralAckOrNoise(labels: TrainingPeaksObserverLabel[]): boolean {
  if (!labels.includes("noise_or_ack")) {
    return false;
  }

  return !GROUP_GENERAL_MEANINGFUL_LABELS.some((label) => labels.includes(label));
}

function classifyObserverText(text: string | null): {
  labels: TrainingPeaksObserverLabel[];
  scores: Partial<Record<TrainingPeaksObserverLabel, number>>;
} {
  const normalized = normalizeObserverText(text ?? "");
  const labels: TrainingPeaksObserverLabel[] = [];
  const scores: Partial<Record<TrainingPeaksObserverLabel, number>> = {};

  if (!normalized) {
    return {
      labels: ["unclassified"],
      scores: { unclassified: 0.2 },
    };
  }

  if (normalized.length <= 16 && NOISE_ACK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    labels.push("noise_or_ack");
    scores.noise_or_ack = 0.95;
  }

  if (normalized.includes("?") || QUESTION_PHRASES.some((phrase) => normalized.includes(phrase))) {
    labels.push("question_to_coach");
    scores.question_to_coach = normalized.includes("?") ? 0.88 : 0.7;
  }

  if (
    normalized.length >= OBSERVER_TRAINING_REPORT_MIN_LENGTH &&
    TRAINING_REPORT_KEYWORDS.some((keyword) => normalized.includes(keyword))
  ) {
    labels.push("possibly_training_report");
    scores.possibly_training_report = 0.72;
  }

  if (PAIN_OR_HEALTH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    labels.push("possibly_pain_or_health");
    scores.possibly_pain_or_health = 0.84;
  }

  if (passesTrainingPeaksStrictMoveWorkoutIntentGate(text ?? "")) {
    labels.push("move_workout_candidate");
    scores.move_workout_candidate = 0.91;
  }

  if (labels.length === 0) {
    labels.push("unclassified");
    scores.unclassified = 0.35;
  }

  return { labels, scores };
}

async function resolveStudentByTelegramIdentity(input: {
  fromId: number | undefined;
  fromUsername: string | undefined;
}): Promise<{ student: TrainingPeaksStudent | null; matchMethod: ObserverSenderMatchMethod }> {
  if (input.fromId !== undefined) {
    const studentByChatId = await getTrainingPeaksStudentByTelegramChatId(String(input.fromId));

    if (studentByChatId) {
      return {
        student: studentByChatId,
        matchMethod: "telegram_chat_id",
      };
    }
  }

  const normalizedUsername = input.fromUsername?.trim().replace(/^@+/, "") ?? "";
  if (normalizedUsername) {
    const studentByUsername = await getTrainingPeaksStudentByTelegramUsername(normalizedUsername);

    if (studentByUsername) {
      return {
        student: studentByUsername,
        matchMethod: "telegram_username",
      };
    }
  }

  return {
    student: null,
    matchMethod: "no_reliable_match",
  };
}

async function persistObserverObservation(input: BuildObservationLogPayloadInput): Promise<void> {
  const payload = buildObservationLogPayload(input);
  const persistedLabels =
    input.senderRole === "third_party_in_linked_topic"
      ? (["third_party_in_linked_topic"] as PersistedObservationLabel[])
      : mapObserverLabelsToPersistedLabels(input.labels);
  const dedupSkipped = Boolean(
    payload.textSha256 &&
      (await hasTrainingPeaksTelegramContextObservationForChatTextHash(input.chatId, payload.textSha256))
  );

  if (!dedupSkipped) {
    const insertedObservation = await insertTrainingPeaksTelegramContextObservation({
      studentId: input.studentId,
      sourceType: input.sourceType,
      chatId: input.chatId,
      messageThreadId: input.messageThreadId,
      messageId: String(input.messageId),
      labels: persistedLabels,
      textSha256: payload.textSha256,
      textPreview: payload.textPreview,
      metadata: {
        scores: input.scores ?? {},
        fromId: input.fromId,
        fromUsername: input.fromUsername,
        isTopicMessage: input.isTopicMessage,
        messageLength: input.messageLength,
        hasAttachment: input.hasAttachment,
        senderRole: input.senderRole ?? null,
        senderMatchMethod: input.senderMatchMethod ?? null,
      },
    });

    if (input.studentId && process.env.COACH_MEMORY_EXTRACTION_ENABLED?.trim() === "true") {
      try {
        const student = await getTrainingPeaksStudentById(input.studentId);
        const activeMemoryItems = await listActiveTrainingPeaksStudentMemoryItems(input.studentId, {
          limit: 200,
        });
        const memoryResult = await processCoachMemoryForObservation({
          observationId: insertedObservation.id,
          studentId: input.studentId,
          studentName: student?.studentName ?? "Unknown student",
          textPreview: payload.textPreview,
          labels: persistedLabels,
          sourceType: input.sourceType,
          observedAt: insertedObservation.observedAt,
          currentActiveMemoryItems: activeMemoryItems.map((item) => ({
            id: item.id,
            memoryType: item.memoryType,
            summaryText: item.summaryText,
            structured: item.structured,
            validUntil: item.validUntil,
          })),
        });

        if (memoryResult.status === "processed" && (memoryResult.inserted > 0 || memoryResult.touched > 0)) {
          console.info("TrainingPeaks coach memory observation write", {
            event: "trainingpeaks_coach_memory_observation_processed",
            observationIdPrefix: insertedObservation.id.slice(0, 8),
            studentIdPrefix: input.studentId.slice(0, 8),
            inserted: memoryResult.inserted,
            touched: memoryResult.touched,
            skipped: memoryResult.skipped,
          });
        }
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        console.warn("TrainingPeaks coach memory observation processing failed", {
          event: "trainingpeaks_coach_memory_observation_failed",
          observationIdPrefix: insertedObservation.id.slice(0, 8),
          studentIdPrefix: input.studentId.slice(0, 8),
          errorClass: errorName,
        });
      }
    }
  }

  console.info("TrainingPeaks context observation", {
    event: "trainingpeaks_context_observation_persisted_or_skipped",
    studentId: input.studentId,
    sourceType: input.sourceType,
    labels: persistedLabels,
    dedupSkipped,
  });
}

async function persistKnownStudentGeneralGroupObservation(input: {
  message: TelegramMessage;
  student: TrainingPeaksStudent;
  text: string;
  hasAttachment: boolean;
  messageLength: number;
  fromId: number;
  fromUsername: string | null;
}): Promise<"persisted" | "dedup_skipped" | "ack_or_noise_skipped"> {
  const labelsAndScores = classifyObserverText(input.text);
  if (shouldSkipGroupGeneralAckOrNoise(labelsAndScores.labels)) {
    logGeneralGroupObservationEvent({
      studentId: input.student.id,
      chatId: String(input.message.chat.id),
      messageId: input.message.message_id,
      reason: "group_general_ack_or_noise_skipped",
    });

    return "ack_or_noise_skipped";
  }

  const payload = buildObservationLogPayload({
    studentId: input.student.id,
    sourceType: "group_general",
    chatId: String(input.message.chat.id),
    messageThreadId: null,
    messageId: input.message.message_id,
    fromId: String(input.fromId),
    fromUsername: input.fromUsername,
    isTopicMessage: false,
    labels: labelsAndScores.labels,
    scores: labelsAndScores.scores,
    messageLength: input.messageLength,
    hasAttachment: input.hasAttachment,
    text: input.text,
    senderRole: "known_student",
    senderMatchMethod: "telegram_chat_id",
  });
  const dedupSkipped = Boolean(
    payload.textSha256 &&
      (await hasTrainingPeaksTelegramContextObservationForChatTextHash(
        String(input.message.chat.id),
        payload.textSha256
      ))
  );

  if (!dedupSkipped) {
    await insertTrainingPeaksTelegramContextObservation({
      studentId: input.student.id,
      sourceType: "group_general",
      chatId: String(input.message.chat.id),
      messageThreadId: null,
      messageId: String(input.message.message_id),
      labels: mapObserverLabelsToPersistedLabels(labelsAndScores.labels),
      textSha256: payload.textSha256,
      textPreview: payload.textPreview,
      metadata: {
        scores: labelsAndScores.scores,
        fromId: String(input.fromId),
        fromUsername: input.fromUsername,
        groupChatId: String(input.message.chat.id),
        isTopicMessage: false,
        messageLength: input.messageLength,
        hasAttachment: input.hasAttachment,
        senderRole: "known_student",
        senderMatchMethod: "telegram_chat_id",
      },
    });
  }

  logGeneralGroupObservationEvent({
    studentId: input.student.id,
    chatId: String(input.message.chat.id),
    messageId: input.message.message_id,
    reason: dedupSkipped ? "dedup_skipped" : "persisted",
    dedupSkipped,
  });

  return dedupSkipped ? "dedup_skipped" : "persisted";
}

async function observeGeneralGroupMessage(input: {
  message: TelegramMessage;
  text: string | null;
  hasAttachment: boolean;
  messageLength: number;
  fromId: number | undefined;
  fromUsername: string | null;
}): Promise<TrainingPeaksObserverRouteResult> {
  const chatId = String(input.message.chat.id);
  const messageId = input.message.message_id;

  if (!isGeneralGroupMessage(input.message)) {
    return { handled: false };
  }

  if (input.fromId === undefined) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: "missing_from_id",
    });
    return { handled: false };
  }

  if (isTelegramBotSender(input.message)) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: "bot_sender",
    });
    return { handled: false };
  }

  if (isCoachTelegramId(input.fromId)) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: "coach_sender",
    });
    return { handled: false };
  }

  if (isTelegramServiceMessage(input.message)) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: "service_message",
    });
    return { handled: false };
  }

  if (!input.text) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: input.hasAttachment ? "media_without_caption" : "empty_text",
    });
    return { handled: false };
  }

  if (input.text.startsWith("/")) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: "command",
    });
    return { handled: false };
  }

  const matchedStudents = await listTrainingPeaksStudentsByTelegramChatId(String(input.fromId));
  if (matchedStudents.length !== 1) {
    logGeneralGroupObservationEvent({
      studentId: null,
      chatId,
      messageId,
      reason: matchedStudents.length === 0 ? "unknown_sender" : "ambiguous_chat_id_match",
    });
    return { handled: false };
  }

  const student = matchedStudents[0]!;
  const observationResult = await persistKnownStudentGeneralGroupObservation({
    message: input.message,
    student,
    text: input.text,
    hasAttachment: input.hasAttachment,
    messageLength: input.messageLength,
    fromId: input.fromId,
    fromUsername: input.fromUsername,
  });

  if (observationResult === "ack_or_noise_skipped") {
    return {
      handled: true,
      reason: "skipped_group_general",
    };
  }

  return {
    handled: true,
    reason: "known_student_group_general",
  };
}

async function observeLinkedGroupTopicMessage(input: {
  message: TelegramMessage;
  linkedStudent: TrainingPeaksStudent;
  text: string | null;
  hasAttachment: boolean;
  messageLength: number;
  fromId: number | undefined;
  fromUsername: string | null;
}): Promise<TrainingPeaksObserverRouteResult> {
  const senderIdentity = await resolveStudentByTelegramIdentity({
    fromId: input.fromId,
    fromUsername: input.message.from?.username,
  });

  const senderMatchesLinkedStudent =
    senderIdentity.student !== null && senderIdentity.student.id === input.linkedStudent.id;

  if (!senderMatchesLinkedStudent) {
    await persistObserverObservation({
      studentId: input.linkedStudent.id,
      sourceType: "group_topic",
      chatId: String(input.message.chat.id),
      messageThreadId: input.message.message_thread_id ?? null,
      messageId: input.message.message_id,
      fromId: input.fromId === undefined ? null : String(input.fromId),
      fromUsername: input.fromUsername,
      isTopicMessage: true,
      labels: ["third_party_in_linked_topic"],
      scores: { third_party_in_linked_topic: 0.95 },
      messageLength: input.messageLength,
      hasAttachment: input.hasAttachment,
      text: input.text,
      senderRole: "third_party_in_linked_topic",
      senderMatchMethod: senderIdentity.matchMethod,
    });

    return {
      handled: true,
      reason: "linked_group_topic",
    };
  }

  const classified = classifyObserverText(input.text);
  await persistObserverObservation({
    studentId: input.linkedStudent.id,
    sourceType: "group_topic",
    chatId: String(input.message.chat.id),
    messageThreadId: input.message.message_thread_id ?? null,
    messageId: input.message.message_id,
    fromId: input.fromId === undefined ? null : String(input.fromId),
    fromUsername: input.fromUsername,
    isTopicMessage: true,
    labels: classified.labels,
    scores: classified.scores,
    messageLength: input.messageLength,
    hasAttachment: input.hasAttachment,
    text: input.text,
    senderRole: "linked_student",
    senderMatchMethod: senderIdentity.matchMethod,
  });

  return {
    handled: true,
    reason: "linked_group_topic",
  };
}

export async function handleTrainingPeaksContextObserverMessage(
  message: TelegramMessage
): Promise<TrainingPeaksObserverRouteResult> {
  if (!isTrainingPeaksContextObserverEnabled()) {
    return { handled: false };
  }

  const chatType = message.chat.type;
  const text = getTelegramMessageText(message);
  const hasAttachment = detectTelegramAttachment(message);
  const messageLength = text?.length ?? 0;
  const fromId = message.from?.id;
  const fromUsername = message.from?.username ?? null;

  const coachGroupReplyResult = await recordCoachGroupReplyContactIfSafe({
    message,
    fromId,
    text,
  });
  if (coachGroupReplyResult) {
    return coachGroupReplyResult;
  }

  const coachGroupTopicNoReplyResult = await recordCoachGroupTopicNoReplyContactIfSafe({
    message,
    fromId,
    text,
  });
  if (coachGroupTopicNoReplyResult) {
    return coachGroupTopicNoReplyResult;
  }

  if (chatType === "private") {
    if (isCoachTelegramId(fromId)) {
      return { handled: false };
    }

    const { student, matchMethod } = await resolveStudentByTelegramIdentity({
      fromId,
      fromUsername: message.from?.username,
    });

    if (!student) {
      return {
        handled: true,
        reason: "unknown_private_dm",
      };
    }

    const classified = classifyObserverText(text);
    await persistObserverObservation({
      studentId: student.id,
      sourceType: "private_dm",
      chatId: String(message.chat.id),
      messageThreadId: null,
      messageId: message.message_id,
      fromId: fromId === undefined ? null : String(fromId),
      fromUsername,
      isTopicMessage: false,
      labels: classified.labels,
      scores: classified.scores,
      messageLength,
      hasAttachment,
      text,
      senderRole: "linked_student",
      senderMatchMethod: matchMethod,
    });

    return {
      handled: true,
      reason: "known_student_private_dm",
    };
  }

  if (chatType !== "group" && chatType !== "supergroup") {
    return { handled: false };
  }

  if (!message.is_topic_message && message.message_thread_id === undefined) {
    return observeGeneralGroupMessage({
      message,
      text,
      hasAttachment,
      messageLength,
      fromId,
      fromUsername,
    });
  }

  if (!message.is_topic_message || message.message_thread_id === undefined) {
    return { handled: false };
  }

  const linkedThread = await getTrainingPeaksStudentThreadByChatThread(
    String(message.chat.id),
    message.message_thread_id
  );

  if (!linkedThread) {
    const autoLinkResult = await tryAutoLinkTrainingPeaksTopic(message);

    if (autoLinkResult.kind === "linked") {
      return observeLinkedGroupTopicMessage({
        message,
        linkedStudent: autoLinkResult.student,
        text,
        hasAttachment,
        messageLength,
        fromId,
        fromUsername,
      });
    }

    if (
      autoLinkResult.kind === "no_match" ||
      autoLinkResult.kind === "ambiguous" ||
      autoLinkResult.kind === "conflict"
    ) {
      return {
        handled: true,
        reason: "unlinked_group_topic_auto_link",
      };
    }

    return { handled: false };
  }

  const linkedStudent = await getTrainingPeaksStudentById(linkedThread.studentId);

  if (!linkedStudent) {
    return { handled: false };
  }

  return observeLinkedGroupTopicMessage({
    message,
    linkedStudent,
    text,
    hasAttachment,
    messageLength,
    fromId,
    fromUsername,
  });
}
