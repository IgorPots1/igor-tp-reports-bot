/**
 * Разбор трассы старта (пилот 14.10.2026): трек, профиль высот, сверка набора, ветер, тактика.
 *
 *   npx tsx --env-file=<.env.local> scripts/race-course/build.ts <race_id> [опции]
 *
 *   --gpx <path>             трек организатора (GPX); высоты из GPX не берём, рельеф по одному DEM
 *   --student-track <uuid>   trainingpeaks_workout_tracks.id: эталон набора (сумма total_ascent_m
 *                            по кругам; кругов нет, тогда DEM по его треку). Без --gpx он же форма
 *                            трассы: публикуется только упрощённая линия, без времени и темпа
 *   --no-track               трека нет: файл только с ветром, publish=false
 *   --lat <x> --lon <y>      точка старта для ветра, когда трека нет
 *   --distance <km>          дистанция (по умолчанию самая длинная из race_calendar.dist_km)
 *   --label <text>           дописать к названию (например «К40»)
 *   --date <YYYY-MM-DD>      день старта, если отличается от race_calendar.date_start
 *   --start <HH:MM>          час старта по местному времени (по умолчанию 10:00)
 *   --organizer-gain <m>     набор по данным организатора; не указан, значит «не указана»
 *   --source-kind/--source-url/--source-note   откуда трек (в публичный JSON)
 *   --variant <slug>         дистанция многодистанционного старта (например 30k): файл <safe_id>-<slug>.json,
 *                            свой профиль; без него один разбор на старт, как раньше
 *
 * Пишет src/data/race-courses/<safe_id>.json (публичный, без персональных данных),
 * обновляет src/data/race-courses/index.json (только publish=true, для кнопки в боте)
 * и картинку профиля для тренера в /Users/igor/ops-log/races/profiles/<safe_id>.png.
 * База только на чтение.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";

import { checkGain } from "./checks";
import { cumulative, resample, simplifyTo, type LatLon } from "./geo";
import { keyPoints } from "./key-points";
import { gainLoss, perKm, profileSeries, segments, smoothByDistance } from "./profile";
import { profileSvg, writeProfileImage } from "./render";
import { fetchElevations, fetchForecast, fetchWindHistory, readGpx } from "./sources";
import { windSide, windStats } from "./wind";

const STEP_M = 50;
const SMOOTH_M = 250;
const MAX_TRACK_POINTS = 600;
const WIND_YEARS: [number, number] = [2016, 2025];
/** Длина трека против заявленной дистанции: больше этого, значит трек не тот или неполный. */
const LENGTH_TOLERANCE = 0.1;
const DATA_DIR_DEFAULT = path.join(process.cwd(), "src", "data", "race-courses");
const PROFILE_DIR = "/Users/igor/ops-log/races/profiles";

const argv = process.argv.slice(2);
const raceId = argv[0];
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);
// --data-dir: писать в src/data другого рабочего дерева (запуск из каталога с node_modules)
const DATA_DIR = opt("data-dir") ?? DATA_DIR_DEFAULT;

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");
const variant = opt("variant");
if (variant && !/^[a-z0-9]+$/.test(variant)) throw new Error("--variant: только латиница и цифры, например 30k");
const slug = (id: string) => safeId(id) + (variant ? `-${variant}` : "");
const r1 = (x: number) => Math.round(x * 10) / 10;

