import { createHash } from "node:crypto";

import {
  getTrainingPeaksStudentByTelegramChatId,
  insertTrainingPeaksTelegramContextObservation,
  type TrainingPeaksTelegramContextObservation,
  type TrainingPeaksTelegramContextSourceType,
  type TrainingPeaksTelegramFormality,
} from "@/features/trainingpeaks/repository";
import { passesTrainingPeaksStrictMoveWorkoutIntentGate } from "@/features/trainingpeaks/service";

export const TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH = 120;

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

export function buildTelegramContextTextPreview(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH - 1)}…`;
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
    TRAINING_REPORT_KEYWORDS.some((keyword) => normalized.includes(keyword))
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
      return "Пиши по-русски, тепло, просто, на «вы».";
    default:
      return "Пиши по-русски, вежливо и нейтрально, без излишней близости; не используй «ты», если нет явных признаков близкого общения.";
  }
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
