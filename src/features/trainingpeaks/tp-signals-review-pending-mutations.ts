import type {
  TrainingPeaksOperationalSignalReviewDecision,
  TrainingPeaksOperationalSignalReviewDecisionName,
  TrainingPeaksOperationalSignalReviewDecisionSource,
  TrainingPeaksOperationalSignalStatus,
  TrainingPeaksOperationalSignalType,
  TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";

/**
 * Pending-mutation replay policy for the TP Signals review queue.
 *
 * Context: coach review-queue button clicks (`close_signal` / `hide_from_queue`) are
 * append-only review decisions. When they were clicked while
 * `TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED=false`, the decision row was
 * written but the operational signal was never closed/dismissed, so the signal stayed
 * `active` and kept showing in `/tp_signals` (audit root cause class D — e.g. Alexander
 * Ivanov `9b201054`).
 *
 * This module is pure and deterministic: given active signals + their latest review
 * decision, it decides which signals have a "pending mutation" that a guarded replay
 * could apply. It performs no IO. The replay command applies the same status/lifecycle
 * transition the live review-queue path would have applied.
 */

export const TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM = "APPLY TP SIGNAL REVIEW PENDING MUTATIONS";

const SCHEDULE_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
  "schedule_availability_window",
  "schedule_unavailability_window",
  "plan_generation_constraint",
]);

const REPLAYABLE_DECISIONS = new Set<TrainingPeaksOperationalSignalReviewDecisionName>([
  "close_signal",
  "hide_from_queue",
]);

const REPLAYABLE_DECISION_SOURCES = new Set<TrainingPeaksOperationalSignalReviewDecisionSource>([
  "telegram_button",
  "manual",
]);

export type PendingMutationProposedStatus = Extract<
  TrainingPeaksOperationalSignalStatus,
  "dismissed" | "expired"
>;

export type PendingMutationSkipReason =
  | "no_review_decision"
  | "decision_not_replayable"
  | "decision_source_not_replayable"
  | "signal_not_active"
  | "mutation_already_applied"
  | "unsupported_category";

export type PendingMutationCategory =
  | "health_or_illness"
  | "pain_injury"
  | "schedule_or_constraint"
  | "other";

export type PendingMutationCandidate = {
  signalId: string;
  studentId: string;
  studentName: string;
  signalType: TrainingPeaksOperationalSignalType;
  category: PendingMutationCategory;
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
  decisionId: string;
  decisionSource: TrainingPeaksOperationalSignalReviewDecisionSource;
  decisionCreatedAt: string;
  currentStatus: TrainingPeaksOperationalSignalStatus;
  currentLifecycleState: string | null;
  eligible: boolean;
  proposedStatus: PendingMutationProposedStatus | null;
  proposedLifecycleState: "resolved" | null;
  reason: string;
  skipReason: PendingMutationSkipReason | null;
};

function resolveCategory(signalType: TrainingPeaksOperationalSignalType): PendingMutationCategory {
  if (SCHEDULE_SIGNAL_TYPES.has(signalType)) {
    return "schedule_or_constraint";
  }
  if (signalType === "pain_injury") {
    return "pain_injury";
  }
  if (
    signalType === "health_issue_started" ||
    signalType === "health_issue_improving" ||
    signalType === "health_issue_resolved" ||
    signalType === "resume_training" ||
    signalType === "pause_training"
  ) {
    return "health_or_illness";
  }
  if (signalType === "move_workout_candidate") {
    return "other";
  }
  return "other";
}

export function isPendingMutationAlreadyApplied(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "metadata">
): boolean {
  const metadata = signal.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const record = metadata as Record<string, unknown>;
  return (
    typeof record.review_queue_resolved_by === "string" ||
    typeof record.review_queue_review_decision_id === "string" ||
    typeof record.review_queue_replay_applied_at === "string"
  );
}

/**
 * Resolve the close target the live review queue would use:
 * - schedule/constraint signals expire;
 * - everything else (health/illness/pain/resume) is dismissed + lifecycle resolved.
 */
export function resolvePendingMutationTargetStatus(input: {
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
  signalType: TrainingPeaksOperationalSignalType;
}): { status: PendingMutationProposedStatus; lifecycleState: "resolved" | null } {
  if (input.decision === "hide_from_queue") {
    // hide_from_queue mirrors dismissOperationalSignalByReviewQueue (status only).
    return { status: "dismissed", lifecycleState: null };
  }
  // close_signal mirrors markOperationalSignalResolvedByReviewQueue.
  if (SCHEDULE_SIGNAL_TYPES.has(input.signalType)) {
    return { status: "expired", lifecycleState: null };
  }
  return { status: "dismissed", lifecycleState: "resolved" };
}

