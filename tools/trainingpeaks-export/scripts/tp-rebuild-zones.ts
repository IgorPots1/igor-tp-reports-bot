/**
 * tp-rebuild-zones — rebuild an athlete's speed ZONE BOUNDARIES around the MEASURED easy anchor
 * (Z1/Z2/Z3), keeping Z4+ on the covered Friel/method scheme from threshold. Fixes the Friel problem
 * where an amateur's real easy pace falls into Z1. THRESHOLDS ARE NEVER CHANGED — only zone boundaries.
 *
 * SCHEMA (per covered scheme, zone count preserved 7=method2 / 5=method8):
 *   Z2 = anchor ± 20с (полоса 40с) · Z1 = [пол, низ Z2] (пол scheme.firstZoneMinRatio×порог)
 *   Z3 = [верх Z2 → граница Z3/Z4 метода] (широкая серая зона) · Z4+ = scheme ratios × threshold
 * ANCHOR (single source, same as recompute): стор ручных якорей (доверенный) → иначе FIT n≥5.
 *   Отношение якорь/порог ∈[1.20,1.38] → персональный; вне → медиана 1.257×порог. СТОР всегда персональный.
 *
 * SAFETY (mirrors tp-fix-run-zone): DRY-RUN by default. APPLY needs --apply + env TP_ATHLETE_REAL_WRITE=1
 *  + --confirm "ZONES <id>". Fresh tp_zone_snapshots BEFORE the write (rollback point). One PUT, no retry,
 *  verify by GET (zones match, thresholds UNCHANGED, set count + zone counts unchanged). RMW the WHOLE
 *  speedZones array: rebuild wt=0 AND wt=3 (if present); wt=1 (and any other) pass through untouched.
 *  REFUSE (fail-closed) on: hold · method not covered · no anchor · non-monotonic zones.
 *
 * Usage:
 *   npx tsx tools/trainingpeaks-export/scripts/tp-rebuild-zones.ts --athlete=5748681
 *   TP_ATHLETE_REAL_WRITE=1 ... --athlete=5748681 --apply --confirm "ZONES 5748681"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toolRoot } from "./lib/paths.ts";
import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { authedWriteOnce, COACH_ID_SETUP_HINT, findActiveHold, findWt0Set, formatMpsAsPace, getSupabase, isRecord, loadCoachUserId } from "./lib/tp-athlete-helpers.ts";
import { pickWhitelistedSettings } from "./lib/tp-settings-whitelist.ts";
import { describeUncovered, getCoveredScheme, type CoveredScheme, type ZoneBoundary } from "./lib/tp-zone-formulas.ts";
import { loadManualAnchors } from "./lib/tp-manual-overrides.ts";
import { median } from "./lib/tp-recompute.ts";
import { buildAnchorZones, chooseAnchor } from "./lib/tp-zone-schema.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
{ const rr = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(rr, ".env.local"), path.join(rr, ".env"), path.join(toolRoot, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p); }

const getFlag = (n: string): string | undefined => { const eq = process.argv.find((a) => a.startsWith(`--${n}=`)); if (eq) return eq.slice(n.length + 3); const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined; };
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);
const fpS = (sec: number | null): string => { if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—"; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`; };
const paceOf = (speed: number): number => (speed > 0 ? 1000 / speed : NaN);
function zoneLabel(minS: number, maxS: number): string { if (minS <= 0) return `${fpS(paceOf(maxS))}+`; if (maxS >= 500) return `<${fpS(paceOf(minS))}`; return `${fpS(paceOf(maxS))}–${fpS(paceOf(minS))}`; }
function asZoneArray(v: unknown): ZoneBoundary[] { if (!Array.isArray(v)) return []; return v.map((z) => { const r = isRecord(z) ? z : {}; return { label: typeof r.label === "string" ? r.label : undefined, minimum: typeof r.minimum === "number" ? r.minimum : 0, maximum: typeof r.maximum === "number" ? r.maximum : 0 }; }); }
function findSet(arr: unknown, typeId: number): Record<string, unknown> | null { if (!Array.isArray(arr)) return null; const s = arr.find((x) => isRecord(x) && x.workoutTypeId === typeId); return isRecord(s) ? s : null; }

/** FIT easy anchor (median of slower-70% of reps=0 continuous runs 90d, excl ~threshold-pace). n<5 → null. */
async function fitAnchor(sb: ReturnType<typeof getSupabase>, id: number, thrSec: number): Promise<number | null> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const dm: { workout_cache_id: string }[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_derived_metrics").select("workout_cache_id").eq("trainingpeaks_athlete_id", id).eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", daysAgo(90)).lte("workout_date", today).range(f, f + 999); if (!data || !data.length) break; dm.push(...(data as { workout_cache_id: string }[])); if (data.length < 1000) break; }
  const cids = dm.map((r) => r.workout_cache_id); const ps: number[] = [];
  for (let i = 0; i < cids.length; i += 300) { const { data } = await sb.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").in("id", cids.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc > thrSec + 30 && pc < 540) ps.push(pc); } }
  const srt = [...ps].sort((a, b) => a - b); return srt.length >= 5 ? median(srt.slice(Math.floor(srt.length * 0.3))) : null;
}

