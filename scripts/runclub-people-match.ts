/**
 * ЭТАП 1 — сопоставление 64 профилей Run Club с учениками Coach OS. ОТЧЁТ, ничего не пишет.
 *
 * Имя: тот же модуль, что для probeg — studentNameVariantSets (транслит/мягкий знак/порядок ФИО)
 * + nameGate (строгий tier: точная фамилия + префикс имени; мягкий tier: fuzzy/prefix).
 * Проверочный признак: у сопоставленной пары ДОЛЖНЫ совпадать тренировки по дате+дистанции
 * (Run Club тянет из Strava, мы — из TP; один и тот же человек = одни и те же пробежки).
 * Транспорт (темп < 2:30/км) выброшен ДО сверки, чтобы не давал ложных совпадений.
 *
 * Три уровня: exact (строгое имя + >=1 совпадение тренировки), probable (слабее — на ручное),
 * none (нет имени, ИЛИ имя нашлось, но пробежки НЕ совпали = сопоставление опровергнуто).
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/runclub-people-match.ts
 */
import { readFileSync } from "node:fs";
import { translitVariants } from "@/features/club/name-translit";
import { nameGate, normalizeKm } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

// studentNameVariantSets emits ONLY Cyrillic translit for a Latin roster name (drops the Latin
// original), so Latin-profile ↔ Latin-student never matches. Enrich each token with the original
// normalized form AND its translit variants → script-agnostic (Latin↔Latin, Cyrillic↔Cyrillic,
// and cross-script via translit all work). nameGate's surname-exact/prefix logic is unchanged.
const normTok = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
function enrichedSets(name: string): string[][] {
  const tokens = name.trim().split(/\s+/u).map((t) => t.replace(/[^a-zа-яё]/giu, "")).filter((t) => t.length >= 2);
  return tokens.map((t) => {
    const vs = /[a-z]/i.test(t) ? translitVariants(t) : [t];
    return [...new Set([normTok(t), ...vs.map(normTok)])];
  });
}

const EXPORT = "/Users/igor/runclub-export";
type Profile = { id: string; name?: string | null; first_name?: string | null; last_name?: string | null; nickname?: string | null };
type RunRow = { user_id: string; start_date?: string | null; created_at?: string | null; distance_km?: number | null; average_pace_seconds?: number | null };
type StudentRow = { id: string; student_name: string | null; is_active: boolean };
type WkRow = { student_id: string; workout_date: string | null; completed_distance_raw: number | string | null };
const profiles = JSON.parse(readFileSync(`${EXPORT}/profiles.json`, "utf8")) as Profile[];
const runs = JSON.parse(readFileSync(`${EXPORT}/runs.json`, "utf8")) as RunRow[];

const TRANSPORT_PACE = 150; // сек/км: быстрее 2:30/км => транспорт, выбросить
const SLOW_PACE = 1500;     // медленнее 25:00/км => мусор/пауза
const dOnly = (iso: unknown): string | null => (typeof iso === "string" ? iso.slice(0, 10) : null);
const kmOf = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// --- Run Club: пробежки по профилю (дата+км), транспорт отфильтрован ---
const rcByUser = new Map<string, Array<{ date: string; km: number }>>();
let droppedTransport = 0;
for (const r of runs) {
  const pace = r.average_pace_seconds;
  if (typeof pace === "number" && (pace < TRANSPORT_PACE || pace > SLOW_PACE)) { if (pace < TRANSPORT_PACE) droppedTransport++; continue; }
  const date = dOnly(r.start_date) ?? dOnly(r.created_at);
  const dkm = kmOf(r.distance_km);
  if (!date || !dkm) continue;
  if (!rcByUser.has(r.user_id)) rcByUser.set(r.user_id, []);
  rcByUser.get(r.user_id)!.push({ date, km: dkm });
}

const sb = createSupabaseServerClient();
const { data: studs } = await sb.from("trainingpeaks_students").select("id, student_name, is_active");
const students = ((studs ?? []) as StudentRow[])
  .filter((s) => Boolean(s.student_name && s.student_name.trim()))
  .map((s) => ({ id: s.id, name: s.student_name as string, active: s.is_active, variants: enrichedSets(s.student_name as string) }));

