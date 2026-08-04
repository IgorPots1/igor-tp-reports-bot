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
const bestEfforts = JSON.parse(readFileSync(`${EXPORT}/best_efforts.json`, "utf8")) as Array<{ user_id: string; efforts: Array<{ name: string; distance_meters: number; moving_time_seconds: number; pace_seconds_per_km: number; start_date: string }> }>;

const TRANSPORT = 150; // сек/км — быстрее 2:30/км = транспорт, ВЫБРОСИТЬ ПЕРВЫМ
const BUCKET: Record<string, "5k" | "10k" | "21k" | "42k"> = { "5K": "5k", "10K": "10k", "Half-Marathon": "21k", "Marathon": "42k" };
const KM_OF = { "5k": 5, "10k": 10, "21k": 21.0975, "42k": 42.195 } as const;
const fmt = (s: number): string => { const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), q = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(q).padStart(2, "0")}` : `${m}:${String(q).padStart(2, "0")}`; };
const dOnly = (v: string): string => v.slice(0, 10);

// best_efforts -> лучшие по (ученик, дистанция). Транспорт выброшен ПЕРЕД накоплением.
type Best = { seconds: number; date: string; distMeters: number };
const std = new Map<string, Best>();      // `${studentId}|${bucket}` -> лучший
const nonStd = new Map<string, Best & { name: string; studentId: string }>(); // `${studentId}|${name}`
let transportDropped = 0, totalEfforts = 0;
for (const be of bestEfforts) {
  const m = byProfile.get(be.user_id); if (!m) continue;
  for (const e of be.efforts) {
    totalEfforts++;
    if (e.pace_seconds_per_km < TRANSPORT) { transportDropped++; continue; } // ФИЛЬТР ПЕРВЫМ
    const b = BUCKET[e.name];
    if (b) { const k = `${m.studentId}|${b}`; const cur = std.get(k); if (!cur || e.moving_time_seconds < cur.seconds) std.set(k, { seconds: e.moving_time_seconds, date: dOnly(e.start_date), distMeters: e.distance_meters }); }
    else { const k = `${m.studentId}|${e.name}`; const cur = nonStd.get(k); if (!cur || e.moving_time_seconds < cur.seconds) nonStd.set(k, { seconds: e.moving_time_seconds, date: dOnly(e.start_date), distMeters: e.distance_meters, name: e.name, studentId: m.studentId }); }
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
// Второй фильтр качества: транспорт (<2:30/км) уже выброшен, но GPS-глюк на реальном беге может дать
// ФИЗИОЛОГИЧЕСКИ невозможный для любителя PR (14:07 на 5к при 40:38 на 10к). Порог — почти-элитный
// уровень; всё быстрее почти наверняка глюк дистанции. НЕ выбрасываю молча — выношу на решение тренера.
const ELITE_FLOOR: Record<string, number> = { "5k": 16 * 60, "10k": 33 * 60, "21k": 82 * 60, "42k": 165 * 60 };
const isSuspicious = (bucket: string, sec: number): boolean => sec < (ELITE_FLOOR[bucket] ?? 0);
const writeAll = stdPlan.filter((p) => p.action === "new" || p.action === "replace");
const suspicious = writeAll.filter((p) => isSuspicious(p.bucket, p.sec));
const toWrite = writeAll.filter((p) => !isSuspicious(p.bucket, p.sec));

console.log(`=== ФАЗА 2 best_efforts ${COMMIT ? "[--commit]" : "[DRY-RUN]"} — по ${ids.length} сопоставленным ученикам ===`);
console.log(`отрезков всего у них: ${totalEfforts} | ВЫБРОШЕНО ТРАНСПОРТОМ (темп <2:30/км): ${transportDropped}\n`);

console.log(`--- club_records: К ЗАПИСИ ${toWrite.length} (source=strava_best_effort) ---`);
for (const p of toWrite.sort((a, b) => a.sid.localeCompare(b.sid))) {
  const tag = p.action === "new" ? "НОВЫЙ" : `заменяет реконструкцию ${fmt(p.existing!.sec)}`;
  const km = KM_OF[p.bucket as keyof typeof KM_OF];
  console.log(`  ${nameOf(p.sid)} · ${p.bucket} · ${fmt(p.sec)} (${Math.round(p.sec / km)}/км) · ${p.date} · ${tag}`);
}
console.log(`\n--- ⚠ ПОДОЗРИТЕЛЬНО БЫСТРЫЕ (${suspicious.length}) — прошли транспорт-фильтр, но почти-элита = вероятно GPS-глюк; НЕ пишу без твоего решения ---`);
for (const p of suspicious.sort((a, b) => a.bucket.localeCompare(b.bucket))) {
  const km = KM_OF[p.bucket as keyof typeof KM_OF];
  console.log(`  ${nameOf(p.sid)} · ${p.bucket} · ${fmt(p.sec)} (${Math.round(p.sec / km)}/км) · ${p.date}`);
}
console.log(`\n--- club_records ПРОПУЩЕНО: защищено coach/official ${stdPlan.filter((p) => p.action === "protected").length}, не лучше нашего ${stdPlan.filter((p) => p.action === "worse").length} ---`);

// --- нестандартные -> журнал ---
const byDist = new Map<string, number>();
for (const v of nonStd.values()) byDist.set(v.name, (byDist.get(v.name) ?? 0) + 1);
console.log(`\n--- club_official_results (журнал): К ЗАПИСИ ${nonStd.size} различных лучших (ученик×дистанция) ---`);
console.log(`  по дистанциям: ${[...byDist.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join("  ")}`);
console.log("  примеры (первые 10):");
for (const v of [...nonStd.values()].slice(0, 10)) console.log(`    ${nameOf(v.studentId)} · ${v.name} (${v.distMeters}м) · ${fmt(v.seconds)} · ${v.date}`);

console.log(`\n=== ИТОГ ПЛАНА: ${toWrite.length} рекордов (чистых) + ${nonStd.size} в журнал. Транспорт ${transportDropped} выброшен, подозрительных ${suspicious.length} отложено. ===`);
if (!COMMIT) console.log("\nDRY-RUN: ничего не записано. Проверь список; на --commit нужна идемпотентность журнала (ключ strava_best_effort_id) — опишу отдельно.");
