// Proof harness for the comparison base (наряд 2), READ-ONLY. Runs the REAL
// compareWorkout over every run as if it were "today", chronologically per
// student so the praise pause is simulated, and prints raw counts. Writes
// nothing, touches no live student.
//
// comparison_key is computed on the fly from the plan structure; steady-run
// pace/duration are aggregated from the laps table (не хранятся на derived row).
//
//   npx tsx tools/trainingpeaks-export/scripts/tp-comparison-base-proof.ts

import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as supabaseServerModule from "../../../src/features/supabase/server.ts";
import * as comparisonModule from "../../../src/features/trainingpeaks/comparison/index.ts";

type NamespaceWithOptionalDefault<T> = T & { default?: T };
const supabaseServer = supabaseServerModule as NamespaceWithOptionalDefault<typeof supabaseServerModule>;
const createSupabaseServerClient = supabaseServer.createSupabaseServerClient ?? supabaseServer.default?.createSupabaseServerClient;
const comparison = comparisonModule as NamespaceWithOptionalDefault<typeof comparisonModule>;
const compareWorkout = comparison.compareWorkout ?? comparison.default?.compareWorkout;
const computeComparisonKey = comparison.computeComparisonKey ?? comparison.default?.computeComparisonKey;
const matchSteadyWorkout = comparison.matchSteadyWorkout ?? comparison.default?.matchSteadyWorkout;

if (typeof createSupabaseServerClient !== "function") throw new Error("createSupabaseServerClient unavailable");
if (typeof compareWorkout !== "function") throw new Error("compareWorkout unavailable");
if (typeof computeComparisonKey !== "function") throw new Error("computeComparisonKey unavailable");
if (typeof matchSteadyWorkout !== "function") throw new Error("matchSteadyWorkout unavailable");

type DerivedRowForComparison = comparisonModule.DerivedRowForComparison;
type LastPraise = comparisonModule.LastPraise;

