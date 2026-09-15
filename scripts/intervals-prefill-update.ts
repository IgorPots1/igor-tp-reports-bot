/**
 * Дописать предзаполнение анкеты уже заведённому ученику Intervals.
 *
 * ── ЗАЧЕМ ЭТА КОМАНДА, А НЕ intervals-student-setup.ts ─────────────────────
 *
 * Тот скрипт заводит ученика целиком: карточку, ИСТОЧНИК и ключ доступа — его
 * --commit безусловно перезаписывает student_data_sources UPSERT-ом
 * (auth_method, credential). Если человек уже заведён из бота и подключил
 * часы через OAuth, повторный прогон того скрипта СОТРЁТ живой OAuth-токен
 * поддельным api_key из --key-env. Эта команда до student_data_sources не
 * дотрагивается вообще: она читает существующий источник ТОЛЬКО чтобы найти
 * его id, и пишет исключительно в intervals_onboarding_prefill.
 *
 * ── ПОЧЕМУ «ДОПИСАТЬ», А НЕ «ЗАМЕНИТЬ» ──────────────────────────────────────
 *
 * savePrefill пишет ВСЮ строку разом (upsert по source_id): поле, которого нет
 * во входе, стало бы NULL. Если раньше был задан --pre-goal, а сегодня
 * добавляем только --pre-weekly-minutes, наивная запись стёрла бы цель. Эта
 * команда СНАЧАЛА читает то, что уже стоит, и сливает новые поля поверх —
 * старое остаётся, если про него сегодня не сказано ни слова.
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ.
 *
 *   npm run intervals:prefill -- --student=valentina-1234 --pre-weekly-minutes=120
 *   npm run intervals:prefill -- --athlete=i123456 --pre-weekly-minutes=120 --commit
 *   npm run intervals:prefill -- --student=valentina-1234 --show   (что уже стоит, без правок)
 */

import process from "node:process";

import { collectPrefillArgs } from "@/features/intervals/prefill-args";
import { fieldLabelRu, type PrefillableField } from "@/features/intervals/loop/prefill";
import { getPrefill, savePrefill } from "@/features/intervals/loop/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const SHOW_ONLY = process.argv.includes("--show");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "нет";
  return String(value);
}

async function main(): Promise<void> {
  const studentKey = arg("student");
  const athleteId = arg("athlete");
  if (!studentKey && !athleteId) fail("Нужен --student=<ключ карточки> или --athlete=<id в Intervals>");

  const supabase = createSupabaseServerClient();

  // ТОЛЬКО ЧТЕНИЕ student_data_sources — искать id, не менять ни одной колонки.
  let sourceQuery = supabase
    .from("student_data_sources")
    .select("id, student_id, external_athlete_id")
    .eq("provider", "intervals");
  if (athleteId) {
    sourceQuery = sourceQuery.eq("external_athlete_id", athleteId);
  } else {
    const { data: card } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name")
      .eq("student_id", studentKey)
      .maybeSingle();
    if (!card) fail(`Карточка «${studentKey}» не найдена`);
    sourceQuery = sourceQuery.eq("student_id", String((card as { id: string }).id));
  }
  const { data: source, error: sourceError } = await sourceQuery.maybeSingle();
  if (sourceError) fail(`источник не читается: ${sourceError.message}`);
  if (!source) {
    fail(
      "Источник Intervals не найден. Эта команда только ДОПИСЫВАЕТ предзаполнение уже " +
        "заведённому ученику — заводит человека intervals-student-setup.ts (терминал) или бот."
    );
  }
  const src = source as { id: string; student_id: string | null; external_athlete_id: string };

  const { data: card } = await supabase
    .from("trainingpeaks_students")
    .select("student_name")
    .eq("id", String(src.student_id))
    .maybeSingle();
  console.log(`Ученик: ${(card as { student_name?: string } | null)?.student_name ?? "?"} (${src.external_athlete_id})`);

  const existing = await getPrefill(src.id);
  console.log("");
  console.log("── Что уже предзаполнено ─────────────────────");
  if (!existing || existing.setFields.length === 0) {
    console.log("  ничего не задано");
  } else {
    for (const field of existing.setFields) {
      console.log(`  ${fieldLabelRu(field)} = ${fmt(existing.values[field])}`);
    }
  }

  if (SHOW_ONLY) return;

  const parsed = collectPrefillArgs();
  if (parsed.errors.length > 0) fail(parsed.errors.map((e) => `Отказ: ${e}`).join("\n"));
  if (parsed.setFields.length === 0) {
    console.log("");
    console.log("Флагов --pre-* не передано. Ничего дописывать. Смотрите --show.");
    return;
  }

  // СЛИЯНИЕ: старые поля остаются, новые из этого запуска перезаписывают
  // ровно себя. Порядок важен — новые значения должны победить старые с тем
  // же именем, а не наоборот.
  const mergedSetFields = [...new Set([...(existing?.setFields ?? []), ...parsed.setFields])] as PrefillableField[];
  const mergedValues = { ...(existing?.values ?? {}), ...parsed.values };

  console.log("");
  console.log("── Допишем этим запуском ─────────────────────");
  for (const field of parsed.setFields) {
    const before = existing?.values[field as keyof typeof mergedValues];
    const after = parsed.values[field];
    console.log(
      before === undefined || before === null
        ? `  ${fieldLabelRu(field)}: — → ${fmt(after)}`
        : `  ${fieldLabelRu(field)}: ${fmt(before)} → ${fmt(after)}`
    );
  }
  console.log("");
  console.log(
    "Не трогается: подключение, OAuth-токен, активность источника, всё остальное " +
      "предзаполнение, которое уже стояло."
  );

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  const note = arg("pre-note");
  const saved = await savePrefill({
    sourceId: src.id,
    setFields: mergedSetFields,
    values: mergedValues,
    note: note ?? existing?.note ?? null,
    setBy: "igor",
  });
  if (!saved.ok) fail(`не записалось: ${saved.message}`);
  console.log("Записано.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
