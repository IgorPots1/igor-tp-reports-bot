import { createHash } from "node:crypto";

import { describeSupabaseError } from "@/features/supabase/server";
import {
  getTrainingPeaksStudentByTelegramChatId,
  insertTrainingPeaksTelegramContextObservation,
  type TrainingPeaksTelegramContextObservation,
  type TrainingPeaksTelegramContextSourceType,
  type TrainingPeaksTelegramFormality,
} from "@/features/trainingpeaks/repository";
import { passesTrainingPeaksStrictMoveWorkoutIntentGate } from "@/features/trainingpeaks/service";

// 120 = the SHORT preview for admin lists / logs (display only).
export const TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH = 120;
// The stored context OBSERVATION doubles as the content the AI pipeline reads (studentWords → prompt,
// factor extraction). 120 silently dropped the tail of long reports — exactly where students mention
// food/water/«тяжело» (Кукушкина/Надя/Антон). The column is `text`, so there is no DB reason for 120;
// 500 keeps a full report while still bounding a pathological paste. Only the OBSERVATION path uses this.
export const TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH = 500;

export type TrainingPeaksTelegramContextLabel =
  | "question_to_coach"
  | "move_workout_candidate"
  | "pain_or_health"
  | "race_context"
  | "schedule_context"
  | "report_like"
  | "ack_or_noise"
  | "unknown";