const candNames = (p: Profile): string[] => {
  const set = new Set<string>();
  if (p.name) set.add(String(p.name));
  const fl = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  if (fl) set.add(fl);
  if (p.nickname) set.add(String(p.nickname)); // часть профилей держит полное ФИО в нике (Юлия Крылова)
  return [...set];
};
const matchTier = (variants: string[][], names: string[]): "strong" | "loose" | null => {
  let tier: "loose" | null = null;
  for (const nm of names) {
    if (nameGate(variants, nm, { exactSurname: true })) return "strong";
    if (nameGate(variants, nm)) tier = "loose";
  }
  return tier;
};

// pass 1: имя-кандидаты
type Cand = { student: typeof students[number]; tier: "strong" | "loose"; overlap: number };
const profMatches = profiles.map((p) => {
  const names = candNames(p);
  const cands: Cand[] = [];
  for (const s of students) { const t = matchTier(s.variants, names); if (t) cands.push({ student: s, tier: t, overlap: 0 }); }
  return { p, names, cands };
});
// ВСЕ наши тренировки (нужны и для сверки пар, и для подсказок по тренировкам без гейта имени).
const ourByStudent = new Map<string, Map<string, number[]>>();
{
  let off = 0;
  for (;;) {
    const { data } = await sb.from("trainingpeaks_workout_cache")
      .select("student_id, workout_date, completed_distance_raw").range(off, off + 999);
    const rows = (data ?? []) as WkRow[];
    for (const w of rows) {
      const d = w.workout_date; const k = normalizeKm(w.completed_distance_raw);
      if (!d || !k) continue;
      if (!ourByStudent.has(w.student_id)) ourByStudent.set(w.student_id, new Map());
      const m = ourByStudent.get(w.student_id)!; if (!m.has(d)) m.set(d, []); m.get(d)!.push(k);
    }
    if (rows.length < 1000) break; off += 1000;
  }
}

const overlap = (rc: Array<{ date: string; km: number }> | undefined, ours: Map<string, number[]> | undefined): number => {
  if (!rc || !ours) return 0;
  let n = 0;
  for (const run of rc) {
    const same = ours.get(run.date); if (!same) continue;
    const tol = Math.max(0.3, 0.08 * run.km);
    if (same.some((k) => Math.abs(k - run.km) <= tol)) n++;
  }
  return n;
};

// classify
type Row = { p: Profile; runCount: number; level: "exact" | "probable" | "none"; best?: Cand; reason: string };
const rows: Row[] = [];
for (const m of profMatches) {
  const rc = rcByUser.get(m.p.id) ?? [];
  const cands = m.cands.map((c) => ({ ...c, overlap: overlap(rc, ourByStudent.get(c.student.id)) }))
    .sort((a, b) => (b.overlap - a.overlap) || ((a.tier === "strong" ? 0 : 1) - (b.tier === "strong" ? 0 : 1)));
  const best = cands[0];
  const strongOverlap = cands.filter((c) => c.tier === "strong" && c.overlap >= 1);
  let level: Row["level"] = "none"; let reason = "нет совпадения имени";
  if (!best) { level = "none"; reason = m.names.length && rc.length ? "имя не совпало ни с кем" : "имя не совпало"; }
  else if (rc.length === 0) { level = "probable"; reason = `имя (${best.tier}), но у профиля нет пробежек для сверки`; }
  else if (strongOverlap.length === 1) { level = "exact"; reason = `строгое имя + ${strongOverlap[0].overlap} совпад. тренировок`; }
  else if (strongOverlap.length > 1) { level = "probable"; reason = `несколько строгих кандидатов с совпадениями (${strongOverlap.map((c) => c.student.name).join(" / ")})`; }
  else if (best.overlap >= 1) { level = "probable"; reason = `${best.tier} имя + ${best.overlap} совпад. тренировок (нестрогое имя)`; }
  else { level = "none"; reason = `имя совпало (${best.student.name}, ${best.tier}), но НИ ОДНОЙ общей тренировки — опровергнуто`; }
  rows.push({ p: m.p, runCount: rc.length, level, best: level === "none" ? best : best, reason });
}

