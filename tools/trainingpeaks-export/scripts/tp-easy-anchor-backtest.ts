/**
 * tp-easy-anchor-backtest — autoplanner sprint 1 harness (spec §1 + overrides П1–П4).
 *
 * READ-ONLY. No TP writes, no DB writes. Pulls prescribed easy ranges from the workout cache,
 * builds per-athlete easy anchors, and BACKTESTS them retrospectively (П1): for each (athlete,
 * historical week N) it builds the anchor from data STRICTLY BEFORE week N and compares the
 * prediction to what Igor actually prescribed in week N. Sweeps HALF_LIFE (П2), computes the
 * pairwise prescription↔execution gap (П3), and names the v1 population (П4). Writes reports/.
 *
 * Usage: npx tsx tools/trainingpeaks-export/scripts/tp-easy-anchor-backtest.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import {
  buildAnchor, extractEasySample, tierOf, weekActual, rangesOverlap, anchorConfidence,
  type EasySample, type DateWindow, type Tier,
} from "./lib/easy-anchor.ts";
import { AUTOPLANNER_FIRST_GENERATION_DATE } from "./lib/autoplanner-provenance.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
// Env lookup mirrors tp-threshold-restore.ts: worktrees have no .env.local (secrets live only in
// the canonical checkout), so fall back to it by absolute path. Never copy secrets into a worktree.
function getSupabase(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p);
  const url = process.env.SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked worktree .env.local/.env and the canonical checkout)");
  return createClient(url, key, { auth: { persistSession: false } });
}

const iso = (d: number): string => new Date(d).toISOString().slice(0, 10);
const todayIso = (): string => iso(Date.now());
const addDays = (dateStr: string, n: number): string => iso(Date.parse(dateStr) + n * 86400000);
function monday(dateStr: string): string { const d = new Date(dateStr + "T00:00:00Z"); const off = (d.getUTCDay() + 6) % 7; return iso(d.getTime() - off * 86400000); }
function median(xs: number[]): number { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(xs: number[], q: number): number { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.floor(q * s.length)); return s[i]; }
const fp = (sec: number): string => { if (!Number.isFinite(sec)) return "—"; const m = Math.floor(sec / 60), s = Math.round(sec % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`; };

const HALF_LIVES: Array<{ label: string; v: number }> = [
  { label: "21", v: 21 }, { label: "28", v: 28 }, { label: "42", v: 42 }, { label: "63", v: 63 }, { label: "∞", v: Infinity },
];
const ILLNESS_TYPES = new Set(["health_issue_started", "health_issue_improving", "pain_injury", "pause_training"]);
const ILLNESS_TAIL_DAYS = 14;

type Row = { trainingpeaks_athlete_id: number; student_id: string | null; workout_date: string; title: string | null; is_planned: boolean | null; is_completed: boolean | null; completed_time_raw: number | null; completed_distance_raw: number | null; description: string | null };

async function pullRuns(sb: SupabaseClient): Promise<Row[]> {
  const since = addDays(todayIso(), -430);
  const out: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, student_id, workout_date, title, is_planned, is_completed, completed_time_raw, completed_distance_raw, description:source_snapshot->>description")
      .eq("workout_type_value_id", 3).gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function pullIllnessWindows(sb: SupabaseClient): Promise<Map<string, DateWindow[]>> {
  const { data, error } = await sb.from("trainingpeaks_student_operational_signals")
    .select("student_id, signal_type, valid_from, valid_until, source_date, target_date, created_at, resolved_at")
    .in("signal_type", [...ILLNESS_TYPES]);
  if (error) throw error;
  const m = new Map<string, DateWindow[]>();
  for (const s of (data ?? []) as Array<Record<string, unknown>>) {
    const sid = s.student_id as string | null; if (!sid) continue;
    const from = (s.valid_from ?? s.source_date ?? s.target_date ?? (typeof s.created_at === "string" ? (s.created_at as string).slice(0, 10) : null)) as string | null;
    if (!from) continue;
    let to = (s.valid_until ?? (typeof s.resolved_at === "string" ? (s.resolved_at as string).slice(0, 10) : null)) as string | null;
    if (!to || to < from) to = addDays(from, 21); // bounded default when the signal has no explicit end
    to = addDays(to, ILLNESS_TAIL_DAYS);
    (m.get(sid) ?? m.set(sid, []).get(sid)!).push({ from, to });
  }
  return m;
}

async function pullAppliedThresholds(sb: SupabaseClient): Promise<Map<number, number>> {
  const { data, error } = await sb.from("tp_threshold_applications")
    .select("trainingpeaks_athlete_id, value_after, applied_at, kind, tier").eq("kind", "pace").neq("tier", "rollback").order("applied_at", { ascending: false });
  if (error) throw error;
  const m = new Map<number, number>();
  for (const r of (data ?? []) as Array<{ trainingpeaks_athlete_id: number; value_after: number }>) {
    if (!m.has(r.trainingpeaks_athlete_id) && r.value_after) m.set(r.trainingpeaks_athlete_id, 1000 / r.value_after); // m/s → s/km
  }
  return m;
}

type Ath = { aid: number; sid: string | null; samples: EasySample[]; exec: Array<{ presMid: number; execPace: number }>; weeklyMin: number; tier: Tier };

function buildAthletes(rows: Row[]): Map<number, Ath> {
  const byAth = new Map<number, Row[]>();
  for (const r of rows) { (byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r); }
  const out = new Map<number, Ath>();
  const cutoff = addDays(todayIso(), -182);
  for (const [aid, rs] of byAth) {
    const seen = new Set<string>(); const samples: EasySample[] = [];
    // П3: prescribed range and executed pace live on DIFFERENT cache rows (planned vs completed) —
    // pair them by athlete+date (the completed run that day is the execution of that day's easy plan).
    const presByDate = new Map<string, { fast: number; slow: number }>();
    const execByDate = new Map<string, number>();
    const weekMin = new Map<string, number>();
    let sid: string | null = null;
    for (const r of rs) {
      if (r.student_id) sid = r.student_id;
      const desc = r.description ?? "";
      const s = r.title ? extractEasySample(r.title, desc) : null;
      if (s) {
        const key = `${r.workout_date}|${s.fast}|${s.slow}`;
        if (!seen.has(key)) { seen.add(key); samples.push({ date: r.workout_date, fast: s.fast, slow: s.slow }); }
        if (!presByDate.has(r.workout_date)) presByDate.set(r.workout_date, s);
      }
      if (r.is_completed && r.completed_time_raw && r.completed_distance_raw && r.completed_distance_raw > 1000) {
        const execPace = (r.completed_time_raw * 3600000) / r.completed_distance_raw; // hours→sec/km
        if (execPace > MIN_EXEC && execPace < MAX_EXEC && !execByDate.has(r.workout_date)) execByDate.set(r.workout_date, execPace);
      }
      if (r.is_completed && r.completed_time_raw && r.workout_date >= cutoff) {
        weekMin.set(monday(r.workout_date), (weekMin.get(monday(r.workout_date)) ?? 0) + r.completed_time_raw * 60);
      }
    }
    const exec: Array<{ presMid: number; execPace: number }> = [];
    for (const [d, pr] of presByDate) { const ep = execByDate.get(d); if (ep !== undefined) exec.push({ presMid: (pr.fast + pr.slow) / 2, execPace: ep }); }
    const weeks = [...weekMin.values()];
    const weeklyMin = weeks.length ? weeks.reduce((a, b) => a + b, 0) / weeks.length : 0;
    out.set(aid, { aid, sid, samples, exec, weeklyMin, tier: tierOf(weeklyMin) });
  }
  return out;
}
const MIN_EXEC = 180, MAX_EXEC = 600;

type Pair = { aid: number; week: string; tier: Tier; actualMid: number; byHl: Map<string, { predMid: number; overlap: boolean; signed: number; trend: number }> };

function backtest(aths: Map<number, Ath>, illness: Map<string, DateWindow[]>): Pair[] {
  const pairs: Pair[] = [];
  const firstWeek = monday(addDays(todayIso(), -182)); // 26 weeks back
  const lastWeek = monday(addDays(todayIso(), -7));
  for (const a of aths.values()) {
    const ill = a.sid ? illness.get(a.sid) ?? [] : [];
    for (let ws = firstWeek; ws <= lastWeek; ws = addDays(ws, 7)) {
      const weekEnd = addDays(ws, 7);
      const weekSamples = a.samples.filter((s) => s.date >= ws && s.date < weekEnd);
      if (weekSamples.length === 0) continue; // need ≥1 prescribed range in week N (П1)
      const gate = buildAnchor(a.samples, ws, { halfLifeDays: 42, illness: ill }); // pair validity is half-life-independent
      if (!gate) continue; // need ≥6 valid ranges in the training window (П1)
      const actual = weekActual(weekSamples); const actualMid = (actual.fast + actual.slow) / 2;
      const byHl = new Map<string, { predMid: number; overlap: boolean; signed: number; trend: number }>();
      for (const hl of HALF_LIVES) {
        const anc = buildAnchor(a.samples, ws, { halfLifeDays: hl.v, illness: ill })!;
        const predMid = (anc.fast + anc.slow) / 2;
        byHl.set(hl.label, { predMid, overlap: rangesOverlap(anc, actual), signed: predMid - actualMid, trend: anc.trendSlopeSPerDay });
      }
      pairs.push({ aid: a.aid, week: ws, tier: a.tier, actualMid, byHl });
    }
  }
  return pairs;
}

async function main(): Promise<void> {
  const sb = getSupabase();
  console.log("[easy-anchor] pulling cache…");
  const rows = await pullRuns(sb);
  const illness = await pullIllnessWindows(sb);
  const thr = await pullAppliedThresholds(sb);
  const aths = buildAthletes(rows);
  console.log(`[easy-anchor] rows=${rows.length} athletes=${aths.size} applied_thresholds=${thr.size} illness_students=${illness.size}`);

  // ── П4: v1 population (applied threshold ∩ individual anchor today) ──
  const asOf = addDays(todayIso(), 1);
  const withAnchor: number[] = []; const anchorRows: string[] = ["athlete_id,tier,weekly_min,n,eff_n,anchor_confidence,easy_fast,easy_slow,has_threshold"];
  for (const a of aths.values()) {
    const anc = buildAnchor(a.samples, asOf, { halfLifeDays: 42, illness: a.sid ? illness.get(a.sid) ?? [] : [] });
    if (anc) { withAnchor.push(a.aid); anchorRows.push(`${a.aid},${a.tier},${Math.round(a.weeklyMin)},${anc.n},${anc.effectiveN},${anchorConfidence(anc.effectiveN)},${fp(anc.fast)},${fp(anc.slow)},${thr.has(a.aid) ? 1 : 0}`); }
  }
  const withThr = new Set(thr.keys());
  const v1 = withAnchor.filter((id) => withThr.has(id)).sort((a, b) => a - b);
  const anchorNoThr = withAnchor.filter((id) => !withThr.has(id));
  const thrNoAnchor = [...withThr].filter((id) => aths.has(id) && !withAnchor.includes(id));
  const servedNeither = [...aths.keys()].filter((id) => !withThr.has(id) && !withAnchor.includes(id));

  // ── П3: pairwise prescription↔execution ──
  const allDev: number[] = []; const perAthFasterFrac: number[] = [];
  for (const a of aths.values()) {
    if (a.exec.length < 3) continue;
    const devs = a.exec.map((e) => e.execPace - e.presMid); // <0 = executed FASTER than prescribed mid
    allDev.push(...devs);
    perAthFasterFrac.push(devs.filter((d) => d < 0).length / devs.length);
  }
  // ── П1/П2: backtest ──
  console.log("[easy-anchor] backtesting…");
  const pairs = backtest(aths, illness);
  const evalAthletes = new Set(pairs.map((p) => p.aid)).size;
  const evalWeeks = new Set(pairs.map((p) => p.week)).size;

  const hlTable = HALF_LIVES.map((hl) => {
    const rows = pairs.map((p) => p.byHl.get(hl.label)!);
    const abs = rows.map((r) => Math.abs(r.signed));
    const signed = rows.map((r) => r.signed);
    const overlap = rows.filter((r) => r.overlap).length / rows.length;
    // trend split: rising form = trend<0 (prescribing faster). Lag shows as pred slower (signed>0).
    const rising = rows.filter((r) => r.trend < -0.02);
    const falling = rows.filter((r) => r.trend > 0.02);
    return {
      halfLife: hl.label,
      medianAbs: Math.round(median(abs)),
      medianSigned: Math.round(median(signed)),
      overlapPct: +(100 * overlap).toFixed(1),
      p90Abs: Math.round(quantile(abs, 0.9)),
      risingMedianSigned: rising.length ? Math.round(median(rising.map((r) => r.signed))) : null,
      fallingMedianSigned: falling.length ? Math.round(median(falling.map((r) => r.signed))) : null,
    };
  });
  // recommend: min medianAbs, then min p90 tail (the real differentiator — median is ~0 because
  // prescribed easy is very stable), then higher overlap.
  const rec = [...hlTable].sort((a, b) => a.medianAbs - b.medianAbs || a.p90Abs - b.p90Abs || b.overlapPct - a.overlapPct)[0];

  const tierBreak = (["T1", "T2", "T3"] as Tier[]).map((t) => {
    const rows = pairs.filter((p) => p.tier === t).map((p) => p.byHl.get(rec.halfLife)!);
    return { tier: t, pairs: rows.length, overlapPct: rows.length ? +(100 * rows.filter((r) => r.overlap).length / rows.length).toFixed(1) : null, medianSigned: rows.length ? Math.round(median(rows.map((r) => r.signed))) : null };
  });

  // ── write reports ──
  const outDir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "easy-pace-anchor", todayIso().replace(/-/g, "") + "-" + Date.now().toString().slice(-4));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "current-anchors.csv"), anchorRows.join("\n") + "\n");
  writeFileSync(path.join(outDir, "population-v1.json"), JSON.stringify({ v1_population: v1, v1_count: v1.length, anchor_no_threshold: anchorNoThr.sort((a, b) => a - b), threshold_no_anchor: thrNoAnchor.sort((a, b) => a - b), served_neither_count: servedNeither.length, roster_athletes: aths.size }, null, 2) + "\n");
  writeFileSync(path.join(outDir, "backtest-halflife.json"), JSON.stringify({ eval_pairs: pairs.length, eval_athletes: evalAthletes, eval_weeks: evalWeeks, half_life_table: hlTable, recommended: rec.halfLife, tier_breakdown: tierBreak }, null, 2) + "\n");
  const pw = { n_deviations: allDev.length, athletes: perAthFasterFrac.length, median_dev_s: Math.round(median(allDev)), p25_dev_s: Math.round(quantile(allDev, 0.25)), p75_dev_s: Math.round(quantile(allDev, 0.75)), frac_executed_faster: +(allDev.filter((d) => d < 0).length / allDev.length).toFixed(3), median_per_ath_faster_frac: +median(perAthFasterFrac).toFixed(3) };
  writeFileSync(path.join(outDir, "pairwise-exec.json"), JSON.stringify(pw, null, 2) + "\n");

  const md: string[] = [];
  md.push(`# Easy-pace anchor — backtest (${todayIso()})`);
  md.push(`\nprovenance: first_generation_date = ${AUTOPLANNER_FIRST_GENERATION_DATE ?? "null (все описания coach_authored)"}\n`);
  md.push(`## Оценочное множество (П1)\nпар (атлет, неделя) = **${pairs.length}** · атлетов = ${evalAthletes} · недель = ${evalWeeks}\nКритерий пары: ≥6 валидных диапазонов в окне обучения (26 нед, до недели N) И ≥1 прописанный диапазон в неделе N.\n`);
  md.push(`## Half-life sweep (П2)\n| HL | overlap % | median |Δ| с/км | median знак | p90 |Δ| | знак(форма↑) | знак(форма↓) |\n|---|---|---|---|---|---|---|`);
  for (const r of hlTable) md.push(`| ${r.halfLife} | ${r.overlapPct} | ${r.medianAbs} | ${r.medianSigned} | ${r.p90Abs} | ${r.risingMedianSigned ?? "—"} | ${r.fallingMedianSigned ?? "—"} |`);
  md.push(`\n**Рекомендация half-life: ${rec.halfLife}** (min median |Δ| = ${rec.medianAbs} с/км, overlap ${rec.overlapPct}%). Знак(форма↑/↓) = median signed для атлето-недель с растущим/падающим прописанным лёгким (trend); инерция читается относительно тренда, не по голому знаку.\n`);
  md.push(`## Разбивка по тирам (@HL ${rec.halfLife})\n| Тир | пар | overlap % | median знак с/км |\n|---|---|---|---|`);
  for (const r of tierBreak) md.push(`| ${r.tier} | ${r.pairs} | ${r.overlapPct ?? "—"} | ${r.medianSigned ?? "—"} |`);
  md.push(`\n## Попарно предписание↔исполнение (П3)\nна ОДНИХ И ТЕХ ЖЕ тренировках (n=${pw.n_deviations} у ${pw.athletes} атлетов): median(исполнение−предписание) = **${pw.median_dev_s} с/км** (p25 ${pw.p25_dev_s}, p75 ${pw.p75_dev_s}); доля «бежали быстрее предписания» = **${(pw.frac_executed_faster * 100).toFixed(1)}%**; медиана по атлетам доли-быстрее = ${(pw.median_per_ath_faster_frac * 100).toFixed(1)}%.\n`);
  md.push(`## Популяция v1 (П4)\nобслуживается (applied-порог И индивидуальный якорь) = **${v1.length}** атлетов.\nтолько якорь, без порога = ${anchorNoThr.length} · только порог, без якоря = ${thrNoAnchor.length} · ни того ни другого (НЕ обслуживать) = ${servedNeither.length} из ${aths.size}.\nСписок id v1 — в population-v1.json.\n`);
  writeFileSync(path.join(outDir, "summary.md"), md.join("\n") + "\n");

  console.log(`\n${md.join("\n")}\n`);
  console.log(`[easy-anchor] reports → ${outDir}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
