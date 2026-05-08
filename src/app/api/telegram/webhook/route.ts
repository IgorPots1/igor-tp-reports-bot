import { parseTelegramUpdate } from "@/features/telegram/parser";
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
import type { TelegramUpdate } from "@/features/telegram/types";

export const runtime = "nodejs";

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

function unauthorizedResponse() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 401,
    headers: jsonHeaders,
  });
}

function isTelegramWebhookRequestAuthorized(request: Request): boolean {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    if (process.env.NODE_ENV === "development" && !hasLoggedMissingWebhookSecretWarning) {
      hasLoggedMissingWebhookSecretWarning = true;
      console.warn(
        "Telegram webhook secret verification is disabled because TELEGRAM_WEBHOOK_SECRET is not set."
      );
    }

    return true;
  }

  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
  return incomingSecret === webhookSecret;
}

export async function GET() {
  return okResponse();
}

export async function POST(request: Request) {
  if (!isTelegramWebhookRequestAuthorized(request)) {
    console.warn("Telegram webhook rejected: invalid secret token");
    return unauthorizedResponse();
  }

  let update: TelegramUpdate | null = null;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    console.warn("Telegram webhook received invalid JSON payload");
    return okResponse();
  }

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
    console.info("Telegram business message received", {
      businessConnectionId: update.business_message.business_connection_id,
      chatId: update.business_message.chat?.id,
      text: update.business_message.text ?? update.business_message.caption,
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
    console.info("Telegram edited business message received", {
      businessConnectionId: update.edited_business_message.business_connection_id,
      chatId: update.edited_business_message.chat?.id,
      text: update.edited_business_message.text ?? update.edited_business_message.caption,
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

  if (HELP_COMMAND_PATTERN.test(messageText)) {
    await handleTrainingPeaksTelegramHelp(parsedMessage);
    return okResponse();
  }

  if (START_COMMAND_PATTERN.test(messageText)) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, "/tp");
    return okResponse();
  }

  if ((await handleTrainingPeaksTelegramReplyKeyboardMessage(parsedMessage, messageText)) === "handled") {
    return okResponse();
  }

  if (isTrainingPeaksCommand(messageText)) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, messageText);
    return okResponse();
  }

  await sendTelegramMessage(parsedMessage.chatId, UNKNOWN_COMMAND_MESSAGE);

  return okResponse();
}
