/**
 * ФАЗА 3 — импорт GPS-треков Run Club (полилинии Strava) на СУЩЕСТВУЮЩИЕ TP-записи. DRY-RUN по умолчанию.
 *
 * Схему НЕ меняем: полилиния Strava ложится на существующую строку trainingpeaks_workout_tracks той же
 * TP-тренировки (ключ workout_cache_id прежний), ТОЛЬКО где трека ещё нет (наши треки — за 60 дней, старое
 * пусто). Пара ученик<->TP-запись: ученик из ЗАФИКСИРОВАННОГО docs/runclub-people-map.json (фаза 1), дата,
 * дистанция ±2%, время ±60с. Пары без TP-записи (~4%) пропускаем.
 *
 * Конвейер приватности — ТОТ ЖЕ, что в FIT-ингесте (переиспользуем, не переписываем):
 *   decodePolyline (инверсия encodePolyline, Google-точность 5) -> sanitizeTrackPoints (деспайк)
 *   -> cropTrackForPrivacy (обрезка 300 м от старта/финиша) -> torn/span-отбраковка
 *   -> simplifyTrack (Douglas-Peucker, 50-150 точек) -> upsertTrainingPeaksWorkoutTrack(source='strava').
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local \
 *     scripts/runclub-tracks-import.ts [--commit]
 */
import { readFileSync } from "node:fs";
import { normalizeKm } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { simplifyTrack } from "@/features/trainingpeaks/track-simplify";
import {
  upsertTrainingPeaksWorkoutTrack,
  type TrainingPeaksWorkoutTrackUpsertRow,
} from "@/features/trainingpeaks/repository";
// Переиспользуем приватный конвейер FIT-ингеста (те же функции, что гоняются на боевом сканере).
import {
  bboxSpanMeters,
  cropTrackForPrivacy,
  isTrackTorn,
  sanitizeTrackPoints,
} from "../tools/trainingpeaks-export/scripts/lib/fit-workout-normalization";

const COMMIT = process.argv.includes("--commit");
const EXPORT = "/Users/igor/runclub-export";
const TRANSPORT = 150; // сек/км — быстрее 2:30/км = транспорт, пропустить
const RADIUS_M = (() => { const p = Number(process.env.CLUB_TRACK_PRIVACY_RADIUS_M ?? "300"); return Number.isFinite(p) && p > 0 ? p : 300; })();

type MapRow = { profileId: string; studentId: string; studentName: string | null };
const mapping = JSON.parse(readFileSync("docs/runclub-people-map.json", "utf8")) as MapRow[];
const byProfile = new Map(mapping.map((m) => [m.profileId, m]));
const ids = [...new Set(mapping.map((m) => m.studentId))];
const nameOf = (sid: string): string => mapping.find((m) => m.studentId === sid)?.studentName ?? sid;

type Run = { user_id: string; start_date?: string | null; created_at?: string | null; distance_km?: number | null; average_pace_seconds?: number | null; moving_time_seconds?: number | null; elapsed_time_seconds?: number | null; duration_seconds?: number | null; map_polyline?: string | null };
const runs = JSON.parse(readFileSync(`${EXPORT}/runs.json`, "utf8")) as Run[];

