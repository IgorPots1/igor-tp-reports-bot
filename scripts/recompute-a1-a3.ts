/**
 * Port-remainder recompute (READ-ONLY) — A1 meaningfulness filter on FULL data +
 * the A3 eligible-student denominator. Writes nothing to the DB.
 *
 * A1: for each (student, distance) take the best non-race non-hidden lap split and
 * ask whether it clears the meaningfulness bar vs the athlete's baseline. Reports
 * survivors per distance and how many students have a baseline.
 * A3: reports the eligible-student denominator (visible students, and those with a
 * completed run reaching each distance) — the real "123 not 53".
 */

import { evaluateAllRecordsForValidation, classifyRecordType } from "@/features/club/service";
import { baselinePaceSecPerKm, isSplitMeaningful } from "@/features/club/records";
import * as C from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

function paceOf(km: number, sec: number): number | null {
  return km > 0 && sec > 0 ? sec / km : null;
}

async function main(): Promise<void> {
  const run = await evaluateAllRecordsForValidation({ useBestSplit: true });
  const keys = C.CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];
  const margin = C.CLUB_RECORD_MEANINGFUL_SPLIT_MARGIN;

  // baseline per student
  const baseline = new Map<string, number | null>();
  for (const s of run.students) {
    const paces: number[] = [];
    for (const r of run.rows) {
      if (r.studentId !== s.id || !r.isCompleted || !r.isRunning) continue;
      const km = r.distanceKm ?? 0, sec = r.durationSeconds ?? 0;
      if (km < C.CLUB_RECORD_BASELINE_MIN_KM || sec <= 0) continue;
      paces.push(sec / km);
    }
    baseline.set(
      s.id,
      baselinePaceSecPerKm(paces, {
        minRuns: C.CLUB_RECORD_BASELINE_MIN_RUNS,
        floorSecPerKm: C.CLUB_RECORD_BASELINE_PACE_FLOOR_SEC_PER_KM,
        ceilingSecPerKm: C.CLUB_RECORD_PACE_CEILING_SEC_PER_KM,
      })
    );
  }
  const withBaseline = [...baseline.values()].filter((b) => b !== null).length;

  // A1 survivors per distance (training splits only, non-race)
  const survived: Record<string, number> = {};
  const beforeFilter: Record<string, number> = {};
  for (const k of keys) { survived[k] = 0; beforeFilter[k] = 0; }

  for (const s of run.students) {
    const perDist = run.byStudent.get(s.id);
    const b = baseline.get(s.id) ?? null;
    for (const k of keys) {
      const evals = perDist?.get(k)?.evaluated ?? [];
      // best non-hidden training split (not a race date)
      let bestTraining: { pace: number | null } | null = null;
      let bestDur = Infinity;
      for (const ev of evals) {
        if (ev.trust === "hidden") continue;
        if (classifyRecordType(s.id, ev.candidate.date, run.raceDatesByStudent) === "race") continue;
        if (ev.candidate.durationSeconds < bestDur) {
          bestDur = ev.candidate.durationSeconds;
          bestTraining = { pace: paceOf(ev.candidate.distanceKm, ev.candidate.durationSeconds) };
        }
      }
      if (bestTraining) {
        beforeFilter[k] += 1;
        if (isSplitMeaningful(bestTraining.pace, b, margin)) survived[k] += 1;
      }
    }
  }

  // A3 denominator: visible students + those with a completed run reaching each distance
  const eligiblePerDist: Record<string, number> = {};
  for (const k of keys) eligiblePerDist[k] = 0;
  const metersByKey = new Map(C.CLUB_RECORD_DISTANCES.map((d) => [d.key, d.meters]));
  for (const s of run.students) {
    for (const k of keys) {
      const need = (metersByKey.get(k) ?? 0) / 1000;
      const has = run.rows.some((r) => r.studentId === s.id && r.isCompleted && r.isRunning && (r.distanceKm ?? 0) >= need * 0.95);
      if (has) eligiblePerDist[k] += 1;
    }
  }

  console.log("== A1 recompute (full data) ==");
  console.log(`visible students=${run.students.length}, with baseline=${withBaseline}`);
  for (const k of keys) console.log(`  ${k}: training splits before A1=${beforeFilter[k]} → survive A1=${survived[k]}`);
  console.log("== A3 eligible-student denominator ==");
  console.log(`visible students (denominator for coverage) = ${run.students.length}`);
  for (const k of keys) console.log(`  ${k}: students with a completed run ≥ distance = ${eligiblePerDist[k]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
