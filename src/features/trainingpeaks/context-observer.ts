import {
  getTrainingPeaksStudentById,
  getTrainingPeaksStudentByTelegramChatId,
  getTrainingPeaksStudentByTelegramUsername,
  getTrainingPeaksStudentThreadByChatThread,
  hasTrainingPeaksTelegramContextObservationForChatTextHash,
  insertTrainingPeaksTelegramContextObservation,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
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

type TrainingPeaksObserverSourceType = "private_dm" | "group_topic";
type ObserverSenderRole = "linked_student" | "third_party_in_linked_topic";
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
        | "known_student_private_dm"
        | "unknown_private_dm"
        | "linked_group_topic"
        | "unlinked_group_topic_auto_link";
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
    await insertTrainingPeaksTelegramContextObservation({
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
  }

  console.info("TrainingPeaks context observation", {
    event: "trainingpeaks_context_observation_persisted_or_skipped",
    studentId: input.studentId,
    sourceType: input.sourceType,
    labels: persistedLabels,
    dedupSkipped,
  });
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
