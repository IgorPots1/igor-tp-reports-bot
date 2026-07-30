/**
 * tp-threshold-restore — restore ONE athlete's real threshold WITH a from-description
 * recompute of their future planned workout structures, so watches match the descriptions
 * under the real (fast) threshold again.
 *
 * SAFETY (mirrors tp-athlete):
 *  - DRY-RUN by default: parse → role-match → recompute % → sanity-gate → print diff, write NOTHING.
 *  - APPLY needs ALL of: --apply + env TP_ATHLETE_REAL_WRITE=1 + --confirm "RESTORE <athleteId>".
 *  - Structure write is the VERIFIED recipe (tp-write-payloads §5): GET the whole workout →
 *    modify ONLY targets on the live object → JSON.stringify(structure) → PUT the whole object →
 *    verify by GET. NEVER build the object from scratch.
 *  - Sanity: ONE wide physiological frame on EVERY step (55-140%). It catches parser garbage
 *    and a clearly-wrong threshold, but does NOT argue with the coach's prescribed pace
 *    ("Бег по темпу" = run-to-a-given-pace, not a tempo effort). No narrow per-role bands.
 *    Any step outside 55-140% → whole athlete deferred, no write. The meaningful result-check
 *    is the anchor gate (easy step @new threshold = FIT anchor ±20s) — it checks the outcome.
 *  - Order: ALL structures written+verified FIRST; the threshold is set ONLY after every
 *    structure succeeded. A structure failure stops before the threshold is touched.
 *  - After the threshold, verify the easy step resolves to the athlete anchor ±20s, else stop.
 *  - One athlete per invocation, by design.
 *
 * EXIT CODES (a batch runner interprets these — see Igor's stop-vs-skip rule):
 *   0 applied OK · 2 SKIP athlete (structure verify/data mismatch — no threshold set)
 *   3 SKIP (no real threshold / refused gate) · 4 SKIP (sanity band defer)
 *   5 STOP-ALL (write path broken: PUT structure ≠200, threshold PUT ≠204, or 204-but-value-wrong)
 *   1 STOP-ALL (unexpected error)
 *
 * Usage:
 *   npx tsx tools/trainingpeaks-export/scripts/tp-threshold-restore.ts --athlete=5748681
 *   TP_ATHLETE_REAL_WRITE=1 ... --athlete=5748681 --apply --confirm "RESTORE 5748681"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { readSessionSnapshot } from "../../../src/features/trainingpeaks/tp-session-snapshot.ts";
import { toolRoot } from "./lib/paths.ts";
import { authedWriteOnce, COACH_ID_SETUP_HINT, findWt0Set, formatMpsAsPace, isRecord, loadCoachUserId, TP_API_HOST } from "./lib/tp-athlete-helpers.ts";
import { planType } from "./lib/tp-athlete-set-threshold.ts";
import { pickWhitelistedSettings } from "./lib/tp-settings-whitelist.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function getSupabase(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), path.join(toolRoot, ".env")]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const S = (mm: string): number => { const [a, b] = mm.split(":"); return Number(a) * 60 + Number(b); };
function daysAgo(n: number): string { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function median(xs: number[]): number | null { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function fp(sec: number | null): string { if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—"; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`; }
function getFlag(name: string): string | undefined { const eq = process.argv.find((a) => a.startsWith(`--${name}=`)); if (eq) return eq.slice(name.length + 3); const i = process.argv.indexOf(`--${name}`); return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined; }
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);

// ── TP workout GET (the read half of the verified recipe) ─────────────────────
async function getBearer(): Promise<string> {
  const snap = await readSessionSnapshot();
  const res = await fetch(`${TP_API_HOST}/users/v3/token`, { method: "GET", headers: { accept: "application/json", Cookie: `Production_tpAuth=${snap.cookieValue}` } });
  if (!res.ok) throw new Error(`token exchange HTTP ${res.status}`);
  const body: unknown = await res.json();
  const token = isRecord(body) && isRecord(body.token) ? body.token.access_token : null;
  if (typeof token !== "string" || !token) throw new Error("no access_token");
  return token;
}
async function getWorkout(athleteId: number, workoutId: number): Promise<Record<string, unknown>> {
  const bearer = await getBearer();
  const res = await fetch(`${TP_API_HOST}/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`, { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GET workout ${workoutId} HTTP ${res.status}`);
  const o = await res.json();
  if (!isRecord(o)) throw new Error(`GET workout ${workoutId} not an object`);
  return o;
}

// ── description parse + role steps + recompute ────────────────────────────────
type Rng = { fast: number; slow: number; idx: number };
// NO dedup: a repeated range is TWO real segments run at the same pace (warm-up and a recovery
// can share a pace). Ranges are returned in APPEARANCE order for positional matching to steps.
function ranges(desc: string): Rng[] { const out: Rng[] = []; const re = /(\d{1,2}:\d{2})\s*(?:[-–—−]|@|до)\s*(\d{1,2}:\d{2})/gi; let m: RegExpExecArray | null; while ((m = re.exec(desc)) !== null) { const fast = Math.min(S(m[1]), S(m[2])), slow = Math.max(S(m[1]), S(m[2])); if (fast < 150 || slow > 600) continue; out.push({ fast, slow, idx: m.index }); } return out; }
type Role = "разминка" | "заминка" | "отдых" | "работа";
type FlatStep = { role: Role; min: number; max: number; block: number; step: number };
/** flatten a structure OBJECT (structure.structure[].steps[]) into ordered steps with roles. */
function flatSteps(structObj: unknown): { metric: string; isRep: boolean; steps: FlatStep[] } | null {
  if (!isRecord(structObj) || !Array.isArray(structObj.structure)) return null;
  const metric = String(structObj.primaryIntensityMetric ?? "");
  const isRep = structObj.structure.some((b: unknown) => isRecord(b) && b.type === "repetition");
  const steps: FlatStep[] = [];
  structObj.structure.forEach((block: unknown, bi: number) => { if (!isRecord(block) || !Array.isArray(block.steps)) return; block.steps.forEach((st: unknown, si: number) => { if (!isRecord(st)) return; const tg = Array.isArray(st.targets) && st.targets.length ? st.targets[0] : null; const cls = String(st.intensityClass ?? ""); const nm = String(st.name ?? ""); const role: Role = /warm|размин/i.test(nm) || cls === "warmUp" ? "разминка" : /cool|замин/i.test(nm) || cls === "coolDown" ? "заминка" : cls === "rest" ? "отдых" : "работа"; steps.push({ role, min: isRecord(tg) && typeof tg.minValue === "number" ? tg.minValue : NaN, max: isRecord(tg) && typeof tg.maxValue === "number" ? tg.maxValue : NaN, block: bi, step: si }); }); });
  return { metric, isRep, steps };
}
/** ONE wide physiological frame on every step — catches parser garbage / a clearly-wrong
 *  threshold, never argues with the coach's prescribed pace. No narrow per-role bands. */
