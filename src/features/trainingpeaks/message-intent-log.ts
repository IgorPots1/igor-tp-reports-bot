import {
  getTrainingPeaksMessageIntentLogByTelegramMessage,
  insertTrainingPeaksMessageIntentLog,
  updateTrainingPeaksMessageIntentLogAiFields,
  type TrainingPeaksMessageIntentLog,
  type TrainingPeaksMessageIntentLogStatus,
} from "@/features/trainingpeaks/repository";
import type { CreateTrainingPeaksMoveWorkoutActionFromTelegramResult } from "@/features/trainingpeaks/service";
import { isTrainingPeaksIntentAiLogOnlyEnabled, isTrainingPeaksIntentAiActive } from "@/features/trainingpeaks/intent-ai-mode";
import {
  buildTrainingPeaksAiIntentLogFields,
  classifyTrainingPeaksMoveIntentWithAi,
} from "@/features/trainingpeaks/move-workout-intent-ai";
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

const AI_LOG_ONLY_STATUSES = new Set<TrainingPeaksMessageIntentLogStatus>([
  "unrecognized",
  "parse_failed",
  "needs_review",
  "student_not_found",
]);

export function shouldRunTrainingPeaksIntentAiLogOnly(input: {
  status: TrainingPeaksMessageIntentLogStatus;
  hasRelevance: boolean;
  moveActionOk: boolean;
}): boolean {
  if (!isTrainingPeaksIntentAiLogOnlyEnabled()) {
    return false;
  }

  if (input.moveActionOk) {
    return false;
  }

  if (!input.hasRelevance) {
    return false;
  }

  return AI_LOG_ONLY_STATUSES.has(input.status);
}

async function appendTrainingPeaksIntentAiLogOnlyFields(input: {
  logEntry: TrainingPeaksMessageIntentLog | null;
  telegramChatId: string;
  telegramMessageId: string;
  normalizedText: string | null;
  textPreview: string | null;
  studentLinked: boolean;
}): Promise<TrainingPeaksMessageIntentLog | null> {
  const aiResult = await classifyTrainingPeaksMoveIntentWithAi({
    normalizedText: input.normalizedText ?? "",
    textPreview: input.textPreview ?? "",
    studentLinked: input.studentLinked,
  });
  const aiFields = buildTrainingPeaksAiIntentLogFields({ result: aiResult });

  const logId =
    input.logEntry?.id ??
    (
      await getTrainingPeaksMessageIntentLogByTelegramMessage(
        input.telegramChatId,
        input.telegramMessageId
      )
    )?.id;

  if (!logId) {
    return null;
  }

  return updateTrainingPeaksMessageIntentLogAiFields(logId, aiFields);
}

