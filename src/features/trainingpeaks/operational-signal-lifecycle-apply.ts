import { createHash } from "node:crypto";

import type {
  OperationalSignalClass,
  OperationalSignalLifecycle,
  OperationalSignalLifecycleInput,
  OperationalSignalLifecycleProposal,
} from "@/features/trainingpeaks/operational-signal-lifecycle";

type FingerprintTpEvidence = {
  workoutId: string | null;
  workoutDate: string | null;
  title: string | null;
  sportOrTypeCode: string | null;
  runningCompletionClass: string | null;
  sportClass: string | null;
  evidenceFreshness: string | null;
  classificationConfidence: string | null;
};

export type OperationalSignalLifecycleDryRunFingerprintInput = {
  signalId: string;
  signalType: string;
  signalClass: OperationalSignalClass;
  currentLifecycle: OperationalSignalLifecycle;
  proposedLifecycle: OperationalSignalLifecycle;
  latestTpCompletionAfterOpen: FingerprintTpEvidence | null;
  hasNegativeAfterCompletion: boolean;
  missedOrSkippedReturnWorkout: boolean;
  reasonCodes: string[];
  asOfDate: string;
};

export function buildOperationalSignalLifecycleDryRunFingerprint(
  input: OperationalSignalLifecycleDryRunFingerprintInput
): string {
  const canonicalPayload = {
    signal_id: input.signalId,
    signal_type: input.signalType,
    signal_class: input.signalClass,
    current_lifecycle: input.currentLifecycle,
    proposed_lifecycle: input.proposedLifecycle,
    latest_tp_completion_after_open: input.latestTpCompletionAfterOpen,
    has_negative_after_completion: input.hasNegativeAfterCompletion,
    missed_or_skipped_return_workout: input.missedOrSkippedReturnWorkout,
    reason_codes: [...input.reasonCodes].sort(),
    as_of: input.asOfDate,
  };
  const canonicalJson = stableStringify(canonicalPayload);
  return createHash("sha256").update(canonicalJson).digest("hex");
}

export function buildOperationalSignalLifecycleApplyToken(input: {
  signalId: string;
  proposedLifecycle: OperationalSignalLifecycle;
  dryRunFingerprint: string;
}): string {
  return `APPLY_LIFECYCLE:${input.signalId}:${input.proposedLifecycle}:${input.dryRunFingerprint}`;
}

export function parseOperationalSignalLifecycleApplyToken(
  token: string
): { signalId: string; proposedLifecycle: OperationalSignalLifecycle; dryRunFingerprint: string } | null {
  const normalized = token.trim();
  const match = normalized.match(/^APPLY_LIFECYCLE:([^:]+):(active_problem|return_planned|return_trial_completed|monitoring_after_return|resolved):([a-f0-9]{64})$/u);
  if (!match) {
    return null;
  }
  return {
    signalId: match[1]!,
    proposedLifecycle: match[2]! as OperationalSignalLifecycle,
    dryRunFingerprint: match[3]!,
  };
}

export function collectOperationalSignalLifecycleReasonCodes(input: {
  proposal: OperationalSignalLifecycleProposal;
  lifecycleInput: OperationalSignalLifecycleInput;
}): string[] {
  const codes = new Set<string>();
  if (input.proposal.reasonCode) {
    codes.add(input.proposal.reasonCode);
  }
  const completion = input.lifecycleInput.latestTpCompletionAfterOpen;
  if (completion) {
    for (const code of completion.classificationReasonCodes) {
      if (typeof code === "string" && code.trim()) {
        codes.add(code.trim());
      }
    }
  }
  if (input.lifecycleInput.negativeMessageAfterCompletion) {
    codes.add("negative_after_completion");
  }
  if (input.lifecycleInput.missedOrSkippedReturnWorkout) {
    codes.add("missed_or_skipped_return_workout");
  }
  return [...codes];
}

export function isTpCompletionDrivenReasonCode(reasonCode: string): boolean {
  return reasonCode.startsWith("tp_completion_");
}

export function validateOperationalSignalLifecycleApplySafety(input: {
  signalClass: OperationalSignalClass;
  lifecycleInput: OperationalSignalLifecycleInput;
  proposal: OperationalSignalLifecycleProposal;
}): { ok: true } | { ok: false; reason: string } {
  const { signalClass, lifecycleInput, proposal } = input;
  const completion = lifecycleInput.latestTpCompletionAfterOpen;
  const isTpOnlyEvidence =
    isTpCompletionDrivenReasonCode(proposal.reasonCode) && !lifecycleInput.explicitRecoveryMessage;

  if (proposal.blockedByNegative || lifecycleInput.negativeMessageAfterCompletion) {
    return {
      ok: false,
      reason: "Negative Telegram evidence is present; lifecycle apply is blocked.",
    };
  }

  if (proposal.proposedLifecycle === "resolved" && proposal.requiresCoachClose) {
    return {
      ok: false,
      reason: "Resolved transition is blocked because evaluator requires coach close.",
    };
  }

  if (proposal.proposedLifecycle === "resolved" && isTpOnlyEvidence && signalClass === "injury_pain") {
    return {
      ok: false,
      reason: "Injury/pain cannot auto-resolve to terminal state from TP-only evidence.",
    };
  }

  if (proposal.proposedLifecycle === "resolved" && isTpOnlyEvidence && signalClass === "confirmed_illness") {
    return {
      ok: false,
      reason: "Confirmed illness cannot auto-resolve to terminal state from TP-only evidence.",
    };
  }

  if (
    proposal.proposedLifecycle === "resolved" &&
    completion?.sportClass === "strength_only" &&
    (signalClass === "injury_pain" || signalClass === "confirmed_illness" || signalClass === "ambiguous_illness")
  ) {
    return {
      ok: false,
      reason: "Strength-only completion cannot resolve running health lifecycle.",
    };
  }

  if (isTpOnlyEvidence) {
    if (!completion) {
      return {
        ok: false,
        reason: "TP completion evidence is required for TP-driven transition but is missing.",
      };
    }
    if (completion.evidenceFreshness === "missing" || completion.evidenceFreshness === "stale") {
      return {
        ok: false,
        reason: `TP completion evidence freshness is ${completion.evidenceFreshness}; apply is blocked.`,
      };
    }
    if (completion.classificationConfidence === "low" || proposal.confidence === "low") {
      return {
        ok: false,
        reason: "TP evidence confidence is low; apply is blocked.",
      };
    }
  }

  return { ok: true };
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
