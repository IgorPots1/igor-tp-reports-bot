/**
 * Проверка «мнимого блокера»: те же Strava-пробежки (старше 60д, с полилинией) уже есть в нашем
 * trainingpeaks_workout_cache? Матч по (ученик, дата, дистанция ±2%, время ±60с). Read-only.
 * Если большинство находит пару — полилиния ложится на существующую TP-запись, схему не менять.
 */
import { readFileSync } from "node:fs";
import { translitVariants } from "@/features/club/name-translit";
import { nameGate, normalizeKm } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

const EXPORT = "/Users/igor/runclub-export";
const load = <T>(f: string): T[] => JSON.parse(readFileSync(`${EXPORT}/${f}`, "utf8")) as T[];
const profiles = load<{ id: string; name?: string | null; first_name?: string | null; last_name?: string | null; nickname?: string | null }>("profiles.json");
const runs = load<{ user_id: string; start_date?: string | null; created_at?: string | null; distance_km?: number | null; moving_time_seconds?: number | null; elapsed_time_seconds?: number | null; duration_seconds?: number | null; average_pace_seconds?: number | null; map_polyline?: string | null }>("runs.json");

const TRANSPORT = 150, CUTOFF = "2026-05-04";
const dOnly = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 10) : null);
const kmOf = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const normTok = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
const enrichedSets = (name: string): string[][] =>
  name.trim().split(/\s+/u).map((t) => t.replace(/[^a-zа-яё]/giu, "")).filter((t) => t.length >= 2)
    .map((t) => [...new Set([normTok(t), ...(/[a-z]/i.test(t) ? translitVariants(t) : [t]).map(normTok)])]);

const rcByUser = new Map<string, Array<{ date: string; km: number }>>();
for (const r of runs) { const p = r.average_pace_seconds; if (typeof p === "number" && p < TRANSPORT) continue;
  const date = dOnly(r.start_date) ?? dOnly(r.created_at); const dkm = kmOf(r.distance_km); if (!date || !dkm) continue;
  (rcByUser.get(r.user_id) ?? rcByUser.set(r.user_id, []).get(r.user_id)!).push({ date, km: dkm }); }

const sb = createSupabaseServerClient();
const { data: studs } = await sb.from("trainingpeaks_students").select("id, student_name");
const students = ((studs ?? []) as Array<{ id: string; student_name: string | null }>)
  .filter((s) => s.student_name && s.student_name.trim())
  .map((s) => ({ id: s.id, name: s.student_name as string, variants: enrichedSets(s.student_name as string) }));

// наши тренировки: студент -> дата -> [{km, sec}]. С ретраями: одна ошибка страницы НЕ должна
// тихо оборвать загрузку (иначе пустой кэш -> 0 совпадений = ложный результат).
const our = new Map<string, Map<string, Array<{ km: number; sec: number }>>>();
{ type WR = { student_id: string; workout_date: string | null; completed_distance_raw: number | string | null; completed_time_raw: number | string | null };
  let off = 0, loaded = 0;
  for (;;) {
    let rows: WR[] | null = null;
    for (let a = 0; a < 5 && rows === null; a++) {
      const { data, error } = await sb.from("trainingpeaks_workout_cache").select("student_id, workout_date, completed_distance_raw, completed_time_raw").range(off, off + 999);
      if (error) { console.error(`load page@${off} err: ${error.message} (попытка ${a + 1})`); continue; }
      rows = (data ?? []) as WR[];
    }
    if (rows === null) throw new Error(`workout_cache: не смог загрузить страницу @${off}`);
    for (const w of rows) { const d = w.workout_date; const km = normalizeKm(w.completed_distance_raw); if (!d || !km) continue;
      const t = Number(w.completed_time_raw); const sec = Number.isFinite(t) && t > 0 ? Math.round(t * 3600) : null;
      const m = our.get(w.student_id) ?? our.set(w.student_id, new Map()).get(w.student_id)!;
      (m.get(d) ?? m.set(d, []).get(d)!).push({ km, sec: sec ?? -1 }); }
    loaded += rows.length;
    if (rows.length < 1000) break; off += 1000;
    await new Promise((r) => setTimeout(r, 300)); // мягче к Cloudflare (не бурстить 24 запроса подряд)
  }
  if (loaded < 15000) throw new Error(`workout_cache загрузил только ${loaded} строк — БД медленит/частично, прерываю чтобы не выдать мусор`);
  console.error(`workout_cache: загружено ${loaded} строк`);
}
const overlap = (rc: Array<{ date: string; km: number }> | undefined, s: string): number => {
  const om = our.get(s); if (!rc || !om) return 0; let n = 0;
  for (const run of rc) { const day = om.get(run.date); if (day && day.some((x) => Math.abs(x.km - run.km) <= Math.max(0.3, 0.08 * run.km))) n++; } return n; };

