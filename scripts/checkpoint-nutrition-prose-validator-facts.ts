// READ-ONLY чекпойнт: генерация и рендер валидируют ОДНИ И ТЕ ЖЕ факты дня.
//
// Модель НЕ вызывается: берём УЖЕ СОХРАНЁННУЮ прозу из nutrition_weekly_analyses и
// прогоняем по ней настоящий рендер. Ничего не пишем в БД, ничего не шлём.
//
// Что показывает:
//   1. ДО фикса (симуляция: у дней срезаны previous_week_numbers / pre_workout /
//      checkin_numbers — ровно то, что старый normalizeStoredDailyFactItem не переносил)
//      vs ПОСЛЕ (данные как есть) — какие дни падают в сухой fallback и почему.
//   2. Аудит генерации (day_prose_rejected в notes) vs аудит рендера
//      (getNutritionDayProseRejections) — совпадают ли они.
//   3. Чек-ин в allow-листе: на РЕАЛЬНОЙ прозе дня с «чек-ин 9/10» показывает, что
//      без checkin_numbers число держалось на случайном совпадении.
//
// Запуск:
//   npx tsx scripts/checkpoint-nutrition-prose-validator-facts.ts \
//     --student-name "Ponomareva" --week-from 2026-07-06 --week-to 2026-07-12
import process from "node:process";

import {
  buildNutritionDayProseFacts,
  getNutritionDayProseRejections,
  getNutritionReviewDayCards,
} from "@/features/nutrition/combined-message";
import { getNutritionWeeklyAnalysisForWeek } from "@/features/nutrition/repository";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";
import { validateNutritionDayProse } from "@/features/nutrition/telegram-renderer";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

