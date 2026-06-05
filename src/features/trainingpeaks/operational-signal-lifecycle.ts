export type OperationalSignalLifecycle =
  | "active_problem"
  | "return_planned"
  | "return_trial_completed"
  | "monitoring_after_return"
  | "resolved";

export type OperationalSignalClass =
  | "confirmed_illness"
  | "ambiguous_illness"
  | "injury_pain"
  | "schedule_pause"
  | "return_to_run"
  | "unknown";

export type PlannedVsCompletedDelta = "normal" | "modified_easy" | "modified_other" | "unknown";
export type EvidenceFreshness = "ok" | "stale" | "missing";

export type OperationalSignalLifecycleInput = {
  episodeKey?: string;
  studentId: string;
  signalClass: OperationalSignalClass;
  currentLifecycle: OperationalSignalLifecycle;
  openedAt: string;
  latestTpCompletionAfterOpen?: {
    workoutId: string;
    workoutDate: string;
    title?: string | null;
    sportOrTypeCode?: string | null;
    isRunningLike: boolean;
    isStrengthLike: boolean;
    plannedVsCompletedDelta: PlannedVsCompletedDelta;
    evidenceFreshness: EvidenceFreshness;
  } | null;
  negativeMessageAfterCompletion?: {
    observationId: string;
    observedAt: string;
    reason: string;
  } | null;
  explicitRecoveryMessage?: {
    observationId: string;
    observedAt: string;
    reason: string;
  } | null;
  missedOrSkippedReturnWorkout?: boolean;
};

export type OperationalSignalLifecycleProposal = {
  proposedLifecycle: OperationalSignalLifecycle;
  confidence: "high" | "medium" | "low";
  reasonCode: string;
  reason: string;
  hideFromTpSignals: boolean;
  requiresCoachClose?: boolean;
  blockedByNegative?: boolean;
  evidenceRefs: Record<string, unknown>;
};

function isTerminal(lifecycle: OperationalSignalLifecycle): boolean {
  return lifecycle === "resolved";
}

function evaluateRecoveryMessage(
  input: OperationalSignalLifecycleInput
): OperationalSignalLifecycleProposal | null {
  if (!input.explicitRecoveryMessage) {
    return null;
  }
  const reasonBase = {
    explicitRecoveryMessage: input.explicitRecoveryMessage,
  };
  if (input.signalClass === "injury_pain") {
    return {
      proposedLifecycle: "resolved",
      confidence: "high",
      reasonCode: "explicit_recovery_injury",
      reason: "Explicit athlete recovery message allows injury/pain closure.",
      hideFromTpSignals: true,
      requiresCoachClose: false,
      evidenceRefs: reasonBase,
    };
  }
  if (input.signalClass === "confirmed_illness") {
    return {
      proposedLifecycle: "resolved",
      confidence: "high",
      reasonCode: "explicit_recovery_confirmed_illness",
      reason: "Explicit athlete recovery message allows confirmed illness closure.",
      hideFromTpSignals: true,
      evidenceRefs: reasonBase,
    };
  }
  if (input.signalClass === "ambiguous_illness" || input.signalClass === "schedule_pause") {
    return {
      proposedLifecycle: "resolved",
      confidence: "high",
      reasonCode: "explicit_recovery_low_risk",
      reason: "Explicit athlete recovery/return message resolves low-risk class.",
      hideFromTpSignals: true,
      evidenceRefs: reasonBase,
    };
  }
  return {
    proposedLifecycle: "monitoring_after_return",
    confidence: "medium",
    reasonCode: "explicit_recovery_unknown_class",
    reason: "Recovery message present but class is unknown; keep under monitoring.",
    hideFromTpSignals: false,
    evidenceRefs: reasonBase,
  };
}

function evaluateNegativeOverride(
  input: OperationalSignalLifecycleInput
): OperationalSignalLifecycleProposal | null {
  if (!input.negativeMessageAfterCompletion) {
    return null;
  }
  return {
    proposedLifecycle: "active_problem",
    confidence: "high",
    reasonCode: "negative_after_completion",
    reason: "Negative Telegram evidence after completion reopens/keeps active problem.",
    hideFromTpSignals: false,
    blockedByNegative: true,
    evidenceRefs: {
      negativeMessageAfterCompletion: input.negativeMessageAfterCompletion,
      latestTpCompletionAfterOpen: input.latestTpCompletionAfterOpen ?? null,
    },
  };
}

function evaluateMissedReturnWorkout(
  input: OperationalSignalLifecycleInput
): OperationalSignalLifecycleProposal | null {
  if (!input.missedOrSkippedReturnWorkout) {
    return null;
  }
  return {
    proposedLifecycle: input.currentLifecycle === "return_trial_completed" ? "return_planned" : input.currentLifecycle,
    confidence: "medium",
    reasonCode: "missed_or_skipped_return_workout",
    reason: "Skipped/missed return workout blocks closure and needs review.",
    hideFromTpSignals: false,
    evidenceRefs: {
      missedOrSkippedReturnWorkout: true,
    },
  };
}

