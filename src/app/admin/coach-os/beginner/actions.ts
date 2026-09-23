"use server";

import { revalidatePath } from "next/cache";

import { todayIsoInCoachTimezone, todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  buildCoachMessageContext,
  deliverCoachMessage,
  notifyPlanPublished,
} from "@/features/intervals/loop/coach-message";
import {
  getProgression,
  getSessionById,
  listActivitiesInRange,
  listCheckins,
  markCoachMessageDelivered,
  markCoachMessageVisibleToStudent,
  markPainResolved,
  publishCycle,
  saveCoachMessage,
  setPlanWeekStatus,
} from "@/features/intervals/loop/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { deleteIntervalsStudentCompletely } from "@/features/intervals/delete-student";
import { redirect } from "next/navigation";

// Действия тренера. КАЖДОЕ вызывается кнопкой — ни одно не срабатывает само.

export async function publishPlanAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const cycleId = String(formData.get("cycleId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!studentUuid || !cycleId || !sourceId) return;

  await publishCycle(cycleId, sourceId, "coach:admin");

  // СРАЗУ ГОВОРИМ ЕЙ, ЧТО ПЛАН ЕСТЬ. Иначе она узнает об этом, только если сама
  // зайдёт в приложение, то есть случайно: человек, ждущий план второй день,
  // заходит и видит «ещё готовится», хотя он уже готов.
  const supabase = createSupabaseServerClient();
  const { data: studentRow } = await supabase
    .from("trainingpeaks_students")
    .select("telegram_chat_id, telegram_delivery_enabled, timezone")
    .eq("id", studentUuid)
    .maybeSingle();
  const row = studentRow as {
    telegram_chat_id?: string | null;
    telegram_delivery_enabled?: boolean;
    timezone?: string | null;
  } | null;
  const notice = await notifyPlanPublished({
    sourceId,
    chatId: row?.telegram_chat_id ?? null,
    telegramDeliveryEnabled: row?.telegram_delivery_enabled === true,
    todayIso: todayIsoInZone(row?.timezone ?? null),
  });
  console.info("[intervals.publish] уведомление о плане", { studentUuid, result: notice.kind });

  revalidatePath(`/admin/coach-os/beginner/${studentUuid}`);
}

/**
 * Отдать текст ученице.
 *
 * Порядок намеренно такой: СНАЧАЛА сохранить текст вместе со снимком контекста,
 * ПОТОМ отдать его ученице, и только ПОТОМ пытаться уведомить в телеграм.
 * Обратный порядок терял бы корпус при каждом сбое доставки — а сбой доставки
 * как раз тот случай, когда текст особенно жалко.
 *
 * ДВА РАЗНЫХ СОБЫТИЯ [14.09.2026]. Нажатие кнопки означает «ответ готов, отдаю»:
 * текст становится виден ученице в приложении всегда. Уведомление в телеграм —
 * отдельно, и оно по-прежнему под killswitch-ем и под флагом доставки у
 * карточки. Раньше это было одним событием, и при выключенном killswitch-е
 * ответ не доходил до человека вообще нигде.
 */
/**
 * «Разобрался» — единственный ручной путь, который гасит сигнал боли.
 *
 * ПОЧЕМУ ОТПРАВКА ОТВЕТА ЭТОГО НЕ ДЕЛАЕТ. Написанный вопрос не отвечает сам на
 * себя. До 23.09.2026 сигнал гас от любого текста по чек-ину, и вышло ровно то,
 * чего опасались: тренер отправил три вопроса про пятку, сигнал исчез, а
 * ответа не было ещё трое суток и напомнить о нём стало нечему.
 *
 * Второй путь — не кнопка, а факт: следующий чек-ин БЕЗ боли снимает сигнал сам
 * (см. week-signal.ts). В базе при этом ничего не помечается: человек ничего не
 * решал, просто пробежал и не пожаловался.
 */
export async function resolvePainAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const checkinId = String(formData.get("checkinId") ?? "");
  if (!studentUuid || !checkinId) return;

  await markPainResolved(checkinId, "coach:admin");
  revalidatePath(`/admin/coach-os/beginner/${studentUuid}`);
}

