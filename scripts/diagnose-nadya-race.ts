// READ-ONLY диагностика (Bug в): почему забег Нади не дошёл до nutrition.
// ТОЛЬКО SELECT — никаких upsert/insert/update/delete. Запускать с кредами превью:
//   npx tsx scripts/diagnose-nadya-race.ts
//   npx tsx scripts/diagnose-nadya-race.ts --student-name "Ponomareva" --week-from 2026-06-08 --week-to 2026-06-14
//
// Закрывает (в) фактом вместо гипотезы:
//   1) есть ли строка в trainingpeaks_race_events для окна Нади [weekFrom, weekTo+7];
//   2) если нет — пуста ли таблица вообще (скан не шёл, гипотеза 1) ИЛИ заполнена
//      для других учеников (Надя выпала → slug-mismatch, гипотеза 2).
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в окружении (.env.local).");
    process.exit(1);
  }
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });

  const studentName = arg("student-name") ?? "Ponomareva";
  const weekFrom = arg("week-from") ?? "2026-06-08";
  const weekTo = arg("week-to") ?? "2026-06-14";
  const readTo = addDays(weekTo, 7); // nutrition читает окно [weekFrom, weekTo+7] (context.ts)

  console.log("=== ПАРАМЕТРЫ ===");
  console.log(`student-name~ "${studentName}" · review-окно ${weekFrom}..${weekTo} · окно чтения ${weekFrom}..${readTo}`);

  // --- 1. Резолв ученика (id + slug) -----------------------------------------
  const { data: students, error: studentErr } = await supabase
    .from("trainingpeaks_students")
    .select("id,student_name,student_id")
    .ilike("student_name", `%${studentName}%`)
    .limit(10);
  if (studentErr) {
    console.error("Ошибка чтения trainingpeaks_students:", studentErr.message);
    process.exit(1);
  }
  console.log("\n=== СОВПАДЕНИЯ ПО ИМЕНИ (id · slug · имя) ===");
  console.table((students ?? []).map((s) => ({ id: s.id, slug: s.student_id, name: s.student_name })));
  const student = (students ?? [])[0];
  if (!student) {
    console.error("Ученик не найден — уточни --student-name.");
    process.exit(1);
  }
  console.log(`Берём: ${student.student_name} · id=${student.id} · slug="${student.student_id}"`);

  // --- 2. Гонки Нади В ОКНЕ чтения --------------------------------------------
  const { data: inWindow, error: winErr } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date,title,distance_km,distance_raw,source,trainingpeaks_athlete_id,created_at")
    .eq("student_id", student.id)
    .gte("event_date", weekFrom)
    .lte("event_date", readTo)
    .order("event_date", { ascending: true });
  if (winErr) {
    if (/does not exist|42P01|could not find the table|schema cache/i.test(winErr.message)) {
      console.error(`\n❌ Таблица trainingpeaks_race_events НЕДОСТУПНА: ${winErr.message}`);
      console.error("   ⇒ Миграция 20260616140000 не применена на этой базе. Гипотеза 1 (фактически — нет таблицы).");
      process.exit(0);
    }
    console.error("Ошибка чтения race events:", winErr.message);
    process.exit(1);
  }
  console.log("\n=== 1) ГОНКИ НАДИ В ОКНЕ ЧТЕНИЯ ===");
  console.table(inWindow ?? []);
  if ((inWindow ?? []).length > 0) {
    console.log("✅ Строка ЕСТЬ в окне — забег в таблицу дошёл. Если nutrition его не показал — смотреть инжект/рендер, не персист.");
    return;
  }
  console.log("⚠️ В окне строк НЕТ. Различаем гипотезы 1 vs 2 ниже.");

  // --- 2b. Все гонки Нади ВНЕ зависимости от даты (вдруг дата вне окна) --------
  const { data: anyDate } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date,title,source,created_at")
    .eq("student_id", student.id)
    .order("event_date", { ascending: true });
  console.log("\n=== ГОНКИ НАДИ ЛЮБОЙ ДАТЫ (контроль окна) ===");
  console.table(anyDate ?? []);
  if ((anyDate ?? []).length > 0) {
    console.log("ℹ️ У Нади ЕСТЬ гонки, но вне окна чтения — вопрос диапазона дат, не персиста.");
  }

  // --- 3. Прогонялся ли скан вообще (по всем ученикам) ------------------------
  const { count: totalCount } = await supabase
    .from("trainingpeaks_race_events")
    .select("*", { count: "exact", head: true });
  const { count: scanCount } = await supabase
    .from("trainingpeaks_race_events")
    .select("*", { count: "exact", head: true })
    .eq("source", "scan");
  const { data: latest } = await supabase
    .from("trainingpeaks_race_events")
    .select("student_id,event_date,title,source,created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  console.log("\n=== 2) СОСТОЯНИЕ ТАБЛИЦЫ (все ученики) ===");
  console.log(`всего строк: ${totalCount ?? 0} · из них source=scan: ${scanCount ?? 0}`);
  console.log("последние записи (любой ученик):");
  console.table(latest ?? []);

  console.log("\n=== ВЕРДИКТ ===");
  if ((totalCount ?? 0) === 0) {
    console.log("🔴 Гипотеза 1: таблица ПУСТА — скан ни разу не персистил. Резолюция: перепрогнать race-скан в мигрированную таблицу.");
  } else if ((scanCount ?? 0) === 0) {
    console.log("🟠 Есть только ручные (source=manual), scan-строк нет — авто-скан не доезжал до БД. Резолюция: проверить прогон tp-races-requests-once.");
  } else {
    console.log("🟡 Гипотеза 2: scan-строки ЕСТЬ для других учеников, но не для Нади → её slug не сматчился при персисте.");
    console.log(`   Сверить slug Нади "${student.student_id}" с races.json.student_id сканера (теперь видно в логе [tp-races] skip).`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
