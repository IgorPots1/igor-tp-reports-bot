/**
 * READ-ONLY full evidence scan for threshold edits — EVERY snapshotted athlete,
 * using BOTH races (tier A/B) and long intervals (tier D). Extends
 * tp-threshold-candidates.ts, which used races only and left ~83 athletes as
 * "no data" even though many have interval workouts.
 *
 * NO writes (TP or DB). Emits a local JSON (for the interactive artifact) and a
 * markdown summary — with NAMES (local review), never chat.
 *
 * EVIDENCE + CONVERSION (reuses existing engine, no reinvented formula):
 *  - Tier A/B (race): proposed threshold pace = ftpaSecPerKm(vdotFromRace(dist,time))
 *    from src/app/tools/plan/vdot.ts (VDOT Daniels → FTPa anchor = hour threshold /
 *    10k pace = TP Z4/Z5a). Race distance from trainingpeaks_race_events (scan),
 *    finish time+distance from the completed workout (workout_cache; completed_time_raw
 *    is HOURS). No FIT required. The same-date workout whose measured distance is
 *    nearest the race distance (±15%) is used (excludes warm-ups).
 *  - Tier D (long intervals): reps ≥6 min are run at ~threshold, so the MEDIAN pace
 *    of qualifying reps IS the threshold estimate — reported directly, NO offset,
 *    NO second formula. Lower confidence than a race. Rep durations reconstructed
 *    from laps (mirrors the ingest's block logic) to keep only ≥6-min reps; rep
 *    paces/peak-HRs come from derived_metrics (already HR-cleaned).
 *  - Engine is pace-only → threshold HR: race avg HR / interval rep peak HR where
 *    hr_trusted, else blank. A reference, not a conversion.
 *
 * Usage: npx tsx tools/trainingpeaks-export/scripts/tp-threshold-fullscan.ts [--months=12]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parseAthleteIdFromUrl } from "../../../src/features/trainingpeaks/athlete-roster-import.ts";
import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { ftpaSecPerKm, vdotFromRace } from "../../../src/app/tools/plan/vdot.ts";
import { toolRoot } from "./lib/paths.ts";
import { getCoveredScheme } from "./lib/tp-zone-formulas.ts";

const LONG_REP_MIN_DURATION_S = 360; // 6 minutes
const MIN_REP_BLOCK_DURATION_S_INGEST = 45; // matches fit-lap-work-detection
const TEMPO_MIN_STEADY_S = 1200; // 20 min continuous

// Duration-dependent threshold adjustment for a CONTINUOUS tempo (sec/km, ADDED to the
// observed tempo pace — negative makes the estimate FASTER). Source: Daniels' Running
// Formula — a 20–30 min tempo IS run at Threshold (T) pace; longer continuous efforts
// drift toward Marathon (M) pace, which is slower than threshold, so the true threshold
// is FASTER than the observed pace by a growing margin (Daniels' T↔M gap ≈ 15–20 s/km
// for recreational runners). Apportioned by how long the steady effort lasted — NOT one
// flat number, per Igor:  20–30 min → 0 (already T-pace) · 30–45 min → −8 · 45+ min → −18.
function tempoOffsetSecPerKm(steadyS: number): number {
  const m = steadyS / 60;
  return m < 30 ? 0 : m < 45 ? -8 : -18;
}
function tempoBand(steadyS: number): string {
  const m = steadyS / 60;
  return m < 30 ? "20–30мин" : m < 45 ? "30–45мин" : "45+мин";
}

function loadEnv(p: string): void {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k || process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
function getSupabase(): SupabaseClient {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) loadEnv(p);
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function getCli(prefix: string): string | null {
  const a = process.argv.slice(2).find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** p-th percentile (0..1) of ascending-sorted values. For pace (sec/km), a LOW
 *  percentile = the FASTER efforts. Used to pull the tempo/threshold efforts out
 *  of a pile of continuous runs that is mostly easy running. */
