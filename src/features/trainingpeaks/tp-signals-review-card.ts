import type { TelegramInlineKeyboardMarkup } from "@/features/telegram/types";
import type { TpSignalExplainRecord } from "@/features/trainingpeaks/tp-signals-explain-helpers";
import {
  formatTpSignalCategoryLabel,
  formatTpSignalReviewDebugIdLine,
  formatTpSignalReviewQueueReason,
  formatTpSignalReviewStateLabel,
  formatTpSignalReviewWhatHappened,
  TP_SIGNAL_REVIEW_CONTEXT_FALLBACK,
} from "@/features/trainingpeaks/tp-signals-review-coach-labels";
import type { TpSignalReviewQueueBucket } from "@/features/trainingpeaks/tp-signals-review-queue-helpers";
import type { TrainingPeaksOperationalSignalReviewDecisionName } from "@/features/trainingpeaks/repository";

export const TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX = "tp:rvq:a:";
export const TP_SIGNAL_REVIEW_CALLBACK_KEEP_VISIBLE_PREFIX = "tp:rvq:k:";
export const TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX = "tp:rvq:h:";
export const TP_SIGNAL_REVIEW_CALLBACK_FOLLOWUP_PREFIX = "tp:rvq:f:";
export const TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX = "tp:rvq:c:";
export const TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SEEN_PREFIX = "tp:rvq:s:";

const TELEGRAM_MESSAGE_SOFT_LIMIT = 3900;

export type ParsedTpSignalReviewCallback =
  | { kind: "acknowledged"; signalIdPrefix: string }
  | { kind: "keep_visible"; signalIdPrefix: string }
  | { kind: "hide_from_queue"; signalIdPrefix: string }
  | { kind: "needs_manual_followup"; signalIdPrefix: string }
  | { kind: "close_signal"; signalIdPrefix: string }
  | { kind: "close_candidate_seen"; signalIdPrefix: string };

export type FormatTpSignalReviewCardInput = {
  bucket: TpSignalReviewQueueBucket;
  studentName: string;
  category: string;
  signalType?: string;
  reason: string;
  sourcePreview?: string | null;
  lifecycleReason?: string | null;
  explainRecord?: Pick<
    TpSignalExplainRecord,
    | "normalized_dates"
    | "source_snippets"
    | "latest_positive_evidence"
    | "latest_negative_evidence"
    | "visible_output"
  > | null;
  state: string;
  signalShortId: string;
};

