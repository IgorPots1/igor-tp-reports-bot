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

// Below this, a faster second half is noise, not a real negative split — kept
// small but real, in the spirit of the other flat thresholds in this codebase
// (fast-start uses 10 s/km; this is a whole-run average, so smaller shifts
// are meaningful).
export const NEGATIVE_SPLIT_MIN_DELTA_SEC_PER_KM = 5;
// HR noise floor: measured HR MAD elsewhere in this codebase runs 2-4 bpm
// (pulse-anomaly.ts), so a "didn't rise" gate needs to clear that band to mean
// anything.
export const PULSE_STABLE_MAX_RISE_BPM = 3;

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

export function evaluateNegativeSplit(input: { laps: PlannerLap[]; sessionType: SessionType }): NegativeSplitOutcome {
  if (input.sessionType === "interval") return { kind: "none" };

  const split = computeSplitHalf(input.laps);
  if (split === null) return { kind: "none" };

  const deltaSecPerKm = split.firstHalfPaceSecPerKm - split.secondHalfPaceSecPerKm; // positive = 2nd half faster
  if (deltaSecPerKm < NEGATIVE_SPLIT_MIN_DELTA_SEC_PER_KM) return { kind: "none" };

  if (split.firstHalfAvgHr === null || split.secondHalfAvgHr === null) {
    // Pulse is the arbiter and it is unavailable — stay silent on praise, but a
    // clear pace surge is still worth a gentle correction (pace-only signal).
    return {
      kind: "correction_surge",
      deltaSecPerKm,
      hrDeltaBpm: null,
      firstHalfPaceSecPerKm: split.firstHalfPaceSecPerKm,
      secondHalfPaceSecPerKm: split.secondHalfPaceSecPerKm,
      sessionType: input.sessionType,
    };
  }

  const hrDeltaBpm = split.secondHalfAvgHr - split.firstHalfAvgHr;
  if (hrDeltaBpm <= PULSE_STABLE_MAX_RISE_BPM) {
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
