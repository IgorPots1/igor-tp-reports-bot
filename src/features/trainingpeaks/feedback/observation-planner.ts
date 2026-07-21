// Этап 2 orchestrator — planObservations(packet) → Observation[]. Deterministic,
// no model call, no text. Wires every slot from the ЭТАП 2 plan: C2 table, C3
// dictionary, negative-split (pulse-arbitrated), C4 (words-beat-the-number,
// Igor's correction), C5/C6 questions, C7 trust gate, C8 comparison base,
// focus selection. Every number in every Observation traces back to a real
// field — nothing here invents a metric.

import { evaluateComparisonSlot } from "./comparison-slot.ts";
import { evaluateFatigueCause } from "./fatigue-cause.ts";
import { PRIORITY, priorityForComparisonWeight, selectFocus } from "./focus.ts";
import { evaluateTrustGate } from "./hr-trust-gate.ts";
import { evaluateNegativeSplit } from "./negative-split.ts";
import { collectPositiveSignals } from "./positive-dictionary.ts";
import { evaluateAccumulationQuestion, evaluateContradictionQuestion } from "./questions.ts";
import { classifySessionType } from "./session-type.ts";
import { evaluateHrDriftTempo, evaluateIntervalFade } from "./signal-type-table.ts";
import type { AdviceKey } from "./advice-keys.ts";
import type { ContextPacket, Observation, ObservationType, SessionType } from "./types.ts";

function makeObservation(input: { type: ObservationType; metric: string; numbers: Record<string, number>; sessionType: SessionType | null; adviceKey: AdviceKey; reason: string; priorityOverride?: number }): Observation {
  return {
    type: input.type,
    metric: input.metric,
    numbers: input.numbers,
    sessionType: input.sessionType,
    adviceKey: input.adviceKey,
    priority: input.priorityOverride ?? PRIORITY[input.adviceKey],
    reason: input.reason,
    focused: false,
  };
}

