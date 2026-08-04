/**
 * ФАЗА 2 — импорт best_efforts Run Club (честные отрезки Strava из потоков). DRY-RUN по умолчанию.
 *
 * Транспорт-фильтр ОБЯЗАТЕЛЕН и стоит ПЕРВЫМ: любой отрезок с темпом < 2:30/км (поезд/машина как бег)
 * выбрасывается ДО любой обработки — 43 «быстрее мирового рекорда» не попадают даже в промежуточный план.
 * Иерархия: coach_confirmed > official_protocol > race_events > strava_best_effort > реконструкция.
 * Стандартные (5K/10K/Half/Marathon) -> club_records (source=strava_best_effort), НЕ перебивая
 * coach_confirmed/official_protocol; реконструкцию заменяет, только если Strava быстрее. Нестандартные
 * (1K/1mile/15K/20K/30K/50k…) -> журнал club_official_results (любая дистанция).
 *
 * Маппинг — из зафиксированного docs/runclub-people-map.json (фаза 1). Без пересчёта, без тяжёлой загрузки.
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs --env-file=.env.local \
 *     scripts/runclub-best-efforts-import.ts [--commit]
 */
import { readFileSync } from "node:fs";
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const EXPORT = "/Users/igor/runclub-export";
type MapRow = { profileId: string; profileName: string | null; studentId: string; studentName: string | null; tier: string };
const mapping = JSON.parse(readFileSync("docs/runclub-people-map.json", "utf8")) as MapRow[];
const byProfile = new Map(mapping.map((m) => [m.profileId, m]));
const bestEfforts = JSON.parse(readFileSync(`${EXPORT}/best_efforts.json`, "utf8")) as Array<{ user_id: string; efforts: Array<{ name: string; distance_meters: number; moving_time_seconds: number; pace_seconds_per_km: number; start_date: string; strava_best_effort_id: string }> }>;