function band(): [number, number] { return [55, 140]; }
/** Deep structural diff (order-insensitive on objects; by-index on arrays). `polyline` is a
 *  TP-recomputed rendering artifact and is excluded at any level. Collects human-readable paths. */
function deepDiff(a: unknown, b: unknown, p: string, out: string[]): void {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) { out.push(`${p}.length ${a.length}→${b.length}`); return; } for (let i = 0; i < a.length; i++) deepDiff(a[i], b[i], `${p}[${i}]`, out); return; }
  if (isRecord(a) && isRecord(b)) { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of keys) { if (k === "polyline") continue; deepDiff(a[k], b[k], p ? `${p}.${k}` : k, out); } return; }
  out.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
type Plan = { block: number; step: number; role: Role; oldMin: number; oldMax: number; newMin: number; newMax: number; lo: number; hi: number; ok: boolean; src: string };
/** recompute new %-targets per step from description + real threshold.
 *  POSITIONAL: the i-th description range → the i-th NON-rest step, in appearance order
 *  (no dedup, no sort — the coach writes segments in order). Anchor is used ONLY for rest
 *  steps, and for a lone easy step when the description carries NO range at all. Any other
 *  range/step count mismatch is ambiguous → returns a `defer` reason and writes nothing
 *  (never guess an anchor onto a work step). Returns null if not a pace-structure. */
