/**
 * tp-fix-run-zone — align the RUN speed-zone set (workoutTypeId=3) to the athlete's default
 * (workoutTypeId=0) pace threshold. TrainingPeaks renders RUN workout cards against the wt=3 set;
 * the threshold tools only ever set wt=0, so athletes who HAVE a wt=3 set show stale run paces.
 * This sets wt=3.threshold = wt=0.threshold (RMW of the whole array; wt=0 and wt=1 pass through
 * unchanged), recomputes the wt=3 zones with the SAME covered scheme as planType, and verifies.
 *
 * SAFETY (mirrors tp-athlete): DRY-RUN by default. APPLY needs --apply + env TP_ATHLETE_REAL_WRITE=1
 *  + --confirm "RUNZONE <athleteId>". One PUT, no retry, verify by GET. If the wt=3 calculation
 *  method is not covered by a verified scheme → REFUSE (never guess zone ratios). If there is no
 *  wt=3 set → nothing to do.
 *
 * Usage:
 *   npx tsx tools/trainingpeaks-export/scripts/tp-fix-run-zone.ts --athlete=5807145
 *   TP_ATHLETE_REAL_WRITE=1 ... --athlete=5807145 --apply --confirm "RUNZONE 5807145"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toolRoot } from "./lib/paths.ts";
import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { authedWriteOnce, COACH_ID_SETUP_HINT, findActiveHold, findWt0Set, formatMpsAsPace, getSupabase, isRecord, loadCoachUserId, parsePaceToSecPerKm, secPerKmToMps } from "./lib/tp-athlete-helpers.ts";
import { pickWhitelistedSettings } from "./lib/tp-settings-whitelist.ts";
import { describeUncovered, getCoveredScheme, recomputeZones, ZoneShapeMismatchError, type ZoneBoundary } from "./lib/tp-zone-formulas.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
{ const rr = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(rr, ".env.local"), path.join(rr, ".env"), path.join(toolRoot, ".env")]) loadEnv(p); }

const getFlag = (n: string): string | undefined => { const eq = process.argv.find((a) => a.startsWith(`--${n}=`)); if (eq) return eq.slice(n.length + 3); const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined; };
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);
const fp = (mps: number | null): string => (mps && mps > 0 ? formatMpsAsPace(mps) : "—");
function asZoneArray(v: unknown): ZoneBoundary[] { if (!Array.isArray(v)) return []; return v.map((z) => { const r = isRecord(z) ? z : {}; return { label: typeof r.label === "string" ? r.label : undefined, minimum: typeof r.minimum === "number" ? r.minimum : 0, maximum: typeof r.maximum === "number" ? r.maximum : 0 }; }); }
function findSet(arr: unknown, typeId: number): Record<string, unknown> | null { if (!Array.isArray(arr)) return null; const s = arr.find((x) => isRecord(x) && x.workoutTypeId === typeId); return isRecord(s) ? s : null; }

async function main(): Promise<void> {
  const id = Number(getFlag("athlete"));
  if (!Number.isInteger(id)) { console.error("need --athlete=<id>"); process.exit(2); }
  const apply = hasFlag("apply");
  const coachId = loadCoachUserId();

  const settings = await getAthleteSettings(id);
  const arr = settings.speedZones;
  const wt0 = findWt0Set(arr);
  if (!wt0 || typeof wt0.threshold !== "number") { console.error(`✗ ${id}: нет набора workoutTypeId=0 с порогом — нечего выравнивать по.`); process.exit(3); }
  const wt0Orig = wt0.threshold; // wt=0 (default) is NEVER changed here — verified untouched below
  // Default aligns wt=3 to wt=0. --run-pace=<mm:ss> instead sets wt=3 to an EXPLICIT pace — used
  // to REVERT a run set to the value the athlete's (un-recomputed) structures were authored for.
  const runPaceOverride = getFlag("run-pace");
  const target = runPaceOverride ? secPerKmToMps(parsePaceToSecPerKm(runPaceOverride)) : wt0Orig;
  const wt3 = findSet(arr, 3);

  console.log(`\n=== tp-fix-run-zone — атлет ${id} · режим ${apply ? "APPLY" : "DRY-RUN"}${runPaceOverride ? ` · РУЧНОЙ wt=3=${runPaceOverride}` : ""} ===`);
  console.log(`default(wt=0) порог: ${fp(wt0Orig)} (не трогаем)${runPaceOverride ? ` · целевой wt=3: ${fp(target)}` : ""}`);
  if (!wt3) { console.log(`бегового набора (wt=3) НЕТ — беговые карточки и так рендерятся от wt=0. Делать нечего.`); return; }
  const oldThr3 = typeof wt3.threshold === "number" ? wt3.threshold : null;
  console.log(`RUN(wt=3) порог сейчас: ${fp(oldThr3)}  →  станет ${fp(target)}`);
  if (oldThr3 !== null && Math.abs(oldThr3 - target) < 1e-6) { console.log(`уже совпадает — делать нечего.`); return; }

  const method3 = typeof wt3.calculationMethod === "number" ? wt3.calculationMethod : NaN;
  const scheme = getCoveredScheme("speed", method3);
  if (!scheme) { console.error(`✗ wt=3 метод не покрыт: ${describeUncovered("speed", method3)} — ОТКАЗ (не гадаю зоны).`); process.exit(3); }
  const oldZones3 = asZoneArray(wt3.zones);
  let recomputed;
  try { recomputed = recomputeZones(scheme, oldZones3, target); } catch (e) { if (e instanceof ZoneShapeMismatchError) { console.error(`✗ wt=3 зоны: ${e.message} — ОТКАЗ.`); process.exit(3); } throw e; }

  // RMW: change ONLY the wt=3 set (threshold + zones); wt=0 and wt=1 pass through
  // (currentUserId added on every set, as the proven RMW recipe requires).
  const newWt3: Record<string, unknown> = { ...wt3, threshold: target, zones: recomputed.zones, ...(coachId !== null ? { currentUserId: coachId } : {}) };
  const newFullArray = (arr as unknown[]).map((s) => (isRecord(s) && s.workoutTypeId === 3 ? newWt3 : isRecord(s) && coachId !== null ? { ...s, currentUserId: coachId } : s));

  console.log(`\nзоны wt=3 (min–max), пересчёт по методу ${method3}:`);
  const n = Math.max(oldZones3.length, recomputed.zones.length);
  for (let i = 0; i < n; i += 1) { const o = oldZones3[i]; const w = recomputed.zones[i]; const lbl = w?.label ?? o?.label ?? `Zone ${i + 1}`; console.log(`  ${lbl.padEnd(16)} ${o ? `${o.minimum.toFixed(3)}–${o.maximum.toFixed(3)}` : "—"} → ${w ? `${w.minimum.toFixed(3)}–${w.maximum.toFixed(3)}` : "—"}`); }
  console.log(`\nPUT /fitness/v2/athletes/${id}/speedzones (полная замена; wt=0/wt=1 сохранены, меняется только wt=3)`);

  if (!apply) { console.log(`\nDRY-RUN. Ничего не записано. Применить:\n  TP_ATHLETE_REAL_WRITE=1 npx tsx tools/trainingpeaks-export/scripts/tp-fix-run-zone.ts --athlete=${id} --apply --confirm "RUNZONE ${id}"`); return; }

  if (process.env.TP_ATHLETE_REAL_WRITE !== "1" || getFlag("confirm") !== `RUNZONE ${id}`) { console.error(`\nREFUSED: need TP_ATHLETE_REAL_WRITE=1 AND --confirm "RUNZONE ${id}".`); process.exit(3); }
  if (coachId === null) { console.error(`\nREFUSED: ${COACH_ID_SETUP_HINT}`); process.exit(3); }
  const hold = await findActiveHold(getSupabase(), id);
  if (hold) { console.error(`\n✗ атлет ${id} на РУЧНОМ УДЕРЖАНИИ (${hold.reason}${hold.heldBy ? `, ${hold.heldBy}` : ""}) — автоматика НЕ переопределяет зоны. Ничего не записано.`); process.exit(3); }

  const beforeCount = (arr as unknown[]).length;
  const res = await authedWriteOnce("PUT", `/fitness/v2/athletes/${id}/speedzones`, newFullArray);
  console.log(`\nPUT status: ${res.status}`);
  if (res.status !== 204) { console.error(`✗ не 204 — СТОП, не ретраю.`); process.exit(5); }

  // verify: wt=3 now == target, wt=0 UNCHANGED, count unchanged, both sets converged
  const after = await getAthleteSettings(id);
  const a0 = findWt0Set(after.speedZones); const a3 = findSet(after.speedZones, 3);
  const aCount = Array.isArray(after.speedZones) ? (after.speedZones as unknown[]).length : 0;
  const t0 = a0 && typeof a0.threshold === "number" ? a0.threshold : null;
  const t3 = a3 && typeof a3.threshold === "number" ? a3.threshold : null;
  const wt3ok = t3 !== null && Math.abs(t3 - target) < 1e-6;
  const wt0ok = t0 !== null && Math.abs(t0 - wt0Orig) < 1e-6; // wt0 must be UNCHANGED (never touched here)
  const countOk = aCount === beforeCount;
  const converged = runPaceOverride ? "n/a (ручной wt=3)" : wt3ok && wt0ok && Math.abs((t3 ?? 0) - (t0 ?? 1)) < 1e-6 ? "✅" : "❌";
  console.log(`ВЕРИФИКАЦИЯ: wt=3 ${wt3ok ? "✅ = " + fp(t3) : `❌ ${fp(t3)}`} · wt=0 ${wt0ok ? "✅ цел " + fp(t0) : `❌ ИЗМЕНИЛСЯ ${fp(t0)}`} · наборов ${beforeCount}→${aCount} ${countOk ? "✅" : "❌"} · сошлись ${converged}`);
  if (!wt3ok || !wt0ok || !countOk) { console.error(`✗ верификация не прошла — проверь в TP.`); process.exit(5); }

  // snapshot the post-fix state (append-only); NOT a threshold-applications row — threshold value unchanged.
  try { const supabase = getSupabase(); const zonesW = pickWhitelistedSettings(after); await supabase.from("tp_zone_snapshots").insert({ trainingpeaks_athlete_id: id, captured_at: new Date().toISOString(), zones: Object.keys(zonesW).length ? zonesW : null, source: "run_zone_align" }); console.log(`снапшот post-fix записан (source=run_zone_align).`); } catch (e) { console.warn(`(снапшот не записан: ${e instanceof Error ? e.message : String(e)})`); }
  console.log(`\n✅ ГОТОВО — атлет ${id}: беговой набор wt=3 выровнен на ${fp(target)}. Проверь карточку в TP.`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
