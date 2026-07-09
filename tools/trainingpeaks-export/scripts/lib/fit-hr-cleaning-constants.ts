// Named thresholds for FIT heart-rate cleaning (design doc: /Users/igor/dev-notes/
// 20 Coach OS/2026-07-09 FIT Ingest & Derived Metrics Design.md, section 4).
// No magic numbers in the cleaning code — every threshold lives here with why.
//
// Extend this file (do not create a second constants module) when a later
// ingest stage needs more named thresholds (e.g. decoupling/recovery windows).

// Physiological floor for a runner's heart rate, bpm. Anything below is a
// sensor dropout/artifact, not a real reading.
export const HR_FLOOR = 30;

// Ceiling buffer above the athlete's historical observed max HR, bpm. A
// reading above observed_max + buffer is treated as "higher than the athlete
// has ever plausibly gone" and dropped.
export const HR_CEILING_BUFFER = 8;

// Absolute sanity ceiling used only when no historical observed max is
// available yet (first ingest / no clean history). Generic physiological
// upper bound for a runner's heart rate.
export const HR_CEILING_ABS = 220;

// Max plausible heart-rate rate-of-change between consecutive samples,
// bpm/second. A living heart does not reliably swing faster than this in a
// single sample step; anything above is an artifact, not physiology.
export const SLEW_MAX_BPM_S = 8;

// Hampel filter half-window, seconds. ~10s of context is enough to find the
// local median on a ~1Hz stream without smoothing over real short efforts.
export const HAMPEL_WIN_S = 5;

// Hampel filter outlier threshold, multiplied by 1.4826*MAD (the standard
// robust-scale estimator). K=3 is the classic default for "clearly an
// outlier, not just noisy."
export const HAMPEL_K = 3;

// Minimum sustained window length, seconds, before a tight HR<->cadence
// correlation is treated as cadence-lock rather than coincidence. Real
// physiology does not track cadence this tightly for this long.
export const CADENCE_LOCK_MIN_S = 30;

// Max |HR - cadence*2| (running: cadence is per-leg rpm, x2 = steps/min)
// tolerated, bpm, before a window counts as "HR is tracking cadence."
export const CADENCE_LOCK_BPM_TOL = 5;

// pct_hr_cleaned at/below this -> hr_quality='good'. A stream this clean
// needs no caveats.
export const QUALITY_GOOD_PCT = 5;

// pct_hr_cleaned at/below this (and above QUALITY_GOOD_PCT) -> 'degraded';
// above it -> 'unreliable'. Above 20% cleaned, the average no longer
// represents what the athlete actually did.
export const QUALITY_DEGRADED_PCT = 20;

// If cadence-lock covers more than this % of moving time, hr_quality is
// forced to 'unreliable' even if pct_hr_cleaned looks low — a lock can look
// "clean" (no wild spikes) while being systematically wrong throughout.
export const CADENCE_LOCK_UNRELIABLE_PCT = 15;

// Minimum speed, m/s, for a sample to count as "moving" when averaging HR.
// Below this the athlete is stopped/walking through an aid point; including
// those samples drags the average down without reflecting effort.
export const MOVING_SPEED_MIN_MPS = 0.8;
