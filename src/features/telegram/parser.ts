import type { TelegramUpdate } from "@/features/telegram/types";

export type ParsedTelegramMessageUpdate = {
  kind: "message";
  updateId: number;
  chatId: number;
  chatTitle: string | null;
  userId: number | null;
  username: string | null;
  text: string | null;
  messageId: number;
  isTopicMessage: boolean | null;
  messageThreadId: number | null;
  threadTitle: string | null;
  voiceFileId: string | null;
  voiceDuration: number | null;
  voiceMimeType: string | null;
  voiceKind: "voice" | "audio" | null;
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

  const voiceFileId = message.voice?.file_id ?? message.audio?.file_id ?? null;
  const voiceDuration = message.voice?.duration ?? message.audio?.duration ?? null;
  const voiceMimeType = message.voice?.mime_type ?? message.audio?.mime_type ?? null;
  const voiceKind = message.voice ? "voice" : message.audio ? "audio" : null;

  return {
    kind: "message",
    updateId: update.update_id,
    chatId: message.chat.id,
    chatTitle: message.chat.title ?? null,
    userId: message.from?.id ?? null,
    username: message.from?.username ?? null,
    text,
    messageId: message.message_id,
    isTopicMessage:
      typeof message.is_topic_message === "boolean" ? message.is_topic_message : null,
    messageThreadId:
      typeof message.message_thread_id === "number" && Number.isFinite(message.message_thread_id)
        ? message.message_thread_id
        : null,
    threadTitle: message.forum_topic_created?.name ?? message.forum_topic_edited?.name ?? null,
    voiceFileId,
    voiceDuration,
    voiceMimeType,
    voiceKind,
  };
}
