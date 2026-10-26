/**
 * Очередь уведомлений — настоящие зависимости: база и ТЕ ЖЕ функции отправки,
 * что у кнопок админки (notifyWeekReleased, deliverCoachMessage). Своего
 * текста у очереди нет; заслоны — их же: INTERVALS_COACH_SEND_ENABLED,
 * telegram_delivery_enabled, чат, пауза, «сегодня этим видом уже уведомляли».
 */
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { todayIsoInZone } from "../loop/clock";
import { deliverCoachMessage, notifyWeekReleased } from "../loop/coach-message";
import { markCoachMessageDelivered, markCoachMessageVisibleToStudent } from "../loop/repository";
import { weekNoticeOf } from "../loop/week-notice";
import { planPageEntry } from "../plan-page/links";

import { outcomeOf, type OutboxDeps, type OutboxRow, type Outcome } from "./process";

type Client = ReturnType<typeof createSupabaseServerClient>;

export function isNotifyOutboxEnabled(): boolean {
  return process.env.INTERVALS_NOTIFY_OUTBOX_ENABLED === "true";
}

export function realOutboxDeps(input: { now?: Date; log?: (line: string) => void; client?: Client }): OutboxDeps {
  const supabase = input.client ?? createSupabaseServerClient();
  return {
    enabled: isNotifyOutboxEnabled(),
    now: input.now ?? new Date(),
    log: input.log,

    async listPending() {
      const { data, error } = await supabase
        .from("intervals_notify_outbox")
        .select("id, source_id, kind, plan_week_id, coach_message_id, requested_at, attempts")
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(100);
      if (error) throw new Error(`intervals_notify_outbox: ${describeSupabaseError(error)}`);
      return (data ?? []).map((r) => ({
        id: String(r.id),
        sourceId: String(r.source_id),
        kind: r.kind as OutboxRow["kind"],
        planWeekId: (r.plan_week_id as string | null) ?? null,
        coachMessageId: (r.coach_message_id as string | null) ?? null,
        requestedAt: String(r.requested_at),
        attempts: Number(r.attempts ?? 0),
      }));
    },

    async countSentSince(sourceId, sinceIso) {
      const { count, error } = await supabase
        .from("intervals_notify_outbox")
        .select("id", { count: "exact", head: true })
        .eq("source_id", sourceId)
        .eq("status", "sent")
        .gte("processed_at", sinceIso);
      if (error) throw new Error(`лимит: ${describeSupabaseError(error)}`);
      return count ?? 0;
    },

    async claim(row) {
      const { data, error } = await supabase
        .from("intervals_notify_outbox")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id)
        .eq("status", "pending")
        .eq("attempts", row.attempts)
        .select("id");
      if (error) throw new Error(`claim: ${describeSupabaseError(error)}`);
      return (data ?? []).length === 1;
    },

    send: (row) => sendRow(supabase, row),

    async finish(row, outcome) {
      const { error } = await supabase
        .from("intervals_notify_outbox")
        .update({ status: outcome.status, reason: outcome.reason, processed_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending");
      if (error) throw new Error(`finish: ${describeSupabaseError(error)}`);
    },
  };
}

async function sendRow(supabase: Client, row: OutboxRow): Promise<Outcome> {
  const { data: who, error: whoError } = await supabase
    .from("student_data_sources")
    .select("trainingpeaks_students(telegram_chat_id, telegram_delivery_enabled, timezone)")
    .eq("id", row.sourceId)
    .maybeSingle();
  if (whoError) throw new Error(`ученица: ${describeSupabaseError(whoError)}`);
  const student = (who as { trainingpeaks_students: { telegram_chat_id: string | null; telegram_delivery_enabled: boolean; timezone: string | null } | null } | null)
    ?.trainingpeaks_students;
  if (!student) return { status: "failed", reason: "ученица не найдена" };
  const todayIso = todayIsoInZone(student.timezone);
  const page = await planPageEntry(row.sourceId);

  if (row.kind === "plan_ready" || row.kind === "week_updated") {
    const { data: week } = await supabase
      .from("intervals_plan_weeks")
      .select("week_start, status, released_session_count, intervals_plan_cycles(source_id)")
      .eq("id", row.planWeekId!)
      .maybeSingle();
    const w = week as { week_start: string; status: string; released_session_count: number | null; intervals_plan_cycles: { source_id: string } | null } | null;
    if (!w || w.intervals_plan_cycles?.source_id !== row.sourceId) return { status: "failed", reason: "неделя не этой ученицы" };
    if (w.status !== "released") return { status: "failed", reason: "неделя не отдана — уведомлять не о чем" };
    const result = await notifyWeekReleased({
      sourceId: row.sourceId,
      chatId: student.telegram_chat_id,
      telegramDeliveryEnabled: student.telegram_delivery_enabled === true,
      todayIso,
      // plan_ready — «План готов», week_updated — «Поправил вашу неделю»:
      // прошлый счётчик не передаём, «добавил» без доказательства не говорим.
      notice: weekNoticeOf({
        wasReleased: row.kind === "week_updated",
        sessionsBefore: null,
        sessionsAfter: w.released_session_count ?? 0,
        onPage: page !== null,
      }),
      pageUrl: page ? page({ kind: "week", weekStart: w.week_start }) : null,
    });
    return outcomeOf(result);
  }

  // coach_reply
  const { data: msg } = await supabase
    .from("intervals_coach_messages")
    .select("id, source_id, body, status, plan_session_id, checkin_id, visible_to_student_at, is_week_review")
    .eq("id", row.coachMessageId!)
    .maybeSingle();
  const m = msg as {
    id: string; source_id: string; body: string; status: string; plan_session_id: string | null;
    checkin_id: string | null; visible_to_student_at: string | null; is_week_review: boolean;
  } | null;
  if (!m || m.source_id !== row.sourceId) return { status: "failed", reason: "ответ не этой ученицы" };
  if (m.status === "sent") return { status: "skipped", reason: "ответ уже отправлен" };

  // Как кнопка «Ответить»: сначала текст становится виден на странице.
  if (!m.visible_to_student_at) await markCoachMessageVisibleToStudent(m.id);

  let aboutSession = m.plan_session_id;
  if (!aboutSession && m.checkin_id) {
    const { data: c } = await supabase.from("intervals_checkins").select("plan_session_id").eq("id", m.checkin_id).maybeSingle();
    aboutSession = (c as { plan_session_id: string | null } | null)?.plan_session_id ?? null;
  }
  const pageUrl = page
    ? page(m.is_week_review || !aboutSession ? { kind: "coach" } : { kind: "session", sessionId: aboutSession })
    : null;

  const result = await deliverCoachMessage({
    body: m.body,
    chatId: student.telegram_chat_id,
    telegramDeliveryEnabled: student.telegram_delivery_enabled === true,
    pageUrl,
    sourceId: row.sourceId,
    todayIso,
  });
  if (result.kind === "sent") {
    await markCoachMessageDelivered({ messageId: m.id, status: "sent", chatId: result.chatId, telegramMessageId: null });
  }
  return outcomeOf(result);
}
