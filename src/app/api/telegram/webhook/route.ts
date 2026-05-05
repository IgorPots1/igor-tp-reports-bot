import { parseTelegramUpdate } from "@/features/telegram/parser";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import {
  getTrainingPeaksHelpLines,
  handleTrainingPeaksTelegramCommand,
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

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
}

function getTrainingPeaksHelpMessage(): string {
  return ["Команды бота:", "/help — помощь", "/start — помощь", "", ...getTrainingPeaksHelpLines()].join("\n");
}

export async function GET() {
  return okResponse();
}

export async function POST(request: Request) {
  let update: TelegramUpdate | null = null;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    console.warn("Telegram webhook received invalid JSON payload");
    return okResponse();
  }

  const parsedMessage = parseTelegramUpdate(update);

  if (!parsedMessage) {
    console.info("Telegram update ignored: no message");
    return okResponse();
  }

  const messageText = parsedMessage.text?.trim() ?? "";

  if (HELP_COMMAND_PATTERN.test(messageText) || START_COMMAND_PATTERN.test(messageText)) {
    await sendTelegramMessage(parsedMessage.chatId, getTrainingPeaksHelpMessage());
    return okResponse();
  }

  if (messageText.startsWith("/tp_")) {
    await handleTrainingPeaksTelegramCommand(parsedMessage, messageText);
    return okResponse();
  }

  await sendTelegramMessage(parsedMessage.chatId, TP_ONLY_MESSAGE);

  return okResponse();
}
