/**
 * Сказать тренеру, что ученица написала. Сторона базы и телеграма.
 *
 * Правило «сейчас, утром или молчим» живёт отдельно и без базы — inbound-notice.ts.
 * Здесь только исполнение: состояние в intervals_inbound_notices и отправка.
 *
 * ── ДВА ВХОДА, ОДНО ПРАВИЛО ─────────────────────────────────────────────────
 *
 * `noticeInboundMessage` зовут из обработчика входящего сообщения — в момент,
 * когда факт произошёл. `flushPendingInboundNotices` зовёт раннер напоминаний
 * утром, чтобы отложенное ночью не пропало.
 *
 * ── ЗАСЛОНЫ ─────────────────────────────────────────────────────────────────
 *
 * Флаг INTERVALS_INBOUND_NOTICE_ENABLED выключен по умолчанию. Ошибки НИКОГДА
 * не выходят наружу: это побочный путь у чужого горячего обработчика, и уронить
 * разбор входящего сообщения ради уведомления недопустимо.
 */

import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { decideInboundNotice, inboundNoticeTextRu, isQuietHour } from "./inbound-notice";

/** Выключено по умолчанию, как и всё, что уходит наружу само. */
export function isInboundNoticeEnabled(): boolean {
  return process.env.INTERVALS_INBOUND_NOTICE_ENABLED === "true";
}

/** Час у тренера. Зона берётся одна и та же во всём контуре. */
function coachHourNow(): number {
  const zone = process.env.COACH_TIMEZONE?.trim() || "Europe/Moscow";
  return Number(
    new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "numeric", hour12: false }).format(new Date())
  );
}

type NoticeRow = {
  source_id: string;
  last_notified_at: string | null;
  pending_since: string | null;
  pending_count: number;
  pending_preview: string | null;
};

async function sendToCoach(text: string): Promise<boolean> {
  const chatId = getTrainingPeaksCoachChatIds()[0] ?? null;
  if (!chatId) return false;
  // Обычный send, а не strict: если телеграм не принял уведомление, это не повод
  // ронять обработку входящего сообщения ученицы.
  await sendTelegramMessage(chatId, text);
  return true;
}

/**
 * Входящее от ученицы. Зовётся из обработчика сообщения; НИКОГДА не бросает.
 */
