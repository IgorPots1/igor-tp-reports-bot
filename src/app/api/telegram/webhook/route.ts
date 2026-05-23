import { parseTelegramUpdate } from "@/features/telegram/parser";
import { logTelegramUpdateIngress } from "@/features/telegram/ingress-logging";
import { buildTelegramContextTextPreview } from "@/features/trainingpeaks/telegram-context";
import {
  answerTelegramCallbackQuery,
  sendTelegramMessage,
} from "@/features/telegram/telegram-client";
import {
  handleTrainingPeaksTelegramHelp,
  handleTrainingPeaksTelegramReplyKeyboardMessage,
  handleTrainingPeaksTelegramCallback,
  handleTrainingPeaksTelegramBusinessMessage,
  handleTrainingPeaksTelegramCommand,
  isTrainingPeaksCallback,
  isTrainingPeaksCommand,
} from "@/features/telegram/trainingpeaks";
import {
  handleTrainingPeaksContextObserverMessage,
  isTrainingPeaksContextObserverEnabled,
} from "@/features/trainingpeaks/context-observer";
import { handleTrainingPeaksGroupProbe } from "@/features/trainingpeaks/group-probe";
import type { TelegramMessage, TelegramUpdate } from "@/features/telegram/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const jsonHeaders = {
  "Content-Type": "application/json",
};

const HELP_COMMAND_PATTERN = /^\/help(?:@\w+)?(?:\s+|$)/;
const START_COMMAND_PATTERN = /^\/start(?:@\w+)?(?:\s+|$)/;
const UNKNOWN_COMMAND_MESSAGE =
  "Не поняла команду. Используй кнопки внизу или отправь /start.";
let hasLoggedMissingWebhookSecretWarning = false;

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
}

function errorResponse(status: number, error: string) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: jsonHeaders,
  });
}

function isTelegramGroupChat(message: TelegramMessage): boolean {
  const chatType = message.chat.type;
  return chatType === "group" || chatType === "supergroup";
}

function getTelegramMessageTextOrCaption(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? "").trim();
}

type WebhookAuthorizationResult =
  | { authorized: true }
  | { authorized: false; status: 401 | 403; error: string; logMessage: string };

function getTelegramWebhookAuthorizationResult(request: Request): WebhookAuthorizationResult {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!webhookSecret) {
    if (isProduction) {
      return {
        authorized: false,
        status: 403,
        error: "Telegram webhook secret is required in production.",
        logMessage: "Telegram webhook rejected: TELEGRAM_WEBHOOK_SECRET is required in production",
      };
    }

    if (!hasLoggedMissingWebhookSecretWarning) {
      hasLoggedMissingWebhookSecretWarning = true;
      console.warn(
        "Telegram webhook secret verification is disabled because TELEGRAM_WEBHOOK_SECRET is not set."
      );
    }

    return { authorized: true };
  }

  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (incomingSecret !== webhookSecret) {
    return {
      authorized: false,
      status: 401,
      error: "Invalid Telegram webhook secret token.",
      logMessage: "Telegram webhook rejected: invalid secret token",
    };
  }

  return { authorized: true };
}

export async function GET() {
  return okResponse();
}

export async function POST(request: Request) {
  const authorization = getTelegramWebhookAuthorizationResult(request);

  if (!authorization.authorized) {
    console.warn(authorization.logMessage);
    return errorResponse(authorization.status, authorization.error);
  }

  let update: TelegramUpdate | null = null;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    console.warn("Telegram webhook received invalid JSON payload");
    return okResponse();
  }

  logTelegramUpdateIngress(update);

  if (update.business_connection) {
    console.info("Telegram business connection update", {
      connectionId: update.business_connection.id,
      userChatId: update.business_connection.user_chat_id,
      isEnabled: update.business_connection.is_enabled,
      canReply: update.business_connection.can_reply,
    });
    return okResponse();
  }

  if (update.business_message) {
    const businessMessageText =
      update.business_message.text ?? update.business_message.caption ?? null;

    console.info("Telegram business message received", {
      businessConnectionId: update.business_message.business_connection_id,
      chatId: update.business_message.chat?.id,
      textPreview: buildTelegramContextTextPreview(businessMessageText),
    });

    try {
      await handleTrainingPeaksTelegramBusinessMessage(update.business_message);
    } catch (error) {
      console.warn("Failed to handle Telegram business message", {
        businessConnectionId: update.business_message.business_connection_id,
        chatId: update.business_message.chat?.id,
        error,
      });
    }

    return okResponse();
  }

  if (update.edited_business_message) {
    const editedBusinessMessageText =
      update.edited_business_message.text ?? update.edited_business_message.caption ?? null;

    console.info("Telegram edited business message received", {
      businessConnectionId: update.edited_business_message.business_connection_id,
      chatId: update.edited_business_message.chat?.id,
      textPreview: buildTelegramContextTextPreview(editedBusinessMessageText),
    });
    return okResponse();
  }

  if (update.deleted_business_messages) {
    console.info("Telegram deleted business messages received", {
      businessConnectionId: update.deleted_business_messages.business_connection_id,
      chatId: update.deleted_business_messages.chat?.id,
      count: Array.isArray(update.deleted_business_messages.message_ids)
        ? update.deleted_business_messages.message_ids.length
        : 0,
    });
    return okResponse();
  }

  const parsedMessage = parseTelegramUpdate(update);

  if (!parsedMessage) {
    console.info("Telegram update ignored: no supported message or callback");
    return okResponse();
  }

  if (parsedMessage.kind === "callback_query") {
    if (isTrainingPeaksCallback(parsedMessage.data)) {
      await answerTelegramCallbackQuery(parsedMessage.callbackQueryId);
      await handleTrainingPeaksTelegramCallback(parsedMessage);
      return okResponse();
    }

    await answerTelegramCallbackQuery(parsedMessage.callbackQueryId);
    return okResponse();
  }

  const messageText = parsedMessage.text?.trim() ?? "";
  const messageChatType = update.message?.chat.type;

  if (HELP_COMMAND_PATTERN.test(messageText)) {
    await handleTrainingPeaksTelegramHelp(parsedMessage);
    return okResponse();
  }

  if (START_COMMAND_PATTERN.test(messageText)) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, "/tp", messageChatType);
    return okResponse();
  }

  if ((await handleTrainingPeaksTelegramReplyKeyboardMessage(parsedMessage, messageText)) === "handled") {
    return okResponse();
  }

  if (isTrainingPeaksCommand(messageText)) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, messageText, messageChatType);
    return okResponse();
  }

  const rawMessage = update.message;
  const observerEnabled = isTrainingPeaksContextObserverEnabled();

  if (rawMessage && observerEnabled) {
    try {
      const observerResult = await handleTrainingPeaksContextObserverMessage(rawMessage);
      if (observerResult.handled) {
        return okResponse();
      }
    } catch (error) {
      console.warn("TrainingPeaks context observer failed", {
        chatId: rawMessage.chat.id,
        messageId: rawMessage.message_id,
        error,
      });
    }
  }

  if (rawMessage && isTelegramGroupChat(rawMessage) && !getTelegramMessageTextOrCaption(rawMessage).startsWith("/")) {
    try {
      await handleTrainingPeaksGroupProbe(rawMessage);
    } catch (error) {
      console.warn("TrainingPeaks group probe failed", {
        chatId: rawMessage.chat.id,
        messageId: rawMessage.message_id,
        error,
      });
    }

    return okResponse();
  }

  await sendTelegramMessage(parsedMessage.chatId, UNKNOWN_COMMAND_MESSAGE);

  return okResponse();
}
