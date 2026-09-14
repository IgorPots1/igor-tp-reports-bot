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
import { getPublishedCycle, listSessionsInRange } from "@/features/intervals/loop/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

const DRY_RUN = process.argv.includes("--dry-run");

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
    const sessions = cycle ? await listSessionsInRange(cycle.id, today, today) : [];
    const todaySession = sessions[0] ?? null;

    const [{ data: checkins }, { data: activities }, { data: sentRows }] = await Promise.all([
      supabase
        .from("intervals_checkins")
        .select("id")
        .eq("source_id", student.sourceId)
        .eq("session_date", today)
        .limit(1),
      supabase
        .from("intervals_activities")
        .select("activity_id")
        .eq("source_id", student.sourceId)
        .gte("start_date_local", `${today}T00:00:00`)
        .lte("start_date_local", `${today}T23:59:59`)
        .limit(1),
      supabase
        .from("intervals_reminders")
        .select("kind")
        .eq("source_id", student.sourceId)
        .eq("local_date", today),
    ]);

    const decision = decideReminder({
      localHour: hour,
      todaySession: todaySession ? { title: todaySession.title, minutes: todaySession.minutes } : null,
      hasCheckinToday: (checkins ?? []).length > 0,
      hasActivityToday: (activities ?? []).length > 0,
      alreadySentKinds: (sentRows ?? []).map((row) => (row as { kind: ReminderKind }).kind),
      hasPublishedPlan: cycle !== null,
    });

    const who = `${student.studentName} (${today}, ${hour}:00 местного)`;
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

  console.log("Готово.");
}

main().catch((error) => {
  console.error("⛔ раннер напоминаний упал:", error);
  process.exit(1);
});
