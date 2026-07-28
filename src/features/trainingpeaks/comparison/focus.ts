// Focus selection + pause + coach flags (наряд 2). Exactly ONE student-facing
// observation goes out, or none.
//
// Priority: 1. hard pulse anomaly (a DATA question beats any praise) → talk about
// the watch. 2. composite (weight 3, "больше и быстрее" — most convincing).
// 3. mechanism A (weight 2, strong single). 4. mechanism B (weight 1, picture).
// Within a weight: old (рост) before recent (состояние), then strongest.
//
// The praise pause (pause.ts) gates the winner; a suppressed praise is still
// reported (for the proof). Coach flags — mid-band pulse suspicion and an
// "unusually large shift" — are DATA signals to Igor and bypass the pause.

import { shouldEmitPraise } from "./pause.ts";
import { MIN_BASE_N_FOR_STUDENT } from "./metric-shift.ts";
import type { MatchResult } from "./match-result.ts";
import type { PulseAnomalyResult } from "./pulse-anomaly.ts";
import type {
  CoachFlag,
  ComparisonContextItem,
  ComparisonObservation,
  LastPraise,
  PraiseCandidate,
} from "./types.ts";

export const UNUSUAL_PACE_DELTA_SEC = 30;
export const UNUSUAL_HR_DELTA_BPM = 15;

const PACE_METRICS = new Set(["rep_pace", "steady_pace"]);
const HR_METRICS = new Set(["rep_hr", "avg_hr"]);

export type FocusResult = {
  observation: ComparisonObservation | null;
  coachFlags: CoachFlag[];
  winningCandidate: PraiseCandidate | null; // pre-pause, for the proof
  suppressedByPause: PraiseCandidate | null;
};

function modeRank(mode: "recent" | "old"): number {
  return mode === "old" ? 1 : 0; // old (рост) preferred
}

/** Highest weight, then old before recent, then strongest. */
function pickBest(candidates: PraiseCandidate[]): PraiseCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (modeRank(b.mode) !== modeRank(a.mode)) return modeRank(b.mode) - modeRank(a.mode);
    return b.primaryStrength - a.primaryStrength;
  })[0]!;
}

function toObservation(c: PraiseCandidate, context: ComparisonContextItem[]): ComparisonObservation {
  return {
    kind: c.kind,
    weight: c.weight,
    tier: c.tier,
    key: c.key,
    mode: c.mode,
    metrics: c.metrics.map((m) => ({ metric: m.metric, before: m.before, after: m.after, delta: m.delta, baseN: m.baseN, spread: m.spread })),
    composite: c.composite,
    context,
  };
}

// The claim's evidence base = the thinnest metric it leans on (the "~N похожих"
// the coach panel shows). A composite/mechanism-B that rests on one comparable
// session is n=1 no matter how many metrics agree.
function candidateBaseN(c: PraiseCandidate): number {
  return c.metrics.length === 0 ? 0 : Math.min(...c.metrics.map((m) => m.baseN));
}

function preliminaryFlag(c: PraiseCandidate, baseN: number, workoutDate: string): CoachFlag {
  const line = c.metrics[0];
  return {
    kind: "comparison_preliminary",
    metric: c.primaryMetric,
    before: line?.before ?? null,
    after: line?.after ?? null,
    delta: c.primaryDelta,
    baseN,
    mode: c.mode,
    workoutDate,
  };
}

function unusualShiftFlag(c: PraiseCandidate, workoutDate: string): CoachFlag | null {
  const isPace = PACE_METRICS.has(c.primaryMetric);
  const isHr = HR_METRICS.has(c.primaryMetric);
  const big = (isPace && Math.abs(c.primaryDelta) > UNUSUAL_PACE_DELTA_SEC) || (isHr && Math.abs(c.primaryDelta) > UNUSUAL_HR_DELTA_BPM);
  if (!big) return null;
  const line = c.metrics[0];
  return {
    kind: "unusual_shift",
    metric: c.primaryMetric,
    before: line?.before ?? null,
    after: line?.after ?? null,
    delta: c.primaryDelta,
    workoutDate,
  };
}

export function selectFocus(input: {
  match: MatchResult;
  pulse: PulseAnomalyResult;
  context: ComparisonContextItem[];
  workoutDate: string;
  lastPraise: LastPraise | null;
}): FocusResult {
  const { match, pulse, context, workoutDate, lastPraise } = input;
  const coachFlags: CoachFlag[] = [];

  // 1. Hard pulse anomaly — a data question, not praise; never paused.
  if (pulse.grade === "suppress_and_ask" && (match.tier !== null || match.key !== null)) {
    return {
      observation: {
        kind: "hr_sensor",
        weight: null,
        tier: (match.tier as 1 | 2 | 3 | null) ?? 1,
        key: match.key,
        mode: "sensor",
        metrics: [
          {
            metric: "hr_sensor",
            before: pulse.normHr,
            after: pulse.currentHr,
            delta: pulse.currentHr !== null && pulse.normHr !== null ? pulse.currentHr - pulse.normHr : null,
            baseN: pulse.baseN,
            spread: null,
          },
        ],
        context,
      },
      coachFlags,
      winningCandidate: null,
      suppressedByPause: null,
    };
  }

  if (pulse.grade === "flag_coach" && pulse.currentHr !== null && pulse.normHr !== null && pulse.shortfallBpm !== null) {
    coachFlags.push({ kind: "pulse_sensor_suspect", shortfallBpm: pulse.shortfallBpm, currentHr: pulse.currentHr, normHr: pulse.normHr, baseN: pulse.baseN, workoutDate });
  }

  const winner = pickBest(match.candidates);
  if (winner === null) return { observation: null, coachFlags, winningCandidate: null, suppressedByPause: null };

  // Artifact safeguard: an unusually large shift is flagged to Igor (never
  // silenced), regardless of whether the pause later suppresses the praise.
  const unusual = unusualShiftFlag(winner, workoutDate);
  if (unusual) coachFlags.push(unusual);

  // Стабильность базы: сравнение на 1–2 точках ученику не показываем — это шум,
  // а MAD-гард (n≥3) на такой базе молчать не умеет. Тренеру отдаём предварительно.
  const baseN = candidateBaseN(winner);
  if (baseN < MIN_BASE_N_FOR_STUDENT) {
    coachFlags.push(preliminaryFlag(winner, baseN, workoutDate));
    return { observation: null, coachFlags, winningCandidate: winner, suppressedByPause: null };
  }

  const emit = shouldEmitPraise({ candidateWeight: winner.weight, last: lastPraise, workoutDate });
  return {
    observation: emit ? toObservation(winner, context) : null,
    coachFlags,
    winningCandidate: winner,
    suppressedByPause: emit ? null : winner,
  };
}
