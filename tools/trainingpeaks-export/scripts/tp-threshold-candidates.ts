/**
 * READ-ONLY. Ranked list of athletes who are candidates for a threshold edit,
 * scored by evidence reliability (recent 10k / half-marathon on top).
 *
 * NO writes anywhere (TP or DB). Output is a local markdown file with NAMES
 * (Igor's local review) — nothing is printed to chat by design; stdout carries
 * only progress + aggregates.
 *
 * WHY THIS EXISTS / THE FIX:
 *   The earlier tp-threshold-estimation required a race to match a FIT-derived
 *   workout (has_fit + laps). That threw away ~21 of 37 athletes with a race,
 *   because a threshold estimate does NOT need FIT — a race distance + finish
 *   time is enough. Here tier A/B uses race distance (trainingpeaks_race_events)
 *   + the finish time from the completed workout (trainingpeaks_workout_cache,
 *   `completed_time_raw` is in HOURS), with NO FIT requirement.
 *
 * CONVERSION — REUSES THE EXISTING ENGINE, does NOT reinvent it:
 *   proposed threshold pace = ftpaSecPerKm(vdotFromRace(dist, time)) from
 *   src/app/tools/plan/vdot.ts — VDOT (Daniels) → FTPa anchor (0.913), which that
 *   module documents as "пороговый темп-якорь ≈ соревновательный темп на 10 км /
 *   часовой порог" (= the TP threshold, the Z4/Z5a boundary). Verified: 10k@40:00
 *   → FTPa 4:00/km, the module's own reference example.
 *   NOTE: there is no "personal CF" concept in the repo engine (the personalized
 *   E-Predictor path is too coupled to call standalone — it needs staleness-
 *   annotated FIT workout arrays / segment comparisons). The callable VDOT+FTPa
 *   anchor path is used; no second conversion was written.
 *   The engine is PACE-ONLY — it produces no threshold HR. Proposed HR is taken
 *   from the race's own average HR where the FIT HR was trusted, else left blank.
 *
 * Usage: npx tsx tools/trainingpeaks-export/scripts/tp-threshold-candidates.ts [--months=18]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { parseAthleteIdFromUrl } from "../../../src/features/trainingpeaks/athlete-roster-import.ts";
import { ftpaSecPerKm, vdotFromRace } from "../../../src/app/tools/plan/vdot.ts";
import { toolRoot } from "./lib/paths.ts";
import { getCoveredScheme } from "./lib/tp-zone-formulas.ts";

// ── env / supabase ─────────────────────────────────────────────────────────────
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
function getSupabase() {
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

// ── pace formatting ────────────────────────────────────────────────────────────
function fmtPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
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

// distance → tier + category rank (10k/half rank 0 = top)
function classify(distanceKm: number): { tier: string; rank: number } {
  if (distanceKm >= 9.5 && distanceKm <= 10.5) return { tier: "10k (A)", rank: 0 };
  if (distanceKm >= 20.0 && distanceKm <= 21.6) return { tier: "half (A)", rank: 0 };
  if (distanceKm >= 4.5 && distanceKm <= 5.5) return { tier: "5k (B)", rank: 1 };
  if (distanceKm >= 41.5 && distanceKm <= 43.0) return { tier: "marathon (B)", rank: 1 };
  return { tier: `${distanceKm}km (B)`, rank: 2 };
}

type Candidate = {
  athleteId: number;
  name: string;
  currentPaceSecPerKm: number | null;
  proposedPaceSecPerKm: number;
  currentHr: number | null;
  proposedHr: number | null;
  raceDate: string;
  officialKm: number;
  finishSec: number;
  measuredPaceSecPerKm: number;
  tier: string;
  rank: number;
  speedMethod: number | null;
  speedCovered: boolean;
};

async function main(): Promise<void> {
  const supabase = getSupabase();
  const months = Number(getCli("--months=") ?? 18);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - Math.round(months * 30.44));
  const fromIso = fromDate.toISOString().slice(0, 10);
  console.log(`tp-threshold-candidates: races ${fromIso}..${today}. READ-ONLY, no writes.`);

  // 1) name map + current thresholds/methods from snapshots
  const nameById = new Map<number, string>();
  {
    const { data } = await supabase.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, student_name").not("student_name", "is", null);
    for (const r of data ?? []) {
      const id = Number(r.trainingpeaks_athlete_id);
      if (Number.isInteger(id) && typeof r.student_name === "string" && !nameById.has(id)) nameById.set(id, r.student_name);
    }
    // fallback: names from the roster table (id parsed from the athlete URL)
    const { data: students } = await supabase.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url");
    for (const r of students ?? []) {
      const url = typeof r.trainingpeaks_athlete_url === "string" ? r.trainingpeaks_athlete_url : null;
      const id = url ? parseAthleteIdFromUrl(url) : null;
      if (id !== null && id > 0 && typeof r.student_name === "string" && !nameById.has(id)) nameById.set(id, r.student_name);
    }
  }
  const current = new Map<number, { pace: number | null; hr: number | null; speedMethod: number | null }>();
  {
    const { data, error } = await supabase.from("tp_zone_snapshots").select("trainingpeaks_athlete_id, zones, captured_at").order("captured_at", { ascending: false });
    if (error) throw new Error(`tp_zone_snapshots: ${error.message}`);
    for (const r of data ?? []) {
      const id = Number(r.trainingpeaks_athlete_id);
      if (current.has(id)) continue; // newest snapshot per athlete
      const z = r.zones as Record<string, unknown> | null;
      const sp = wt0(z?.speedZones);
      const hr = wt0(z?.heartRateZones);
      current.set(id, {
        pace: typeof sp?.threshold === "number" && sp.threshold > 0 ? 1000 / sp.threshold : null,
        hr: typeof hr?.threshold === "number" ? Math.round(hr.threshold) : null,
        speedMethod: typeof sp?.calculationMethod === "number" ? sp.calculationMethod : null,
      });
    }
  }
  console.log(`names: ${nameById.size}, snapshots: ${current.size}`);

  // 2) races with distance in window
  const { data: raceRows, error: rErr } = await supabase
    .from("trainingpeaks_race_events")
    .select("trainingpeaks_athlete_id, event_date, distance_km")
    .gte("event_date", fromIso)
    .lte("event_date", today)
    .order("event_date", { ascending: false });
  if (rErr) throw new Error(`race_events: ${rErr.message}`);
  const races = (raceRows ?? []).filter((r) => typeof r.distance_km === "number" && (r.distance_km as number) > 0);
  console.log(`races with distance: ${races.length}`);

  // 3) per race → matching completed workout (closest distance to official, within 15%) → time + HR
  const candidatesByAthlete = new Map<number, Candidate>();
  let noWorkoutMatch = 0;
  let paceInsane = 0;

  for (const r of races) {
    const athleteId = Number(r.trainingpeaks_athlete_id);
    const officialKm = r.distance_km as number;
    const officialM = officialKm * 1000;

    const { data: wc } = await supabase
      .from("trainingpeaks_workout_cache")
      .select("id, completed_distance_raw, completed_time_raw")
      .eq("trainingpeaks_athlete_id", athleteId)
      .eq("workout_date", r.event_date);
    // pick the completed run whose measured distance is closest to the official
    // race distance AND within 15% — this excludes warm-ups/cool-downs.
    let best: { cacheId: string; measM: number; timeSec: number } | null = null;
    for (const w of wc ?? []) {
      const measM = typeof w.completed_distance_raw === "number" ? (w.completed_distance_raw as number) : 0;
      const tHours = typeof w.completed_time_raw === "number" ? (w.completed_time_raw as number) : 0;
      if (measM <= 0 || tHours <= 0) continue;
      if (Math.abs(measM - officialM) / officialM > 0.15) continue; // not this workout (warm-up etc.)
      const cand = { cacheId: w.id as string, measM, timeSec: tHours * 3600 };
      if (!best || Math.abs(cand.measM - officialM) < Math.abs(best.measM - officialM)) best = cand;
    }
    if (!best) {
      noWorkoutMatch += 1;
      continue;
    }

    // Feed the MEASURED distance + measured time (the real effort) to VDOT.
    // race_events.distance_km is scan-sourced (not certified), so it is used only
    // to know "this was a race" and to pick the right workout — not as a trusted
    // exact distance. (GPS can over-read a little, so a proposed pace may be a
    // touch optimistic; noted in the method header.)
    const finishSec = best.timeSec;
    const measuredPace = finishSec / (best.measM / 1000);
    const proposedPace = ftpaSecPerKm(vdotFromRace(best.measM, finishSec));
    if (!(proposedPace > 150 && proposedPace < 540) || !(measuredPace > 120 && measuredPace < 600)) {
      paceInsane += 1;
      continue;
    }

    // HR: race avg HR where the FIT HR was trusted (engine gives no threshold HR)
    let proposedHr: number | null = null;
    const { data: dm } = await supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select("avg_hr, hr_trusted")
      .eq("workout_cache_id", best.cacheId)
      .limit(1);
    const dmRow = (dm ?? [])[0];
    if (dmRow && dmRow.hr_trusted === true && typeof dmRow.avg_hr === "number") proposedHr = Math.round(dmRow.avg_hr as number);

    const cls = classify(officialKm);
    const cur = current.get(athleteId) ?? { pace: null, hr: null, speedMethod: null };
    const candidate: Candidate = {
      athleteId,
      name: nameById.get(athleteId) ?? `id ${athleteId}`,
      currentPaceSecPerKm: cur.pace,
      proposedPaceSecPerKm: proposedPace,
      currentHr: cur.hr,
      proposedHr,
      raceDate: r.event_date as string,
      officialKm,
      finishSec,
      measuredPaceSecPerKm: measuredPace,
      tier: cls.tier,
      rank: cls.rank,
      speedMethod: cur.speedMethod,
      speedCovered: cur.speedMethod !== null && getCoveredScheme("speed", cur.speedMethod) !== null,
    };
    // keep the BEST race per athlete (lowest rank, then most recent)
    const existing = candidatesByAthlete.get(athleteId);
    if (!existing || candidate.rank < existing.rank || (candidate.rank === existing.rank && candidate.raceDate > existing.raceDate)) {
      candidatesByAthlete.set(athleteId, candidate);
    }
  }

  const candidates = [...candidatesByAthlete.values()].sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : b.raceDate.localeCompare(a.raceDate)));
  console.log(`candidates (athletes with a usable race): ${candidates.length} · no-workout-match races: ${noWorkoutMatch} · pace-insane: ${paceInsane}`);

  // 4) sections
  const covered = candidates.filter((c) => c.speedCovered);
  const notCovered = candidates.filter((c) => !c.speedCovered);
  const withRaceIds = new Set(candidates.map((c) => c.athleteId));
  const noData = [...current.keys()].filter((id) => !withRaceIds.has(id)).map((id) => ({ id, name: nameById.get(id) ?? `id ${id}`, method: current.get(id)?.speedMethod ?? null }));

  // 5) render local markdown
  const lines: string[] = [];
  const deltaStr = (c: Candidate): string => {
    if (c.currentPaceSecPerKm === null) return "—";
    const d = c.proposedPaceSecPerKm - c.currentPaceSecPerKm;
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    return `${sign}${Math.abs(Math.round(d))}с`;
  };
  const row = (c: Candidate): string =>
    `| ${c.name} | ${fmtPace(c.currentPaceSecPerKm)} | **${fmtPace(c.proposedPaceSecPerKm)}** | ${deltaStr(c)} | ${c.currentHr ?? "—"} | ${c.proposedHr ?? "—"} | ${c.raceDate} · ${c.officialKm}км · ${fmtClock(c.finishSec)} (изм. темп ${fmtPace(c.measuredPaceSecPerKm)}) | ${c.tier} | ${c.speedCovered ? "✅" : `❌ м${c.speedMethod ?? "?"}`} |`;

  lines.push(`# Кандидаты на правку порога (read-only, ${today})`);
  lines.push("");
  lines.push(`Порог темпа считается существующим движком vdot.ts: \`ftpaSecPerKm(vdotFromRace(dist,time))\` (VDOT Дэниелса → FTPa-якорь 0.913 = «часовой порог/темп 10к» = TP-порог Z4/Z5a). Своя формула НЕ писалась. «Персонального CF» в движке нет — персонализированный E-Predictor не вызывается автономно (нужны FIT-сегменты); используется callable VDOT+FTPa путь.`);
  lines.push(`Порогового ПУЛЬСА движок не даёт → «предлагаемый пульс» = средний пульс забега, где FIT-пульс был надёжен (\`hr_trusted\`), иначе «—». Это ориентир (10к ≈ порог; полумарафон чуть ниже), не конверсия.`);
  lines.push(`Время и дистанция забега — из \`trainingpeaks_workout_cache\` (\`completed_time_raw\` в ЧАСАХ, \`completed_distance_raw\` в метрах), FIT НЕ требуется (это и есть починка). \`race_events.distance_km\` (source=scan, не сертификат) служит только чтобы (а) знать «это забег» и (б) выбрать нужный воркаут — берётся тот, чья ИЗМЕРЕННАЯ дистанция ближе всего к заявленной (±15%), чтобы не поймать разминку. VDOT считается по реально пройденному (GPS может чуть завышать → предлагаемый темп может быть слегка оптимистичен).`);
  lines.push(`⚠️ «Текущий порог» — из \`tp_zone_snapshots\` (может устареть; на запись CLI всё равно читает живой TP). Темп в мин/км.`);
  lines.push("");
  lines.push(`## 1. Кандидаты по надёжности (свежие 10к / полумарафон сверху)`);
  lines.push("");
  lines.push(`| имя | тек. темп | предлаг. темп | Δ | тек. пульс | предлаг. пульс | на чём основано | тир | метод покрыт |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const c of candidates) lines.push(row(c));
  lines.push("");
  lines.push(`Итого кандидатов: ${candidates.length} (метод покрыт: ${covered.length}, не покрыт: ${notCovered.length}).`);
  lines.push("");

  lines.push(`## 2. Метод НЕ покрыт формулой — правка порога через CLI невозможна`);
  lines.push("");
  if (notCovered.length === 0) {
    lines.push(`(нет — у всех кандидатов speed-метод покрыт)`);
  } else {
    lines.push(`Есть свежее доказательство, но \`set-threshold\` откажет (speed calcMethod не выведен):`);
    lines.push("");
    lines.push(`| имя | speed calcMethod | предлаг. темп (справочно) | на чём |`);
    lines.push(`|---|---|---|---|`);
    for (const c of notCovered) lines.push(`| ${c.name} | ${c.speedMethod ?? "?"} | ${fmtPace(c.proposedPaceSecPerKm)} | ${c.raceDate} · ${c.officialKm}км · ${fmtClock(c.finishSec)} |`);
  }
  lines.push("");

  lines.push(`## 3. Нет данных для оценки (в снапшотах есть, забега в окне нет)`);
  lines.push("");
  lines.push(`Атлетов без пригодного забега за ${months} мес: ${noData.length}.`);
  lines.push("");
  lines.push(`| имя | speed calcMethod |`);
  lines.push(`|---|---|`);
  for (const n of noData.sort((a, b) => a.name.localeCompare(b.name))) lines.push(`| ${n.name} | ${n.method ?? "?"} |`);
  lines.push("");

  const outDir = path.join(toolRoot, "action-artifacts", "threshold-candidates");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "candidates.md");
  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`\n── aggregates ──`);
  console.log(`candidates: ${candidates.length} (covered ${covered.length}, not-covered ${notCovered.length})`);
  console.log(`no-data athletes: ${noData.length}`);
  console.log(`\nlocal file (names, NOT chat): ${outPath}`);
}

main().catch((e: unknown) => {
  console.error("tp-threshold-candidates failed.");
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