function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))))];
}
function fmtPace(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type ZoneSet = { workoutTypeId?: number; threshold?: number; calculationMethod?: number };
function wt0(zonesArray: unknown): ZoneSet | null {
  if (!Array.isArray(zonesArray)) return null;
  const s = zonesArray.find((x) => isRecord(x) && x.workoutTypeId === 0);
  return isRecord(s) ? (s as ZoneSet) : null;
}

type Lap = { lapIndex: number; timerTimeS: number | null; elapsedTimeS: number | null; isWork: boolean | null };
/** ≥6-min rep-block durations, in ingest order (aligns with rep_paces indices). */
function repBlockDurations(laps: Lap[]): number[] {
  const sorted = [...laps].sort((a, b) => a.lapIndex - b.lapIndex);
  const blocks: Lap[][] = [];
  let cur: Lap[] = [];
  for (const lap of sorted) {
    if (lap.isWork === true) cur.push(lap);
    else if (lap.isWork === false && cur.length) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);
  return blocks
    .map((b) => b.reduce((s, l) => s + (l.timerTimeS ?? l.elapsedTimeS ?? 0), 0))
    .filter((d) => d >= MIN_REP_BLOCK_DURATION_S_INGEST);
}

type Evidence = {
  tier: string;
  rank: number; // 0 = recent 10k/half race … higher = weaker
  confidence: "high" | "medium" | "low" | "very-low";
  proposedPace: number;
  proposedHr: number | null;
  basis: string;
  date: string;
  nReps?: number; // interval evidence: total qualifying reps pooled
};

type AthleteRow = {
  athleteId: number;
  name: string;
  currentPace: number | null;
  currentHr: number | null;
  speedMethod: number | null;
  speedCovered: boolean;
  evidence: Evidence | null;
  applied: { display: string; at: string } | null; // already applied & threshold unchanged since
};

async function main(): Promise<void> {
  const supabase = getSupabase();
  const months = Number(getCli("--months=") ?? 12);
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date();
  from.setDate(from.getDate() - Math.round(months * 30.44));
  const fromIso = from.toISOString().slice(0, 10);
  console.log(`tp-threshold-fullscan: window ${fromIso}..${today}. READ-ONLY.`);

  // names
  const nameById = new Map<number, string>();
  {
    const { data } = await supabase.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, student_name").not("student_name", "is", null);
    for (const r of data ?? []) {
      const id = Number(r.trainingpeaks_athlete_id);
      if (Number.isInteger(id) && typeof r.student_name === "string" && !nameById.has(id)) nameById.set(id, r.student_name);
    }
    const { data: students } = await supabase.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url");
    for (const r of students ?? []) {
      const url = typeof r.trainingpeaks_athlete_url === "string" ? r.trainingpeaks_athlete_url : null;
      const id = url ? parseAthleteIdFromUrl(url) : null;
      if (id !== null && id > 0 && typeof r.student_name === "string" && !nameById.has(id)) nameById.set(id, r.student_name);
    }
  }

  // current thresholds + method (newest snapshot per athlete) — this is our roster
  const current = new Map<number, { pace: number | null; hr: number | null; method: number | null }>();
  {
    const { data, error } = await supabase.from("tp_zone_snapshots").select("trainingpeaks_athlete_id, zones, captured_at").order("captured_at", { ascending: false });
    if (error) throw new Error(`tp_zone_snapshots: ${error.message}`);
    for (const r of data ?? []) {
      const id = Number(r.trainingpeaks_athlete_id);
      if (current.has(id)) continue;
      const z = r.zones as Record<string, unknown> | null;
      const sp = wt0(z?.speedZones);
      const hr = wt0(z?.heartRateZones);
      current.set(id, {
        pace: typeof sp?.threshold === "number" && sp.threshold > 0 ? 1000 / sp.threshold : null,
        hr: typeof hr?.threshold === "number" ? Math.round(hr.threshold) : null,
        method: typeof sp?.calculationMethod === "number" ? sp.calculationMethod : null,
      });
    }
  }
  console.log(`roster (snapshots): ${current.size}, names: ${nameById.size}`);

  const evidenceByAthlete = new Map<number, Evidence>();
  const consider = (id: number, e: Evidence): void => {
    const prev = evidenceByAthlete.get(id);
    if (!prev || e.rank < prev.rank || (e.rank === prev.rank && e.date > prev.date)) evidenceByAthlete.set(id, e);
  };

  // HR is intentionally NOT turned into a proposal (Igor: pace first, HR handled
  // separately). We only RECORD whatever HR exists, per athlete, into a separate file.
  const hrNotes = new Map<number, string[]>();
  const addHr = (id: number, note: string): void => {
    const arr = hrNotes.get(id) ?? [];
    arr.push(note);
    hrNotes.set(id, arr);
  };

  // Per-athlete baseline training pace (median of their run-like workouts) — used to GATE
  // races: a real race is FASTER than the athlete's typical pace, so a "race" that is
  // SLOWER than the median is not a competition (a walk / social run mislabelled by the
  // scanner) and is dropped. (Panina's 77:51 "10k" → threshold 7:14 was exactly this.)
  const baselinePace = new Map<number, number>();
  {
    const perAthlete = new Map<number, number[]>();
    for (let fromIdx = 0; ; fromIdx += 1000) {
      const { data } = await supabase.from("trainingpeaks_workout_cache")
        .select("trainingpeaks_athlete_id, completed_distance_raw, completed_time_raw")
        .gte("workout_date", fromIso).lte("workout_date", today)
        .range(fromIdx, fromIdx + 999);
      if (!data || data.length === 0) break;
      for (const w of data) {
        const m = typeof w.completed_distance_raw === "number" ? (w.completed_distance_raw as number) : 0;
        const tH = typeof w.completed_time_raw === "number" ? (w.completed_time_raw as number) : 0;
        if (m < 800 || tH <= 0) continue;
        const pace = (tH * 3600) / (m / 1000);
        if (pace < 210 || pace > 540) continue; // 3:30–9:00/km → run-like; drops bike/swim/walk
        const id = Number(w.trainingpeaks_athlete_id);
        const arr = perAthlete.get(id) ?? [];
        arr.push(pace);
        perAthlete.set(id, arr);
      }
      if (data.length < 1000) break;
    }
    for (const [id, ps] of perAthlete) if (ps.length >= 3) baselinePace.set(id, median(ps));
  }
  console.log(`baseline training pace computed for ${baselinePace.size} athletes`);

  // ── RACES (tier A/B) ──────────────────────────────────────────────────────
  const { data: raceRows } = await supabase
    .from("trainingpeaks_race_events")
    .select("trainingpeaks_athlete_id, event_date, distance_km")
    .gte("event_date", fromIso).lte("event_date", today)
    .order("event_date", { ascending: false });
  const races = (raceRows ?? []).filter((r) => typeof r.distance_km === "number" && (r.distance_km as number) > 0);
  const classify = (km: number): { tier: string; rank: number } => {
    if (km >= 9.5 && km <= 10.5) return { tier: "10к забег", rank: 0 };
    if (km >= 20 && km <= 21.6) return { tier: "полумарафон", rank: 0 };
    if (km >= 4.5 && km <= 5.5) return { tier: "5к забег", rank: 1 };
    if (km >= 41.5 && km <= 43) return { tier: "марафон", rank: 1 };
    return { tier: `${km}км забег`, rank: 2 };
  };
  let raceMatched = 0;
  let racesDroppedSlow = 0;
  for (const r of races) {
    const id = Number(r.trainingpeaks_athlete_id);
    const officialM = (r.distance_km as number) * 1000;
    const { data: wc } = await supabase.from("trainingpeaks_workout_cache")
      .select("id, completed_distance_raw, completed_time_raw")
      .eq("trainingpeaks_athlete_id", id).eq("workout_date", r.event_date);
    let best: { cacheId: string; measM: number; timeSec: number } | null = null;
    for (const w of wc ?? []) {
      const measM = typeof w.completed_distance_raw === "number" ? (w.completed_distance_raw as number) : 0;
      const tH = typeof w.completed_time_raw === "number" ? (w.completed_time_raw as number) : 0;
      if (measM <= 0 || tH <= 0 || Math.abs(measM - officialM) / officialM > 0.15) continue;
      const c = { cacheId: w.id as string, measM, timeSec: tH * 3600 };
      if (!best || Math.abs(c.measM - officialM) < Math.abs(best.measM - officialM)) best = c;
    }
    if (!best) continue;
    const measuredPace = best.timeSec / (best.measM / 1000);
    if (!(measuredPace > 120 && measuredPace < 600)) continue;
    // GATE: a race must be faster than the athlete's typical training pace. A "race"
    // slower than the median is not a competition — drop it (not a real result).
    const base = baselinePace.get(id);
    if (base !== undefined && measuredPace >= base) {
      racesDroppedSlow += 1;
      continue;
    }
    const proposed = ftpaSecPerKm(vdotFromRace(best.measM, best.timeSec));
    if (!(proposed > 150 && proposed < 540)) continue;
    // HR recorded separately (not a proposal)
    const { data: dm } = await supabase.from("trainingpeaks_workout_derived_metrics").select("avg_hr, hr_trusted").eq("workout_cache_id", best.cacheId).limit(1);
    const d0 = (dm ?? [])[0];
    if (d0 && d0.hr_trusted === true && typeof d0.avg_hr === "number") addHr(id, `забег ${r.event_date} (${r.distance_km}км): ср.пульс ${Math.round(d0.avg_hr as number)}`);
    const cls = classify(r.distance_km as number);
    raceMatched += 1;
    consider(id, {
      tier: cls.tier, rank: cls.rank, confidence: cls.rank === 0 ? "high" : "medium",
      proposedPace: proposed, proposedHr: null,
      basis: `${r.event_date} · ${r.distance_km}км · ${fmtClock(best.timeSec)} (изм. темп ${fmtPace(measuredPace)})`,
      date: r.event_date as string,
    });
  }
  console.log(`races matched: ${raceMatched}/${races.length} · dropped as too-slow (not a race): ${racesDroppedSlow}`);

  // ── LONG INTERVALS (tier D) ──────────────────────────────────────────────
  type DmRow = { trainingpeaks_athlete_id: number; workout_cache_id: string; workout_date: string; hr_trusted: boolean | null; reps_detected_count: number | null; rep_paces: number[] | null; rep_peak_hrs: number[] | null };
  const dmRows: DmRow[] = [];
  for (let fromIdx = 0; ; fromIdx += 1000) {
    const { data, error } = await supabase.from("trainingpeaks_workout_derived_metrics")
      .select("trainingpeaks_athlete_id, workout_cache_id, workout_date, hr_trusted, reps_detected_count, rep_paces, rep_peak_hrs")
      .eq("workout_type", "run").eq("has_fit", true).gt("reps_detected_count", 0)
      .gte("workout_date", fromIso).lte("workout_date", today)
      .range(fromIdx, fromIdx + 999);
    if (error) throw new Error(`derived_metrics: ${error.message}`);
    if (!data || data.length === 0) break;
    dmRows.push(...(data as DmRow[]));
    if (data.length < 1000) break;
  }
  console.log(`interval workouts in window: ${dmRows.length}`);

  // laps for those workouts (chunked)
  const lapsByCache = new Map<string, Lap[]>();
  {
    const ids = [...new Set(dmRows.map((r) => r.workout_cache_id))];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { data } = await supabase.from("trainingpeaks_workout_laps")
        .select("workout_cache_id, lap_index, timer_time_s, elapsed_time_s, is_work").in("workout_cache_id", chunk);
      for (const l of data ?? []) {
        const key = l.workout_cache_id as string;
        const lap: Lap = { lapIndex: l.lap_index as number, timerTimeS: l.timer_time_s as number, elapsedTimeS: l.elapsed_time_s as number, isWork: l.is_work as boolean };
        const arr = lapsByCache.get(key);
        if (arr) arr.push(lap); else lapsByCache.set(key, [lap]);
      }
    }
  }

  // Pool ALL qualifying ≥6-min reps per athlete across sessions — a single rep is
  // noise (Igor's rule: one point is not an estimate), so we aggregate and grade
  // confidence by how many reps/sessions back it.
  const pool = new Map<number, { paces: number[]; hrs: number[]; sessions: Set<string>; latest: string }>();
  let intervalUsable = 0;
  for (const dm of dmRows) {
    if (!Array.isArray(dm.rep_paces) || dm.rep_paces.length === 0) continue;
    const durations = repBlockDurations(lapsByCache.get(dm.workout_cache_id) ?? []);
    if (durations.length !== dm.rep_paces.length) continue; // can't align → skip
    const longIdx = durations.map((d, i) => (d >= LONG_REP_MIN_DURATION_S ? i : -1)).filter((i) => i >= 0);
    if (longIdx.length === 0) continue;
    const paces = longIdx.map((i) => dm.rep_paces![i]).filter((p) => p > 150 && p < 540);
    if (paces.length === 0) continue;
    intervalUsable += 1;
    const id = Number(dm.trainingpeaks_athlete_id);
    const acc = pool.get(id) ?? { paces: [], hrs: [], sessions: new Set<string>(), latest: "" };
    acc.paces.push(...paces);
    acc.sessions.add(dm.workout_date);
    if (dm.workout_date > acc.latest) acc.latest = dm.workout_date;
    if (dm.hr_trusted === true && Array.isArray(dm.rep_peak_hrs)) {
      for (const i of longIdx) {
        const h = dm.rep_peak_hrs[i];
        if (typeof h === "number" && h >= 120 && h <= 210) acc.hrs.push(h);
      }
    }
    pool.set(id, acc);
  }
  for (const [id, acc] of pool) {
    const nReps = acc.paces.length;
    const nSessions = acc.sessions.size;
    // confidence by evidence volume; a single rep is "very-low" (flagged, editable)
    const confidence: Evidence["confidence"] = nReps >= 6 && nSessions >= 3 ? "medium" : nReps >= 3 ? "low" : "very-low";
    if (acc.hrs.length) addHr(id, `интервалы ≥6мин: медиана пика репов ${Math.round(median(acc.hrs))}`);
    consider(id, {
      tier: "интервалы ≥6мин",
      rank: 4,
      confidence,
      proposedPace: median(acc.paces),
      proposedHr: null,
      basis: `${nReps} реп(ов) ≥6мин в ${nSessions} трен. (медиана темпа), последняя ${acc.latest}`,
      date: acc.latest,
      nReps,
    });
  }
  console.log(`interval workouts usable: ${intervalUsable}; athletes with interval evidence: ${pool.size}`);

  // ── CONTINUOUS TEMPO (tier C — structural, NOT title-based) ────────────────
  // reps=0 & steady≥20min. Title search gave 1 point roster-wide last time, so this is
  // purely structural. To avoid warm-up drag we keep only runs whose steady effort is the
  // MAJORITY of the workout, use the whole-workout pace as the tempo pace, and adjust to
  // threshold by the DURATION band (tempoOffsetSecPerKm). Pooled per athlete like intervals.
  type TempoDm = { trainingpeaks_athlete_id: number; workout_cache_id: string; workout_date: string; steady_duration_s: number | null; hr_trusted: boolean | null; avg_hr: number | null };
  const tempoRows: TempoDm[] = [];
  for (let fromIdx = 0; ; fromIdx += 1000) {
    const { data, error } = await supabase.from("trainingpeaks_workout_derived_metrics")
      .select("trainingpeaks_athlete_id, workout_cache_id, workout_date, steady_duration_s, hr_trusted, avg_hr")
      .eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0)
      .gte("steady_duration_s", TEMPO_MIN_STEADY_S)
      .gte("workout_date", fromIso).lte("workout_date", today)
      .range(fromIdx, fromIdx + 999);
    if (error) throw new Error(`tempo dm: ${error.message}`);
    if (!data || data.length === 0) break;
    tempoRows.push(...(data as TempoDm[]));
    if (data.length < 1000) break;
  }
  // laps for tempo workouts — we take the EFFORT pace (the fast 60% of distance),
  // NOT the whole-workout pace, so warm-up/cool-down/jog don't drag the estimate slow.
  const tempoLaps = new Map<string, { d: number; t: number }[]>();
  {
    const ids = [...new Set(tempoRows.map((r) => r.workout_cache_id))];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { data } = await supabase.from("trainingpeaks_workout_laps").select("workout_cache_id, distance_m, timer_time_s").in("workout_cache_id", chunk);
      for (const l of data ?? []) {
        const d = typeof l.distance_m === "number" ? (l.distance_m as number) : 0;
        const t = typeof l.timer_time_s === "number" ? (l.timer_time_s as number) : 0;
        if (d <= 0 || t <= 0) continue;
        const key = l.workout_cache_id as string;
        const arr = tempoLaps.get(key) ?? [];
        arr.push({ d, t });
        tempoLaps.set(key, arr);
      }
    }
  }
  const effortPaceFromLaps = (laps: { d: number; t: number }[], frac: number): number | null => {
    if (laps.length < 2) return null;
    const total = laps.reduce((s, l) => s + l.d, 0);
    const sorted = [...laps].sort((a, b) => a.t / a.d - b.t / b.d); // fastest laps first
    let accD = 0;
    let accT = 0;
    for (const l of sorted) {
      if (accD >= frac * total) break;
      accD += l.d;
      accT += l.t;
    }
    return accD > 0 ? accT / (accD / 1000) : null;
  };
  const tempoPool = new Map<number, { paces: number[]; sessions: Set<string>; latest: string; bands: Set<string> }>();
  let tempoUsable = 0;
  for (const t of tempoRows) {
    const laps = tempoLaps.get(t.workout_cache_id);
    if (!laps) continue;
    const steadyS = t.steady_duration_s ?? 0;
    const tempoPace = effortPaceFromLaps(laps, 0.6); // pace of the fast 60% (the effort)
    if (tempoPace === null || !(tempoPace > 150 && tempoPace < 540)) continue;
    const est = tempoPace + tempoOffsetSecPerKm(steadyS);
    tempoUsable += 1;
    const id = Number(t.trainingpeaks_athlete_id);
    const acc = tempoPool.get(id) ?? { paces: [], sessions: new Set<string>(), latest: "", bands: new Set<string>() };
    acc.paces.push(est);
    acc.sessions.add(t.workout_date);
    acc.bands.add(tempoBand(steadyS));
    if (t.workout_date > acc.latest) acc.latest = t.workout_date;
    tempoPool.set(id, acc);
    if (t.hr_trusted === true && typeof t.avg_hr === "number") addHr(id, `темпо ${t.workout_date}: ср.пульс ${Math.round(t.avg_hr)}`);
  }
  // "steady ≥20min" alone catches EASY runs too, so the median would read easy pace.
  // The tempo/threshold efforts are the FAST tail: take p20 of the duration-adjusted
  // estimates (the faster ~20% of sustained runs). Need ≥3 runs for a stable percentile.
  let tempoAthletes = 0;
  for (const [id, acc] of tempoPool) {
    const n = acc.paces.length;
    const ns = acc.sessions.size;
    if (n < 3) continue; // too few sustained runs to isolate a fast tail — skip
    tempoAthletes += 1;
    const confidence: Evidence["confidence"] = n >= 15 ? "medium" : n >= 6 ? "low" : "very-low";
    consider(id, {
      tier: "темпо ≥20мин",
      rank: 5,
      confidence,
      proposedPace: percentile(acc.paces, 0.2),
      proposedHr: null,
      basis: `${n} непрерывн. ≥20мин в ${ns} трен. — оценка по быстрым усилиям (p20) + поправка по длит. (${[...acc.bands].join("/")}); последняя ${acc.latest}`,
      date: acc.latest,
      nReps: n,
    });
  }
  console.log(`tempo workouts usable: ${tempoUsable}; athletes with tempo evidence (≥3 runs): ${tempoAthletes}`);

  // ── already-applied log ───────────────────────────────────────────────────
  const appliedPace = new Map<number, { valueAfter: number; display: string; at: string }>();
  {
    const { data } = await supabase
      .from("tp_threshold_applications")
      .select("trainingpeaks_athlete_id, value_after, value_after_display, applied_at")
      .eq("kind", "pace")
      .order("applied_at", { ascending: false });
    for (const r of data ?? []) {
      const id = Number(r.trainingpeaks_athlete_id);
      if (!appliedPace.has(id) && typeof r.value_after === "number") {
        appliedPace.set(id, { valueAfter: r.value_after as number, display: (r.value_after_display as string) ?? "", at: r.applied_at as string });
      }
    }
  }

  // For each logged athlete read the LIVE TP threshold — the ONLY source of truth.
  // The snapshot is written at apply time so it always equals value_after and would
  // hide a later hand-edit in the web forever. A live GET catches that edit: if the
  // live threshold no longer equals value_after, the athlete returns to the list (and
  // we show the live value as their current). Live check only for logged athletes (few).
  const liveThreshold = new Map<number, number>(); // athleteId → live wt0 speed threshold (m/s)
  if (appliedPace.size > 0) {
    console.log(`live threshold check (GET /settings) for ${appliedPace.size} applied athletes…`);
    for (const id of appliedPace.keys()) {
      try {
        const settings = await getAthleteSettings(id);
        const sp = wt0(settings.speedZones);
        if (sp && typeof sp.threshold === "number") liveThreshold.set(id, sp.threshold);
      } catch (e) {
        // dead cookie / error → can't verify live: do NOT hide (safer to show them).
        console.warn(`  live check failed for ${id} — will NOT hide: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── assemble every roster athlete ─────────────────────────────────────────
  const rows: AthleteRow[] = [];
  for (const [id, cur] of current) {
    const app = appliedPace.get(id);
    const live = liveThreshold.get(id); // m/s, live from TP (logged athletes only)
    // applied & unchanged = a pace application exists AND the LIVE TP threshold still
    // equals value_after. Hand-edit in TP (live ≠ value_after) → not applied → returns.
    const applied = app && live !== undefined && Math.abs(live - app.valueAfter) < 5e-3 ? { display: app.display, at: app.at } : null;
    // For a logged athlete, prefer the LIVE threshold as their displayed current pace
    // (reflects a hand-edit); everyone else uses the snapshot value.
    const currentPace = live !== undefined && live > 0 ? 1000 / live : cur.pace;
    rows.push({
      athleteId: id,
      name: nameById.get(id) ?? `id ${id}`,
      currentPace,
      currentHr: cur.hr,
      speedMethod: cur.method,
      speedCovered: cur.method !== null && getCoveredScheme("speed", cur.method) !== null,
      evidence: evidenceByAthlete.get(id) ?? null,
      applied,
    });
  }
  rows.sort((a, b) => {
    const ra = a.evidence?.rank ?? 99;
    const rb = b.evidence?.rank ?? 99;
    if (ra !== rb) return ra - rb;
    const da = a.evidence?.date ?? "";
    const db = b.evidence?.date ?? "";
    return db.localeCompare(da);
  });

  const appliedRows = rows.filter((r) => r.applied);
  const candidate = rows.filter((r) => !r.applied); // not yet applied → still needs a decision
  const withRace = candidate.filter((r) => r.evidence && r.evidence.rank <= 2);
  const byVolThenDate = (a: AthleteRow, b: AthleteRow) => (b.evidence!.nReps ?? 0) - (a.evidence!.nReps ?? 0) || b.evidence!.date.localeCompare(a.evidence!.date);
  const withInterval = candidate.filter((r) => r.evidence && r.evidence.rank === 4).sort(byVolThenDate);
  const withTempo = candidate.filter((r) => r.evidence && r.evidence.rank === 5).sort(byVolThenDate);
  const noData = candidate.filter((r) => !r.evidence);
  const remaining = withRace.length + withInterval.length + withTempo.length; // have evidence, not yet applied
  console.log(`\n── aggregates ──\nПРИМЕНЕНО: ${appliedRows.length} · ОСТАЛОСЬ кандидатов: ${remaining} (забег ${withRace.length} · интервалы ${withInterval.length} · темпо ${withTempo.length}) · без данных ${noData.length} · всего ${rows.length}`);

  // ── JSON for the artifact ─────────────────────────────────────────────────
  const outDir = path.join(toolRoot, "action-artifacts", "threshold-candidates");
  mkdirSync(outDir, { recursive: true });
  const json = {
    generated: today,
    window_from: fromIso,
    rows: rows.map((r) => ({
      athlete_id: r.athleteId,
      name: r.name,
      current_pace_sec: r.currentPace,
      current_pace: fmtPace(r.currentPace),
      current_hr: r.currentHr,
      speed_method: r.speedMethod,
      speed_covered: r.speedCovered,
      tier: r.evidence?.tier ?? null,
      confidence: r.evidence?.confidence ?? null,
      proposed_pace_sec: r.evidence?.proposedPace ?? null,
      proposed_pace: r.evidence ? fmtPace(r.evidence.proposedPace) : null,
      proposed_hr: r.evidence?.proposedHr ?? null,
      basis: r.evidence?.basis ?? null,
      evidence_date: r.evidence?.date ?? null,
      applied: r.applied != null,
      applied_display: r.applied?.display ?? null,
      applied_at: r.applied?.at ?? null,
    })),
    aggregates: { applied: appliedRows.length, remaining, no_data: noData.length, total: rows.length },
  };
  writeFileSync(path.join(outDir, "fullscan.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(`JSON: ${path.join(outDir, "fullscan.json")}`);

  // ── markdown summary ──────────────────────────────────────────────────────
  const md: string[] = [];
  const delta = (r: AthleteRow): string => {
    if (!r.evidence || r.currentPace === null) return "—";
    const d = Math.round(r.evidence.proposedPace - r.currentPace);
    return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}с`;
  };
  const rowMd = (r: AthleteRow): string =>
    `| ${r.name} | ${fmtPace(r.currentPace)} | ${r.evidence ? `**${fmtPace(r.evidence.proposedPace)}**` : "—"} | ${delta(r)} | ${r.evidence?.basis ?? "—"} | ${r.evidence?.tier ?? "—"} | ${r.evidence?.confidence ?? "—"} | ${r.speedCovered ? "✅" : `❌ м${r.speedMethod ?? "?"}`} |`;
  const head = `| имя | тек.темп | предлаг | Δ | на чём | тир | надёжность | метод |\n|---|---|---|---|---|---|---|---|`;
  md.push(`# Полный скан кандидатов на порог — ТЕМП (read-only, ${today})`);
  md.push(`**ПРИМЕНЕНО: ${appliedRows.length} · ОСТАЛОСЬ кандидатов с доказательством: ${remaining} · без данных: ${noData.length} · всего: ${rows.length}.**`);
  md.push(`Применённые (порог уже выставлен и с тех пор не менялся) исключены из списков ниже; поправишь порог руками в TP — человек вернётся (скан сверяет с ЖИВЫМ порогом из GET /settings, не со снапшотом). Только темп (пульс — hr-reference.md). Тиры по надёжности: забег (vdot.ts FTPa) > интервалы ≥6мин > темпо ≥20мин (структурно, поправка по длительности 20–30→0, 30–45→−8, 45+→−18 сек/км, Daniels T↔M). Забеги медленнее обычного тренировочного темпа отсеяны (${racesDroppedSlow} шт). Текущий порог из tp_zone_snapshots.`);
  md.push("");
  if (appliedRows.length) {
    md.push(`## ✓ Применено — ${appliedRows.length}`);
    md.push(`| имя | порог | когда |\n|---|---|---|`);
    for (const r of appliedRows) md.push(`| ${r.name} | ${r.applied?.display ?? fmtPace(r.currentPace)} | ${(r.applied?.at ?? "").slice(0, 10)} |`);
    md.push("");
  }
  md.push(`## 1. По забегу (свежие 10к/полумарафон сверху) — ${withRace.length}`);
  md.push(head);
  for (const r of withRace) md.push(rowMd(r));
  md.push("");
  md.push(`## 2. По интервалам ≥6мин (нет пригодного забега) — ${withInterval.length}`);
  md.push(head);
  for (const r of withInterval) md.push(rowMd(r));
  md.push("");
  md.push(`## 3. По темпо ≥20мин (нет забега/интервалов) — ${withTempo.length}`);
  md.push(head);
  for (const r of withTempo) md.push(rowMd(r));
  md.push("");
  md.push(`## 4. Совсем нет данных — ${noData.length}`);
  md.push(`| имя | тек.темп | метод |\n|---|---|---|`);
  for (const r of noData) md.push(`| ${r.name} | ${fmtPace(r.currentPace)} | ${r.speedCovered ? "✅" : `❌ м${r.speedMethod ?? "?"}`} |`);
  writeFileSync(path.join(outDir, "fullscan.md"), `${md.join("\n")}\n`, "utf8");
  console.log(`MD: ${path.join(outDir, "fullscan.md")}`);

  // ── HR reference (SEPARATE — recorded, not proposed) ──────────────────────
  const hr: string[] = [];
  hr.push(`# Пульс — справочно (read-only, ${today})`);
  hr.push(`Пороговый пульс НЕ рассчитывался (по решению Игоря — темп в приоритете). Здесь только сырой пульс с забегов/темпо/интервалов, где FIT-пульс надёжен, чтобы решить позже. Имя · заметки.`);
  hr.push("");
  const named = [...hrNotes.entries()].map(([id, notes]) => ({ name: nameById.get(id) ?? `id ${id}`, notes })).sort((a, b) => a.name.localeCompare(b.name));
  for (const a of named) {
    hr.push(`- **${a.name}** — ${a.notes.join(" · ")}`);
  }
  hr.push("");
  hr.push(`Атлетов с каким-либо надёжным пульсом: ${named.length}.`);
  writeFileSync(path.join(outDir, "hr-reference.md"), `${hr.join("\n")}\n`, "utf8");
  console.log(`HR: ${path.join(outDir, "hr-reference.md")}`);
}

main().catch((e: unknown) => {
  console.error("tp-threshold-fullscan failed.");
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
