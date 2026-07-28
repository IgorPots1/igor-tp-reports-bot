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

export const LONG_RUN_FALLBACK_DURATION_S = 4800; // 80 min (Igor's rule: длительная = «длительный бег» ИЛИ ≥80мин)

// Data-fragment gate (Блок 6). A «Длительный бег» that lasted 5 min at 80 min planned is not a short
// run — it's a broken record (watch died / accidental stop / sync glitch). The physical-sanity gate
// (pace_trusted) misses it: the recorded snippet can be perfectly plausible pace. Detect via plan:
// actual < half planned. When there's no plan, fall back to "длительн-titled but tiny" or an absolute
// floor. A fragment is treated as UNTRUSTED data (like a device glitch) → warm words-only draft.
export const FRAGMENT_PLAN_RATIO = 0.5; // actual < 50% of planned …
export const FRAGMENT_ABS_FLOOR_S = 15 * 60; // …AND absolutely tiny (<15 min). BOTH required: a broken
// record is a few minutes; a 54-min run at 110 planned is a real (partial) run, not a fragment — it
// still has analysable pace/HR. Without the floor the ratio wrongly words-only'd substantial runs.
export const FRAGMENT_NOPLAN_LONG_MAX_S = 25 * 60; // no plan: a длительн-titled run under 25 min
export const FRAGMENT_NOPLAN_ABS_MIN_S = 8 * 60; // no plan: any run under 8 min (a real run is rarely shorter)

// A run with no comparison_key but this many FIT-detected work reps is treated
// as an interval session anyway. The plan structure of ~1120 legacy rows was
// discarded before the 2000→100_000 structure-inline cap raise (cache scan,
// commit 05c0f9d, 2026-07-09), leaving comparison_key NULL forever unless the
// plan is re-scanned from TP. Without this fallback a "24×1 мин" (24 detected
// work laps) is mislabeled easy and the feedback praises a "ровная пробежка"
// instead of discussing the interval work — a convincing, wrong message.
// Threshold 3 (not 2) keeps a tempo "2 active blocks" run out of intervals.
export const INTERVAL_REPS_FALLBACK_MIN = 3;

// «темп»/«tempo» REMOVED (Igor: «Бег по темпу» = «беги по заданному темпу», NOT a tempo session and
// NOT длительная — the title is a poor signal, so tempo-titled runs fall through to duration/easy).
const LONG_TITLE_TOKENS = ["длительн", "длинн", "лонг", "long run", "long"];
const EASY_TITLE_TOKENS = ["легк", "восстанов", "easy", "recovery"];

/** A broken/partial record, decided BEFORE type classification. `plannedDurationS` from the plan
 *  (workout_cache.planned_time_raw, hours→seconds). Pure/deterministic. */
export function isDataFragment(durationS: number | null, plannedDurationS: number | null, title: string | null): boolean {
  if (durationS === null || durationS <= 0) return false; // no actual metrics → the FIT-missing gate handles it
  if (plannedDurationS !== null && plannedDurationS > 0) {
    // way under plan AND absolutely tiny — a broken record, not a shorter-than-planned real run
    return durationS < FRAGMENT_PLAN_RATIO * plannedDurationS && durationS < FRAGMENT_ABS_FLOOR_S;
  }
  // no reliable plan (~14%): a длительн-titled run that's tiny, or any run under the absolute floor
  const t = normalize(title);
  const longTitled = includesAny(t, LONG_TITLE_TOKENS) !== null;
  return (longTitled && durationS < FRAGMENT_NOPLAN_LONG_MAX_S) || durationS < FRAGMENT_NOPLAN_ABS_MIN_S;
}

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
  const longToken = includesAny(title, LONG_TITLE_TOKENS);
  if (longToken) {
    return { sessionType: "long_tempo", confidence: "high", reason: `title matched "${longToken}"` };
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
