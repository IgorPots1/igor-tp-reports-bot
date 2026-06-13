import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import {
  formatTpSignalReviewCardText,
  getTpSignalReviewCardMarkup,
  mapTpSignalReviewCallbackToDecision,
  type ParsedTpSignalReviewCallback,
} from "@/features/trainingpeaks/tp-signals-review-card";
import {
  isTpSignalReviewQueueBucket,
  type TpSignalReviewQueueItem,
} from "@/features/trainingpeaks/tp-signals-review-queue-helpers";
import {
  dismissOperationalSignalByReviewQueue,
  getTrainingPeaksOperationalSignalByIdPrefix,
  getTrainingPeaksStudentById,
  insertTrainingPeaksOperationalSignalReviewDecision,
  markOperationalSignalResolvedByReviewQueue,
  type TrainingPeaksOperationalSignalReviewDecisionBucket,
  type TrainingPeaksOperationalSignalReviewDecisionName,
  type TrainingPeaksOperationalSignalReviewQueueMutationResult,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  shouldAttemptTpSignalReviewQueueMutation,
} from "@/features/trainingpeaks/tp-signals-review-mutations";
import {
  editTelegramMessageText,
  sendTelegramMessageReturningId,
  type SendTelegramMessageResult,
} from "@/features/telegram/telegram-client";
import type { TelegramInlineKeyboardMarkup } from "@/features/telegram/types";

const TP_SIGNAL_REVIEW_PENDING_TTL_MS = 30 * 60 * 1000;
const TP_SIGNAL_REVIEW_CALLBACK_LOG_PREFIX = "[tp-review-queue:callback]";
const BUTTONS_DISABLED_MESSAGE = "Кнопки review queue отключены флагом безопасности.";
const STALE_SIGNAL_MESSAGE =
  "Не нашёл активный сигнал. Возможно, он уже закрыт или обновился.";

export function isTrainingPeaksTpSignalReviewQueueEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueSendEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueButtonsEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueMutationsEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED?.trim() === "true";
}

export function getTrainingPeaksTpSignalReviewQueueFeatureFlags(): {
  queueEnabled: boolean;
  sendEnabled: boolean;
  buttonsEnabled: boolean;
  mutationsEnabled: boolean;
} {
  return {
    queueEnabled: isTrainingPeaksTpSignalReviewQueueEnabled(),
    sendEnabled: isTrainingPeaksTpSignalReviewQueueSendEnabled(),
    buttonsEnabled: isTrainingPeaksTpSignalReviewQueueButtonsEnabled(),
    mutationsEnabled: isTrainingPeaksTpSignalReviewQueueMutationsEnabled(),
  };
}

function logTpSignalReviewCallback(message: string): void {
  console.log(`${TP_SIGNAL_REVIEW_CALLBACK_LOG_PREFIX} ${message}`);
}

type PendingTpSignalReviewCard = {
  signalIdPrefix: string;
  bucket: TrainingPeaksOperationalSignalReviewDecisionBucket;
  expiresAt: number;
};

const pendingTpSignalReviewCardByCoachChatId = new Map<string, PendingTpSignalReviewCard>();

