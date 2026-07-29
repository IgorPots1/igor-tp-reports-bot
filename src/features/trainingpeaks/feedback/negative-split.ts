// Second-half-faster-than-first-half, arbitrated by pulse (Igor's rule,
// verbatim): "хорошо, ЕСЛИ пульс сильно не рос (разложил); с ростом пульса →
// это разгон, НЕ хвалить. Пульс — арбитр." One trigger (pace), the pulse
// decides which of the two outcomes fires — not two separate signals.
//
// Applies on easy and long/tempo runs (C2 table). On intervals this same idea
// is the meж-реповый fade signal (signal-type-table.ts), which uses rep_paces
// instead of a whole-run half split.

import { computeSplitHalf } from "./split-half.ts";
import type { PlannerLap, SessionType } from "./types.ts";

// Below this, a faster second half is noise, not a real negative split. Raised 5 → 12 (Igor, after the
// audit): on an easy run a 5-10 s/km faster second half is ordinary settle-in, not a surge — 6 of 21
// fires were in that band and false ("по треку разгона почти нет": Olga +7.4, Anton +12.8). 12 keeps
// the real surges and drops the noise. "Лучше промолчать, чем ругать зря."
export const NEGATIVE_SPLIT_MIN_DELTA_SEC_PER_KM = 12;
// HR arbiter. Raised 3 → 7 (Igor): a continuous run drifts up ~5-8 bpm at constant effort, so the old
// 3 bpm gate read normal drift as a surge (Anton +5.1, Olga +6.9 → wrongly "разогнался"). hrDelta < 7 →
// pulse stayed flat → disciplined split (praise); hrDelta >= 7 → really pushed (surge). Surge now needs
// BOTH: pace >= 12 s/km AND HR >= 7 bpm. HR unavailable → stay silent (can't confirm a push).
export const PULSE_STABLE_MAX_RISE_BPM = 7;
// Need >=4 laps so that after dropping the warmup lap there are still >=3 for a stable two-half split.
const MIN_LAPS_TO_DROP_WARMUP = 4;

export type NegativeSplitOutcome =
  | { kind: "none" }
  | {
      kind: "praise_disciplined";
      deltaSecPerKm: number; // positive = second half faster
      hrDeltaBpm: number;
      firstHalfPaceSecPerKm: number;
      secondHalfPaceSecPerKm: number;
    }
  | {
      kind: "correction_surge";
      deltaSecPerKm: number;
      hrDeltaBpm: number | null; // null when HR unavailable — pace-only signal, still a surge
      firstHalfPaceSecPerKm: number;
      secondHalfPaceSecPerKm: number;
      sessionType: Extract<SessionType, "easy" | "long_tempo">;
    };

// Drop the warmup (first) lap before splitting: the first km is usually a slow warmup that sits in the
// "first half" and inflates the "faster second half" (Anton +12.8 s/km mostly from a slow opener). Only
// when there are enough laps left for a stable split; a short run keeps all laps.
function dropWarmupLap(laps: PlannerLap[]): PlannerLap[] {
  const sorted = [...laps].filter((l) => l.distanceM !== null && l.distanceM > 0).sort((a, b) => a.lapIndex - b.lapIndex);
  return sorted.length >= MIN_LAPS_TO_DROP_WARMUP ? sorted.slice(1) : laps;
}

export function evaluateNegativeSplit(input: { laps: PlannerLap[]; sessionType: SessionType }): NegativeSplitOutcome {
  if (input.sessionType === "interval") return { kind: "none" };

  const split = computeSplitHalf(dropWarmupLap(input.laps));
  if (split === null) return { kind: "none" };

  const deltaSecPerKm = split.firstHalfPaceSecPerKm - split.secondHalfPaceSecPerKm; // positive = 2nd half faster
  if (deltaSecPerKm < NEGATIVE_SPLIT_MIN_DELTA_SEC_PER_KM) return { kind: "none" };

  // Surge requires BOTH: pace up >= 12 AND pulse up >= 7 (Igor's rule made strict). Without HR we can't
  // confirm the pulse rose, so we DON'T call it a surge — silence beats scolding a disciplined split.
  if (split.firstHalfAvgHr === null || split.secondHalfAvgHr === null) return { kind: "none" };

  const hrDeltaBpm = split.secondHalfAvgHr - split.firstHalfAvgHr;
  if (hrDeltaBpm < PULSE_STABLE_MAX_RISE_BPM) {
    // Faster second half, pulse stayed flat → the student разложил, not разгон. Praise.
    return {
      kind: "praise_disciplined",
      deltaSecPerKm,
      hrDeltaBpm,
      firstHalfPaceSecPerKm: split.firstHalfPaceSecPerKm,
      secondHalfPaceSecPerKm: split.secondHalfPaceSecPerKm,
    };
  }

  return {
    kind: "correction_surge",
    deltaSecPerKm,
    hrDeltaBpm,
    firstHalfPaceSecPerKm: split.firstHalfPaceSecPerKm,
    secondHalfPaceSecPerKm: split.secondHalfPaceSecPerKm,
    sessionType: input.sessionType,
  };
}
