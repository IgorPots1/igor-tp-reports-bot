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
  getTrainingPeaksOperationalSignalByIdPrefix,
  getTrainingPeaksStudentById,
  insertTrainingPeaksOperationalSignalReviewDecision,
  type TrainingPeaksOperationalSignalReviewDecisionBucket,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  editTelegramMessageText,
  sendTelegramMessageReturningId,
  type SendTelegramMessageResult,
} from "@/features/telegram/telegram-client";
import type { TelegramInlineKeyboardMarkup } from "@/features/telegram/types";

const TP_SIGNAL_REVIEW_PENDING_TTL_MS = 30 * 60 * 1000;
const BUTTONS_DISABLED_MESSAGE = "Кнопки review queue отключены флагом безопасности.";

export function isTrainingPeaksTpSignalReviewQueueEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueSendEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueButtonsEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED?.trim() === "true";
}

export function getTrainingPeaksTpSignalReviewQueueFeatureFlags(): {
  queueEnabled: boolean;
  sendEnabled: boolean;
  buttonsEnabled: boolean;
} {
  return {
    queueEnabled: isTrainingPeaksTpSignalReviewQueueEnabled(),
    sendEnabled: isTrainingPeaksTpSignalReviewQueueSendEnabled(),
    buttonsEnabled: isTrainingPeaksTpSignalReviewQueueButtonsEnabled(),
  };
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

function buildDecisionAcknowledgementText(input: {
  decision: ReturnType<typeof mapTpSignalReviewCallbackToDecision>;
  studentName: string;
  signalShortId: string;
}): string {
  const labels: Record<ReturnType<typeof mapTpSignalReviewCallbackToDecision>, string> = {
    acknowledged: "✅ Решение сохранено: учёл",
    keep_visible: "👀 Решение сохранено: оставлено в очереди",
    hide_from_queue: "🙈 Решение сохранено: скрыто из очереди",
    close_candidate_seen: "✅ Решение сохранено: увидел close candidate",
    needs_manual_followup: "📝 Решение сохранено: нужен ручной follow-up",
  };

  return [labels[input.decision], `Атлет: ${input.studentName}`, `#${input.signalShortId}`].join("\n");
}

export async function handleTpSignalReviewCallback(input: {
  callback: ParsedTpSignalReviewCallback;
  coachChatId: string;
  coachMessageId: number;
  callbackQueryId: string;
  coachTelegramUserId?: string | null;
  deps?: TpSignalReviewTelegramDeps;
}): Promise<"handled" | "ignored"> {
  if (!isTrainingPeaksTpSignalReviewQueueEnabled()) {
    return "ignored";
  }

  const deps = getDeps(input.deps);
  cleanupExpiredPendingReviewCards(deps.now());

  const signal = await deps.getSignalByIdPrefix(input.callback.signalIdPrefix);
  if (!signal) {
    await deps.answerCallback(input.callbackQueryId, "Сигнал не найден — обновите очередь");
    return "handled";
  }

  const pending = pendingTpSignalReviewCardByCoachChatId.get(input.coachChatId);
  const signalShortId = signal.id.slice(0, 8).toLowerCase();
  const decision = mapTpSignalReviewCallbackToDecision(input.callback);

  if (!isTrainingPeaksTpSignalReviewQueueButtonsEnabled()) {
    await deps.answerCallback(input.callbackQueryId, BUTTONS_DISABLED_MESSAGE);
    return "handled";
  }

  const bucket = resolveReviewDecisionBucketForSignal({
    signal,
    pendingBucket: pending?.signalIdPrefix === signalShortId ? pending.bucket : null,
  });

  await deps.insertReviewDecision({
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

  const student = await deps.getStudentById(signal.studentId);
  const studentName = student?.studentName ?? signal.studentId;
  await deps.answerCallback(input.callbackQueryId, "Решение сохранено");
  await deps.editCoachMessage(
    input.coachChatId,
    input.coachMessageId,
    buildDecisionAcknowledgementText({
      decision,
      studentName,
      signalShortId,
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
