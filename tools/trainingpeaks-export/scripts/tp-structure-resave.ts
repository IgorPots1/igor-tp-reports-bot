/**
 * tp-structure-resave — force TP to recompute a workout's derived planned pace
 * (velocityPlanned/ifPlanned/tssPlanned) under the CURRENT threshold, by re-saving the
 * SAME structure. Targets are NOT touched — we GET the live workout, re-stringify its own
 * structure, PUT the whole object back, then GET and verify velocityPlanned now resolves
 * under the current threshold.
 *
 * WHY: tp-threshold-restore writes the structure BEFORE the threshold, so TP snapshotted the
 * derived pace under the OLD threshold. The step %-targets are correct, but velocityPlanned can
 * stay stale (observed on Семешина, Kruglova).
 *
 * FINDING (2026-07-30, verified on live TP): an IDENTICAL re-PUT does NOT trigger recompute.
 * TP only recomputes velocityPlanned on a REAL value change — neither a same-structure PUT nor a
 * same-value threshold PUT refreshes it. So --apply here is effectively a no-op VERIFIER: it PUTs
 * the unchanged structure and STOPS if a stale workout stays stale (which it will). DRY-RUN is the
 * useful mode — a stale-velP auditor. Actually refreshing a stale velP needs a change-and-revert
 * (a transient wrong threshold/target), which is a separate, explicitly-gated decision.
 *
 * SAFETY (mirrors tp-athlete):
 *  - DRY-RUN by default. APPLY needs --apply + env TP_ATHLETE_REAL_WRITE=1 + --confirm "RESAVE".
 *  - Recipe is GET → re-stringify the SAME structure → PUT whole object → GET → verify. The
 *    structure must round-trip byte-identical (deepDiff clean, polyline excluded); ANY change
 *    besides polyline, or a PUT status ≠200, STOPS the whole run.
 *  - After the write, velocityPlanned must resolve (as pace) to within ±15s of the expected
 *    duration-weighted pace under the CURRENT threshold. A was-stale workout that stays stale,
 *    or a was-fresh one that goes off, STOPS the whole run (the fix isn't working — don't go on).
 *  - Idempotent: safe to run repeatedly; targets never change.
 *
 * EXIT: 0 all ok · 2 nothing to do · 5 STOP (structure corrupted / PUT≠200 / recompute failed).
 *
 * Usage:
 *   npx tsx tools/trainingpeaks-export/scripts/tp-structure-resave.ts --athletes=5807145,5928404
 *   TP_ATHLETE_REAL_WRITE=1 ... --athletes=... --apply --confirm "RESAVE"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { readSessionSnapshot } from "../../../src/features/trainingpeaks/tp-session-snapshot.ts";
import { toolRoot } from "./lib/paths.ts";
import { authedWriteOnce, findWt0Set, isRecord, TP_API_HOST } from "./lib/tp-athlete-helpers.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function getSupabase(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), path.join(toolRoot, ".env")]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const fp = (sec: number | null): string => { if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—"; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`; };
const paceOf = (mps: number | null): number | null => (mps && mps > 0 ? 1000 / mps : null);
function getFlag(name: string): string | undefined { const eq = process.argv.find((a) => a.startsWith(`--${name}=`)); if (eq) return eq.slice(name.length + 3); const i = process.argv.indexOf(`--${name}`); return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined; }
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

async function getBearer(): Promise<string> {
  const snap = await readSessionSnapshot();
  const res = await fetch(`${TP_API_HOST}/users/v3/token`, { headers: { accept: "application/json", Cookie: `Production_tpAuth=${snap.cookieValue}` } });
  if (!res.ok) throw new Error(`token exchange HTTP ${res.status}`);
  const body: unknown = await res.json();
  const token = isRecord(body) && isRecord(body.token) ? body.token.access_token : null;
  if (typeof token !== "string" || !token) throw new Error("no access_token");
  return token;
}
async function getWorkout(athleteId: number, workoutId: number, bearer: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${TP_API_HOST}/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`, { headers: { accept: "application/json", authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GET workout ${workoutId} HTTP ${res.status}`);
  const o = await res.json();
  if (!isRecord(o)) throw new Error(`GET workout ${workoutId} not an object`);
  return o;
}
/** Deep structural diff (order-insensitive on objects, by-index on arrays); polyline excluded. */
function deepDiff(a: unknown, b: unknown, p: string, out: string[]): void {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) { out.push(`${p}.length ${a.length}→${b.length}`); return; } for (let i = 0; i < a.length; i++) deepDiff(a[i], b[i], `${p}[${i}]`, out); return; }
  if (isRecord(a) && isRecord(b)) { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of keys) { if (k === "polyline") continue; deepDiff(a[k], b[k], p ? `${p}.${k}` : k, out); } return; }
  out.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
