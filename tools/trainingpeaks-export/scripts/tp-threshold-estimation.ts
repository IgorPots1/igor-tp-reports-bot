/**
 * READ-ONLY threshold pace / threshold HR estimation across the roster.
 *
 * NO TrainingPeaks calls of any kind (no reads, no writes). This reads ONLY our
 * own Supabase (already-ingested FIT-derived data) and computes estimates.
 * Never prints athlete names — only athlete_id and aggregates go to stdout;
 * per-athlete rows in the output table use athlete_id only.
 *
 * Evidence types (see docs/threshold-estimation-method.md for full rationale):
 *   A — 10km races: pace + avg HR of the second half.
 *   B — other race distances (5k/half/marathon/other), distance-marked.
 *   C — long continuous tempo runs >=20min steady: pace + avg HR of the last 2/3.
 *   D — long interval reps (>=6min each): rep pace + rep peak HR.
 *
 * Each evidence type carries an explicit, documented pace/HR offset that converts
 * the observed value to a threshold-equivalent estimate (e.g. a 5k is run faster
 * than threshold, so its pace gets slowed down by a fixed offset). These offsets
 * are literature-grounded coaching heuristics (Daniels/Friel-style), NOT derived
 * from this roster's own data — treat estimates as directional, not clinical.
 *
 * Reuses existing, already-computed fields wherever possible instead of
 * re-deriving them from raw FIT (which isn't persisted): hr_trusted (HR quality
 * gate), rep_paces/rep_peak_hrs (already HR-cleaned), steady_duration_s,
 * reps_detected_count. Lap-level (trainingpeaks_workout_laps) data is used only
 * for (a) first/second-half and last-2/3 splits and (b) reconstructing rep-block
 * durations to filter for >=6min reps.
 *
 * Usage: npx tsx tools/trainingpeaks-export/scripts/tp-threshold-estimation.ts
 *          [--months=6] [--out=<path>]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";

// ── env loading (same inline pattern as other tp-*.ts scripts) ────────────────

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  let content: string;
  try {
    content = readFileSync(dotEnvPath, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(p);
  }
}
function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  return value;
}
function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getCliValue(prefix: string): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

// ── sanity bounds (matches fit-data-sanity.ts's whole-workout pace bounds) ─────
const PACE_SANE_MIN_SEC_PER_KM = 180;
const PACE_SANE_MAX_SEC_PER_KM = 570;
const HR_SANE_MIN_BPM = 130;
const HR_SANE_MAX_BPM = 205;
const MIN_REP_BLOCK_DURATION_S_INGEST = 45; // must match fit-lap-work-detection.ts's MIN_REP_BLOCK_DURATION_S
const LONG_REP_MIN_DURATION_S = 360; // 6 minutes — evidence D's own threshold

// There is no persisted intensity classification in this codebase (confirmed:
// workout_type is sport-family only — 'run' — not easy/tempo/long; time_in_zones
// is relative to max HR with no threshold profile; planned_target is unpopulated).
// A pure "steady, no intervals, >=20min" filter would catch ordinary easy/long
// runs too (verified: an early version of this script did exactly that and
// produced a 20-48% "threshold" pace gap for most athletes — a dead giveaway of
// easy-run contamination). The only non-circular, already-available signal for
// "this was run AS a tempo/threshold effort" is the workout title.
//
// IMPORTANT: bare "темп" is a false friend — in Russian it just means "pace" and
// shows up in titles for ALL intensities, including explicitly easy runs
// ("Легкий бег по темпу" = "easy run at [some] pace") and marathon-pace runs
// ("в темпе марафона"). A first version of this filter matched bare "темп" and
// let those through, reproducing the same easy-run contamination bug. The
// positive match below requires the specific "темпов-" stem (Темповый/темповая
// бег — an explicit "tempo run" label), or an unambiguous English/threshold
// term. Titles are additionally rejected if they carry an easy marker, a
// marathon-pace marker, or an interval-repetition pattern ("8 x 1000") — the
// last one guards against a disguised interval slipping in when lap-based rep
// detection failed to find a rest lap (reps_detected_count would read 0).
const TEMPO_TITLE_POSITIVE = /темпов|tempo|threshold|порог/i;
const TEMPO_TITLE_EXCLUDE = /легк|easy|марафон|marathon|\d+\s*[xх]\s*\d/i;
function isTempoTitle(title: string): boolean {
  return TEMPO_TITLE_POSITIVE.test(title) && !TEMPO_TITLE_EXCLUDE.test(title);
}

// ── evidence tiers and their threshold-conversion offsets ─────────────────────
// threshold_estimate = evidence_value + offset. See docs/threshold-estimation-method.md.
type Tier = "A_10k" | "B_5k" | "B_half" | "B_marathon" | "B_other" | "C_tempo" | "D_intervals";

const PACE_OFFSET_SEC_PER_KM: Record<Tier, number> = {
  A_10k: 0,
  B_5k: 14,
  B_half: -6,
  B_marathon: -32,
  B_other: 0,
  C_tempo: 0,
  D_intervals: 10,
};
const HR_OFFSET_BPM: Record<Tier, number> = {
  A_10k: 0,
  B_5k: -4,
  B_half: 3,
  B_marathon: 8,
  B_other: 0,
  C_tempo: 0,
  D_intervals: -3,
};
// Priority order for picking the PRIMARY basis when an athlete has multiple
// tiers of evidence: zero-offset tiers (most direct proxies) first, then race
// distances closest to threshold-effort duration, intervals last (most
// reconstruction uncertainty).
const TIER_PRIORITY: Tier[] = ["A_10k", "C_tempo", "B_half", "B_5k", "B_marathon", "B_other", "D_intervals"];
const TIER_LETTER: Record<Tier, "A" | "B" | "C" | "D"> = {
  A_10k: "A",
  B_5k: "B",
  B_half: "B",
  B_marathon: "B",
  B_other: "B",
  C_tempo: "C",
  D_intervals: "D",
};

type Lap = {
  lapIndex: number;
  distanceM: number | null;
  timerTimeS: number | null;
  elapsedTimeS: number | null;
  avgHr: number | null;
  isWork: boolean | null;
};

type EvidencePoint = {
  athleteId: number;
  tier: Tier;
  workoutDate: string;
  paceSecPerKm: number | null;
  hrBpm: number | null;
};

// ── lap-level split helpers ────────────────────────────────────────────────────

function validLaps(laps: Lap[]): Lap[] {
  return laps
    .filter((l) => l.isWork !== false && l.distanceM !== null && l.distanceM > 0 && l.timerTimeS !== null && l.timerTimeS > 0)
    .sort((a, b) => a.lapIndex - b.lapIndex);
}

function summarizeSegment(laps: Lap[]): { paceSecPerKm: number; avgHr: number | null; distanceM: number } {
  const distanceM = laps.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  const timeS = laps.reduce((sum, l) => sum + (l.timerTimeS ?? 0), 0);
  const hrLaps = laps.filter((l) => l.avgHr !== null);
  const hrWeightedSum = hrLaps.reduce((sum, l) => sum + l.avgHr! * (l.distanceM ?? 0), 0);
  const hrWeightDistance = hrLaps.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  return {
    paceSecPerKm: timeS / (distanceM / 1000),
    avgHr: hrWeightDistance > 0 ? hrWeightedSum / hrWeightDistance : null,
    distanceM,
  };
}

/** Split by cumulative distance at the 50% mark; each lap assigned whole to the
 *  half its own midpoint falls in (ported from feedback/split-half.ts). */
