// C2 — one signal, different meaning by session type. This file is the table
// itself PLUS the evaluators for the two rows that have real backing data
// (interval fade, HR drift on long/tempo). "Разгон во 2й половине" /
// negative-split live in negative-split.ts (they need laps, not derived
// scalars). Rows with no backing field are listed here as SLEEPING, not
// silently dropped, so the proof can show honestly what fires vs what can't.
//
// SLEEPING (documented, not implemented — see ЭТАП 2 plan):
//   - fast-start-rep: needs Этап 0.5 (rep_fast_start_delta_sec_per_km), not built yet.
//   - recovery-too-fast: no recovery-LAP-pace field exists anywhere in derived_metrics
//     (rep_recovery_drops is HR-drop only) — checked before writing this file.
//   - easy-too-fast (гонка на лёгкой): needs pct_time_pace_target, NULL across the base.

import type { PlannerDerivedMetrics, SessionType } from "./types.ts";

// Positive rep_pace_fade_pct = last rep slower than first (see fit-interval-scalars.ts:
// (last-first)/first*100, pace in sec/km so higher = slower). "Мягко, если сильный" —
// one soft entry threshold, not two tiers; 8% is a judgment call, not a repo precedent.
export const INTERVAL_FADE_MIN_PCT = 8;

// No absolute "this workout drifted" threshold exists anywhere in the repo —
// DECOUPLING_THRESHOLD_PP=3 (steady-matcher.ts) is a vs-personal-history delta, not
// an absolute badness cutoff. 5% is the standard aerobic-decoupling convention
// (Maffetone / TrainingPeaks coaching literature), used here for lack of a repo
// precedent for an absolute single-workout read.
export const HR_DECOUPLING_DRIFT_THRESHOLD_PCT = 5;

export type SleepingSlot = { slot: string; reason: string };

export const SLEEPING_SLOTS: SleepingSlot[] = [
  { slot: "fast_start_rep", reason: "needs Этап 0.5 (rep fast-start field not computed yet)" },
  { slot: "recovery_too_fast", reason: "no recovery-lap-pace field in derived_metrics (rep_recovery_drops is HR-drop only)" },
  { slot: "easy_too_fast", reason: "needs pct_time_pace_target, NULL across the whole base" },
];

export type IntervalFadeResult = { fired: false } | { fired: true; fadePct: number };

export function evaluateIntervalFade(current: PlannerDerivedMetrics): IntervalFadeResult {
  if (current.repPaceFadePct === null || current.repPaceFadePct < INTERVAL_FADE_MIN_PCT) return { fired: false };
  return { fired: true, fadePct: current.repPaceFadePct };
}

/** Long/tempo only — a direct correction (C1 effort-control theme), not gated
 *  by memory words. On easy runs, high decoupling instead feeds fatigue-cause.ts
 *  (C4): the design routes it through "причина, не вина", same as a high avg_hr. */
export type HrDriftTempoResult = { fired: false } | { fired: true; decouplingPct: number };

export function evaluateHrDriftTempo(input: { current: PlannerDerivedMetrics; sessionType: SessionType }): HrDriftTempoResult {
  if (input.sessionType !== "long_tempo") return { fired: false };
  const pct = input.current.hrDecouplingPct;
  if (pct === null || pct < HR_DECOUPLING_DRIFT_THRESHOLD_PCT) return { fired: false };
  return { fired: true, decouplingPct: pct };
}

export function evaluateEasyHrDrift(input: { current: PlannerDerivedMetrics; sessionType: SessionType }): HrDriftTempoResult {
  if (input.sessionType !== "easy") return { fired: false };
  const pct = input.current.hrDecouplingPct;
  if (pct === null || pct < HR_DECOUPLING_DRIFT_THRESHOLD_PCT) return { fired: false };
  return { fired: true, decouplingPct: pct };
}
