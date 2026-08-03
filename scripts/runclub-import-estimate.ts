/**
 * ЭТАП 2 — ОЦЕНКА (не реализация): что даст каждый источник Run Club и с какой достоверностью.
 * Read-only. Считает по УВЕРЕННО сопоставленным ученикам (ЭТАП 1: exact + доминирующие подсказки).
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local scripts/runclub-import-estimate.ts
 */
import { readFileSync } from "node:fs";
import { translitVariants } from "@/features/club/name-translit";
import { nameGate, normalizeKm } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

const EXPORT = "/Users/igor/runclub-export";
const load = <T>(f: string): T[] => JSON.parse(readFileSync(`${EXPORT}/${f}`, "utf8")) as T[];
const profiles = load<{ id: string; name?: string | null; first_name?: string | null; last_name?: string | null; nickname?: string | null; avatar_url?: string | null }>("profiles.json");
const runs = load<{ id: string; user_id: string; start_date?: string | null; created_at?: string | null; distance_km?: number | null; average_pace_seconds?: number | null; map_polyline?: string | null }>("runs.json");
const bestEfforts = load<{ run_id: string; user_id: string; efforts: Array<{ name: string; distance_meters: number; moving_time_seconds: number; pace_seconds_per_km: number }> }>("best_efforts.json");
const raceEvents = load<{ user_id: string; name: string; race_date: string; distance_meters: number; result_time_seconds: number | null; status: string }>("race_events.json");

const TRANSPORT = 150; // сек/км
const dOnly = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 10) : null);
const kmOf = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const normTok = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
const enrichedSets = (name: string): string[][] =>
  name.trim().split(/\s+/u).map((t) => t.replace(/[^a-zа-яё]/giu, "")).filter((t) => t.length >= 2)
    .map((t) => [...new Set([normTok(t), ...(/[a-z]/i.test(t) ? translitVariants(t) : [t]).map(normTok)])]);

// --- Run Club пробежки по профилю (транспорт выброшен) ---
const rcByUser = new Map<string, Array<{ date: string; km: number }>>();
for (const r of runs) {
  const p = r.average_pace_seconds;
  if (typeof p === "number" && p < TRANSPORT) continue;
  const date = dOnly(r.start_date) ?? dOnly(r.created_at); const dkm = kmOf(r.distance_km);
  if (!date || !dkm) continue;
  (rcByUser.get(r.user_id) ?? rcByUser.set(r.user_id, []).get(r.user_id)!).push({ date, km: dkm });
}

const sb = createSupabaseServerClient();
const { data: studs } = await sb.from("trainingpeaks_students").select("id, student_name, club_avatar_path");
const students = ((studs ?? []) as Array<{ id: string; student_name: string | null; club_avatar_path: string | null }>)
  .filter((s) => s.student_name && s.student_name.trim())
  .map((s) => ({ id: s.id, name: s.student_name as string, avatar: s.club_avatar_path, variants: enrichedSets(s.student_name as string) }));
const studentById = new Map(students.map((s) => [s.id, s]));

// наши тренировки (все)
const ourByStudent = new Map<string, Map<string, number[]>>();
{ let off = 0; for (;;) {
  const { data } = await sb.from("trainingpeaks_workout_cache").select("student_id, workout_date, completed_distance_raw").range(off, off + 999);
  const rows = (data ?? []) as Array<{ student_id: string; workout_date: string | null; completed_distance_raw: number | string | null }>;
  for (const w of rows) { const d = w.workout_date; const k = normalizeKm(w.completed_distance_raw); if (!d || !k) continue;
    const m = ourByStudent.get(w.student_id) ?? ourByStudent.set(w.student_id, new Map()).get(w.student_id)!; (m.get(d) ?? m.set(d, []).get(d)!).push(k); }
  if (rows.length < 1000) break; off += 1000;
} }
const overlap = (rc: Array<{ date: string; km: number }> | undefined, ours: Map<string, number[]> | undefined): number => {
  if (!rc || !ours) return 0; let n = 0;
  for (const run of rc) { const s = ours.get(run.date); if (s && s.some((k) => Math.abs(k - run.km) <= Math.max(0.3, 0.08 * run.km))) n++; } return n;
};

