/**
 * Диагностический тест: найти запись, посчитать порог, показать тренеру.
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ. Порог записывается только с --commit и только
 * когда тест признан ровным. Сомнительный и невалидный тест порог не пишут
 * НИКОГДА, даже с --commit: они показывают числа и оставляют решение тренеру.
 *
 * ПОЧЕМУ ТАК СТРОГО. Ошибка в сторону «порог быстрее, чем на самом деле» делает
 * ВСЮ дальнейшую качественную работу непосильной, и человек это почувствует не
 * сразу, а через две недели накопленной усталости. Ошибка в сторону «порога
 * нет» не стоит ничего: работа продолжает идти по усилию, как и шла.
 *
 *   npm run intervals:test -- --athlete=i123456
 *   npm run intervals:test -- --athlete=i123456 --date=2026-09-24
 *   npm run intervals:test -- --athlete=i123456 --commit
 *   npm run intervals:test -- --athlete=i123456 --decline     # человек отказался
 *   npm run intervals:test -- --athlete=i123456 --allow       # отказ снят
 */

import process from "node:process";

import {
  DIAGNOSTIC_TEST_PRESET,
  evaluateTest,
  pickTestRecord,
  testPaceText,
  type DayRecord,
} from "@/features/intervals/diagnostic-test";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const DECLINE = process.argv.includes("--decline");
const ALLOW = process.argv.includes("--allow");

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
  const athleteId = arg("athlete");
  if (!athleteId) fail("Нужен --athlete=<id атлета в Intervals>");

  const supabase = createSupabaseServerClient();
  const { data: sourceRow, error: sourceError } = await supabase
    .from("student_data_sources")
    .select(
      "id, student_id, external_athlete_id, auth_method, threshold_pace_sec_per_km, threshold_source, threshold_set_at"
    )
    .eq("provider", "intervals")
    .eq("external_athlete_id", athleteId)
    .maybeSingle();
  if (sourceError) fail(`источник не читается: ${sourceError.message}`);
  if (!sourceRow) fail(`Источник для athlete ${athleteId} не заведён`);
  const source = sourceRow as Record<string, unknown>;

  const { data: cardRow } = await supabase
    .from("trainingpeaks_students")
    .select("student_name, coaching_platform")
    .eq("id", String(source.student_id))
    .maybeSingle();
  const card = cardRow as { student_name?: string; coaching_platform?: string } | null;
  console.log(`Ученик: ${card?.student_name ?? "?"} (${athleteId})`);

  // РУЧНОЙ ВВОД: РЯДОВ НЕ БУДЕТ НИКОГДА [16.09.2026]. Отдельно от «ряды ещё не
  // приехали» (та ошибка чинится синхронизацией, ниже по коду) — здесь чинить
  // нечего, ряды структурно не появятся. Отказ ДО попытки разбора: указывать
  // на синхронизацию было бы враньём для этого случая.
  if (!DECLINE && !ALLOW && source.auth_method === "manual") {
    fail(
      "У этого ученика ручной ввод: посекундных рядов не будет никогда, автоматический разбор " +
        "теста (ровно/сомнительно/невалидно) считать не по чему.\n" +
        "Если тест проведён по протоколу и вы доверяете её отчёту о темпе — поставьте порог сами:\n" +
        `  npm run intervals:set-threshold -- --athlete=${athleteId} --pace=<темп> --source=coach_manual --commit`
    );
  }

  // ── Отказ от теста ──
  if (DECLINE || ALLOW) {
    const value = DECLINE ? new Date().toISOString() : null;
    console.log(
      DECLINE
        ? "Будет сделано: тест помечен как отклонённый, в планы он больше не ставится."
        : "Будет сделано: отказ снят, тест снова может попасть в план."
    );
    if (!COMMIT) {
      console.log("\nНичего не записано (запуск без --commit).");
      return;
    }
    const { error } = await supabase
      .from("student_data_sources")
      .update({ diagnostic_test_declined_at: value })
      .eq("id", String(source.id));
    if (error) fail(`не записали: ${error.message}. Похоже, миграция 20261015000000 ещё не применена.`);
    console.log(DECLINE ? "Отказ записан." : "Отказ снят.");
    return;
  }

  // ── Какой день разбираем ──
  let date = arg("date");
  if (!date) {
    const { data: planned } = await supabase
      .from("intervals_plan_sessions")
      .select("session_date, cycle_id, intervals_plan_cycles!inner(source_id)")
      .eq("preset_code", DIAGNOSTIC_TEST_PRESET)
      .eq("intervals_plan_cycles.source_id", String(source.id))
      .lte("session_date", new Date().toISOString().slice(0, 10))
      .order("session_date", { ascending: false })
      .limit(1);
    const row = (planned ?? [])[0] as { session_date?: string } | undefined;
    if (!row?.session_date) {
      fail(
        "В планах этого ученика нет прошедшего диагностического теста, и --date не задан.\n" +
          "Укажите день вручную: --date=ГГГГ-ММ-ДД"
      );
    }
    date = row.session_date;
    console.log(`День теста из плана: ${date}`);
  } else {
    console.log(`День теста задан вручную: ${date}`);
  }

  // ── Записи этого дня ──
  const { data: acts, error: actError } = await supabase
    .from("intervals_activities")
    .select("activity_id, name, activity_type, start_date_local, moving_time_s, distance_m")
    .eq("source_id", String(source.id))
    .gte("start_date_local", `${date}T00:00:00`)
    .lte("start_date_local", `${date}T23:59:59`)
    .order("start_date_local", { ascending: true });
  if (actError) fail(`тренировки не читаются: ${actError.message}`);

  const runs = (acts ?? []).filter((raw) =>
    String((raw as Record<string, unknown>).activity_type ?? "").toLowerCase().includes("run")
  );
  console.log(`Записей в этот день: ${(acts ?? []).length}, из них беговых ${runs.length}`);
  if (runs.length === 0) {
    console.log("\nТеста нет: в этот день бег не записан. Возможно, человек его перенёс или не делал.");
    return;
  }

  const dayRecords: DayRecord[] = runs.map((raw) => {
    const row = raw as Record<string, unknown>;
    const seconds = Number(row.moving_time_s ?? 0);
    const metres = row.distance_m === null || row.distance_m === undefined ? null : Number(row.distance_m);
    return {
      activityId: String(row.activity_id),
      name: (row.name as string | null) ?? null,
      movingTimeS: seconds,
      paceSecPerKm: metres && metres > 0 ? (seconds / metres) * 1000 : null,
    };
  });
  for (const r of dayRecords) {
    console.log(
      `   · ${Math.round(r.movingTimeS / 60)} мин` +
        `${r.paceSecPerKm ? `, ${testPaceText(r.paceSecPerKm)}/км` : ""} — ${r.name ?? "без названия"}`
    );
  }

  const pick = pickTestRecord(dayRecords);
  console.log(`\nВыбор записи: ${pick.note}`);
  if (!pick.record) {
    console.log("Порог не считаем: считать не из чего.");
    return;
  }

  const { data: streamRow, error: streamError } = await supabase
    .from("intervals_activity_streams")
    .select("time_s, velocity_smooth, point_count")
    .eq("activity_id", pick.record.activityId)
    .maybeSingle();
  if (streamError) fail(`ряды не читаются: ${streamError.message}`);
  if (!streamRow) {
    console.log(
      "\nРядов по этой записи нет, а без них посчитать последние двадцать минут нельзя.\n" +
        "Проверьте, что синхронизация их забрала: npm run intervals:sync"
    );
    return;
  }
  const stream = streamRow as Record<string, unknown>;
  const timeS = Array.isArray(stream.time_s) ? (stream.time_s as number[]) : [];
  const velocity = Array.isArray(stream.velocity_smooth)
    ? (stream.velocity_smooth as Array<number | null>)
    : [];

  // Якорь лёгкого: отличить тест от лёгкой пробежки. Берём измеренную медиану
  // медленной половины за последние недели, тем же способом, что и стартовая
  // точка, но по короткому окну: форма могла измениться.
  const easyPace = await measuredEasyPace(supabase, String(source.id));
  console.log(
    `Якорь лёгкого для сверки: ${easyPace ? `${testPaceText(easyPace)}/км` : "нет (сверка пропущена)"}`
  );

  const result = evaluateTest({
    timeS,
    velocity,
    fromLongRecord: pick.fromLongRecord,
    easyPaceSec: easyPace,
  });

  console.log("");
  console.log("── Разбор ───────────────────────────────────");
  if (!result.metrics) {
    console.log(`вердикт: ${result.verdict}`);
    for (const reason of result.reasons) console.log(`  · ${reason}`);
    return;
  }
  const m = result.metrics;
  console.log(`зачётные 20 минут:   с ${Math.round(result.windowStartOffsetS / 60)}-й минуты записи`);
  console.log(`средний темп:        ${testPaceText(m.thresholdSecPerKm)}/км  ← кандидат в порог`);
  console.log(`разброс темпа:       ${m.cvPct.toFixed(1)} %`);
  console.log(`вторая десятка:      ${m.fadePct >= 0 ? "+" : ""}${m.fadePct.toFixed(1)} % к первой`);
  console.log(`стоял:               ${m.stillPct.toFixed(1)} % времени`);
  console.log(
    `поминутно:           ${m.minutePaces
      .map((p) => (p === null ? "стоп" : testPaceText(p)))
      .join(" ")}`
  );
  console.log("");
  console.log(`ВЕРДИКТ: ${result.verdict.toUpperCase()}`);
  for (const reason of result.reasons) console.log(`  · ${reason}`);

  if (result.verdict !== "ровно") {
    console.log("");
    console.log("Порог НЕ записывается: тест не признан ровным. Решение за вами.");
    console.log("Если вы всё равно считаете это число верным:");
    console.log(
      `  npm run intervals:set-threshold -- --athlete=${athleteId} ` +
        `--pace=${testPaceText(m.thresholdSecPerKm)} --source=diagnostic --commit`
    );
    console.log("Если тест не удался, его можно повторить: следующий план поставит его снова.");
    return;
  }

  const current = source.threshold_pace_sec_per_km;
  console.log("");
  console.log(
    `Будет сделано: порог ${testPaceText(m.thresholdSecPerKm)}/км, источник diagnostic.` +
      (current === null || current === undefined
        ? ""
        : ` Прежний ${testPaceText(Number(current))}/км (${source.threshold_source}) будет заменён.`)
  );
  console.log(
    "Уже записанные планы не изменятся. Чтобы качество получило темпы, план нужно перегенерировать:\n" +
      `  npm run intervals:plan -- --athlete=${athleteId}`
  );

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }
  const { error: writeError } = await supabase
    .from("student_data_sources")
    .update({
      threshold_pace_sec_per_km: Math.round(m.thresholdSecPerKm),
      threshold_source: "diagnostic",
      threshold_set_at: new Date().toISOString(),
    })
    .eq("id", String(source.id));
  if (writeError) fail(`не записали: ${writeError.message}`);
  console.log(`\nЗаписано: ${testPaceText(m.thresholdSecPerKm)}/км · diagnostic.`);
}

/**
 * Медиана темпа медленной половины беговых тренировок за последние 8 недель.
 *
 * Тот же приём, что у стартовой точки: «лёгкое» это медленная половина того, что
 * человек бегает. Короткое окно, потому что сверять тест надо с нынешней формой,
 * а не со средней за год.
 */
async function measuredEasyPace(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sourceId: string
): Promise<number | null> {
  const since = new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("intervals_activities")
    .select("activity_type, moving_time_s, distance_m, start_date_local")
    .eq("source_id", sourceId)
    .gte("start_date_local", `${since}T00:00:00`)
    .limit(400);
  const paces = (data ?? [])
    .filter((raw) => String((raw as Record<string, unknown>).activity_type ?? "").toLowerCase().includes("run"))
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const seconds = Number(row.moving_time_s ?? 0);
      const metres = Number(row.distance_m ?? 0);
      return seconds > 600 && metres > 1000 ? (seconds / metres) * 1000 : null;
    })
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  if (paces.length < 4) return null;
  const slowHalf = paces.slice(Math.ceil(paces.length / 2));
  return slowHalf[Math.floor(slowHalf.length / 2)];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
