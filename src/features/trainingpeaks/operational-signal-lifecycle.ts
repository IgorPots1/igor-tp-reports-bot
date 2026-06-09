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
export type TpWorkoutSportClass = "running_like" | "strength_only" | "cross_training_or_other" | "unknown";
export type TpRunningCompletionClass =
  | "normal_planned_run"
  | "modified_or_easy_run"
  | "return_trial_run"
  | "uncertain_running_completion"
  | "not_running";
export type TpEvidenceConfidence = "high" | "medium" | "low";

export type TpWorkoutEvidenceInput = {
  workoutId?: string;
  workoutDate?: string;
  title?: string | null;
  description?: string | null;
  coachComments?: string | null;
  sportOrTypeCode?: string | null;
  workoutTypeValueId?: number | null;
  workoutSubTypeId?: number | null;
  snapshotWorkoutTypeValueId?: number | null;
  snapshotRawWorkoutTypeValueId?: number | null;
  snapshotRawWorkoutSubTypeId?: number | null;
  snapshotRawCode?: string | null;
  isPlanned?: boolean;
  isCompleted?: boolean;
  plannedVsCompletedDelta?: PlannedVsCompletedDelta;
  complianceDurationPercent?: number | null;
  complianceDistancePercent?: number | null;
  plannedTimeRaw?: number | null;
  completedTimeRaw?: number | null;
  plannedDistanceRaw?: number | null;
  completedDistanceRaw?: number | null;
};

export type TpWorkoutEvidenceClassification = {
  sportClass: TpWorkoutSportClass;
  runningCompletionClass: TpRunningCompletionClass;
  confidence: TpEvidenceConfidence;
  reasonCodes: string[];
  inspectedFields: Record<string, unknown>;
};

export type ReturnWorkoutBlockerKind = "missed_before_today" | "pending_today" | "future_planned";

export type ReturnWorkoutBlocker = {
  kind: ReturnWorkoutBlockerKind;
  workoutId: string;
  workoutDate: string;
  title?: string | null;
  reason: string;
};

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
    sportClass: TpWorkoutSportClass;
    runningCompletionClass: TpRunningCompletionClass;
    classificationConfidence: TpEvidenceConfidence;
    classificationReasonCodes: string[];
    classificationInspectedFields: Record<string, unknown>;
    plannedVsCompletedDelta: PlannedVsCompletedDelta;
    evidenceFreshness: EvidenceFreshness;
    completionObservedAt?: string | null;
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
  returnWorkoutBlocker?: ReturnWorkoutBlocker | null;
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

export function hasReliableRunningCompletionAfterOpen(
  completion: OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"]
): boolean {
  return (
    completion?.sportClass === "running_like" &&
    completion.evidenceFreshness === "ok" &&
    completion.classificationConfidence !== "low" &&
    completion.runningCompletionClass !== "uncertain_running_completion"
  );
}

const RUN_SPORT_HINTS = [
  "run",
  "running",
  "бег",
  "пробеж",
  "кросс",
  "темп",
  "интервал",
  "jog",
  "threshold",
];
const RUN_TEXT_HINTS = [
  "бег",
  "легкий бег",
  "лёгкий бег",
  "длитель",
  "интервал",
  "темп",
  "кросс",
  "run",
  "easy run",
  "long run",
  "interval",
  "tempo",
];
const STRENGTH_HINTS = [
  "strength",
  "силов",
  "офп",
  "gym",
  "mobility",
  "core",
  "activation",
  "weights",
  "зал",
  "crossfit",
];
const CROSS_HINTS = [
  "bike",
  "cycling",
  "вел",
  "swim",
  "плав",
  "row",
  "ski",
  "лыж",
  "ellipt",
  "hike",
  "walk",
  "йога",
  "yoga",
];
const EASY_OR_MODIFIED_HINTS = [
  "легк",
  "easy",
  "recovery",
  "восстанов",
  "коротк",
  "short",
  "джог",
];
const RETURN_TRIAL_HINTS = [
  "return",
  "возвращ",
  "пробн",
  "test run",
  "провер",
  "check-in",
];
const RUNNING_WORKOUT_TYPE_IDS = new Set<number>([3]);
const STRENGTH_WORKOUT_TYPE_IDS = new Set<number>([9]);
const CYCLING_WORKOUT_TYPE_IDS = new Set<number>([2, 13]);