function computeSecondHalf(laps: Lap[]): { paceSecPerKm: number; avgHr: number | null } | null {
  const valid = validLaps(laps);
  if (valid.length < 2) return null;
  const totalDistanceM = valid.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  const halfDistanceM = totalDistanceM / 2;
  const secondHalf: Lap[] = [];
  let cumulativeM = 0;
  let firstHalfCount = 0;
  for (const lap of valid) {
    const lapDistanceM = lap.distanceM ?? 0;
    const midpointM = cumulativeM + lapDistanceM / 2;
    if (midpointM < halfDistanceM) firstHalfCount += 1;
    else secondHalf.push(lap);
    cumulativeM += lapDistanceM;
  }
  if (firstHalfCount === 0 || secondHalf.length === 0) return null;
  const second = summarizeSegment(secondHalf);
  return { paceSecPerKm: second.paceSecPerKm, avgHr: second.avgHr };
}

/** Same idea, split at the 33% cumulative-distance mark; returns the LAST 2/3. */
function computeLastTwoThirds(laps: Lap[]): { paceSecPerKm: number; avgHr: number | null } | null {
  const valid = validLaps(laps);
  if (valid.length < 2) return null;
  const totalDistanceM = valid.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  const oneThirdM = totalDistanceM / 3;
  const lastTwoThirds: Lap[] = [];
  let cumulativeM = 0;
  let firstThirdCount = 0;
  for (const lap of valid) {
    const lapDistanceM = lap.distanceM ?? 0;
    const midpointM = cumulativeM + lapDistanceM / 2;
    if (midpointM < oneThirdM) firstThirdCount += 1;
    else lastTwoThirds.push(lap);
    cumulativeM += lapDistanceM;
  }
  if (firstThirdCount === 0 || lastTwoThirds.length === 0) return null;
  const seg = summarizeSegment(lastTwoThirds);
  return { paceSecPerKm: seg.paceSecPerKm, avgHr: seg.avgHr };
}

