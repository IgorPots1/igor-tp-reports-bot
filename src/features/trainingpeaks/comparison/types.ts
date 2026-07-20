// Shared types for the comparison base (интервалы, ярусы 1–2).
//
// The layer's contract (design doc п.10 "ПРИЧИННОСТЬ МЯГКАЯ"): it emits a
// STRUCTURE — {класс, метрика, было, стало, дельта, n_базы, разброс, контекст} —
// and NEVER a verdict. "Форма упала" is never produced here; the word is chosen
// by the generation layer. A null observation means SILENCE (not "no change").

/** One run's derived metrics, in the shape the matcher consumes. Built by the
 *  caller from a trainingpeaks_workout_derived_metrics row (+ its comparison_key,
 *  computed on ingest or, in the proof harness, on the fly from the plan). */
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
};

export type ComparisonMetric = "rep_pace" | "rep_hr" | "fade" | "recovery" | "hr_sensor";
export type ComparisonMode = "recent" | "old" | "sensor";

export type ComparisonContextItem = {
  type: string; // memory item type, e.g. 'health_status'
  text: string;
  date: string | null; // the memory item's valid_from / observation date
};

/** A memory item as the caller supplies it (subset of
 *  TrainingPeaksStudentMemoryItem needed for context-beside-numbers). */
export type MemoryContextInput = {
  type: string;
  text: string;
  validFrom: string | null;
  validUntil: string | null;
};

/** The single outward observation, or null for silence. */
export type ComparisonObservation = {
  class: { key: string; tier: 1 | 2 };
  metric: ComparisonMetric;
  mode: ComparisonMode;
  before: number | null;
  after: number | null;
  delta: number | null;
  baseN: number;
  spread: number | null; // MAD of the class norm
  context: ComparisonContextItem[];
};

/** A coach-only flag (never shown to the student). Currently only the mid-band
 *  pulse-sensor suspicion (design doc §E: 8–15 bpm below норма → флаг Игорю). */
export type CoachFlag = {
  kind: "pulse_sensor_suspect";
  shortfallBpm: number;
  currentHr: number;
  normHr: number;
  baseN: number;
  workoutDate: string;
};
