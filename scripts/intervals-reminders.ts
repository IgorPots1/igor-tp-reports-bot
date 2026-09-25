/**
 * Раннер напоминаний. Ходит раз в полчаса, решает по каждому ученику отдельно.
 *
 * ПРАВИЛА БЕЗОПАСНОСТИ, КОТОРЫЕ ЗДЕСЬ НЕ ОБСУЖДАЮТСЯ:
 *   · выключено по умолчанию. Без INTERVALS_REMINDERS_ENABLED=true скрипт
 *     считает и печатает, но наружу не отправляет ничего;
 *   · карточка со снятым telegram_delivery_enabled не получает ничего, даже
 *     когда флаг включён. Это второй, независимый заслон;
 *   · один вид напоминания на человека в сутки, и это держит уникальный ключ в
 *     базе, а не аккуратность кода;
 *   · --dry-run печатает решения и не пишет в базу вообще.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: рассылок, дайджестов, «мы по вам скучали». Только два события,
 * каждое привязано к конкретному дню конкретного человека.
 */

import process from "node:process";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import {
  areRemindersEnabled,
  decideReminder,
  type ReminderKind,
} from "@/features/intervals/loop/reminders";
import { reportedWeekStart } from "@/features/intervals/loop/weekly-report";
import { getPublishedCycle, listSessionsInRange } from "@/features/intervals/loop/repository";
import { flushPendingInboundNotices } from "@/features/intervals/loop/inbound-notify";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

const DRY_RUN = process.argv.includes("--dry-run");

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function localHourInZone(timezone: string | null): number {
  const zone = timezone ?? "Europe/Belgrade";
  try {
    const value = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date());
    return Number.parseInt(value, 10);
  } catch {
    return new Date().getUTCHours();
  }
}

type Row = {
  studentUuid: string;
  studentName: string;
  sourceId: string;
  timezone: string | null;
  chatId: string | null;
  deliveryEnabled: boolean;
};

