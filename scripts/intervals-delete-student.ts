/**
 * Удаление ученика Intervals из терминала.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ АДМИНКИ. Во-первых, тестовые прогоны заводят карточки
 * пачками, и чистить их мышкой по одной глупо. Во-вторых, админка живёт на том
 * же сервере, что и всё остальное: если она лежит, удалить всё равно должно
 * быть чем.
 *
 * ── ЧЕМ ЭТОТ ПУТЬ ОТЛИЧАЕТСЯ ОТ КНОПКИ ──────────────────────────────────────
 *
 * Тем, что перед удалением он СОХРАНЯЕТ СНИМОК. Всё, что будет стёрто, пишется
 * в JSON рядом с репозиторием. Кнопка в админке так не умеет (серверу некуда
 * писать файл), а здесь это бесплатно — и это единственная существующая защита
 * от «удалил не того».
 *
 * По умолчанию НИЧЕГО НЕ УДАЛЯЕТ: показывает, что будет снесено, и выходит.
 *
 *   npm run intervals:delete-student -- --student=valentina-1234
 *   npm run intervals:delete-student -- --student=valentina-1234 --commit
 *   npm run intervals:delete-student -- --test-leftovers            (список мусора)
 *   npm run intervals:delete-student -- --test-leftovers --commit
 *   npm run intervals:delete-student -- --sweep-archive            (просроченные снимки)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { previewStudentDeletion } from "@/features/intervals/delete-student";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const LEFTOVERS = process.argv.includes("--test-leftovers");
const SWEEP = process.argv.includes("--sweep-archive");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

/**
 * Карточки, оставшиеся от прогонов.
 *
 * СПИСОК ЯВНЫЙ, А НЕ ПО МАСКЕ. Маска вроде «всё, где есть check» однажды
 * совпадёт с фамилией живого человека. Ключи перечислены руками, и добавить
 * новый — осознанное действие.
 */
const TEST_KEYS = [
  "check-loop-student",
  "check-prefill-student",
  "check-valentina",
  "check-oauth-student",
  "valentina-scenario",
  "igor-test",
  "parity-probe",
  // Оставлены проверкой заведения до того, как её уборка научилась удалять.
  "valentina-proverka-0111",
  "valentina-proverka-0111-bot",
];

function dumpDir(): string {
  return path.join(process.env.HOME ?? ".", "ops-log", "deleted-students");
}

async function removeOne(studentUuid: string, label: string): Promise<boolean> {
  const preview = await previewStudentDeletion(studentUuid);
  if (!preview) {
    console.log(`  ${label}: карточки нет`);
    return false;
  }

  console.log(`\n── ${preview.studentName} (${preview.studentKey}) ──`);
  console.log(`   площадка: ${preview.platform ?? "не задана"} · активна: ${preview.isActive ? "да" : "нет"}`);
  for (const row of preview.rows) {
    if (row.count > 0) console.log(`   ${row.labelRu}: ${row.count}`);
  }
  console.log(`   всего строк: ${preview.total}`);
  if (preview.looksLikeRealStudent) {
    console.log("   ⚠ есть чек-ины и тексты тренера — похоже на живого человека");
  }

  if (!COMMIT) return false;

  // СНИМОК ДО УДАЛЕНИЯ. Пишем именно данные, а не только счётчики: счётчик не
  // вернёт человеку его историю, а файл вернёт.
  const supabase = createSupabaseServerClient();
  const { data: sources } = await supabase
    .from("student_data_sources")
    .select("*")
    .eq("student_id", studentUuid);
  const sourceIds = (sources ?? []).map((row) => String((row as { id: string }).id));
  const grab = async (table: string, column: string) => {
    if (sourceIds.length === 0 && column === "source_id") return [];
    const query = supabase.from(table).select("*");
    const { data } = column === "source_id"
      ? await query.in("source_id", sourceIds)
      : await query.eq(column, studentUuid);
    return data ?? [];
  };
  const snapshot = {
    takenAt: new Date().toISOString(),
    card: preview,
    sources: sources ?? [],
    answers: await grab("intervals_onboarding_answers", "source_id"),
    prefill: await grab("intervals_onboarding_prefill", "source_id"),
    cycles: await grab("intervals_plan_cycles", "source_id"),
    checkins: await grab("intervals_checkins", "source_id"),
    coachMessages: await grab("intervals_coach_messages", "source_id"),
    progression: await grab("intervals_beginner_progression", "source_id"),
  };
  mkdirSync(dumpDir(), { recursive: true });
  const file = path.join(dumpDir(), `${preview.studentKey}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`   снимок сохранён: ${file}`);

  const { error } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: studentUuid,
    p_deleted_by: "terminal",
  });
  if (error) {
    console.error(`   ⛔ не удалено: ${error.message}`);
    return false;
  }
  console.log("   удалено");
  return true;
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  console.log(COMMIT ? "УДАЛЕНИЕ УЧЕНИКА" : "УДАЛЕНИЕ УЧЕНИКА · холостой прогон, ничего не трогаю");

  // ── Чистка архива ──
  //
  // ОТДЕЛЬНОЙ КОМАНДОЙ, А НЕ ПО РАСПИСАНИЮ. Архив существует, чтобы отменить
  // ошибку; автоматическая чистка означала бы, что однажды он молча опустеет
  // ровно перед тем, как понадобится. Пусть удаляет человек, видя список.
  if (SWEEP) {
    const { data, error } = await supabase
      .from("deleted_students_archive")
      .select("id, student_key, student_name, deleted_at, expires_at")
      .lt("expires_at", new Date().toISOString());
    if (error) {
      console.error(`архив не читается: ${error.message}`);
      process.exit(1);
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    console.log(`\nПросроченных снимков: ${rows.length}`);
    for (const row of rows) {
      console.log(`  ${row.student_name} (${row.student_key}) · удалён ${String(row.deleted_at).slice(0, 10)}`);
    }
    if (!COMMIT) {
      console.log(rows.length ? "\nНичего не удалено. Повторите с --commit." : "");
      return;
    }
    for (const row of rows) {
      await supabase.from("deleted_students_archive").delete().eq("id", String(row.id));
    }
    console.log(`Удалено снимков: ${rows.length}`);
    return;
  }

  if (LEFTOVERS) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_id, student_name, coaching_platform, is_active")
      .in("student_id", TEST_KEYS);
    if (error) {
      console.error(`не читаются карточки: ${error.message}`);
      process.exit(1);
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    console.log(`\nКарточки от прогонов: ${rows.length} из ${TEST_KEYS.length} известных ключей`);
    let removed = 0;
    for (const row of rows) {
      const ok = await removeOne(String(row.id), String(row.student_id));
      if (ok) removed += 1;
    }
    console.log("");
    console.log(COMMIT ? `Удалено карточек: ${removed}` : "Ничего не удалено. Повторите с --commit.");
    return;
  }

  const key = arg("student");
  if (!key) {
    console.error("Нужен --student=<ключ карточки или uuid> либо --test-leftovers");
    process.exit(1);
  }

  const isUuid = /^[0-9a-f-]{36}$/iu.test(key);
  const { data } = isUuid
    ? await supabase.from("trainingpeaks_students").select("id").eq("id", key).maybeSingle()
    : await supabase.from("trainingpeaks_students").select("id").eq("student_id", key).maybeSingle();
  if (!data) {
    console.error(`Карточка «${key}» не найдена`);
    process.exit(1);
  }
  const ok = await removeOne(String((data as { id: string }).id), key);
  console.log("");
  console.log(ok ? "Готово." : COMMIT ? "Не удалено, причина выше." : "Ничего не удалено. Повторите с --commit.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
