"use server";

import { revalidatePath } from "next/cache";

import { todayIsoInCoachTimezone } from "@/features/intervals/loop/clock";
import {
  buildCoachMessageContext,
  deliverCoachMessage,
} from "@/features/intervals/loop/coach-message";
import {
  getProgression,
  getSessionById,
  listActivitiesInRange,
  listCheckins,
  markCoachMessageDelivered,
  markCoachMessageVisibleToStudent,
  publishCycle,
  saveCoachMessage,
} from "@/features/intervals/loop/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

// Действия тренера. КАЖДОЕ вызывается кнопкой — ни одно не срабатывает само.

export async function publishPlanAction(formData: FormData): Promise<void> {
  const studentUuid = String(formData.get("studentUuid") ?? "");
  const cycleId = String(formData.get("cycleId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!studentUuid || !cycleId || !sourceId) return;

  await publishCycle(cycleId, sourceId, "coach:admin");
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
