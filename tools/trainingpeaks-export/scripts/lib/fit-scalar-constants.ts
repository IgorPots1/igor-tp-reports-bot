// Named thresholds for the FIT scalar-computation stage (design doc: /Users/igor/
// dev-notes/20 Coach OS/2026-07-09 FIT Ingest & Derived Metrics Design.md,
// sections 2/5b/5c). Separate from fit-hr-cleaning-constants.ts on purpose:
// that file is about signal-processing thresholds (bounds/slew/Hampel/cadence
// lock) computed BEFORE any scalar; this file is about the coaching-domain
// windows/gates applied AFTER cleaning, when turning cleaned records into
// per-workout numbers. No magic numbers in the scalar code — every threshold
// lives here with why.

// ── Steady-effort / decoupling gate (design doc 5b) ─────────────────────────

// Warmup trim before a "steady" segment starts, seconds. Mirrors the trim
// used in hr-drift-elevation-audit.ts's computeDriftFromFitRecords — the
// first minutes carry HR lag and pacing settle-in, not steady effort.
export const WARMUP_TRIM_S = 600;

// Cooldown trim before a "steady" segment ends, seconds. Same rationale as
// WARMUP_TRIM_S, applied to the tail of the workout.
export const COOLDOWN_TRIM_S = 300;

// Minimum trimmed steady-segment duration, seconds (20 min), before
// hr_decoupling_pct is trusted at all. Pa:HR decoupling needs sustained
// effort to mean anything; shorter windows are noise.
export const STEADY_MIN_S = 1200;

// Minimum number of valid (cleaned-HR + moving-speed) samples inside the
// trimmed steady segment before decoupling is computed. Mirrors the
// `steady.length < 20` guard in hr-drift-elevation-audit.ts — below this,
// the two halves being compared are each built from too few points.
export const STEADY_MIN_VALID_POINTS = 20;

// Max coefficient of variation (stdev/mean * 100) of instantaneous pace
// inside the trimmed window before it's treated as "not actually steady"
// (a work/rest oscillation the lap-based work-detection tier missed — e.g. a
// fartlek run with no laps). A genuinely steady effort's pace stays tight;
// 15% is a conservative ceiling that still tolerates normal terrain/fatigue
// drift without passing a real surge-and-recover pattern as "steady".
export const STEADY_PACE_CV_MAX_PCT = 15;

// ── Interval rep scalars (design doc 5c) ─────────────────────────────────────

// Minimum number of work-classified laps (is_work=true) before any rep_*
// scalar is computed. fade_pct/cv are undefined on a single point; even
// rep_paces/rep_peak_hrs/rep_recovery_drops are suppressed below this so the
// whole rep_* family stays consistently null on a non-interval workout,
// never "an array of one".
export const MIN_WORK_REPS_FOR_SCALARS = 2;

// Lag after a rep's recorded end before searching for its HR peak, seconds.
// HR trails effort — the true peak often lands just after the lap boundary,
// not exactly at it.
export const RECOVERY_LAG_S = 15;

// Small buffer after a rep's end before the recovery window starts,
// seconds. Skips the tail of the effort itself so the recovery minimum
// isn't accidentally taken from HR that's still rising/peaking.
export const RECOVERY_MIN_GAP_S = 5;

// Cap on how far into the recovery a "recovery minimum" search goes,
// seconds (90s), on top of being bounded by the next rep's start if it
// comes sooner. Prevents a long rest/stop after the last rep (or a
// generously-spaced interval design) from inflating the drop with a value
// from full rest rather than active recovery.
export const RECOVERY_CAP_S = 90;

// If more than this fraction of samples inside a recovery window are below
// MOVING_SPEED_MIN_MPS (fit-hr-cleaning-constants.ts), the recovery reads
// as "athlete stopped", not active jogging recovery — the drop value is
// still reported (design doc: flag, don't suppress) but with a warning.
export const RECOVERY_STOPPED_FRACTION_MAX = 0.5;

// ── Goal-vs-actual / time-in-zones ───────────────────────────────────────────

// %-of-max-HR zone upper bounds for the 5-zone fallback used when no
// athlete threshold/zone profile exists (design doc: "зоны... иначе %max").
// Standard 5-zone %HRmax banding (Z1 <60%, Z2 60-70%, Z3 70-80%, Z4 80-90%,
// Z5 90%+) — a common, defensible default in the absence of a personalized
// profile; not athlete-specific, hence zone_basis='max_hr_pct' (not
// 'threshold_hr') whenever this fallback is used.
export const ZONE_MAX_HR_PCT_UPPER_BOUNDS = [60, 70, 80, 90] as const;
