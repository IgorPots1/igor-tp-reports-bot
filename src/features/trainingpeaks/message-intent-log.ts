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

/**
 * Rows written only so that a rejection leaves a trace ("Спасибо", "Хорошо", emoji). They exist for
 * debugging recall, and they must NEVER raise a coach case — the triage queue is read by a human.
 *
 * Load-bearing: the business handler falls back to the intent-log row's status when it cannot derive
 * one locally, so without this guard every piece of chatter would open an `unrecognized_intent` case.
 */
export function isLowRelevanceTrainingPeaksIntentLog(
  log: { metadata?: unknown } | null | undefined
): boolean {
  const metadata = log?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as Record<string, unknown>).lowRelevance === true;
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
    | "no_such_workout_not_a_move"
    | "parse_rejected";
  hasRelevance: boolean;
}): TrainingPeaksMessageIntentLogStatus | null {
  const { reason, hasRelevance } = input;

  if (reason === "empty_text") {
    return null;
  }

  if (reason === "no_such_workout_not_a_move") {
    // Not a move (add request / already planned) — log as unrecognized when relevant, else drop.
    return hasRelevance ? "unrecognized" : null;
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
  const logOnly = isTrainingPeaksIntentAiLogOnlyEnabled();
  const active = isTrainingPeaksIntentAiActive();
  if (!logOnly && !active) {
    return false;
  }

  // A SUCCESSFUL parse is the case most worth measuring. The rule engine can only ever emit ONE
  // move, so "rule saw 1, AI saw 2" is exactly the silent-halving signal (Nadezhda, 2026-07-14).
  // Successes used to be skipped here, which is why that case was invisible. Nothing else runs the
  // classifier on success — the recall path only fires on failures — so this adds no double call.
  if (input.moveActionOk) {
    return true;
  }

  // Failures: log_only only. In active mode the recall path has already classified this message.
  if (!logOnly) {
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
      // Full message text, on purpose (Igor's call, 2026-07-14). It used to be dropped and only a
      // 120-char preview kept, which made every recognition failure impossible to debug after the
      // fact — you could see THAT a message was rejected but not WHAT the student actually wrote.
      rawText: input.rawText ?? null,
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

  const textFields = buildIntentLogTextFields(input.messageText);
  const hasRelevance = hasTrainingPeaksMessageIntentLoggingRelevance(
    input.messageText,
    input.contextLabels
  );

  let logEntry: TrainingPeaksMessageIntentLog | null = null;
  let status: TrainingPeaksMessageIntentLogStatus;

  if (input.moveActionResult.ok) {
    const confidence = Number(input.moveActionResult.action.confidence);
    status = "action_created";
    logEntry = await logTrainingPeaksMessageIntentDecision({
      ...baseFields,
      studentId: input.moveActionResult.student.id,
      status,
      actionId: input.moveActionResult.action.id,
      ruleIntent: input.moveActionResult.parsed,
      ruleConfidence: Number.isFinite(confidence) ? confidence : null,
      finalIntent: input.moveActionResult.parsed,
      reason: null,
    });
  } else if (input.moveActionResult.reason === "empty_text") {
    // Nothing was said. Nothing to log.
    return;
  } else {
    const resolved = resolveTrainingPeaksMessageIntentLogStatus({
      reason: input.moveActionResult.reason,
      hasRelevance,
    });
    // A null status used to mean "drop the row entirely" — an entire class of rejections left no
    // trace at all, so a missed move request phrased outside the labels was invisible forever.
    // Log it anyway; `lowRelevance` keeps triage able to filter the chatter back out.
    status = resolved ?? "unrecognized";
    logEntry = await logTrainingPeaksMessageIntentDecision({
      ...baseFields,
      studentId: input.moveActionResult.student?.id ?? null,
      status,
      reason: mapMoveActionFailureReasonToLogReason(input.moveActionResult.reason),
      metadata: {
        ...baseFields.metadata,
        ...(resolved ? {} : { lowRelevance: true }),
      },
    });
  }

  if (
    !shouldRunTrainingPeaksIntentAiLogOnly({
      status,
      hasRelevance,
      moveActionOk: input.moveActionResult.ok,
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
