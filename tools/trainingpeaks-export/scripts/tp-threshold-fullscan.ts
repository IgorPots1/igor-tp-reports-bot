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
import { ftpaSecPerKm, vdotFromRace } from "../../../src/app/tools/plan/vdot.ts";
import { toolRoot } from "./lib/paths.ts";
import { getCoveredScheme } from "./lib/tp-zone-formulas.ts";

const LONG_REP_MIN_DURATION_S = 360; // 6 minutes
const MIN_REP_BLOCK_DURATION_S_INGEST = 45; // matches fit-lap-work-detection

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
    const proposed = ftpaSecPerKm(vdotFromRace(best.measM, best.timeSec));
    if (!(proposed > 150 && proposed < 540) || !(measuredPace > 120 && measuredPace < 600)) continue;
    let hr: number | null = null;
    const { data: dm } = await supabase.from("trainingpeaks_workout_derived_metrics").select("avg_hr, hr_trusted").eq("workout_cache_id", best.cacheId).limit(1);
    const d0 = (dm ?? [])[0];
    if (d0 && d0.hr_trusted === true && typeof d0.avg_hr === "number") hr = Math.round(d0.avg_hr as number);
    const cls = classify(r.distance_km as number);
    raceMatched += 1;
    consider(id, {
      tier: cls.tier, rank: cls.rank, confidence: cls.rank === 0 ? "high" : "medium",
      proposedPace: proposed, proposedHr: hr,
      basis: `${r.event_date} · ${r.distance_km}км · ${fmtClock(best.timeSec)} (изм. темп ${fmtPace(measuredPace)})`,
      date: r.event_date as string,
    });
  }
  console.log(`races matched to a workout time: ${raceMatched}/${races.length}`);

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
    consider(id, {
      tier: "интервалы ≥6мин",
      rank: 5,
      confidence,
      proposedPace: median(acc.paces),
      proposedHr: acc.hrs.length ? Math.round(median(acc.hrs)) : null,
      basis: `${nReps} реп(ов) ≥6мин в ${nSessions} трен. (медиана темпа), последняя ${acc.latest}`,
      date: acc.latest,
      nReps,
    });
  }
  console.log(`interval workouts usable: ${intervalUsable}; athletes with interval evidence: ${pool.size}`);

  // ── assemble every roster athlete ─────────────────────────────────────────
  const rows: AthleteRow[] = [];
  for (const [id, cur] of current) {
    rows.push({
      athleteId: id,
      name: nameById.get(id) ?? `id ${id}`,
      currentPace: cur.pace,
      currentHr: cur.hr,
      speedMethod: cur.method,
      speedCovered: cur.method !== null && getCoveredScheme("speed", cur.method) !== null,
      evidence: evidenceByAthlete.get(id) ?? null,
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

  const withRace = rows.filter((r) => r.evidence && r.evidence.rank <= 2);
  // intervals: strongest evidence (most reps) first, then most recent
  const withInterval = rows
    .filter((r) => r.evidence && r.evidence.rank === 5)
    .sort((a, b) => (b.evidence!.nReps ?? 0) - (a.evidence!.nReps ?? 0) || (b.evidence!.date).localeCompare(a.evidence!.date));
  const noData = rows.filter((r) => !r.evidence);
  console.log(`\n── aggregates ──\nrace-based: ${withRace.length} · interval-based: ${withInterval.length} · no-data: ${noData.length} · total roster: ${rows.length}`);

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
    })),
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
    `| ${r.name} | ${fmtPace(r.currentPace)} | ${r.evidence ? `**${fmtPace(r.evidence.proposedPace)}**` : "—"} | ${delta(r)} | ${r.currentHr ?? "—"} | ${r.evidence?.proposedHr ?? "—"} | ${r.evidence?.basis ?? "—"} | ${r.evidence?.tier ?? "—"} | ${r.evidence?.confidence ?? "—"} | ${r.speedCovered ? "✅" : `❌ м${r.speedMethod ?? "?"}`} |`;
  md.push(`# Полный скан кандидатов на порог (read-only, ${today})`);
  md.push(`Забеги (тир A/B, движок vdot.ts FTPa) + длинные интервалы ≥6мин (тир D, темп репов ≈ порог, ниже надёжность). Пульс — где надёжен. Темп в мин/км. Текущий порог из tp_zone_snapshots (на запись CLI читает живой TP).`);
  md.push("");
  md.push(`## 1. По забегу (свежие 10к/полумарафон сверху) — ${withRace.length}`);
  md.push(`| имя | тек.темп | предлаг | Δ | тек.пульс | предлаг.пульс | на чём | тир | надёжность | метод |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of withRace) md.push(rowMd(r));
  md.push("");
  md.push(`## 2. По интервалам (нет пригодного забега) — ${withInterval.length}`);
  md.push(`| имя | тек.темп | предлаг | Δ | тек.пульс | предлаг.пульс | на чём | тир | надёжность | метод |`);
  md.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of withInterval) md.push(rowMd(r));
  md.push("");
  md.push(`## 3. Совсем нет данных (ни забега, ни длинных интервалов) — ${noData.length}`);
  md.push(`| имя | тек.темп | метод |`);
  md.push(`|---|---|---|`);
  for (const r of noData) md.push(`| ${r.name} | ${fmtPace(r.currentPace)} | ${r.speedCovered ? "✅" : `❌ м${r.speedMethod ?? "?"}`} |`);
  writeFileSync(path.join(outDir, "fullscan.md"), `${md.join("\n")}\n`, "utf8");
  console.log(`MD: ${path.join(outDir, "fullscan.md")}`);
}

main().catch((e: unknown) => {
  console.error("tp-threshold-fullscan failed.");
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