/** duration-weighted average %-target of a structure OBJECT, under threshold thrMps (m/s). */
function expectedPace(structObj: unknown, thrMps: number): number | null {
  if (!isRecord(structObj) || !Array.isArray(structObj.structure)) return null;
  let sumWP = 0, sumW = 0;
  for (const block of structObj.structure) {
    if (!isRecord(block) || !Array.isArray(block.steps)) continue;
    const reps = isRecord(block.length) && typeof block.length.value === "number" ? block.length.value : 1;
    for (const st of block.steps) {
      if (!isRecord(st)) continue;
      const tg = Array.isArray(st.targets) && st.targets.length && isRecord(st.targets[0]) ? st.targets[0] : null;
      const mn = tg && typeof tg.minValue === "number" ? tg.minValue : NaN;
      const mx = tg && typeof tg.maxValue === "number" ? tg.maxValue : NaN;
      const mid = Number.isNaN(mn) ? mx : Number.isNaN(mx) ? mn : (mn + mx) / 2;
      if (!Number.isFinite(mid) || mid <= 0) continue;
      const len = isRecord(st.length) ? st.length : null;
      const unit = len ? String(len.unit ?? "") : "";
      const val = len && typeof len.value === "number" ? len.value : 0;
      const velAtPct = (mid / 100) * thrMps; // m/s at this %
      const durSec = unit === "second" ? val : (unit === "meter" && velAtPct > 0 ? val / velAtPct : 0);
      const w = reps * durSec;
      if (w <= 0) continue;
      sumWP += w * mid; sumW += w;
    }
  }
  if (sumW <= 0) return null;
  const avgPct = sumWP / sumW;
  const velP = (avgPct / 100) * thrMps;
  return velP > 0 ? 1000 / velP : null;
}

type Row = { id: number; name: string; date: string; title: string; wid: number; velBefore: number | null; velAfter: number | null; expPace: number | null; wasStale: boolean; status: string };

