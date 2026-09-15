/**
 * Порог ученика Intervals: где лежит, что с ним нельзя сделать и что он меняет.
 *
 * ТРИ ВЕЩИ, КАЖДАЯ ЛОМАЕТСЯ МОЛЧА:
 *   1. Половина порога. Число без происхождения и даты — это темпы всей работы
 *      цикла неизвестного качества. База обязана такое отклонять сама.
 *   2. Происхождение → доверие. От него зависит ширина полосы темпа: поставил
 *      тренер «на глаз» и измерили тестом — разные вещи, и полоса разная.
 *   3. Появление порога переключает работу с усилия на темп. Если не
 *      переключит, тренер поставит порог и не поймёт, почему ничего не
 *      изменилось.
 */

import { buildAnchors } from "../tools/trainingpeaks-export/scripts/lib/intervals-plan-adapter.ts";
import { createIntervalsStudent } from "@/features/intervals/enrollment";
import { createSupabaseServerClient } from "@/features/supabase/server";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

const KEY = "check-threshold-student";

/** Стартовая точка-заглушка: важны только те поля, что читает buildAnchors. */
function stubStart() {
  return {
    source: "history" as const,
    medianWeeklyMinutes: 160,
    easyPaceSec: 344,
    easyPaceSampleSize: 20,
    weekly: [],
    rolling4wWeeklyMinutes: 160,
    rolling8wWeeklyMinutes: 160,
    runsPerWeek: 4,
    dayHistogram: [0, 0, 0, 0, 0, 0, 0],
    weeksWithRuns: 8,
    typicalRunMinutes: 45,
    longestRunMinutes: 90,
    longRunMedianMinutes: 70,
    runMinutesP10: 30,
    runMinutesP90: 80,
    dayHistogramLong: [0, 0, 0, 0, 0, 0, 0],
    weeksObserved: 8,
    dataLevel: "heartrate" as const,
    runsWithHeartrate: 20,
    runsTotal: 24,
    notes: [],
  };
}