export async function logTrainingPeaksMessageIntentDecision(
  input: LogTrainingPeaksMessageIntentDecisionInput
): Promise<TrainingPeaksMessageIntentLog | null> {
  try {
    const textFields = buildIntentLogTextFields(input.rawText ?? null);

    return await insertTrainingPeaksMessageIntentLog({
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
    return null;
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

  const textFields = buildIntentLogTextFields(input.messageText);
  const logEntry = await logTrainingPeaksMessageIntentDecision({
    ...baseFields,
    studentId: input.moveActionResult.student?.id ?? null,
    status,
    reason: mapMoveActionFailureReasonToLogReason(input.moveActionResult.reason),
  });

  if (
    !shouldRunTrainingPeaksIntentAiLogOnly({
      status,
      hasRelevance,
      moveActionOk: false,
    })
  ) {
    return;
  }

  try {
    await appendTrainingPeaksIntentAiLogOnlyFields({
      logEntry,
      telegramChatId: input.chatId,
      telegramMessageId: String(input.messageId),
      normalizedText: textFields.normalizedText,
      textPreview: textFields.textPreview,
      studentLinked: Boolean(input.moveActionResult.student),
    });
  } catch (error) {
    console.warn("Failed to append TrainingPeaks AI intent log-only fields", {
      chatId: input.chatId,
      messageId: input.messageId,
      error,
    });
  }
}

// Phase 2 helpers — log-only intent measurement for group and private channels.
// Neither function creates move actions; they only write to trainingpeaks_message_intent_logs.
// AI classifier runs in log-only mode whenever TRAININGPEAKS_INTENT_AI_MODE is log_only or active.

function shouldRunGroupPrivateIntentAi(status: TrainingPeaksMessageIntentLogStatus): boolean {
  return (isTrainingPeaksIntentAiLogOnlyEnabled() || isTrainingPeaksIntentAiActive()) && AI_LOG_ONLY_STATUSES.has(status);
}

export async function logTrainingPeaksGroupMessageIntent(input: {
  chatId: string;
  messageId: string | number;
  userId: string | null;
  messageThreadId?: number | null;
  rawText: string;
  student: { id: string } | null;
  strictMoveIntent: boolean;
}): Promise<void> {
  const hasRelevance = hasTrainingPeaksMessageIntentLoggingRelevance(input.rawText);
  if (!hasRelevance) return;

  const status: TrainingPeaksMessageIntentLogStatus = !input.student
    ? "student_not_found"
    : input.strictMoveIntent
      ? "needs_review"  // gate passed but group never creates actions (Phase 2 observation)
      : "unrecognized";

  const textFields = buildIntentLogTextFields(input.rawText);
  const logEntry = await logTrainingPeaksMessageIntentDecision({
    source: "telegram_group",
    telegramChatId: input.chatId,
    telegramUserId: input.userId,
    telegramMessageId: String(input.messageId),
    messageThreadId: input.messageThreadId ?? null,
    rawText: input.rawText,
    studentId: input.student?.id ?? null,
    status,
    ruleIntent: { strictMoveIntent: input.strictMoveIntent },
    ruleConfidence: input.strictMoveIntent ? 1 : 0,
  });

  if (!shouldRunGroupPrivateIntentAi(status)) return;

  try {
    await appendTrainingPeaksIntentAiLogOnlyFields({
      logEntry,
      telegramChatId: input.chatId,
      telegramMessageId: String(input.messageId),
      normalizedText: textFields.normalizedText,
      textPreview: textFields.textPreview,
      studentLinked: Boolean(input.student),
    });
  } catch (error) {
    console.warn("Failed to append TrainingPeaks group AI intent log fields", {
      chatId: input.chatId,
      messageId: input.messageId,
      error,
    });
  }
}

export async function logTrainingPeaksPrivateMessageIntent(input: {
  chatId: string;
  messageId: string | number;
  userId: string | null;
  rawText: string;
  student: { id: string } | null;
  strictMoveIntent: boolean;
}): Promise<void> {
  const hasRelevance = hasTrainingPeaksMessageIntentLoggingRelevance(input.rawText);
  if (!hasRelevance) return;

  const status: TrainingPeaksMessageIntentLogStatus = !input.student
    ? "student_not_found"
    : "unrecognized";  // private non-Business never creates actions

  const textFields = buildIntentLogTextFields(input.rawText);
  const logEntry = await logTrainingPeaksMessageIntentDecision({
    source: "telegram_private",
    telegramChatId: input.chatId,
    telegramUserId: input.userId,
    telegramMessageId: String(input.messageId),
    rawText: input.rawText,
    studentId: input.student?.id ?? null,
    status,
    ruleIntent: { strictMoveIntent: input.strictMoveIntent },
    ruleConfidence: input.strictMoveIntent ? 1 : 0,
  });

  if (!shouldRunGroupPrivateIntentAi(status)) return;

  try {
    await appendTrainingPeaksIntentAiLogOnlyFields({
      logEntry,
      telegramChatId: input.chatId,
      telegramMessageId: String(input.messageId),
      normalizedText: textFields.normalizedText,
      textPreview: textFields.textPreview,
      studentLinked: Boolean(input.student),
    });
  } catch (error) {
    console.warn("Failed to append TrainingPeaks private AI intent log fields", {
      chatId: input.chatId,
      messageId: input.messageId,
      error,
    });
  }
}
