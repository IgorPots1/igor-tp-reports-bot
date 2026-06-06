import { createHash } from "node:crypto";

import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

export type OperationalSignalSupersedeDecision = "allowed" | "refused" | "manual_review";

export type OperationalSignalSupersedeDryRunFingerprintInput = {
  sourceSignalId: string;
  targetSignalId: string;
  sourceStudentId: string;
  targetStudentId: string;
  sourceLifecycle: string | null;
  targetLifecycle: string | null;
  sourceDisplaySummary: string | null;
  targetDisplaySummary: string | null;
  reason: string;
  asOfDate: string;
};

export type OperationalSignalSupersedeValidationInput = {
  source: TrainingPeaksStudentOperationalSignal;
  target: TrainingPeaksStudentOperationalSignal;
  reason: string;
};

export type OperationalSignalSupersedeValidationResult =
  | {
      decision: "allowed";
      reason: string;
    }
  | {
      decision: "refused";
      reason: string;
    }
  | {
      decision: "manual_review";
      reason: string;
    };

export function normalizeSupersedeReason(reason: string): string {
  return reason.trim().replace(/\s+/gu, " ");
}

export function getSupersededBySignalIdFromSignal(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "metadata" | "structuredPayload" | "lifecycleMeta">
): string | null {
  const fromMetadata =
    typeof signal.metadata.superseded_by_signal_id === "string"
      ? signal.metadata.superseded_by_signal_id.trim()
      : null;
  if (fromMetadata) {
    return fromMetadata;
  }
  const fromPayload =
    typeof signal.structuredPayload.superseded_by_signal_id === "string"
      ? signal.structuredPayload.superseded_by_signal_id.trim()
      : null;
  if (fromPayload) {
    return fromPayload;
  }
  const fromLifecycleMeta =
    typeof signal.lifecycleMeta.superseded_by_signal_id === "string"
      ? signal.lifecycleMeta.superseded_by_signal_id.trim()
      : null;
  return fromLifecycleMeta || null;
}

export function resolveSignalDisplaySummary(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "structuredPayload" | "metadata">
): string | null {
  const fromPayloadDisplay =
    typeof signal.structuredPayload.display_summary === "string"
      ? signal.structuredPayload.display_summary.trim()
      : null;
  if (fromPayloadDisplay) {
    return fromPayloadDisplay;
  }
  const fromPayloadLatest =
    typeof signal.structuredPayload.latest_summary === "string"
      ? signal.structuredPayload.latest_summary.trim()
      : null;
  if (fromPayloadLatest) {
    return fromPayloadLatest;
  }
  const fromMetadataDisplay =
    typeof signal.metadata.display_summary === "string" ? signal.metadata.display_summary.trim() : null;
  if (fromMetadataDisplay) {
    return fromMetadataDisplay;
  }
  const fromMetadataLatest =
    typeof signal.metadata.latest_summary === "string" ? signal.metadata.latest_summary.trim() : null;
  return fromMetadataLatest || null;
}

export function buildOperationalSignalSupersedeDryRunFingerprint(
  input: OperationalSignalSupersedeDryRunFingerprintInput
): string {
  const canonicalPayload = {
    source_signal_id: input.sourceSignalId,
    target_signal_id: input.targetSignalId,
    source_student_id: input.sourceStudentId,
    target_student_id: input.targetStudentId,
    source_lifecycle: input.sourceLifecycle,
    target_lifecycle: input.targetLifecycle,
    source_display_summary: input.sourceDisplaySummary,
    target_display_summary: input.targetDisplaySummary,
    reason: normalizeSupersedeReason(input.reason),
    as_of: input.asOfDate,
  };
  const canonicalJson = stableStringify(canonicalPayload);
  return createHash("sha256").update(canonicalJson).digest("hex");
}

export function buildOperationalSignalSupersedeApplyToken(input: {
  sourceSignalId: string;
  targetSignalId: string;
  dryRunFingerprint: string;
}): string {
  return `SUPERSEDE_SIGNAL:${input.sourceSignalId}:${input.targetSignalId}:${input.dryRunFingerprint}`;
}

export function parseOperationalSignalSupersedeApplyToken(
  token: string
): { sourceSignalId: string; targetSignalId: string; dryRunFingerprint: string } | null {
  const normalized = token.trim();
  const match = normalized.match(
    /^SUPERSEDE_SIGNAL:([^:]+):([^:]+):([a-f0-9]{64})$/u
  );
  if (!match) {
    return null;
  }
  return {
    sourceSignalId: match[1]!,
    targetSignalId: match[2]!,
    dryRunFingerprint: match[3]!,
  };
}

export function validateOperationalSignalSupersedeSafety(
  input: OperationalSignalSupersedeValidationInput
): OperationalSignalSupersedeValidationResult {
  const { source, target } = input;
  const reason = normalizeSupersedeReason(input.reason);

  if (!reason) {
    return { decision: "refused", reason: "Supersede reason is required." };
  }
  if (source.id === target.id) {
    return { decision: "refused", reason: "Source and target signal ids must differ." };
  }
  if (source.studentId !== target.studentId) {
    return {
      decision: "refused",
      reason: `Student mismatch: source=${source.studentId} target=${target.studentId}`,
    };
  }
  if (source.lifecycleState === "resolved") {
    return {
      decision: "refused",
      reason: "Source signal is already resolved; supersede apply is blocked.",
    };
  }
  if (target.lifecycleState === "resolved") {
    return {
      decision: "manual_review",
      reason: "Target signal is resolved; confirm canonical target is still correct.",
    };
  }

  const existingSupersededBy = getSupersededBySignalIdFromSignal(source);
  if (existingSupersededBy && existingSupersededBy !== target.id) {
    return {
      decision: "refused",
      reason: `Source is already superseded by another signal: ${existingSupersededBy}`,
    };
  }

  const targetSupersededBy = getSupersededBySignalIdFromSignal(target);
  if (targetSupersededBy) {
    return {
      decision: "manual_review",
      reason: `Target signal is itself superseded by ${targetSupersededBy}; verify canonical choice.`,
    };
  }

  return {
    decision: "allowed",
    reason: existingSupersededBy === target.id
      ? "Source already superseded by this target; apply may be idempotent."
      : "Supersede relationship is allowed for guarded apply.",
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