// коллизия неуникального имени: 2+ профиля exact → ОДИН ученик (напр. два разных «Olga» на нашу
// единственную «Olga»). Оставляем самый сильный по совпадению тренировок, остальные → probable.
const exactByStudent = new Map<string, Row[]>();
for (const r of rows) if (r.level === "exact" && r.best) { const k = r.best.student.id; if (!exactByStudent.has(k)) exactByStudent.set(k, []); exactByStudent.get(k)!.push(r); }
for (const [, grp] of exactByStudent) if (grp.length > 1) {
  grp.sort((a, b) => (b.best!.overlap - a.best!.overlap));
  for (const r of grp.slice(1)) { r.level = "probable"; r.reason = `коллизия имени: этот ученик сильнее сматчен другим профилем (${grp[0].best!.overlap} совпад.), здесь только ${r.best!.overlap} — вероятно ДРУГОЙ человек, которого у нас нет`; }
}

// ---- вывод ----
const disp = (p: Profile): string => `${p.name ?? "?"}${p.nickname ? ` (@${p.nickname})` : ""}`;
const exact = rows.filter((r) => r.level === "exact");
const probable = rows.filter((r) => r.level === "probable");
const none = rows.filter((r) => r.level === "none");

console.log(`\n=== ИТОГ: профилей ${profiles.length} | ТОЧНО ${exact.length} | ВЕРОЯТНО ${probable.length} | НЕТ ${none.length} ===`);
console.log(`(Run Club пробежек всего ${runs.length}, выброшено транспортом ${droppedTransport}; наших учеников ${students.length})`);

console.log(`\n--- ТОЧНОЕ (${exact.length}) — строгое имя + совпали тренировки по дате/дистанции ---`);
for (const r of exact) console.log(`  ${disp(r.p)}  →  ${r.best!.student.name}   [${r.reason}]`);

console.log(`\n--- ВЕРОЯТНОЕ (${probable.length}) — НЕ привязываю, на твоё решение ---`);
for (const r of probable) console.log(`  ${disp(r.p)}  →  ${r.best ? r.best.student.name : "?"}   [${r.reason}]  (пробежек ${r.runCount})`);

// подсказки по тренировкам: для NONE с активностью — топ-ученик по совпадению пробежек (имя не гейтится)
const alreadyMatched = new Set([...exact, ...probable].map((r) => r.best?.student.id).filter(Boolean));
const topByWorkout = (rc: Array<{ date: string; km: number }>) =>
  students.map((s) => ({ s, ov: overlap(rc, ourByStudent.get(s.id)) })).filter((x) => x.ov >= 1).sort((a, b) => b.ov - a.ov).slice(0, 3);
const hints: Array<{ r: Row; top: ReturnType<typeof topByWorkout> }> = [];
const junk: Row[] = [];
for (const r of none) {
  const rc = rcByUser.get(r.p.id) ?? [];
  const top = r.runCount >= 15 ? topByWorkout(rc) : [];
  if (top.length && top[0].ov >= 5) hints.push({ r, top }); else junk.push(r);
}

console.log(`\n--- ПОДСКАЗКИ ПО ТРЕНИРОВКАМ (${hints.length}) — имя без фамилии/ник не гейтится; топ-ученик по совпадению пробежек, СВЕРЬ ВРУЧНУЮ ---`);
for (const h of hints) {
  const t = h.top.map((x) => `${x.s.name}: ${x.ov}${alreadyMatched.has(x.s.id) ? " (уже сматчен)" : ""}`).join("  |  ");
  console.log(`  ${disp(h.r.p)} (пробежек ${h.r.runCount})  →  ${t}`);
}

console.log(`\n--- НЕТ / мусор (${junk.length}) — нет имени и нет уверенной подсказки (тест-акки, пустые, чужие) ---`);
for (const r of junk) console.log(`  ${disp(r.p)}   [${r.reason}]  (пробежек ${r.runCount})`);

// дубли: несколько профилей -> один ученик
const byStudent = new Map<string, string[]>();
for (const r of [...exact, ...probable]) if (r.best) { const k = r.best.student.name; if (!byStudent.has(k)) byStudent.set(k, []); byStudent.get(k)!.push(disp(r.p)); }
const dupes = [...byStudent.entries()].filter(([, v]) => v.length > 1);
console.log(`\n--- ДУБЛИ (один ученик ← несколько профилей): ${dupes.length} ---`);
for (const [stu, profs] of dupes) console.log(`  ${stu}  ←  ${profs.join("  |  ")}`);