const CYCLING_TITLE_HINTS = [
  "bike",
  "cycling",
  "cycle",
  "ride",
  "вел",
  "вело",
  "велосипед",
  "длительный вел",
];
const GENERIC_ENGLISH_RUNNING_TITLES = new Set(["running", "run"]);

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function textContainsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalizeNumberish(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectStructuredTypeIds(input: TpWorkoutEvidenceInput): number[] {
  return [
    input.workoutTypeValueId,
    input.snapshotWorkoutTypeValueId,
    input.snapshotRawWorkoutTypeValueId,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function hasStructuredRunningTypeId(typeIds: readonly number[]): boolean {
  return typeIds.some((id) => RUNNING_WORKOUT_TYPE_IDS.has(id));
}

function hasStructuredStrengthTypeId(typeIds: readonly number[]): boolean {
  return typeIds.some((id) => STRENGTH_WORKOUT_TYPE_IDS.has(id));
}

function hasStructuredCyclingTypeId(typeIds: readonly number[]): boolean {
  return typeIds.some((id) => CYCLING_WORKOUT_TYPE_IDS.has(id));
}

function titleIndicatesCycling(text: string): boolean {
  if (!text) {
    return false;
  }
  if (textContainsAny(text, CYCLING_TITLE_HINTS)) {
    return true;
  }
  if (/\bвел/u.test(text) && /по\s+мощности/u.test(text)) {
    return true;
  }
  return false;
}

function isGenericEnglishRunningTitle(title: string): boolean {
  const normalized = normalizeText(title);
  return GENERIC_ENGLISH_RUNNING_TITLES.has(normalized);
}

function titleIndicatesKnownRunning(text: string, title: string): boolean {
  if (!text || isGenericEnglishRunningTitle(title)) {
    return false;
  }
  return textContainsAny(text, RUN_TEXT_HINTS);
}

function classifyRunningCompletion(
  input: TpWorkoutEvidenceInput,
  sportClass: TpWorkoutSportClass
): {
  runningCompletionClass: TpRunningCompletionClass;
  confidence: TpEvidenceConfidence;
  reasonCodes: string[];
} {
  if (sportClass !== "running_like") {
    return {
      runningCompletionClass: "not_running",
      confidence: "low",
      reasonCodes: ["sport_not_running_like"],
    };
  }

  const combinedText = [
    normalizeText(input.title),
    normalizeText(input.description),
    normalizeText(input.coachComments),
  ]
    .filter(Boolean)
    .join(" ");
  const structuredRunningType = hasStructuredRunningTypeId(collectStructuredTypeIds(input));

  if (textContainsAny(combinedText, RETURN_TRIAL_HINTS)) {
    return {
      runningCompletionClass: "return_trial_run",
      confidence: "medium",
      reasonCodes: ["return_trial_text_signal"],
    };
  }

  if (
    textContainsAny(combinedText, EASY_OR_MODIFIED_HINTS) ||
    input.plannedVsCompletedDelta === "modified_easy"
  ) {
    return {
      runningCompletionClass: "modified_or_easy_run",
      confidence: "medium",
      reasonCodes: ["modified_or_easy_evidence"],
    };
  }

  if (input.isPlanned && input.isCompleted && input.plannedVsCompletedDelta === "normal") {
    return {
      runningCompletionClass: "normal_planned_run",
      confidence: "high",
      reasonCodes: ["planned_completed_delta_normal"],
    };
  }

  if (input.isCompleted && structuredRunningType) {
    return {
      runningCompletionClass: "modified_or_easy_run",
      confidence: "medium",
      reasonCodes: ["structured_completed_run_without_planned_delta"],
    };
  }

  if (isGenericEnglishRunningTitle(input.title ?? "") && !structuredRunningType) {
    return {
      runningCompletionClass: "uncertain_running_completion",
      confidence: "low",
      reasonCodes: ["title_generic_running_without_structured_type"],
    };
  }

  return {
    runningCompletionClass: "uncertain_running_completion",
    confidence: "low",
    reasonCodes: ["running_evidence_incomplete_or_uncertain"],
  };
}

export function classifyTpWorkoutEvidence(input: TpWorkoutEvidenceInput): TpWorkoutEvidenceClassification {
  const reasonCodes: string[] = [];
  const sportOrTypeCode = normalizeText(input.sportOrTypeCode);
  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const coachComments = normalizeText(input.coachComments);
  const snapshotRawCode = normalizeText(input.snapshotRawCode);
  const textComposite = [title, description, coachComments, snapshotRawCode].filter(Boolean).join(" ");
  const typeIds = collectStructuredTypeIds(input);
  const cyclingTitleExclusion = titleIndicatesCycling(textComposite);
  const inspectedFields: Record<string, unknown> = {
    workoutId: input.workoutId ?? null,
    workoutDate: input.workoutDate ?? null,
    title: input.title ?? null,
    sportOrTypeCode: input.sportOrTypeCode ?? null,
    workoutTypeValueId: input.workoutTypeValueId ?? null,
    workoutSubTypeId: input.workoutSubTypeId ?? null,
    snapshotWorkoutTypeValueId: input.snapshotWorkoutTypeValueId ?? null,
    snapshotRawWorkoutTypeValueId: input.snapshotRawWorkoutTypeValueId ?? null,
    snapshotRawWorkoutSubTypeId: input.snapshotRawWorkoutSubTypeId ?? null,
    snapshotRawCode: input.snapshotRawCode ?? null,
    isPlanned: Boolean(input.isPlanned),
    isCompleted: Boolean(input.isCompleted),
    plannedVsCompletedDelta: input.plannedVsCompletedDelta ?? "unknown",
    complianceDurationPercent: normalizeNumberish(input.complianceDurationPercent),
    complianceDistancePercent: normalizeNumberish(input.complianceDistancePercent),
    plannedTimeRaw: normalizeNumberish(input.plannedTimeRaw),
    completedTimeRaw: normalizeNumberish(input.completedTimeRaw),
    plannedDistanceRaw: normalizeNumberish(input.plannedDistanceRaw),
    completedDistanceRaw: normalizeNumberish(input.completedDistanceRaw),
    cyclingTitleExclusion,
    structuredTypeIds: typeIds,
  };

  let sportClass: TpWorkoutSportClass = "unknown";
  let confidence: TpEvidenceConfidence = "low";

  if (cyclingTitleExclusion) {
    sportClass = "cross_training_or_other";
    confidence = "high";
    reasonCodes.push("cycling_title_exclusion");
  } else if (textContainsAny(sportOrTypeCode, STRENGTH_HINTS)) {
    sportClass = "strength_only";
    confidence = "high";
    reasonCodes.push("structured_sport_strength");
  } else if (textContainsAny(sportOrTypeCode, CROSS_HINTS)) {
    sportClass = "cross_training_or_other";
    confidence = "high";
    reasonCodes.push("structured_sport_cross_training");
  } else if (textContainsAny(sportOrTypeCode, RUN_SPORT_HINTS)) {
    sportClass = "running_like";
    confidence = "high";
    reasonCodes.push("structured_sport_running");
  } else if (hasStructuredStrengthTypeId(typeIds)) {
    sportClass = "strength_only";
    confidence = "high";
    reasonCodes.push("strength_structured_guardrail");
  } else if (hasStructuredCyclingTypeId(typeIds)) {
    sportClass = "cross_training_or_other";
    confidence = "high";
    reasonCodes.push("structured_workout_type_cycling");
  } else if (hasStructuredRunningTypeId(typeIds)) {
    sportClass = "running_like";
    confidence = "high";
    reasonCodes.push("structured_workout_type_running");
  } else if (textContainsAny(snapshotRawCode, STRENGTH_HINTS)) {
    sportClass = "strength_only";
    confidence = "medium";
    reasonCodes.push("snapshot_code_strength");
  } else if (textContainsAny(snapshotRawCode, CROSS_HINTS)) {
    sportClass = "cross_training_or_other";
    confidence = "medium";
    reasonCodes.push("snapshot_code_cross_training");
  } else if (textContainsAny(snapshotRawCode, RUN_SPORT_HINTS)) {
    sportClass = "running_like";
    confidence = "medium";
    reasonCodes.push("snapshot_code_running");
  } else if (textContainsAny(textComposite, STRENGTH_HINTS)) {
    sportClass = "strength_only";
    confidence = "medium";
    reasonCodes.push("title_or_text_strength_keyword_fallback");
  } else if (textContainsAny(textComposite, CROSS_HINTS)) {
    sportClass = "cross_training_or_other";
    confidence = "medium";
    reasonCodes.push("title_or_text_cross_training_keyword_fallback");
  } else if (titleIndicatesKnownRunning(textComposite, title)) {
    sportClass = "running_like";
    confidence = "medium";
    reasonCodes.push("title_known_running_keyword_fallback");
  } else if (isGenericEnglishRunningTitle(title)) {
    sportClass = "unknown";
    confidence = "low";
    reasonCodes.push("title_generic_running_without_structured_type");
  } else {
    reasonCodes.push("sport_class_unknown_after_all_checks");
  }

  const runningClassification = classifyRunningCompletion(input, sportClass);
  reasonCodes.push(...runningClassification.reasonCodes);
  if (runningClassification.confidence === "high" || (runningClassification.confidence === "medium" && confidence === "low")) {
    confidence = runningClassification.confidence;
  }

  return {
    sportClass,
    runningCompletionClass: runningClassification.runningCompletionClass,
    confidence,
    reasonCodes,
    inspectedFields,
  };
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
    const completion = input.latestTpCompletionAfterOpen;
    const hasReliableRunningCompletion =
      completion?.sportClass === "running_like" &&
      completion.evidenceFreshness === "ok" &&
      completion.classificationConfidence !== "low" &&
      completion.runningCompletionClass !== "uncertain_running_completion";
    if (hasReliableRunningCompletion) {
      return {
        proposedLifecycle: "monitoring_after_return",
        confidence: "high",
        reasonCode: "explicit_recovery_with_tp_running_completion",
        reason:
          "Recovery message plus reliable TP running completion caps first transition at monitoring, not terminal close.",
        hideFromTpSignals: false,
        evidenceRefs: {
          ...reasonBase,
          latestTpCompletionAfterOpen: completion,
        },
      };
    }
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
  if (hasReliableRunningCompletionAfterOpen(input.latestTpCompletionAfterOpen)) {
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

  if (completion.sportClass !== "running_like") {
    if (completion.sportClass === "strength_only") {
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

  const runningClass = completion.runningCompletionClass;
  const isModifiedOrUncertain =
    runningClass === "modified_or_easy_run" ||
    runningClass === "return_trial_run" ||
    runningClass === "uncertain_running_completion";
  if (input.signalClass === "confirmed_illness") {
    return {
      proposedLifecycle: "monitoring_after_return",
      confidence: completion.classificationConfidence === "high" && completion.evidenceFreshness === "ok" ? "high" : "medium",
      reasonCode: "tp_completion_confirmed_illness_monitoring",
      reason: "Running completion after confirmed illness is return evidence; keep monitoring before terminal close.",
      hideFromTpSignals: false,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  if (input.signalClass === "ambiguous_illness") {
    if (runningClass === "normal_planned_run") {
      return {
        proposedLifecycle: "resolved",
        confidence: completion.classificationConfidence === "high" && completion.evidenceFreshness === "ok" ? "high" : "medium",
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
      reason: isModifiedOrUncertain
        ? "Ambiguous illness has running completion but modified/trial/uncertain return; keep monitoring."
        : "Ambiguous illness has running completion but evidence is not strong enough for terminal close.",
      hideFromTpSignals: false,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
      },
    };
  }

  if (input.signalClass === "injury_pain") {
    return {
      proposedLifecycle: "monitoring_after_return",
      confidence: completion.classificationConfidence === "high" && completion.evidenceFreshness === "ok" ? "high" : "medium",
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
    if (runningClass !== "normal_planned_run") {
      return {
        proposedLifecycle: "monitoring_after_return",
        confidence: "medium",
        reasonCode: "tp_completion_schedule_pause_monitoring",
        reason: "Schedule pause has only modified/trial/uncertain run completion; keep monitoring.",
        hideFromTpSignals: false,
        evidenceRefs: {
          latestTpCompletionAfterOpen: completion,
        },
      };
    }
    return {
      proposedLifecycle: "resolved",
      confidence: completion.classificationConfidence === "high" && completion.evidenceFreshness === "ok" ? "high" : "medium",
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
      confidence: completion.classificationConfidence === "high" && completion.evidenceFreshness === "ok" ? "high" : "medium",
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
