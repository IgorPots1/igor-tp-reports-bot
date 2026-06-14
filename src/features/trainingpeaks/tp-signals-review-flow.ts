import { getTrainingPeaksAttentionDigestBelgradeTodayIso } from "@/features/trainingpeaks/attention-digest-run";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import {
  listActiveTrainingPeaksMoveActions,
  listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
} from "@/features/trainingpeaks/repository";
import {
  buildOperationalSignalDisplayEvidenceMap,
  collectOperationalSignalDiagnosticItems,
} from "@/features/trainingpeaks/service";
import {
  formatTpSignalReviewCardText,
  getTpSignalReviewCardMarkup,
  mapTpSignalReviewCallbackToDecision,
  type ParsedTpSignalReviewCallback,
} from "@/features/trainingpeaks/tp-signals-review-card";
import {
  buildActiveSignalReviewBucketItems,
  isTpSignalReviewQueueBucket,
  selectTpSignalReviewQueueItems,
  type TpSignalReviewDecisionRecord,
  type TpSignalReviewQueueItem,
  type TpSignalReviewQueueSelectionSummary,
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
const TP_SIGNAL_REVIEW_MANUAL_TRIGGER_LOG_PREFIX = "[tp-review-queue:manual-trigger]";
const TP_SIGNAL_REVIEW_QUEUE_ACTIVE_SIGNAL_LIMIT = 250;
const TP_SIGNAL_REVIEW_QUEUE_MOVE_ACTION_LIMIT = 250;
const DEFAULT_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT = 5;

export const TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK = "tp:signals:review_queue:start";
export const TP_SIGNALS_REVIEW_QUEUE_LAUNCH_BUTTON_TEXT = "🔎 Разобрать спорные сигналы";
const BUTTONS_DISABLED_MESSAGE = "Кнопки review queue отключены флагом безопасности.";
const STALE_SIGNAL_MESSAGE =
  "Не нашёл активный сигнал. Возможно, он уже закрыт или обновился.";

export function isTrainingPeaksTpSignalReviewQueueEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueSendEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED?.trim() === "true";
}

export function isTrainingPeaksTpSignalReviewQueueManualSendEnabled(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED?.trim() === "true";
}

export function getTrainingPeaksTpSignalReviewQueueManualLimit(): number {
  const raw = process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT?.trim();
  if (!raw) {
    return DEFAULT_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT;
  }
  return parsed;
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
  manualSendEnabled: boolean;
  buttonsEnabled: boolean;
  mutationsEnabled: boolean;
} {
  return {
    queueEnabled: isTrainingPeaksTpSignalReviewQueueEnabled(),
    sendEnabled: isTrainingPeaksTpSignalReviewQueueSendEnabled(),
    manualSendEnabled: isTrainingPeaksTpSignalReviewQueueManualSendEnabled(),
    buttonsEnabled: isTrainingPeaksTpSignalReviewQueueButtonsEnabled(),
    mutationsEnabled: isTrainingPeaksTpSignalReviewQueueMutationsEnabled(),
  };
}

function logTpSignalReviewManualTrigger(message: string): void {
  console.log(`${TP_SIGNAL_REVIEW_MANUAL_TRIGGER_LOG_PREFIX} ${message}`);
}

export function buildTpSignalsReviewQueueLaunchMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: TP_SIGNALS_REVIEW_QUEUE_LAUNCH_BUTTON_TEXT,
          callback_data: TP_SIGNALS_REVIEW_QUEUE_START_CALLBACK,
        },
      ],
    ],
  };
}

function mapLatestReviewDecisions(
  decisions: Awaited<ReturnType<typeof listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds>>
): Map<string, TpSignalReviewDecisionRecord> {
  const mapped = new Map<string, TpSignalReviewDecisionRecord>();
  for (const [signalId, decision] of decisions.entries()) {
    mapped.set(signalId, {
      signalId: decision.signalId,
      studentId: decision.studentId,
      bucket: decision.bucket,
      decision: decision.decision,
      decisionSource: decision.decisionSource,
      coachTelegramUserId: decision.coachTelegramUserId,
      callbackShortId: decision.callbackShortId,
      createdAt: decision.createdAt,
      metadata: decision.metadata,
    });
  }
  return mapped;
}

