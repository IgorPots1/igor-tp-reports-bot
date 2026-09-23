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
// СТРОГАЯ ОТПРАВКА, а не обычный sendTelegramMessage: тот глотает ошибку и
// логирует её, то есть тренер увидел бы «отправлено» при несостоявшейся
// доставке. sendTelegramWebAppButton бьёт наружу так же строго.
import { sendTelegramWebAppButton } from "@/features/telegram/telegram-client";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { SITE_URL } from "@/lib/site";

import type { ActivityRow } from "./repository";
import type { Checkin, CoachMessageContext, PlanSession, ProgressionState } from "./types";
import type { WeekNotice } from "./week-notice";

/**
 * Куда ведёт кнопка из любого сообщения ученице.
 *
 * ОДНО МЕСТО НА ОБА ПУТИ: «План готов» и ответ тренера открывают один и тот же
 * экран. Две копии адреса разъехались бы молча — и половина сообщений вела бы
 * не туда.
 */
function coachAppUrl(): string {
  return `${SITE_URL.replace(/\/+$/, "")}/m/run`;
}

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

/**
 * Сообщение ученице об отданной неделе — единственное, что бот шлёт по
 * действию тренера, а не по расписанию.
 *
 * ЗАЧЕМ. Тренер нажимает «Отдать ученице», и с этой секунды неделя у неё есть.
 * Узнать об этом она могла только сама открыв приложение, то есть случайно;
 * человек, который ждёт план второй день, каждый день заходит и видит «ещё
 * готовится» — а он уже готов.
 *
 * ТЕКСТ ВЫБИРАЕТ week-notice.ts, А НЕ ЭТА ФУНКЦИЯ: выбор — чистое правило про
 * «новая неделя или правка», и его надо уметь проверять без базы и телеграма.
 * Здесь остаётся доставка.
 *
 * ВИД ДЕРЖИТ ДЕДУП. Ключ (источник, вид, дата) гасит повтор в тот же день;
 * поэтому у «план готов» и «добавил тренировку» виды РАЗНЫЕ — иначе, отдав
 * новую неделю и дописав день одним днём, человек получил бы только первое.
 *
 * ПРАВИЛА ТЕ ЖЕ, ЧТО У ОТВЕТА ТРЕНЕРА: killswitch и флаг доставки у карточки.
 */
export async function notifyWeekReleased(input: {
  sourceId: string;
  chatId: string | null;
  telegramDeliveryEnabled: boolean;
  todayIso: string;
  notice: WeekNotice;
}): Promise<CoachSendResult> {
  const supabase = createSupabaseServerClient();
  const { kind: noticeKind, textRu: text } = input.notice;

  const { data: already } = await supabase
    .from("intervals_reminders")
    .select("id")
    .eq("source_id", input.sourceId)
    .eq("kind", noticeKind)
    .eq("local_date", input.todayIso)
    .limit(1);
  if ((already ?? []).length > 0) {
    return { kind: "prepared", reason: "сегодня уже уведомляли этим видом" };
  }

  let result: CoachSendResult;
  if (!input.chatId) {
    result = { kind: "refused", code: "no_chat", messageRu: "Чат не привязан — уведомить некуда." };
  } else if (!input.telegramDeliveryEnabled) {
    result = {
      kind: "refused",
      code: "delivery_disabled",
      messageRu: "У карточки выключена доставка (telegram_delivery_enabled).",
    };
  } else if (!isCoachSendEnabled()) {
    result = {
      kind: "prepared",
      reason: "Режим подготовки: INTERVALS_COACH_SEND_ENABLED выключен, наружу не ушло.",
    };
  } else {
    try {
      await sendTelegramWebAppButton({
        chatId: input.chatId,
        text,
        buttons: [
          {
            // Подпись под текст: «план готов» ведёт к плану, «добавил
            // тренировку» — туда же, но обещать «план» второй раз незачем.
            label: noticeKind === "plan_published" ? "Открыть план" : "Открыть приложение",
            webAppUrl: coachAppUrl(),
          },
        ],
      });
      result = { kind: "sent", chatId: input.chatId };
    } catch (error) {
      result = {
        kind: "refused",
        code: "failed",
        messageRu: `Telegram не принял: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // След пишем всегда: тренер должен видеть, уведомили её или нет, а не гадать.
  await supabase.from("intervals_reminders").insert({
    source_id: input.sourceId,
    kind: noticeKind,
    local_date: input.todayIso,
    status: result.kind === "sent" ? "sent" : result.kind === "prepared" ? "skipped" : "failed",
    detail: result.kind === "sent" ? null : result.kind === "prepared" ? result.reason : result.messageRu,
    chat_id: result.kind === "sent" ? result.chatId : null,
  });

  return result;
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
    /**
     * С КНОПКОЙ ВХОДА, КАК У «ПЛАН ГОТОВ» [23.09.2026].
     *
     * До этой правки ответ тренера уходил голым текстом: ни кнопки, ни
     * упоминания приложения. Живой случай 23.09 — ученица получила от бота
     * 1308 символов с тремя вопросами про боль и не имела ни одного способа
     * попасть туда, где на них отвечают, кроме как искать приложение самой.
     *
     * Кнопка та же самая, что у notifyWeekReleased, и ведёт в то же место:
     * два входа в одно приложение с разных сообщений сбивали бы с толку.
     */
    await sendTelegramWebAppButton({
      chatId: input.chatId,
      text: input.body,
      buttons: [{ label: "Открыть приложение", webAppUrl: coachAppUrl() }],
    });
    return { kind: "sent", chatId: input.chatId };
  } catch (error) {
    return {
      kind: "refused",
      code: "failed",
      messageRu: `Telegram не принял сообщение: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
