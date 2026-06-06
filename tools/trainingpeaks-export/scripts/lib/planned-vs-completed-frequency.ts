export type PlannedVsCompletedClassification =
  | "aligned"
  | "planned_higher_than_completed"
  | "completed_higher_than_planned"
  | "planned_signal_missing"
  | "completed_signal_missing"
  | "ambiguous";

export type PlannedVsCompletedReliability =
  | "reliable"
  | "planned_signal_missing_or_unreliable"
  | "completed_signal_missing"
  | "ambiguous";

export type PlannedVsCompletedFrequencyAnalysis = {
  actual_completed_frequency: number | null;
  planned_context_frequency: number | null;
  planned_vs_completed_delta: number | null;
  planned_vs_completed_classification: PlannedVsCompletedClassification;
  planned_vs_completed_reliability: PlannedVsCompletedReliability;
  review_reasons: string[];
  safe_batch_excluded: boolean;
  active_window_frequency: number | null;
  all_window_frequency: number | null;
  recent_4w_frequency: number | null;
};

const FREQUENCY_GAP_THRESHOLD = 1;

function roundDelta(planned: number, completed: number): number {
  return Number((planned - completed).toFixed(2));
}

function isPlannedFrequencyUnreliableZero(input: {
  plannedContextFrequency: number | null;
  plannedContextWeeklyMinutes: number | null;
  plannedOnlyRunningWorkouts: number;
}): boolean {
  if (input.plannedContextFrequency !== 0) return false;
  return (
    (input.plannedContextWeeklyMinutes !== null && input.plannedContextWeeklyMinutes > 0) ||
    input.plannedOnlyRunningWorkouts > 0
  );
}

export function analyzePlannedVsCompletedFrequency(input: {
  actualCompletedFrequency: number | null;
  plannedContextFrequency: number | null;
  plannedContextWeeklyMinutes: number | null;
  plannedOnlyRunningWorkouts: number;
  activeWindowFrequency: number | null;
  allWindowFrequency: number | null;
  recent4wFrequency: number | null;
}): PlannedVsCompletedFrequencyAnalysis {
  const actual = input.actualCompletedFrequency;
  const planned = input.plannedContextFrequency;
  const reviewReasons = new Set<string>();

  let reliability: PlannedVsCompletedReliability = "reliable";
  if (actual === null && planned === null) {
    reliability = "ambiguous";
  } else if (actual === null) {
    reliability = "completed_signal_missing";
  } else if (planned === null) {
    reliability = "planned_signal_missing_or_unreliable";
  } else if (
    isPlannedFrequencyUnreliableZero({
      plannedContextFrequency: planned,
      plannedContextWeeklyMinutes: input.plannedContextWeeklyMinutes,
      plannedOnlyRunningWorkouts: input.plannedOnlyRunningWorkouts,
    })
  ) {
    reliability = "planned_signal_missing_or_unreliable";
  }

  const delta =
    planned !== null && actual !== null ? roundDelta(planned, actual) : null;

  let classification: PlannedVsCompletedClassification = "ambiguous";
  if (reliability === "completed_signal_missing") {
    classification = "completed_signal_missing";
  } else if (reliability === "planned_signal_missing_or_unreliable" && planned === 0) {
    classification = "planned_signal_missing";
  } else if (delta === null) {
    classification = "ambiguous";
  } else if (Math.abs(delta) < FREQUENCY_GAP_THRESHOLD) {
    classification = "aligned";
  } else if (delta >= FREQUENCY_GAP_THRESHOLD) {
    classification = "planned_higher_than_completed";
  } else if (delta <= -FREQUENCY_GAP_THRESHOLD) {
    classification = "completed_higher_than_planned";
  }

  const hasFrequencyGap = delta !== null && Math.abs(delta) >= FREQUENCY_GAP_THRESHOLD;
  const hasUnreliablePlannedGap =
    reliability === "planned_signal_missing_or_unreliable" &&
    actual !== null &&
    actual >= FREQUENCY_GAP_THRESHOLD;

  if (hasFrequencyGap || hasUnreliablePlannedGap) {
    reviewReasons.add("planned_vs_completed_frequency_delta");
    if (classification === "planned_higher_than_completed") {
      reviewReasons.add("planned_higher_than_completed");
    } else if (classification === "completed_higher_than_planned") {
      reviewReasons.add("completed_higher_than_planned");
    } else if (classification === "planned_signal_missing") {
      reviewReasons.add("planned_signal_missing");
    }
  }

  const safeBatchExcluded = hasFrequencyGap || hasUnreliablePlannedGap;

  return {
    actual_completed_frequency: actual,
    planned_context_frequency: planned,
    planned_vs_completed_delta: delta,
    planned_vs_completed_classification: classification,
    planned_vs_completed_reliability: reliability,
    review_reasons: [...reviewReasons].sort(),
    safe_batch_excluded: safeBatchExcluded,
    active_window_frequency: input.activeWindowFrequency,
    all_window_frequency: input.allWindowFrequency,
    recent_4w_frequency: input.recent4wFrequency,
  };
}

export const PLANNED_VS_COMPLETED_SAFE_BATCH_DISALLOWED_REASONS = [
  "planned_vs_completed_frequency_delta",
  "planned_signal_missing",
] as const;