async function main() {
  if (!raceId || raceId.startsWith("--")) throw new Error("нужен id старта: build.ts <race_id> [опции]");
  const db = createSupabaseServerClient();

  const { data: race, error } = await db.from("race_calendar").select("id,name,date_start,city,dist_km,site_url").eq("id", raceId).maybeSingle();
  if (error) throw new Error(`race_calendar: ${error.message}`);
  if (!race) throw new Error(`старт ${raceId} не найден в race_calendar`);

  const date = opt("date") ?? (race.date_start as string);
  const dists = ((race.dist_km as number[] | null) ?? []).filter((d) => d > 0);
  const distanceKm = Number(opt("distance") ?? Math.max(...dists));
  const hour = Number((opt("start") ?? "10:00").split(":")[0]);
  const label = opt("label");
  const name = label ? `${race.name}, ${label}` : (race.name as string);
  const organizerGain = opt("organizer-gain") != null ? Number(opt("organizer-gain")) : null;

  // Трек ученика: эталон набора и, без GPX, форма трассы. Наружу только линия.
  let studentLine: LatLon[] | null = null;
  let studentGain: number | null = null;
  const studentTrackId = opt("student-track");
  if (studentTrackId) {
    const { data: t, error: te } = await db.from("trainingpeaks_workout_tracks").select("polyline,workout_cache_id").eq("id", studentTrackId).maybeSingle();
    if (te || !t) throw new Error(`трек ученика ${studentTrackId}: ${te?.message ?? "не найден"}`);
    studentLine = (t.polyline as [number, number][]).map((p) => [Number(p[0]), Number(p[1])] as LatLon);
    if (t.workout_cache_id) {
      const { data: laps } = await db.from("trainingpeaks_workout_laps").select("total_ascent_m").eq("workout_cache_id", t.workout_cache_id);
      const sum = (laps ?? []).reduce((s, l) => s + (Number(l.total_ascent_m) || 0), 0);
      if (sum > 0) studentGain = sum;
    }
  }

  const gpxPath = opt("gpx");
  const line: LatLon[] | null = flag("no-track") ? null : gpxPath ? readGpx(gpxPath) : studentLine;
  const source = {
    kind: opt("source-kind") ?? (gpxPath ? "gpx" : studentLine ? "student_track_shape" : "none"),
    url: opt("source-url") ?? null,
    note: opt("source-note") ?? null,
  };

  const forecastDue = (Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86400000 <= 7;
  const startPoint: LatLon | null = line?.length ? line[0] : opt("lat") && opt("lon") ? [Number(opt("lat")), Number(opt("lon"))] : null;
  if (!startPoint) throw new Error("нет ни трека, ни --lat/--lon: ветер считать негде");

  const history = await fetchWindHistory(startPoint, date, hour, WIND_YEARS[0], WIND_YEARS[1]);
  const wind = history.obs.length ? windStats(history.obs, history.years) : null;
  const fc = forecastDue ? await fetchForecast(startPoint, date, hour) : null;
  const forecast = fc ? { speedMs: r1(fc.speed), dir: Math.round(fc.dir), dirLabel: windStats([fc], 1).dirLabel, gustMs: fc.gust != null ? r1(fc.gust) : null } : null;

  const outFile = path.join(DATA_DIR, `${slug(raceId)}.json`);
  mkdirSync(DATA_DIR, { recursive: true });

  if (!line || line.length < 2) {
    const course = {
      raceId, name, date, distanceKm, source,
      track: [], elevation: [], gain: 0, loss: 0, perKm: [],
      checks: { ours: 0, organizer: organizerGain, student: studentGain, publish: false, reason: "нет трека: геометрию трассы не удалось получить из открытых источников" },
      wind, forecast, keyPoints: [],
    };
    writeFileSync(outFile, JSON.stringify(course, null, 1) + "\n");
    updateIndex(raceId, false);
    console.log(JSON.stringify({ raceId, file: outFile, publish: false, wind }, null, 2));
    return;
  }

  // Рельеф: шаг 50 м, высоты DEM, сглаживание 250 м.
  const rs = resample(line, STEP_M);
  const rawElev = await fetchElevations(rs.points);
  const elev = smoothByDistance(rs.distM, rawElev, SMOOTH_M);
  const totalM = rs.distM[rs.distM.length - 1];
  const { gain, loss } = gainLoss(elev);
  const km = perKm(rs.distM, elev, rs.points).map((k) => ({
    km: k.km, gain: Math.round(k.gain), loss: Math.round(k.loss), bearing: k.bearing,
    wind: wind ? windSide(k.bearing, wind.dir) : ("cross" as const),
  }));

  // Эталон ученика без кругов: DEM по его треку (если его трек не и есть наша геометрия).
  if (studentGain == null && studentLine && line !== studentLine) {
    const s = resample(studentLine, STEP_M);
    studentGain = Math.round(gainLoss(smoothByDistance(s.distM, await fetchElevations(s.points), SMOOTH_M)).gain);
  }

  const lengthKm = totalM / 1000;
  const extra: string[] = [];
  const lenDiff = Math.abs(lengthKm - distanceKm) / distanceKm;
  if (lenDiff > LENGTH_TOLERANCE) extra.push(`длина трека ${lengthKm.toFixed(1)} км против дистанции ${distanceKm} км (${Math.round(lenDiff * 100)}%)`);
  const checks = checkGain(gain, organizerGain, studentGain != null ? Math.round(studentGain) : null, extra);

  const segs = segments(rs.distM, elev, 3);
  const stretch = (from: number, to: number) => gainLoss(elev.filter((_, i) => rs.distM[i] >= from && rs.distM[i] <= to));
  const points = keyPoints({
    totalM, segments: segs, perKm: km, wind,
    startStretch: stretch(0, 1000), finishStretch: stretch(totalM - 1000, totalM),
  });

  const course = {
    raceId,
    name,
    date,
    distanceKm,
    source,
    track: simplifyTo(rs.points, MAX_TRACK_POINTS).map((p) => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]),
    elevation: profileSeries(rs.distM, elev, 100),
    gain: Math.round(gain),
    loss: Math.round(loss),
    perKm: km,
    checks,
    wind,
    forecast,
    keyPoints: points,
  };
  writeFileSync(outFile, JSON.stringify(course, null, 1) + "\n");
  updateIndex(raceId, checks.publish);

  mkdirSync(PROFILE_DIR, { recursive: true });
  const subtitle = `${date} · трек ${lengthKm.toFixed(1)} км (дистанция ${distanceKm}) · набор ${Math.round(gain)} м, сброс ${Math.round(loss)} м`
    + ` · организатор: ${organizerGain ?? "не указан"} · ученик: ${studentGain != null ? Math.round(studentGain) : "нет"}`
    + ` · ${checks.publish ? "публикуем" : "НЕ публикуем"}`;
  const img = await writeProfileImage(
    profileSvg({ title: name, subtitle, elevation: course.elevation, perKm: km, keyPoints: points }),
    path.join(PROFILE_DIR, `${slug(raceId)}.png`),
  );

  console.log(JSON.stringify({
    raceId, file: outFile, image: img, source, trackKm: r1(lengthKm), rawTrackPoints: line.length,
    trackKmRaw: r1(cumulative(line).at(-1)! / 1000), distanceKm, gain: course.gain, loss: course.loss,
    checks, wind, forecast, keyPoints: points, segments: segs.filter((s) => s.delta >= 5).map((s) => ({ ...s, delta: r1(s.delta) })),
  }, null, 2));
}

/** index.json: какие разборы опубликованы (его читает бот). Ключ — slug: у старта с несколькими
 *  дистанциями их может быть несколько, бот берёт первый. */
function updateIndex(id: string, publish: boolean) {
  const file = path.join(DATA_DIR, "index.json");
  let list: { raceId: string; slug: string }[] = [];
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    list = [];
  }
  list = list.filter((x) => x.slug !== slug(id));
  if (publish) list.push({ raceId: id, slug: slug(id) });
  list.sort((a, b) => a.raceId.localeCompare(b.raceId));
  writeFileSync(file, JSON.stringify(list, null, 1) + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
