import {
  insertTrainingPeaksMessageIntentLog,
  type TrainingPeaksMessageIntentLogStatus,
} from "@/features/trainingpeaks/repository";
import type { CreateTrainingPeaksMoveWorkoutActionFromTelegramResult } from "@/features/trainingpeaks/service";
import {
  buildTelegramContextTextPreview,
  classifyTelegramContextLabels,
  sha256TelegramContextText,
  type TrainingPeaksTelegramContextLabel,
} from "@/features/trainingpeaks/telegram-context";
import { normalizeWorkoutReference } from "@/features/trainingpeaks/workout-reference";

export type LogTrainingPeaksMessageIntentDecisionInput = {
  source?: string;
  studentId?: string | null;
  telegramChatId?: string | null;
  telegramUserId?: string | null;
  telegramMessageId?: string | null;
  businessConnectionId?: string | null;
  messageThreadId?: number | null;
  rawText?: string | null;
  normalizedText?: string | null;
  ruleIntent?: Record<string, unknown> | null;
  ruleConfidence?: number | null;
  aiIntent?: Record<string, unknown> | null;
  aiConfidence?: number | null;
  finalIntent?: Record<string, unknown> | null;
  status: TrainingPeaksMessageIntentLogStatus;
  actionId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

const RELEVANT_CONTEXT_LABELS = new Set<TrainingPeaksTelegramContextLabel>([
  "move_workout_candidate",
  "schedule_context",
  "report_like",
]);

function normalizeIntentLogText(value: string | null | undefined): string | null {
  const normalized = value
    ?.toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

function buildIntentLogTextFields(rawText: string | null | undefined): {
  textPreview: string | null;
  textSha256: string | null;
  normalizedText: string | null;
} {
  const trimmed = rawText?.trim();
  if (!trimmed) {
    return {
      textPreview: null,
      textSha256: null,
      normalizedText: null,
    };
  }

  return {
    textPreview: buildTelegramContextTextPreview(trimmed),
    textSha256: sha256TelegramContextText(trimmed),
    normalizedText: normalizeIntentLogText(trimmed),
  };
}

export function hasTrainingPeaksMessageIntentLoggingRelevance(
  text: string,
  contextLabels?: TrainingPeaksTelegramContextLabel[]
): boolean {
  const labels = contextLabels ?? classifyTelegramContextLabels(text);
  if (labels.some((label) => RELEVANT_CONTEXT_LABELS.has(label))) {
    return true;
  }

  const workout = normalizeWorkoutReference(text);
  return workout.kind !== "unknown" && workout.confidence !== "low";
}

function mapMoveActionFailureReasonToLogReason(reason: string): string {
  if (reason === "not_explicit_move_request") {
    return "no_move_intent";
  }

  return reason;
}

export function resolveTrainingPeaksMessageIntentLogStatus(input: {
  reason:
    | "student_not_found"
    | "not_move_request"
    | "no_target_day"
    | "ambiguous_target_day"
    | "empty_text"
    | "not_explicit_move_request"
    | "needs_clarification"
    | "parse_rejected";
  hasRelevance: boolean;
}): TrainingPeaksMessageIntentLogStatus | null {
  const { reason, hasRelevance } = input;

  if (reason === "empty_text") {
    return null;
  }

  if (reason === "student_not_found") {
    return hasRelevance ? "student_not_found" : null;
  }

  if (reason === "needs_clarification") {
    return hasRelevance ? "needs_review" : null;
  }

  if (reason === "not_explicit_move_request") {
    return hasRelevance ? "unrecognized" : null;
  }

  if (
    reason === "parse_rejected" ||
    reason === "not_move_request" ||
    reason === "no_target_day" ||
    reason === "ambiguous_target_day"
  ) {
    return hasRelevance ? "parse_failed" : null;
  }

  return hasRelevance ? "parse_failed" : null;
}

export async function logTrainingPeaksMessageIntentDecision(
  input: LogTrainingPeaksMessageIntentDecisionInput
): Promise<void> {
  try {
    const textFields = buildIntentLogTextFields(input.rawText ?? null);

    await insertTrainingPeaksMessageIntentLog({
      source: input.source ?? "telegram_business",
      studentId: input.studentId ?? null,
      telegramChatId: input.telegramChatId ?? null,
      telegramUserId: input.telegramUserId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      businessConnectionId: input.businessConnectionId ?? null,
      messageThreadId: input.messageThreadId ?? null,
      rawText: null,
      textPreview: textFields.textPreview,
      textSha256: textFields.textSha256,
      normalizedText: input.normalizedText ?? textFields.normalizedText,
      ruleIntent: input.ruleIntent ?? null,
      ruleConfidence: input.ruleConfidence ?? null,
      aiIntent: input.aiIntent ?? null,
      aiConfidence: input.aiConfidence ?? null,
      finalIntent: input.finalIntent ?? null,
      status: input.status,
      actionId: input.actionId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.warn("Failed to log TrainingPeaks message intent decision", {
      status: input.status,
      telegramChatId: input.telegramChatId,
      telegramMessageId: input.telegramMessageId,
      error,
    });
  }
}

export async function logTrainingPeaksBusinessMessageIntentDecision(input: {
  chatId: string;
  messageId: string | number;
  userId: string | null;
  businessConnectionId: string;
  messageThreadId?: number | null;
  messageText: string;
  contextLabels: TrainingPeaksTelegramContextLabel[];
  moveActionResult: CreateTrainingPeaksMoveWorkoutActionFromTelegramResult;
}): Promise<void> {
  const baseFields = {
    source: "telegram_business",
    telegramChatId: input.chatId,
    telegramUserId: input.userId,
    telegramMessageId: String(input.messageId),
    businessConnectionId: input.businessConnectionId,
    messageThreadId: input.messageThreadId ?? null,
    rawText: input.messageText,
    metadata: {
      contextLabels: input.contextLabels,
    },
  };

  if (input.moveActionResult.ok) {
    const confidence = Number(input.moveActionResult.action.confidence);
    await logTrainingPeaksMessageIntentDecision({
      ...baseFields,
      studentId: input.moveActionResult.student.id,
      status: "action_created",
      actionId: input.moveActionResult.action.id,
      ruleIntent: input.moveActionResult.parsed,
      ruleConfidence: Number.isFinite(confidence) ? confidence : null,
      finalIntent: input.moveActionResult.parsed,
      reason: null,
    });
    return;
  }

  const hasRelevance = hasTrainingPeaksMessageIntentLoggingRelevance(
    input.messageText,
    input.contextLabels
  );
  const status = resolveTrainingPeaksMessageIntentLogStatus({
    reason: input.moveActionResult.reason,
    hasRelevance,
  });

  if (!status) {
    return;
  }

  await logTrainingPeaksMessageIntentDecision({
    ...baseFields,
    studentId: input.moveActionResult.student?.id ?? null,
    status,
    reason: mapMoveActionFailureReasonToLogReason(input.moveActionResult.reason),
  });
}
