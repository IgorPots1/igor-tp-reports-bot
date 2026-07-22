// Classifies a run into the C2 table's three columns: интервалы / лёгкая /
// длительная-темп. No such classifier exists elsewhere in the codebase — the
// activity classifier (workout-activity-classification.ts) resolves SPORT
// (run/bike/swim), not session intensity within a run.
//
// "interval" first reuses compareWorkout's keyed definition (comparisonKey +
// reps_detected_count>=2), THEN falls back to a FIT rep-count signal when the
// plan structure never produced a key (see intervalKind below). Beyond that,
// there is no plan-corridor data to lean on (pct_time_pace_target is NULL across
// the whole base — see types.ts), so long/tempo vs easy falls back to the
// coach's own title text (Igor writes titles like "Длительная"/"Темповая"/
// "Лёгкая"), and — only when the title gives no hint — a duration heuristic,
// since most untitled runs in this base are easy (corpus category A is ~80%).

import type { PlannerDerivedMetrics, SessionType } from "./types.ts";

export const LONG_RUN_FALLBACK_DURATION_S = 4500; // 75 min

// A run with no comparison_key but this many FIT-detected work reps is treated
// as an interval session anyway. The plan structure of ~1120 legacy rows was
// discarded before the 2000→100_000 structure-inline cap raise (cache scan,
// commit 05c0f9d, 2026-07-09), leaving comparison_key NULL forever unless the
// plan is re-scanned from TP. Without this fallback a "24×1 мин" (24 detected
// work laps) is mislabeled easy and the feedback praises a "ровная пробежка"
// instead of discussing the interval work — a convincing, wrong message.
// Threshold 3 (not 2) keeps a tempo "2 active blocks" run out of intervals.
export const INTERVAL_REPS_FALLBACK_MIN = 3;

const LONG_TEMPO_TITLE_TOKENS = ["длительн", "темп", "tempo", "long run"];
const EASY_TITLE_TOKENS = ["легк", "восстанов", "easy", "recovery"];

// A rep-count in the title ("7x5", "24 х 1", "10×600 м") — the coach's own
// signal that this is a series. Used only to VETO the reps-fallback below: the
// keyed path never needs it.
const INTERVAL_TITLE_COUNT_PATTERN = /\d+\s*[xх×]\s*\d/;

export type SessionTypeResult = {
  sessionType: SessionType;
  confidence: "high" | "medium" | "low";
  reason: string;
};

// Deliberate divergence from compareWorkout, which stays keyed-only: the session
// TYPE drives the feedback arc (WHAT to say about the run), while compareWorkout
// drives cross-workout GROUPING (which genuinely needs the structure key). For a
// keyless rep series we WANT interval-shaped feedback, and the comparison base
// correctly stays silent (it can't group a run whose structure it never keyed).
type IntervalKind = "keyed" | "reps_fallback" | null;

function intervalKind(current: PlannerDerivedMetrics): IntervalKind {
  if (current.workoutType !== "run") return null;
  if (current.comparisonKey !== null && (current.repsDetectedCount ?? 0) >= 2) return "keyed";
  if ((current.repsDetectedCount ?? 0) >= INTERVAL_REPS_FALLBACK_MIN) return "reps_fallback";
  return null;
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
  const kind = intervalKind(input.current);
  if (kind === "keyed") {
    return { sessionType: "interval", confidence: "high", reason: "comparisonKey + repsDetectedCount>=2 (same rule as compareWorkout)" };
  }
  // Reps-fallback rows are keyless, so their reps came from the least reliable
  // detector (heuristic, no plan structure to lean on). Veto it when the title
  // explicitly reads easy/recovery AND carries no "N×M" rep-count — that is a
  // genuine easy run whose heuristic reps are spurious ("Легкий бег" with 3-8
  // phantom reps), not a mislabeled series. Interval titles keep their N×M
  // ("20 x 1 мин (восстановление бегом)"), so real series are never vetoed.
  const titleNorm = normalize(input.title);
  const easyVeto = kind === "reps_fallback" && includesAny(titleNorm, EASY_TITLE_TOKENS) !== null && !INTERVAL_TITLE_COUNT_PATTERN.test(titleNorm);
  if (kind === "reps_fallback" && !easyVeto) {
    return {
      sessionType: "interval",
      confidence: "medium",
      reason: `repsDetectedCount>=${INTERVAL_REPS_FALLBACK_MIN} without comparison_key (legacy summaryOnly plan structure — FIT rep series)`,
    };
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