async function main(): Promise<void> {
  const supabase = getSupabase();
  const ids = (getFlag("athletes") ?? "").split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
  if (!ids.length) { console.error('need --athletes=<id,id,...>'); process.exit(2); }
  const apply = hasFlag("apply");
  if (apply && (process.env.TP_ATHLETE_REAL_WRITE !== "1" || getFlag("confirm") !== "RESAVE")) { console.error('REFUSED: apply needs TP_ATHLETE_REAL_WRITE=1 AND --confirm "RESAVE".'); process.exit(3); }
  const TOL = 15; // seconds tolerance for velocityPlanned vs expected
  const STALE = 25; // seconds: "before" pace this far from expected = was stale

  console.log(`=== tp-structure-resave · ${apply ? "APPLY" : "DRY-RUN"} · ${ids.length} athlete(s) ===`);
  const bearer = await getBearer();
  const rows: Row[] = [];
  let staleBefore = 0, freshAfter = 0, stillWrong = 0;

  for (const id of ids) {
    const settings = await getAthleteSettings(id);
    const wt0 = findWt0Set(settings.speedZones);
    const thrMps = wt0 && typeof wt0.threshold === "number" ? wt0.threshold : NaN;
    const { data: nmRow } = await supabase.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1);
    const name = (nmRow?.[0]?.student_name as string) ?? `id ${id}`;
    const { data: futRows } = await supabase.from("trainingpeaks_workout_cache").select("workout_date, title, trainingpeaks_workout_id, is_planned, completed_time_raw, workout_type_value_id").eq("trainingpeaks_athlete_id", id).gt("workout_date", todayIso()).order("workout_date");
    const planned = (futRows ?? []).filter((r) => r.is_planned === true && (r.completed_time_raw == null || r.completed_time_raw === 0) && r.workout_type_value_id === 3);
    console.log(`\n──── ${name} (${id}) · порог ${fp(paceOf(thrMps))} · будущих плановых: ${planned.length}`);

    for (const w of planned) {
      const wid = Number(w.trainingpeaks_workout_id);
      const live = await getWorkout(id, wid, bearer);
      const structObj = live.structure;
      if (!isRecord(structObj) || !/pace/i.test(String(structObj.primaryIntensityMetric ?? ""))) { continue; }
      const expPace = expectedPace(structObj, thrMps);
      const velBefore = typeof live.velocityPlanned === "number" ? live.velocityPlanned : null;
      const bPace = paceOf(velBefore);
      const wasStale = expPace != null && bPace != null && Math.abs(bPace - expPace) > STALE;
      if (wasStale) staleBefore++;

      if (!apply) {
        console.log(`   [dry] ${w.workout_date} «${w.title}» velP=${fp(bPace)} vs ожид ${fp(expPace)} ${wasStale ? "⚠ УСТАРЕЛ" : "свежий"}`);
        rows.push({ id, name, date: w.workout_date as string, title: (w.title as string) ?? "", wid, velBefore, velAfter: null, expPace, wasStale, status: wasStale ? "stale(dry)" : "fresh(dry)" });
        continue;
      }

      // re-PUT the SAME object (structure re-stringified from its own object; targets untouched)
      const before = { title: live.title, description: live.description, workoutId: live.workoutId };
      live.structure = JSON.stringify(structObj);
      const res = await authedWriteOnce("PUT", `/fitness/v6/athletes/${id}/workouts/${wid}`, live);
      if (res.status !== 200) { console.error(`   ✗ ${w.title}: PUT ${res.status} (не 200) — СТОП ВСЕГО ПРОГОНА.`); process.exit(5); }
      const after = await getWorkout(id, wid, bearer);
      const diffs: string[] = []; deepDiff(structObj, after.structure, "structure", diffs);
      const okMeta = after.workoutId === before.workoutId && after.title === before.title && after.description === before.description;
      if (diffs.length > 0 || !okMeta) { console.error(`   ✗ ${w.title}: структура ИЗМЕНИЛАСЬ при пере-сохранении — СТОП.`); for (const d of diffs.slice(0, 10)) console.error(`      Δ ${d}`); process.exit(5); }
      const velAfter = typeof after.velocityPlanned === "number" ? after.velocityPlanned : null;
      const aPace = paceOf(velAfter);
      const nowOk = expPace != null && aPace != null && Math.abs(aPace - expPace) <= TOL;
      let status: string;
      if (nowOk && wasStale) { status = "FIXED"; freshAfter++; }
      else if (nowOk) { status = "ok(was-fresh)"; }
      else { status = "STILL-OFF"; stillWrong++; }
      console.log(`   ${nowOk ? "✅" : "❌"} ${w.workout_date} «${w.title}» velP ${fp(bPace)} → ${fp(aPace)} (ожид ${fp(expPace)}) ${status}`);
      rows.push({ id, name, date: w.workout_date as string, title: (w.title as string) ?? "", wid, velBefore, velAfter, expPace, wasStale, status });
      if (!nowOk) { console.error(`   ⛔ velocityPlanned не сошёлся с ожиданием после пере-сохранения — СТОП (не иду дальше).`); process.exit(5); }
    }
  }

  console.log(`\n==== ИТОГ ====`);
  console.log(`тренировок обработано: ${rows.length}`);
  if (apply) {
    console.log(`было устаревших (velP под старым порогом): ${staleBefore}`);
    console.log(`починено (стало свежим): ${freshAfter}`);
    console.log(`осталось кривым: ${stillWrong}`);
  } else {
    console.log(`устаревших сейчас: ${staleBefore} · свежих: ${rows.length - staleBefore}`);
    console.log(`\nПрименить: TP_ATHLETE_REAL_WRITE=1 npx tsx tools/trainingpeaks-export/scripts/tp-structure-resave.ts --athletes=${ids.join(",")} --apply --confirm "RESAVE"`);
  }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