function loadEnv(): void {
  const candidates = [path.resolve(process.cwd(), ".env.local"), path.resolve(import.meta.dirname, "..", "..", "..", ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      if (!k || process.env[k] !== undefined) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  let last: unknown = null;
  for (let a = 0; a < 5; a += 1) {
    try {
      const res = await fn();
      if (res.error) throw new Error(res.error.message);
      return res;
    } catch (e) {
      last = e;
      await sleep(300 * (a + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await withRetry<T>(() => build(from, from + pageSize - 1));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function asNums(v: unknown): Array<number | null> | null {
  return Array.isArray(v) ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null)) : null;
}
function fmt(n: number | null | undefined, d = 0): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";
}

type DerivedDbRow = {
  student_id: string;
  student_name: string | null;
  trainingpeaks_workout_id: number;
  workout_cache_id: string;
  workout_date: string;
  workout_type: string | null;
  reps_detected_count: number | null;
  rep_paces: unknown;
  rep_peak_hrs: unknown;
  rep_pace_fade_pct: number | null;
  rep_recovery_drops: unknown;
  avg_hr: number | null;
  hr_trusted: boolean | null;
  hr_quality: string | null;
  hr_decoupling_pct: number | null;
  aerobic_ef: number | null;
};

async function main(): Promise<void> {
  loadEnv();
  const supabase = createSupabaseServerClient();

  console.log("loading run derived rows…");
  const derivedRows = await fetchAll<DerivedDbRow>((from, to) =>
    supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select(
        "student_id, student_name, trainingpeaks_workout_id, workout_cache_id, workout_date, workout_type, reps_detected_count, rep_paces, rep_peak_hrs, rep_pace_fade_pct, rep_recovery_drops, avg_hr, hr_trusted, hr_quality, hr_decoupling_pct, aerobic_ef"
      )
      .eq("workout_type", "run")
      .order("student_id", { ascending: true })
      .range(from, to)
  );
  console.log(`run derived rows: ${derivedRows.length}`);

  console.log("loading plan structures…");
  const cacheIds = [...new Set(derivedRows.map((r) => r.workout_cache_id))];
  const structureByCacheId = new Map<string, unknown>();
  for (const ids of chunk(cacheIds, 200)) {
    const rows = await fetchAll<{ id: string; structure: unknown }>((from, to) =>
      supabase.from("trainingpeaks_workout_cache").select("id, structure:source_snapshot->structure").in("id", ids).order("id", { ascending: true }).range(from, to)
    );
    for (const row of rows) structureByCacheId.set(row.id, row.structure);
  }

  // Aggregate laps → overall pace/duration, only for STEADY runs (reps < 2).
  console.log("aggregating laps for steady runs…");
  const steadyCacheIds = [...new Set(derivedRows.filter((r) => (r.reps_detected_count ?? 0) < 2).map((r) => r.workout_cache_id))];
  const lapAgg = new Map<string, { distanceM: number; timeS: number }>();
  for (const ids of chunk(steadyCacheIds, 150)) {
    const rows = await fetchAll<{ workout_cache_id: string; distance_m: number | null; timer_time_s: number | null }>((from, to) =>
      supabase.from("trainingpeaks_workout_laps").select("workout_cache_id, distance_m, timer_time_s").eq("source", "fit").in("workout_cache_id", ids).order("workout_cache_id", { ascending: true }).range(from, to)
    );
    for (const row of rows) {
      const a = lapAgg.get(row.workout_cache_id) ?? { distanceM: 0, timeS: 0 };
      a.distanceM += typeof row.distance_m === "number" ? row.distance_m : 0;
      a.timeS += typeof row.timer_time_s === "number" ? row.timer_time_s : 0;
      lapAgg.set(row.workout_cache_id, a);
    }
  }

  const nameByStudent = new Map<string, string>();
  const byStudent = new Map<string, DerivedRowForComparison[]>();
  for (const r of derivedRows) {
    if (r.student_name) nameByStudent.set(r.student_id, r.student_name);
    const agg = lapAgg.get(r.workout_cache_id);
    const row: DerivedRowForComparison = {
      workoutId: r.trainingpeaks_workout_id,
      workoutDate: r.workout_date,
      workoutType: r.workout_type,
      comparisonKey: computeComparisonKey(structureByCacheId.get(r.workout_cache_id) ?? null),
      repsDetectedCount: r.reps_detected_count,
      repPaces: asNums(r.rep_paces),
      repPeakHrs: asNums(r.rep_peak_hrs),
      repPaceFadePct: r.rep_pace_fade_pct,
      repRecoveryDrops: asNums(r.rep_recovery_drops),
      avgHr: r.avg_hr,
      hrTrusted: r.hr_trusted,
      hrQuality: r.hr_quality,
      avgPaceSecPerKm: agg && agg.distanceM > 0 && agg.timeS > 0 ? (agg.timeS / agg.distanceM) * 1000 : null,
      durationS: agg && agg.timeS > 0 ? agg.timeS : null,
      hrDecouplingPct: r.hr_decoupling_pct,
      aerobicEf: r.aerobic_ef,
    };
    const list = byStudent.get(r.student_id) ?? [];
    list.push(row);
    byStudent.set(r.student_id, list);
  }

  // ── accumulators ────────────────────────────────────────────────────────
  const iv = { evaluable: 0, fired: 0, composite: 0, a: 0, b: 0, tier1: 0, tier2: 0, recent: 0, old: 0, baseN1: 0, baseN2: 0, baseN3plus: 0, noComparable: 0, normNotMet: 0, belowThreshold: 0, madKilled: 0 };
  const pause = { silencedWeighted: 0, weightRescue: 0, emitted: 0 };
  let unusualFlags = 0;
  const st = { evaluable: 0, comparable: 0, firedWithBand: 0, firedWithoutBand: 0, a: 0, b: 0, falseAvoided: 0 };

  type Ex = { student: string; date: string; text: string };
  const exA: Ex[] = [];
  const exB: Ex[] = [];
  const exComposite: Ex[] = [];
  const exSteady: Ex[] = [];

  const describe = (metrics: comparisonModule.ObservationMetricLine[]): string =>
    metrics.map((m) => `${m.metric} ${fmt(m.before, 1)}→${fmt(m.after, 1)}(Δ${fmt(m.delta, 1)},MAD ${fmt(m.spread, 1)},n=${m.baseN})`).join("  ");

  for (const [studentId, rowsUnsorted] of byStudent.entries()) {
    const studentName = nameByStudent.get(studentId) ?? studentId;
    const rows = [...rowsUnsorted].sort((x, y) => (x.workoutDate < y.workoutDate ? -1 : x.workoutDate > y.workoutDate ? 1 : 0));
    let lastWeighted: LastPraise | null = null;
    let lastSimple: LastPraise | null = null;

    for (const current of rows) {
      const result = compareWorkout({ current, history: rows, lastPraise: lastWeighted });
      const wc = result.winningCandidate;

      if (result.coachFlags.some((f) => f.kind === "unusual_shift")) unusualFlags += 1;

      if (result.isSteady) {
        if (result.match.evaluated) st.evaluable += 1;
        if (result.match.hadComparable) st.comparable += 1;
        st.falseAvoided += result.match.steadyFalseAvoidedByHrBand;
        if (result.match.candidates.length > 0) {
          st.firedWithBand += 1;
          if (wc?.kind === "mechanism_a") st.a += 1;
          if (wc?.kind === "mechanism_b") st.b += 1;
          if (exSteady.length < 10 && wc) exSteady.push({ student: studentName, date: current.workoutDate, text: `${wc.kind} T3 ${wc.mode}: ${describe(wc.metrics.map((m) => ({ ...m })))}` });
        }
        const noBand = matchSteadyWorkout({ current, history: rows, enforceHrBand: false });
        if (noBand.candidates.length > 0) st.firedWithoutBand += 1;
      } else if (result.match.evaluated) {
        iv.evaluable += 1;
        switch (result.outcome) {
          case "fired":
            iv.fired += 1;
            break;
          case "mad_killed":
            iv.madKilled += 1;
            break;
          case "below_threshold":
            iv.belowThreshold += 1;
            break;
          case "norm_not_met":
            iv.normNotMet += 1;
            break;
          case "no_comparable":
            iv.noComparable += 1;
            break;
        }
        if (wc) {
          if (wc.kind === "composite") iv.composite += 1;
          if (wc.kind === "mechanism_a") iv.a += 1;
          if (wc.kind === "mechanism_b") iv.b += 1;
          if (wc.tier === 1) iv.tier1 += 1;
          if (wc.tier === 2) iv.tier2 += 1;
          if (wc.mode === "recent") iv.recent += 1;
          if (wc.mode === "old") iv.old += 1;
          const bn = wc.metrics[0]?.baseN ?? 0;
          if (bn <= 1) iv.baseN1 += 1;
          else if (bn === 2) iv.baseN2 += 1;
          else iv.baseN3plus += 1;

          const line = `${wc.kind} T${wc.tier} ${wc.mode}${wc.composite ? ` [${wc.composite.countBefore}→${wc.composite.countAfter} reps]` : ""}: ${describe(wc.metrics.map((m) => ({ ...m })))}`;
          if (wc.kind === "composite" && exComposite.length < 6) exComposite.push({ student: studentName, date: current.workoutDate, text: line });
          if (wc.kind === "mechanism_a" && exA.length < 10) exA.push({ student: studentName, date: current.workoutDate, text: line });
          if (wc.kind === "mechanism_b" && exB.length < 10) exB.push({ student: studentName, date: current.workoutDate, text: line });
        }
      }

      // pause simulation (weighted = production; simple = weight-agnostic baseline)
      if (wc) {
        if (result.observation !== null) {
          pause.emitted += 1;
          lastWeighted = { weight: wc.weight, date: current.workoutDate };
        } else {
          pause.silencedWeighted += 1;
        }
        const simpleEmit = lastSimple === null || Math.round((Date.parse(current.workoutDate) - Date.parse(lastSimple.date)) / 86400000) >= 14;
        if (simpleEmit) lastSimple = { weight: wc.weight, date: current.workoutDate };
        else if (wc.weight > (lastSimple?.weight ?? 0)) pause.weightRescue += 1;
      }
    }
  }

  const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(` COMPARISON BASE — PROOF наряд 2  [READ-ONLY]`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`students: ${byStudent.size}   run rows: ${derivedRows.length}`);

  console.log(`\n── INTERVALS (ярусы 1–2) ──`);
  console.log(`evaluable intervals: ${iv.evaluable}`);
  console.log(`\n1. FIRES (pre-pause, comparable to наряд1 6.9%): ${iv.fired}  (${pct(iv.fired, iv.evaluable)})`);
  console.log(`   composite: ${iv.composite}   mechanism A: ${iv.a}   mechanism B: ${iv.b}`);
  console.log(`   tier1: ${iv.tier1}   tier2: ${iv.tier2}   recent: ${iv.recent}   old: ${iv.old}`);
  console.log(`\n2. SILENCE, 4 reasons (of evaluable):`);
  console.log(`   (а) no comparable:   ${iv.noComparable}  (${pct(iv.noComparable, iv.evaluable)})   [наряд1: 53.2%]`);
  console.log(`   (б) norm not met:    ${iv.normNotMet}  (${pct(iv.normNotMet, iv.evaluable)})   [наряд1: 38.5%]`);
  console.log(`   (в) below threshold: ${iv.belowThreshold}  (${pct(iv.belowThreshold, iv.evaluable)})`);
  console.log(`   (г) MAD-killed:      ${iv.madKilled}  (${pct(iv.madKilled, iv.evaluable)})`);
  console.log(`\n3. COMPOSITE progress fires: ${iv.composite}`);
  console.log(`\n4. PAUSE: emitted ${pause.emitted}, weighted-pause silenced ${pause.silencedWeighted}`);
  console.log(`   weight-mechanic rescues (simple pause would silence a STRONGER-than-last praise): ${pause.weightRescue}`);
  console.log(`\n5. UNUSUAL-shift coach flags: ${unusualFlags}`);
  console.log(`\n6. n≥3 → n=1 cost/benefit — fires by winning norm size:  baseN=1: ${iv.baseN1}   baseN=2: ${iv.baseN2}   baseN≥3: ${iv.baseN3plus}`);

  console.log(`\n7. EXAMPLES — mechanism A:`);
  for (const e of exA) console.log(`   ${e.student} | ${e.date} | ${e.text}`);
  console.log(`   EXAMPLES — mechanism B:`);
  for (const e of exB) console.log(`   ${e.student} | ${e.date} | ${e.text}`);
  console.log(`   EXAMPLES — composite:`);
  for (const e of exComposite) console.log(`   ${e.student} | ${e.date} | ${e.text}`);
  if (exA.length + exB.length + exComposite.length === 0) console.log("   (none)");

  console.log(`\n── ЯРУС 3 (ровный/длительный бег) ──`);
  console.log(`evaluable steady: ${st.evaluable}   comparable (after HR-band): ${st.comparable}`);
  console.log(`fires WITH HR-band: ${st.firedWithBand}  (A ${st.a} / B ${st.b})`);
  console.log(`fires WITHOUT HR-band: ${st.firedWithoutBand}   → false signals the band prevents: ${st.firedWithoutBand - st.firedWithBand}`);
  console.log(`comparables the HR-band rejected (duration-ok but out of band): ${st.falseAvoided}`);
  console.log(`   EXAMPLES — steady:`);
  for (const e of exSteady) console.log(`   ${e.student} | ${e.date} | ${e.text}`);
  if (exSteady.length === 0) console.log("   (none)");
  console.log("");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