const dOnly = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 10) : null);
const kmOf = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Декод Google-encoded polyline (точность 5) — инверсия encodePolyline() из track-maps.ts. Strava отдаёт так. */
function decodePolyline(str: string): Array<[number, number]> {
  let index = 0, lat = 0, lng = 0;
  const out: Array<[number, number]> = [];
  while (index < str.length) {
    let b = 0, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

type CacheRow = { id: string; student_id: string; trainingpeaks_athlete_id: number | null; trainingpeaks_workout_id: number | null; workout_date: string | null; completed_distance_raw: number | string | null; completed_time_raw: number | string | null };
const cacheSec = (r: CacheRow): number | null => { const t = Number(r.completed_time_raw); return Number.isFinite(t) && t > 0 ? Math.round(t * 3600) : null; }; // completed_time_raw — ЧАСЫ

const sb = createSupabaseServerClient();

// --- наши TP-тренировки (только 41 ученик) с ретраями + пауза между страницами (мягко к БД) ---
const cacheByStudent = new Map<string, Map<string, CacheRow[]>>();
{ let off = 0, loaded = 0;
  for (;;) {
    let rows: CacheRow[] | null = null;
    for (let a = 0; a < 5 && rows === null; a++) {
      const { data, error } = await sb.from("trainingpeaks_workout_cache")
        .select("id, student_id, trainingpeaks_athlete_id, trainingpeaks_workout_id, workout_date, completed_distance_raw, completed_time_raw")
        .in("student_id", ids).range(off, off + 999);
      if (error) { console.error(`cache@${off}: ${error.message} (попытка ${a + 1})`); continue; }
      rows = (data ?? []) as CacheRow[];
    }
    if (rows === null) throw new Error(`workout_cache: страница @${off} не загрузилась`);
    for (const r of rows) { const d = r.workout_date; if (!d) continue;
      const m = cacheByStudent.get(r.student_id) ?? cacheByStudent.set(r.student_id, new Map()).get(r.student_id)!;
      (m.get(d) ?? m.set(d, []).get(d)!).push(r); }
    loaded += rows.length; if (rows.length < 1000) break; off += 1000;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error(`workout_cache (41 ученик): ${loaded} строк`);
}

// --- где трек уже есть (любой source) — НЕ перезаписываем ---
const haveTrack = new Set<string>();
{ let off = 0;
  for (;;) {
    let rows: Array<{ workout_cache_id: string }> | null = null;
    for (let a = 0; a < 5 && rows === null; a++) {
      const { data, error } = await sb.from("trainingpeaks_workout_tracks").select("workout_cache_id").in("student_id", ids).range(off, off + 999);
      if (error) { console.error(`tracks@${off}: ${error.message} (попытка ${a + 1})`); continue; }
      rows = (data ?? []) as Array<{ workout_cache_id: string }>;
    }
    if (rows === null) throw new Error(`workout_tracks: страница @${off} не загрузилась`);
    for (const r of rows) haveTrack.add(r.workout_cache_id);
    if (rows.length < 1000) break; off += 1000;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error(`уже с треком (эти пропускаем): ${haveTrack.size}`);
}

// Пара run<->cache: дата + дистанция ±2%; время ±60с подтверждает. Если время есть с ОБЕИХ сторон и мимо —
// НЕ уверены, пропускаем (не вешаем чужой маршрут). Если проверить нечем (у cache нет времени) — берём дату+дистанцию.
type Pair = { cache: CacheRow; how: "time" | "dist-only" };
function matchCache(sid: string, date: string, km: number, runSecs: number[]): Pair | null {
  const day = cacheByStudent.get(sid)?.get(date); if (!day || !day.length) return null;
  const distOk = day.filter((r) => { const k = normalizeKm(r.completed_distance_raw); return k !== null && Math.abs(k - km) <= 0.02 * km; });
  if (!distOk.length) return null;
  const timeMatched = distOk.filter((r) => { const s = cacheSec(r); return s !== null && runSecs.some((rs) => Math.abs(s - rs) <= 60); });
  if (timeMatched.length) return { cache: timeMatched[0], how: "time" };
  const cacheHasTime = distOk.some((r) => cacheSec(r) !== null);
  if (runSecs.length > 0 && cacheHasTime) return null; // время с обеих сторон, но не сошлось -> пропуск
  return { cache: distOk[0], how: "dist-only" };
}

// --- проход по пробежкам с полилинией ---
type Plan = { sid: string; cacheId: string; athleteId: number | null; workoutId: number | null; date: string; km: number; how: "time" | "dist-only"; polyline: Array<[number, number]>; pointCount: number; bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } };
const plan: Plan[] = [];
const usedCache = new Set<string>();
let polyRuns = 0, transport = 0, noPair = 0, timeMismatch = 0, already = 0, dupCache = 0;
const dropped = { torn: 0, span: 0, withinRadius: 0, tooShort: 0 };

for (const r of runs) {
  const m = byProfile.get(r.user_id); if (!m) continue;
  const poly = typeof r.map_polyline === "string" ? r.map_polyline : null; if (!poly) continue;
  const p = r.average_pace_seconds; if (typeof p === "number" && p < TRANSPORT) { transport++; continue; }
  const date = dOnly(r.start_date) ?? dOnly(r.created_at); const km = kmOf(r.distance_km); if (!date || !km) continue;
  polyRuns++;
  const runSecs = [r.moving_time_seconds, r.elapsed_time_seconds, r.duration_seconds].filter((x): x is number => typeof x === "number" && x > 0);
  const pair = matchCache(m.studentId, date, km, runSecs);
  if (!pair) { // разложить причину: была ли дистанция вообще
    const day = cacheByStudent.get(m.studentId)?.get(date);
    const distExisted = day?.some((c) => { const k = normalizeKm(c.completed_distance_raw); return k !== null && Math.abs(k - km) <= 0.02 * km; });
    if (distExisted) timeMismatch++; else noPair++;
    continue;
  }
  const cid = pair.cache.id;
  if (haveTrack.has(cid)) { already++; continue; }
  if (usedCache.has(cid)) { dupCache++; continue; }
  usedCache.add(cid);

  // приватный конвейер (тот же, что FIT-ингест)
  const raw = decodePolyline(poly);
  const clean = sanitizeTrackPoints(raw);
  const crop = cropTrackForPrivacy(clean, RADIUS_M);
  if (crop.points.length === 0) { dropped.withinRadius++; continue; }
  if (isTrackTorn(crop.points)) { dropped.torn++; continue; }
  const distM = km * 1000; const span = bboxSpanMeters(crop.points);
  if (distM > 100 && span > distM * 1.5) { dropped.span++; continue; }
  const simplified = simplifyTrack(crop.points);
  if (!simplified) { dropped.tooShort++; continue; }
  plan.push({ sid: m.studentId, cacheId: cid, athleteId: pair.cache.trainingpeaks_athlete_id, workoutId: pair.cache.trainingpeaks_workout_id, date: pair.cache.workout_date ?? date, km, how: pair.how, polyline: simplified.polyline, pointCount: simplified.pointCount, bbox: simplified.bbox });
}

const timeN = plan.filter((x) => x.how === "time").length;
console.log(`=== ФАЗА 3 треки ${COMMIT ? "[--commit]" : "[DRY-RUN]"} — по ${ids.length} сопоставленным, радиус обрезки ${RADIUS_M} м ===`);
console.log(`пробежек с полилинией (не транспорт): ${polyRuns} | транспорт пропущен: ${transport}`);
console.log(`пар не найдено (нет TP-записи на дату/дистанцию): ${noPair}`);
console.log(`дистанция совпала, но время мимо (не уверены -> пропуск): ${timeMismatch}`);
console.log(`пара есть, но трек уже записан (пропуск): ${already} | дубль на тот же workout (пропуск): ${dupCache}`);
console.log(`отброшено конвейером приватности: обрезано целиком(в радиусе) ${dropped.withinRadius}, рвань ${dropped.torn}, span>>дист ${dropped.span}, <2 точек ${dropped.tooShort}`);
console.log(`\n--- К ЗАПИСИ ${plan.length} треков (source=strava): по времени ${timeN}, по дате+дистанции ${plan.length - timeN} ---`);
for (const x of plan.slice(0, 12)) console.log(`  ${nameOf(x.sid)} · ${x.date} · ${x.km.toFixed(1)}км · ${x.pointCount} точек · (${x.how})`);
console.log(`\n=== ИТОГ ПЛАНА: ${plan.length} треков к записи. ===`);

if (!COMMIT) { console.log("\nDRY-RUN: ничего не записано. Применить миграцию 20260904 (source in fit,strava), затем --commit."); process.exit(0); }

const nowIso = new Date().toISOString();
let ok = 0, fail = 0;
for (const x of plan) {
  const row: TrainingPeaksWorkoutTrackUpsertRow = {
    student_id: x.sid, trainingpeaks_athlete_id: x.athleteId, trainingpeaks_workout_id: x.workoutId,
    workout_cache_id: x.cacheId, workout_date: x.date, polyline: x.polyline, point_count: x.pointCount,
    bbox: x.bbox, source: "strava", scanned_at: nowIso,
  };
  try { await upsertTrainingPeaksWorkoutTrack(row); ok++; }
  catch (e) { fail++; if (fail <= 8) console.log(`  FAIL ${nameOf(x.sid)}/${x.date}: ${e instanceof Error ? e.message : e}`); }
}
console.log(`\n=== ЗАПИСАНО: ${ok} треков (ошибок ${fail}) ===`);
process.exit(fail ? 1 : 0);
