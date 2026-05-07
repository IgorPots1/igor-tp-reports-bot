import { parseTelegramUpdate } from "@/features/telegram/parser";
import {
  answerTelegramCallbackQuery,
  sendTelegramMessage,
} from "@/features/telegram/telegram-client";
import {
  getTrainingPeaksHelpLines,
  handleTrainingPeaksTelegramCallback,
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
const TP_ONLY_MESSAGE =
  "Этот бот только для TrainingPeaks отчётов. Используй /help.";
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

function getTrainingPeaksHelpMessage(): string {
  return ["Команды бота:", "/help — помощь", "/start — помощь", "", ...getTrainingPeaksHelpLines()].join("\n");
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

  if (HELP_COMMAND_PATTERN.test(messageText) || START_COMMAND_PATTERN.test(messageText)) {
    await sendTelegramMessage(parsedMessage.chatId, getTrainingPeaksHelpMessage());
    return okResponse();
  }

  if (isTrainingPeaksCommand(messageText)) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, messageText);
    return okResponse();
  }

  await sendTelegramMessage(parsedMessage.chatId, TP_ONLY_MESSAGE);

  return okResponse();
}
