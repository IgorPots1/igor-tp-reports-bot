/**
 * Поправить объём со слов у уже заполненной анкеты — и честно записать, что
 * это сделал тренер.
 *
 * ── ЗАЧЕМ ОТДЕЛЬНАЯ КОМАНДА ─────────────────────────────────────────────────
 *
 * intervals:prefill для этого НЕ ГОДИТСЯ: он пишет в intervals_onboarding_prefill
 * — заготовку, которую человек увидит в форме. Генератор читает не её, а
 * intervals_onboarding_answers. Поправить прогноз через prefill невозможно:
 * заготовка уже сыграла свою роль, когда анкету заполняли.
 *
 * Прямая правка руками тоже плоха, и мы это уже проходили 17.09: флаги
 * генерации перезаписывали ответы ученицы, а карточка продолжала утверждать
 * «ответила сама». Число менялось, происхождение — нет, и через месяц никто
 * не мог сказать, чьё это знание.
 *
 * ПОЭТОМУ ЗДЕСЬ ДВЕ ЗАПИСИ ВСЕГДА ВМЕСТЕ: новое значение И пометка в
 * coach_set_fields. Карточка после этого говорит «задал тренер» — то есть
 * правду.
 *
 * ── КОГДА ЭТО НУЖНО ─────────────────────────────────────────────────────────
 *
 * Человек в анкете занижает или завышает: «бегаю минут семьдесят» при реальных
 * ста восьмидесяти. Тренер, который видел его в деле, знает лучше. Цена ошибки
 * не косметическая: объём со слов — БАЗА цикла, и недели считаются от него.
 *
 * По умолчанию НИЧЕГО НЕ ПИШЕТ.
 *
 * ИМЯ ПОЛЯ В ПОМЕТКЕ — КАНОНИЧЕСКОЕ, ИЗ PREFILLABLE_FIELDS. Первая версия
 * писала «weeklyMinutes», которого в списке нет: карточка такую пометку просто
 * не показывала, и правка тренера выглядела как ответ ученицы. Ровно та беда,
 * ради которой команда и писалась.
 *
 *   npx tsx scripts/intervals-set-reported-volume.ts --chat=780530798 --minutes=185
 *   npx tsx scripts/intervals-set-reported-volume.ts --chat=780530798 --max-session=80 --commit
 */

import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const chat = arg("chat");
  const minutesArg = arg("minutes");
  const maxSessionArg = arg("max-session");
  if (!chat) fail("Нужен --chat=<telegram chat id>");
  if (!minutesArg && !maxSessionArg) fail("Нужен --minutes=185 и/или --max-session=80");

  let minutes: number | null = null;
  if (minutesArg) {
    minutes = Number(minutesArg);
    // Границы человеческие: меньше двадцати в неделю — это не режим, больше
    // тысячи — опечатка на порядок.
    if (!Number.isFinite(minutes) || minutes < 20 || minutes > 1000) {
      fail(`Недельный объём ${minutesArg} вне разумного (20–1000). Похоже на опечатку.`);
    }
  }
  let maxSession: number | null = null;
  if (maxSessionArg) {
    maxSession = Number(maxSessionArg);
    if (!Number.isFinite(maxSession) || maxSession < 15 || maxSession > 300) {
      fail(`Потолок одной тренировки ${maxSessionArg} вне разумного (15–300). Похоже на опечатку.`);
    }
  }

  const supabase = createSupabaseServerClient();
  const { data: card } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name")
    .eq("telegram_chat_id", chat)
    .maybeSingle();
  if (!card) fail(`Карточки с chat_id ${chat} нет`);
  const studentId = String((card as Record<string, unknown>).id);

  const { data: source } = await supabase
    .from("student_data_sources")
    .select("id")
    .eq("student_id", studentId)
    .eq("provider", "intervals")
    .maybeSingle();
  if (!source) fail("У ученика нет источника Intervals");
  const sourceId = String((source as Record<string, unknown>).id);

  const { data: answersRow } = await supabase
    .from("intervals_onboarding_answers")
    .select("id, self_reported_weekly_minutes, max_session_minutes, days_per_week, coach_set_fields")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (!answersRow) fail("Анкета не заполнена — править нечего");
  const a = answersRow as Record<string, unknown>;
  const coachSet = new Set<string>(Array.isArray(a.coach_set_fields) ? (a.coach_set_fields as string[]) : []);
  // Хвост первой версии: неканоническое имя, которого нет в PREFILLABLE_FIELDS.
  coachSet.delete("weeklyMinutes");
  const days = Number(a.days_per_week);
  const wasWeekly = a.self_reported_weekly_minutes;
  const wasCap = a.max_session_minutes;
  const nextWeekly = minutes ?? (wasWeekly === null || wasWeekly === undefined ? null : Number(wasWeekly));
  const nextCap = maxSession ?? (wasCap === null || wasCap === undefined ? null : Number(wasCap));

  console.log(`Ученик:        ${(card as Record<string, unknown>).student_name}`);
  if (minutes !== null) {
    console.log(`Объём/нед:     ${wasWeekly ?? "не указано"} → ${minutes}`);
  }
  if (maxSession !== null) {
    console.log(`Потолок одной: ${wasCap ?? "не указано"} → ${maxSession} мин`);
  }
  if (nextWeekly !== null && nextCap !== null) {
    const capacity = nextCap * Math.max(1, days);
    console.log(`Вместимость:   ${nextCap} мин × ${days} дн = ${capacity} мин/нед` +
      (capacity < nextWeekly
        ? ` — МЕНЬШЕ объёма ${nextWeekly}: цикл расти не сможет`
        : ` — объём ${nextWeekly} помещается, есть запас ${capacity - nextWeekly} мин`));
  }
  console.log("");
  console.log("Это БАЗА цикла: следующая генерация посчитает недели от новых чисел.");
  console.log("Уже записанные недели не изменятся — их пересобирают отдельно.");

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  const patch: Record<string, unknown> = { coach_set_fields: [] as string[] };
  if (minutes !== null) {
    patch.self_reported_weekly_minutes = minutes;
    coachSet.add("selfReportedWeeklyMinutes");
  }
  if (maxSession !== null) {
    patch.max_session_minutes = maxSession;
    coachSet.add("maxSessionMinutes");
  }
  patch.coach_set_fields = [...coachSet];

  const { error } = await supabase
    .from("intervals_onboarding_answers")
    .update(patch)
    .eq("id", String(a.id));
  if (error) fail(`не записали: ${error.message}`);
  console.log(`\nЗаписано и помечено как заданное тренером: ${[...coachSet].join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
