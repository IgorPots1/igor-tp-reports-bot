import type { TelegramChatType, TelegramUpdate } from "@/features/telegram/types";

function getTelegramUpdateTopLevelKeys(update: TelegramUpdate): string[] {
  return Object.keys(update).filter((key) => update[key as keyof TelegramUpdate] !== undefined);
}

function getTelegramUpdateChatContext(update: TelegramUpdate): {
  chatId: number | null;
  chatType: TelegramChatType | null;
  chatTitle: string | null;
  fromId: number | null;
  fromUsername: string | null;
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
  if (text && (chatType === "group" || chatType === "supergroup")) {
    textPrefix = text.trim().slice(0, 40);
  }

  return {
    chatId: chat?.id ?? null,
    chatType,
    chatTitle: chatType === "group" || chatType === "supergroup" ? (chat?.title ?? null) : null,
    fromId: from?.id ?? null,
    fromUsername: from?.username ?? null,
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