const zonesTable = (old: ZoneBoundary[], neu: ZoneBoundary[]): string => { const n = Math.max(old.length, neu.length); const out: string[] = []; for (let i = 0; i < n; i++) { const o = old[i]; const w = neu[i]; out.push(`  ${(w?.label ?? o?.label ?? `Zone ${i + 1}`).padEnd(9)} ${o ? zoneLabel(o.minimum, o.maximum).padStart(13) : "—"}  →  ${w ? zoneLabel(w.minimum, w.maximum) : "—"}`); } return out.join("\n"); };

async function buildSet(scheme: CoveredScheme, set: Record<string, unknown>, anchorSec: number, coachId: number | null): Promise<{ newSet: Record<string, unknown>; old: ZoneBoundary[]; neu: ZoneBoundary[]; ok: boolean; why?: string }> {
  const thrSpeed = typeof set.threshold === "number" ? set.threshold : NaN;
  const old = asZoneArray(set.zones);
  const b = buildAnchorZones(scheme, thrSpeed, anchorSec, old);
  if (!b.ok) return { newSet: set, old, neu: [], ok: false, why: b.why };
  if (b.zones.length !== old.length) return { newSet: set, old, neu: b.zones, ok: false, why: `число зон ${old.length}→${b.zones.length}` };
  const newSet = { ...set, zones: b.zones, ...(coachId !== null ? { currentUserId: coachId } : {}) }; // threshold UNCHANGED
  return { newSet, old, neu: b.zones, ok: true };
}

