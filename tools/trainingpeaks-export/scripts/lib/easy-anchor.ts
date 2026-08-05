/**
 * easy-anchor — pure logic for the easy-pace anchor (autoplanner sprint 1, spec §1).
 *
 * Builds a per-athlete easy anchor {easy_fast_s, easy_slow_s} from the PRESCRIBED pace ranges
 * Igor writes in workout descriptions, with recency weighting and illness/injury exclusion.
 * No I/O — the CLI feeds it rows and reads results.
 *
 * PARSER: reused from lib/tp-recompute.ts — the ONE canonical description parser, shared with
 * tp-threshold-restore / the nightly recompute. Never fork it: a second parser would drift and
 * break both the %-recompute on a threshold change and this anchor.
 * NB tp-recompute.ts::ranges() also emits a POINT range {fast:X, slow:X} for an open-floor
 * "X–00:00" prescription (and for "X и медленнее"). Those are ceilings, not two-sided ranges —
 * see extractEasySample/buildAnchor, where a point range feeds the FAST edge only (spec §1.4).
 */
import { ranges } from "./tp-recompute.ts";

/** Easy/long/recovery continuous-run title test (spec §1.2). Local because tp-recompute.ts keeps
 *  this regex inline in recompute() and does not export it; kept identical to that source. */
export const EASY_TITLE_RE = /лёгк|легк|длительн|восстанов|свободн/i;
export function isEasyRunTitle(title: string): boolean {
  return EASY_TITLE_RE.test(title);
}

// spec §1.2: not-interval gate. Excludes structured quality / tempo-faster titles.
export const INTERVAL_TITLE_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;
// spec §1.2: "лёгкая семья ИЛИ управляющая метка" — control-mode easy runs Igor labels by mode.
export const CONTROL_MODE_EASY_RE = /по темпу|по пульсу|по ощущ|свободн|комфортн|спокойн|аэробн|ровн|кросс|непрерывн/i;

export const MIN_PACE_S = 210; // 3:30 — plausibility floor (spec §1.2/1.3)
export const MAX_PACE_S = 570; // 9:30 — plausibility ceiling
export const MAX_RANGE_SPREAD_S = 90; // spec §1.3: slow−fast > 90 → glued-together garbage
export const OUTLIER_DEV_S = 45; // spec §1.3: > 45s from pool median → outlier
export const DEFAULT_HALF_LIFE_DAYS = 42; // spec §1.4 hypothesis (tuned by backtest, П2)
export const COLLECTION_WINDOW_DAYS = 182; // spec §1.5: 26-week collection window
export const MIN_SAMPLES = 6; // spec §1.5: sufficiency threshold
export const ILLNESS_TAIL_DAYS = 14; // spec §1.4: recovery tail after a health signal closes
/** Effective-sample floor for the TOP confidence grade inside easy_description. Raw n counts a
 *  3-month-old range the same as yesterday's; effN (sum of recency weights) does not. At HL=21 a
 *  pool of 6 ranges spread over 26 weeks can carry effN < 1 — nominally sufficient, effectively
 *  one observation. Grading uses effN, not n. */
export const MIN_EFFECTIVE_SAMPLES = 3;

export type EasySample = { date: string; fast: number; slow: number };
export type DateWindow = { from: string; to: string };
export type Anchor = {
  fast: number; slow: number;
  /** raw count of pooled ranges (post-filter) */
  n: number;
  /** sum of recency weights over the pool — "how many fresh observations is this really worth" */
  effectiveN: number;
  trendSlopeSPerDay: number;
};

/** Confidence grade INSIDE anchor_source=easy_description, from the effective sample size. */
export function anchorConfidence(effectiveN: number): "high" | "medium" | "low" {
  if (effectiveN >= MIN_EFFECTIVE_SAMPLES) return "high";
  if (effectiveN >= MIN_EFFECTIVE_SAMPLES / 2) return "medium";
  return "low";
}

/** Extract ONE easy sample from a workout: the prescribed range. Long runs contribute ONLY their
 *  slowest range (spec §1.2 — a marathon block's fast range would poison the easy anchor). Returns
 *  null if the workout is not an easy/steady continuous run or has no plausible prescribed range. */
export function extractEasySample(title: string, desc: string): { fast: number; slow: number } | null {
  if (!title || INTERVAL_TITLE_RE.test(title)) return null;
  if (!isEasyRunTitle(title) && !CONTROL_MODE_EASY_RE.test(title)) return null;
  const rs = ranges(desc);
  if (rs.length === 0) return null;
  // slowest range = largest slow edge (covers long-run-with-block; harmless for single-range easy).
  const r = rs.reduce((a, b) => (b.slow > a.slow ? b : a));
  if (r.fast < MIN_PACE_S || r.slow > MAX_PACE_S) return null; // implausible → typo/garbage
  if (r.slow - r.fast > MAX_RANGE_SPREAD_S) return null; // two workouts glued
  return { fast: r.fast, slow: r.slow };
}