function recompute(structObj: unknown, desc: string, title: string, thrSec: number, anchor: number | null): { isEasy: boolean; plans: Plan[]; defer?: string } | null {
  const fx = flatSteps(structObj); if (!fx || !/pace/i.test(fx.metric)) return null;
  const isEasy = !fx.isRep && /лёгк|легк|длительн|восстанов|свободн/i.test(title);
  const rs = ranges(desc); // appearance order, NO dedup, NO sort
  const nonRest = fx.steps.filter((s) => s.role !== "отдых");
  let mode: "positional" | "anchorAll";
  if (rs.length === 0) { if (nonRest.length > 1) return { isEasy, plans: [], defer: `нет диапазонов в описании, а рабочих шагов ${nonRest.length} (>1) — привязать нечем, якорь на работу не ставим` }; mode = "anchorAll"; }
  else if (rs.length === nonRest.length) mode = "positional";
  else return { isEasy, plans: [], defer: `диапазонов в описании ${rs.length} ≠ рабочих шагов ${nonRest.length} — позиционная привязка неоднозначна` };
  const plans: Plan[] = []; let pos = 0;
  for (const st of fx.steps) {
    let assigned: Rng | "anchor";
    if (st.role === "отдых" || mode === "anchorAll") assigned = "anchor";
    else { assigned = rs[pos]; pos++; }
    let nMin: number, nMax: number, src: string;
    if (assigned === "anchor") { const a = anchor ?? thrSec * 1.3; nMax = Math.round((thrSec / (a - 8)) * 100); nMin = Math.round((thrSec / (a + 12)) * 100); src = `якорь ${fp(a)}`; }
    else { nMax = Math.round((thrSec / assigned.fast) * 100); nMin = Math.round((thrSec / assigned.slow) * 100); src = `${fp(assigned.slow)}–${fp(assigned.fast)}`; }
    const [lo, hi] = band();
    plans.push({ block: st.block, step: st.step, role: st.role, oldMin: st.min, oldMax: st.max, newMin: nMin, newMax: nMax, lo, hi, ok: nMin >= lo && nMax <= hi, src });
  }
  return { isEasy, plans };
}

/** POST-CONDITION GUARD (result-based, filter-bug-proof). Independently — with a query
 *  DELIBERATELY DIFFERENT from the recompute list-builder (no SQL date bound; date filtered in
 *  code) and reading the LIVE TP structure, not the DB cache — verify that EVERY planned pace
 *  workout of the athlete (today and later) renders, under the NEW threshold, within 20s of its
 *  description (positional) / anchor. Fail-closed: anything that cannot be verified is a violation.
 *  Returns the list of violations (empty = consistent). This checks the RESULT, not the work-list,
 *  so a filter/window bug in the recompute list cannot hide a workout from it. */
