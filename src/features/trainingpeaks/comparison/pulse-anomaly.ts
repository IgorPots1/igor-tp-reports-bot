// Broken-HR-sensor detector (design doc "6. E. Детекция аномалии пульса" + п.12).
//
// This is NOT a fitness signal — it questions the DATA. We look at the
// pace+pulse COUPLE, never pulse in isolation: the entry condition is that the
// current pace is comparable to the class norm (|Δpace| < 10 s/км). If someone
// ran slower and the pulse is lower, that is normal — silence, no question.
//
// Grading is on the SHORTFALL (pulse LOWER than the norm at the same pace):
//   < 8 bpm   → silence (5–8 is a deliberate widening past the 5-bpm "say
//               something about pulse" threshold: to ACCUSE the sensor, 5 bpm is
//               not enough — measured HR MAD is 2–4 bpm, so 5–8 is 1.5–2.5 MAD
//               and proves nothing on one workout; a false flag is worse than a
//               miss, Igor would stop looking).
//   8–15 bpm  → flag to IGOR (not the student): "pulse below usual, maybe sensor".
//   ≥ 15 bpm  → suppress pulse conclusions + ask the student "did the watch
//               record OK?".
//
// Defenses (mandatory — otherwise we catch physiology, not an artefact):
//   - DO NOT look at the first rep(s): HR lags at the start of work; a low first
//     rep is normal, not a broken strap.
//   - the class norm must have ≥3 points.
//   - hr_trusted=false / hr_quality='unreliable' is already handled upstream → silent.
//   - when in doubt, stay silent.

import { mad, median, medianOfReps } from "./norm.ts";
import type { DerivedRowForComparison } from "./types.ts";

// HR at the very start of an interval session lags the effort; the first rep's
// peak reads low for physiological reasons. Skip it so the detector cannot
// mistake lag for a dead sensor.
export const SKIP_LEADING_REPS_FOR_SENSOR = 1;
export const SENSOR_NORM_MIN_POINTS = 3;
export const COMPARABLE_PACE_MAX_DELTA_SEC = 10;
export const SENSOR_SILENT_MAX_BPM = 8; // below this shortfall → silence
export const SENSOR_HARD_MIN_BPM = 15; // at/above → suppress pulse + ask student

export type PulseAnomalyGrade = "silent" | "flag_coach" | "suppress_and_ask";

export type PulseAnomalyResult = {
  grade: PulseAnomalyGrade;
  shortfallBpm: number | null; // norm HR − current HR (positive = pulse lower than expected)
  currentHr: number | null; // median of reps excluding the first
  normHr: number | null;
  baseN: number;
  reason: string; // why this grade (esp. why silent), for the proof harness
};

const SILENT = (reason: string): PulseAnomalyResult => ({
  grade: "silent",
  shortfallBpm: null,
  currentHr: null,
  normHr: null,
  baseN: 0,
  reason,
});

/**
 * Detect a suspiciously low pulse at a comparable pace. `normPool` are the
 * comparable history rows (same class, same tier) the matcher already gathered;
 * `paceDeltaSec` is the current workout's rep-pace delta vs that pool's pace
 * norm (the matcher computes it — pass null if it could not). Pure.
 */
export function detectPulseAnomaly(input: {
  current: DerivedRowForComparison;
  normPool: DerivedRowForComparison[];
  paceDeltaSec: number | null;
}): PulseAnomalyResult {
  const { current, normPool, paceDeltaSec } = input;

  if (current.hrTrusted === false || current.hrQuality === "unreliable") {
    return SILENT("hr_untrusted");
  }
  if (paceDeltaSec === null || Math.abs(paceDeltaSec) >= COMPARABLE_PACE_MAX_DELTA_SEC) {
    return SILENT("pace_not_comparable");
  }

  // Current HR excludes the first rep (lag). Norm HR is built from each pool
  // row's rep-HR median EXCLUDING its own first rep, for the same reason.
  const currentHr = medianOfReps(current.repPeakHrs, SKIP_LEADING_REPS_FOR_SENSOR);
  if (currentHr === null) return SILENT("no_current_hr");

  const normValues = normPool
    .map((r) => medianOfReps(r.repPeakHrs, SKIP_LEADING_REPS_FOR_SENSOR))
    .filter((v): v is number => v !== null);
  if (normValues.length < SENSOR_NORM_MIN_POINTS) return SILENT("sensor_norm_too_thin");

  const normHr = median(normValues)!;
  const shortfall = normHr - currentHr; // >0 means current pulse is LOWER than usual

  // A dead/loose strap reads LOW. A high reading is a different failure mode not
  // graded here (and often real effort) — only a shortfall is a sensor suspicion.
  if (shortfall < SENSOR_SILENT_MAX_BPM) {
    return {
      grade: "silent",
      shortfallBpm: shortfall,
      currentHr,
      normHr,
      baseN: normValues.length,
      reason: shortfall <= 0 ? "pulse_not_low" : "below_sensor_band",
    };
  }

  // Extra guard against a noisy norm: if the pool's own spread is wide, a single
  // low workout means little. MAD here is the same robust width used elsewhere.
  const spread = mad(normValues);

  const grade: PulseAnomalyGrade = shortfall >= SENSOR_HARD_MIN_BPM ? "suppress_and_ask" : "flag_coach";
  return {
    grade,
    shortfallBpm: shortfall,
    currentHr,
    normHr,
    baseN: normValues.length,
    reason: spread !== null ? `shortfall_${Math.round(shortfall)}bpm_mad_${Math.round(spread)}` : `shortfall_${Math.round(shortfall)}bpm`,
  };
}