function truncateForTelegram(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatTpSignalReviewCardText(input: FormatTpSignalReviewCardInput): string {
  const categoryLabel = formatTpSignalCategoryLabel(input.category);
  const whatHappened =
    formatTpSignalReviewWhatHappened({
      bucket: input.bucket,
      category: input.category,
      signalType: input.signalType ?? input.category,
      sourcePreview: input.sourcePreview,
      explainRecord: input.explainRecord,
    }) || TP_SIGNAL_REVIEW_CONTEXT_FALLBACK;
  const queueReason = formatTpSignalReviewQueueReason({
    bucket: input.bucket,
    category: input.category,
    reason: input.reason,
    lifecycleReason: input.lifecycleReason,
  });
  const stateLabel = formatTpSignalReviewStateLabel(input.state, input.bucket);
  const debugIdLine = formatTpSignalReviewDebugIdLine(input.signalShortId);

  const lines: string[] = [];

  if (input.bucket === "review_required") {
    lines.push("🟡 Проверить сигнал", "", `👤 ${input.studentName}`, `Категория: ${categoryLabel}`);
  } else {
    lines.push("🔵 Можно закрыть после проверки", "", `👤 ${input.studentName}`, `Категория: ${categoryLabel}`);
  }

  lines.push("", "Что произошло:", truncateForTelegram(whatHappened, 240));
  lines.push("", "Почему в очереди:", truncateForTelegram(queueReason, 240));
  lines.push("", "Состояние:", stateLabel);

  if (debugIdLine) {
    lines.push("", debugIdLine);
  }

  const fullText = lines.join("\n");
  if (fullText.length <= TELEGRAM_MESSAGE_SOFT_LIMIT) {
    return fullText;
  }

  return truncateForTelegram(fullText, TELEGRAM_MESSAGE_SOFT_LIMIT);
}

type InlineButton = { text: string; callback_data: string };

function createInlineKeyboardMarkup(rows: InlineButton[][]): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

export function getTpSignalReviewCardMarkup(
  bucket: TpSignalReviewQueueBucket,
  signalIdShort: string
): TelegramInlineKeyboardMarkup {
  if (bucket === "review_required") {
    return createInlineKeyboardMarkup([
      [
        {
          text: "✅ Актуально",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX}${signalIdShort}`,
        },
        {
          text: "✅ Закрыть сигнал",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX}${signalIdShort}`,
        },
      ],
      [
        {
          text: "🙈 Это шум",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX}${signalIdShort}`,
        },
        {
          text: "📝 Проверить позже",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_FOLLOWUP_PREFIX}${signalIdShort}`,
        },
      ],
    ]);
  }

  return createInlineKeyboardMarkup([
    [
      {
        text: "✅ Закрыть сигнал",
        callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX}${signalIdShort}`,
      },
      {
        text: "👀 Оставить активным",
        callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_KEEP_VISIBLE_PREFIX}${signalIdShort}`,
      },
    ],
    [
      {
        text: "📝 Проверю вручную",
        callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_FOLLOWUP_PREFIX}${signalIdShort}`,
      },
    ],
  ]);
}

function parseSignalIdPrefix(data: string, prefix: string): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }
  const signalIdPrefix = data.slice(prefix.length).trim().toLowerCase();
  return signalIdPrefix ? signalIdPrefix : null;
}

export function parseTpSignalReviewCallback(data: string | null): ParsedTpSignalReviewCallback | null {
  if (!data) {
    return null;
  }

  const closeSignal = parseSignalIdPrefix(data, TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SIGNAL_PREFIX);
  if (closeSignal) {
    return { kind: "close_signal", signalIdPrefix: closeSignal };
  }

  const acknowledged = parseSignalIdPrefix(data, TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX);
  if (acknowledged) {
    return { kind: "acknowledged", signalIdPrefix: acknowledged };
  }

  const keepVisible = parseSignalIdPrefix(data, TP_SIGNAL_REVIEW_CALLBACK_KEEP_VISIBLE_PREFIX);
  if (keepVisible) {
    return { kind: "keep_visible", signalIdPrefix: keepVisible };
  }

  const hide = parseSignalIdPrefix(data, TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX);
  if (hide) {
    return { kind: "hide_from_queue", signalIdPrefix: hide };
  }

  const followup = parseSignalIdPrefix(data, TP_SIGNAL_REVIEW_CALLBACK_FOLLOWUP_PREFIX);
  if (followup) {
    return { kind: "needs_manual_followup", signalIdPrefix: followup };
  }

  const closeSeen = parseSignalIdPrefix(data, TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SEEN_PREFIX);
  if (closeSeen) {
    return { kind: "close_candidate_seen", signalIdPrefix: closeSeen };
  }

  return null;
}

export function extractTpSignalReviewShortIdFromCoachText(text: string): string | null {
  const hashMatch = text.match(/#([0-9a-f]{8})\b/i);
  if (hashMatch?.[1]) {
    return hashMatch[1].toLowerCase();
  }

  const idMatch = text.match(/\bID:\s*([0-9a-f]{8})\b/i);
  if (idMatch?.[1]) {
    return idMatch[1].toLowerCase();
  }

  return null;
}

export function mapTpSignalReviewCallbackToDecision(
  callback: ParsedTpSignalReviewCallback
): TrainingPeaksOperationalSignalReviewDecisionName {
  switch (callback.kind) {
    case "acknowledged":
      return "acknowledged";
    case "keep_visible":
      return "keep_visible";
    case "hide_from_queue":
      return "hide_from_queue";
    case "close_candidate_seen":
      return "close_candidate_seen";
    case "close_signal":
      return "close_signal";
    case "needs_manual_followup":
      return "needs_manual_followup";
  }
}

export function isTpSignalReviewCallbackData(data: string | null | undefined): boolean {
  return Boolean(data && data.startsWith("tp:rvq:"));
}