async function checkPlanConsistency(supabase: SupabaseClient, id: number, thrSec: number, anchor: number | null): Promise<string[]> {
  const viol: string[] = [];
  const today = todayIso();
  // Independent broad query — NOT the recompute query: no SQL date filter (date filtered in code
  // below), and the structure is read LIVE from TP, not from the DB cache the recompute used.
  const { data } = await supabase.from("trainingpeaks_workout_cache").select("workout_date, title, trainingpeaks_workout_id, is_planned, completed_time_raw, workout_type_value_id, description:source_snapshot->>description").eq("trainingpeaks_athlete_id", id);
  const planned = (data ?? []).filter((r) => r.is_planned === true && (r.completed_time_raw == null || r.completed_time_raw === 0) && r.workout_type_value_id === 3 && String(r.workout_date) >= today);
  for (const w of planned) {
    const wid = Number(w.trainingpeaks_workout_id);
    let live: Record<string, unknown>;
    try { live = await getWorkout(id, wid); } catch (e) { viol.push(`${w.workout_date} «${w.title}»: не прочитал живую структуру (${e instanceof Error ? e.message : String(e)}) — НЕ ПРОВЕРИТЬ`); continue; }
    const fx = flatSteps(live.structure);
    if (!fx || !/pace/i.test(fx.metric)) continue; // no pace targets → nothing to render wrong
    const rs = ranges(typeof w.description === "string" ? w.description : "");
    const nonRest = fx.steps.filter((s) => s.role !== "отдых");
    let mode: "positional" | "anchorAll" | "bad";
    if (rs.length === 0) mode = nonRest.length > 1 ? "bad" : "anchorAll";
    else if (rs.length === nonRest.length) mode = "positional";
    else mode = "bad";
    if (mode === "bad") { viol.push(`${w.workout_date} «${w.title}»: диапазонов ${rs.length} ≠ рабочих шагов ${nonRest.length} — НЕ ПРОВЕРИТЬ (fail-closed)`); continue; }
    let ptr = 0;
    for (const st of fx.steps) {
      const mid = (st.min + st.max) / 2; const livePace = Number.isFinite(mid) ? thrSec * 100 / mid : null;
      let refPace: number | null;
      if (st.role === "отдых" || mode === "anchorAll") refPace = anchor;
      else { const r = rs[ptr]; ptr++; refPace = (r.fast + r.slow) / 2; }
      if (livePace == null || refPace == null) { viol.push(`${w.workout_date} «${w.title}» [b${st.block}s${st.step}] ${st.role}: нет темпа/якоря — НЕ ПРОВЕРИТЬ`); continue; }
      const d = Math.abs(livePace - refPace);
      if (d > 20) viol.push(`${w.workout_date} «${w.title}» [b${st.block}s${st.step}] ${st.role}: @${fp(livePace)} vs эталон ${fp(refPace)} — Δ${Math.round(d)}с`);
    }
  }
  return viol;
}