const TRAINING_REPORT_KEYWORDS = [
  "тренировка",
  "пробежка",
  "пробежал",
  "пробежала",
  "бежал",
  "бежала",
  "выполнил тренировку",
  "выполнила тренировку",
  "сделал тренировку",
  "сделала тренировку",
  "длительную",
  "длительная",
  "темп",
  "темповую",
  "интервалы",
  "мин/км",
  "километров",
  "пульс",
  "hr",
  "км",
  "km",
  "workout",
  "run",
  "pace",
];
const REPORT_ACTION_VERBS = ["сделал", "сделала", "выполнил", "выполнила"];
const REPORT_ACTION_CONTEXT = [
  "трен",
  "бег",
  "пробеж",
  "интервал",
  "темпов",
  "длител",
  "размин",
  "замин",
  "км",
  "мин/км",
  "пульс",
  "pace",
  "run",
  "workout",
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
const RACE_CONTEXT_KEYWORDS = [
  "марафон",
  "полумарафон",
  "старт",
  "race",
  "marathon",
  "half marathon",
  "10k",
  "5k",
  "соревнован",
  "забег",
];
const SCHEDULE_CONTEXT_KEYWORDS = [
  "расписан",
  "перенес",
  "перенос",
  "сдвин",
  "завтра",
  "на неделе",
  "в выходные",
  "schedule",
  "reschedule",
  "calendar",
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
const CONTEXT_TRAINING_REPORT_MIN_LENGTH = 24;

function normalizeContextText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

export function sha256TelegramContextText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex");
}

export function buildTelegramContextTextPreview(
  value: string | null | undefined,
  maxLength: number = TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH
): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function classifyTelegramContextLabels(text: string | null | undefined): TrainingPeaksTelegramContextLabel[] {
  const normalized = normalizeContextText(text ?? "");
  const labels: TrainingPeaksTelegramContextLabel[] = [];

  if (!normalized) {
    return ["unknown"];
  }

  if (normalized.length <= 16 && NOISE_ACK_PATTERNS.some((pattern) => pattern.test(normalized))) {
    labels.push("ack_or_noise");
  }

  if (normalized.includes("?") || QUESTION_PHRASES.some((phrase) => normalized.includes(phrase))) {
    labels.push("question_to_coach");
  }

  if (
    normalized.length >= CONTEXT_TRAINING_REPORT_MIN_LENGTH &&
    (TRAINING_REPORT_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      REPORT_ACTION_VERBS.some(
        (verb) =>
          normalized.includes(verb) &&
          REPORT_ACTION_CONTEXT.some((context) => normalized.includes(context))
      ))
  ) {
    labels.push("report_like");
  }

  if (PAIN_OR_HEALTH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    labels.push("pain_or_health");
  }

  if (RACE_CONTEXT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    labels.push("race_context");
  }

  if (SCHEDULE_CONTEXT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    labels.push("schedule_context");
  }

  if (passesTrainingPeaksStrictMoveWorkoutIntentGate(text ?? "")) {
    labels.push("move_workout_candidate");
  }

  if (labels.length === 0) {
    labels.push("unknown");
  }

  return labels;
}

export function getTrainingPeaksReplyDraftFormalityInstruction(
  formality: TrainingPeaksTelegramFormality
): string {
  switch (formality) {
    case "ty":
      return "Пиши по-русски, тепло, просто, на «ты».";
    case "vy":
      return "Пиши по-русски, тепло, просто, на «вы». «Вы» — вежливое обращение к ОДНОМУ человеку, не множественное: существительное-сказуемое в ЕДИНСТВЕННОМ числе — «вы молодец», не «молодцы» (и не «вы все»/«ребята»). Это грамматика ед. числа, без навязанных ласковых слов; глаголы при «вы» остаются в обычной форме («вы справились»).";
    default:
      return "Пиши по-русски, вежливо и нейтрально, без излишней близости; не используй «ты», если нет явных признаков близкого общения.";
  }
}

export function isAthleteIncomingBusinessDmMessage(message: {
  from?: { id?: number | string | null };
  chat?: { id?: number | string | null };
}): boolean {
  const fromId = message.from?.id;
  const chatId = message.chat?.id;
  if (fromId === undefined || fromId === null || chatId === undefined || chatId === null) {
    return false;
  }
  return String(fromId) === String(chatId);
}

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

const TELEGRAM_NON_TEXT_MESSAGE_KEYS = [
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
] as const;

type BusinessDmMessageLike = Pick<
  Record<string, unknown>,
  never
> & {
  message_id: number;
  chat?: { id?: number | string | null };
  from?: { id?: number | string | null; is_bot?: boolean };
  text?: string | null;
  caption?: string | null;
  date?: number | null;
  business_connection_id?: string | null;
};

type ContactEventLike = {
  eventType: string;
  source: string;
  referenceId: string | null;
  metadata: unknown;
};

export type RecordCoachOutgoingBusinessDmContactResult =
  | { kind: "recorded"; studentId: string }
  | {
      kind:
        | "ignored_not_outgoing_coach_dm"
        | "ignored_missing_chat_id"
        | "ignored_no_student_match"
        | "ignored_ambiguous_student_match"
        | "ignored_duplicate"
        // Ученик найден и дублем не является, но запись отметки не прошла (сбой БД).
        // Отдельно от прочих ignored: те — решения, это — потеря учёта.
        | "ignored_record_failed";
    };

function hasTelegramServiceMessagePayload(message: BusinessDmMessageLike): boolean {
  const rawMessage = message as Record<string, unknown>;
  return TELEGRAM_SERVICE_MESSAGE_KEYS.some((key) => rawMessage[key] !== undefined);
}

function hasTelegramBusinessMessageMeaningfulContent(message: BusinessDmMessageLike): boolean {
  const text = (message.text ?? message.caption ?? "").trim();
  if (text.length > 0) {
    return true;
  }

  const rawMessage = message as Record<string, unknown>;
  return TELEGRAM_NON_TEXT_MESSAGE_KEYS.some((key) => rawMessage[key] !== undefined);
}

export function isCoachOutgoingBusinessDmMessage(input: {
  message: BusinessDmMessageLike;
  isCoachTelegramId: (value: number | undefined) => boolean;
}): boolean {
  const fromIdRaw = input.message.from?.id;
  const chatIdRaw = input.message.chat?.id;
  const fromId =
    fromIdRaw === undefined || fromIdRaw === null ? undefined : Number.parseInt(String(fromIdRaw), 10);

  if (fromId === undefined || !Number.isFinite(fromId)) {
    return false;
  }
  if (chatIdRaw === undefined || chatIdRaw === null) {
    return false;
  }
  if (!input.isCoachTelegramId(fromId)) {
    return false;
  }
  if (String(fromIdRaw) === String(chatIdRaw)) {
    return false;
  }
  if (input.message.from?.is_bot === true || hasTelegramServiceMessagePayload(input.message)) {
    return false;
  }

  const normalizedText = (input.message.text ?? input.message.caption ?? "").trim();
  if (normalizedText.startsWith("/")) {
    return false;
  }

  return hasTelegramBusinessMessageMeaningfulContent(input.message);
}

function isDuplicateCoachBusinessDmContactEvent(input: {
  chatId: string;
  messageId: string;
  recentEvents: ContactEventLike[];
}): boolean {
  for (const event of input.recentEvents) {
    if (event.eventType !== "coach_message" || event.source !== "telegram_business_dm") {
      continue;
    }

    if (event.referenceId === input.messageId) {
      const metadata = event.metadata;
      if (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        String((metadata as Record<string, unknown>).chat_id ?? "") === input.chatId
      ) {
        return true;
      }
    }

    const metadata = event.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      continue;
    }

    const metadataRecord = metadata as Record<string, unknown>;
    if (
      String(metadataRecord.chat_id ?? "") === input.chatId &&
      String(metadataRecord.message_id ?? "") === input.messageId
    ) {
      return true;
    }
  }

  return false;
}

