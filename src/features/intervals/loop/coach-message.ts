/**
 * Текст тренера ученице: снимок контекста, доставка, killswitch.
 *
 * ГЕНЕРАЦИИ ЗДЕСЬ НЕТ. Текст пишет Игорь руками — это решение наряда, а не
 * временная заглушка: прежде чем генерировать ответ, должна появиться очередь
 * заданий с решением «что вообще сказать», а её нет. Модуль существует ради
 * двух вещей: чтобы ничего не ушло человеку случайно и чтобы пара
 * «контекст → текст» сохранилась пригодной для обучения.
 */

import { stepByIndex } from "@/features/methodology/beginner";
// STRICT, а не обычный sendTelegramMessage: тот глотает ошибку и логирует её,
// то есть тренер увидел бы «отправлено» при несостоявшейся доставке.
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

import type { ActivityRow } from "./repository";
import type { Checkin, CoachMessageContext, PlanSession, ProgressionState } from "./types";

/**
 * Killswitch доставки, ровно как у разборов (FEEDBACK_SEND_ENABLED).
 *
 * ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ. Пока выключен, «Отправить» проверяет всё до конца и
 * сохраняет текст со статусом prepared, но наружу не идёт. Два независимых
 * заслона — ручное нажатие и env — стоят потому, что цена ошибки здесь не
 * «поломанная страница», а сообщение реальному человеку от имени тренера.
 */
export function isCoachSendEnabled(): boolean {
  return process.env.INTERVALS_COACH_SEND_ENABLED === "true";
}

/**
 * Снимок контекста для корпуса.
 *
 * ЗНАЧЕНИЯ, А НЕ ССЫЛКИ. Ступень сдвинется на следующем чек-ине, план
 * перегенерируется, активность пересчитается — и ссылки будут указывать на
 * другое состояние. Пара «контекст → ответ» имеет смысл только если контекст
 * тот самый, который тренер видел, когда писал.
 */
export function buildCoachMessageContext(input: {
  progression: ProgressionState | null;
  session: PlanSession | null;
  checkin: Checkin | null;
  activity: ActivityRow | null;
}): CoachMessageContext {
  return {
    capturedAt: new Date().toISOString(),
    step: input.progression
      ? { index: input.progression.currentStep, labelRu: stepByIndex(input.progression.currentStep).labelRu }
      : null,
    methodology: input.progression
      ? { id: input.progression.methodologyId, version: input.progression.methodologyVersion }
      : null,
    plannedSession: input.session
      ? {
          date: input.session.sessionDate,
          title: input.session.title,
          minutes: input.session.minutes,
          description: input.session.description,
          movedFrom: input.session.originalSessionDate,
        }
      : null,
    checkin: input.checkin
      ? {
          date: input.checkin.sessionDate,
          effortLabel: input.checkin.effortLabel,
          effortRpe: input.checkin.effortRpe,
          pain: input.checkin.pain,
          painNote: input.checkin.painNote,
          commentText: input.checkin.commentText,
          // Само голосовое в корпус не тащим — только факт, что оно было.
          // Аудио живёт у Telegram; хранить его у себя значит хранить
          // персональные данные без нужды.
          hasVoice: input.checkin.voiceFileId !== null,
          progressionAction: input.checkin.progressionAction,
          progressionReason: input.checkin.progressionReason,
        }
      : null,
    activity: input.activity
      ? {
          activityId: input.activity.activityId,
          name: input.activity.name,
          startedAt: input.activity.startDateLocal,
          movingSeconds: input.activity.movingTimeS,
          distanceMeters: input.activity.distanceM,
          averageHeartrate: input.activity.averageHeartrate,
          dataLevel: input.activity.dataLevel,
        }
      : null,
  };
}

export type CoachSendResult =
  | { kind: "sent"; chatId: string }
  | { kind: "prepared"; reason: string }
  | { kind: "refused"; code: "no_chat" | "delivery_disabled" | "empty_body" | "failed"; messageRu: string };

/**
 * Доставка текста ученице.
 *
 * Все отказы — ЯВНЫЕ и с кодом. Молчаливый провал здесь означал бы, что тренер
 * считает сообщение отправленным, а человек его не получил: это хуже, чем
 * видимая ошибка, потому что обнаруживается через неделю на вопросе «почему ты
 * не ответил».
 */
export async function deliverCoachMessage(input: {
  body: string;
  chatId: string | null;
  telegramDeliveryEnabled: boolean;
}): Promise<CoachSendResult> {
  if (input.body.trim().length === 0) {
    return { kind: "refused", code: "empty_body", messageRu: "Пустой текст отправлять нечего." };
  }
  if (!input.chatId) {
    return {
      kind: "refused",
      code: "no_chat",
      messageRu: "У ученицы не привязан чат Telegram — отправить некуда.",
    };
  }
  if (!input.telegramDeliveryEnabled) {
    return {
      kind: "refused",
      code: "delivery_disabled",
      messageRu: "У ученицы выключена доставка в Telegram (telegram_delivery_enabled).",
    };
  }
  if (!isCoachSendEnabled()) {
    return {
      kind: "prepared",
      reason:
        "Режим подготовки: текст проверен и сохранён, но отправка выключена. " +
        "Включить: INTERVALS_COACH_SEND_ENABLED=true + передеплой.",
    };
  }

  try {
    await sendTelegramMessageStrict(input.chatId, input.body);
    return { kind: "sent", chatId: input.chatId };
  } catch (error) {
    return {
      kind: "refused",
      code: "failed",
      messageRu: `Telegram не принял сообщение: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