function evaluateTpCompletion(input: OperationalSignalLifecycleInput): OperationalSignalLifecycleProposal | null {
  const completion = input.latestTpCompletionAfterOpen;
  if (!completion) {
    return null;
  }

  if (!completion.isRunningLike) {
    if (completion.isStrengthLike) {
      return {
        proposedLifecycle: input.currentLifecycle,
        confidence: "low",
        reasonCode: "strength_only_completion",
        reason: "Strength/cross-training completion does not resolve running illness/injury.",
        hideFromTpSignals: isTerminal(input.currentLifecycle),
        requiresCoachClose: input.signalClass === "injury_pain" ? true : undefined,
        evidenceRefs: {
          latestTpCompletionAfterOpen: completion,
        },
      };
    }
    return {
      proposedLifecycle: input.currentLifecycle,
      confidence: "low",
      reasonCode: "non_running_completion",
      reason: "Completion is not running-like; keep current lifecycle.",
      hideFromTpSignals: isTerminal(input.currentLifecycle),
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  const isModifiedEasy = completion.plannedVsCompletedDelta === "modified_easy";
  if (input.signalClass === "confirmed_illness") {
    return {
      proposedLifecycle: "monitoring_after_return",
      confidence: completion.evidenceFreshness === "ok" ? "high" : "medium",
      reasonCode: "tp_completion_confirmed_illness_monitoring",
      reason: "Running completion after confirmed illness is return evidence; keep monitoring before terminal close.",
      hideFromTpSignals: false,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  if (input.signalClass === "ambiguous_illness") {
    if (!isModifiedEasy && completion.plannedVsCompletedDelta === "normal") {
      return {
        proposedLifecycle: "resolved",
        confidence: completion.evidenceFreshness === "ok" ? "high" : "medium",
        reasonCode: "tp_completion_ambiguous_resolved",
        reason: "Low-confidence ambiguous illness is resolved by clean planned running completion.",
        hideFromTpSignals: true,
        evidenceRefs: {
          latestTpCompletionAfterOpen: completion,
        },
      };
    }
    return {
      proposedLifecycle: "monitoring_after_return",
      confidence: "medium",
      reasonCode: "tp_completion_ambiguous_monitoring",
      reason: "Ambiguous illness has completion but modified/uncertain return; keep monitoring.",
      hideFromTpSignals: false,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  if (input.signalClass === "injury_pain") {
    return {
      proposedLifecycle: "monitoring_after_return",
      confidence: completion.evidenceFreshness === "ok" ? "high" : "medium",
      reasonCode: "tp_completion_injury_monitoring_only",
      reason: "Injury/pain completion evidence supports monitored return, not TP-only terminal close.",
      hideFromTpSignals: false,
      requiresCoachClose: true,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  if (input.signalClass === "schedule_pause") {
    return {
      proposedLifecycle: "resolved",
      confidence: completion.evidenceFreshness === "ok" ? "high" : "medium",
      reasonCode: "tp_completion_schedule_pause_resolved",
      reason: "Planned return run after schedule pause resolves the pause lifecycle.",
      hideFromTpSignals: true,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  if (input.signalClass === "return_to_run") {
    return {
      proposedLifecycle: "monitoring_after_return",
      confidence: completion.evidenceFreshness === "ok" ? "high" : "medium",
      reasonCode: "tp_completion_return_to_run_monitoring",
      reason: "Return-to-run completion advances lifecycle to monitored post-return state.",
      hideFromTpSignals: false,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  return {
    proposedLifecycle: "return_trial_completed",
    confidence: "low",
    reasonCode: "tp_completion_unknown_class_trial",
    reason: "Running completion found for unknown class; mark trial completed for review.",
    hideFromTpSignals: false,
    evidenceRefs: {
      latestTpCompletionAfterOpen: completion,
    },
  };
}

export function evaluateOperationalSignalLifecycle(
  input: OperationalSignalLifecycleInput
): OperationalSignalLifecycleProposal {
  const negativeOverride = evaluateNegativeOverride(input);
  if (negativeOverride) {
    return negativeOverride;
  }

  const missedReturn = evaluateMissedReturnWorkout(input);
  if (missedReturn) {
    return missedReturn;
  }

  const recoveryMessage = evaluateRecoveryMessage(input);
  if (recoveryMessage) {
    return recoveryMessage;
  }

  const completionProposal = evaluateTpCompletion(input);
  if (completionProposal) {
    return completionProposal;
  }

  return {
    proposedLifecycle: input.currentLifecycle,
    confidence: "low",
    reasonCode: "insufficient_evidence",
    reason: "No decisive TP/Telegram evidence; keep current lifecycle.",
    hideFromTpSignals: isTerminal(input.currentLifecycle),
    evidenceRefs: {
      latestTpCompletionAfterOpen: input.latestTpCompletionAfterOpen ?? null,
      explicitRecoveryMessage: input.explicitRecoveryMessage ?? null,
      negativeMessageAfterCompletion: input.negativeMessageAfterCompletion ?? null,
    },
  };
}