async function main(): Promise<void> {
  const supabase = getSupabase();
  const id = Number(getFlag("athlete"));
  if (!Number.isInteger(id)) { console.error("need --athlete=<id>"); process.exit(2); }
  const apply = hasFlag("apply");

  const { data: thr } = await supabase.from("tp_threshold_applications").select("value_after,tier,applied_at").eq("trainingpeaks_athlete_id", id).eq("kind", "pace").neq("tier", "rollback").order("applied_at", { ascending: false }).limit(1);
  const thrMps = thr?.[0]?.value_after as number | undefined; const thrSec = thrMps ? 1000 / thrMps : null;
  const { data: nmRow } = await supabase.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1);
  const name = (nmRow?.[0]?.student_name as string) ?? `id ${id}`;
  if (!thrMps || !thrSec) { console.error(`✗ ${name}: нет реального порога (value_after) — восстановить нечем.`); process.exit(3); }

  // easy anchor (FIT reps=0 continuous 90d)
  const dm: { workout_cache_id: string }[] = []; for (let f = 0; ; f += 1000) { const { data } = await supabase.from("trainingpeaks_workout_derived_metrics").select("workout_cache_id").eq("trainingpeaks_athlete_id", id).eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", daysAgo(90)).lte("workout_date", todayIso()).range(f, f + 999); if (!data || !data.length) break; dm.push(...(data as { workout_cache_id: string }[])); if (data.length < 1000) break; }
  const cids = dm.map((r) => r.workout_cache_id); const ps: number[] = [];
  for (let i = 0; i < cids.length; i += 300) { const { data } = await supabase.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").in("id", cids.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc > 240 && pc < 540) ps.push(pc); } }
  const srt = [...ps].sort((a, b) => a - b); const anchor = srt.length >= 3 ? median(srt.slice(Math.floor(srt.length * 0.3))) : null;

  console.log(`\n=== tp-threshold-restore — ${name} (${id}) · режим ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`реальный порог: ${fp(thrSec)} (${thrMps.toFixed(4)} m/s) · лёгкий якорь: ${anchor ? fp(anchor) : "НЕТ"}`);

  // TODAY and later — NOT "tomorrow and later". A `.gt(today)` here silently skipped today's
  // planned workouts, leaving them on OLD %-targets after a threshold change (a student could run
  // today at the wrong pace). Completed today-workouts are excluded by the is_planned/completed filter.
  const { data: futRows } = await supabase.from("trainingpeaks_workout_cache").select("workout_date, title, trainingpeaks_workout_id, is_planned, completed_time_raw, workout_type_value_id, description:source_snapshot->>description, structure:source_snapshot->structure").eq("trainingpeaks_athlete_id", id).gte("workout_date", todayIso()).order("workout_date");
  const planned = (futRows ?? []).filter((r) => r.is_planned === true && (r.completed_time_raw == null || r.completed_time_raw === 0) && r.workout_type_value_id === 3);
  console.log(`плановых бегов (сегодня и позже): ${planned.length}\n`);

  type Wk = { wid: number; date: string; title: string; desc: string; rc: { isEasy: boolean; plans: Plan[] } };
  const wks: Wk[] = []; let defer = false; const flags: string[] = [];
  for (const w of planned) {
    const desc = typeof w.description === "string" ? w.description : "";
    const rc = recompute(w.structure, desc, w.title ?? "", thrSec, anchor);
    console.log(`── ${w.workout_date} · «${w.title}» (wid ${w.trainingpeaks_workout_id}) ──`);
    if (!rc) { console.log(`   не pace-структура — пропуск (не трогаем)`); continue; }
    if (rc.defer) { defer = true; flags.push(`${w.workout_date} «${w.title}»: ${rc.defer}`); console.log(`   ⚑ ОТЛОЖЕНО (привязка): ${rc.defer}`); continue; }
    for (const p of rc.plans) { const resolved = `${fp(thrSec * 100 / p.newMax)}–${fp(thrSec * 100 / p.newMin)}`; if (!p.ok) { defer = true; flags.push(`${w.workout_date} «${w.title}» ${p.role} ${p.newMin}-${p.newMax}% вне ${p.lo}-${p.hi}%`); } console.log(`   [b${p.block}s${p.step}] ${p.role.padEnd(9)} ${isNaN(p.oldMin) ? "—" : `${p.oldMin}-${p.oldMax}%`} → ${p.newMin}-${p.newMax}%  (@порог ${resolved}, из ${p.src}) [${p.lo}-${p.hi}]${p.ok ? "" : " ⚑ВНЕ ПОЛОСЫ"}`); }
    wks.push({ wid: Number(w.trainingpeaks_workout_id), date: w.workout_date as string, title: (w.title as string) ?? "", desc, rc });
  }
  if (defer) { console.log(`\n✗ АТЛЕТ ОТЛОЖЕН (sanity/привязка):\n  ${flags.join("\n  ")}\nНичего не записано.`); process.exit(4); }
  console.log(`\n✓ все шаги в полосах.`);

  if (!apply) {
    console.log(`\nDRY-RUN. Ничего не записано. Применить после подтверждения диффа:\n  TP_ATHLETE_REAL_WRITE=1 npx tsx tools/trainingpeaks-export/scripts/tp-threshold-restore.ts --athlete=${id} --apply --confirm "RESTORE ${id}"`);
    return;
  }

  // ── APPLY GATE ──
  if (process.env.TP_ATHLETE_REAL_WRITE !== "1" || getFlag("confirm") !== `RESTORE ${id}`) { console.error(`\nREFUSED: need TP_ATHLETE_REAL_WRITE=1 AND --confirm "RESTORE ${id}".`); process.exit(3); }
  const coachId = loadCoachUserId();
  if (coachId === null) { console.error(`\nREFUSED: ${COACH_ID_SETUP_HINT}`); process.exit(3); }

  // ── 5. write EVERY structure first (GET → modify targets → stringify → PUT → verify) ──
  console.log(`\n── ЗАПИСЬ СТРУКТУР (${wks.length}) ──`);
  for (const wk of wks) {
    const live = await getWorkout(id, wk.wid);
    const structObj = live.structure; // GET returns structure as OBJECT
    const fx = flatSteps(structObj);
    if (!fx || fx.steps.length !== wk.rc.plans.length) { console.error(`  ✗ ${wk.title}: живая структура (${fx?.steps.length ?? "?"} шагов) ≠ плану (${wk.rc.plans.length}) — СТОП, порог НЕ ставлю.`); process.exit(2); }
    // apply new targets by (block,step) index onto the live object
    const blocks = isRecord(structObj) && Array.isArray(structObj.structure) ? structObj.structure : [];
    for (const p of wk.rc.plans) {
      const block = blocks[p.block];
      const st = isRecord(block) && Array.isArray(block.steps) ? block.steps[p.step] : null;
      const tg = isRecord(st) && Array.isArray(st.targets) ? st.targets[0] : null;
      if (!isRecord(tg)) { console.error(`  ✗ ${wk.title}: не нашёл шаг b${p.block}s${p.step} в живой структуре — СТОП.`); process.exit(2); }
      (tg as Record<string, unknown>).minValue = p.newMin; (tg as Record<string, unknown>).maxValue = p.newMax;
    }
    const before = { title: live.title, description: live.description, workoutId: live.workoutId, nSteps: fx.steps.length };
    live.structure = JSON.stringify(structObj); // PUT expects structure as STRING
    const res = await authedWriteOnce("PUT", `/fitness/v6/athletes/${id}/workouts/${wk.wid}`, live);
    if (res.status !== 200) { console.error(`  ✗ ${wk.title}: PUT структуры ${res.status} (не 200) — СТОП ВСЕГО ПРОГОНА (путь записи сломан).`); process.exit(5); }
    // verify: FULL structure compare (expected = structObj we just wrote) vs live GET.
    // Any difference besides the deliberately-changed targets (polyline excluded) → STOP.
    const after = await getWorkout(id, wk.wid);
    const diffs: string[] = [];
    deepDiff(structObj, after.structure, "structure", diffs);
    const okMeta = after.workoutId === before.workoutId && after.title === before.title && after.description === before.description;
    if (diffs.length > 0 || !okMeta) {
      console.error(`  ✗ ${wk.title}: ПОЛНАЯ сверка структуры НЕ прошла — СТОП, порог НЕ ставлю. Проверь тренировку в TP.`);
      if (!okMeta) console.error(`     meta изменилось: workoutId ${JSON.stringify(before.workoutId)}→${JSON.stringify(after.workoutId)} / title/description`);
      for (const d of diffs.slice(0, 25)) console.error(`     Δ ${d}`);
      if (diffs.length > 25) console.error(`     … ещё ${diffs.length - 25}`);
      process.exit(2);
    }
    console.log(`  ✅ ${wk.date} «${wk.title}»: структура записана; ПОЛНАЯ сверка до/после чиста (${wk.rc.plans.length} шаг(ов), только намеренные targets; polyline исключён), id/описание целы.`);
  }

  // ── 6. threshold only after ALL structures OK ──
  console.log(`\n── ПОРОГ (после успешной записи всех структур) ──`);
  const settings = await getAthleteSettings(id);
  const plan = planType("speed", settings.speedZones, thrMps, coachId);
  const beforeThr = findWt0Set(settings.speedZones);
  const zres = await authedWriteOnce("PUT", `/fitness/v2/athletes/${id}/speedzones`, plan.newFullArray);
  if (zres.status !== 204) { console.error(`  ✗ порог PUT ${zres.status} (не 204) — СТОП ВСЕГО ПРОГОНА (путь записи сломан). Структуры записаны, порог НЕ применён.`); process.exit(5); }
  const afterSettings = await getAthleteSettings(id);
  const afterWt0 = findWt0Set(afterSettings.speedZones);
  const afterThrMps = afterWt0 && typeof afterWt0.threshold === "number" ? afterWt0.threshold : null;
  const thrOk = afterThrMps !== null && Math.abs(afterThrMps - thrMps) < 1e-6;
  const countOk = Array.isArray(afterSettings.speedZones) && Array.isArray(settings.speedZones) && (afterSettings.speedZones as unknown[]).length === (settings.speedZones as unknown[]).length;
  if (!thrOk || !countOk) { console.error(`  ✗ порог верификация не прошла (порог ${afterThrMps}, ждали ${thrMps}; наборы ${countOk}) — СТОП ВСЕГО ПРОГОНА (204, но значение не подтвердилось).`); process.exit(5); }
  console.log(`  ✅ порог применён: ${beforeThr && typeof beforeThr.threshold === "number" ? fp(1000 / beforeThr.threshold) : "?"} → ${fp(thrSec)} (верифицирован, наборы целы).`);

  // ── 7. anchor sanity: easy step resolves to anchor ±20s ──
  if (anchor) {
    const easyPlan = wks.flatMap((w) => w.rc.plans).find((p) => p.role === "разминка" || p.role === "заминка" || (p.role === "работа" && w_isEasy(wks, p))) ?? wks.flatMap((w) => w.rc.plans)[0];
    if (easyPlan) { const resolvedMid = thrSec * 100 / ((easyPlan.newMin + easyPlan.newMax) / 2); const dEasy = Math.abs(resolvedMid - anchor); console.log(`  проверка якоря: лёгкий шаг @порог ${fp(resolvedMid)} vs якорь ${fp(anchor)} → Δ ${Math.round(dEasy)}с ${dEasy <= 20 ? "✅" : "⚠ >20с"}`); if (dEasy > 20) console.error(`  ⚠ лёгкий шаг разошёлся с якорем >20с — проверь глазами.`); }
  }

  // ── log restore ──
  try {
    const zonesW = pickWhitelistedSettings(afterSettings);
    await supabase.from("tp_zone_snapshots").insert({ trainingpeaks_athlete_id: id, captured_at: new Date().toISOString(), zones: Object.keys(zonesW).length ? zonesW : null, source: "post_restore" });
    await supabase.from("tp_threshold_applications").insert({ trainingpeaks_athlete_id: id, kind: "pace", value_before: beforeThr && typeof beforeThr.threshold === "number" ? beforeThr.threshold : null, value_after: thrMps, value_after_display: formatMpsAsPace(thrMps), evidence: `restore with structure recompute (${wks.length} workouts)`, tier: "restore", applied_by: "tp-threshold-restore" });
    console.log(`  лог восстановления записан (tier=restore).`);
  } catch (e) { console.warn(`  (лог не записан: ${e instanceof Error ? e.message : String(e)})`); }
  console.log(`\n✅ ГОТОВО — ${name}: ${wks.length} структур + порог ${fp(thrSec)}. Проверь глазами в TP. Ops-log отдельно.`);
}
function w_isEasy(wks: { rc: { isEasy: boolean; plans: Plan[] } }[], p: Plan): boolean { return wks.some((w) => w.rc.isEasy && w.rc.plans.includes(p)); }
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
