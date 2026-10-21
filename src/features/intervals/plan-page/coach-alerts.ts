/**
 * Уведомления тренеру со страницы плана и от текста боту.
 *
 * ЧТО ЗВЕНИТ [решение Игоря, 21.10.2026]:
 * - отчёт — ничего, он виден в админке;
 * - отчёт с болью «да» — уведомление;
 * - «Написать тренеру» и текст боту — уведомление с текстом.
 *
 * ТИХИЕ ЧАСЫ общие с inbound-notice.ts (23–8 по тренеру): ночью строка
 * остаётся с пустой отметкой «тренеру сказали», утром раннер напоминаний
 * досылает очередь — БОЛЬ ПЕРВОЙ, выше сообщений (orderCoachAlerts).
 *
 * Паузы между уведомлениями (cooldown inbound-notice) здесь нет намеренно:
 * каждое сообщение несёт свой текст, и склеивать их в «написала (3)» значит
 * прятать содержание.
 *
 * НИКОГДА НЕ БРОСАЕТ: это побочный путь у отправки отчёта и у вебхука.
 */
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { sendTelegramWebAppButton } from "@/features/telegram/telegram-client";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { SITE_URL } from "@/lib/site";

import { isQuietHour } from "../loop/inbound-notice";

import { orderCoachAlerts, type CoachAlert } from "./core";

function coachHourNow(): number {
  const zone = process.env.COACH_TIMEZONE?.trim() || "Europe/Moscow";
  return Number(new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "numeric", hour12: false }).format(new Date()));
}

function cardUrl(studentUuid: string): string {
  return `${SITE_URL.replace(/\/+$/, "")}/admin/coach-os/beginner/${studentUuid}`;
}

const DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function painAlertTextRu(input: {
  studentName: string;
  sessionDate: string;
  sessionTitle: string | null;
  comment: string | null;
  deferred: boolean;
}): string {
  const head = `⚠️ ${input.studentName}: боль${input.deferred ? " (ночью)" : ""}, ${dayLabel(input.sessionDate)}${input.sessionTitle ? ` ${input.sessionTitle}` : ""}`;
  const note = input.comment?.trim() ? `\n\n«${input.comment.trim().slice(0, 300)}»` : "";
  return `${head}${note}`;
}

export function messageAlertTextRu(input: { studentName: string; body: string; origin: "page" | "bot"; deferred: boolean }): string {
  const where = input.origin === "page" ? "со страницы плана" : "боту";
  return `${input.studentName} пишет ${where}${input.deferred ? " (ночью)" : ""}:\n\n«${input.body.trim().slice(0, 1500)}»`;
}

async function sendToCoach(text: string, studentUuid: string): Promise<boolean> {
  const chatId = getTrainingPeaksCoachChatIds()[0] ?? null;
  if (!chatId) return false;
  await sendTelegramWebAppButton({ chatId, text, buttons: [{ label: "Карточка", url: cardUrl(studentUuid) }] });
  return true;
}

type Who = { sourceId: string; studentUuid: string; studentName: string };

/** Боль в отчёте. Сейчас или утром. */
export async function alertCoachPain(input: Who & {
  checkinId: string;
  sessionDate: string;
  sessionTitle: string | null;
  comment: string | null;
}): Promise<void> {
  try {
    if (isQuietHour(coachHourNow())) return; // утром дошлёт flushCoachAlerts
    const sent = await sendToCoach(painAlertTextRu({ ...input, deferred: false }), input.studentUuid);
    if (sent) await markPainNotified(input.checkinId);
  } catch (error) {
    console.error("[plan-page.alert] боль не ушла тренеру", { sourceId: input.sourceId, error: errorText(error) });
  }
}

/** Сообщение ученицы. Сейчас или утром. */
export async function alertCoachMessage(input: Who & { messageId: string; body: string; origin: "page" | "bot" }): Promise<void> {
  try {
    if (isQuietHour(coachHourNow())) return;
    const sent = await sendToCoach(messageAlertTextRu({ ...input, deferred: false }), input.studentUuid);
    if (sent) await markMessageNotified(input.messageId);
  } catch (error) {
    console.error("[plan-page.alert] сообщение не ушло тренеру", { sourceId: input.sourceId, error: errorText(error) });
  }
}

/**
 * Утренняя досылка. Зовёт раннер напоминаний, когда тихие часы кончились.
 * Берёт только ПОСЛЕДНИЕ двое суток: старше — уже не новость, тренер видит
 * это в карточке, а внезапный звонок про позавчерашнее только путает.
 */
export async function flushCoachAlerts(): Promise<{ sent: number }> {
  if (isQuietHour(coachHourNow())) return { sent: 0 };
  const supabase = createSupabaseServerClient();
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

  const [pains, messages] = await Promise.all([
    supabase
      .from("intervals_checkins")
      .select("id, source_id, session_date, plan_session_id, comment_text, created_at")
      .eq("pain", true)
      .is("pain_coach_notified_at", null)
      .not("surface", "is", null) // только отчёты со страницы: у мини-аппа своей тревоги нет
      .gte("created_at", since),
    supabase
      .from("intervals_student_messages")
      .select("id, source_id, body, origin, created_at")
      .is("coach_notified_at", null)
      .gte("created_at", since),
  ]);
  if (pains.error) throw new Error(`pain queue: ${describeSupabaseError(pains.error)}`);
  if (messages.error) throw new Error(`message queue: ${describeSupabaseError(messages.error)}`);

  type Row = CoachAlert & { sourceId: string; text: (who: Who) => string };
  const queue: Row[] = [
    ...(pains.data ?? []).map((p) => ({
      kind: "pain" as const,
      id: String(p.id),
      at: String(p.created_at),
      sourceId: String(p.source_id),
      text: (who: Who) =>
        painAlertTextRu({ studentName: who.studentName, sessionDate: String(p.session_date), sessionTitle: null, comment: p.comment_text as string | null, deferred: true }),
    })),
    ...(messages.data ?? []).map((m) => ({
      kind: "message" as const,
      id: String(m.id),
      at: String(m.created_at),
      sourceId: String(m.source_id),
      text: (who: Who) =>
        messageAlertTextRu({ studentName: who.studentName, body: String(m.body), origin: m.origin === "page" ? "page" : "bot", deferred: true }),
    })),
  ];

  let sent = 0;
  for (const alert of orderCoachAlerts(queue)) {
    const who = await whoIs(alert.sourceId);
    if (!who) continue;
    try {
      if (!(await sendToCoach(alert.text(who), who.studentUuid))) break;
      if (alert.kind === "pain") await markPainNotified(alert.id);
      else await markMessageNotified(alert.id);
      sent += 1;
    } catch (error) {
      console.error("[plan-page.alert] утренняя досылка оборвалась", { id: alert.id, error: errorText(error) });
      break;
    }
  }
  return { sent };
}

async function whoIs(sourceId: string): Promise<Who | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("student_data_sources")
    .select("student_id, trainingpeaks_students(student_name)")
    .eq("id", sourceId)
    .maybeSingle();
  const row = data as { student_id: string; trainingpeaks_students: { student_name: string } | null } | null;
  if (!row?.trainingpeaks_students) return null;
  return { sourceId, studentUuid: row.student_id, studentName: row.trainingpeaks_students.student_name };
}

async function markPainNotified(checkinId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.from("intervals_checkins").update({ pain_coach_notified_at: new Date().toISOString() }).eq("id", checkinId);
}

async function markMessageNotified(messageId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.from("intervals_student_messages").update({ coach_notified_at: new Date().toISOString() }).eq("id", messageId);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