/** Merge consecutive is_work=true laps into blocks, mirroring buildWorkBlocks in
 *  fit-lap-work-detection.ts: a false lap closes an open block; null/missing
 *  laps are skipped (neither extend nor break). Returns block durations in the
 *  SAME order the ingest pipeline produced them in (so index i lines up with
 *  derived_metrics.rep_paces[i] / rep_peak_hrs[i]), filtered at the ingest's own
 *  45s floor (matching reps_detected_count), before the caller applies the
 *  stricter >=6min filter for "long interval" evidence. */
function reconstructRepBlockDurations(laps: Lap[]): number[] {
  const sorted = [...laps].sort((a, b) => a.lapIndex - b.lapIndex);
  const blocks: Lap[][] = [];
  let current: Lap[] = [];
  for (const lap of sorted) {
    if (lap.isWork === true) {
      current.push(lap);
      continue;
    }
    if (lap.isWork === false && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    // null/missing: neither extends nor breaks
  }
  if (current.length > 0) blocks.push(current);

  return blocks
    .map((block) => block.reduce((sum, l) => sum + (l.timerTimeS ?? l.elapsedTimeS ?? 0), 0))
    .filter((durationS) => durationS >= MIN_REP_BLOCK_DURATION_S_INGEST);
}

function isPaceSane(paceSecPerKm: number | null): paceSecPerKm is number {
  return paceSecPerKm !== null && paceSecPerKm >= PACE_SANE_MIN_SEC_PER_KM && paceSecPerKm <= PACE_SANE_MAX_SEC_PER_KM;
}
function isHrSane(hr: number | null): hr is number {
  return hr !== null && hr >= HR_SANE_MIN_BPM && hr <= HR_SANE_MAX_BPM;
}

/** Extra "suspiciously flat" HR check beyond hr_trusted (which catches spikes,
 *  cadence-lock, and implausible peaks, but not a genuinely stuck/flat trace):
 *  if avg HR barely varies across laps whose PACE varies meaningfully, the HR
 *  sensor is very likely stuck (a common wrist-optical failure mode). */
function isSuspiciouslyFlatHr(laps: Lap[]): boolean {
  const withHr = laps.filter((l) => l.avgHr !== null && l.distanceM !== null && l.distanceM > 0 && l.timerTimeS !== null && l.timerTimeS > 0);
  if (withHr.length < 3) return false;
  const hrs = withHr.map((l) => l.avgHr!);
  const paces = withHr.map((l) => (l.timerTimeS! / (l.distanceM! / 1000)));
  const hrRange = Math.max(...hrs) - Math.min(...hrs);
  const paceMean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const paceRangePct = paceMean > 0 ? ((Math.max(...paces) - Math.min(...paces)) / paceMean) * 100 : 0;
  return hrRange < 3 && paceRangePct > 10;
}

// ── main ────────────────────────────────────────────────────────────────────

type ZoneSet = { workoutTypeId?: number; threshold?: number };
function extractWt0Threshold(zonesArray: unknown): number | null {
  if (!Array.isArray(zonesArray)) return null;
  const wt0 = zonesArray.find((z): z is ZoneSet => typeof z === "object" && z !== null && (z as ZoneSet).workoutTypeId === 0);
  return typeof wt0?.threshold === "number" ? wt0.threshold : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** "Round down on ambiguity": with >=3 points, use the median (a normal
 *  consensus). With <3 points (too little to trust a median), fall back to the
 *  MORE CONSERVATIVE single value — the slowest pace / lowest HR among what's
 *  available — rather than possibly overestimating an athlete's threshold from
 *  a single favorable data point. */
function conservativeChoice(values: number[], direction: "slowest_pace" | "lowest_hr"): number {
  if (values.length >= 3) return median(values);
  return direction === "slowest_pace" ? Math.max(...values) : Math.min(...values);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const supabase = getSupabase();

  const months = Number(getCliValue("--months=") ?? 6);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.round(months * 30.44));
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const outPath = getCliValue("--out=") ?? path.join(toolRoot, "action-artifacts", "threshold-estimation", "results.json");

  console.log(`tp-threshold-estimation: window >= ${cutoffIso} (${months} months). READ-ONLY, no TP calls.`);

  // 1) current thresholds from tp_zone_snapshots
  const currentByAthlete = new Map<number, { pace: number | null; hr: number | null }>();
  {
    const { data, error } = await supabase.from("tp_zone_snapshots").select("trainingpeaks_athlete_id, zones, captured_at");
    if (error) throw new Error(`tp_zone_snapshots read failed: ${error.message}`);
    for (const row of data ?? []) {
      const athleteId = Number(row.trainingpeaks_athlete_id);
      const zones = row.zones as Record<string, unknown> | null;
      const speedThresholdMps = extractWt0Threshold(zones?.speedZones);
      const hrThresholdBpm = extractWt0Threshold(zones?.heartRateZones);
      currentByAthlete.set(athleteId, {
        pace: typeof speedThresholdMps === "number" && speedThresholdMps > 0 ? 1000 / speedThresholdMps : null,
        hr: hrThresholdBpm,
      });
    }
  }
  console.log(`current thresholds loaded for ${currentByAthlete.size} athletes.`);

  // 2) race_events (all — need to match by exact workout_date)
  const raceByAthleteDate = new Map<string, number>(); // key `${athleteId}|${date}` -> distance_km
  {
    const { data, error } = await supabase.from("trainingpeaks_race_events").select("trainingpeaks_athlete_id, event_date, distance_km");
    if (error) throw new Error(`trainingpeaks_race_events read failed: ${error.message}`);
    for (const row of data ?? []) {
      if (typeof row.distance_km !== "number") continue;
      raceByAthleteDate.set(`${row.trainingpeaks_athlete_id}|${row.event_date}`, row.distance_km);
    }
  }
  console.log(`race events with a distance: ${raceByAthleteDate.size}`);

  // 3) derived_metrics rows in window
  type DmRow = {
    trainingpeaks_athlete_id: number;
    workout_cache_id: string;
    workout_date: string;
    hr_trusted: boolean | null;
    avg_hr: number | null;
    steady_duration_s: number | null;
    reps_detected_count: number | null;
    rep_paces: number[] | null;
    rep_peak_hrs: number[] | null;
    decoupling_invalid_reason: string | null;
  };
  const dmRows: DmRow[] = [];
  {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("trainingpeaks_workout_derived_metrics")
        .select(
          "trainingpeaks_athlete_id, workout_cache_id, workout_date, hr_trusted, avg_hr, steady_duration_s, reps_detected_count, rep_paces, rep_peak_hrs, decoupling_invalid_reason",
        )
        .eq("workout_type", "run")
        .eq("has_fit", true)
        .gte("workout_date", cutoffIso)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`derived_metrics read failed: ${error.message}`);
      if (!data || data.length === 0) break;
      dmRows.push(...(data as DmRow[]));
      if (data.length < pageSize) break;
    }
  }
  console.log(`derived_metrics rows in window (run, has_fit): ${dmRows.length}`);

  // 4) laps for the workout_cache_ids present, chunked
  const lapsByWorkoutCacheId = new Map<string, Lap[]>();
  {
    const ids = [...new Set(dmRows.map((r) => r.workout_cache_id))];
    const chunkSize = 150;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      // Paginate the chunk result: 150 workouts × ~9 laps ≈ 1350 rows exceed the
      // 1000 server cap, so the old single read silently dropped ~26% of laps →
      // wrong threshold/VDOT. Same page-loop the derived read above already uses.
      const pageSize = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("trainingpeaks_workout_laps")
          .select("workout_cache_id, lap_index, distance_m, timer_time_s, elapsed_time_s, avg_hr, is_work")
          .in("workout_cache_id", chunk)
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(`trainingpeaks_workout_laps read failed: ${error.message}`);
        const rows = data ?? [];
        for (const row of rows) {
          const key = row.workout_cache_id as string;
          const lap: Lap = {
            lapIndex: row.lap_index,
            distanceM: row.distance_m,
            timerTimeS: row.timer_time_s,
            elapsedTimeS: row.elapsed_time_s,
            avgHr: row.avg_hr,
            isWork: row.is_work,
          };
          const arr = lapsByWorkoutCacheId.get(key);
          if (arr) arr.push(lap);
          else lapsByWorkoutCacheId.set(key, [lap]);
        }
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      console.log(`  laps fetched for chunk ${i / chunkSize + 1}/${Math.ceil(ids.length / chunkSize)}`);
    }
  }
  console.log(`workouts with laps loaded: ${lapsByWorkoutCacheId.size}`);

  // 4b) titles for the same workouts — used ONLY to test a tempo-keyword regex
  // (never printed; titles are workout labels, not names, but we still avoid
  // surfacing raw text anywhere in output/logs).
  const titleByWorkoutCacheId = new Map<string, string>();
  {
    const ids = [...new Set(dmRows.map((r) => r.workout_cache_id))];
    const chunkSize = 300;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase.from("trainingpeaks_workout_cache").select("id, title").in("id", chunk);
      if (error) throw new Error(`trainingpeaks_workout_cache read failed: ${error.message}`);
      for (const row of data ?? []) {
        if (typeof row.title === "string") titleByWorkoutCacheId.set(row.id as string, row.title);
      }
    }
  }
  console.log(`titles loaded: ${titleByWorkoutCacheId.size}`);

  // 5) classify each workout into evidence, applying HR quality gate + sanity
  const evidence: EvidencePoint[] = [];
  let hrFilteredNotTrusted = 0;
  let hrFilteredFlat = 0;
  let paceFilteredInsane = 0;
  let repBlockMismatch = 0;
  type RaceTier = "A_10k" | "B_5k" | "B_half" | "B_marathon" | "B_other";
  const racesMatched: Record<RaceTier, number> = { A_10k: 0, B_5k: 0, B_half: 0, B_marathon: 0, B_other: 0 };
  let tempoCount = 0;
  let intervalWorkouts = 0;

  function tierForDistance(distanceKm: number): RaceTier {
    if (distanceKm >= 9.5 && distanceKm <= 10.5) return "A_10k";
    if (distanceKm >= 4.5 && distanceKm <= 5.5) return "B_5k";
    if (distanceKm >= 20.0 && distanceKm <= 21.6) return "B_half";
    if (distanceKm >= 41.5 && distanceKm <= 43.0) return "B_marathon";
    return "B_other";
  }

  for (const dm of dmRows) {
    const laps = lapsByWorkoutCacheId.get(dm.workout_cache_id) ?? [];
    const raceDistanceKm = raceByAthleteDate.get(`${dm.trainingpeaks_athlete_id}|${dm.workout_date}`);

    if (raceDistanceKm !== undefined) {
      const tier = tierForDistance(raceDistanceKm);
      const half = computeSecondHalf(laps);
      if (!half) continue;
      const paceSecPerKm: number | null = isPaceSane(half.paceSecPerKm) ? half.paceSecPerKm : null;
      if (half.paceSecPerKm !== null && !isPaceSane(half.paceSecPerKm)) paceFilteredInsane += 1;
      let hrBpm: number | null = null;
      if (dm.hr_trusted && isHrSane(half.avgHr)) {
        if (isSuspiciouslyFlatHr(laps)) hrFilteredFlat += 1;
        else hrBpm = half.avgHr;
      } else if (half.avgHr !== null) {
        hrFilteredNotTrusted += 1;
      }
      if (paceSecPerKm === null && hrBpm === null) continue;
      evidence.push({ athleteId: dm.trainingpeaks_athlete_id, tier, workoutDate: dm.workout_date, paceSecPerKm, hrBpm });
      racesMatched[tier] += 1;
      continue;
    }

    const isPureContinuous = (dm.reps_detected_count ?? 0) === 0;
    const title = titleByWorkoutCacheId.get(dm.workout_cache_id);
    const isTitledTempo = typeof title === "string" && isTempoTitle(title);
    if ((dm.steady_duration_s ?? 0) >= 1200 && isPureContinuous && isTitledTempo) {
      const seg = computeLastTwoThirds(laps);
      if (!seg) continue;
      const paceSecPerKm: number | null = isPaceSane(seg.paceSecPerKm) ? seg.paceSecPerKm : null;
      if (seg.paceSecPerKm !== null && !isPaceSane(seg.paceSecPerKm)) paceFilteredInsane += 1;
      let hrBpm: number | null = null;
      if (dm.hr_trusted && isHrSane(seg.avgHr)) {
        if (isSuspiciouslyFlatHr(laps)) hrFilteredFlat += 1;
        else hrBpm = seg.avgHr;
      } else if (seg.avgHr !== null) {
        hrFilteredNotTrusted += 1;
      }
      if (paceSecPerKm === null && hrBpm === null) continue;
      evidence.push({ athleteId: dm.trainingpeaks_athlete_id, tier: "C_tempo", workoutDate: dm.workout_date, paceSecPerKm, hrBpm });
      tempoCount += 1;
      continue;
    }

    if ((dm.reps_detected_count ?? 0) > 0 && Array.isArray(dm.rep_paces) && Array.isArray(dm.rep_peak_hrs)) {
      const blockDurations = reconstructRepBlockDurations(laps);
      if (blockDurations.length !== dm.rep_paces.length) {
        repBlockMismatch += 1;
        continue; // can't trust index alignment — discard rather than guess
      }
      const qualifyingIdx = blockDurations.map((d, i) => (d >= LONG_REP_MIN_DURATION_S ? i : -1)).filter((i) => i >= 0);
      if (qualifyingIdx.length === 0) continue;
      const paces = qualifyingIdx.map((i) => dm.rep_paces![i]).filter((p) => isPaceSane(p));
      const hrsRaw = qualifyingIdx.map((i) => dm.rep_peak_hrs![i]).filter((h): h is number => typeof h === "number");
      let hrs: number[] = [];
      if (dm.hr_trusted) {
        if (isSuspiciouslyFlatHr(laps)) hrFilteredFlat += 1;
        else hrs = hrsRaw.filter((h) => isHrSane(h));
      } else if (hrsRaw.length > 0) {
        hrFilteredNotTrusted += 1;
      }
      if (paces.length === 0 && hrs.length === 0) continue;
      evidence.push({
        athleteId: dm.trainingpeaks_athlete_id,
        tier: "D_intervals",
        workoutDate: dm.workout_date,
        paceSecPerKm: paces.length > 0 ? median(paces) : null,
        hrBpm: hrs.length > 0 ? median(hrs) : null,
      });
      intervalWorkouts += 1;
    }
  }

  console.log(
    `evidence points: ${evidence.length} ` +
      `(A_10k=${racesMatched.A_10k} B_5k=${racesMatched.B_5k} B_half=${racesMatched.B_half} B_marathon=${racesMatched.B_marathon} B_other=${racesMatched.B_other} C_tempo=${tempoCount} D_intervals=${intervalWorkouts})`,
  );
  console.log(
    `filtered: hr_not_trusted=${hrFilteredNotTrusted} hr_suspiciously_flat=${hrFilteredFlat} pace_insane=${paceFilteredInsane} rep_block_index_mismatch=${repBlockMismatch}`,
  );

  // 6) aggregate per athlete
  const evidenceByAthlete = new Map<number, EvidencePoint[]>();
  for (const e of evidence) {
    const arr = evidenceByAthlete.get(e.athleteId);
    if (arr) arr.push(e);
    else evidenceByAthlete.set(e.athleteId, [e]);
  }

  const allAthleteIds = new Set<number>([...currentByAthlete.keys(), ...evidenceByAthlete.keys()]);

  type Row = {
    athlete_id: number;
    current_pace_sec_per_km: number | null;
    estimate_pace_sec_per_km: number | null;
    pace_discrepancy_pct: number | null;
    current_hr_bpm: number | null;
    estimate_hr_bpm: number | null;
    hr_discrepancy_pct: number | null;
    evidence_tier: string | null;
    n_workouts: number;
    basis_dates: string[];
  };
  const rows: Row[] = [];

  for (const athleteId of allAthleteIds) {
    const points = evidenceByAthlete.get(athleteId) ?? [];
    const current = currentByAthlete.get(athleteId) ?? { pace: null, hr: null };

    let chosenTier: Tier | null = null;
    let estimatePace: number | null = null;
    let estimateHr: number | null = null;
    let basisDates: string[] = [];
    let n = 0;

    for (const tier of TIER_PRIORITY) {
      const tierPoints = points.filter((p) => p.tier === tier);
      if (tierPoints.length === 0) continue;
      const paceVals = tierPoints.filter((p) => p.paceSecPerKm !== null).map((p) => p.paceSecPerKm as number);
      const hrVals = tierPoints.filter((p) => p.hrBpm !== null).map((p) => p.hrBpm as number);
      if (paceVals.length === 0 && hrVals.length === 0) continue;
      chosenTier = tier;
      n = tierPoints.length;
      basisDates = tierPoints.map((p) => p.workoutDate).slice(0, 8);
      if (paceVals.length > 0) {
        const conservativePace = conservativeChoice(paceVals, "slowest_pace");
        estimatePace = Math.ceil(conservativePace + PACE_OFFSET_SEC_PER_KM[tier]); // round down = slower = ceil sec/km
      }
      if (hrVals.length > 0) {
        const conservativeHr = conservativeChoice(hrVals, "lowest_hr");
        estimateHr = Math.floor(conservativeHr + HR_OFFSET_BPM[tier]); // round down = lower bpm = floor
      }
      break;
    }

    const paceDiscrepancyPct =
      estimatePace !== null && current.pace !== null && current.pace > 0 ? ((estimatePace - current.pace) / current.pace) * 100 : null;
    const hrDiscrepancyPct = estimateHr !== null && current.hr !== null && current.hr > 0 ? ((estimateHr - current.hr) / current.hr) * 100 : null;

    rows.push({
      athlete_id: athleteId,
      current_pace_sec_per_km: current.pace !== null ? Math.round(current.pace * 10) / 10 : null,
      estimate_pace_sec_per_km: estimatePace,
      pace_discrepancy_pct: paceDiscrepancyPct !== null ? Math.round(paceDiscrepancyPct * 10) / 10 : null,
      current_hr_bpm: current.hr,
      estimate_hr_bpm: estimateHr,
      hr_discrepancy_pct: hrDiscrepancyPct !== null ? Math.round(hrDiscrepancyPct * 10) / 10 : null,
      evidence_tier: chosenTier ? TIER_LETTER[chosenTier] : null,
      n_workouts: n,
      basis_dates: basisDates,
    });
  }

  rows.sort((a, b) => a.athlete_id - b.athlete_id);

  // 7) aggregates
  const noDataAtAll = rows.filter((r) => r.evidence_tier === null).length;
  const withPaceOnly = rows.filter((r) => r.estimate_pace_sec_per_km !== null && r.estimate_hr_bpm === null).length;
  const withBoth = rows.filter((r) => r.estimate_pace_sec_per_km !== null && r.estimate_hr_bpm !== null).length;
  const paceDiscBuckets = { under5: 0, from5to15: 0, over15: 0, noCompare: 0 };
  for (const r of rows) {
    if (r.pace_discrepancy_pct === null) paceDiscBuckets.noCompare += 1;
    else if (Math.abs(r.pace_discrepancy_pct) < 5) paceDiscBuckets.under5 += 1;
    else if (Math.abs(r.pace_discrepancy_pct) <= 15) paceDiscBuckets.from5to15 += 1;
    else paceDiscBuckets.over15 += 1;
  }

  console.log(`\n── aggregates ──────────────────────────────────────────`);
  console.log(`athletes total (roster ∪ evidence):        ${rows.length}`);
  console.log(`no evidence at all:                        ${noDataAtAll}`);
  console.log(`pace estimate but no HR estimate:           ${withPaceOnly}`);
  console.log(`both pace and HR estimate:                  ${withBoth}`);
  console.log(`pace discrepancy <5%:                       ${paceDiscBuckets.under5}`);
  console.log(`pace discrepancy 5-15%:                      ${paceDiscBuckets.from5to15}`);
  console.log(`pace discrepancy >15%:                       ${paceDiscBuckets.over15}`);
  console.log(`pace discrepancy: no current threshold to compare: ${paceDiscBuckets.noCompare}`);

  const outDir = path.dirname(outPath);
  await import("node:fs/promises").then((fs) => fs.mkdir(outDir, { recursive: true }));
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generated_window_from: cutoffIso,
        rows,
        aggregates: {
          athletes_total: rows.length,
          no_evidence_at_all: noDataAtAll,
          pace_only_no_hr: withPaceOnly,
          both_pace_and_hr: withBoth,
          pace_discrepancy_buckets: paceDiscBuckets,
          hr_quality_filtered: { not_trusted: hrFilteredNotTrusted, suspiciously_flat: hrFilteredFlat },
          pace_sanity_filtered: paceFilteredInsane,
          rep_block_index_mismatch_discarded: repBlockMismatch,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nresults written: ${outPath}`);
}

main().catch((error: unknown) => {
  console.error("tp-threshold-estimation failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
