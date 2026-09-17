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
import {
  sendTelegramMessageStrict,
  sendTelegramWebAppButton,
} from "@/features/telegram/telegram-client";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { SITE_URL } from "@/lib/site";

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

/**
 * «План готов» — единственное сообщение, которое бот шлёт по действию тренера,
 * а не по расписанию.
 *
 * ЗАЧЕМ. Тренер нажимает «Показать ученице», и с этой секунды план у неё есть.
 * Узнать об этом она могла только сама открыв приложение, то есть случайно;
 * человек, который ждёт план второй день, каждый день заходит и видит «ещё
 * готовится» — а он уже готов.
 *
 * ПРАВИЛА ТЕ ЖЕ, ЧТО У ОТВЕТА ТРЕНЕРА: killswitch и флаг доставки у карточки.
 * Плюс след в таблице напоминаний, чтобы повторное нажатие не слало второе
 * сообщение: уникальный ключ (источник, вид, дата) это и стережёт.
 */
export async function notifyPlanPublished(input: {
  sourceId: string;
  chatId: string | null;
  telegramDeliveryEnabled: boolean;
  todayIso: string;
}): Promise<CoachSendResult> {
  const supabase = createSupabaseServerClient();

  const { data: already } = await supabase
    .from("intervals_reminders")
    .select("id")
    .eq("source_id", input.sourceId)
    .eq("kind", "plan_published")
    .eq("local_date", input.todayIso)
    .limit(1);
  if ((already ?? []).length > 0) {
    return { kind: "prepared", reason: "сегодня уже уведомляли о плане" };
  }

  // БЕЗ ПРИВЯЗКИ К «СЕГОДНЯ» [решение Игоря, 17.09.2026]: план мог начаться не
  // сегодняшним днём, и «тренировка на сегодня» в тексте — обещание, которое
  // экран может тут же не выполнить (отдых сегодня — это тоже часть плана, не
  // ошибка, см. restNoteRu в student-view.ts).
  const text =
    "План готов. Откройте приложение: там ваши тренировки на неделю и кнопка " +
    "отметиться после пробежки.\n\n" +
    "Если что-то в плане не подходит по дням, тренировку можно перенести прямо там.";

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
        buttons: [{ label: "Открыть план", webAppUrl: `${SITE_URL.replace(/\/+$/, "")}/m/run` }],
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
    kind: "plan_published",
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
