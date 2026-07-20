// Proof harness for the comparison base (intervals, tiers 1–2). READ-ONLY:
// selects from the backfilled base and runs the REAL matcher (compareWorkout)
// over every interval run as if it were "today", then prints raw counts. Writes
// nothing, mutates nothing, touches no live student.
//
// The comparison_key is computed on the fly from each workout's plan structure
// (trainingpeaks_workout_cache.source_snapshot->structure), so the proof does
// not depend on the not-yet-applied column.
//
//   npx tsx tools/trainingpeaks-export/scripts/tp-comparison-base-proof.ts
//
// Output (numbers are RAW — Igor judges, this script does not interpret):
//   1. fire counts: tier 1 / tier 2 / recent / old / pulse anomaly
//   2. silence split by FOUR reasons (а no comparable / б norm not met /
//      в below threshold / г killed by MAD guard)
//   3. multiblock-key share of keyable intervals
//   4. 5–10 real fired examples with before/after/delta/MAD

import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as supabaseServerModule from "../../../src/features/supabase/server.ts";
import * as comparisonModule from "../../../src/features/trainingpeaks/comparison/index.ts";

type NamespaceWithOptionalDefault<T> = T & { default?: T };
const supabaseServer = supabaseServerModule as NamespaceWithOptionalDefault<typeof supabaseServerModule>;
const createSupabaseServerClient =
  supabaseServer.createSupabaseServerClient ?? supabaseServer.default?.createSupabaseServerClient;
const comparison = comparisonModule as NamespaceWithOptionalDefault<typeof comparisonModule>;
const compareWorkout = comparison.compareWorkout ?? comparison.default?.compareWorkout;
const computeComparisonKey = comparison.computeComparisonKey ?? comparison.default?.computeComparisonKey;
const parseComparisonKey = comparison.parseComparisonKey ?? comparison.default?.parseComparisonKey;

if (typeof createSupabaseServerClient !== "function") throw new Error("createSupabaseServerClient unavailable");
if (typeof compareWorkout !== "function") throw new Error("compareWorkout unavailable");
if (typeof computeComparisonKey !== "function") throw new Error("computeComparisonKey unavailable");
if (typeof parseComparisonKey !== "function") throw new Error("parseComparisonKey unavailable");