// --- УВЕРЕННОЕ сопоставление profileUserId -> studentId (exact + доминирующая подсказка) ---
const mapped = new Map<string, string>(); // userId -> studentId
const exactByStudent = new Map<string, { userId: string; ov: number }>();
for (const p of profiles) {
  const names = [p.name, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), p.nickname].filter((x): x is string => Boolean(x && x.trim()));
  const rc = rcByUser.get(p.id) ?? [];
  const strong = students.filter((s) => names.some((nm) => nameGate(s.variants, nm, { exactSurname: true })))
    .map((s) => ({ s, ov: overlap(rc, ourByStudent.get(s.id)) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov);
  if (strong.length) { // exact — с защитой от коллизии (один ученик — сильнейший профиль)
    const top = strong[0]; const prev = exactByStudent.get(top.s.id);
    if (!prev || top.ov > prev.ov) { if (prev) mapped.delete(prev.userId); exactByStudent.set(top.s.id, { userId: p.id, ov: top.ov }); mapped.set(p.id, top.s.id); }
    continue;
  }
  if (rc.length >= 15) { // доминирующая подсказка по тренировкам
    const scored = students.map((s) => ({ s, ov: overlap(rc, ourByStudent.get(s.id)) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov);
    if (scored.length && scored[0].ov >= 15 && scored[0].ov >= 2 * (scored[1]?.ov ?? 0) && !mapped.has(p.id)) mapped.set(p.id, scored[0].s.id);
  }
}
console.log(`=== УВЕРЕННО сопоставлено профилей: ${mapped.size} (exact + доминирующие подсказки) ===\n`);

// ===== ИСТОЧНИК 1: best_efforts -> рекорды =====
const BUCKET: Record<string, "5k" | "10k" | "21k" | "42k"> = { "5K": "5k", "10K": "10k", "Half-Marathon": "21k", "Marathon": "42k" };
const bestByStudentDist = new Map<string, number>(); // `${studentId}|${bucket}` -> best seconds (Strava, non-transport)
let nonStandardEfforts = 0, transportEfforts = 0;
const nonStdBest = new Map<string, number>(); // `${sid}|${name}` -> best sec (distinct журнальный PR)
for (const be of bestEfforts) {
  const sid = mapped.get(be.user_id); if (!sid) continue;
  for (const e of be.efforts) {
    if (e.pace_seconds_per_km < TRANSPORT) { transportEfforts++; continue; }
    const b = BUCKET[e.name];
    if (!b) { nonStandardEfforts++; const k = `${sid}|${e.name}`; const c = nonStdBest.get(k); if (c == null || e.moving_time_seconds < c) nonStdBest.set(k, e.moving_time_seconds); continue; }
    const key = `${sid}|${b}`; const cur = bestByStudentDist.get(key);
    if (cur == null || e.moving_time_seconds < cur) bestByStudentDist.set(key, e.moving_time_seconds);
  }
}
const { data: recs } = await sb.from("club_records").select("student_id, distance_key, duration_seconds, source, trust");
const ourRec = new Map<string, { sec: number; source: string }>();
for (const r of (recs ?? []) as Array<{ student_id: string; distance_key: string; duration_seconds: number; source: string; trust: string }>)
  ourRec.set(`${r.student_id}|${r.distance_key}`, { sec: r.duration_seconds, source: r.source });
let newRec = 0, betterRec = 0, protectedRec = 0, worseOrEqual = 0;
for (const [key, sec] of bestByStudentDist) {
  const ours = ourRec.get(key);
  if (!ours) { newRec++; continue; }
  if (ours.source === "coach_confirmed" || ours.source === "official_protocol") { protectedRec++; continue; }
  if (sec < ours.sec - 1) betterRec++; else worseOrEqual++;
}
console.log("ИСТОЧНИК 1 — best_efforts (честные отрезки Strava из потоков):");
console.log(`  стандартных отрезков (5K/10K/Half/Marathon) у сопоставленных: ${bestByStudentDist.size} пар (ученик×дистанция)`);
console.log(`  НОВЫХ рекордов (у нас пусто на эту дистанцию): ${newRec}`);
console.log(`  БЫСТРЕЕ нашего (реконструкция, можно улучшить): ${betterRec}`);
console.log(`  защищено (coach_confirmed/official — Strava НЕ перебивает): ${protectedRec}`);
console.log(`  не лучше нашего: ${worseOrEqual}`);
console.log(`  нестандартных отрезков: ${nonStandardEfforts} сырых -> ${nonStdBest.size} различных лучших (ученик×дистанция) в журнал`);
console.log(`  выброшено транспортом (отрезки быстрее 2:30/км): ${transportEfforts}\n`);

// ===== ИСТОЧНИК 2: map_polyline =====
const cutoff = "2026-05-04"; // ~60 дней до даты выгрузки 2026-07-29 (граница наших треков)
let withPoly = 0, polyOlderThan60 = 0;
for (const r of runs) {
  if (!mapped.has(r.user_id) || !r.map_polyline) continue;
  const p = r.average_pace_seconds; if (typeof p === "number" && p < TRANSPORT) continue;
  withPoly++; const d = dOnly(r.start_date) ?? dOnly(r.created_at);
  if (d && d < cutoff) polyOlderThan60++;
}
console.log("ИСТОЧНИК 2 — map_polyline (Strava координаты):");
console.log(`  пробежек с координатами у сопоставленных: ${withPoly}`);
console.log(`  из них СТАРШЕ ~60 дней (net-new история за пределами наших треков): ${polyOlderThan60}`);
console.log(`  формат: Strava отдаёт ЗАКОДИРОВАННУЮ полилинию (Google encoded) -> декод в [lat,lng], обрезка 300м (cropTrackForPrivacy), Douglas-Peucker, в trainingpeaks_workout_tracks.`);
console.log(`  ВНИМАНИЕ схемы: workout_tracks ключуется на workout_cache_id (TP-тренировка). Strava-пробежки не TP -> нужен свой ключ/источник (иначе не лягут).\n`);

// ===== ИСТОЧНИК 3: race_events =====
const { data: ourRE } = await sb.from("trainingpeaks_race_events").select("student_id, event_date, distance_raw");
const ourReSet = new Set<string>();
for (const r of (ourRE ?? []) as Array<{ student_id: string; event_date: string | null; distance_raw: number | string | null }>) {
  const km = kmOf(r.distance_raw); ourReSet.add(`${r.student_id}|${r.event_date}`); if (km) ourReSet.add(`${r.student_id}|${r.event_date}|${Math.round(km)}`);
}
const { data: ourOff } = await sb.from("club_official_results").select("student_id, race_date");
const ourOffSet = new Set((ourOff ?? []).map((r: { student_id: string; race_date: string }) => `${r.student_id}|${r.race_date}`));
let reNew = 0, reHave = 0, reCompleted = 0;
for (const re of raceEvents) {
  const sid = mapped.get(re.user_id); if (!sid) continue;
  if (re.status !== "completed_linked" || !re.result_time_seconds) continue; // только прошедшие с результатом
  reCompleted++;
  const have = ourReSet.has(`${sid}|${re.race_date}`) || ourOffSet.has(`${sid}|${re.race_date}`);
  if (have) reHave++; else reNew++;
}
console.log("ИСТОЧНИК 3 — race_events (гонки с результатом):");
console.log(`  у сопоставленных прошедших с результатом: ${reCompleted}`);
console.log(`  уже есть у нас (race_events/journal по дате): ${reHave}`);
console.log(`  НОВЫХ (нет ни в race_events, ни в journal): ${reNew}\n`);

// ===== ИСТОЧНИК 4: avatar_url =====
let avatarNew = 0, avatarHave = 0, avatarNoUrl = 0;
for (const [userId, sid] of mapped) {
  const prof = profiles.find((p) => p.id === userId); const stu = studentById.get(sid);
  if (!prof?.avatar_url) { avatarNoUrl++; continue; }
  if (stu?.avatar) avatarHave++; else avatarNew++;
}
console.log("ИСТОЧНИК 4 — avatar_url:");
console.log(`  сопоставленных, у кого НЕТ нашего фото, но ЕСТЬ Run Club аватар: ${avatarNew}`);
console.log(`  уже есть наше фото: ${avatarHave}`);
console.log(`  у профиля нет avatar_url: ${avatarNoUrl}`);
