import type {
  OperationalSignalClass,
  OperationalSignalLifecycle,
  OperationalSignalLifecycleInput,
  OperationalSignalLifecycleProposal,
  TpRunningCompletionClass,
  TpWorkoutSportClass,
} from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  isTpCompletionDrivenReasonCode,
  validateOperationalSignalLifecycleApplySafety,
} from "@/features/trainingpeaks/operational-signal-lifecycle-apply";

export type BridgeRecommendedAction =
  | "apply_monitoring_after_return"
  | "resolved_candidate"
  | "coach_close_candidate"
  | "manual_review"
  | "pending_tp_cache"
  | "blocked_by_negative"
  | "keep_active"
  | "fix_tp_workout_classification"
  | "no_action"
  | "non_tp_lifecycle_apply_gap";

export type BridgeDiagnosticInput = {
  signalId: string;
  signalType: string;
  signalClass: OperationalSignalClass;
  currentLifecycle: OperationalSignalLifecycle;
  lifecycleInput: OperationalSignalLifecycleInput;
  proposal: OperationalSignalLifecycleProposal;
  asOfDate: string;
  duplicateClusterSize?: number;
  cleanRunningCompletionCount?: number;
};

const RUNNING_TITLE_HINTS = [
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
  "jog",
];
const NON_RUNNING_TITLE_HINTS = [
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
  "strength",
  "силов",
  "офп",
  "gym",
];

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function titleLooksLikeRunning(title: string | null | undefined): boolean {
  if (titleLooksLikeNonRunning(title)) {
    return false;
  }
  const normalized = normalizeText(title);
  return RUNNING_TITLE_HINTS.some((hint) => normalized.includes(hint));
}

function titleLooksLikeNonRunning(title: string | null | undefined): boolean {
  const normalized = normalizeText(title);
  return NON_RUNNING_TITLE_HINTS.some((hint) => normalized.includes(hint));
}

function hasReliableTpRunningCompletion(
  completion: NonNullable<OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"]>
): boolean {
  return (
    completion.sportClass === "running_like" &&
    completion.classificationConfidence !== "low" &&
    completion.runningCompletionClass !== "uncertain_running_completion" &&
    completion.evidenceFreshness === "ok"
  );
}

export function detectPossibleMisclassifiedRun(input: {
  title?: string | null;
  sportClass: TpWorkoutSportClass;
  runningCompletionClass: TpRunningCompletionClass;
  classificationConfidence: "high" | "medium" | "low";
}): boolean {
  if (titleLooksLikeNonRunning(input.title)) {
    return input.sportClass === "running_like";
  }
  if (!titleLooksLikeRunning(input.title)) {
    return false;
  }
  if (input.sportClass === "running_like") {
    return false;
  }
  if (input.sportClass === "strength_only") {
    return false;
  }
  return input.sportClass === "cross_training_or_other" || input.sportClass === "unknown";
}

export function isCleanRunningCompletion(input: {
  sportClass: TpWorkoutSportClass;
  runningCompletionClass: TpRunningCompletionClass;
  classificationConfidence: "high" | "medium" | "low";
}): boolean {
  if (input.sportClass !== "running_like") {
    return false;
  }
  if (input.classificationConfidence === "low") {
    return false;
  }
  return (
    input.runningCompletionClass === "normal_planned_run" ||
    input.runningCompletionClass === "modified_or_easy_run" ||
    input.runningCompletionClass === "return_trial_run"
  );
}

export function detectPendingTpCache(input: {
  asOfDate: string;
  currentLifecycle: OperationalSignalLifecycle;
  completion: OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"];
  returnWorkoutBlockerKind?: string | null;
  expectsRunOnAsOfDate?: boolean;
}): boolean {
  if (input.returnWorkoutBlockerKind === "pending_today") {
    const completedToday =
      input.completion?.workoutDate === input.asOfDate &&
      input.completion.sportClass === "running_like";
    if (!completedToday) {
      return true;
    }
  }
  if (input.expectsRunOnAsOfDate && !input.completion) {
    return true;
  }
  if (input.completion?.evidenceFreshness === "missing" || input.completion?.evidenceFreshness === "stale") {
    return true;
  }
  if (
    input.expectsRunOnAsOfDate &&
    input.completion &&
    input.completion.workoutDate < input.asOfDate &&
    input.completion.sportClass === "running_like"
  ) {
    return false;
  }
  return false;
}