export async function recordCoachOutgoingBusinessDmContactIfSafe(input: {
  message: BusinessDmMessageLike;
  isCoachTelegramId: (value: number | undefined) => boolean;
  listStudentsByTelegramChatId: (chatId: string) => Promise<Array<{ id: string }>>;
  listRecentContactEvents: (studentId: string) => Promise<ContactEventLike[]>;
  recordContactEvent: (payload: {
    studentId: string;
    eventType: "coach_message";
    source: "telegram_business_dm";
    referenceId: string;
    occurredAt: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}): Promise<RecordCoachOutgoingBusinessDmContactResult> {
  if (!isCoachOutgoingBusinessDmMessage({ message: input.message, isCoachTelegramId: input.isCoachTelegramId })) {
    return { kind: "ignored_not_outgoing_coach_dm" };
  }

  const chatId =
    input.message.chat?.id === undefined || input.message.chat?.id === null
      ? null
      : String(input.message.chat.id);
  if (!chatId) {
    return { kind: "ignored_missing_chat_id" };
  }

  const matchedStudents = await input.listStudentsByTelegramChatId(chatId);
  if (matchedStudents.length === 0) {
    return { kind: "ignored_no_student_match" };
  }
  if (matchedStudents.length > 1) {
    return { kind: "ignored_ambiguous_student_match" };
  }

  const studentId = matchedStudents[0]!.id;
  const messageId = String(input.message.message_id);
  const recentEvents = await input.listRecentContactEvents(studentId);
  if (isDuplicateCoachBusinessDmContactEvent({ chatId, messageId, recentEvents })) {
    return { kind: "ignored_duplicate" };
  }

  const dateSeconds = input.message.date;
  const occurredAt =
    typeof dateSeconds === "number" && Number.isFinite(dateSeconds) && dateSeconds > 0
      ? new Date(dateSeconds * 1000).toISOString()
      : new Date().toISOString();

  // Это учёт «тренер ответил», а не сам ответ: ответ уже ушёл ученице через Telegram, и запись
  // контакта — бухгалтерия поверх свершившегося факта. При сетевом сбое undici бросает мимо
  // проверки error, исключение уходило в handleTrainingPeaksTelegramBusinessMessage и обрывало
  // обработку сообщения ДО записи наблюдения — то есть неудача второстепенного учёта стоила
  // основной записи. Логируем и идём дальше: пропущенная отметка о контакте стоит дешевле
  // потерянного наблюдения.
  try {
    await input.recordContactEvent({
      studentId,
      eventType: "coach_message",
      source: "telegram_business_dm",
      referenceId: messageId,
      occurredAt,
      metadata: {
        chat_id: chatId,
        message_id: input.message.message_id,
        has_business_connection_id: Boolean(input.message.business_connection_id?.trim()),
        direction: "coach_outgoing_manual",
      },
    });
  } catch (error) {
    console.error("[tp-context] отметка о контакте не записана, обработку продолжаю", {
      event: "contact_event_record_failed",
      chatId,
      messageId,
      error: describeSupabaseError(error),
    });
    return { kind: "ignored_record_failed" };
  }

  return { kind: "recorded", studentId };
}

export async function recordTrainingPeaksTelegramBusinessContextObservation(input: {
  chatId: string;
  messageId: string | number | null | undefined;
  text: string | null | undefined;
}): Promise<TrainingPeaksTelegramContextObservation | null> {
  const messageText = input.text?.trim();
  if (!messageText) {
    return null;
  }

  const student = await getTrainingPeaksStudentByTelegramChatId(input.chatId);
  if (!student) {
    return null;
  }

  const textSha256 = sha256TelegramContextText(messageText);
  const textPreview = buildTelegramContextTextPreview(messageText);
  const labels = classifyTelegramContextLabels(messageText);

  return insertTrainingPeaksTelegramContextObservation({
    studentId: student.id,
    sourceType: "business_dm",
    chatId: input.chatId,
    messageThreadId: null,
    messageId: input.messageId === null || input.messageId === undefined ? null : String(input.messageId),
    labels,
    textSha256,
    textPreview,
    metadata: {
      messageLength: messageText.length,
    },
  });
}

export function formatTrainingPeaksTelegramContextSourceType(
  sourceType: TrainingPeaksTelegramContextSourceType
): string {
  switch (sourceType) {
    case "business_dm":
      return "Business DM";
    case "private_dm":
      return "Личка";
    case "group_topic":
      return "Тема группы";
    case "group_general":
      return "Общая группа";
    default:
      return sourceType;
  }
}

export function formatTrainingPeaksTelegramFormalityLabel(
  formality: TrainingPeaksTelegramFormality
): string {
  switch (formality) {
    case "ty":
      return "на ты";
    case "vy":
      return "на вы";
    default:
      return "неизвестно";
  }
}
