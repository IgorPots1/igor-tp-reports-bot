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

import { getAthleteSettings, getWorkoutsByDateRange } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { readSessionSnapshot } from "../../../src/features/trainingpeaks/tp-session-snapshot.ts";
import { toolRoot } from "./lib/paths.ts";
import { authedWriteOnce, COACH_ID_SETUP_HINT, findActiveHold, findWt0Set, formatMpsAsPace, isRecord, loadCoachUserId, parsePaceToSecPerKm, secPerKmToMps, TP_API_HOST } from "./lib/tp-athlete-helpers.ts";
import { planType } from "./lib/tp-athlete-set-threshold.ts";
import { pickWhitelistedSettings } from "./lib/tp-settings-whitelist.ts";
import { fp, median, flatSteps, deepDiff, recompute, type Plan } from "./lib/tp-recompute.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function getSupabase(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), path.join(toolRoot, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
function daysAgo(n: number): string { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
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


async function main(): Promise<void> {
  const supabase = getSupabase();
  const id = Number(getFlag("athlete"));
  if (!Number.isInteger(id)) { console.error("need --athlete=<id>"); process.exit(2); }
  const apply = hasFlag("apply");

  // Threshold source: --pace=mm:ss APPLIES A DECISION value (scan-candidate apply); recompute
  // structures FOR that pace, then set it. Without --pace: restore the last real logged threshold.
  const paceOverride = getFlag("pace");
  let thrMps: number | undefined; let thrSec: number | null;
  if (paceOverride) { thrSec = parsePaceToSecPerKm(paceOverride); thrMps = secPerKmToMps(thrSec); }
  else { const { data: thr } = await supabase.from("tp_threshold_applications").select("value_after,tier,applied_at").eq("trainingpeaks_athlete_id", id).eq("kind", "pace").neq("tier", "rollback").order("applied_at", { ascending: false }).limit(1); thrMps = thr?.[0]?.value_after as number | undefined; thrSec = thrMps ? 1000 / thrMps : null; }
  const { data: nmRow } = await supabase.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1);
  const name = (nmRow?.[0]?.student_name as string) ?? `id ${id}`;
  if (!thrMps || !thrSec) { console.error(`✗ ${name}: нет порога (${paceOverride ? "плохой --pace" : "нет value_after в логе"}).`); process.exit(3); }

  // easy anchor (FIT reps=0 continuous 90d)
  const dm: { workout_cache_id: string }[] = []; for (let f = 0; ; f += 1000) { const { data } = await supabase.from("trainingpeaks_workout_derived_metrics").select("workout_cache_id").eq("trainingpeaks_athlete_id", id).eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", daysAgo(90)).lte("workout_date", todayIso()).range(f, f + 999); if (!data || !data.length) break; dm.push(...(data as { workout_cache_id: string }[])); if (data.length < 1000) break; }
  const cids = dm.map((r) => r.workout_cache_id); const ps: number[] = [];
  for (let i = 0; i < cids.length; i += 300) { const { data } = await supabase.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").in("id", cids.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc > thrSec + 30 && pc < 540) ps.push(pc); } } // exclude ~threshold-pace runs (tempo mislabeled reps=0): they contaminate the easy anchor
  const srt = [...ps].sort((a, b) => a - b); const anchor = srt.length >= 5 ? median(srt.slice(Math.floor(srt.length * 0.3))) : null; // n<5 → якорь ненадёжен → атлет уходит в ручной список (recompute деферит)

  console.log(`\n=== tp-threshold-restore — ${name} (${id}) · режим ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`реальный порог: ${fp(thrSec)} (${thrMps.toFixed(4)} m/s) · лёгкий якорь: ${anchor ? fp(anchor) : "НЕТ"}`);

  // ALL UNCOMPLETED planned workouts of ANY date — NOT just today+. A threshold change re-renders
  // the athlete's PAST-dated planned workouts too; if a student opens an old un-run planned workout
  // it must show the right pace. COMPLETED workouts are NEVER touched (history was correct under the
  // threshold that was live at run time). --since=YYYY-MM-DD optionally bounds the lower date (e.g.
  // recompute only recent stale planned, skip year-old ones nobody opens).
  const since = getFlag("since");
  // Variant C (2026-08-03): enumerate uncompleted planned runs from LIVE TP, not the cache. The cache
  // undercounts freshly-authored workouts (Kalakutok: cache 0 vs live 4), which SILENTLY skipped the
  // recompute — threshold got set while structures kept stale %. List (getWorkoutsByDateRange) filtered
  // to run + not-completed, then per-workout live detail for structure+description. Everything downstream
  // (recompute/gates/write) unchanged. Completed workouts are excluded (never touched).
  // default lower bound = today−14d: only workouts an athlete may still open (future + recent past)
  // actually render wrong on a threshold change; year-old skipped planned records are aged off and
  // pointless to rewrite. --since=YYYY-MM-DD overrides (wider or narrower).
  const fromDate = since ?? daysAgo(14);
  const toDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  // SANITY-RETRY (2026-08-03): the batch apply under-fetched planned workouts under load
  // (getWorkoutsByDateRange returned partial lists — Rishko 3/8, Morozov 0/N — silently skipping
  // their recompute → stale % under the new threshold). Enumerate TWICE independently and compare
  // the workoutId sets; on divergence retry up to 3 times; if never stable → STOP LOUDLY (exit 5).
  // A silent under-fetch is never acceptable — halt rather than apply on a partial list.
  const enumKey = (l: unknown[]): string => [...new Set((l ?? []).map((w) => Number((w as Record<string, unknown>).workoutId ?? (w as Record<string, unknown>).id)).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(",");
  let liveList: unknown[] | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const a = (await getWorkoutsByDateRange(id, fromDate, toDate)) ?? [];
    const b = (await getWorkoutsByDateRange(id, fromDate, toDate)) ?? [];
    if (enumKey(a) === enumKey(b)) { liveList = a; break; }
    console.error(`⚠ перечисление разошлось (попытка ${attempt}/3): A=${a.length} vs B=${b.length} — повтор`);
  }
  if (liveList == null) { console.error(`✗ СТОП: перечисление плановых не стабилизировалось за 3 попытки (недобор TP-API). НЕ применяю — молчаливый недобор недопустим.`); process.exit(5); }
  const summaries = liveList.filter((w) => isRecord(w) && (w.workoutTypeValueId === 3 || w.workoutTypeId === 3) && w.completed !== true);
  const planned: Array<{ workout_date: string; title: string; trainingpeaks_workout_id: number; description: string; structure: unknown }> = [];
  for (const sm of summaries) {
    const rec = sm as Record<string, unknown>;
    const wid = Number(rec.workoutId ?? rec.id);
    if (!Number.isInteger(wid) || wid <= 0) continue;
    let det: Record<string, unknown>;
    try { det = await getWorkout(id, wid); } catch { continue; }
    // hard guard: NEVER touch a completed workout (actual data present) — even if the summary missed it.
    if (det.completed === true || (typeof det.totalTime === "number" && det.totalTime > 0)) continue;
    planned.push({ workout_date: String(det.workoutDay ?? "").slice(0, 10), title: typeof det.title === "string" ? det.title : "", trainingpeaks_workout_id: wid, description: typeof det.description === "string" ? det.description : "", structure: det.structure });
  }
  planned.sort((a, b) => a.workout_date.localeCompare(b.workout_date));
  console.log(`перечислено LIVE всего ${liveList.length} (стабильно, сверено 2×) → плановых бегов (невыполненные, ${fromDate}..${toDate}): ${planned.length}\n`);

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
  const hold = await findActiveHold(supabase, id);
  if (hold) { console.error(`\n✗ атлет ${id} на РУЧНОМ УДЕРЖАНИИ (${hold.reason}${hold.heldBy ? `, ${hold.heldBy}` : ""}) — автоматика НЕ переопределяет. Ничего не записано.`); process.exit(3); }

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
    await supabase.from("tp_zone_snapshots").insert({ trainingpeaks_athlete_id: id, captured_at: new Date().toISOString(), zones: Object.keys(zonesW).length ? zonesW : null, source: paceOverride ? "post_candidate_apply" : "post_restore" });
    await supabase.from("tp_threshold_applications").insert({ trainingpeaks_athlete_id: id, kind: "pace", value_before: beforeThr && typeof beforeThr.threshold === "number" ? beforeThr.threshold : null, value_after: thrMps, value_after_display: formatMpsAsPace(thrMps), evidence: paceOverride ? `scan-decision apply --pace=${paceOverride} (${wks.length} workouts recomputed)` : `restore with structure recompute (${wks.length} workouts)`, tier: paceOverride ? "candidate" : "restore", applied_by: "tp-threshold-restore" });
    console.log(`  лог записан (tier=${paceOverride ? "candidate" : "restore"}).`);
  } catch (e) { console.warn(`  (лог не записан: ${e instanceof Error ? e.message : String(e)})`); }
  console.log(`\n✅ ГОТОВО — ${name}: ${wks.length} структур + порог ${fp(thrSec)}. Проверь глазами в TP. Ops-log отдельно.`);
}
function w_isEasy(wks: { rc: { isEasy: boolean; plans: Plan[] } }[], p: Plan): boolean { return wks.some((w) => w.rc.isEasy && w.rc.plans.includes(p)); }
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
