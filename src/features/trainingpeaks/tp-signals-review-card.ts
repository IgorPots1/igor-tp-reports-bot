import type { TelegramInlineKeyboardMarkup } from "@/features/telegram/types";
import type { TpSignalReviewQueueBucket } from "@/features/trainingpeaks/tp-signals-review-queue-helpers";

export const TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX = "tp:rvq:a:";
export const TP_SIGNAL_REVIEW_CALLBACK_KEEP_VISIBLE_PREFIX = "tp:rvq:k:";
export const TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX = "tp:rvq:h:";
export const TP_SIGNAL_REVIEW_CALLBACK_FOLLOWUP_PREFIX = "tp:rvq:f:";
export const TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SEEN_PREFIX = "tp:rvq:s:";

const TELEGRAM_MESSAGE_SOFT_LIMIT = 3900;

export type ParsedTpSignalReviewCallback =
  | { kind: "acknowledged"; signalIdPrefix: string }
  | { kind: "keep_visible"; signalIdPrefix: string }
  | { kind: "hide_from_queue"; signalIdPrefix: string }
  | { kind: "needs_manual_followup"; signalIdPrefix: string }
  | { kind: "close_candidate_seen"; signalIdPrefix: string };

export type FormatTpSignalReviewCardInput = {
  bucket: TpSignalReviewQueueBucket;
  studentName: string;
  category: string;
  reason: string;
  sourcePreview?: string | null;
  lifecycleReason?: string | null;
  state: string;
  signalShortId: string;
};

function truncateForTelegram(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function safePreview(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/gu, " ").trim();
  if (!trimmed) {
    return null;
  }
  return truncateForTelegram(trimmed, 240);
}

export function formatTpSignalReviewCardText(input: FormatTpSignalReviewCardInput): string {
  const preview = safePreview(input.sourcePreview);
  const lines: string[] = [];

  if (input.bucket === "review_required") {
    lines.push(
      "🟡 Проверить сигнал",
      "",
      `Атлет: ${input.studentName}`,
      `Тип: ${input.category}`,
      `Причина: ${truncateForTelegram(input.reason, 240)}`
    );
    if (preview) {
      lines.push(`Сообщение: ${preview}`);
    }
    lines.push(`Статус: ${input.state || "needs_review"}`);
  } else {
    lines.push(
      "🔵 Можно закрыть после проверки",
      "",
      `Атлет: ${input.studentName}`,
      `Тип: ${input.category}`,
      `Причина: ${truncateForTelegram(input.reason, 240)}`,
      `Почему можно закрыть: ${truncateForTelegram(input.lifecycleReason || input.reason, 240)}`
    );
  }

  lines.push("", `#${input.signalShortId}`);

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
          text: "✅ Учёл",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_ACKNOWLEDGED_PREFIX}${signalIdShort}`,
        },
        {
          text: "👀 Оставить в очереди",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_KEEP_VISIBLE_PREFIX}${signalIdShort}`,
        },
      ],
      [
        {
          text: "🙈 Не показывать",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX}${signalIdShort}`,
        },
        {
          text: "📝 Нужен follow-up",
          callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_FOLLOWUP_PREFIX}${signalIdShort}`,
        },
      ],
    ]);
  }

  return createInlineKeyboardMarkup([
    [
      {
        text: "✅ Увидел",
        callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_CLOSE_SEEN_PREFIX}${signalIdShort}`,
      },
      {
        text: "🙈 Не показывать",
        callback_data: `${TP_SIGNAL_REVIEW_CALLBACK_HIDE_PREFIX}${signalIdShort}`,
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
  const match = text.match(/#([0-9a-f]{8})\b/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].toLowerCase();
}

export function mapTpSignalReviewCallbackToDecision(
  callback: ParsedTpSignalReviewCallback
): "acknowledged" | "keep_visible" | "hide_from_queue" | "close_candidate_seen" | "needs_manual_followup" {
  switch (callback.kind) {
    case "acknowledged":
      return "acknowledged";
    case "keep_visible":
      return "keep_visible";
    case "hide_from_queue":
      return "hide_from_queue";
    case "close_candidate_seen":
      return "close_candidate_seen";
    case "needs_manual_followup":
      return "needs_manual_followup";
  }
}
