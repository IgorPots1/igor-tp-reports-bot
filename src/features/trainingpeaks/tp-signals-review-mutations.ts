import type {
  TrainingPeaksOperationalSignalReviewDecisionName,
  TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";

export type TpSignalReviewQueueMutationReason =
  | "not_found"
  | "not_active"
  | "ambiguous_lookup"
  | "unsupported_category"
  | "mutation_disabled"
  | "db_error"
  | "no_mutation_needed";

export type TpSignalReviewQueueMutationResult = {
  updated: boolean;
  previousStatus: TrainingPeaksStudentOperationalSignal["status"] | null;
  newStatus: TrainingPeaksStudentOperationalSignal["status"] | null;
  reason?: TpSignalReviewQueueMutationReason;
};

const SCHEDULE_SIGNAL_TYPES = new Set<TrainingPeaksStudentOperationalSignal["signalType"]>([
  "schedule_availability_window",
  "schedule_unavailability_window",
  "plan_generation_constraint",
]);

export function isTpSignalReviewQueueCloseMutationDecision(
  decision: TrainingPeaksOperationalSignalReviewDecisionName
): boolean {
  return decision === "close_signal";
}

export function isTpSignalReviewQueueDismissMutationDecision(
  decision: TrainingPeaksOperationalSignalReviewDecisionName
): boolean {
  return decision === "hide_from_queue";
}

export function shouldAttemptTpSignalReviewQueueMutation(input: {
  mutationsEnabled: boolean;
  decision: TrainingPeaksOperationalSignalReviewDecisionName;
}): boolean {
  if (!input.mutationsEnabled) {
    return false;
  }
  return (
    isTpSignalReviewQueueCloseMutationDecision(input.decision) ||
    isTpSignalReviewQueueDismissMutationDecision(input.decision)
  );
}

export function resolveTpSignalReviewQueueCloseTargetStatus(
  signal: TrainingPeaksStudentOperationalSignal
): "dismissed" | "expired" {
  if (SCHEDULE_SIGNAL_TYPES.has(signal.signalType)) {
    return "expired";
  }
  return "dismissed";
}

export function buildTpSignalReviewQueueMutationMetadata(input: {
  existing: Record<string, unknown>;
  reviewDecisionId: string;
  reviewDecision: TrainingPeaksOperationalSignalReviewDecisionName;
  previousStatus: TrainingPeaksStudentOperationalSignal["status"];
  reason: string;
}): Record<string, unknown> {
  const appliedAt = new Date().toISOString();
  return {
    ...input.existing,
    review_queue_resolved_by: "coach_review_queue",
    review_queue_resolved_at: appliedAt,
    review_queue_review_decision_id: input.reviewDecisionId,
    review_queue_review_decision: input.reviewDecision,
    review_queue_previous_status: input.previousStatus,
    review_queue_reason: input.reason,
  };
}

export function buildTpSignalReviewQueueCloseLifecyclePatch(input: {
  appliedAt: string;
  reason: string;
}): {
  lifecycle_state: "resolved";
  lifecycle_state_updated_at: string;
  lifecycle_applied_at: string;
  resolved_at: string;
  resolved_reason: string;
  requires_coach_close: boolean;
} {
  return {
    lifecycle_state: "resolved",
    lifecycle_state_updated_at: input.appliedAt,
    lifecycle_applied_at: input.appliedAt,
    resolved_at: input.appliedAt,
    resolved_reason: input.reason,
    requires_coach_close: false,
  };
}