export function planObservations(packet: ContextPacket): Observation[] {
  const observations: Observation[] = [];
  const { current } = packet;

  const sessionClassification = classifySessionType({ current, title: packet.workout.title });
  const sessionType = sessionClassification.sessionType;
  const trustGate = evaluateTrustGate(current);

  if (trustGate.hrUntrustedSignal) {
    observations.push(makeObservation({ type: "coach_signal", metric: "hr_trusted", numbers: trustGate.hrUntrustedSignal.numbers, sessionType, adviceKey: "signal_hr_untrusted", reason: trustGate.hrUntrustedSignal.reason }));
  }
  if (trustGate.paceDistanceUntrustedSignal) {
    observations.push(makeObservation({ type: "coach_signal", metric: "pace_distance_trusted", numbers: trustGate.paceDistanceUntrustedSignal.numbers, sessionType, adviceKey: "signal_pace_distance_untrusted", reason: trustGate.paceDistanceUntrustedSignal.reason }));
  }

  // C3 — positive dictionary. HR-dependent entries (recovery, steady-hr-rise,
  // steady-hr/decoupling) must not fire on an untrusted HR stream (C7); the
  // pace-dependent entry (even-pace CV) likewise needs trusted pace/distance.
  // evaluateFullStructure is rep-count-only (lap-trigger timing), independent
  // of both flags.
  const positives = collectPositiveSignals(current, sessionType).filter((s) => {
    if (!trustGate.hrTrusted && (s.key === "praise_good_recovery" || s.key === "praise_steady_hr_rise" || s.key === "praise_hr_steady_long" || s.key === "praise_long_held_steady")) return false;
    if (!trustGate.paceDistanceTrusted && s.key === "praise_even_pace") return false;
    return true;
  });
  for (const p of positives) {
    observations.push(makeObservation({ type: "praise", metric: p.metric, numbers: p.numbers, sessionType, adviceKey: p.key, reason: p.reason }));
  }

  // C2 — interval fade (pace-based; needs trusted pace).
  if (sessionType === "interval" && trustGate.paceDistanceTrusted) {
    const fade = evaluateIntervalFade(current);
    if (fade.fired) {
      observations.push(makeObservation({ type: "correction", metric: "rep_pace_fade_pct", numbers: { fadePct: fade.fadePct }, sessionType, adviceKey: "correction_interval_fade", reason: `rep pace faded ${fade.fadePct}% from first to last rep` }));
    }
  }

  // C2 — HR drift on long/tempo (direct correction, C1 effort-control theme; needs trusted HR).
  if (sessionType === "long_tempo" && trustGate.hrTrusted) {
    const drift = evaluateHrDriftTempo({ current, sessionType });
    if (drift.fired) {
      observations.push(makeObservation({ type: "correction", metric: "hr_decoupling_pct", numbers: { decouplingPct: drift.decouplingPct }, sessionType, adviceKey: "correction_hr_drift_tempo", reason: `hr_decoupling_pct=${drift.decouplingPct}% — pulse drifted up over the run` }));
    }
  }

  // Negative split / second-half surge (pace-based trigger, pulse arbitrates
  // the outcome). Needs trusted pace to trigger at all; if HR is untrusted the
  // laps are stripped of avgHr so the pulse arbiter degrades to "unknown" —
  // still allowed to raise a pace-only surge correction, never a praise (C7
  // never blocks a claim that carries no HR number).
  if (trustGate.paceDistanceTrusted) {
    const lapsForSplit = trustGate.hrTrusted ? packet.laps : packet.laps.map((l) => ({ ...l, avgHr: null }));
    const negSplit = evaluateNegativeSplit({ laps: lapsForSplit, sessionType });
    if (negSplit.kind === "praise_disciplined") {
      observations.push(
        makeObservation({
          type: "praise",
          metric: "split_half_pace_hr",
          numbers: { deltaSecPerKm: negSplit.deltaSecPerKm, hrDeltaBpm: negSplit.hrDeltaBpm, firstHalfPaceSecPerKm: negSplit.firstHalfPaceSecPerKm, secondHalfPaceSecPerKm: negSplit.secondHalfPaceSecPerKm },
          sessionType,
          adviceKey: "praise_negative_split",
          reason: `second half ${negSplit.deltaSecPerKm}s/km faster, pulse rose only ${negSplit.hrDeltaBpm}bpm — disciplined pacing`,
        })
      );
    } else if (negSplit.kind === "correction_surge") {
      const adviceKey: AdviceKey = sessionType === "long_tempo" ? "correction_second_half_surge_tempo" : "correction_second_half_surge_easy";
      observations.push(
        makeObservation({
          type: "correction",
          metric: "split_half_pace_hr",
          numbers: { deltaSecPerKm: negSplit.deltaSecPerKm, firstHalfPaceSecPerKm: negSplit.firstHalfPaceSecPerKm, secondHalfPaceSecPerKm: negSplit.secondHalfPaceSecPerKm, ...(negSplit.hrDeltaBpm !== null ? { hrDeltaBpm: negSplit.hrDeltaBpm } : {}) },
          sessionType,
          adviceKey,
          reason: negSplit.hrDeltaBpm !== null ? `second half ${negSplit.deltaSecPerKm}s/km faster with pulse up ${negSplit.hrDeltaBpm}bpm — a surge, not disciplined pacing` : `second half ${negSplit.deltaSecPerKm}s/km faster, HR untrusted — pace-only surge`,
        })
      );
    }
  }

  // C4 — fatigue → cause, words-first. Skipped entirely when HR is untrusted:
  // its only trigger is an elevated pulse signal.
  let fatigueTriggered = false;
  if (trustGate.hrTrusted) {
    const fatigue = evaluateFatigueCause(packet, sessionType);
    if (fatigue.kind === "confirmed") {
      fatigueTriggered = true;
      // Not praise, not a question, not coach-only — closest of the наряд's four
      // types is "correction" (information given to the student, gently), same
      // bucket the corpus's own "причина, не вина" category reads as.
      observations.push(makeObservation({ type: "correction", metric: "fatigue_cause", numbers: fatigue.numbers, sessionType, adviceKey: fatigue.adviceKey, reason: fatigue.reason }));
    } else if (fatigue.kind === "question") {
      fatigueTriggered = true;
      observations.push(makeObservation({ type: "question", metric: "fatigue_cause", numbers: fatigue.numbers, sessionType, adviceKey: "question_high_pulse_unknown", reason: fatigue.reason }));
    }
    // fatigue.kind === "silent": words said fine, C7-style silence — nothing added.
    // fatigue.kind === "not_triggered": pulse wasn't elevated — nothing added.
  }

  // C6 — contradiction question, only when C4 never engaged this workout.
  const contradiction = evaluateContradictionQuestion(packet, fatigueTriggered);
  if (contradiction.fired) {
    observations.push(makeObservation({ type: "question", metric: "contradiction", numbers: contradiction.numbers, sessionType, adviceKey: "question_contradiction", reason: contradiction.reason }));
  }

  // C5 — accumulation question (duration-based, not gated by HR/pace trust).
  const accumulation = evaluateAccumulationQuestion(packet);
  if (accumulation.fired) {
    observations.push(makeObservation({ type: "question", metric: "accumulated_load", numbers: accumulation.numbers, sessionType, adviceKey: "question_accumulated_load", reason: accumulation.reason }));
  }

  // C8 — comparison base (already gates its own pulse-sensor detector on hr_trusted internally).
  const comparison = evaluateComparisonSlot(packet);
  if (comparison.praise) {
    observations.push(makeObservation({ type: "praise", metric: "comparison_progress", numbers: comparison.praise.numbers, sessionType, adviceKey: "praise_comparison_progress", reason: comparison.praise.reason, priorityOverride: priorityForComparisonWeight(comparison.praise.weight) }));
  }
  if (comparison.hrSensorQuestion) {
    observations.push(makeObservation({ type: "question", metric: "hr_sensor", numbers: comparison.hrSensorQuestion.numbers, sessionType, adviceKey: "question_hr_sensor", reason: comparison.hrSensorQuestion.reason }));
  }
  for (const signal of comparison.coachSignals) {
    observations.push(makeObservation({ type: "coach_signal", metric: "comparison_coach_flag", numbers: signal.numbers, sessionType, adviceKey: signal.adviceKey, reason: signal.reason }));
  }

  // Default praise fallback — every draft needs something to open with (design
  // Part B); fires whenever nothing else praise-shaped landed.
  const hasPraise = observations.some((o) => o.type === "praise");
  if (!hasPraise) {
    observations.push(makeObservation({ type: "praise", metric: "none", numbers: {}, sessionType, adviceKey: "praise_default_good", reason: "no specific positive signal fired — clean/plan-compliant workout, default acknowledgment" }));
  }

  // Sleeping slots (fast-start-rep, recovery-too-fast, easy-too-fast, in-zone)
  // never produce an Observation here — see signal-type-table.ts SLEEPING_SLOTS
  // for the honest record the proof script reports separately.

  return selectFocus(observations);
}