export async function collectTpSignalReviewQueueSelection(input?: {
  asOfDate?: string;
  limit?: number;
}): Promise<TpSignalReviewQueueSelectionSummary> {
  const asOfDate = input?.asOfDate ?? getTrainingPeaksAttentionDigestBelgradeTodayIso();
  const limit = input?.limit ?? getTrainingPeaksTpSignalReviewQueueManualLimit();
  const [students, signalsResult, actions] = await Promise.all([
    listTrainingPeaksStudents(),
    listTrainingPeaksOperationalSignals({
      status: "active",
      limit: TP_SIGNAL_REVIEW_QUEUE_ACTIVE_SIGNAL_LIMIT,
    }),
    listActiveTrainingPeaksMoveActions(TP_SIGNAL_REVIEW_QUEUE_MOVE_ACTION_LIMIT),
  ]);
  const studentNameById = new Map(
    students.map((student) => [student.id, student.studentName?.trim() || student.studentId])
  );
  const signals = signalsResult.items;
  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals,
    asOfDate,
  });
  const diagnosticItems = collectOperationalSignalDiagnosticItems({
    signals,
    studentNameById,
    asOfDate,
    activeMoveActions: actions,
    displayEvidenceBySignalId,
  });
  const activeItems = buildActiveSignalReviewBucketItems({
    signals,
    diagnosticItems,
    studentNameById,
    displayEvidenceBySignalId: new Map(displayEvidenceBySignalId),
    asOfDate,
  });

  let latestDecisionsBySignalId = new Map<string, TpSignalReviewDecisionRecord>();
  try {
    const latestDecisions = await listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds(
      activeItems.map((item) => item.signalId)
    );
    latestDecisionsBySignalId = mapLatestReviewDecisions(latestDecisions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("trainingpeaks_operational_signal_review_decisions table is missing")) {
      throw error;
    }
  }

  return selectTpSignalReviewQueueItems({
    activeItems,
    latestDecisionsBySignalId,
    limit,
  });
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
    signalType: item.item.signalType,
    reason: item.item.reason,
    sourcePreview: item.item.preview,
    lifecycleReason: item.item.explainRecord.why_not_closed || item.item.reason,
    explainRecord: item.item.explainRecord,
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
  sendMode?: "auto" | "manual";
  targetCoachChatId?: string;
}): Promise<NotifyCoachTpSignalReviewQueueResult> {
  const sendMode = input.sendMode ?? "auto";

  if (!isTrainingPeaksTpSignalReviewQueueEnabled()) {
    return { status: "queue_disabled" };
  }
  if (sendMode === "manual") {
    if (!isTrainingPeaksTpSignalReviewQueueManualSendEnabled()) {
      return { status: "send_disabled" };
    }
  } else if (!isTrainingPeaksTpSignalReviewQueueSendEnabled()) {
    return { status: "send_disabled" };
  }

  const sendableItems = input.items.filter(
    (item) => item.queueState === "pending" || item.queueState === "keep_visible"
  );
  if (sendableItems.length === 0) {
    return { status: "nothing_to_send" };
  }

  const deps = getDeps(input.deps);
  const coachChatIds = input.targetCoachChatId
    ? [input.targetCoachChatId]
    : deps.getCoachChatIds();
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

export async function handleTpSignalReviewQueueManualLaunch(input: {
  coachChatId: string;
  callbackQueryId: string;
  deps?: TpSignalReviewTelegramDeps & {
    collectSelection?: () => Promise<TpSignalReviewQueueSelectionSummary>;
  };
}): Promise<"handled"> {
  logTpSignalReviewManualTrigger("received");
  const deps = getDeps(input.deps);

  if (!isTrainingPeaksTpSignalReviewQueueEnabled()) {
    logTpSignalReviewManualTrigger("disabled queue=false");
    await deps.answerCallback(input.callbackQueryId, "Review Queue сейчас выключена.");
    return "handled";
  }

  if (!isTrainingPeaksTpSignalReviewQueueManualSendEnabled()) {
    logTpSignalReviewManualTrigger("disabled manual_send=false");
    await deps.answerCallback(input.callbackQueryId, "Review Queue сейчас выключена.");
    return "handled";
  }

  const selection = input.deps?.collectSelection
    ? await input.deps.collectSelection()
    : await collectTpSignalReviewQueueSelection();
  logTpSignalReviewManualTrigger(`selected=${selection.wouldSendCount}`);

  const sendResult = await notifyCoachTpSignalReviewQueue({
    items: selection.items,
    sendMode: "manual",
    targetCoachChatId: input.coachChatId,
    deps: input.deps,
  });

  if (sendResult.status === "nothing_to_send") {
    logTpSignalReviewManualTrigger("sent=0");
    await deps.answerCallback(
      input.callbackQueryId,
      "✅ Сейчас нет спорных TP Signals для разбора."
    );
    return "handled";
  }

  if (sendResult.status !== "sent") {
    logTpSignalReviewManualTrigger(`send_status=${sendResult.status}`);
    await deps.answerCallback(input.callbackQueryId, "Review Queue сейчас выключена.");
    return "handled";
  }

  logTpSignalReviewManualTrigger(`sent=${sendResult.sentCount}`);
  await deps.answerCallback(
    input.callbackQueryId,
    formatReviewQueueManualLaunchSentMessage(sendResult.sentCount)
  );
  return "handled";
}

function formatReviewQueueManualLaunchSentMessage(sentCount: number): string {
  const lastTwo = sentCount % 100;
  const lastOne = sentCount % 10;
  let noun = "карточек";
  if (lastTwo < 11 || lastTwo > 14) {
    if (lastOne === 1) {
      noun = "карточку";
    } else if (lastOne >= 2 && lastOne <= 4) {
      noun = "карточки";
    }
  }
  return `Отправил ${sentCount} ${noun} на разбор.`;
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