export type TpSignalReviewTelegramDeps = {
  getCoachChatIds?: () => string[];
  sendCoachMessage?: (
    chatId: string,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<SendTelegramMessageResult | null>;
  editCoachMessage?: (
    chatId: string,
    messageId: number,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<void>;
  answerCallback?: (callbackQueryId: string, text?: string) => Promise<void>;
  getSignalByIdPrefix?: (signalIdPrefix: string) => Promise<TrainingPeaksStudentOperationalSignal | null>;
  getStudentById?: (studentId: string) => Promise<TrainingPeaksStudent | null>;
  insertReviewDecision?: typeof insertTrainingPeaksOperationalSignalReviewDecision;
  markSignalResolvedByReviewQueue?: typeof markOperationalSignalResolvedByReviewQueue;
  dismissSignalByReviewQueue?: typeof dismissOperationalSignalByReviewQueue;
  now?: () => number;
};

type ResolvedTpSignalReviewTelegramDeps = {
  getCoachChatIds: () => string[];
  sendCoachMessage: (
    chatId: string,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<SendTelegramMessageResult | null>;
  editCoachMessage: (
    chatId: string,
    messageId: number,
    text: string,
    markup?: TelegramInlineKeyboardMarkup
  ) => Promise<void>;
  answerCallback: (callbackQueryId: string, text?: string) => Promise<void>;
  getSignalByIdPrefix: (signalIdPrefix: string) => Promise<TrainingPeaksStudentOperationalSignal | null>;
  getStudentById: (studentId: string) => Promise<TrainingPeaksStudent | null>;
  insertReviewDecision: typeof insertTrainingPeaksOperationalSignalReviewDecision;
  markSignalResolvedByReviewQueue: typeof markOperationalSignalResolvedByReviewQueue;
  dismissSignalByReviewQueue: typeof dismissOperationalSignalByReviewQueue;
  now: () => number;
};

function getDeps(deps?: TpSignalReviewTelegramDeps): ResolvedTpSignalReviewTelegramDeps {
  return {
    getCoachChatIds: deps?.getCoachChatIds ?? getTrainingPeaksCoachChatIds,
    sendCoachMessage:
      deps?.sendCoachMessage ??
      (async (chatId, text, markup) =>
        sendTelegramMessageReturningId(chatId, text, { replyMarkup: markup })),
    editCoachMessage:
      deps?.editCoachMessage ??
      (async (chatId, messageId, text, markup) => {
        await editTelegramMessageText(chatId, messageId, text, { replyMarkup: markup });
      }),
    answerCallback: deps?.answerCallback ?? (async () => undefined),
    getSignalByIdPrefix: deps?.getSignalByIdPrefix ?? getTrainingPeaksOperationalSignalByIdPrefix,
    getStudentById: deps?.getStudentById ?? getTrainingPeaksStudentById,
    insertReviewDecision: deps?.insertReviewDecision ?? insertTrainingPeaksOperationalSignalReviewDecision,
    markSignalResolvedByReviewQueue:
      deps?.markSignalResolvedByReviewQueue ?? markOperationalSignalResolvedByReviewQueue,
    dismissSignalByReviewQueue: deps?.dismissSignalByReviewQueue ?? dismissOperationalSignalByReviewQueue,
    now: deps?.now ?? (() => Date.now()),
  };
}

function cleanupExpiredPendingReviewCards(now: number): void {
  for (const [chatId, pending] of pendingTpSignalReviewCardByCoachChatId.entries()) {
    if (pending.expiresAt <= now) {
      pendingTpSignalReviewCardByCoachChatId.delete(chatId);
    }
  }
}

export function clearPendingTpSignalReviewStateForTest(): void {
  pendingTpSignalReviewCardByCoachChatId.clear();
}

export function setPendingTpSignalReviewCardForTest(input: {
  coachChatId: string;
  signalIdPrefix: string;
  bucket: TrainingPeaksOperationalSignalReviewDecisionBucket;
  expiresAt?: number;
}): void {
  pendingTpSignalReviewCardByCoachChatId.set(input.coachChatId, {
    signalIdPrefix: input.signalIdPrefix,
    bucket: input.bucket,
    expiresAt: input.expiresAt ?? Date.now() + TP_SIGNAL_REVIEW_PENDING_TTL_MS,
  });
}

export function buildTpSignalReviewCardForQueueItem(item: TpSignalReviewQueueItem): {
  text: string;
  markup: TelegramInlineKeyboardMarkup;
} {
  const text = formatTpSignalReviewCardText({
    bucket: item.bucket,
    studentName: item.item.studentName,
    category: item.item.category,
    reason: item.item.reason,
    sourcePreview: item.item.preview,
    lifecycleReason: item.item.explainRecord.why_not_closed || item.item.reason,
    state: item.item.state,
    signalShortId: item.signalShortId,
  });
  const markup = getTpSignalReviewCardMarkup(item.bucket, item.signalShortId);
  return { text, markup };
}

export type NotifyCoachTpSignalReviewQueueResult =
  | { status: "sent"; sentCount: number }
  | { status: "queue_disabled" }
  | { status: "send_disabled" }
  | { status: "nothing_to_send" };

export async function notifyCoachTpSignalReviewQueue(input: {
  items: TpSignalReviewQueueItem[];
  deps?: TpSignalReviewTelegramDeps;
}): Promise<NotifyCoachTpSignalReviewQueueResult> {
  if (!isTrainingPeaksTpSignalReviewQueueEnabled()) {
    return { status: "queue_disabled" };
  }
  if (!isTrainingPeaksTpSignalReviewQueueSendEnabled()) {
    return { status: "send_disabled" };
  }

  const sendableItems = input.items.filter(
    (item) => item.queueState === "pending" || item.queueState === "keep_visible"
  );
  if (sendableItems.length === 0) {
    return { status: "nothing_to_send" };
  }

  const deps = getDeps(input.deps);
  const coachChatIds = deps.getCoachChatIds();
  let sentCount = 0;

  for (const coachChatId of coachChatIds) {
    for (const item of sendableItems) {
      const card = buildTpSignalReviewCardForQueueItem(item);
      const sendResult = await deps.sendCoachMessage(coachChatId, card.text, card.markup);
      if (sendResult) {
        sentCount += 1;
        pendingTpSignalReviewCardByCoachChatId.set(coachChatId, {
          signalIdPrefix: item.signalShortId,
          bucket: item.bucket,
          expiresAt: deps.now() + TP_SIGNAL_REVIEW_PENDING_TTL_MS,
        });
      }
    }
  }

  return { status: "sent", sentCount };
}

function resolveReviewDecisionBucketForSignal(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  pendingBucket?: TrainingPeaksOperationalSignalReviewDecisionBucket | null;
}): TrainingPeaksOperationalSignalReviewDecisionBucket {
  if (input.pendingBucket) {
    return input.pendingBucket;
  }
  if (input.signal.requiresCoachClose) {
    return "close_candidate_review";
  }
  return "review_required";
}

function normalizeReviewDecisionForMutation(
  decision: TrainingPeaksOperationalSignalReviewDecisionName,
  callbackKind: ParsedTpSignalReviewCallback["kind"]
): TrainingPeaksOperationalSignalReviewDecisionName {
  if (callbackKind === "close_candidate_seen") {
    return "close_signal";
  }
  return decision;
}

function buildDecisionAcknowledgementText(input: {
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
  studentName: string;
  signalShortId: string;
  mutationResult?: TrainingPeaksOperationalSignalReviewQueueMutationResult | null;
  mutationsEnabled: boolean;
}): string {
  const lines: string[] = [];

  if (input.decision === "close_signal") {
    if (input.mutationResult?.updated) {
      lines.push("✅ Готово: сигнал закрыт и больше не будет показываться в /tp_signals.");
    } else if (shouldAttemptTpSignalReviewQueueMutation({
      mutationsEnabled: input.mutationsEnabled,
      decision: input.decision,
    })) {
      lines.push("⚠️ Не удалось закрыть сигнал. Проверь /tp_signals вручную.");
    } else {
      lines.push("✅ Решение сохранено: закрытие сигнала.");
      lines.push("Кнопка записана, но закрытие сигналов пока выключено.");
    }
  } else if (input.decision === "hide_from_queue") {
    if (input.mutationResult?.updated) {
      lines.push("✅ Скрыто: сигнал помечен как шум.");
    } else if (shouldAttemptTpSignalReviewQueueMutation({
      mutationsEnabled: input.mutationsEnabled,
      decision: input.decision,
    })) {
      lines.push("⚠️ Не удалось скрыть сигнал. Проверь /tp_signals вручную.");
    } else {
      lines.push("✅ Решение сохранено: скрыто из очереди.");
      if (!input.mutationsEnabled) {
        lines.push("Кнопка записана, но закрытие сигналов пока выключено.");
      }
    }
  } else {
    const labels: Partial<Record<TrainingPeaksOperationalSignalReviewDecisionName, string>> = {
      acknowledged: "✅ Решение сохранено: актуально, сигнал оставлен активным.",
      keep_visible: "👀 Ок, оставил сигнал активным.",
      close_candidate_seen: "✅ Решение сохранено: увидел close candidate.",
      needs_manual_followup: "📝 Решение сохранено: проверю позже.",
    };
    lines.push(labels[input.decision] ?? "✅ Решение сохранено.");
  }

  lines.push(`Атлет: ${input.studentName}`, `#${input.signalShortId}`);
  return lines.join("\n");
}

function buildCallbackAnswerText(input: {
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
  mutationResult?: TrainingPeaksOperationalSignalReviewQueueMutationResult | null;
  mutationsEnabled: boolean;
}): string {
  if (input.decision === "close_signal") {
    if (input.mutationResult?.updated) {
      return "Готово: сигнал закрыт";
    }
    if (shouldAttemptTpSignalReviewQueueMutation({
      mutationsEnabled: input.mutationsEnabled,
      decision: input.decision,
    })) {
      return "Не удалось закрыть сигнал";
    }
    return "Кнопка записана, но закрытие сигналов пока выключено.";
  }
  if (input.decision === "hide_from_queue") {
    if (input.mutationResult?.updated) {
      return "Скрыто: сигнал помечен как шум";
    }
    if (shouldAttemptTpSignalReviewQueueMutation({
      mutationsEnabled: input.mutationsEnabled,
      decision: input.decision,
    })) {
      return "Не удалось скрыть сигнал";
    }
    if (!input.mutationsEnabled) {
      return "Кнопка записана, но закрытие сигналов пока выключено.";
    }
  }
  if (input.decision === "keep_visible") {
    return "Ок, оставил сигнал активным";
  }
  return "Решение сохранено";
}

async function applyReviewQueueSignalMutation(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
  reviewDecisionId: string;
  deps: ResolvedTpSignalReviewTelegramDeps;
}): Promise<TrainingPeaksOperationalSignalReviewQueueMutationResult | null> {
  if (!shouldAttemptTpSignalReviewQueueMutation({
    mutationsEnabled: isTrainingPeaksTpSignalReviewQueueMutationsEnabled(),
    decision: input.decision,
  })) {
    logTpSignalReviewCallback("mutation_attempt=skipped mutations=false");
    return null;
  }

  logTpSignalReviewCallback(`mutation_attempt=yes decision=${input.decision}`);

  if (input.decision === "close_signal" || input.decision === "close_candidate_seen") {
    const result = await input.deps.markSignalResolvedByReviewQueue({
      signal: input.signal,
      reviewDecisionId: input.reviewDecisionId,
      reviewDecision: input.decision === "close_candidate_seen" ? "close_signal" : input.decision,
    });
    logTpSignalReviewCallback(
      `mutation_result=${result.updated ? "ok" : "noop"} reason=${result.reason ?? "updated"} previous=${result.previousStatus ?? "null"} new=${result.newStatus ?? "null"}`
    );
    return result;
  }

  if (input.decision === "hide_from_queue") {
    const result = await input.deps.dismissSignalByReviewQueue({
      signal: input.signal,
      reviewDecisionId: input.reviewDecisionId,
      reviewDecision: input.decision,
    });
    logTpSignalReviewCallback(
      `mutation_result=${result.updated ? "ok" : "noop"} reason=${result.reason ?? "updated"} previous=${result.previousStatus ?? "null"} new=${result.newStatus ?? "null"}`
    );
    return result;
  }

  logTpSignalReviewCallback("mutation_attempt=skipped decision=no_mutation");
  return null;
}

export async function handleTpSignalReviewCallback(input: {
  callback: ParsedTpSignalReviewCallback;
  coachChatId: string;
  coachMessageId: number;
  callbackQueryId: string;
  coachTelegramUserId?: string | null;
  deps?: TpSignalReviewTelegramDeps;
}): Promise<"handled" | "ignored"> {
  const flags = getTrainingPeaksTpSignalReviewQueueFeatureFlags();
  logTpSignalReviewCallback(
    `received prefix=tp:rvq action=${input.callback.kind} signal=${input.callback.signalIdPrefix}`
  );
  logTpSignalReviewCallback(
    `flags queue=${String(flags.queueEnabled)} buttons=${String(flags.buttonsEnabled)} mutations=${String(flags.mutationsEnabled)}`
  );

  if (!flags.queueEnabled) {
    logTpSignalReviewCallback("disabled queue=false");
    return "ignored";
  }

  const deps = getDeps(input.deps);
  cleanupExpiredPendingReviewCards(deps.now());

  if (!flags.buttonsEnabled) {
    logTpSignalReviewCallback("disabled buttons=false");
    await deps.answerCallback(input.callbackQueryId, BUTTONS_DISABLED_MESSAGE);
    return "handled";
  }

  const signal = await deps.getSignalByIdPrefix(input.callback.signalIdPrefix);
  if (!signal) {
    logTpSignalReviewCallback("signal_lookup=missing");
    await deps.answerCallback(input.callbackQueryId, STALE_SIGNAL_MESSAGE);
    return "handled";
  }

  logTpSignalReviewCallback(`signal_lookup=found signal_id=${signal.id.slice(0, 8)} status=${signal.status}`);

  if (signal.status !== "active") {
    logTpSignalReviewCallback(`signal_lookup=inactive status=${signal.status}`);
    await deps.answerCallback(input.callbackQueryId, STALE_SIGNAL_MESSAGE);
    return "handled";
  }

  const pending = pendingTpSignalReviewCardByCoachChatId.get(input.coachChatId);
  const signalShortId = signal.id.slice(0, 8).toLowerCase();
  const rawDecision = mapTpSignalReviewCallbackToDecision(input.callback);
  const decision = normalizeReviewDecisionForMutation(rawDecision, input.callback.kind);
  const bucket = resolveReviewDecisionBucketForSignal({
    signal,
    pendingBucket: pending?.signalIdPrefix === signalShortId ? pending.bucket : null,
  });

  if (!isTpSignalReviewQueueBucket(bucket)) {
    logTpSignalReviewCallback(`decision_write=blocked bucket=${bucket}`);
    await deps.answerCallback(input.callbackQueryId, STALE_SIGNAL_MESSAGE);
    return "handled";
  }

  logTpSignalReviewCallback(`decision_write=attempt decision=${decision} bucket=${bucket}`);

  const insertedDecision = await deps.insertReviewDecision({
    signalId: signal.id,
    studentId: signal.studentId,
    bucket,
    decision,
    decisionSource: "telegram_button",
    coachTelegramUserId: input.coachTelegramUserId ?? input.coachChatId,
    callbackShortId: signalShortId,
    metadata: {
      coach_chat_id: input.coachChatId,
      coach_message_id: input.coachMessageId,
      signal_status_at_decision: signal.status,
      signal_lifecycle_state_at_decision: signal.lifecycleState,
      callback_kind: input.callback.kind,
    },
  });

  if (!insertedDecision) {
    logTpSignalReviewCallback("decision_write=failed");
    await deps.answerCallback(input.callbackQueryId, "Не удалось сохранить решение");
    return "handled";
  }

  logTpSignalReviewCallback(`decision_write=ok decision=${decision}`);

  const mutationResult = await applyReviewQueueSignalMutation({
    signal,
    decision,
    reviewDecisionId: insertedDecision.id,
    deps,
  });

  const student = await deps.getStudentById(signal.studentId);
  const studentName = student?.studentName ?? signal.studentId;
  const answerText = buildCallbackAnswerText({
    decision,
    mutationResult,
    mutationsEnabled: flags.mutationsEnabled,
  });
  await deps.answerCallback(input.callbackQueryId, answerText);
  logTpSignalReviewCallback(`answered ${mutationResult?.updated ? "ok_with_mutation" : "ok"}`);

  await deps.editCoachMessage(
    input.coachChatId,
    input.coachMessageId,
    buildDecisionAcknowledgementText({
      decision,
      studentName,
      signalShortId,
      mutationResult,
      mutationsEnabled: flags.mutationsEnabled,
    })
  );

  pendingTpSignalReviewCardByCoachChatId.delete(input.coachChatId);
  return "handled";
}

export function buildTpSignalReviewQueueDryRunPreview(input: {
  items: TpSignalReviewQueueItem[];
}): string[] {
  return input.items
    .filter((item) => item.queueState === "pending" || item.queueState === "keep_visible")
    .map((item) => buildTpSignalReviewCardForQueueItem(item).text);
}

export function isTpSignalReviewQueueItemEligible(item: {
  bucket: string;
}): boolean {
  return isTpSignalReviewQueueBucket(item.bucket as never);
}

export function logTpSignalReviewCallbackDispatch(input: {
  callbackData: string | null | undefined;
  coachChatId: string | number;
}): void {
  if (!input.callbackData?.startsWith("tp:rvq:")) {
    return;
  }
  logTpSignalReviewCallback(
    `dispatch matched coach_chat=${String(input.coachChatId)} prefix=${input.callbackData.slice(0, 16)}`
  );
}
