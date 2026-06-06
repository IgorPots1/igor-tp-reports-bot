import { createHash } from "node:crypto";

import type {
  OperationalSignalClass,
  OperationalSignalLifecycle,
  OperationalSignalLifecycleInput,
  OperationalSignalLifecycleProposal,
} from "@/features/trainingpeaks/operational-signal-lifecycle";

export const MIN_COACH_CLOSE_REASON_LENGTH = 8;

type CloseFingerprintTpEvidence = {
  workoutId: string | null;
  workoutDate: string | null;
  title: string | null;
  sportOrTypeCode: string | null;
  runningCompletionClass: string | null;
  sportClass: string | null;
  evidenceFreshness: string | null;
  classificationConfidence: string | null;
};

export type OperationalSignalLifecycleCloseDryRunFingerprintInput = {
  signalId: string;
  signalType: string;
  signalClass: OperationalSignalClass;
  currentLifecycle: OperationalSignalLifecycle;
  targetLifecycle: "resolved";
  latestTransitionId: string | null;
  latestTransitionFingerprint: string | null;
  latestTpCompletionAfterOpen: CloseFingerprintTpEvidence | null;
  hasNegativeAfterCompletion: boolean;
  missedOrSkippedReturnWorkout: boolean;
  coachReasonNormalized: string;
  asOfDate: string;
};

export type OperationalSignalLifecycleCloseEligibilityInput = {
  storedLifecycleState: OperationalSignalLifecycle | null;
  requiresCoachClose: boolean;
  signalClass: OperationalSignalClass;
  lifecycleInput: OperationalSignalLifecycleInput;
  proposal: OperationalSignalLifecycleProposal;
  coachReason?: string | null;
  applyMode?: boolean;
};

export type OperationalSignalLifecycleCloseEligibilityResult =
  | {
      ok: true;
      kind: "eligible" | "already_resolved";
    }
  | {
      ok: false;
      reason: string;
      suggestApplyMonitoring?: boolean;
      applyCommandHint?: string;
    };

const COACH_CLOSE_ALLOWED_CLASSES = new Set<OperationalSignalClass>([
  "confirmed_illness",
  "injury_pain",
  "schedule_pause",
]);

export function normalizeCoachCloseReason(reason: string): string {
  return reason.trim().replace(/\s+/gu, " ");
}

export function buildOperationalSignalLifecycleCloseDryRunFingerprint(
  input: OperationalSignalLifecycleCloseDryRunFingerprintInput
): string {
  const canonicalPayload = {
    signal_id: input.signalId,
    signal_type: input.signalType,
    signal_class: input.signalClass,
    current_lifecycle: input.currentLifecycle,
    target_lifecycle: input.targetLifecycle,
    latest_transition_id: input.latestTransitionId,
    latest_transition_fingerprint: input.latestTransitionFingerprint,
    latest_tp_completion_after_open: input.latestTpCompletionAfterOpen,
    has_negative_after_completion: input.hasNegativeAfterCompletion,
    missed_or_skipped_return_workout: input.missedOrSkippedReturnWorkout,
    coach_reason_normalized: input.coachReasonNormalized,
    as_of: input.asOfDate,
  };
  const canonicalJson = stableStringify(canonicalPayload);
  return createHash("sha256").update(canonicalJson).digest("hex");
}

export function buildOperationalSignalLifecycleCloseToken(input: {
  signalId: string;
  dryRunFingerprint: string;
}): string {
  return `CLOSE_LIFECYCLE:${input.signalId}:resolved:${input.dryRunFingerprint}`;
}

export function parseOperationalSignalLifecycleCloseToken(
  token: string
): { signalId: string; targetLifecycle: "resolved"; dryRunFingerprint: string } | null {
  const normalized = token.trim();
  const match = normalized.match(/^CLOSE_LIFECYCLE:([^:]+):resolved:([a-f0-9]{64})$/u);
  if (!match) {
    return null;
  }
  return {
    signalId: match[1]!,
    targetLifecycle: "resolved",
    dryRunFingerprint: match[2]!,
  };
}

export function collectOperationalSignalLifecycleCloseReasonCodes(input: {
  signalClass: OperationalSignalClass;
  lifecycleInput: OperationalSignalLifecycleInput;
  coachReasonNormalized: string;
}): string[] {
  const codes = new Set<string>(["coach_reviewed_close"]);
  codes.add(`signal_class_${input.signalClass}`);
  if (input.lifecycleInput.negativeMessageAfterCompletion) {
    codes.add("negative_after_completion");
  }
  if (input.lifecycleInput.missedOrSkippedReturnWorkout) {
    codes.add("missed_or_skipped_return_workout");
  }
  const completion = input.lifecycleInput.latestTpCompletionAfterOpen;
  if (completion) {
    for (const code of completion.classificationReasonCodes) {
      if (typeof code === "string" && code.trim()) {
        codes.add(code.trim());
      }
    }
    if (completion.evidenceFreshness === "stale") {
      codes.add("evidence_stale");
    }
    if (completion.evidenceFreshness === "missing") {
      codes.add("evidence_missing");
    }
  }
  if (input.coachReasonNormalized) {
    codes.add("coach_reason_provided");
  }
  return [...codes].sort();
}

