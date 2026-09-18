/**
 * Поставить или снять якорь лёгкого темпа ученику Intervals.
 *
 * ЗАЧЕМ ЭТО ОТДЕЛЬНО ОТ ПОРОГА. Порог задаёт темпы РАБОТЫ, якорь лёгкого —
 * темпы всего остального: разминки, трусцы, лёгких и длительных. Без порога
 * работа идёт по усилию и план всё равно собирается. Без якоря лёгкого не
 * собирается НИЧЕГО: buildWeek отказывает каждой сессии с
 * no_easy_anchor_and_no_fallback, включая качественную (режим «по усилию»
 * требует, чтобы разминка и трусца имели темп).
 *
 * КОМУ НУЖНО. Тем, у кого истории не будет никогда: нет подключаемых часов,
 * данные не приезжают, измерить темп не из чего. У людей с историей якорь
 * считается по пробежкам сам, и ставить его руками не надо.
 *
 * ПОЧЕМУ НЕ ФЛАГОМ НА ГЕНЕРАЦИИ. Раньше был только --easy-pace, и он нигде не
 * сохранялся: следующая генерация снова оставалась без якоря. Дыра общая для
 * всего сегмента, а не разовая — поэтому число живёт в student_data_sources
 * рядом с порогом, с происхождением и датой.
 *
 * ДОВЕРИЕ. Названный тренером якорь всегда идёт как coach_stated и получает
 * доверие на ступень ниже измеренного (см. easyConfidence в
 * intervals-plan-adapter). Это не придирка: у измеренного точность зависит от
 * приёмника, у названного — от памяти человека.
 *
 * По умолчанию НИЧЕГО НЕ ПИШЕТ.
 *
 *   npm run intervals:set-easy-pace -- --athlete=i123456 --pace=7:22
 *   npm run intervals:set-easy-pace -- --athlete=i123456 --pace=7:22 --commit
 *   npm run intervals:set-easy-pace -- --athlete=i123456 --clear --commit
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

/** «7:22» или «442» → секунды на километр. */
function parsePace(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value);
  const match = value.match(/^(\d+):(\d{1,2})$/u);
  if (!match) fail(`Не понял темп «${value}». Пишите 7:22 или 442 (секунд на километр).`);
  return Number(match[1]) * 60 + Number(match[2]);
}

const paceText = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}/км`;

async function main(): Promise<void> {
  const athleteId = arg("athlete");
  if (!athleteId) fail("Нужен --athlete=<id атлета в Intervals>");

  const supabase = createSupabaseServerClient();
  const { data: source, error } = await supabase
    .from("student_data_sources")
    .select(
      "id, student_id, external_athlete_id, auth_method, easy_pace_sec_per_km, easy_pace_source, easy_pace_set_at"
    )
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

  // ЧУЖУЮ ПЛОЩАДКУ НЕ ТРОГАЕМ — та же причина, что и у порога: у ростера
  // TrainingPeaks якорь лёгкого считается по назначениям тренера в самом TP,
  // и второе место правды для одного числа заводить нельзя.
  if (student?.coaching_platform !== "intervals") {
    fail(
      `Карточка «${student?.student_name ?? "?"}» на площадке «${student?.coaching_platform ?? "не задана"}». ` +
        "Этот скрипт ставит якорь лёгкого только ученикам Intervals."
    );
  }

  const current = row.easy_pace_sec_per_km;
  console.log(`Ученик: ${student?.student_name ?? "?"} (${athleteId})`);
  console.log(
    `Сейчас: ${
      current === null || current === undefined
        ? "якоря нет — если истории тоже нет, план соберётся пустым"
        : `${paceText(Number(current))} · источник ${row.easy_pace_source} · поставлен ${String(row.easy_pace_set_at).slice(0, 10)}`
    }`
  );

  if (CLEAR) {
    console.log("");
    console.log(
      "Будет сделано: якорь снят. У человека без истории следующий план соберётся пустым: " +
        "темпы лёгкого брать будет неоткуда."
    );
    if (!COMMIT) {
      console.log("\nНичего не записано (запуск без --commit).");
      return;
    }
    const { error: clearError } = await supabase
      .from("student_data_sources")
      .update({ easy_pace_sec_per_km: null, easy_pace_source: null, easy_pace_set_at: null })
      .eq("id", String(row.id));
    if (clearError) fail(`не сняли: ${clearError.message}`);
    console.log("Якорь снят.");
    return;
  }

  const paceArg = arg("pace");
  if (!paceArg) fail("Нужен --pace=7:22 (или --clear)");
  const paceSec = parsePace(paceArg);

  // Границы шире, чем у порога: лёгкий медленнее порога по определению, и у
  // человека, который начинает, он вполне бывает за 8 минут на километр.
  if (paceSec < 180 || paceSec > 900) {
    fail(`Темп ${paceText(paceSec)} вне разумного (3:00–15:00/км). Похоже на опечатку.`);
  }

  console.log("");
  console.log(`Будет сделано: якорь лёгкого ${paceText(paceSec)}, источник coach_manual.`);
  console.log(
    "Источник всегда coach_manual: измеренный якорь берётся из истории сам, руками его не ставят. " +
      "Доверие к нему на ступень ниже измеренного, и это видно в отчёте генерации."
  );
  console.log("Следующий сгенерированный план получит темпы лёгкого. Уже записанные не изменятся.");

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  const { error: writeError } = await supabase
    .from("student_data_sources")
    .update({
      easy_pace_sec_per_km: paceSec,
      easy_pace_source: "coach_manual",
      easy_pace_set_at: new Date().toISOString(),
    })
    .eq("id", String(row.id));
  if (writeError) fail(`не записали: ${writeError.message}`);
  console.log(`Записано: ${paceText(paceSec)} · coach_manual.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