async function main(): Promise<void> {
  const id = Number(getFlag("athlete"));
  if (!Number.isInteger(id)) { console.error("need --athlete=<id>"); process.exit(2); }
  const apply = hasFlag("apply");
  const coachId = loadCoachUserId();
  const sb = getSupabase();

  const settings = await getAthleteSettings(id);
  const arr = settings.speedZones;
  const wt0 = findWt0Set(arr);
  if (!wt0 || typeof wt0.threshold !== "number") { console.error(`✗ ${id}: нет набора wt=0 с порогом.`); process.exit(3); }
  const thrSec0 = 1000 / wt0.threshold;
  const method0 = typeof wt0.calculationMethod === "number" ? wt0.calculationMethod : NaN;
  const scheme0 = getCoveredScheme("speed", method0);
  if (!scheme0) { console.error(`✗ wt=0 метод не покрыт: ${describeUncovered("speed", method0)} — ОТКАЗ.`); process.exit(3); }

  // anchor: STORE (trusted) → else FIT n≥5
  const manual = await loadManualAnchors(sb);
  const fromStore = manual.has(id);
  const rawAnchor = fromStore ? manual.get(id)! : await fitAnchor(sb, id, thrSec0);
  if (!rawAnchor) { console.error(`✗ ${id}: нет якоря (ни в сторе, ни FIT n≥5) — не трогаем зоны.`); process.exit(3); }
  const { anchorSec, mode, ratio } = chooseAnchor(fromStore, rawAnchor, thrSec0);
  const modeLabel = mode === "store" ? "СТОР(ручной)" : mode === "personal" ? "персональный(FIT)" : `вне полосы → медиана ${fpS(anchorSec)}`;

  console.log(`\n=== tp-rebuild-zones — атлет ${id} · режим ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`порог wt=0 ${fpS(thrSec0)} (НЕ трогаем) · method ${method0} · якорь ${fpS(rawAnchor)} (отн ${ratio.toFixed(2)}) → ${modeLabel}`);

  // build wt=0 (+ wt=3 if present). Others (wt=1) untouched.
  const b0 = await buildSet(scheme0, wt0, anchorSec, coachId);
  if (!b0.ok) { console.error(`✗ wt=0: ${b0.why} — ОТКАЗ (fail-closed).`); process.exit(3); }
  console.log(`\nЗОНЫ wt=0 (мин/км, СЕЙЧАС → НОВОЕ):\n${zonesTable(b0.old, b0.neu)}`);

  const wt3 = findSet(arr, 3);
  let b3: Awaited<ReturnType<typeof buildSet>> | null = null;
  if (wt3) {
    const method3 = typeof wt3.calculationMethod === "number" ? wt3.calculationMethod : NaN;
    const scheme3 = getCoveredScheme("speed", method3);
    if (!scheme3) { console.error(`✗ wt=3 метод не покрыт: ${describeUncovered("speed", method3)} — ОТКАЗ (пишем оба набора или никакой).`); process.exit(3); }
    b3 = await buildSet(scheme3, wt3, anchorSec, coachId);
    if (!b3.ok) { console.error(`✗ wt=3: ${b3.why} — ОТКАЗ.`); process.exit(3); }
    console.log(`\nЗОНЫ wt=3 (мин/км, СЕЙЧАС → НОВОЕ; порог wt=3 ${fpS(1000 / (typeof wt3.threshold === "number" ? wt3.threshold : NaN))} не трогаем):\n${zonesTable(b3.old, b3.neu)}`);
  } else console.log(`\n(бегового набора wt=3 нет — только wt=0)`);

  // RMW whole array: rebuild wt0/wt3 zones, others pass through (currentUserId on every set per recipe)
  const newFullArray = (arr as unknown[]).map((s) => {
    if (isRecord(s) && s.workoutTypeId === 0) return b0.newSet;
    if (isRecord(s) && s.workoutTypeId === 3 && b3) return b3.newSet;
    return isRecord(s) && coachId !== null ? { ...s, currentUserId: coachId } : s;
  });
  console.log(`\nPUT /fitness/v2/athletes/${id}/speedzones (полная замена; пороги и wt=1 сохранены, меняются только границы wt=0${wt3 ? "/wt=3" : ""})`);

  if (!apply) { console.log(`\nDRY-RUN. Ничего не записано. Применить:\n  TP_ATHLETE_REAL_WRITE=1 npx tsx tools/trainingpeaks-export/scripts/tp-rebuild-zones.ts --athlete=${id} --apply --confirm "ZONES ${id}"`); return; }

  // ── APPLY GATE (three locks) ──
  if (process.env.TP_ATHLETE_REAL_WRITE !== "1" || getFlag("confirm") !== `ZONES ${id}`) { console.error(`\nREFUSED: need TP_ATHLETE_REAL_WRITE=1 AND --confirm "ZONES ${id}".`); process.exit(3); }
  if (coachId === null) { console.error(`\nREFUSED: ${COACH_ID_SETUP_HINT}`); process.exit(3); }
  const hold = await findActiveHold(sb, id);
  if (hold) { console.error(`\n✗ атлет ${id} на РУЧНОМ УДЕРЖАНИИ (${hold.reason}${hold.heldBy ? `, ${hold.heldBy}` : ""}) — зоны НЕ трогаю. Ничего не записано.`); process.exit(3); }

  // SNAPSHOT current zones BEFORE the write (rollback point)
  try { const zonesW = pickWhitelistedSettings(settings); await sb.from("tp_zone_snapshots").insert({ trainingpeaks_athlete_id: id, captured_at: new Date().toISOString(), zones: Object.keys(zonesW).length ? zonesW : null, source: "pre_zone_rebuild" }); console.log(`\nснапшот ДО записи снят (source=pre_zone_rebuild).`); } catch (e) { console.error(`✗ снапшот ДО записи не снят (${e instanceof Error ? e.message : String(e)}) — ОТКАЗ, не пишу без точки отката.`); process.exit(3); }

  const beforeCount = (arr as unknown[]).length;
  const res = await authedWriteOnce("PUT", `/fitness/v2/athletes/${id}/speedzones`, newFullArray);
  console.log(`PUT status: ${res.status}`);
  if (res.status !== 204) { console.error(`✗ не 204 — СТОП, не ретраю.`); process.exit(5); }

  // VERIFY: zones match, thresholds UNCHANGED, set count + zone counts unchanged
  const after = await getAthleteSettings(id);
  const aArr = after.speedZones; const aCount = Array.isArray(aArr) ? (aArr as unknown[]).length : 0;
  const a0 = findWt0Set(aArr); const a3 = findSet(aArr, 3);
  const eq = (x: number | undefined, y: number | undefined) => x !== undefined && y !== undefined && Math.abs(x - y) < 1e-6;
  const zonesMatch = (want: ZoneBoundary[], got: unknown): boolean => { const g = asZoneArray(got); if (g.length !== want.length) return false; return want.every((z, i) => eq(z.minimum, g[i].minimum) && eq(z.maximum, g[i].maximum)); };
  const thr0ok = a0 && eq(a0.threshold as number, wt0.threshold as number);
  const z0ok = a0 && zonesMatch(b0.neu, a0.zones);
  const thr3ok = !wt3 || (a3 && eq(a3.threshold as number, wt3.threshold as number));
  const z3ok = !wt3 || (a3 && b3 && zonesMatch(b3.neu, a3.zones));
  const countOk = aCount === beforeCount;
  console.log(`ВЕРИФИКАЦИЯ: wt0 порог ${thr0ok ? "✅ цел" : "❌ ИЗМЕНИЛСЯ"} · wt0 зоны ${z0ok ? "✅" : "❌"} · ${wt3 ? `wt3 порог ${thr3ok ? "✅ цел" : "❌"} · wt3 зоны ${z3ok ? "✅" : "❌"} · ` : ""}наборов ${beforeCount}→${aCount} ${countOk ? "✅" : "❌"}`);
  if (!thr0ok || !z0ok || !thr3ok || !z3ok || !countOk) { console.error(`✗ верификация не прошла — проверь в TP (снапшот ДО есть для отката).`); process.exit(5); }

  // LOG the rebuild event (tier=zones; threshold value unchanged, so value_before==value_after)
  try { await sb.from("tp_threshold_applications").insert({ trainingpeaks_athlete_id: id, kind: "pace", value_before: wt0.threshold, value_after: wt0.threshold, value_after_display: formatMpsAsPace(wt0.threshold as number), evidence: `zones rebuild anchor ${fpS(anchorSec)} (${mode}, ratio ${ratio.toFixed(2)}), wt0${wt3 ? "+wt3" : ""}, method ${method0}`, tier: "zones", applied_by: "tp-rebuild-zones" }); console.log(`лог записан (tier=zones).`); } catch (e) { console.warn(`(лог не записан: ${e instanceof Error ? e.message : String(e)})`); }
  console.log(`\n✅ ГОТОВО — атлет ${id}: зоны перестроены вокруг якоря ${fpS(anchorSec)} (пороги целы). Проверь зоны в TP.`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