async function loadStudents(): Promise<Row[]> {
  const supabase = createSupabaseServerClient();
  const { data: students, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, timezone, telegram_chat_id, telegram_delivery_enabled")
    .eq("coaching_platform", "intervals")
    .eq("is_active", true);
  if (error) {
    console.error(`⛔ не читаются карточки: ${error.message}`);
    process.exit(1);
  }
  const rows = (students ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const { data: sources } = await supabase
    .from("student_data_sources")
    .select("id, student_id")
    .eq("provider", "intervals")
    .eq("is_active", true)
    .in("student_id", rows.map((row) => String(row.id)));

  const sourceByStudent = new Map<string, string>();
  for (const raw of sources ?? []) {
    const row = raw as Record<string, unknown>;
    sourceByStudent.set(String(row.student_id), String(row.id));
  }

  return rows
    .filter((row) => sourceByStudent.has(String(row.id)))
    .map((row) => ({
      studentUuid: String(row.id),
      studentName: String(row.student_name),
      sourceId: sourceByStudent.get(String(row.id)) as string,
      timezone: (row.timezone as string | null) ?? null,
      chatId: (row.telegram_chat_id as string | null) ?? null,
      deliveryEnabled: row.telegram_delivery_enabled === true,
    }));
}

async function main(): Promise<void> {
  const enabled = areRemindersEnabled();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  console.log(`НАПОМИНАНИЯ · ${stamp} UTC · ${enabled ? "отправка включена" : "отправка ВЫКЛЮЧЕНА"}${DRY_RUN ? " · холостой" : ""}`);

  const supabase = createSupabaseServerClient();
  const students = await loadStudents();
  console.log(`учеников к обходу: ${students.length}`);

  for (const student of students) {
    const today = todayIsoInZone(student.timezone);
    const hour = localHourInZone(student.timezone);

    const cycle = await getPublishedCycle(student.sourceId);
    // Окно на неделю назад нужно для одного: посчитать серию пропусков. Без неё
    // бот не отличит «первый раз не сложилось» от «человек пропал».
    const weekAgo = shiftIso(today, -7);
    const sessions = cycle ? await listSessionsInRange(cycle.id, weekAgo, today) : [];
    const todaySession = sessions.find((session) => session.sessionDate === today) ?? null;

    const [{ data: checkins }, { data: activities }, { data: sentRows }] = await Promise.all([
      supabase
        .from("intervals_checkins")
        .select("session_date")
        .eq("source_id", student.sourceId)
        .gte("session_date", weekAgo),
      supabase
        .from("intervals_activities")
        .select("start_date_local")
        .eq("source_id", student.sourceId)
        .gte("start_date_local", `${weekAgo}T00:00:00`)
        .lte("start_date_local", `${today}T23:59:59`),
      supabase
        .from("intervals_reminders")
        .select("kind")
        .eq("source_id", student.sourceId)
        .eq("local_date", today),
    ]);

    const checkinDates = new Set(
      (checkins ?? []).map((row) => String((row as { session_date: string }).session_date))
    );
    const activityDates = new Set(
      (activities ?? []).map((row) =>
        String((row as { start_date_local: string }).start_date_local ?? "").slice(0, 10)
      )
    );
    const plannedDates = new Set(sessions.map((session) => session.sessionDate));

    // Серия пропусков: идём назад от вчерашнего дня, пока встречаются плановые
    // дни, в которые не было ни пробежки, ни отметки. День без плана серию не
    // рвёт и не продолжает: это просто выходной.
    let missedStreak = 0;
    for (let back = 1; back <= 7; back += 1) {
      const day = shiftIso(today, -back);
      if (!plannedDates.has(day)) continue;
      if (activityDates.has(day) || checkinDates.has(day)) break;
      missedStreak += 1;
    }

    // НЕДЕЛЬНАЯ ФОРМА. Неделя считается по зоне ученика: воскресенье у неё и
    // воскресенье у тренера — разные сутки.
    const weekForForm = reportedWeekStart(today);
    const weekdayLocal = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    let hasWeeklyReportThisWeek = false;
    let hasCheckinThisWeek = false;
    if (weekForForm) {
      const weekEnd = shiftIso(weekForForm, 6);
      hasCheckinThisWeek = [...checkinDates].some((date) => date >= weekForForm && date <= weekEnd);
      const { data: reportRow } = await supabase
        .from("intervals_weekly_reports")
        .select("id")
        .eq("source_id", student.sourceId)
        .eq("week_start", weekForForm)
        .maybeSingle();
      hasWeeklyReportThisWeek = reportRow !== null;
    }

    const decision = decideReminder({
      localHour: hour,
      isSunday: weekdayLocal === 6,
      hasCheckinThisWeek,
      hasWeeklyReportThisWeek,
      todaySession: todaySession ? { title: todaySession.title, minutes: todaySession.minutes } : null,
      hasCheckinToday: checkinDates.has(today),
      hasActivityToday: activityDates.has(today),
      missedStreak,
      alreadySentKinds: (sentRows ?? []).map((row) => (row as { kind: ReminderKind }).kind),
      hasPublishedPlan: cycle !== null,
    });

    const who = `${student.studentName} (${today}, ${hour}:00 местного${missedStreak > 0 ? `, пропусков подряд ${missedStreak}` : ""})`;
    if (!decision.send) {
      console.log(`  · ${who}: молчим — ${decision.reason}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  · ${who}: ОТПРАВИЛИ БЫ ${decision.kind}`);
      console.log(`      ${decision.textRu.split("\n")[0]}`);
      continue;
    }

    // Два независимых заслона: общий флаг и флаг доставки у карточки.
    let status: "sent" | "skipped" | "failed" = "sent";
    let detail: string | null = null;
    // Telegram id сообщения нам не нужен: перечитывать или редактировать
    // напоминание мы не будем, а след и без него полный.
    const messageId: string | null = null;

    if (!enabled) {
      status = "skipped";
      detail = "INTERVALS_REMINDERS_ENABLED выключен";
    } else if (!student.chatId) {
      status = "skipped";
      detail = "чат не привязан";
    } else if (!student.deliveryEnabled) {
      status = "skipped";
      detail = "у карточки выключена доставка";
    } else {
      try {
        await sendTelegramMessageStrict(student.chatId, decision.textRu);
      } catch (error) {
        status = "failed";
        detail = error instanceof Error ? error.message : String(error);
      }
    }

    // Пишем след ВСЕГДА, даже когда не отправили: пустая таблица должна означать
    // «раннер не ходил», а не «ходил и промолчал». Отличать эти два случая
    // задним числом невозможно.
    const { error: writeError } = await supabase.from("intervals_reminders").insert({
      source_id: student.sourceId,
      kind: decision.kind,
      local_date: today,
      status,
      detail,
      chat_id: status === "sent" ? student.chatId : null,
      telegram_message_id: messageId,
    });
    if (writeError && !writeError.message.includes("duplicate key")) {
      console.log(`  ⚠ ${who}: след не записан — ${writeError.message}`);
    }

    console.log(`  · ${who}: ${decision.kind} → ${status}${detail ? ` (${detail})` : ""}`);
  }

  /**
   * ОТЛОЖЕННОЕ НОЧЬЮ — ТРЕНЕРУ, УТРОМ [25.09.2026].
   *
   * Это единственное здесь, что идёт ТРЕНЕРУ, а не ученику, и живёт под своим
   * флагом (INTERVALS_INBOUND_NOTICE_ENABLED). Раннер просто оказался тем, кто
   * и так ходит каждые полчаса: заводить второе расписание ради одного вызова
   * незачем.
   *
   * В --dry-run не трогаем: он ничего не отправляет и ничего не пишет.
   */
  if (!DRY_RUN) {
    const flushed = await flushPendingInboundNotices();
    if (flushed > 0) console.log(`Отложенных уведомлений тренеру отдано: ${flushed}`);
  }

  console.log("Готово.");
}

main().catch((error) => {
  console.error("⛔ раннер напоминаний упал:", error);
  process.exit(1);
});
