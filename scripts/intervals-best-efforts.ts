/**
 * Самые быстрые непрерывные работы ученика за N недель.
 *
 * ЗАЧЕМ. Чтобы поставить пороговый темп руками, тренеру нужно увидеть не
 * среднюю по пробежке (в ней разминка, заминка и светофоры), а то, что человек
 * реально ДЕРЖАЛ подряд: лучшие двадцать минут, лучшие тридцать. Иначе
 * приходится листать тренировки глазами или уходить в intervals.icu.
 *
 * READ-ONLY: только читает ряды и считает. Ничего не пишет и никому не шлёт.
 *
 *   npm run intervals:best-efforts -- --athlete=i123456
 *   npm run intervals:best-efforts -- --athlete=i123456 --weeks=8 --top=3
 *   npm run intervals:best-efforts -- --student=valentina-1234
 */

import process from "node:process";

import { bestEfforts, DEFAULT_DURATIONS_S, paceText } from "@/features/intervals/best-efforts";
import { createSupabaseServerClient } from "@/features/supabase/server";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

const WEEKS = Number(arg("weeks") ?? 12);
const TOP = Number(arg("top") ?? 5);

type Row = {
  activityId: string;
  name: string | null;
  date: string;
  minutes: number;
  distanceKm: number | null;
};

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();

  const athleteId = arg("athlete");
  const studentKey = arg("student");
  if (!athleteId && !studentKey) fail("Нужен --athlete=<id в Intervals> или --student=<ключ карточки>");

  let sourceQuery = supabase
    .from("student_data_sources")
    .select("id, student_id, external_athlete_id")
    .eq("provider", "intervals");
  if (athleteId) {
    sourceQuery = sourceQuery.eq("external_athlete_id", athleteId);
  } else {
    const { data: card } = await supabase
      .from("trainingpeaks_students")
      .select("id")
      .eq("student_id", studentKey)
      .maybeSingle();
    if (!card) fail(`Карточка «${studentKey}» не найдена`);
    sourceQuery = sourceQuery.eq("student_id", String((card as { id: string }).id));
  }
  const { data: source, error: sourceError } = await sourceQuery.maybeSingle();
  if (sourceError) fail(`источник не читается: ${sourceError.message}`);
  if (!source) fail("Источник Intervals не найден");
  const src = source as { id: string; student_id: string | null; external_athlete_id: string };

  const { data: card } = await supabase
    .from("trainingpeaks_students")
    .select("student_name")
    .eq("id", String(src.student_id))
    .maybeSingle();

  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000).toISOString().slice(0, 10);
  const { data: activities, error: actError } = await supabase
    .from("intervals_activities")
    .select("activity_id, name, activity_type, start_date_local, moving_time_s, distance_m")
    .eq("source_id", src.id)
    .gte("start_date_local", `${since}T00:00:00`)
    .order("start_date_local", { ascending: false })
    .limit(400);
  if (actError) fail(`тренировки не читаются: ${actError.message}`);

  // ТОЛЬКО БЕГ. Велосипед и плавание в пороговый темп не годятся, а в списке
  // выглядели бы убедительно быстрыми.
  const runs = (activities ?? []).filter((raw) => {
    const row = raw as Record<string, unknown>;
    return String(row.activity_type ?? "").toLowerCase().includes("run");
  });

  const who = (card as { student_name?: string } | null)?.student_name
    ?? (src.student_id ? "карточка без имени" : "самоисточник тренера, не ученик");
  console.log(`Ученик: ${who} (${src.external_athlete_id})`);
  console.log(`Окно: последние ${WEEKS} недель, с ${since}`);
  console.log(`Беговых тренировок: ${runs.length} из ${(activities ?? []).length} всего`);

  if (runs.length === 0) {
    console.log("\nСмотреть нечего: за это окно беговых тренировок нет.");
    return;
  }

  const ids = runs.map((raw) => String((raw as { activity_id: string }).activity_id));
  const { data: streams, error: streamError } = await supabase
    .from("intervals_activity_streams")
    .select("activity_id, point_count, time_s, velocity_smooth")
    .in("activity_id", ids);
  if (streamError) fail(`ряды не читаются: ${streamError.message}`);

  const streamById = new Map<string, { time: number[]; velocity: Array<number | null> }>();
  for (const raw of streams ?? []) {
    const row = raw as Record<string, unknown>;
    const time = Array.isArray(row.time_s) ? (row.time_s as number[]) : [];
    const velocity = Array.isArray(row.velocity_smooth) ? (row.velocity_smooth as Array<number | null>) : [];
    if (time.length > 1 && velocity.length > 1) {
      streamById.set(String(row.activity_id), { time, velocity });
    }
  }
  console.log(`С рядами: ${streamById.size}${streamById.size < runs.length ? ` (без рядов ${runs.length - streamById.size}: по ним считать нечего)` : ""}`);

  const byDuration = new Map<number, Array<{ row: Row; paceSecPerKm: number; startOffsetS: number; actualS: number }>>();
  for (const duration of DEFAULT_DURATIONS_S) byDuration.set(duration, []);

  for (const raw of runs) {
    const row = raw as Record<string, unknown>;
    const activityId = String(row.activity_id);
    const stream = streamById.get(activityId);
    if (!stream) continue;
    const meta: Row = {
      activityId,
      name: (row.name as string | null) ?? null,
      date: String(row.start_date_local ?? "").slice(0, 10),
      minutes: Math.round(Number(row.moving_time_s ?? 0) / 60),
      distanceKm: row.distance_m === null || row.distance_m === undefined ? null : Number(row.distance_m) / 1000,
    };
    const best = bestEfforts(stream.time, stream.velocity, DEFAULT_DURATIONS_S);
    for (const [duration, effort] of best) {
      if (!effort) continue;
      byDuration.get(duration)?.push({
        row: meta,
        paceSecPerKm: effort.paceSecPerKm,
        startOffsetS: effort.startOffsetS,
        actualS: effort.actualS,
      });
    }
  }

  for (const duration of DEFAULT_DURATIONS_S) {
    const list = (byDuration.get(duration) ?? []).sort((a, b) => a.paceSecPerKm - b.paceSecPerKm).slice(0, TOP);
    const label = duration >= 3600 ? `${duration / 3600} ч` : `${duration / 60} мин`;
    console.log("");
    console.log(`── Лучшие ${label} ${"─".repeat(Math.max(0, 40 - label.length))}`);
    if (list.length === 0) {
      console.log("   нет тренировок такой длины");
      continue;
    }
    for (const item of list) {
      const offset = item.startOffsetS >= 60 ? `с ${Math.round(item.startOffsetS / 60)}-й минуты` : "с начала";
      console.log(
        `   ${paceText(item.paceSecPerKm)}/км · ${item.row.date} · ${item.row.name ?? "без названия"}` +
          ` (${item.row.minutes} мин${item.row.distanceKm ? `, ${item.row.distanceKm.toFixed(1)} км` : ""}, ${offset})`
      );
    }
  }

  // ── Ориентир, а не вердикт ──
  //
  // Числа ниже — подсказка тренеру, а не расчёт порога. Порог ставится руками и
  // осознанно: скрипт не знает, была ли лучшая двадцатка стартом, разгоном под
  // горку или просто хорошим днём.
  const best20 = (byDuration.get(20 * 60) ?? []).sort((a, b) => a.paceSecPerKm - b.paceSecPerKm)[0];
  const best30 = (byDuration.get(30 * 60) ?? []).sort((a, b) => a.paceSecPerKm - b.paceSecPerKm)[0];
  console.log("");
  console.log("── Ориентир для порога ──────────────────────");
  if (best30) {
    console.log(`   лучшие 30 минут: ${paceText(best30.paceSecPerKm)}/км — если это было ровное сильное усилие, порог рядом`);
  }
  if (best20) {
    console.log(`   лучшие 20 минут: ${paceText(best20.paceSecPerKm)}/км — если это был максимум, порог примерно ${paceText(best20.paceSecPerKm + 7)}/км`);
  }
  if (!best20 && !best30) {
    console.log("   отрезков 20+ минут в окне нет, ставить порог не от чего");
  }
  console.log("   Это подсказка, а не расчёт: скрипт не знает, старт это был или просто хороший день.");
  console.log("   Поставить: npm run intervals:set-threshold -- --athlete=<id> --pace=<м:сс> --commit");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