export function resolveBridgeRecommendedAction(input: BridgeDiagnosticInput): {
  recommendedAction: BridgeRecommendedAction;
  reason: string;
  applyDryRunCommand: string | null;
} {
  const { lifecycleInput, proposal, currentLifecycle, signalClass } = input;
  const completion = lifecycleInput.latestTpCompletionAfterOpen;
  const applyDryRunCommand = `npm run apply-operational-signal-lifecycle -- --signal-id ${input.signalId} --as-of ${input.asOfDate}`;

  if (proposal.blockedByNegative || lifecycleInput.negativeMessageAfterCompletion) {
    return {
      recommendedAction: "blocked_by_negative",
      reason: "Negative Telegram evidence after completion blocks demotion/resolve.",
      applyDryRunCommand: null,
    };
  }

  const duplicateClusterSize = input.duplicateClusterSize ?? 1;
  if (duplicateClusterSize > 1 && proposal.proposedLifecycle !== currentLifecycle) {
    return {
      recommendedAction: "manual_review",
      reason: `Duplicate/stale cluster size=${duplicateClusterSize}; canonical signal unclear before apply.`,
      applyDryRunCommand,
    };
  }

  const isTpDriven =
    isTpCompletionDrivenReasonCode(proposal.reasonCode) && !lifecycleInput.explicitRecoveryMessage;
  const isRecoveryMessageDriven = Boolean(lifecycleInput.explicitRecoveryMessage);

  if (
    completion &&
    hasReliableTpRunningCompletion(completion) &&
    (currentLifecycle === "return_planned" || currentLifecycle === "active_problem") &&
    (signalClass === "confirmed_illness" || signalClass === "ambiguous_illness" || signalClass === "schedule_pause") &&
    isRecoveryMessageDriven &&
    proposal.proposedLifecycle === "resolved"
  ) {
    const monitoringProposal: OperationalSignalLifecycleProposal = {
      proposedLifecycle: "monitoring_after_return",
      confidence: proposal.confidence,
      reasonCode: "tp_completion_recovery_message_cap",
      reason:
        "Reliable TP running completion after open; policy caps first transition at monitoring despite recovery message.",
      hideFromTpSignals: false,
      evidenceRefs: {
        latestTpCompletionAfterOpen: completion,
        explicitRecoveryMessage: lifecycleInput.explicitRecoveryMessage ?? null,
      },
    };
    const safety = validateOperationalSignalLifecycleApplySafety({
      signalClass,
      lifecycleInput,
      proposal: monitoringProposal,
    });
    if (safety.ok) {
      return {
        recommendedAction: "apply_monitoring_after_return",
        reason: monitoringProposal.reason,
        applyDryRunCommand,
      };
    }
  }

  if (isRecoveryMessageDriven && !completion && proposal.proposedLifecycle === "resolved") {
    return {
      recommendedAction: "non_tp_lifecycle_apply_gap",
      reason:
        "Lifecycle evaluator proposes resolve from recovery message, not TP completion; use recovery-episode or close path.",
      applyDryRunCommand: null,
    };
  }

  if (completion && detectPossibleMisclassifiedRun(completion)) {
    const reason = titleLooksLikeNonRunning(completion.title)
      ? `Workout "${completion.title ?? "unknown"}" looks non-running but classified as ${completion.sportClass}.`
      : `Workout "${completion.title ?? "unknown"}" looks like running but classified as ${completion.sportClass}.`;
    return {
      recommendedAction: "fix_tp_workout_classification",
      reason,
      applyDryRunCommand: null,
    };
  }

  if (
    completion &&
    completion.sportClass === "running_like" &&
    (completion.classificationConfidence === "low" ||
      completion.runningCompletionClass === "uncertain_running_completion")
  ) {
    return {
      recommendedAction: "fix_tp_workout_classification",
      reason: "Running-like completion has low/uncertain classification; do not apply on unreliable TP evidence.",
      applyDryRunCommand: null,
    };
  }

  const pendingTpCache = detectPendingTpCache({
    asOfDate: input.asOfDate,
    currentLifecycle,
    completion,
    returnWorkoutBlockerKind: lifecycleInput.returnWorkoutBlocker?.kind ?? null,
    expectsRunOnAsOfDate:
      currentLifecycle === "return_planned" && lifecycleInput.returnWorkoutBlocker?.kind === "pending_today",
  });
  if (pendingTpCache && isTpDriven && proposal.proposedLifecycle === "monitoring_after_return") {
    return {
      recommendedAction: "pending_tp_cache",
      reason: "TP cache evidence is stale/missing or today's expected run is not in cache yet.",
      applyDryRunCommand,
    };
  }

  if (!completion && currentLifecycle === "return_planned" && lifecycleInput.returnWorkoutBlocker?.kind === "pending_today") {
    return {
      recommendedAction: "pending_tp_cache",
      reason: "Return workout pending today; wait for TP cache refresh before lifecycle apply.",
      applyDryRunCommand: null,
    };
  }

  if (completion?.sportClass === "strength_only") {
    return {
      recommendedAction: "no_action",
      reason: "Strength-only completion does not advance running health lifecycle.",
      applyDryRunCommand: null,
    };
  }

  if (completion && completion.sportClass !== "running_like" && !isTpDriven) {
    return {
      recommendedAction: "keep_active",
      reason: "Latest completion is not running-like; keep current lifecycle.",
      applyDryRunCommand: null,
    };
  }

  const cleanRunCount = input.cleanRunningCompletionCount ?? (completion && isCleanRunningCompletion(completion) ? 1 : 0);

  if (
    currentLifecycle === "monitoring_after_return" &&
    cleanRunCount >= 2 &&
    !lifecycleInput.negativeMessageAfterCompletion &&
    (signalClass === "confirmed_illness" || signalClass === "ambiguous_illness" || signalClass === "schedule_pause")
  ) {
    return {
      recommendedAction: "coach_close_candidate",
      reason: `${cleanRunCount} clean running completions after return; ready for coach close review (no auto-close).`,
      applyDryRunCommand: null,
    };
  }

  if (
    currentLifecycle === "monitoring_after_return" &&
    proposal.requiresCoachClose &&
    signalClass === "injury_pain"
  ) {
    return {
      recommendedAction: "coach_close_candidate",
      reason: "Injury/pain monitoring after return requires coach close; TP completion alone is insufficient.",
      applyDryRunCommand: null,
    };
  }

  if (proposal.proposedLifecycle === "resolved" && isTpDriven) {
    if (signalClass === "confirmed_illness" || signalClass === "injury_pain") {
      return {
        recommendedAction: "manual_review",
        reason: "Terminal resolve from TP-only evidence is blocked for confirmed illness/injury policy.",
        applyDryRunCommand,
      };
    }
    return {
      recommendedAction: "resolved_candidate",
      reason: "Evaluator proposes terminal resolve from TP evidence; dry-run/manual review only in this task.",
      applyDryRunCommand,
    };
  }

  if (
    proposal.proposedLifecycle === "monitoring_after_return" &&
    currentLifecycle !== "monitoring_after_return"
  ) {
    const safety = validateOperationalSignalLifecycleApplySafety({
      signalClass,
      lifecycleInput,
      proposal,
    });
    if (!safety.ok) {
      if (completion?.evidenceFreshness === "stale" || completion?.evidenceFreshness === "missing") {
        return {
          recommendedAction: "pending_tp_cache",
          reason: safety.reason,
          applyDryRunCommand,
        };
      }
      return {
        recommendedAction: "manual_review",
        reason: safety.reason,
        applyDryRunCommand,
      };
    }
    return {
      recommendedAction: "apply_monitoring_after_return",
      reason: proposal.reason,
      applyDryRunCommand,
    };
  }

  if (proposal.proposedLifecycle === currentLifecycle) {
    return {
      recommendedAction: "no_action",
      reason: "Stored lifecycle already matches evaluator proposal.",
      applyDryRunCommand: null,
    };
  }

  if (!completion && !isRecoveryMessageDriven) {
    return {
      recommendedAction: "keep_active",
      reason: "No TP completion after signal open; keep active lifecycle.",
      applyDryRunCommand: null,
    };
  }

  return {
    recommendedAction: "manual_review",
    reason: proposal.reason || "Uncertain TP bridge outcome; needs manual review.",
    applyDryRunCommand,
  };
}
