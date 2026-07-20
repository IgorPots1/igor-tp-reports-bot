// Comparison base — orchestrator (intervals, tiers 1–2).
//
// compareWorkout is PURE: the caller supplies the current run, the student's
// run history, future race dates and memory items; nothing here touches the DB.
// That keeps production and the proof harness running the exact same logic.
//
// It returns the single outward observation (or null = silence), a coach-only
// flag if any, and the raw match/pulse diagnostics the proof harness needs for
// the four-way silence taxonomy.

import { classifyMatchOutcome, matchIntervalWorkout, type IntervalMatchResult, type MatchOutcome } from "./interval-matcher.ts";
import { selectFocus } from "./focus.ts";
import { detectPulseAnomaly, type PulseAnomalyResult } from "./pulse-anomaly.ts";
import type {
  CoachFlag,
  ComparisonContextItem,
  ComparisonObservation,
  DerivedRowForComparison,
  MemoryContextInput,
} from "./types.ts";

export * from "./types.ts";
export { computeComparisonKey, parseComparisonKey } from "./comparison-key.ts";
export { resolveComparisonWindow } from "./resolve-window.ts";
export {
  matchIntervalWorkout,
  classifyMatchOutcome,
  type IntervalMatchResult,
  type MatchOutcome,
  type MetricEval,
} from "./interval-matcher.ts";
export { detectPulseAnomaly, type PulseAnomalyResult } from "./pulse-anomaly.ts";

// Memory types worth placing BESIDE the numbers (design doc п.13) — never a
// correction to them. We do not adjust physiology for weather; we say "here are
// the numbers, here is what the person wrote at the time".
const CONTEXT_MEMORY_TYPES = new Set(["health_status", "equipment_or_device_note", "travel_or_life_event"]);

function assembleContext(memoryItems: MemoryContextInput[], onDate: string): ComparisonContextItem[] {
  return memoryItems
    .filter((m) => CONTEXT_MEMORY_TYPES.has(m.type))
    .filter((m) => (m.validFrom === null || m.validFrom <= onDate) && (m.validUntil === null || m.validUntil >= onDate))
    .map((m) => ({ type: m.type, text: m.text, date: m.validFrom }));
}

export type CompareWorkoutResult = {
  observation: ComparisonObservation | null;
  coachFlag: CoachFlag | null;
  outcome: MatchOutcome;
  match: IntervalMatchResult;
  pulse: PulseAnomalyResult;
};

export function compareWorkout(input: {
  current: DerivedRowForComparison;
  history: DerivedRowForComparison[];
  futureRaceDates?: string[];
  memoryItems?: MemoryContextInput[];
}): CompareWorkoutResult {
  const match = matchIntervalWorkout({ current: input.current, history: input.history });

  // The sensor detector compares this workout's pulse against the student's
  // RECENT class norm, at a comparable pace (recent-mode rep_pace delta).
  const recentPaceEval = match.metricEvals.find((e) => e.metric === "rep_pace" && e.mode === "recent");
  const pulse = detectPulseAnomaly({
    current: input.current,
    normPool: match.recentPool,
    paceDeltaSec: recentPaceEval ? recentPaceEval.delta : null,
  });

  const context = assembleContext(input.memoryItems ?? [], input.current.workoutDate);
  const { observation, coachFlag } = selectFocus({
    match,
    pulse,
    context,
    workoutDate: input.current.workoutDate,
  });

  return { observation, coachFlag, outcome: classifyMatchOutcome(match), match, pulse };
}