export async function sendCoachMessageAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const checkinId = String(formData.get("checkinId") ?? "") || null;
  const planSessionId = String(formData.get("planSessionId") ?? "") || null;
  if (!studentUuid || !sourceId || body.length === 0) return;

  const [progression, checkins] = await Promise.all([
    getProgression(sourceId),
    listCheckins(sourceId, 40),
  ]);
  const checkin = checkinId ? (checkins.find((item) => item.id === checkinId) ?? null) : null;
  const session = planSessionId ? await getSessionById(planSessionId) : null;

  const day = checkin?.sessionDate ?? session?.sessionDate ?? todayIsoInCoachTimezone();
  const activities = await listActivitiesInRange(sourceId, day, day);
  const activity = activities[0] ?? null;

  const context = buildCoachMessageContext({ progression, session, checkin, activity });
  const saved = await saveCoachMessage({
    sourceId,
    planSessionId: session?.id ?? null,
    checkinId: checkin?.id ?? null,
    activityId: activity?.activityId ?? checkin?.activityId ?? null,
    body,
    context: context as unknown as Record<string, unknown>,
  });

  const supabase = createSupabaseServerClient();
  const { data: studentRow } = await supabase
    .from("trainingpeaks_students")
    .select("telegram_chat_id, telegram_delivery_enabled")
    .eq("id", studentUuid)
    .maybeSingle();

  // Отдаём ученице: с этого момента текст виден в приложении.
  await markCoachMessageVisibleToStudent(saved.id);

  const result = await deliverCoachMessage({
    body,
    chatId: (studentRow as { telegram_chat_id?: string | null } | null)?.telegram_chat_id ?? null,
    telegramDeliveryEnabled:
      (studentRow as { telegram_delivery_enabled?: boolean } | null)?.telegram_delivery_enabled === true,
  });

  if (result.kind === "sent") {
    await markCoachMessageDelivered({
      messageId: saved.id,
      status: "sent",
      chatId: result.chatId,
      telegramMessageId: null,
    });
  } else if (result.kind === "prepared") {
    await markCoachMessageDelivered({
      messageId: saved.id,
      status: "prepared",
      chatId: null,
      telegramMessageId: null,
    });
  }
  // При отказе строка остаётся draft — текст сохранён, доставки не было, и это
  // видно по статусу, а не додумывается.

  revalidatePath(`/admin/coach-os/beginner/${studentUuid}`);
}

/**
 * Удалить ученика совсем.
 *
 * ТРИ ЗАСЛОНА, И КАЖДЫЙ ЛОВИТ СВОЮ ОШИБКУ:
 *   1. вся админка за паролем тренера — от чужих;
 *   2. имя ученика, набранное руками, — от промаха мимо кнопки;
 *   3. функция в базе, не умеющая трогать ростер TrainingPeaks, — от ошибки
 *      в этом коде.
 *
 * Возврата нет: удалённое не восстанавливается. Поэтому перед кнопкой на экране
 * стоит пересчёт строк, а не общее «вы уверены».
 */
export async function deleteStudentAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const typedName = String(formData.get("typedName") ?? "");
  if (!studentUuid) return;

  const result = await deleteIntervalsStudentCompletely({ studentUuid, typedName });
  if (!result.ok) {
    // Отказ не молчит: он возвращается на страницу параметром и виден глазами.
    redirect(`/admin/coach-os/beginner/${studentUuid}?delete_error=${encodeURIComponent(result.reason)}`);
  }
  redirect(`/admin/coach-os/beginner?deleted=${encodeURIComponent(result.preview.studentName)}`);
}

/**
 * Отдать ОДНУ неделю ученице.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ПУБЛИКАЦИИ ЦИКЛА. Публикация цикла делает его активным;
 * видимость отдельной недели — другое решение и другой момент. Пока их не
 * разделили, любая правка будущей недели уезжала человеку мгновенно, включая
 * недоделанную: второго нажатия, которым говорят «теперь готово», не было.
 *
 * Уведомление переиспользуем то же, что и у публикации цикла: для ученицы
 * событие одно и то же — «есть неделя, которую можно смотреть».
 */
export async function releaseWeekAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const cycleId = String(formData.get("cycleId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const weekStart = String(formData.get("weekStart") ?? "");
  if (!studentUuid || !cycleId || !sourceId || !weekStart) return;

  const saved = await setPlanWeekStatus({ cycleId, weekStart, status: "released" });
  if (!saved.ok) {
    console.error("[intervals.week] неделя не отдана", { studentUuid, weekStart, error: saved.message });
    return;
  }

  const supabase = createSupabaseServerClient();
  const { data: studentRow } = await supabase
    .from("trainingpeaks_students")
    .select("telegram_chat_id, telegram_delivery_enabled, timezone")
    .eq("id", studentUuid)
    .maybeSingle();
  const row = studentRow as {
    telegram_chat_id?: string | null;
    telegram_delivery_enabled?: boolean;
    timezone?: string | null;
  } | null;
  const notice = await notifyPlanPublished({
    sourceId,
    chatId: row?.telegram_chat_id ?? null,
    telegramDeliveryEnabled: row?.telegram_delivery_enabled === true,
    todayIso: todayIsoInZone(row?.timezone ?? null),
  });
  console.info("[intervals.week] неделя отдана", { studentUuid, weekStart, result: notice.kind });

  revalidatePath(`/admin/coach-os/beginner/${studentUuid}`);
}

/** Взять неделю в работу: ученица её не видит, а в списке видно «занято». */
export async function takeWeekIntoWorkAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const cycleId = String(formData.get("cycleId") ?? "");
  const weekStart = String(formData.get("weekStart") ?? "");
  if (!studentUuid || !cycleId || !weekStart) return;
  await setPlanWeekStatus({ cycleId, weekStart, status: "editing" });
  revalidatePath(`/admin/coach-os/beginner/${studentUuid}`);
}
