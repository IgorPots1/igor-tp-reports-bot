// Focus selection (design doc "5. D. Выбор фокуса — одно сообщение").
//
// Several comparisons can fire. Exactly ONE goes out (the nutrition rule). The
// priority:
//   1. Pulse anomaly, hard tier — a question about the DATA beats any statement
//      about the training. If we don't trust the pulse, pulse conclusions are
//      suppressed and we talk about the watch, not the form.
//   2. ДАВНЕЕ (old, "рост") — rare and the most valuable. Encouragement.
//   3. СВЕЖЕЕ (recent, "состояние") — pace → HR → the rest.
// Within a mode the winner is the metric with the largest |Δ| / MAD, not the
// largest raw delta (12 s/km at MAD 2 is an event; at MAD 15 it's a Tuesday).
//
// Everything else is silence. Two comparisons in one message never happen.

import type { IntervalMatchResult, MetricEval, NormMode } from "./interval-matcher.ts";
import type { PulseAnomalyResult } from "./pulse-anomaly.ts";
import type { CoachFlag, ComparisonContextItem, ComparisonObservation } from "./types.ts";

function score(e: MetricEval): number {
  const denom = e.mad !== null && e.mad > 0 ? e.mad : e.flatThreshold;
  return Math.abs(e.delta) / denom;
}

function bestInMode(evals: MetricEval[], mode: NormMode): MetricEval | null {
  const fired = evals.filter((e) => e.mode === mode && e.fired && !e.suppressed);
  if (fired.length === 0) return null;
  return fired.reduce((best, e) => (score(e) > score(best) ? e : best));
}

export type FocusResult = {
  observation: ComparisonObservation | null;
  coachFlag: CoachFlag | null;
};

export function selectFocus(input: {
  match: IntervalMatchResult;
  pulse: PulseAnomalyResult;
  context: ComparisonContextItem[];
  workoutDate: string;
}): FocusResult {
  const { match, pulse, context } = input;
  const cls =
    match.tier !== null && match.key !== null ? { key: match.key, tier: match.tier } : null;

  // 1. Hard pulse anomaly wins outright, and suppresses any pulse-based finding.
  if (pulse.grade === "suppress_and_ask" && cls !== null) {
    return {
      observation: {
        class: cls,
        metric: "hr_sensor",
        mode: "sensor",
        before: pulse.normHr,
        after: pulse.currentHr,
        delta: pulse.currentHr !== null && pulse.normHr !== null ? pulse.currentHr - pulse.normHr : null,
        baseN: pulse.baseN,
        spread: null,
        context,
      },
      coachFlag: null,
    };
  }

  // A mid-band suspicion is a coach-only flag; it does not become the student
  // observation, but it must not be lost — it rides alongside whatever fires.
  const coachFlag: CoachFlag | null =
    pulse.grade === "flag_coach" && pulse.currentHr !== null && pulse.normHr !== null && pulse.shortfallBpm !== null
      ? {
          kind: "pulse_sensor_suspect",
          shortfallBpm: pulse.shortfallBpm,
          currentHr: pulse.currentHr,
          normHr: pulse.normHr,
          baseN: pulse.baseN,
          workoutDate: input.workoutDate,
        }
      : null;

  if (cls === null) return { observation: null, coachFlag };

  // 2. then 3.: old (рост) before recent (состояние).
  const winner = bestInMode(match.metricEvals, "old") ?? bestInMode(match.metricEvals, "recent");
  if (winner === null) return { observation: null, coachFlag };

  return {
    observation: {
      class: cls,
      metric: winner.metric,
      mode: winner.mode,
      before: winner.before,
      after: winner.after,
      delta: winner.delta,
      baseN: winner.baseN,
      spread: winner.mad,
      context,
    },
    coachFlag,
  };
}
