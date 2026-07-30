/**
 * Proof for the ±1 shifted-race gate on the comparison base (READ-ONLY). Drives the real
 * buildRaceExclusionKeys (feedback/race-shift-gate) over live data and prints, for every race
 * with no run on the event date but a run on E±1, whether the gate CAUGHT it (shifted race,
 * added on top of the exact-day exclusion) or PROTECTED it (easy/mismatched run).
 *
 * Expected on 2026-07-30 data: ~18 event/adjacent candidates → 2 ±1-excluded (night race +
 * marathon), the rest protected or already an exact race day.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/prove-race-norm-shift-gate.ts
 */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { buildRaceExclusionKeys, type RaceDayDistances, type RunForExclusion } from "@/features/trainingpeaks/feedback/race-shift-gate";

type Sb = ReturnType<typeof createSupabaseServerClient>;
async function pageAll<T>(sb: Sb, table: string, cols: string, runOnly = false): Promise<T[]> {
  const out: T[] = []; let from = 0; const size = 1000;
  for (;;) {
    const base = sb.from(table).select(cols).range(from, from + size - 1);
    const { data, error } = await (runOnly ? base.eq("workout_type", "run") : base);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data as T[]) ?? []; out.push(...rows);
    if (rows.length < size) break; from += size;
  }
  return out;
}
const shift = (ymd: string, d: number): string => {
  const [y, m, dd] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd! + d)).toISOString().slice(0, 10);
};

async function main() {
  const sb = createSupabaseServerClient();
  const raceRows = await pageAll<{ student_id: string; event_date: string; distance_km: number | null; source: string }>(
    sb, "trainingpeaks_race_events", "student_id, event_date, distance_km, source");
  const races: RaceDayDistances = new Map();
  for (const r of raceRows) {
    const day = (r.event_date ?? "").slice(0, 10); if (!r.student_id || !day) continue;
    const byDay = races.get(r.student_id) ?? new Map<string, number | null>();
    if (!byDay.has(day) || (r.source === "manual" && byDay.get(day) == null)) byDay.set(day, r.distance_km ?? null);
    races.set(r.student_id, byDay);
  }

  const ders = await pageAll<{ student_id: string; workout_date: string; workout_cache_id: string | null; avg_hr: number | null; hr_trusted: boolean | null }>(
    sb, "trainingpeaks_workout_derived_metrics", "student_id, workout_date, workout_cache_id, avg_hr, hr_trusted", true);
  const caches = await pageAll<{ id: string; completed_distance_raw: number | null }>(sb, "trainingpeaks_workout_cache", "id, completed_distance_raw");
  const distById = new Map(caches.map((c) => [c.id, c.completed_distance_raw != null ? c.completed_distance_raw / 1000 : null]));

  const runs: RunForExclusion[] = ders.map((d) => ({
    studentId: d.student_id,
    date: (d.workout_date ?? "").slice(0, 10),
    distanceKm: d.workout_cache_id ? distById.get(d.workout_cache_id) ?? null : null,
    avgHr: d.avg_hr,
    hrTrusted: !!d.hr_trusted,
  }));
  const keys = buildRaceExclusionKeys(races, runs);

  const byStudentDay = new Map<string, Map<string, RunForExclusion>>();
  for (const r of runs) (byStudentDay.get(r.studentId) ?? byStudentDay.set(r.studentId, new Map()).get(r.studentId)!).set(r.date, r);

  let shiftCaught = 0, protectedN = 0, exactAdj = 0;
  const caughtRows: string[] = []; const protRows: string[] = []; const seen = new Set<string>();
  for (const [sid, raceMap] of races) {
    const days = byStudentDay.get(sid) ?? new Map<string, RunForExclusion>();
    for (const [E, km] of raceMap) {
      if (days.has(E)) continue;
      for (const delta of [-1, 1]) {
        const d = shift(E, delta); const run = days.get(d);
        if (!run) continue;
        const dedup = `${sid}|${d}|${E}`; if (seen.has(dedup)) continue; seen.add(dedup);
        const title = run.distanceKm != null ? `${run.distanceKm.toFixed(1)}км` : "?км";
        const line = `  ${sid.slice(0, 8)} E=${E}(${km ?? "?"}км) ${delta > 0 ? "E+1" : "E-1"}=${d}: бег ${title} HR ${run.avgHr ?? "?"}${run.hrTrusted ? "" : "(untrusted)"}`;
        if (raceMap.has(d)) { exactAdj++; continue; } // adjacent day is itself a race (exact) — not a ±1 effect
        if (keys.has(`${sid}|${d}`)) { shiftCaught++; caughtRows.push(line + " → ±1 ИСКЛЮЧЁН (смещённая гонка)"); }
        else { protectedN++; protRows.push(line + " → оставлен"); }
      }
    }
  }
  console.log(`Кандидаты (нет бега в E, есть в E±1): ${shiftCaught + protectedN + exactAdj}`);
  console.log(`  · ±1 ИСКЛЮЧЕНО (истинно смещённые): ${shiftCaught}`);
  console.log(`  · ЗАЩИЩЕНО (лёгкие/несовпавшие): ${protectedN}`);
  console.log(`  · соседний день сам гонка (exact, не ±1): ${exactAdj}`);
  console.log("\n=== ±1 ИСКЛЮЧЕНО ===\n" + caughtRows.join("\n"));
  console.log("\n=== ЗАЩИЩЕНО ===\n" + protRows.join("\n"));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