async function main(): Promise<void> {
  console.log("ПОРОГ УЧЕНИКА INTERVALS");
  const supabase = createSupabaseServerClient();

  step("ЯКОРЬ: ПРОИСХОЖДЕНИЕ ЗАДАЁТ ДОВЕРИЕ");
  const start = stubStart() as never;
  const none = buildAnchors(start, null);
  expect(none.threshold === null, "без записанного порога якоря порога нет");
  expect(none.qualityByEffort === true, "и работа назначается по усилию");

  const diag = buildAnchors(start, { paceSecPerKm: 275, source: "diagnostic", setAt: "2026-09-15" });
  expect(diag.threshold?.paceSec === 275, "порог из диагностики попал в якорь");
  expect(diag.threshold?.source === "intervals_threshold_diagnostic", "источник назван диагностикой");
  expect(diag.threshold?.confidence === "high", "диагностике доверяем высоко: это измерение");

  const race = buildAnchors(start, { paceSecPerKm: 280, source: "race_result", setAt: "2026-09-15" });
  expect(race.threshold?.confidence === "medium", "результату старта — ниже: обстоятельств старта мы не знаем");

  const manual = buildAnchors(start, { paceSecPerKm: 285, source: "coach_manual", setAt: "2026-09-15" });
  expect(manual.threshold?.confidence === "medium_low", "ручной простановке — ещё ниже: проверить нечем");

  step("БАЗА НЕ ПРИНИМАЕТ ПОЛОВИНУ ПОРОГА");

  // ── СНАЧАЛА ЧИСТОЕ СОСТОЯНИЕ, ПОТОМ ПРОВЕРКА ─────────────────────────────
  //
  // ПОЙМАНО 15.09.2026: проверка упала один раз и прошла на трёх следующих.
  // Причина: createIntervalsStudent заводит источник UPSERT-ом по паре
  // (provider, external_athlete_id), а athlete id у заготовки детерминированный
  // (pending-<ключ>). Значит остаток от прерванного прогона не создаётся заново,
  // а ОЖИВАЕТ вместе с колонками порога, которые тот прогон успел записать.
  // Дальше «обновим только темп» уже не нарушает констрейнт полноты: источник и
  // дата на строке остались с прошлого раза. Проверка при этом сама за собой
  // убирает, поэтому на следующем прогоне всё зелено, и дефект выглядит
  // плавающим. Плавающая проверка хуже падающей: она приучает не смотреть.
  const { data: leftover } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", KEY)
    .maybeSingle();
  if (leftover) {
    const uuid = String((leftover as { id: string }).id);
    console.log("  ⚑ остаток от прерванного прогона найден и снесён до начала");
    await supabase.rpc("delete_intervals_student", {
      p_student_uuid: uuid,
      p_deleted_by: "check:intervals-threshold (уборка перед стартом)",
    });
    await supabase.from("deleted_students_archive").delete().eq("student_uuid", uuid);
  }

  const created = await createIntervalsStudent({
    studentKey: KEY,
    name: "Проверка порога",
    telegramUserId: 999000333,
    telegramChatId: "999000333",
    athleteId: null,
    prefill: null,
  });

  // Предпосылка названа вслух: без неё следующая проверка проверяет не то, что
  // написано в её тексте, и молча.
  const { data: fresh } = await supabase
    .from("student_data_sources")
    .select("threshold_pace_sec_per_km, threshold_source, threshold_set_at")
    .eq("id", created.sourceId)
    .maybeSingle();
  const freshRow = fresh as Record<string, unknown> | null;
  expect(
    freshRow !== null &&
      freshRow.threshold_pace_sec_per_km === null &&
      freshRow.threshold_source === null &&
      freshRow.threshold_set_at === null,
    "источник заведён пустым: порога на нём нет"
  );

  const { error: halfError } = await supabase
    .from("student_data_sources")
    .update({ threshold_pace_sec_per_km: 275 })
    .eq("id", created.sourceId);
  expect(halfError !== null, "число без источника и даты отклонено");

  const { error: crazyError } = await supabase
    .from("student_data_sources")
    .update({
      threshold_pace_sec_per_km: 45,
      threshold_source: "coach_manual",
      threshold_set_at: new Date().toISOString(),
    })
    .eq("id", created.sourceId);
  expect(crazyError !== null, "темп 0:45/км отклонён как опечатка");

  const { error: badSource } = await supabase
    .from("student_data_sources")
    .update({
      threshold_pace_sec_per_km: 275,
      threshold_source: "приснилось",
      threshold_set_at: new Date().toISOString(),
    })
    .eq("id", created.sourceId);
  expect(badSource !== null, "выдуманное происхождение отклонено");

  const { error: okError } = await supabase
    .from("student_data_sources")
    .update({
      threshold_pace_sec_per_km: 275,
      threshold_source: "coach_manual",
      threshold_set_at: new Date().toISOString(),
    })
    .eq("id", created.sourceId);
  expect(okError === null, "полный порог записывается");

  const { data: readBack } = await supabase
    .from("student_data_sources")
    .select("threshold_pace_sec_per_km, threshold_source")
    .eq("id", created.sourceId)
    .maybeSingle();
  const row = readBack as Record<string, unknown> | null;
  expect(Number(row?.threshold_pace_sec_per_km) === 275, "и читается обратно тем же числом");

  step("УБОРКА");
  const { error: deleteError } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: created.studentUuid,
    p_deleted_by: "check:intervals-threshold",
  });
  expect(deleteError === null, `удаление прошло${deleteError ? `: ${deleteError.message}` : ""}`);
  await supabase.from("deleted_students_archive").delete().eq("student_uuid", created.studentUuid);
  const { data: gone } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", KEY)
    .maybeSingle();
  expect(gone === null, "данные прогона удалены");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
