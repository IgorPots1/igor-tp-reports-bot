import type { TelegramUpdate } from "@/features/telegram/types";

export type ParsedTelegramMessageUpdate = {
  kind: "message";
  updateId: number;
  chatId: number;
  userId: number | null;
  username: string | null;
  text: string | null;
  messageId: number;
};

export type ParsedTelegramCallbackUpdate = {
  kind: "callback_query";
  updateId: number;
  callbackQueryId: string;
  chatId: number;
  userId: number | null;
  username: string | null;
  messageId: number;
  messageText: string | null;
  data: string | null;
};

export type ParsedTelegramUpdate = ParsedTelegramMessageUpdate | ParsedTelegramCallbackUpdate;

export function parseTelegramUpdate(
  update: TelegramUpdate
): ParsedTelegramUpdate | null {
  const callbackQuery = update.callback_query;

  if (callbackQuery?.message) {
    return {
      kind: "callback_query",
      updateId: update.update_id,
      callbackQueryId: callbackQuery.id,
      chatId: callbackQuery.message.chat.id,
      userId: callbackQuery.from?.id ?? null,
      username: callbackQuery.from?.username ?? null,
      messageId: callbackQuery.message.message_id,
      messageText: callbackQuery.message.text?.trim() || callbackQuery.message.caption?.trim() || null,
      data: callbackQuery.data?.trim() || null,
    };
  }

  const message = update.message;
  const text = message?.text?.trim() || message?.caption?.trim() || null;

  if (!message) {
    return null;
  }

  return {
    kind: "message",
    updateId: update.update_id,
    chatId: message.chat.id,
    userId: message.from?.id ?? null,
    username: message.from?.username ?? null,
    text,
    messageId: message.message_id,
  };
}
