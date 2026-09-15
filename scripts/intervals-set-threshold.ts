/**
 * Поставить или снять пороговый темп ученику Intervals.
 *
 * ЗАЧЕМ ЭТО ЕСТЬ СЕЙЧАС, ДО ДИАГНОСТИКИ. Колонки без единого способа записи —
 * мёртвый вес: их заводят, забывают и через месяц выясняют, что они пустые у
 * всех. Ручная простановка нужна и сама по себе: тренер, который видел человека
 * в деле, знает его порог лучше любого теста по десяти пробежкам.
 *
 * ЧТО МЕНЯЕТСЯ ПОСЛЕ ПРОСТАНОВКИ: качественные сессии в следующем сгенерённом
 * плане получают ТЕМПЫ вместо усилия. Уже записанные планы не трогаются: их
 * переписывание — отдельное решение тренера, а не побочный эффект.
 *
 * По умолчанию НИЧЕГО НЕ ПИШЕТ.
 *
 *   npm run intervals:set-threshold -- --athlete=i123456 --pace=4:35
 *   npm run intervals:set-threshold -- --athlete=i123456 --pace=4:35 --source=coach_manual --commit
 *   npm run intervals:set-threshold -- --athlete=i123456 --clear --commit
 */

import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const CLEAR = process.argv.includes("--clear");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

/** «4:35» или «275» → секунды на километр. */
function parsePace(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value);
  const match = value.match(/^(\d+):(\d{1,2})$/u);
  if (!match) fail(`Не понял темп «${value}». Пишите 4:35 или 275 (секунд на километр).`);
  return Number(match[1]) * 60 + Number(match[2]);
}

const paceText = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}/км`;

const SOURCES = new Set(["diagnostic", "race_result", "coach_manual"]);

async function main(): Promise<void> {
  const athleteId = arg("athlete");
  if (!athleteId) fail("Нужен --athlete=<id атлета в Intervals>");

  const supabase = createSupabaseServerClient();
  const { data: source, error } = await supabase
    .from("student_data_sources")
    .select("id, student_id, external_athlete_id, threshold_pace_sec_per_km, threshold_source, threshold_set_at")
    .eq("provider", "intervals")
    .eq("external_athlete_id", athleteId)
    .maybeSingle();
  if (error) fail(`источник не читается: ${error.message}`);
  if (!source) fail(`Источник для athlete ${athleteId} не заведён`);
  const row = source as Record<string, unknown>;

  const { data: card } = await supabase
    .from("trainingpeaks_students")
    .select("student_name, coaching_platform")
    .eq("id", String(row.student_id))
    .maybeSingle();
  const student = card as { student_name?: string; coaching_platform?: string } | null;

  // ЧУЖУЮ ПЛОЩАДКУ НЕ ТРОГАЕМ. У ростера TrainingPeaks порог живёт в журнале
  // применений и ставится своим путём; писать его сюда значило бы завести
  // второе место правды для одного числа.
  if (student?.coaching_platform !== "intervals") {
    fail(
      `Карточка «${student?.student_name ?? "?"}» на площадке «${student?.coaching_platform ?? "не задана"}». ` +
        "Этот скрипт ставит порог только ученикам Intervals."
    );
  }

  const current = row.threshold_pace_sec_per_km;
  console.log(`Ученик: ${student?.student_name ?? "?"} (${athleteId})`);
  console.log(
    `Сейчас: ${
      current === null || current === undefined
        ? "порога нет — работа назначается по усилию"
        : `${paceText(Number(current))} · источник ${row.threshold_source} · поставлен ${String(row.threshold_set_at).slice(0, 10)}`
    }`
  );

  if (CLEAR) {
    console.log("Будет сделано: порог снят, работа вернётся к назначению по усилию.");
    if (!COMMIT) {
      console.log("\nНичего не записано (запуск без --commit).");
      return;
    }
    const { error: clearError } = await supabase
      .from("student_data_sources")
      .update({ threshold_pace_sec_per_km: null, threshold_source: null, threshold_set_at: null })
      .eq("id", String(row.id));
    if (clearError) fail(`не сняли: ${clearError.message}`);
    console.log("Порог снят.");
    return;
  }

  const paceArg = arg("pace");
  if (!paceArg) fail("Нужен --pace=4:35 (или --clear)");
  const paceSec = parsePace(paceArg);
  const sourceKind = arg("source") ?? "coach_manual";
  if (!SOURCES.has(sourceKind)) fail("--source принимает diagnostic, race_result или coach_manual");

  // Границы те же, что в базе: опечатка должна отлетать здесь, с человеческим
  // текстом, а не констрейнтом.
  if (paceSec < 120 || paceSec > 720) {
    fail(`Темп ${paceText(paceSec)} вне разумного (2:00–12:00/км). Похоже на опечатку.`);
  }

  console.log("");
  console.log(`Будет сделано: порог ${paceText(paceSec)}, источник ${sourceKind}.`);
  console.log(
    "Следующий сгенерированный план получит темпы в качественных сессиях вместо усилия. " +
      "Уже записанные планы не изменятся."
  );

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  const { error: writeError } = await supabase
    .from("student_data_sources")
    .update({
      threshold_pace_sec_per_km: paceSec,
      threshold_source: sourceKind,
      threshold_set_at: new Date().toISOString(),
    })
    .eq("id", String(row.id));
  if (writeError) fail(`не записали: ${writeError.message}`);
  console.log(`Записано: ${paceText(paceSec)} · ${sourceKind}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
