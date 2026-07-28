// Shared types for the comparison base (intervals ярусы 1–2 + ровный бег ярус 3).
//
// Reframed (наряд 2): the layer surfaces PROGRESS — "показать, что прогресс есть,
// когда он реально есть" — never a verdict, and never a regression nag. A null
// observation means SILENCE. Three praise mechanisms, by weight:
//   composite (3) > mechanism A / strong single (2) > mechanism B / picture (1).
// Non-praise signals (pulse anomaly, "unusual shift") are about the DATA and are
// NOT gated by the praise pause.

/** One run's derived metrics, in the shape the matchers consume. Built by the
 *  caller from a trainingpeaks_workout_derived_metrics row (+ its comparison_key,
 *  and — for ровный бег — pace/duration aggregated from the laps table). */
export type DerivedRowForComparison = {
  workoutId: number;
  workoutDate: string; // 'YYYY-MM-DD'
  workoutType: string | null;
  comparisonKey: string | null;
  repsDetectedCount: number | null;
  repPaces: Array<number | null> | null; // sec/km per rep block
  repPeakHrs: Array<number | null> | null; // bpm per rep block
  repPaceFadePct: number | null;
  repRecoveryDrops: Array<number | null> | null; // bpm per rep block
  avgHr: number | null; // cleaned
  hrTrusted: boolean | null;
  hrQuality: string | null; // 'good' | 'degraded' | 'unreliable' | null
  // Steady-run (ярус 3) fields. avgPaceSecPerKm/durationS are NOT stored on the
  // derived row — the caller aggregates them from laps (sum distance / sum time).
  avgPaceSecPerKm: number | null;
  durationS: number | null;
  hrDecouplingPct: number | null;
  aerobicEf: number | null; // normalizer only — never shown to the student
};

export type ComparisonMetric =
  // interval metrics
  | "rep_pace"
  | "rep_hr"
  | "fade"
  | "recovery"
  | "rep_count"
  // steady metrics
  | "steady_pace"
  | "avg_hr"
  | "decoupling"
  // data signal
  | "hr_sensor";

export type NormMode = "recent" | "old";
export type ObservationMode = NormMode | "sensor";

export type PraiseKind = "composite" | "mechanism_a" | "mechanism_b";
export type PraiseWeight = 1 | 2 | 3; // B=1, A=2, composite=3

/** A single metric's shift vs its personal norm, classified for improvement. */
export type MetricShift = {
  metric: ComparisonMetric;
  before: number; // norm value
  after: number; // current value
  delta: number; // after - before
  baseN: number; // points in the norm
  spread: number | null; // MAD, only when n>=3 (else null → flat threshold)
  status: "improved" | "worsened" | "neutral"; // vs the SOFT threshold
};

/** A would-be praise, before the pause is applied. Both matchers emit these. */
export type PraiseCandidate = {
  kind: PraiseKind;
  weight: PraiseWeight;
  tier: 1 | 2 | 3;
  key: string | null; // structure key (intervals); null for steady
  mode: NormMode;
  metrics: MetricShift[]; // A: the fired metric; B: the improved list; composite: pace
  composite?: { countBefore: number; countAfter: number };
  primaryMetric: ComparisonMetric;
  primaryDelta: number;
  primaryStrength: number; // |improvement| / threshold — intra-kind ranking
};

export type ComparisonContextItem = {
  type: string; // memory item type, e.g. 'health_status'
  text: string;
  date: string | null;
};

export type MemoryContextInput = {
  type: string;
  text: string;
  validFrom: string | null;
  validUntil: string | null;
};

export type ObservationMetricLine = {
  metric: ComparisonMetric;
  before: number | null;
  after: number | null;
  delta: number | null;
  baseN: number;
  spread: number | null;
};

/** The single outward observation, or null for silence. `metrics` carries every
 *  converged metric (mechanism B tells the whole picture, not one number). */
export type ComparisonObservation = {
  kind: PraiseKind | "hr_sensor";
  weight: PraiseWeight | null; // null for hr_sensor (a data signal, not praise)
  tier: 1 | 2 | 3;
  key: string | null;
  mode: ObservationMode;
  metrics: ObservationMetricLine[];
  composite?: { countBefore: number; countAfter: number };
  context: ComparisonContextItem[];
};

/** Coach-only flags (never shown to the student), NOT gated by the praise pause. */
export type CoachFlag =
  | {
      kind: "pulse_sensor_suspect";
      shortfallBpm: number;
      currentHr: number;
      normHr: number;
      baseN: number;
      workoutDate: string;
    }
  | {
      kind: "unusual_shift";
      metric: ComparisonMetric;
      before: number | null;
      after: number | null;
      delta: number;
      workoutDate: string;
    }
  // A would-be praise that fired on too thin a base (< MIN_BASE_N_FOR_STUDENT
  // comparable points) — NOT shown to the student, surfaced to the coach as
  // "предварительно" so Igor can still eyeball it and decide.
  | {
      kind: "comparison_preliminary";
      metric: ComparisonMetric;
      before: number | null;
      after: number | null;
      delta: number;
      baseN: number;
      mode: NormMode;
      workoutDate: string;
    };

/** The last praise emitted for a student — the pause's cross-workout state. */
export type LastPraise = { weight: PraiseWeight; date: string };