export async function noticeInboundMessage(input: {
  sourceId: string;
  studentName: string;
  preview: string | null;
}): Promise<void> {
  if (!isInboundNoticeEnabled()) return;
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("intervals_inbound_notices")
      .select("source_id, last_notified_at, pending_since, pending_count, pending_preview")
      .eq("source_id", input.sourceId)
      .maybeSingle();
    const row = (data as NoticeRow | null) ?? null;

    const nowIso = new Date().toISOString();
    const decision = decideInboundNotice({
      coachHour: coachHourNow(),
      lastNotifiedAt: row?.last_notified_at ?? null,
      nowIso,
    });

    if (decision.kind === "skip") return;

    if (decision.kind === "defer") {
      const { error } = await supabase.from("intervals_inbound_notices").upsert(
        {
          source_id: input.sourceId,
          last_notified_at: row?.last_notified_at ?? null,
          // Время ПЕРВОГО неотданного, а не последнего: утром тренер должен
          // понимать, с какого часа человек ждёт.
          pending_since: row?.pending_since ?? nowIso,
          pending_count: (row?.pending_count ?? 0) + 1,
          pending_preview: input.preview,
          updated_at: nowIso,
        },
        { onConflict: "source_id" }
      );
      if (error) console.warn("[intervals.inbound] отложить не вышло", describeSupabaseError(error));
      return;
    }

    const sent = await sendToCoach(
      inboundNoticeTextRu({
        studentName: input.studentName,
        preview: input.preview,
        count: 1,
        deferred: false,
      })
    );
    if (!sent) return;

    await supabase.from("intervals_inbound_notices").upsert(
      {
        source_id: input.sourceId,
        last_notified_at: nowIso,
        pending_since: null,
        pending_count: 0,
        pending_preview: null,
        updated_at: nowIso,
      },
      { onConflict: "source_id" }
    );
  } catch (error) {
    // Побочный путь у чужого горячего обработчика: молчим, но в лог.
    console.warn("[intervals.inbound] уведомление не ушло", {
      sourceId: input.sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Отложенное ночью — утром. Зовёт раннер напоминаний.
 *
 * Возвращает, скольким тренер получил уведомления: раннер это печатает, чтобы
 * молчание было отличимо от «нечего было отдавать».
 */
export async function flushPendingInboundNotices(): Promise<number> {
  if (!isInboundNoticeEnabled()) return 0;
  const hour = coachHourNow();
  // Ещё тихо — ничего не трогаем: отложенное ждёт своего часа, а не теряется.
  if (isQuietHour(hour)) return 0;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_inbound_notices")
    .select("source_id, last_notified_at, pending_since, pending_count, pending_preview")
    .gt("pending_count", 0);
  if (error) {
    console.warn("[intervals.inbound] отложенные не прочитались", describeSupabaseError(error));
    return 0;
  }

  let sentCount = 0;
  for (const raw of (data ?? []) as NoticeRow[]) {
    try {
      const { data: source } = await supabase
        .from("student_data_sources")
        .select("student_id")
        .eq("id", raw.source_id)
        .maybeSingle();
      const studentId = (source as { student_id?: string } | null)?.student_id ?? null;
      const { data: card } = studentId
        ? await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle()
        : { data: null };
      const studentName = (card as { student_name?: string } | null)?.student_name ?? "Ученица";

      const sent = await sendToCoach(
        inboundNoticeTextRu({
          studentName,
          preview: raw.pending_preview,
          count: raw.pending_count,
          deferred: true,
        })
      );
      if (!sent) continue;

      const nowIso = new Date().toISOString();
      await supabase
        .from("intervals_inbound_notices")
        .update({
          last_notified_at: nowIso,
          pending_since: null,
          pending_count: 0,
          pending_preview: null,
          updated_at: nowIso,
        })
        .eq("source_id", raw.source_id);
      sentCount += 1;
    } catch (itemError) {
      console.warn("[intervals.inbound] отложенное не ушло", {
        sourceId: raw.source_id,
        error: itemError instanceof Error ? itemError.message : String(itemError),
      });
    }
  }
  return sentCount;
}

/**
 * Тот же путь, но от ученика TrainingPeaks: находим его источник Intervals сами.
 *
 * ОТДЕЛЬНЫЙ ВХОД, ЧТОБЫ МЕСТО ВЫЗОВА БЫЛО В ДВЕ СТРОКИ. Зовут его из чужого
 * горячего обработчика входящих сообщений, и чем меньше там нашего кода, тем
 * меньше шанс уронить разбор сообщения ради уведомления.
 *
 * НЕТ ИСТОЧНИКА INTERVALS — МОЛЧИМ. Ростер TrainingPeaks пишет тренеру каждый
 * день, и звякать по каждому его сообщению никто не просил.
 */
export async function noticeInboundFromStudent(input: {
  studentId: string;
  preview: string | null;
}): Promise<void> {
  if (!isInboundNoticeEnabled()) return;
  try {
    const supabase = createSupabaseServerClient();
    const { data: source } = await supabase
      .from("student_data_sources")
      .select("id, is_active")
      .eq("student_id", input.studentId)
      .eq("provider", "intervals")
      .maybeSingle();
    const row = source as { id?: string; is_active?: boolean } | null;
    if (!row?.id || row.is_active !== true) return;

    const { data: card } = await supabase
      .from("trainingpeaks_students")
      .select("student_name")
      .eq("id", input.studentId)
      .maybeSingle();

    await noticeInboundMessage({
      sourceId: String(row.id),
      studentName: (card as { student_name?: string } | null)?.student_name ?? "Ученица",
      preview: input.preview,
    });
  } catch (error) {
    console.warn("[intervals.inbound] вход по ученику не отработал", {
      studentId: input.studentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