// уверенное сопоставление userId -> studentId (exact + доминирующая подсказка), с защитой коллизии
const mapped = new Map<string, string>(); const exactByStudent = new Map<string, { userId: string; ov: number }>();
for (const p of profiles) {
  const names = [p.name, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), p.nickname].filter((x): x is string => Boolean(x && x.trim()));
  const rc = rcByUser.get(p.id) ?? [];
  const strong = students.filter((s) => names.some((nm) => nameGate(s.variants, nm, { exactSurname: true })))
    .map((s) => ({ s, ov: overlap(rc, s.id) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov);
  if (strong.length) { const top = strong[0]; const prev = exactByStudent.get(top.s.id);
    if (!prev || top.ov > prev.ov) { if (prev) mapped.delete(prev.userId); exactByStudent.set(top.s.id, { userId: p.id, ov: top.ov }); mapped.set(p.id, top.s.id); } continue; }
  if (rc.length >= 15) { const sc = students.map((s) => ({ s, ov: overlap(rc, s.id) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov);
    if (sc.length && sc[0].ov >= 15 && sc[0].ov >= 2 * (sc[1]?.ov ?? 0) && !mapped.has(p.id)) mapped.set(p.id, sc[0].s.id); }
}

// --- проверка: 1053 старые Strava-пробежки с полилинией -> есть ли пара в кэше ---
let total = 0, matchAll = 0, matchDistNoTime = 0, matchDateOnly = 0, noDate = 0, noStudentCache = 0;
for (const r of runs) {
  const sid = mapped.get(r.user_id); if (!sid || !r.map_polyline) continue;
  const p = r.average_pace_seconds; if (typeof p === "number" && p < TRANSPORT) continue;
  const date = dOnly(r.start_date) ?? dOnly(r.created_at); const km = kmOf(r.distance_km); if (!date || !km || date >= CUTOFF) continue;
  total++;
  const om = our.get(sid); if (!om) { noStudentCache++; continue; }
  const day = om.get(date); if (!day || !day.length) { noDate++; continue; }
  const distOk = day.filter((x) => Math.abs(x.km - km) <= 0.02 * km);
  if (!distOk.length) { matchDateOnly++; continue; }
  const runSecs = [r.moving_time_seconds, r.elapsed_time_seconds, r.duration_seconds].filter((x): x is number => typeof x === "number" && x > 0);
  const timeOk = distOk.some((x) => x.sec > 0 && runSecs.some((rs) => Math.abs(x.sec - rs) <= 60));
  if (timeOk) matchAll++; else matchDistNoTime++;
}
console.log(`=== 1053-проверка: старые Strava-пробежки (с полилинией, >60д) у ${mapped.size} сопоставленных ===`);
console.log(`Всего таких пробежек: ${total}`);
console.log(`  ПАРА в кэше по дате+дистанции±2%+время±60с: ${matchAll}  (${(100 * matchAll / total).toFixed(1)}%)`);
console.log(`  дата+дистанция совпали, время мимо >60с:     ${matchDistNoTime}  (${(100 * matchDistNoTime / total).toFixed(1)}%)`);
console.log(`  дата есть, дистанция мимо:                    ${matchDateOnly}`);
console.log(`  на эту дату записи в кэше нет:                ${noDate}`);
console.log(`  у ученика вообще нет кэша:                    ${noStudentCache}`);
const found = matchAll + matchDistNoTime;
console.log(`\nИТОГ: по дате+дистанции нашлось ${found}/${total} (${(100 * found / total).toFixed(1)}%). Строго (и время) ${matchAll} (${(100 * matchAll / total).toFixed(1)}%).`);