/** True if `date` (YYYY-MM-DD) falls inside any illness/injury window (+recovery tail already baked). */
export function inAnyWindow(date: string, windows: DateWindow[]): boolean {
  return windows.some((w) => date >= w.from && date <= w.to);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

function weightForAge(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays)) return 1; // HALF_LIFE = ∞ → flat weighting
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function weightedMedian(items: { v: number; w: number }[]): number {
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((acc, x) => acc + x.w, 0);
  let cum = 0;
  for (const x of s) { cum += x.w; if (cum >= total / 2) return x.v; }
  return s[s.length - 1]?.v ?? NaN;
}

function plainMedian(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Sign of the prescribed-easy trend over the pool: s/km per day via least-squares on `fast`.
 *  Negative = Igor is prescribing FASTER easy over time (form rising). Used to read half-life lag
 *  (spec/П2: error sign is only diagnostic relative to the athlete's trend). */
function trendSlope(samples: EasySample[], asOf: string): number {
  if (samples.length < 3) return 0;
  const xs = samples.map((s) => -daysBetween(asOf, s.date)); // day index (older = more negative)
  const ys = samples.map((s) => s.fast);
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

/**
 * Build the anchor from samples STRICTLY BEFORE `asOf` (backtest: asOf = week N start).
 *  - 26-week collection window, illness windows removed;
 *  - require ≥ MIN_SAMPLES after filtering;
 *  - one-pass outlier removal (> OUTLIER_DEV_S from raw median of `fast`);
 *  - recency-weighted median of fast and of slow.
 */
export function buildAnchor(
  samples: EasySample[],
  asOf: string,
  opts: { halfLifeDays: number; windowDays?: number; minSamples?: number; illness?: DateWindow[] } = { halfLifeDays: DEFAULT_HALF_LIFE_DAYS },
): Anchor | null {
  const windowDays = opts.windowDays ?? COLLECTION_WINDOW_DAYS;
  const minSamples = opts.minSamples ?? MIN_SAMPLES;
  const illness = opts.illness ?? [];
  const windowStart = new Date(Date.parse(asOf) - windowDays * 86400000).toISOString().slice(0, 10);

  let pool = samples.filter((s) => s.date < asOf && s.date >= windowStart && !inAnyWindow(s.date, illness));
  if (pool.length < minSamples) return null;

  const medFast = plainMedian(pool.map((s) => s.fast));
  pool = pool.filter((s) => Math.abs(s.fast - medFast) <= OUTLIER_DEV_S);
  if (pool.length < minSamples) return null;

  const wf = pool.map((s) => ({ v: s.fast, w: weightForAge(daysBetween(asOf, s.date), opts.halfLifeDays) }));
  const ws = pool.map((s) => ({ v: s.slow, w: weightForAge(daysBetween(asOf, s.date), opts.halfLifeDays) }));
  // effectiveN = Σ recency weights. Raw n treats a 3-month-old range like yesterday's; effN does not,
  // so confidence grading inside easy_description uses effN (see anchorConfidence).
  const effectiveN = wf.reduce((acc, x) => acc + x.w, 0);
  return {
    fast: Math.round(weightedMedian(wf)), slow: Math.round(weightedMedian(ws)),
    n: pool.length, effectiveN: Math.round(effectiveN * 100) / 100,
    trendSlopeSPerDay: trendSlope(pool, asOf),
  };
}

export type Tier = "T1" | "T2" | "T3";
export function tierOf(weeklyMinutes: number): Tier {
  if (weeklyMinutes < 120) return "T1";
  if (weeklyMinutes < 240) return "T2";
  return "T3";
}

/** Median of a set of same-week samples → the week's "actual prescribed" easy (backtest target). */
export function weekActual(samples: { fast: number; slow: number }[]): { fast: number; slow: number } {
  return { fast: Math.round(plainMedian(samples.map((s) => s.fast))), slow: Math.round(plainMedian(samples.map((s) => s.slow))) };
}

/** Do two [fast,slow] pace intervals overlap? (backtest match criterion, spec §7.1). */
export function rangesOverlap(a: { fast: number; slow: number }, b: { fast: number; slow: number }): boolean {
  return a.fast <= b.slow && b.fast <= a.slow;
}