type DerivedRowForComparison = comparisonModule.DerivedRowForComparison;

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(import.meta.dirname, "..", "..", "..", ".env.local"),
    "/Users/igor/igor-tp-reports-bot/.env.local",
  ];
  for (const dotEnvPath of candidates) {
    if (!existsSync(dotEnvPath)) continue;
    for (const line of readFileSync(dotEnvPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep < 0) continue;
      const key = trimmed.slice(0, sep).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(sep + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Supabase over undici occasionally throws a transient "fetch failed"; retry
// with backoff so a large paginated pull doesn't die on one hiccup.
async function withRetry<T>(fn: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fn();
      if (res.error) throw new Error(res.error.message);
      return res;
    } catch (error) {
      lastError = error;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
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

function asNumberArray(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  return value.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
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
};

function fmt(n: number | null | undefined, digits = 0): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

async function main(): Promise<void> {
  loadEnv();
  const supabase = createSupabaseServerClient();

  console.log("loading run derived rows…");
  const derivedRows = await fetchAll<DerivedDbRow>((from, to) =>
    supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select(
        "student_id, student_name, trainingpeaks_workout_id, workout_cache_id, workout_date, workout_type, reps_detected_count, rep_paces, rep_peak_hrs, rep_pace_fade_pct, rep_recovery_drops, avg_hr, hr_trusted, hr_quality"
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
      supabase
        .from("trainingpeaks_workout_cache")
        .select("id, structure:source_snapshot->structure")
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to)
    );
    for (const row of rows) structureByCacheId.set(row.id, row.structure);
  }

  // Build the matcher's row shape, computing the key on the fly.
  const nameByStudent = new Map<string, string>();
  const byStudent = new Map<string, DerivedRowForComparison[]>();
  for (const r of derivedRows) {
    if (r.student_name) nameByStudent.set(r.student_id, r.student_name);
    const row: DerivedRowForComparison = {
      workoutId: r.trainingpeaks_workout_id,
      workoutDate: r.workout_date,
      workoutType: r.workout_type,
      comparisonKey: computeComparisonKey(structureByCacheId.get(r.workout_cache_id) ?? null),
      repsDetectedCount: r.reps_detected_count,
      repPaces: asNumberArray(r.rep_paces),
      repPeakHrs: asNumberArray(r.rep_peak_hrs),
      repPaceFadePct: r.rep_pace_fade_pct,
      repRecoveryDrops: asNumberArray(r.rep_recovery_drops),
      avgHr: r.avg_hr,
      hrTrusted: r.hr_trusted,
      hrQuality: r.hr_quality,
    };
    const list = byStudent.get(r.student_id) ?? [];
    list.push(row);
    byStudent.set(r.student_id, list);
  }

  // ── key-shape census (multiblock share) ─────────────────────────────────
  let keyable = 0;
  let singleBlock = 0;
  let singleBlockMultiStep = 0;
  let multiBlock = 0;
  for (const rows of byStudent.values()) {
    for (const row of rows) {
      if (!row.comparisonKey) continue;
      keyable += 1;
      const parsed = parseComparisonKey(row.comparisonKey);
      if (!parsed) continue;
      if (parsed.blocks.length > 1) multiBlock += 1;
      else if (parsed.blocks[0]!.steps.length > 1) singleBlockMultiStep += 1;
      else singleBlock += 1;
    }
  }

  // ── run the matcher over every run as "current" ─────────────────────────
  const stats = {
    runs: derivedRows.length,
    students: byStudent.size,
    detectedIntervals: 0, // reps_detected_count >= 2
    evaluable: 0, // run + key + reps>=2 (matcher.evaluated)
    firedRuns: 0,
    tier1Fired: 0,
    tier2Fired: 0,
    recentFired: 0,
    oldFired: 0,
    pulseFlagCoach: 0,
    pulseSuppressAsk: 0,
    silenceNoComparable: 0, // а
    silenceNormNotMet: 0, // б
    silenceBelowThreshold: 0, // в
    silenceMadKilled: 0, // г
    madKilledWouldFire: 0, // same as г; the "signals MAD guard removed" count
    tier2WouldRescueNormNotMet: 0, // of б: exact-key thin, but tier2 pool would reach min points
  };

  type Example = {
    student: string;
    date: string;
    key: string;
    tier: number;
    mode: string;
    metric: string;
    before: number | null;
    after: number | null;
    delta: number | null;
    mad: number | null;
    baseN: number;
    eff: number;
    context: string;
  };
  const examples: Example[] = [];
  const pulseExamples: string[] = [];

  for (const [studentId, rows] of byStudent.entries()) {
    const studentName = nameByStudent.get(studentId) ?? studentId;
    for (const current of rows) {
      const result = compareWorkout({ current, history: rows });
      const { match, pulse, outcome } = result;

      if ((current.repsDetectedCount ?? 0) >= 2) stats.detectedIntervals += 1;
      if (!match.evaluated) continue;
      stats.evaluable += 1;

      // pulse channel (independent of the training comparison)
      if (pulse.grade === "flag_coach") {
        stats.pulseFlagCoach += 1;
        if (pulseExamples.length < 5) {
          pulseExamples.push(
            `${studentName} ${current.workoutDate} ${current.comparisonKey}: pulse ${fmt(pulse.currentHr)} vs norm ${fmt(pulse.normHr)} (−${fmt(pulse.shortfallBpm)} bpm, n=${pulse.baseN}) → флаг Игорю`
          );
        }
      } else if (pulse.grade === "suppress_and_ask") {
        stats.pulseSuppressAsk += 1;
        if (pulseExamples.length < 5) {
          pulseExamples.push(
            `${studentName} ${current.workoutDate} ${current.comparisonKey}: pulse ${fmt(pulse.currentHr)} vs norm ${fmt(pulse.normHr)} (−${fmt(pulse.shortfallBpm)} bpm, n=${pulse.baseN}) → подавить пульс + вопрос ученику`
          );
        }
      }

      // training comparison
      if (outcome === "fired") {
        stats.firedRuns += 1;
        if (match.tier === 1) stats.tier1Fired += 1;
        if (match.tier === 2) stats.tier2Fired += 1;
        const firedEvals = match.metricEvals.filter((e) => e.fired && e.suppressed === null);
        if (firedEvals.some((e) => e.mode === "recent")) stats.recentFired += 1;
        if (firedEvals.some((e) => e.mode === "old")) stats.oldFired += 1;

        if (result.observation && result.observation.metric !== "hr_sensor" && examples.length < 12) {
          const o = result.observation;
          examples.push({
            student: studentName,
            date: current.workoutDate,
            key: o.class.key,
            tier: o.class.tier,
            mode: o.mode,
            metric: o.metric,
            before: o.before,
            after: o.after,
            delta: o.delta,
            mad: o.spread,
            baseN: o.baseN,
            eff: firedEvals.find((e) => e.mode === o.mode && e.metric === o.metric)?.effectiveThreshold ?? 0,
            context: o.context.map((c) => `${c.type}:${c.text}`).join("; "),
          });
        }
      } else if (outcome === "mad_killed") {
        stats.silenceMadKilled += 1;
        stats.madKilledWouldFire += 1;
      } else if (outcome === "below_threshold") {
        stats.silenceBelowThreshold += 1;
      } else if (outcome === "norm_not_met") {
        stats.silenceNormNotMet += 1;
        // Would pooling tier-2 rows have reached the min points? (Igor's open Q.)
        const pc = match.poolCounts;
        const recentAll = pc.tier1RecentN + pc.tier2RecentN;
        const oldAll = pc.tier1OldN + pc.tier2OldN;
        if (recentAll >= 3 || oldAll >= 2) stats.tier2WouldRescueNormNotMet += 1;
      } else {
        stats.silenceNoComparable += 1;
      }
    }
  }

  const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(` COMPARISON BASE — PROOF (intervals, tiers 1–2)  [READ-ONLY]`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`students: ${stats.students}   run rows: ${stats.runs}`);
  console.log(`FIT-detected intervals (reps≥2): ${stats.detectedIntervals}`);
  console.log(`evaluable intervals (run + key + reps≥2): ${stats.evaluable}`);

  console.log(`\n── 1. FIRES (would speak) ──`);
  console.log(`  fired runs (training):      ${stats.firedRuns}  (${pct(stats.firedRuns, stats.evaluable)} of evaluable)`);
  console.log(`    tier 1 (exact key):       ${stats.tier1Fired}`);
  console.log(`    tier 2 (equivalent key):  ${stats.tier2Fired}`);
  console.log(`    fired in RECENT mode:     ${stats.recentFired}`);
  console.log(`    fired in OLD mode:        ${stats.oldFired}`);
  console.log(`  pulse anomaly — flag Игорю: ${stats.pulseFlagCoach}`);
  console.log(`  pulse anomaly — suppress+ask: ${stats.pulseSuppressAsk}`);

  console.log(`\n── 2. SILENCE, split by reason (of evaluable intervals) ──`);
  const totalSilence =
    stats.silenceNoComparable + stats.silenceNormNotMet + stats.silenceBelowThreshold + stats.silenceMadKilled;
  console.log(`  (а) no comparable at all:   ${stats.silenceNoComparable}  (${pct(stats.silenceNoComparable, stats.evaluable)})`);
  console.log(`  (б) norm not met (<3/<2):   ${stats.silenceNormNotMet}  (${pct(stats.silenceNormNotMet, stats.evaluable)})`);
  console.log(`  (в) below threshold:        ${stats.silenceBelowThreshold}  (${pct(stats.silenceBelowThreshold, stats.evaluable)})`);
  console.log(`  (г) killed by MAD guard:    ${stats.silenceMadKilled}  (${pct(stats.silenceMadKilled, stats.evaluable)})`);
  console.log(`  total silent:               ${totalSilence}  (${pct(totalSilence, stats.evaluable)})`);
  console.log(`  · of (б): tier-2 pool WOULD have met the min points: ${stats.tier2WouldRescueNormNotMet}`);
  console.log(`  · (г) = signals the MAD guard removed vs Igor's flat thresholds: ${stats.madKilledWouldFire}`);

  console.log(`\n── 3. KEY SHAPE (multiblock share) ──`);
  console.log(`  keyable interval runs (key≠null):  ${keyable}`);
  console.log(`    single-block (tier-2 eligible):  ${singleBlock}  (${pct(singleBlock, keyable)})`);
  console.log(`    single-block, multi-step:        ${singleBlockMultiStep}  (${pct(singleBlockMultiStep, keyable)})`);
  console.log(`    MULTIBLOCK (>1 block):           ${multiBlock}  (${pct(multiBlock, keyable)})  ← tier-1-only today`);

  console.log(`\n── 4. EXAMPLES (raw numbers; unit: rep_pace=s/km, HR/recovery=bpm, fade=pp) ──`);
  for (const e of examples) {
    console.log(
      `  ${e.student} | ${e.date} | ${e.key} T${e.tier} ${e.mode} | ${e.metric}: ` +
        `${fmt(e.before, 1)} → ${fmt(e.after, 1)} (Δ${fmt(e.delta, 1)}) | MAD ${fmt(e.mad, 1)} | eff.thr ${fmt(e.eff, 1)} | n=${e.baseN}` +
        (e.context ? ` | ctx: ${e.context}` : "")
    );
  }
  if (examples.length === 0) console.log("  (no training fires)");
  if (pulseExamples.length > 0) {
    console.log(`\n  pulse-anomaly examples:`);
    for (const p of pulseExamples) console.log(`  ${p}`);
  }
  console.log("");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