/**
 * Classify a single active signal + its latest review decision into a pending-mutation
 * candidate. Returns a candidate record describing whether it is eligible and why/why-not.
 */
export function classifyPendingReviewMutationForSignal(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  studentName: string;
  latestDecision: TrainingPeaksOperationalSignalReviewDecision | null;
}): PendingMutationCandidate {
  const { signal, latestDecision } = input;
  const category = resolveCategory(signal.signalType);
  const base = {
    signalId: signal.id,
    studentId: signal.studentId,
    studentName: input.studentName,
    signalType: signal.signalType,
    category,
    currentStatus: signal.status,
    currentLifecycleState: signal.lifecycleState,
  } as const;

  if (!latestDecision) {
    return {
      ...base,
      decision: "acknowledged",
      decisionId: "",
      decisionSource: "diagnostic",
      decisionCreatedAt: "",
      eligible: false,
      proposedStatus: null,
      proposedLifecycleState: null,
      reason: "No review decision recorded for this signal.",
      skipReason: "no_review_decision",
    };
  }

  const decisionBase = {
    ...base,
    decision: latestDecision.decision,
    decisionId: latestDecision.id,
    decisionSource: latestDecision.decisionSource,
    decisionCreatedAt: latestDecision.createdAt,
  } as const;

  // Latest decision must be a replayable mutation decision. A newer keep_visible /
  // acknowledged / needs_manual_followup / close_candidate_seen overrides earlier
  // close/hide intent (it is the latest), so it is not eligible.
  if (!REPLAYABLE_DECISIONS.has(latestDecision.decision)) {
    return {
      ...decisionBase,
      eligible: false,
      proposedStatus: null,
      proposedLifecycleState: null,
      reason: `Latest decision is "${latestDecision.decision}"; not a close/hide mutation.`,
      skipReason: "decision_not_replayable",
    };
  }

  if (!REPLAYABLE_DECISION_SOURCES.has(latestDecision.decisionSource)) {
    return {
      ...decisionBase,
      eligible: false,
      proposedStatus: null,
      proposedLifecycleState: null,
      reason: `Decision source "${latestDecision.decisionSource}" is not replayable.`,
      skipReason: "decision_source_not_replayable",
    };
  }

  if (signal.status !== "active") {
    return {
      ...decisionBase,
      eligible: false,
      proposedStatus: null,
      proposedLifecycleState: null,
      reason: `Signal status is "${signal.status}"; only active signals are replayed.`,
      skipReason: "signal_not_active",
    };
  }

  if (isPendingMutationAlreadyApplied(signal)) {
    return {
      ...decisionBase,
      eligible: false,
      proposedStatus: null,
      proposedLifecycleState: null,
      reason: "Review-queue mutation metadata already present; nothing to replay.",
      skipReason: "mutation_already_applied",
    };
  }

  const target = resolvePendingMutationTargetStatus({
    decision: latestDecision.decision,
    signalType: signal.signalType,
  });

  return {
    ...decisionBase,
    eligible: true,
    proposedStatus: target.status,
    proposedLifecycleState: target.lifecycleState,
    reason:
      latestDecision.decision === "close_signal"
        ? `close_signal recorded ${latestDecision.createdAt} but signal still active; replay → ${target.status}.`
        : `hide_from_queue recorded ${latestDecision.createdAt} but signal still active; replay → ${target.status}.`,
    skipReason: null,
  };
}

export type PendingReviewMutationsClassification = {
  candidates: PendingMutationCandidate[];
  eligible: PendingMutationCandidate[];
  skipped: PendingMutationCandidate[];
};

/**
 * Classify a set of active signals against their latest review decisions.
 * Only signals that HAVE a latest decision are considered (signals with no decision are
 * skipped silently and not returned as candidates, to keep the report focused).
 */
export function classifyPendingReviewMutations(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  latestDecisionBySignalId: ReadonlyMap<string, TrainingPeaksOperationalSignalReviewDecision>;
  studentNameById?: ReadonlyMap<string, string>;
}): PendingReviewMutationsClassification {
  const candidates: PendingMutationCandidate[] = [];
  for (const signal of input.signals) {
    const latestDecision = input.latestDecisionBySignalId.get(signal.id) ?? null;
    if (!latestDecision) {
      continue;
    }
    const studentName =
      input.studentNameById?.get(signal.studentId) ?? `Unknown (${signal.studentId.slice(0, 8)})`;
    candidates.push(
      classifyPendingReviewMutationForSignal({ signal, studentName, latestDecision })
    );
  }
  return {
    candidates,
    eligible: candidates.filter((item) => item.eligible),
    skipped: candidates.filter((item) => !item.eligible),
  };
}
