// C3 — positive dictionary. Even on a clean, unremarkable workout the draft
// should name something CONCRETE (design Part B), not a bare "molodets". Every
// evaluator below is a pure threshold read off a real field; thresholds without
// a repo precedent are called out as judgment calls in their own comment
// (there is no existing "is this good" cutoff to inherit for most of these —
// only DECOUPLING_THRESHOLD_PP=3 exists, and it is a vs-history delta, not an
// absolute single-workout read, so it does not transfer here).
//
// praise_comparison_progress (C8) and praise_default_good (no-signal fallback)
// are NOT here: the former comes from compareWorkout via comparison-slot.ts,
// the latter is the orchestrator's fallback when nothing else fired.
// praise_in_zone is SLEEPING (see signal-type-table.ts SLEEPING_SLOTS) —
// pct_time_*_target is NULL across the whole base.

import { parseComparisonKey } from "../comparison/index.ts";
import { computeSplitHalf } from "./split-half.ts";
import type { AdviceKey } from "./advice-keys.ts";
import type { PlannerDerivedMetrics, PlannerLap, SessionType } from "./types.ts";

export const EVEN_PACE_CV_MAX_PCT = 4; // judgment call: "очень ровно" for rep-to-rep pace CV
export const GOOD_RECOVERY_MIN_DROP_BPM = 20; // judgment call: healthy HR fall in the recovery window
export const STEADY_HR_MAX_DECOUPLING_PCT = 2; // below the 5% drift threshold, a deliberate dead zone in between
export const LONG_HELD_MIN_DURATION_S = 5400; // 90 min — matches the corpus example "полтора часа ровно удержал"
export const HR_RISE_TOLERANCE_BPM = 2; // "ровно растут": no consecutive drop bigger than this
// Raw-HR guard for the steady-HR praise. Decoupling (HR/pace ratio) stays low even when raw HR climbs
// with a faster pace (negative split) — so a low decoupling does NOT prove «пульс не пополз» (Паутов:
// 147→153 avg, decoupling 1.4%). When we DO have a half split, don't praise steadiness if the second
// half's average HR rose more than this. Single-lap runs have no split → the reframed claim (efficiency,
// not raw pulse) carries the honesty there.
export const SECOND_HALF_HR_RISE_MAX_BPM = 5;

export type PositiveSignal = { key: AdviceKey; metric: string; numbers: Record<string, number>; reason: string };

export function evaluateEvenPace(current: PlannerDerivedMetrics, sessionType: SessionType): PositiveSignal | null {
  if (sessionType !== "interval" || current.repPaceCv === null) return null;
  if (current.repPaceCv > EVEN_PACE_CV_MAX_PCT) return null;
  return { key: "praise_even_pace", metric: "rep_pace_cv", numbers: { repPaceCv: current.repPaceCv }, reason: `rep_pace_cv=${current.repPaceCv} <= ${EVEN_PACE_CV_MAX_PCT}` };
}

export function evaluateGoodRecovery(current: PlannerDerivedMetrics, sessionType: SessionType): PositiveSignal | null {
  if (sessionType !== "interval" || current.repRecoveryDrops === null) return null;
  const drops = current.repRecoveryDrops.filter((d): d is number => d !== null);
  if (drops.length === 0) return null;
  const sorted = [...drops].sort((a, b) => a - b);
  const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  if (median < GOOD_RECOVERY_MIN_DROP_BPM) return null;
  return { key: "praise_good_recovery", metric: "rep_recovery_drops", numbers: { medianDropBpm: median, repCount: drops.length }, reason: `median recovery drop ${median}bpm >= ${GOOD_RECOVERY_MIN_DROP_BPM}` };
}

export function evaluateSteadyHrRise(current: PlannerDerivedMetrics, sessionType: SessionType): PositiveSignal | null {
  if (sessionType !== "interval" || current.repPeakHrs === null) return null;
  const hrs = current.repPeakHrs.filter((h): h is number => h !== null);
  if (hrs.length < 3) return null;
  for (let i = 1; i < hrs.length; i += 1) {
    if (hrs[i]! < hrs[i - 1]! - HR_RISE_TOLERANCE_BPM) return null;
  }
  return { key: "praise_steady_hr_rise", metric: "rep_peak_hrs", numbers: { repCount: hrs.length, firstHr: hrs[0]!, lastHr: hrs[hrs.length - 1]! }, reason: `${hrs.length} reps, no drop > ${HR_RISE_TOLERANCE_BPM}bpm between consecutive peaks` };
}

export function evaluateFullStructure(current: PlannerDerivedMetrics, sessionType: SessionType): PositiveSignal | null {
  if (sessionType !== "interval" || current.comparisonKey === null || current.repsDetectedCount === null) return null;
  const parsed = parseComparisonKey(current.comparisonKey);
  if (parsed === null) return null;
  const plannedReps = parsed.blocks.reduce((sum, b) => sum + b.repeat, 0);
  if (current.repsDetectedCount !== plannedReps) return null;
  return { key: "praise_full_structure", metric: "reps_detected_count", numbers: { plannedReps, detectedReps: current.repsDetectedCount }, reason: `detected ${current.repsDetectedCount} == planned ${plannedReps}` };
}

/** Fires the moderate or the strong, duration-led variant of "aerobically steady" — same underlying
 *  signal (low decoupling), one output. The CLAIM is about efficiency (HR/pace held), NOT raw pulse: a
 *  low decoupling can coexist with a rising HR when the pace rose too. When laps give a half split, we
 *  additionally REFUSE to praise steadiness if raw HR climbed in the second half (Паутов). */
export function evaluateSteadyHr(current: PlannerDerivedMetrics, sessionType: SessionType, laps: PlannerLap[] = []): PositiveSignal | null {
  if (sessionType !== "long_tempo" || current.hrDecouplingPct === null || current.durationS === null) return null;
  if (current.hrDecouplingPct > STEADY_HR_MAX_DECOUPLING_PCT) return null;
  const split = computeSplitHalf(laps);
  if (split && split.firstHalfAvgHr !== null && split.secondHalfAvgHr !== null && split.secondHalfAvgHr - split.firstHalfAvgHr > SECOND_HALF_HR_RISE_MAX_BPM) {
    return null; // raw HR clearly rose in the 2nd half — not steady, whatever decoupling says
  }
  if (current.durationS >= LONG_HELD_MIN_DURATION_S) {
    return { key: "praise_long_held_steady", metric: "hr_decoupling_pct", numbers: { hrDecouplingPct: current.hrDecouplingPct, durationS: current.durationS }, reason: `decoupling ${current.hrDecouplingPct}% <= ${STEADY_HR_MAX_DECOUPLING_PCT}% over ${Math.round(current.durationS / 60)}min` };
  }
  return { key: "praise_hr_steady_long", metric: "hr_decoupling_pct", numbers: { hrDecouplingPct: current.hrDecouplingPct }, reason: `decoupling ${current.hrDecouplingPct}% <= ${STEADY_HR_MAX_DECOUPLING_PCT}%` };
}

export function collectPositiveSignals(current: PlannerDerivedMetrics, sessionType: SessionType, laps: PlannerLap[] = []): PositiveSignal[] {
  return [
    evaluateEvenPace(current, sessionType),
    evaluateGoodRecovery(current, sessionType),
    evaluateSteadyHrRise(current, sessionType),
    evaluateFullStructure(current, sessionType),
    evaluateSteadyHr(current, sessionType, laps),
  ].filter((s): s is PositiveSignal => s !== null);
}