/** Поля allow-листа, которые старый normalizeStoredDailyFactItem терял по дороге. */
const CARRIED_PROSE_FACT_FIELDS = ["previous_week_numbers", "pre_workout", "checkin_numbers"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function dailyAnalysisOf(review: NutritionWeeklyAnalysis): Record<string, unknown>[] {
  const daily = asObject(review.nutritionSummary).daily_analysis;
  return Array.isArray(daily) ? daily.map((day) => asObject(day)) : [];
}

/**
 * Симуляция ДО-фикса: новый код + данные без перенесённых полей === старый код.
 * (Старый normalize собирал новый объект и эти поля просто не копировал.)
 */
function stripCarriedFields(review: NutritionWeeklyAnalysis): NutritionWeeklyAnalysis {
  const clone = structuredClone(review) as NutritionWeeklyAnalysis;
  for (const day of dailyAnalysisOf(clone)) {
    for (const field of CARRIED_PROSE_FACT_FIELDS) {
      delete day[field];
    }
  }
  return clone;
}

function proseOf(day: Record<string, unknown>): string {
  return typeof day.athlete_prose === "string" ? day.athlete_prose.trim() : "";
}

/** Модельная проза дня доехала до копи-блока? (карточка рендера ≈ сохранённая проза) */
function renderedModelProseDates(review: NutritionWeeklyAnalysis): Set<string> {
  const stored = new Map(dailyAnalysisOf(review).map((day) => [String(day.date ?? ""), proseOf(day)]));
  const dates = new Set<string>();
  for (const card of getNutritionReviewDayCards(review)) {
    const raw = stored.get(card.date ?? "") ?? "";
    if (!raw) {
      continue;
    }
    // Рендер чистит тире/жаргон, поэтому сравниваем по первым словам, а не байт-в-байт.
    const head = raw.replace(/\s+/g, " ").slice(0, 24);
    if (head && card.prose.replace(/\s+/g, " ").startsWith(head.replace(/[—–]/g, "-"))) {
      dates.add(card.date ?? "");
    }
  }
  return dates;
}

async function main(): Promise<void> {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const studentName = arg("student-name") ?? "Ponomareva";
  const weekFrom = arg("week-from") ?? "2026-07-06";
  const weekTo = arg("week-to") ?? "2026-07-12";

  const supabase = createSupabaseServerClient();
  const { data: students, error } = await supabase
    .from("trainingpeaks_students")
    .select("id,student_name")
    .ilike("student_name", `%${studentName}%`)
    .limit(5);
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  const student = (students ?? [])[0] as { id: string; student_name: string } | undefined;
  if (!student) {
    console.error(`Не найден ученик по имени «${studentName}».`);
    process.exit(1);
  }

  const review = await getNutritionWeeklyAnalysisForWeek({ studentId: student.id, weekFrom, weekTo });
  if (!review) {
    console.error(`Нет сохранённого обзора для ${student.student_name} за ${weekFrom}..${weekTo}.`);
    process.exit(1);
  }

  const days = dailyAnalysisOf(review);
  const withProse = days.filter((day) => proseOf(day));
  console.log(`=== ${student.student_name} · неделя ${weekFrom}..${weekTo} ===`);
  console.log(`дней: ${days.length} · с athlete_prose: ${withProse.length} · модель НЕ вызывалась (только сохранённое)\n`);

  // --- 1. Аудит ГЕНЕРАЦИИ (то, что записано в notes при генерации) ---
  const notes = asObject(review.internalSummary).notes;
  const genRejected = (Array.isArray(notes) ? notes : [])
    .filter((note): note is string => typeof note === "string" && note.startsWith("day_prose_rejected"))
    .map((note) => note.split(":")[1] ?? "?");
  console.log(`АУДИТ ГЕНЕРАЦИИ (day_prose_rejected в notes): ${genRejected.length ? genRejected.join(", ") : "пусто"}`);

  // --- 2. Рендер ДО фикса vs ПОСЛЕ (на тех же сохранённых данных) ---
  const before = stripCarriedFields(review);
  const rejectedBefore = getNutritionDayProseRejections(before);
  const rejectedAfter = getNutritionDayProseRejections(review);
  const modelProseBefore = renderedModelProseDates(before);
  const modelProseAfter = renderedModelProseDates(review);

  console.log(`\nРЕНДЕР ДО фикса: модельная проза ${modelProseBefore.size}/${withProse.length} дней, отклонено ${rejectedBefore.length}`);
  for (const r of rejectedBefore) {
    console.log(`   ❌ ${r.date}: ${r.rules.join(", ")}`);
  }
  console.log(`РЕНДЕР ПОСЛЕ фикса: модельная проза ${modelProseAfter.size}/${withProse.length} дней, отклонено ${rejectedAfter.length}`);
  for (const r of rejectedAfter) {
    console.log(`   ❌ ${r.date}: ${r.rules.join(", ")}`);
  }
  const recovered = [...modelProseAfter].filter((date) => !modelProseBefore.has(date)).sort();
  console.log(`ВЕРНУЛОСЬ модельной прозы: ${recovered.length ? recovered.join(", ") : "(нет)"}`);

  // --- 3. Виден ли рендер-фолбэк? (раньше он молчал: аудит писался только на генерации) ---
  console.log("\nВИДИМОСТЬ ПОДМЕНЫ НА РЕНДЕРЕ:");
  const silentBefore = rejectedBefore.filter((r) => !genRejected.includes(r.date ?? ""));
  console.log(`   ДО: рендер отклонял ${rejectedBefore.length} дн., из них в notes генерации НЕ упомянуто ${silentBefore.length} — молча подменялось${silentBefore.length ? ` (${silentBefore.map((r) => r.date).join(", ")})` : ""}`);
  console.log(`   ПОСЛЕ: getNutritionDayProseRejections возвращает подмены наверх → страница показывает их в «Предупреждениях» (${rejectedAfter.length} шт.)`);

  // --- 4. Чек-ин в allow-листе: на реальной прозе дня ---
  console.log("\nЧЕК-ИН В ALLOW-ЛИСТЕ (на реальной сохранённой прозе):");
  const checkinDay = days.find((day) => /чек-ин/i.test(proseOf(day)));
  if (!checkinDay) {
    console.log("   (в этой неделе нет дня с прозой про чек-ин — пропускаю)");
  } else {
    const prose = proseOf(checkinDay);
    const rating = Number(prose.match(/(\d+)\s*\/\s*10/)?.[1] ?? NaN);
    const wow = Array.isArray(checkinDay.previous_week_numbers) ? (checkinDay.previous_week_numbers as number[]) : [];
    const collides = wow.some((value) => Math.abs(Number(value) - rating) < 0.1);
    console.log(`   ${checkinDay.date}: оценка ${rating}/10 · совпадает с числом из previous_week_numbers: ${collides ? "ДА (проходило СЛУЧАЙНО)" : "нет"}`);

    // Тот же день, но без «счастливого» совпадения в week-over-week — так выглядит
    // любая другая неделя, где оценка чек-ина не равна какой-нибудь дельте.
    const unlucky = {
      ...checkinDay,
      previous_week_numbers: wow.filter((value) => Math.abs(Number(value) - rating) >= 0.1),
    };
    const withoutCheckin = validateNutritionDayProse({ prose, facts: buildNutritionDayProseFacts(unlucky) });
    const withCheckin = validateNutritionDayProse({
      prose,
      facts: buildNutritionDayProseFacts({ ...unlucky, checkin_numbers: [rating, 10] }),
    });
    const errs = (issues: { severity: string; rule: string }[]) =>
      issues.filter((i) => i.severity === "error").map((i) => i.rule);
    console.log(`   без совпадения и БЕЗ checkin_numbers → ошибки: ${errs(withoutCheckin).join(", ") || "(нет)"}`);
    console.log(`   без совпадения и С checkin_numbers [${rating}, 10] → ошибки: ${errs(withCheckin).join(", ") || "(нет)"} ✅`);
  }
}

void main();
