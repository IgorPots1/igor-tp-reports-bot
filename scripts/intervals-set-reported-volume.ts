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
 *   npx tsx scripts/intervals-set-reported-volume.ts --chat=780530798 --minutes=185
 *   npx tsx scripts/intervals-set-reported-volume.ts --chat=780530798 --minutes=185 --commit
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
  if (!chat) fail("Нужен --chat=<telegram chat id>");
  if (!minutesArg) fail("Нужен --minutes=185");
  const minutes = Number(minutesArg);
  if (!Number.isFinite(minutes) || minutes <= 0) fail(`Не понял объём «${minutesArg}»`);
  // Границы человеческие: меньше двадцати в неделю — это не режим, больше
  // тысячи — опечатка на порядок.
  if (minutes < 20 || minutes > 1000) {
    fail(`${minutes} минут в неделю вне разумного (20–1000). Похоже на опечатку.`);
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
    .select("id, self_reported_weekly_minutes, days_per_week, coach_set_fields")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (!answersRow) fail("Анкета не заполнена — править нечего");
  const a = answersRow as Record<string, unknown>;
  const was = a.self_reported_weekly_minutes;
  const coachSet = new Set<string>(Array.isArray(a.coach_set_fields) ? (a.coach_set_fields as string[]) : []);
  const days = Number(a.days_per_week);

  console.log(`Ученик:        ${(card as Record<string, unknown>).student_name}`);
  console.log(`Было:          ${was ?? "не указано"} мин/нед${was ? ` (${Math.round(Number(was) / Math.max(1, days))} мин на пробежку при ${days} днях)` : ""}`);
  console.log(`Станет:        ${minutes} мин/нед (${Math.round(minutes / Math.max(1, days))} мин на пробежку при ${days} днях)`);
  console.log(`Происхождение: ${coachSet.has("weeklyMinutes") ? "уже помечено «задал тренер»" : "«ответила сама» → «задал тренер»"}`);
  console.log("");
  console.log("Это БАЗА цикла: следующая генерация посчитает недели от нового числа.");
  console.log("Уже записанные недели не изменятся — их пересобирают отдельно.");

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  coachSet.add("weeklyMinutes");
  const { error } = await supabase
    .from("intervals_onboarding_answers")
    .update({
      self_reported_weekly_minutes: minutes,
      coach_set_fields: [...coachSet],
    })
    .eq("id", String(a.id));
  if (error) fail(`не записали: ${error.message}`);
  console.log(`\nЗаписано: ${minutes} мин/нед, помечено как заданное тренером.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