const TRANSPORT = 150; // сек/км — быстрее 2:30/км = транспорт, ВЫБРОСИТЬ ПЕРВЫМ
const BUCKET: Record<string, "5k" | "10k" | "21k" | "42k"> = { "5K": "5k", "10K": "10k", "Half-Marathon": "21k", "Marathon": "42k" };
const KM_OF = { "5k": 5, "10k": 10, "21k": 21.0975, "42k": 42.195 } as const;
const fmt = (s: number): string => { const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), q = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(q).padStart(2, "0")}` : `${m}:${String(q).padStart(2, "0")}`; };
const dOnly = (v: string): string => v.slice(0, 10);

// best_efforts -> лучшие по (ученик, дистанция). Транспорт выброшен ПЕРЕД накоплением.
type Best = { seconds: number; date: string; distMeters: number };
const std = new Map<string, Best>();      // `${studentId}|${bucket}` -> лучший
const nonStd = new Map<string, Best & { name: string; studentId: string; effortId: string }>(); // `${studentId}|${name}`
let transportDropped = 0, totalEfforts = 0;
for (const be of bestEfforts) {
  const m = byProfile.get(be.user_id); if (!m) continue;
  for (const e of be.efforts) {
    totalEfforts++;
    if (e.pace_seconds_per_km < TRANSPORT) { transportDropped++; continue; } // ФИЛЬТР ПЕРВЫМ
    const b = BUCKET[e.name];
    if (b) { const k = `${m.studentId}|${b}`; const cur = std.get(k); if (!cur || e.moving_time_seconds < cur.seconds) std.set(k, { seconds: e.moving_time_seconds, date: dOnly(e.start_date), distMeters: e.distance_meters }); }
    else { const k = `${m.studentId}|${e.name}`; const cur = nonStd.get(k); if (!cur || e.moving_time_seconds < cur.seconds) nonStd.set(k, { seconds: e.moving_time_seconds, date: dOnly(e.start_date), distMeters: e.distance_meters, name: e.name, studentId: m.studentId, effortId: e.strava_best_effort_id }); }
  }
}

const sb = createSupabaseServerClient();
const ids = [...new Set(mapping.map((m) => m.studentId))];
const { data: recs, error: re } = await sb.from("club_records").select("student_id, distance_key, duration_seconds, source").in("student_id", ids);
if (re) throw new Error(`club_records: ${re.message}`);
const ourRec = new Map<string, { sec: number; source: string }>();
for (const r of (recs ?? []) as Array<{ student_id: string; distance_key: string; duration_seconds: number; source: string }>) ourRec.set(`${r.student_id}|${r.distance_key}`, { sec: r.duration_seconds, source: r.source });

const nameOf = (sid: string): string => mapping.find((m) => m.studentId === sid)?.studentName ?? sid;

// --- стандартные -> club_records по иерархии ---
type Plan = { sid: string; bucket: string; sec: number; date: string; action: "new" | "replace" | "protected" | "worse"; existing?: { sec: number; source: string } };
const stdPlan: Plan[] = [];
for (const [key, best] of std) {
  const [sid, bucket] = key.split("|");
  const ex = ourRec.get(key);
  let action: Plan["action"];
  if (!ex) action = "new";
  else if (ex.source === "coach_confirmed" || ex.source === "official_protocol") action = "protected";
  else if (best.seconds < ex.sec - 1) action = "replace"; // реконструкция, Strava быстрее
  else action = "worse";
  stdPlan.push({ sid, bucket, sec: best.seconds, date: best.date, action, existing: ex });
}
// Детектор битых данных БЕЗ абсолютных порогов: для одного человека темп должен РАСТИ с дистанцией.
// Если на более КОРОТКОЙ дистанции темп МЕДЛЕННЕЕ текущего — значит этот (более длинный) отрезок
// аномально быстр = битая запись (глюк GPS/дистанции). TOL — только шумовой зазор сравнения.
const TOL = 5; // с/км — только шумовой зазор сравнения
const stdDist = (bucket: string): number => (KM_OF[bucket as keyof typeof KM_OF] ?? 0) * 1000;
// База сравнения — ТОЛЬКО эталонные дистанции (5k/10k/21k/42k): их «лучшее» реально бегается. Короткие
// суб-сегменты (mile/2mile) часто «мягкие» (не на максимум) и дают ложные срабатывания — в базу НЕ идут.
const athleteStd = new Map<string, Array<{ dm: number; pace: number }>>();
for (const [key, b] of std) { const [sid, bucket] = key.split("|"); const dm = stdDist(bucket); (athleteStd.get(sid) ?? athleteStd.set(sid, []).get(sid)!).push({ dm, pace: b.seconds / (dm / 1000) }); }
// «виноватый» более короткий ЭТАЛОННЫЙ отрезок (медленнее по темпу) — тогда текущий аномально быстр
const brokenWhy = (sid: string, dm: number, sec: number): { dm: number; pace: number } | null => {
  const pace = sec / (dm / 1000); let worst: { dm: number; pace: number } | null = null;
  for (const s of athleteStd.get(sid) ?? []) if (s.dm < dm && s.pace > pace + TOL) { if (!worst || s.pace > worst.pace) worst = s; }
  return worst;
};
const broken = (sid: string, dm: number, sec: number): boolean => brokenWhy(sid, dm, sec) !== null;
// ручные исключения тренера (домен): неправдоподобные 5к (мастер-уровень) — монотонность самую короткую
// эталонную дистанцию не ловит; систематически быстрый девайс/чужая активность.
const manualId = (name: string): string => mapping.find((m) => m.studentName === name)?.studentId ?? "__";
const MANUAL = new Set([`${manualId("Yulia Grigoreva")}|5k`, `${manualId("Kudryavtseva Liliya")}|5k`, `${manualId("Igor Klimovich")}|5k`]);
const excludeReason = (p: Plan): string | null => {
  const w = brokenWhy(p.sid, stdDist(p.bucket), p.sec);
  if (w) return `эталон ${w.dm}м медленнее (${Math.round(w.pace)}/км)`;
  if (MANUAL.has(`${p.sid}|${p.bucket}`)) return "ручное (мастер-уровень/девайс)";
  return null;
};
const writeAll = stdPlan.filter((p) => p.action === "new" || p.action === "replace");
const suspicious = writeAll.filter((p) => excludeReason(p));
const toWrite = writeAll.filter((p) => !excludeReason(p));

console.log(`=== ФАЗА 2 best_efforts ${COMMIT ? "[--commit]" : "[DRY-RUN]"} — по ${ids.length} сопоставленным ученикам ===`);
console.log(`отрезков всего у них: ${totalEfforts} | ВЫБРОШЕНО ТРАНСПОРТОМ (темп <2:30/км): ${transportDropped}\n`);

console.log(`--- club_records: К ЗАПИСИ ${toWrite.length} (source=strava_best_effort) ---`);
for (const p of toWrite.sort((a, b) => a.sid.localeCompare(b.sid))) {
  const tag = p.action === "new" ? "НОВЫЙ" : `заменяет реконструкцию ${fmt(p.existing!.sec)}`;
  const km = KM_OF[p.bucket as keyof typeof KM_OF];
  console.log(`  ${nameOf(p.sid)} · ${p.bucket} · ${fmt(p.sec)} (${Math.round(p.sec / km)}/км) · ${p.date} · ${tag}`);
}
console.log(`\n--- ⚠ ОТБРОШЕНО как битые (${suspicious.length}) — НЕ пишу; причина рядом ---`);
for (const p of suspicious.sort((a, b) => a.bucket.localeCompare(b.bucket))) {
  const km = KM_OF[p.bucket as keyof typeof KM_OF];
  console.log(`  ${nameOf(p.sid)} · ${p.bucket} · ${fmt(p.sec)} (${Math.round(p.sec / km)}/км) · ${p.date}  [${excludeReason(p)}]`);
}
console.log(`\n--- club_records ПРОПУЩЕНО: защищено coach/official ${stdPlan.filter((p) => p.action === "protected").length}, не лучше нашего ${stdPlan.filter((p) => p.action === "worse").length} ---`);

// --- нестандартные -> журнал (тот же детектор монотонности) ---
const journalClean = [...nonStd.values()].filter((v) => !broken(v.studentId, v.distMeters, v.seconds));
const journalBroken = nonStd.size - journalClean.length;
const byDist = new Map<string, number>();
for (const v of journalClean) byDist.set(v.name, (byDist.get(v.name) ?? 0) + 1);
console.log(`\n--- club_official_results (журнал): К ЗАПИСИ ${journalClean.length} различных лучших (битых по монотонности отброшено ${journalBroken}) ---`);
console.log(`  по дистанциям: ${[...byDist.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join("  ")}`);
console.log("  примеры (первые 10):");
for (const v of journalClean.slice(0, 10)) console.log(`    ${nameOf(v.studentId)} · ${v.name} (${v.distMeters}м) · ${fmt(v.seconds)} · ${v.date}`);

console.log(`\n=== ИТОГ ПЛАНА: ${toWrite.length} рекордов + ${journalClean.length} в журнал. Транспорт ${transportDropped} выброшен; битых по монотонности отброшено: рекордов ${suspicious.length}, журнал ${journalBroken}. ===`);
if (!COMMIT) { console.log("\nDRY-RUN: ничего не записано. Применить миграцию 20260903 (source-чеки + strava_best_effort_id), затем --commit."); process.exit(0); }

// --- ЗАПИСЬ (--commit). Идемпотентно: рекорды onConflict(student_id,distance_key),
//     журнал onConflict(student_id,strava_best_effort_id). source='strava_best_effort'. ---
const nowIso = new Date().toISOString();
let recOk = 0, recFail = 0;
for (const p of toWrite) {
  const km = KM_OF[p.bucket as keyof typeof KM_OF];
  const { error } = await sb.from("club_records").upsert({
    student_id: p.sid, distance_key: p.bucket, duration_seconds: p.sec,
    pace_sec_per_km: km ? Math.round(p.sec / km) : null, record_date: p.date,
    trust: "verified", source: "strava_best_effort",
  }, { onConflict: "student_id,distance_key" });
  if (error) { recFail++; console.log(`  FAIL rec ${nameOf(p.sid)}/${p.bucket}: ${error.message}`); } else recOk++;
}
let jOk = 0, jFail = 0;
for (const v of journalClean) {
  const { error } = await sb.from("club_official_results").upsert({
    student_id: v.studentId, race_date: v.date, distance_km: Math.round(v.distMeters / 100) / 10,
    distance_label: v.name, result_seconds: v.seconds, source: "strava_best_effort", trust: "verified",
    confirmed_by: "strava-import", strava_best_effort_id: v.effortId, updated_at: nowIso,
  }, { onConflict: "student_id,strava_best_effort_id" });
  if (error) { jFail++; if (jFail <= 8) console.log(`  FAIL journal ${nameOf(v.studentId)}/${v.name}: ${error.message}`); } else jOk++;
}
console.log(`\n=== ЗАПИСАНО: рекордов ${recOk} (ошибок ${recFail}), журнал ${jOk} (ошибок ${jFail}) ===`);
process.exit(recFail || jFail ? 1 : 0);
