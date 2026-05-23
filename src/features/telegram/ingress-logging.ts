import type { TelegramChatType, TelegramUpdate } from "@/features/telegram/types";
import { buildTelegramContextTextPreview } from "@/features/trainingpeaks/telegram-context";

function getTelegramUpdateTopLevelKeys(update: TelegramUpdate): string[] {
  return Object.keys(update).filter((key) => update[key as keyof TelegramUpdate] !== undefined);
}

function getTelegramUpdateChatContext(update: TelegramUpdate): {
  chatId: number | null;
  chatType: TelegramChatType | null;
  chatTitle: string | null;
  fromId: number | null;
  fromUsername: string | null;
  isTopicMessage: boolean | null;
  messageThreadId: number | null;
  hasForumTopicCreated: boolean;
  hasForumTopicEdited: boolean;
  hasForumTopicClosed: boolean;
  hasForumTopicReopened: boolean;
  textPrefix: string | null;
} {
  const message =
    update.message ??
    update.business_message ??
    update.edited_business_message ??
    update.callback_query?.message ??
    null;
  const from =
    update.message?.from ??
    update.business_message?.from ??
    update.callback_query?.from ??
    null;
  const chat = message?.chat ?? update.deleted_business_messages?.chat ?? null;
  const chatType = chat?.type ?? null;
  const text = message?.text ?? message?.caption ?? null;

  let textPrefix: string | null = null;
  if (text) {
    textPrefix = buildTelegramContextTextPreview(text);
  }

  return {
    chatId: chat?.id ?? null,
    chatType,
    chatTitle: chatType === "group" || chatType === "supergroup" ? (chat?.title ?? null) : null,
    fromId: from?.id ?? null,
    fromUsername: from?.username ?? null,
    isTopicMessage: typeof message?.is_topic_message === "boolean" ? message.is_topic_message : null,
    messageThreadId:
      typeof message?.message_thread_id === "number" && Number.isFinite(message.message_thread_id)
        ? message.message_thread_id
        : null,
    hasForumTopicCreated: message?.forum_topic_created !== undefined,
    hasForumTopicEdited: message?.forum_topic_edited !== undefined,
    hasForumTopicClosed: message?.forum_topic_closed !== undefined,
    hasForumTopicReopened: message?.forum_topic_reopened !== undefined,
    textPrefix,
  };
}

export function logTelegramUpdateIngress(update: TelegramUpdate): void {
  const chatContext = getTelegramUpdateChatContext(update);

  console.info("Telegram update ingress", {
    updateId: update.update_id,
    updateKeys: getTelegramUpdateTopLevelKeys(update),
    ...chatContext,
  });
}
