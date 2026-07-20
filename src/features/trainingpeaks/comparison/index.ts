// Comparison base — orchestrator (наряд 2). PURE: the caller supplies the
// current run, the student's run history, memory items and the student's last
// praise (the pause's cross-workout state); nothing here touches the DB, so
// production and the proof run identical logic.
//
// Routes to the interval matcher (ярусы 1–2, keyed reps≥2) or the steady matcher
// (ярус 3, ровный/длительный), runs the pulse anomaly detector on intervals,
// then focus.ts picks one observation and applies the praise pause.

import { matchIntervalWorkout } from "./interval-matcher.ts";
import { matchSteadyWorkout } from "./steady-matcher.ts";
import { classifyOutcome, type MatchOutcome, type MatchResult } from "./match-result.ts";
import { selectFocus } from "./focus.ts";
import { detectPulseAnomaly, type PulseAnomalyResult } from "./pulse-anomaly.ts";
import { median, medianOfReps } from "./norm.ts";
import type {
  CoachFlag,
  ComparisonContextItem,
  ComparisonObservation,
  DerivedRowForComparison,
  LastPraise,
  MemoryContextInput,
  PraiseCandidate,
} from "./types.ts";

export * from "./types.ts";
export { computeComparisonKey, parseComparisonKey } from "./comparison-key.ts";
export { resolveComparisonWindow } from "./resolve-window.ts";
export { matchIntervalWorkout } from "./interval-matcher.ts";
export { matchSteadyWorkout } from "./steady-matcher.ts";
export { classifyOutcome, type MatchOutcome, type MatchResult } from "./match-result.ts";
export { shouldEmitPraise, PRAISE_PAUSE_DAYS } from "./pause.ts";
export { detectPulseAnomaly, type PulseAnomalyResult } from "./pulse-anomaly.ts";

const CONTEXT_MEMORY_TYPES = new Set(["health_status", "equipment_or_device_note", "travel_or_life_event"]);

function assembleContext(memoryItems: MemoryContextInput[], onDate: string): ComparisonContextItem[] {
  return memoryItems
    .filter((m) => CONTEXT_MEMORY_TYPES.has(m.type))
    .filter((m) => (m.validFrom === null || m.validFrom <= onDate) && (m.validUntil === null || m.validUntil >= onDate))
    .map((m) => ({ type: m.type, text: m.text, date: m.validFrom }));
}

const SILENT_PULSE: PulseAnomalyResult = {
  grade: "silent",
  shortfallBpm: null,
  currentHr: null,
  normHr: null,
  baseN: 0,
  reason: "not_interval",
};

export type CompareWorkoutResult = {
  observation: ComparisonObservation | null;
  coachFlags: CoachFlag[];
  winningCandidate: PraiseCandidate | null; // pre-pause winner, for the proof
  suppressedByPause: PraiseCandidate | null;
  outcome: MatchOutcome;
  isSteady: boolean;
  match: MatchResult;
  pulse: PulseAnomalyResult;
};

export function compareWorkout(input: {
  current: DerivedRowForComparison;
  history: DerivedRowForComparison[];
  memoryItems?: MemoryContextInput[];
  lastPraise?: LastPraise | null;
}): CompareWorkoutResult {
  const { current } = input;
  const isInterval = current.workoutType === "run" && current.comparisonKey !== null && (current.repsDetectedCount ?? 0) >= 2;

  let match: MatchResult;
  let pulse: PulseAnomalyResult;
  if (isInterval) {
    match = matchIntervalWorkout({ current, history: input.history });
    // Sensor detector: current pulse vs the RECENT class norm, at comparable pace.
    const currentPace = medianOfReps(current.repPaces);
    const normPace = median(match.recentPool.map((r) => medianOfReps(r.repPaces)).filter((v): v is number => v !== null));
    const paceDeltaSec = currentPace !== null && normPace !== null ? currentPace - normPace : null;
    pulse = detectPulseAnomaly({ current, normPool: match.recentPool, paceDeltaSec });
  } else {
    match = matchSteadyWorkout({ current, history: input.history });
    pulse = SILENT_PULSE;
  }

  const context = assembleContext(input.memoryItems ?? [], current.workoutDate);
  const focus = selectFocus({ match, pulse, context, workoutDate: current.workoutDate, lastPraise: input.lastPraise ?? null });

  return {
    observation: focus.observation,
    coachFlags: focus.coachFlags,
    winningCandidate: focus.winningCandidate,
    suppressedByPause: focus.suppressedByPause,
    outcome: classifyOutcome(match),
    isSteady: !isInterval,
    match,
    pulse,
  };
}