export function isCoachCloseAllowedSignalClass(input: {
  signalClass: OperationalSignalClass;
  requiresCoachClose: boolean;
}): boolean {
  return COACH_CLOSE_ALLOWED_CLASSES.has(input.signalClass) || input.requiresCoachClose;
}

export function validateOperationalSignalLifecycleCloseEligibility(
  input: OperationalSignalLifecycleCloseEligibilityInput
): OperationalSignalLifecycleCloseEligibilityResult {
  const storedLifecycle = input.storedLifecycleState ?? "active_problem";

  if (storedLifecycle === "resolved") {
    return { ok: true, kind: "already_resolved" };
  }

  if (input.applyMode) {
    const normalizedReason = normalizeCoachCloseReason(input.coachReason ?? "");
    if (!normalizedReason) {
      return { ok: false, reason: "Coach close reason is required in apply mode." };
    }
    if (normalizedReason.length < MIN_COACH_CLOSE_REASON_LENGTH) {
      return {
        ok: false,
        reason: `Coach close reason is too short; minimum length is ${MIN_COACH_CLOSE_REASON_LENGTH}.`,
      };
    }
  }

  if (storedLifecycle !== "monitoring_after_return") {
    if (input.proposal.proposedLifecycle === "monitoring_after_return") {
      return {
        ok: false,
        reason:
          "Stored lifecycle is not monitoring_after_return. First apply monitoring transition with apply-operational-signal-lifecycle, then close.",
        suggestApplyMonitoring: true,
      };
    }
    if (storedLifecycle === "active_problem") {
      return {
        ok: false,
        reason: "Direct close from active_problem is not allowed; apply monitoring transition first.",
        suggestApplyMonitoring: false,
      };
    }
    return {
      ok: false,
      reason: `Coach close requires stored lifecycle_state=monitoring_after_return; current=${storedLifecycle}.`,
      suggestApplyMonitoring: false,
    };
  }

  if (!isCoachCloseAllowedSignalClass({
    signalClass: input.signalClass,
    requiresCoachClose: input.requiresCoachClose,
  })) {
    return {
      ok: false,
      reason: `Signal class ${input.signalClass} does not require coach-reviewed close.`,
    };
  }

  if (input.proposal.blockedByNegative || input.lifecycleInput.negativeMessageAfterCompletion) {
    return {
      ok: false,
      reason: "Negative Telegram evidence after completion blocks coach close.",
    };
  }

  if (input.lifecycleInput.missedOrSkippedReturnWorkout) {
    return {
      ok: false,
      reason: "Missed or skipped return workout blocks coach close.",
    };
  }

  const completion = input.lifecycleInput.latestTpCompletionAfterOpen;
  if (completion) {
    if (completion.evidenceFreshness === "missing" || completion.evidenceFreshness === "stale") {
      return {
        ok: false,
        reason: `TP completion evidence freshness is ${completion.evidenceFreshness}; coach close is blocked.`,
      };
    }
  }

  if (input.proposal.proposedLifecycle === "active_problem") {
    return {
      ok: false,
      reason: "Fresh evidence evaluation reopens active_problem; coach close is blocked.",
    };
  }

  return { ok: true, kind: "eligible" };
}

export function buildCloseEvidenceSnapshot(input: {
  lifecycleInput: OperationalSignalLifecycleInput;
  proposal: OperationalSignalLifecycleProposal;
  coachReasonNormalized: string;
  latestTransitionId: string | null;
  latestTransitionFingerprint: string | null;
}): Record<string, unknown> {
  return {
    coach_reason: input.coachReasonNormalized,
    latest_transition_id: input.latestTransitionId,
    latest_transition_fingerprint: input.latestTransitionFingerprint,
    latest_tp_completion_after_open: input.lifecycleInput.latestTpCompletionAfterOpen ?? null,
    negative_message_after_completion: input.lifecycleInput.negativeMessageAfterCompletion ?? null,
    missed_or_skipped_return_workout: Boolean(input.lifecycleInput.missedOrSkippedReturnWorkout),
    evaluator_proposal: {
      proposed_lifecycle: input.proposal.proposedLifecycle,
      reason_code: input.proposal.reasonCode,
      reason: input.proposal.reason,
      requires_coach_close: Boolean(input.proposal.requiresCoachClose),
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    result[key] = sortDeep(entryValue);
  }
  return result;
}
