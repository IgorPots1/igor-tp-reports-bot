/**
 * Её текст боту → тренеру [решение Игоря, 21.10.2026].
 *
 * Было: бот молчал, текст ложился только в наблюдения, тренер узнавал о нём
 * случайно. Стало, для ученицы на странице плана: сообщение ложится в
 * intervals_student_messages (та же таблица, что «Написать тренеру»), тренеру
 * уходит уведомление, ей — «Передал тренеру».
 *
 * ЧЕГО НЕ ТРОГАЕМ: личку с тренером (бизнес-переписка — у неё
 * business_connection_id), группы, команды, всех без живой ссылки. Им всё
 * как было.
 */
import { listActiveStudentsByTelegramUserId } from "@/features/trainingpeaks/repository";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";

import { getStudentSourceId } from "../loop/service";

import { sendStudentMessage } from "./actions";
import { isPlanPageEnabled } from "./core";
import { getLivePlanLink } from "./links";

export const RELAYED_REPLY_RU = "Передал тренеру.";

type RawMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean };
  business_connection_id?: string;
};

/** Чистая часть: подходит ли сообщение под пересылку вообще. */
export function isRelayCandidate(message: RawMessage, isCoach: (id: number) => boolean): boolean {
  const text = message.text?.trim() ?? "";
  return (
    message.chat.type === "private" &&
    !message.business_connection_id &&
    !!message.from &&
    !message.from.is_bot &&
    message.from.id === message.chat.id &&
    !isCoach(message.from.id) &&
    text.length > 0 &&
    !text.startsWith("/")
  );
}

/** true — сообщение передано тренеру, отвечать «не поняла команду» не надо. НИКОГДА НЕ БРОСАЕТ. */
export async function relayStudentBotText(message: RawMessage, isCoach: (id: number) => boolean): Promise<boolean> {
  if (!isPlanPageEnabled() || !isRelayCandidate(message, isCoach)) return false;
  try {
    const cards = await listActiveStudentsByTelegramUserId(message.from!.id);
    const card = cards.find((c) => c.coachingPlatform === "intervals");
    if (!card) return false;
    const sourceId = await getStudentSourceId(card.id);
    if (!sourceId || !(await getLivePlanLink(sourceId))) return false;

    await sendStudentMessage(
      { sourceId, studentUuid: card.id, studentName: card.studentName },
      message.text!,
      "bot",
      String(message.message_id),
    );
    await sendTelegramMessage(message.chat.id, RELAYED_REPLY_RU);
    return true;
  } catch (error) {
    console.error("[plan-page.relay] текст боту не передан", {
      chatId: message.chat.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
