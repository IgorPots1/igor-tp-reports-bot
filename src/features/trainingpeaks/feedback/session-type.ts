// Classifies a run into the C2 table's three columns: интервалы / лёгкая /
// длительная-темп. No such classifier exists elsewhere in the codebase — the
// activity classifier (workout-activity-classification.ts) resolves SPORT
// (run/bike/swim), not session intensity within a run.
//
// "interval" reuses compareWorkout's own definition verbatim (comparisonKey +
// reps_detected_count>=2) so the planner and the comparison base never
// disagree about what counts as an interval session. Beyond that, there is no
// plan-corridor data to lean on (pct_time_pace_target is NULL across the whole
// base — see types.ts), so long/tempo vs easy falls back to the coach's own
// title text (Igor writes titles like "Длительная"/"Темповая"/"Лёгкая"), and
// — only when the title gives no hint — a duration heuristic, since most
// untitled runs in this base are easy (corpus category A is ~80% of messages).

import type { PlannerDerivedMetrics, SessionType } from "./types.ts";

export const LONG_RUN_FALLBACK_DURATION_S = 4500; // 75 min

const LONG_TEMPO_TITLE_TOKENS = ["длительн", "темп", "tempo", "long run"];
const EASY_TITLE_TOKENS = ["легк", "восстанов", "easy", "recovery"];

export type SessionTypeResult = {
  sessionType: SessionType;
  confidence: "high" | "medium" | "low";
  reason: string;
};

function isIntervalWorkout(current: PlannerDerivedMetrics): boolean {
  return current.workoutType === "run" && current.comparisonKey !== null && (current.repsDetectedCount ?? 0) >= 2;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return null;
}

export function classifySessionType(input: { current: PlannerDerivedMetrics; title: string | null }): SessionTypeResult {
  if (isIntervalWorkout(input.current)) {
    return { sessionType: "interval", confidence: "high", reason: "comparisonKey + repsDetectedCount>=2 (same rule as compareWorkout)" };
  }

  const title = normalize(input.title);
  const longTempoToken = includesAny(title, LONG_TEMPO_TITLE_TOKENS);
  if (longTempoToken) {
    return { sessionType: "long_tempo", confidence: "high", reason: `title matched "${longTempoToken}"` };
  }
  const easyToken = includesAny(title, EASY_TITLE_TOKENS);
  if (easyToken) {
    return { sessionType: "easy", confidence: "high", reason: `title matched "${easyToken}"` };
  }

  const durationS = input.current.durationS;
  if (durationS !== null && durationS >= LONG_RUN_FALLBACK_DURATION_S) {
    return {
      sessionType: "long_tempo",
      confidence: "low",
      reason: `no title hint; duration ${Math.round(durationS / 60)}min >= ${LONG_RUN_FALLBACK_DURATION_S / 60}min fallback`,
    };
  }

  return { sessionType: "easy", confidence: "low", reason: "no title hint, not long by duration — default (easy is the corpus's ~80% default)" };
}
