/**
 * READ-ONLY threshold-candidate scan RERUN — rebuilt with everything learned since the last scan.
 * Emits a LOCAL html artifact + json + stdout aggregates. NO writes (TP or DB). Names live in the
 * file only (never chat). Paces in min/km.
 *
 * SOURCE HIERARCHY per athlete (best wins for the PROPOSED value):
 *   1. Race ≤12mo → existing E-Predictor ftpaSecPerKm(vdotFromRace(dist,time)) — NO second
 *      conversion. ~1h race = reference; <40min or >75min → confidence downgrade + «менее надёжно».
 *      GATE: a "race" slower than the athlete's typical training pace is not a race → dropped.
 *   2. Long intervals (≥6min reps, median pace) OR tempo (≥20min, p20 effort + Daniels duration
 *      offset) — from FIT.
 *   3. Easy anchor ÷ 1.25 — rough, flagged.
 *   4. Nothing → not proposed.
 *
 * SELF-CHECK (every row): ratio = easy-anchor / proposed. Norm 1.10–1.40. Out of norm → highlighted.
 * DUAL-CHECK: every proposal is verified by a second independent path where one exists (race vs
 *   intervals; and the anchor-ratio sanity). Two numeric paths disagreeing >20s → «источники спорят».
 * EXCLUSIONS: applied & unchanged (live GET == value_after) and active tp_threshold_holds.
 *
 * Usage: npx tsx tools/trainingpeaks-export/scripts/tp-scan-rerun-artifact.ts [--months=12]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseAthleteIdFromUrl } from "../../../src/features/trainingpeaks/athlete-roster-import.ts";
import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { ftpaSecPerKm, vdotFromRace } from "../../../src/app/tools/plan/vdot.ts";
import { toolRoot } from "./lib/paths.ts";

const LONG_REP_MIN_DURATION_S = 360, MIN_REP_BLOCK_S = 45, TEMPO_MIN_STEADY_S = 1200;
const RACE_REF_LOW_S = 2400, RACE_REF_HIGH_S = 4500; // ~40min / ~75min band around the 1h reference
function tempoOffset(steadyS: number): number { const m = steadyS / 60; return m < 30 ? 0 : m < 45 ? -8 : -18; }
function tempoBand(steadyS: number): string { const m = steadyS / 60; return m < 30 ? "20–30мин" : m < 45 ? "30–45мин" : "45+мин"; }
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function getSupabase(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p); const url = process.env.SUPABASE_URL?.trim(), key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(); if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); return createClient(url, key, { auth: { persistSession: false } }); }
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function getCli(prefix: string): string | null { const a = process.argv.slice(2).find((x) => x.startsWith(prefix)); return a ? a.slice(prefix.length) : null; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function percentile(xs: number[], p: number): number { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))))]; }
function fmtPace(sec: number | null): string { if (sec === null || !Number.isFinite(sec) || sec <= 0) return "—"; const m = Math.floor(sec / 60), s = Math.round(sec % 60); return s === 60 ? `${m + 1}:00` : `${m}:${s.toString().padStart(2, "0")}`; }
function fmtClock(sec: number): string { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${s.toString().padStart(2, "0")}`; }
type ZoneSet = { workoutTypeId?: number; threshold?: number; calculationMethod?: number };
function findSet(arr: unknown, id: number): ZoneSet | null { if (!Array.isArray(arr)) return null; const s = arr.find((x) => isRecord(x) && x.workoutTypeId === id); return isRecord(s) ? (s as ZoneSet) : null; }
type Lap = { lapIndex: number; timerTimeS: number | null; elapsedTimeS: number | null; isWork: boolean | null };
function repBlockDurations(laps: Lap[]): number[] { const sorted = [...laps].sort((a, b) => a.lapIndex - b.lapIndex); const blocks: Lap[][] = []; let cur: Lap[] = []; for (const lap of sorted) { if (lap.isWork === true) cur.push(lap); else if (lap.isWork === false && cur.length) { blocks.push(cur); cur = []; } } if (cur.length) blocks.push(cur); return blocks.map((b) => b.reduce((s, l) => s + (l.timerTimeS ?? l.elapsedTimeS ?? 0), 0)).filter((d) => d >= MIN_REP_BLOCK_S); }

type Est = { src: "забег" | "темпо-тест" | "интервалы" | "темпо"; rank: number; pace: number; conf: string; basis: string; date: string; lessReliable?: boolean };
type Row = {
  aid: number; name: string; current: number | null; runSet?: { def: number | null; run: number | null }; anchor: number | null;
  ests: Est[]; proposed: number | null; propSrc: string | null; propBasis: string | null; propConf: string | null; propDate: string | null; lessReliable: boolean;
  ratio: number | null; dual: { second: number | null; secondSrc: string | null; deltaSec: number | null; dispute: boolean };
  futurePlanned: number; group: string; flags: string[];
};

async function main(): Promise<void> {
  const sb = getSupabase();
  const months = Number(getCli("--months=") ?? 12);
  const today = new Date().toISOString().slice(0, 10);
  const fromIso = new Date(Date.now() - Math.round(months * 30.44) * 86400000).toISOString().slice(0, 10);
  const anchorFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  console.log(`tp-scan-rerun-artifact: window ${fromIso}..${today}. READ-ONLY.`);

  // ── names ──
  const nameById = new Map<number, string>();
  { const { data } = await sb.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, student_name").not("student_name", "is", null); for (const r of data ?? []) { const id = Number(r.trainingpeaks_athlete_id); if (Number.isInteger(id) && typeof r.student_name === "string" && !nameById.has(id)) nameById.set(id, r.student_name); }
    const { data: st } = await sb.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url"); for (const r of st ?? []) { const url = typeof r.trainingpeaks_athlete_url === "string" ? r.trainingpeaks_athlete_url : null; const id = url ? parseAthleteIdFromUrl(url) : null; if (id !== null && id > 0 && typeof r.student_name === "string" && !nameById.has(id)) nameById.set(id, r.student_name); } }

  // ── current threshold (newest snapshot per athlete) = roster ──
  const current = new Map<number, number | null>();
  { const { data, error } = await sb.from("tp_zone_snapshots").select("trainingpeaks_athlete_id, zones, captured_at").order("captured_at", { ascending: false }); if (error) throw new Error(`snapshots: ${error.message}`); for (const r of data ?? []) { const id = Number(r.trainingpeaks_athlete_id); if (current.has(id)) continue; const z = r.zones as Record<string, unknown> | null; const sp = findSet(z?.speedZones, 0); current.set(id, typeof sp?.threshold === "number" && sp.threshold > 0 ? 1000 / sp.threshold : null); } }

  // ── easy anchor (bulk): FIT reps=0 continuous 90d, drop fastest 30%, median ≥3 ──
  const anchor = new Map<number, number>();
  { const rows: { aid: number; cid: string }[] = [];
    for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_derived_metrics").select("trainingpeaks_athlete_id, workout_cache_id").eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", anchorFrom).lte("workout_date", today).range(f, f + 999); if (!data || !data.length) break; for (const r of data) rows.push({ aid: Number(r.trainingpeaks_athlete_id), cid: r.workout_cache_id as string }); if (data.length < 1000) break; }
    const cidToAid = new Map(rows.map((r) => [r.cid, r.aid])); const cids = [...cidToAid.keys()]; const perAth = new Map<number, number[]>();
    for (let i = 0; i < cids.length; i += 300) { const { data } = await sb.from("trainingpeaks_workout_cache").select("id, completed_distance_raw, completed_time_raw").in("id", cids.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc <= 240 || pc >= 540) continue; const aid = cidToAid.get(w.id as string); if (aid === undefined) continue; const arr = perAth.get(aid) ?? []; arr.push(pc); perAth.set(aid, arr); } }
    for (const [aid, ps] of perAth) { const s = [...ps].sort((a, b) => a - b); const kept = s.slice(Math.floor(s.length * 0.3)); if (kept.length >= 3) anchor.set(aid, median(kept)); } }
  console.log(`anchor computed for ${anchor.size} athletes`);

  // ── baseline training pace (to gate races) ──
  const baseline = new Map<number, number>();
  { const per = new Map<number, number[]>(); for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, completed_distance_raw, completed_time_raw").gte("workout_date", fromIso).lte("workout_date", today).range(f, f + 999); if (!data || !data.length) break; for (const w of data) { const m = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const tH = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (m < 800 || tH <= 0) continue; const pace = (tH * 3600) / (m / 1000); if (pace < 210 || pace > 540) continue; const id = Number(w.trainingpeaks_athlete_id); const arr = per.get(id) ?? []; arr.push(pace); per.set(id, arr); } if (data.length < 1000) break; } for (const [id, ps] of per) if (ps.length >= 3) baseline.set(id, median(ps)); }

  const ests = new Map<number, Est[]>();
  const addEst = (id: number, e: Est): void => { const a = ests.get(id) ?? []; a.push(e); ests.set(id, a); };

  // ── RACES ──
  const { data: raceRows } = await sb.from("trainingpeaks_race_events").select("trainingpeaks_athlete_id, event_date, distance_km, title").gte("event_date", fromIso).lte("event_date", today).order("event_date", { ascending: false });
  // change 6: 59 race_events have no distance_km; 27 name it in the title (марафон / полумарафон /
  // "10км"). Parse the title as a fallback — SKIP trails (off-road distance is not a flat-race threshold
  // indicator). A wrongly-parsed distance simply fails to match a workout and is dropped, so it is safe.
  const distFromTitle = (title: string): number | null => {
    if (/трейл|trail|тропа|скай|sky|ультра|ultra|backyard|vertical|d\+/i.test(title)) return null;
    if (/полу\s*-?\s*марафон|half\s*-?\s*marathon|полумар/i.test(title)) return 21.0975;
    if (/марафон|marathon/i.test(title)) return 42.195;
    const m = /(\d+(?:[.,]\d+)?)\s*(?:км|km|k)\b/i.exec(title);
    if (m) { const km = parseFloat(m[1].replace(",", ".")); if (km >= 3 && km <= 100) return km; }
    return null;
  };
  let raceDistFromTitle = 0;
  const races = (raceRows ?? []).map((r) => { let km = typeof r.distance_km === "number" ? (r.distance_km as number) : null; if ((km === null || km <= 0) && typeof r.title === "string") { const p = distFromTitle(r.title); if (p !== null) { km = p; raceDistFromTitle += 1; } } return { ...r, distance_km: km }; }).filter((r) => typeof r.distance_km === "number" && (r.distance_km as number) > 0);
  console.log(`race_events: ${(raceRows ?? []).length} · дистанция из названия (было null): ${raceDistFromTitle}`);
  const classify = (km: number): { tier: string; rank: number } => { if (km >= 9.5 && km <= 10.5) return { tier: "10к", rank: 0 }; if (km >= 20 && km <= 21.6) return { tier: "полумарафон", rank: 0 }; if (km >= 4.5 && km <= 5.5) return { tier: "5к", rank: 1 }; if (km >= 41.5 && km <= 43) return { tier: "марафон", rank: 1 }; return { tier: `${km}км`, rank: 2 }; };
  let racesDroppedSlow = 0, racesRecovered = 0;
  type RaceCand = { proposed: number; rank: number; tier: string; conf: string; date: string; lessReliable: boolean; racePace: number; timeSec: number; recovered: boolean };
  const raceCands = new Map<number, RaceCand[]>(); // ALL eligible races per athlete (change 3 picks the best)
  for (const r of races) {
    const id = Number(r.trainingpeaks_athlete_id); const officialM = (r.distance_km as number) * 1000;
    const { data: wc } = await sb.from("trainingpeaks_workout_cache").select("id, completed_distance_raw, completed_time_raw").eq("trainingpeaks_athlete_id", id).eq("workout_date", r.event_date);
    const gateRef = anchor.get(id) ?? baseline.get(id);
    // primary match: closest workout within ±15% of the official distance
    let best: { timeSec: number } | null = null; let closest = Infinity; let recovered = false;
    for (const w of wc ?? []) { const measM = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const tH = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (measM <= 0 || tH <= 0 || Math.abs(measM - officialM) / officialM > 0.15) continue; const d = Math.abs(measM - officialM); if (d < closest) { closest = d; best = { timeSec: tH * 3600 }; } }
    if (!best) {
      // change 2 recovery (distMismatch): no workout within ±15% (moderate GPS error). Among workouts
      // whose measured distance is a PLAUSIBLE GPS error of the race (0.7–1.3× official — excludes
      // warm-ups and different-distance runs), take the fastest by official-distance pace. The gate
      // below rejects a slow same-day long run, so this cannot invent a fast "race" from a jog.
      let bestPace = Infinity; let bestT: number | null = null;
      for (const w of wc ?? []) { const measM = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const tH = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (tH <= 0 || measM < 0.7 * officialM || measM > 1.3 * officialM) continue; const ts = tH * 3600; const pc = ts / (officialM / 1000); if (pc < bestPace) { bestPace = pc; bestT = ts; } }
      if (bestT !== null) { best = { timeSec: bestT }; recovered = true; }
    }
    if (!best) continue;
    const racePace = best.timeSec / (officialM / 1000); if (!(racePace > 120 && racePace < 600)) continue;
    if (gateRef !== undefined && racePace >= gateRef) { racesDroppedSlow += 1; continue; }
    const proposed = ftpaSecPerKm(vdotFromRace(officialM, best.timeSec)); if (!(proposed > 150 && proposed < 540)) continue;
    const cls = classify(r.distance_km as number);
    const lessReliable = best.timeSec < RACE_REF_LOW_S || best.timeSec > RACE_REF_HIGH_S;
    const conf = cls.rank === 0 ? (lessReliable ? "medium" : "high") : lessReliable ? "low" : "medium";
    const arr = raceCands.get(id) ?? []; arr.push({ proposed, rank: cls.rank, tier: cls.tier, conf, date: r.event_date as string, lessReliable, racePace, timeSec: best.timeSec, recovered }); raceCands.set(id, arr);
  }
  // change 3: pick the BEST race per athlete = fastest derived threshold; recency is the tiebreak.
  let raceMatched = 0;
  for (const [id, cands] of raceCands) {
    cands.sort((a, b) => a.proposed - b.proposed || b.date.localeCompare(a.date));
    const c = cands[0]; raceMatched += 1; if (c.recovered) racesRecovered += 1;
    addEst(id, { src: "забег", rank: c.rank, pace: c.proposed, conf: c.conf, date: c.date, lessReliable: c.lessReliable, basis: `${c.date} · ${c.tier} · ${fmtClock(c.timeSec)} (темп ${fmtPace(c.racePace)})${c.recovered ? " ·GPS-восст" : ""}${c.lessReliable ? " ·⚠далеко от часа" : ""}${cands.length > 1 ? ` · лучший из ${cands.length}` : ""}` });
  }
  console.log(`races matched: ${raceMatched} · dropped too-slow: ${racesDroppedSlow} · recovered(distMismatch): ${racesRecovered}`);

  // ── LONG INTERVALS ──
  type DmRow = { trainingpeaks_athlete_id: number; workout_cache_id: string; workout_date: string; rep_paces: number[] | null };
  const dmRows: DmRow[] = [];
  for (let f = 0; ; f += 1000) { const { data, error } = await sb.from("trainingpeaks_workout_derived_metrics").select("trainingpeaks_athlete_id, workout_cache_id, workout_date, rep_paces").eq("workout_type", "run").eq("has_fit", true).gt("reps_detected_count", 0).gte("workout_date", fromIso).lte("workout_date", today).range(f, f + 999); if (error) throw new Error(`dm: ${error.message}`); if (!data || !data.length) break; dmRows.push(...(data as DmRow[])); if (data.length < 1000) break; }
  const lapsByCache = new Map<string, Lap[]>();
  { const ids = [...new Set(dmRows.map((r) => r.workout_cache_id))]; for (let i = 0; i < ids.length; i += 150) { const { data } = await sb.from("trainingpeaks_workout_laps").select("workout_cache_id, lap_index, timer_time_s, elapsed_time_s, is_work").in("workout_cache_id", ids.slice(i, i + 150)); for (const l of data ?? []) { const key = l.workout_cache_id as string; const lap: Lap = { lapIndex: l.lap_index as number, timerTimeS: l.timer_time_s as number, elapsedTimeS: l.elapsed_time_s as number, isWork: l.is_work as boolean }; const arr = lapsByCache.get(key); if (arr) arr.push(lap); else lapsByCache.set(key, [lap]); } } }
  const ivPool = new Map<number, { paces: number[]; sessions: Set<string>; latest: string }>();
  for (const dm of dmRows) { if (!Array.isArray(dm.rep_paces) || !dm.rep_paces.length) continue; const durations = repBlockDurations(lapsByCache.get(dm.workout_cache_id) ?? []); if (durations.length !== dm.rep_paces.length) continue; const longIdx = durations.map((d, i) => (d >= LONG_REP_MIN_DURATION_S ? i : -1)).filter((i) => i >= 0); if (!longIdx.length) continue; const paces = longIdx.map((i) => dm.rep_paces![i]).filter((p) => p > 150 && p < 540); if (!paces.length) continue; const id = Number(dm.trainingpeaks_athlete_id); const acc = ivPool.get(id) ?? { paces: [], sessions: new Set<string>(), latest: "" }; acc.paces.push(...paces); acc.sessions.add(dm.workout_date); if (dm.workout_date > acc.latest) acc.latest = dm.workout_date; ivPool.set(id, acc); }
  for (const [id, acc] of ivPool) { const nReps = acc.paces.length, ns = acc.sessions.size; const conf = nReps >= 6 && ns >= 3 ? "medium" : nReps >= 3 ? "low" : "very-low"; addEst(id, { src: "интервалы", rank: 4, pace: median(acc.paces), conf, date: acc.latest, basis: `${nReps} реп(ов) ≥6мин в ${ns} трен. (медиана), посл. ${acc.latest}` }); }

  // ── TEMPO ──
  type TempoDm = { trainingpeaks_athlete_id: number; workout_cache_id: string; workout_date: string; steady_duration_s: number | null };
  const tempoRows: TempoDm[] = [];
  for (let f = 0; ; f += 1000) { const { data, error } = await sb.from("trainingpeaks_workout_derived_metrics").select("trainingpeaks_athlete_id, workout_cache_id, workout_date, steady_duration_s").eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("steady_duration_s", TEMPO_MIN_STEADY_S).gte("workout_date", fromIso).lte("workout_date", today).range(f, f + 999); if (error) throw new Error(`tempo: ${error.message}`); if (!data || !data.length) break; tempoRows.push(...(data as TempoDm[])); if (data.length < 1000) break; }
  const tLaps = new Map<string, { d: number; t: number }[]>();
  { const ids = [...new Set(tempoRows.map((r) => r.workout_cache_id))]; for (let i = 0; i < ids.length; i += 150) { const { data } = await sb.from("trainingpeaks_workout_laps").select("workout_cache_id, distance_m, timer_time_s").in("workout_cache_id", ids.slice(i, i + 150)); for (const l of data ?? []) { const d = typeof l.distance_m === "number" ? l.distance_m : 0; const t = typeof l.timer_time_s === "number" ? l.timer_time_s : 0; if (d <= 0 || t <= 0) continue; const key = l.workout_cache_id as string; const arr = tLaps.get(key) ?? []; arr.push({ d, t }); tLaps.set(key, arr); } } }
  const effortPace = (laps: { d: number; t: number }[], frac: number): number | null => { if (laps.length < 2) return null; const total = laps.reduce((s, l) => s + l.d, 0); const sorted = [...laps].sort((a, b) => a.t / a.d - b.t / b.d); let accD = 0, accT = 0; for (const l of sorted) { if (accD >= frac * total) break; accD += l.d; accT += l.t; } return accD > 0 ? accT / (accD / 1000) : null; };
  const tPool = new Map<number, { paces: number[]; sessions: Set<string>; latest: string; bands: Set<string> }>();
  for (const t of tempoRows) { const laps = tLaps.get(t.workout_cache_id); if (!laps) continue; const steadyS = t.steady_duration_s ?? 0; const tp = effortPace(laps, 0.6); if (tp === null || !(tp > 150 && tp < 540)) continue; const est = tp + tempoOffset(steadyS); const id = Number(t.trainingpeaks_athlete_id); const acc = tPool.get(id) ?? { paces: [], sessions: new Set<string>(), latest: "", bands: new Set<string>() }; acc.paces.push(est); acc.sessions.add(t.workout_date); acc.bands.add(tempoBand(steadyS)); if (t.workout_date > acc.latest) acc.latest = t.workout_date; tPool.set(id, acc); }
  for (const [id, acc] of tPool) { const n = acc.paces.length, ns = acc.sessions.size; if (n < 3) continue; const conf = n >= 15 ? "medium" : n >= 6 ? "low" : "very-low"; addEst(id, { src: "темпо", rank: 5, pace: percentile(acc.paces, 0.2), conf, date: acc.latest, basis: `${n} непрерывн. ≥20мин в ${ns} трен. (p20 + поправка ${[...acc.bands].join("/")}), посл. ${acc.latest}` }); }

  // ── change 4: TEMPO-TEST tier (rank 3 — between race and the pooled interval/tempo tiers) ──
  // ONE clean continuous ELEVATED 20-40min effort ≈ threshold (Friel: take the pace directly). Both
  // sources must be elevated (≥25s/km faster than the easy anchor, else it is just an easy run):
  //  (a) reps=0 continuous, steady 20-40min → effort pace = fast 70% of laps.
  //  (b) reps 1-2 where the rep-detector SPLIT a continuous tempo (each block ≥10min, total 20-40min)
  //      → pace = median rep pace. Recovers HR-driven tests the detector broke into blocks (Grigoreva).
  const tt = new Map<number, { pace: number; date: string; dur: number; n: number; how: string }>();
  const considerTT = (id: number, pace: number, date: string, dur: number, how: string): void => {
    const anc = anchor.get(id); if (anc === undefined) return;
    if (pace > anc - 25) return;        // must be ELEVATED (faster than easy), else it is just an easy run
    if (pace < anc * 0.70) return;      // but not implausibly fast — >30% faster than easy = GPS glitch /
                                        // a short sprint, not a sustained 20-40min threshold effort (Grigoreva 3:17)
    const prev = tt.get(id);
    if (!prev) { tt.set(id, { pace, date, dur, n: 1, how }); return; }
    tt.set(id, pace < prev.pace ? { pace, date, dur, n: prev.n + 1, how } : { ...prev, n: prev.n + 1 });
  };
  for (const t of tempoRows) { const steadyS = t.steady_duration_s ?? 0; if (steadyS < 1200 || steadyS > 2700) continue; const laps = tLaps.get(t.workout_cache_id); if (!laps) continue; const ep = effortPace(laps, 0.7); if (ep === null || !(ep > 150 && ep < 540)) continue; considerTT(Number(t.trainingpeaks_athlete_id), ep, t.workout_date, steadyS, "непрерывный"); }
  { const { data: splitRows } = await sb.from("trainingpeaks_workout_derived_metrics").select("trainingpeaks_athlete_id, workout_cache_id, workout_date, rep_paces").eq("workout_type", "run").eq("has_fit", true).gte("reps_detected_count", 1).lte("reps_detected_count", 2).gte("workout_date", fromIso).lte("workout_date", today);
    const sIds = [...new Set((splitRows ?? []).map((r) => r.workout_cache_id as string))]; const sLaps = new Map<string, Lap[]>();
    for (let i = 0; i < sIds.length; i += 150) { const { data } = await sb.from("trainingpeaks_workout_laps").select("workout_cache_id, lap_index, timer_time_s, elapsed_time_s, is_work").in("workout_cache_id", sIds.slice(i, i + 150)); for (const l of data ?? []) { const key = l.workout_cache_id as string; const lap: Lap = { lapIndex: l.lap_index as number, timerTimeS: l.timer_time_s as number, elapsedTimeS: l.elapsed_time_s as number, isWork: l.is_work as boolean }; const arr = sLaps.get(key); if (arr) arr.push(lap); else sLaps.set(key, [lap]); } }
    for (const dm of splitRows ?? []) { if (!Array.isArray(dm.rep_paces) || !dm.rep_paces.length) continue; const durs = repBlockDurations(sLaps.get(dm.workout_cache_id as string) ?? []); if (durs.length !== dm.rep_paces.length) continue; const total = durs.reduce((s, d) => s + d, 0); if (!durs.every((d) => d >= 600) || total < 1200 || total > 2700) continue; const paces = dm.rep_paces.filter((p) => p > 150 && p < 540); if (!paces.length) continue; considerTT(Number(dm.trainingpeaks_athlete_id), median(paces), dm.workout_date as string, total, `сплит ${durs.length}×блок`); } }
  for (const [id, x] of tt) addEst(id, { src: "темпо-тест", rank: 3, pace: x.pace, conf: x.n >= 2 ? "medium" : "low", date: x.date, basis: `тест ${Math.round(x.dur / 60)}мин напрямую (${x.how}${x.n > 1 ? `, лучший из ${x.n}` : ""}), посл. ${x.date}` });
  console.log(`tempo-test (rank3): ${tt.size} athletes`);

  // ── change 5: calibrate the interval tier against the race tier ──
  // k = race_pace / interval_pace over athletes with BOTH sources. Exclude sensor garbage (an interval
  // faster than 3:30/km is impossible) and broken intervals (k outside 0.85–1.30 — a bad detection, not
  // a systematic offset). Apply the cleaned median k to every interval estimate so it matches the races.
  {
    const ks: number[] = [];
    for (const [, es] of ests) { const rc = es.find((e) => e.src === "забег"); const iv = es.find((e) => e.src === "интервалы"); if (!rc || !iv || iv.pace < 210) continue; const k = rc.pace / iv.pace; if (k >= 0.85 && k <= 1.30) ks.push(k); }
    const kCal = ks.length >= 5 ? median(ks) : 1;
    for (const [, es] of ests) for (const e of es) if (e.src === "интервалы") { e.pace = Math.round(e.pace * kCal); e.basis += ` ·калибр ×${kCal.toFixed(3)}`; }
    console.log(`interval calibration k = ${kCal.toFixed(3)} (n=${ks.length}, excl garbage & k<0.85/>1.30)`);
  }

  // ── applied (log + live GET) & holds ──
  const appliedLog = new Map<number, { valueAfter: number; at: string }>();
  { const { data } = await sb.from("tp_threshold_applications").select("trainingpeaks_athlete_id, value_after, applied_at").eq("kind", "pace").order("applied_at", { ascending: false }); for (const r of data ?? []) { const id = Number(r.trainingpeaks_athlete_id); if (!appliedLog.has(id) && typeof r.value_after === "number") appliedLog.set(id, { valueAfter: r.value_after, at: r.applied_at as string }); } }
  const holds = new Map<number, string>();
  { const { data, error } = await sb.from("tp_threshold_holds").select("trainingpeaks_athlete_id, reason, active").eq("active", true); if (error) console.warn(`holds: ${error.message}`); else for (const r of data ?? []) holds.set(Number(r.trainingpeaks_athlete_id), String(r.reason)); }

  // live GET: applied athletes (verify unchanged) + the six run-set athletes (need wt=3)
  const SIX = new Map<number, string>([[5621054, "Degtyareva"], [5366936, "Lavrentyev"], [5225588, "Romanovskiy"], [5475968, "Hoffman"], [1453948, "Volkova (Naida)"], [6472526, "Volkova (Tatyana)"]]);
  const liveDef = new Map<number, number>(); const liveRun = new Map<number, number | null>();
  const liveIds = new Set<number>([...appliedLog.keys(), ...SIX.keys()]);
  console.log(`live GET /settings for ${liveIds.size} athletes (applied + run-set six)…`);
  for (const id of liveIds) { try { const s = await getAthleteSettings(id); const d = findSet(s.speedZones, 0); const rn = findSet(s.speedZones, 3); if (d && typeof d.threshold === "number") liveDef.set(id, d.threshold); liveRun.set(id, rn && typeof rn.threshold === "number" ? rn.threshold : null); } catch (e) { console.warn(`  live GET ${id} failed: ${e instanceof Error ? e.message : String(e)}`); } }

  // ── future planned pace workouts per athlete (0 → threshold can be set w/o structure recompute) ──
  const futurePlanned = new Map<number, number>();
  { for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, is_planned, completed_time_raw, workout_type_value_id, workout_date").gte("workout_date", today).range(f, f + 999); if (!data || !data.length) break; for (const w of data) { if (w.is_planned === true && (w.completed_time_raw == null || w.completed_time_raw === 0) && w.workout_type_value_id === 3) { const id = Number(w.trainingpeaks_athlete_id); futurePlanned.set(id, (futurePlanned.get(id) ?? 0) + 1); } } if (data.length < 1000) break; } }

  // ── assemble ──
  const rows: Row[] = [];
  for (const [aid, cur] of current) {
    const es = (ests.get(aid) ?? []).sort((a, b) => a.rank - b.rank || b.date.localeCompare(a.date));
    const app = appliedLog.get(aid); const live = liveDef.get(aid);
    const applied = app && live !== undefined && Math.abs(live - app.valueAfter) < 5e-3;
    const currentPace = live !== undefined && live > 0 ? 1000 / live : cur;
    const anc = anchor.get(aid) ?? null;
    const best = es[0] ?? null;
    const proposed = best ? best.pace : anc !== null ? anc / 1.25 : null;
    const propSrc = best ? best.src : anc !== null ? "якорь÷1.25" : null;
    const propConf = best ? best.conf : anc !== null ? "very-low" : null;
    const propBasis = best ? best.basis : anc !== null ? `грубо: лёгкий якорь ${fmtPace(anc)} ÷ 1.25` : null;
    const propDate = best?.date ?? null;
    const ratio = anc !== null && proposed ? anc / proposed : null;
    // dual-path: two INDEPENDENT numeric paths (race + interval/tempo). anchor-ratio is the self-check, not a path.
    const numeric = es.filter((e) => e.src === "забег" || e.src === "темпо-тест" || e.src === "интервалы" || e.src === "темпо");
    let dual: Row["dual"] = { second: null, secondSrc: null, deltaSec: null, dispute: false };
    const raceEst = numeric.find((e) => e.src === "забег");
    const fitEst = numeric.find((e) => e.src === "темпо-тест" || e.src === "интервалы" || e.src === "темпо");
    if (raceEst && fitEst) {
      // the meaningful cross-check: race (E-Predictor) vs measured FIT effort. Disagreement >20s
      // = sources genuinely argue → own group, both numbers shown.
      const d = Math.round(Math.abs(raceEst.pace - fitEst.pace));
      dual = { second: fitEst.pace, secondSrc: fitEst.src, deltaSec: d, dispute: d > 20 };
    } else if (numeric.length >= 2 && best) {
      // no race: a second FIT path (interval vs tempo) is informational only — tempo p20 is the
      // weakest, noisiest signal, so their disagreement is NOT a real dispute, just shown for context.
      const second = numeric.find((e) => e.src !== best.src);
      if (second) dual = { second: second.pace, secondSrc: second.src, deltaSec: Math.round(Math.abs(best.pace - second.pace)), dispute: false };
    }

    const flags: string[] = [];
    if (best?.lessReliable) flags.push("забег далеко от часа — менее надёжно");
    if (anc === null) flags.push("нет лёгкого якоря");
    if (ratio !== null && (ratio < 1.10 || ratio > 1.40)) flags.push(`отношение вне 1.10–1.40 (${ratio.toFixed(2)})`);
    if (dual.dispute) flags.push(`источники спорят: ${best?.src} ${fmtPace(best!.pace)} vs ${dual.secondSrc} ${fmtPace(dual.second)} Δ${dual.deltaSec}с`);
    if (propSrc === "якорь÷1.25") flags.push("грубая оценка (нет забега/интервалов)");
    if (currentPace !== null && proposed !== null && Math.abs(proposed - currentPace) > 60) flags.push(`большой сдвиг vs текущий (${Math.round(proposed - currentPace)}с)`);
    if ((futurePlanned.get(aid) ?? 0) === 0) flags.push("нет будущих плановых — порог без пересчёта структур");

    const rs = SIX.has(aid) ? { def: liveDef.get(aid) ? 1000 / liveDef.get(aid)! : currentPace, run: liveRun.get(aid) != null ? 1000 / (liveRun.get(aid) as number) : null } : undefined;

    let group: string;
    if (holds.has(aid)) group = "hold";
    else if (applied) group = "applied";
    else if (!best && anc === null) group = "nodata";
    else if (ratio !== null && ratio <= 1.06) group = "anomaly-low";       // easy ≈ threshold → no real threshold
    else if (ratio !== null && ratio > 1.45) group = "anomaly-high";        // proposed too fast or anchor too slow
    else if (dual.dispute) group = "dispute";
    else if (anc === null) group = "no-anchor";
    else if (!best) group = "rough";                                        // only anchor÷1.25
    else group = best.rank <= 2 ? "race" : "interval";

    rows.push({ aid, name: nameById.get(aid) ?? `id ${aid}`, current: currentPace, runSet: rs, anchor: anc, ests: es, proposed, propSrc, propBasis, propConf, propDate, lessReliable: !!best?.lessReliable, ratio, dual, futurePlanned: futurePlanned.get(aid) ?? 0, group, flags });
  }

  // ── aggregates ──
  const g = (name: string): Row[] => rows.filter((r) => r.group === name);
  const applied = g("applied"), hold = g("hold");
  const race = g("race"), interval = g("interval"), rough = g("rough");
  const anomHigh = g("anomaly-high"), anomLow = g("anomaly-low"), dispute = g("dispute"), noAnchor = g("no-anchor"), nodata = g("nodata");
  const candidates = race.length + interval.length + rough.length;
  const anomalies = anomHigh.length + anomLow.length + dispute.length;
  const six = rows.filter((r) => SIX.has(r.aid)).sort((a, b) => a.name.localeCompare(b.name));
  const agg = { total: rows.length, applied: applied.length, hold: hold.length, candidates, race: race.length, interval: interval.length, rough: rough.length, anomalies, anomHigh: anomHigh.length, anomLow: anomLow.length, dispute: dispute.length, noAnchor: noAnchor.length, nodata: nodata.length };
  console.log(`\n── aggregates ──`); console.log(JSON.stringify(agg, null, 0));

  // ── write JSON + HTML ──
  const outDir = path.resolve(toolRoot, "..", "..");
  const jsonPath = path.join(outDir, "threshold-scan-rerun.json");
  writeFileSync(jsonPath, `${JSON.stringify({ generated: today, window_from: fromIso, aggregates: agg, racesDroppedSlow, rows: rows.map((r) => ({ ...r, ests: r.ests.map((e) => ({ ...e, pace_fmt: fmtPace(e.pace) })) })) }, null, 2)}\n`, "utf8");
  console.log(`JSON: ${jsonPath}`);
  const htmlPath = path.join(outDir, "threshold-scan-rerun.html");
  writeFileSync(htmlPath, renderHtml(rows, agg, { today, fromIso, racesDroppedSlow, six, anchorN: anchor.size }), "utf8");
  console.log(`HTML: ${htmlPath}`);
  console.log(`\nВСЕГО ${agg.total} · ПРИМЕНЕНО ${agg.applied} · HOLD ${agg.hold} · КАНДИДАТОВ ${agg.candidates} (забег ${agg.race} · интервалы/темпо ${agg.interval} · грубо ${agg.rough}) · АНОМАЛИИ ${agg.anomalies} (>1.45: ${agg.anomHigh} · ~1.0: ${agg.anomLow} · спор: ${agg.dispute}) · нет якоря ${agg.noAnchor} · без данных ${agg.nodata}`);
}

function pace(sec: number | null): string { return fmtPace(sec); }
function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function deltaCell(cur: number | null, prop: number | null): string { if (cur === null || prop === null) return "—"; const d = Math.round(prop - cur); return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}с`; }
function ratioCell(r: number | null): string { if (r === null) return "—"; const cls = r < 1.10 || r > 1.45 ? "bad" : r > 1.40 ? "warn" : "ok"; return `<span class="ratio ${cls}">${r.toFixed(2)}</span>`; }
function decideCell(r: Row): string {
  const propMmss = r.proposed != null ? fmtPace(r.proposed) : "";
  return `<td class="decide"><label class="k-acc"><input type="checkbox">✓</label><input class="k-val" type="text" value="${propMmss}" placeholder="mm:ss"><button class="k-rej" type="button" title="отклонить">✗</button><input class="k-reason" type="text" placeholder="причина"></td>`;
}
function rowHtml(r: Row, decide = true): string {
  const runSet = r.runSet ? `<br><span class="sub">default ${pace(r.runSet.def)} · run ${pace(r.runSet.run)}${r.runSet.run !== null && r.runSet.def !== null && Math.abs(r.runSet.run - r.runSet.def) > 3 ? " ⚠расходятся" : ""}</span>` : "";
  const attrs = decide ? ` data-aid="${r.aid}" data-name="${esc(r.name).replace(/"/g, "&quot;")}"` : "";
  const first = decide ? decideCell(r) : `<td class="decide"></td>`;
  return `<tr${attrs}>
  ${first}
  <td class="name">${esc(r.name)}<span class="aid">${r.aid}</span>${runSet}</td>
  <td>${pace(r.current)}</td>
  <td class="prop">${pace(r.proposed)}</td>
  <td>${deltaCell(r.current, r.proposed)}</td>
  <td>${r.propSrc ?? "—"}${r.propConf ? ` <span class="conf">${r.propConf}</span>` : ""}</td>
  <td class="basis">${r.propBasis ? esc(r.propBasis) : "—"}${r.dual.second !== null ? `<br><span class="sub">2-й путь: ${r.dual.secondSrc} ${pace(r.dual.second)} (Δ${r.dual.deltaSec}с)</span>` : ""}</td>
  <td>${pace(r.anchor)}</td>
  <td>${ratioCell(r.ratio)}</td>
  <td class="flags">${r.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join(" ")}</td>
</tr>`;
}
function section(title: string, rows: Row[], note = "", decide = true): string { if (!rows.length) return `<h2>${esc(title)} — 0</h2>${note ? `<p class="note">${esc(note)}</p>` : ""}`; return `<h2>${esc(title)} — ${rows.length}</h2>${note ? `<p class="note">${esc(note)}</p>` : ""}<table><thead><tr><th>решение</th><th>имя</th><th>текущий</th><th>предлаг</th><th>Δ</th><th>источник</th><th>на чём (дата·дист·время)</th><th>якорь</th><th>отн.</th><th>флаги</th></tr></thead><tbody>${rows.map((r) => rowHtml(r, decide)).join("\n")}</tbody></table>`; }
function renderHtml(rows: Row[], agg: Record<string, number>, meta: { today: string; fromIso: string; racesDroppedSlow: number; six: Row[]; anchorN: number }): string {
  const g = (name: string): Row[] => rows.filter((r) => r.group === name).sort((a, b) => (a.proposed ?? 9e9) - (b.proposed ?? 9e9));
  const byConf = (a: Row, b: Row) => (a.lessReliable ? 1 : 0) - (b.lessReliable ? 1 : 0) || (a.propDate && b.propDate ? b.propDate.localeCompare(a.propDate) : 0);
  const css = `:root{--bg:#fbfaf8;--fg:#1c1a17;--mut:#6b6459;--line:#e6e1d8;--card:#fff;--accent:#8a5a2b;--ok:#2f7d4f;--warn:#b8791f;--bad:#b23b3b}
@media(prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#ece7de;--mut:#a49a89;--line:#2c2820;--card:#1e1b15;--accent:#d69a5c;--ok:#5fbd85;--warn:#e0aa55;--bad:#e57373}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.meta{color:var(--mut);font-size:12px;margin-bottom:16px}
.summary{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
.pill{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}.pill b{font-size:18px;display:block}.pill span{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.note{color:var(--mut);font-size:12px;margin:4px 0 8px}
table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:13px}
th{text-align:left;color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.03em;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.name{font-weight:600}.name .aid{color:var(--mut);font-weight:400;font-size:11px;margin-left:6px}
.sub{color:var(--mut);font-size:11px}.basis{font-size:12px;color:var(--mut);max-width:320px}
.prop{font-weight:700;color:var(--accent)}.conf{font-size:10px;color:var(--mut);text-transform:uppercase}
.ratio{font-weight:700;padding:1px 6px;border-radius:5px}.ratio.ok{color:var(--ok)}.ratio.warn{color:var(--warn)}.ratio.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.flags{max-width:260px}.flag{display:inline-block;font-size:10px;color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent);border-radius:4px;padding:1px 5px;margin:1px 0}
.wrap{max-width:1500px;margin:0 auto}.scroll{overflow-x:auto}
.toolbar{position:sticky;top:0;z-index:20;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;display:flex;gap:14px;align-items:center;margin:12px 0;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.toolbar button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
.toolbar #export{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
#counter{font-weight:600;font-variant-numeric:tabular-nums}#counter .hint{color:var(--mut);font-weight:400;font-size:12px}
td.decide{white-space:nowrap;width:1%}
.decide .k-acc{cursor:pointer;font-weight:700;color:var(--ok);user-select:none}
.decide .k-val{width:50px;font:inherit;padding:2px 4px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg);font-variant-numeric:tabular-nums;margin:0 3px}
.decide .k-rej{cursor:pointer;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--bad);padding:2px 7px}
.decide .k-reason{display:none;width:96px;font:inherit;padding:2px 4px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg);margin-top:3px}
tr.accepted{background:color-mix(in srgb,var(--ok) 13%,transparent)}
tr.rejected{background:color-mix(in srgb,var(--bad) 10%,transparent)}
tr.rejected .name,tr.rejected .prop{text-decoration:line-through;opacity:.65}`;
  const pill = (b: number | string, s: string): string => `<div class="pill"><b>${b}</b><span>${s}</span></div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Скан порогов — рерун ${meta.today}</title><style>${css}</style></head><body><div class="wrap">
<h1>Скан кандидатов на пороги — рерун</h1>
<div class="meta">read-only · окно ${meta.fromIso}..${meta.today} · темп в мин/км · якорь посчитан по ${meta.anchorN} атл · забегов отсеяно как «медленнее тренировок»: ${meta.racesDroppedSlow} · источник порога: забег (E-Predictor FTPa) &gt; интервалы≥6мин/темпо≥20мин &gt; якорь÷1.25</div>
<div class="summary">${pill(agg.total, "всего")}${pill(agg.applied, "применено")}${pill(agg.candidates, "кандидатов")}${pill(agg.anomalies, "в аномалиях")}${pill(agg.nodata, "без данных")}${pill(agg.hold, "hold")}</div>
<div class="toolbar"><span id="counter"></span><button id="export">⬇ Выгрузить решения</button><button id="clearall">Очистить</button><span class="hint">по строке: ✓ принять · поле темпа можно править · ✗ отклонить (+причина). Решения сохраняются в браузере.</span></div>
<div class="scroll">
${section("1 · По забегу (E-Predictor, свежие 10к/полумарафон и надёжные сверху)", g("race").sort(byConf), "Порог = ftpaSecPerKm(vdotFromRace). «менее надёжно» = длительность забега <40мин или >75мин.")}
${section("2 · По интервалам ≥6мин / темпо ≥20мин (нет пригодного забега)", g("interval").sort((a,b)=>(a.proposed??9e9)-(b.proposed??9e9)))}
${section("3 · Грубо: лёгкий якорь ÷ 1.25 (нет забега/интервалов)", g("rough"), "Ориентир, не значение для простановки.")}
${section("⚠ Аномалия — отношение >1.45 (порог слишком быстрый ИЛИ якорь слишком медленный)", g("anomaly-high"), "НЕ ставить автоматом — разобрать руками.")}
${section("⚠ Отношение ≈1.0 — порога фактически нет (лёгкий ≈ порог)", g("anomaly-low"), "Человек не бегает быстрее лёгкого — порог не выделяется.")}
${section("⚠ Источники спорят (>20с между забегом и интервалами/темпо)", g("dispute"), "Показаны оба числа — решать глазами, какой источник вернее.")}
${section("Беговой набор (wt=3) vs default (wt=0) — шестеро, показаны ОБА числа", meta.six, "Справочно (решения — в основной группе каждого). Лаврентьев и Хоффман: беговой может быть медленнее и ВЕРНЫМ (как Бучкина) — не выравнивать молча.", false)}
${section("Нет лёгкого якоря (самопроверку не сделать)", g("no-anchor"))}
${section("Совсем нет данных", g("nodata"))}
</div></div>
<script>
(function(){
 var KEY='scan-rerun-decisions-v1';
 var store={};try{store=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(e){store={};}
 function persist(){try{localStorage.setItem(KEY,JSON.stringify(store));}catch(e){}}
 function fmt(sec){var m=Math.floor(sec/60),s=Math.round(sec%60);if(s===60){s=0;m++;}return m+':'+String(s).padStart(2,'0');}
 function parse(s){var m=/^(\\d{1,2}):([0-5]?\\d)$/.exec((s||'').trim());return m?(+m[1]*60+ +m[2]):null;}
 function render(){var acc=0,rej=0,tot=0;var trs=document.querySelectorAll('tr[data-aid]');
  for(var i=0;i<trs.length;i++){var tr=trs[i];tot++;var st=store[tr.getAttribute('data-aid')]||{};
   var cb=tr.querySelector('.k-acc input');var rs=tr.querySelector('.k-reason');
   tr.classList.toggle('accepted',st.status==='accept');tr.classList.toggle('rejected',st.status==='reject');
   if(cb)cb.checked=st.status==='accept';if(rs)rs.style.display=st.status==='reject'?'inline-block':'none';
   if(st.status==='accept')acc++;if(st.status==='reject')rej++;}
  var c=document.getElementById('counter');if(c)c.innerHTML='принято '+acc+' · отклонено '+rej+' · осталось '+(tot-acc-rej)+' из '+tot;}
 document.addEventListener('change',function(e){var tr=e.target.closest?e.target.closest('tr[data-aid]'):null;if(!tr)return;var aid=tr.getAttribute('data-aid');var st=store[aid]||{};
  if(e.target.closest('.k-acc')){st.status=e.target.checked?'accept':'';if(e.target.checked){var v=tr.querySelector('.k-val').value;if(v)st.value=v;}store[aid]=st;persist();render();}});
 document.addEventListener('input',function(e){var tr=e.target.closest?e.target.closest('tr[data-aid]'):null;if(!tr)return;var aid=tr.getAttribute('data-aid');var st=store[aid]||{};
  if(e.target.classList.contains('k-val'))st.value=e.target.value;
  if(e.target.classList.contains('k-reason'))st.reason=e.target.value;
  store[aid]=st;persist();});
 document.addEventListener('click',function(e){if(e.target.classList&&e.target.classList.contains('k-rej')){var tr=e.target.closest('tr[data-aid]');var aid=tr.getAttribute('data-aid');var st=store[aid]||{};st.status=st.status==='reject'?'':'reject';store[aid]=st;persist();render();}});
 var exp=document.getElementById('export');if(exp)exp.addEventListener('click',function(){var out=[],bad=[];var trs=document.querySelectorAll('tr[data-aid]');
  for(var i=0;i<trs.length;i++){var tr=trs[i];var aid=tr.getAttribute('data-aid');var st=store[aid]||{};if(!st.status)continue;var name=tr.getAttribute('data-name');
   if(st.status==='accept'){var sec=parse(st.value||tr.querySelector('.k-val').value);if(sec==null){bad.push(name);continue;}out.push({athlete_id:+aid,name:name,status:'accept',pace:fmt(sec),pace_sec:sec,mps:+(1000/sec).toFixed(4)});}
   else out.push({athlete_id:+aid,name:name,status:'reject',reason:st.reason||''});}
  if(bad.length){alert('Плохой формат темпа (нужно mm:ss) у: '+bad.join(', '));return;}
  var payload={generated:new Date().toISOString().slice(0,10),count:out.length,decisions:out};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='threshold-decisions.json';document.body.appendChild(a);a.click();a.remove();});
 var clr=document.getElementById('clearall');if(clr)clr.addEventListener('click',function(){if(confirm('Очистить ВСЕ решения?')){store={};persist();var trs=document.querySelectorAll('tr[data-aid]');for(var i=0;i<trs.length;i++){var cb=trs[i].querySelector('.k-acc input');if(cb)cb.checked=false;var rs=trs[i].querySelector('.k-reason');if(rs)rs.value='';}render();}});
 (function(){var trs=document.querySelectorAll('tr[data-aid]');for(var i=0;i<trs.length;i++){var tr=trs[i];var st=store[tr.getAttribute('data-aid')];if(st){if(st.value!=null){var v=tr.querySelector('.k-val');if(v)v.value=st.value;}if(st.reason!=null){var r=tr.querySelector('.k-reason');if(r)r.value=st.reason;}}}})();
 render();
})();
</script>
</body></html>`;
}
main().catch((e: unknown) => { console.error("tp-scan-rerun-artifact failed."); console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
