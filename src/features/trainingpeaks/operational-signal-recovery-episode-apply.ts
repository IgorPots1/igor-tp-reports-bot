import { createHash } from "node:crypto";

import type { OperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import { resolveSignalDisplaySummary } from "@/features/trainingpeaks/operational-signal-supersede-apply";

export type RecoveryEpisodeTargetAction =
  | "display_refresh_only"
  | "return_planned"
  | "monitoring_after_return"
  | "resolved_candidate";

export type RecoveryEpisodeClassifierResult =
  | "health_issue_improving"
  | "health_issue_resolved"
  | "resume_training";

export type RecoveryEpisodeEvidenceKind =
  | "explicit_recovery"
  | "return_planned"
  | "return_request"
  | "recovery_pattern_only"
  | "none";

export type RecoveryEpisodeDryRunFingerprintInput = {
  signalId: string;
  observationId: string;
  studentId: string;
  currentLifecycle: OperationalSignalLifecycle;
  currentDisplaySummary: string | null;
  observationObservedAt: string;
  observationTextHash: string | null;
  classifierResult: RecoveryEpisodeClassifierResult;
  proposedDisplaySummary: string;
  proposedLifecycleTarget: RecoveryEpisodeTargetAction;
  asOfDate: string;
};

export type RecoveryEpisodeValidationInput = {
  signal: TrainingPeaksStudentOperationalSignal;
  observationStudentId: string | null;
  observationObservedAt: string;
  signalOpenTime: string;
  classifierResult: RecoveryEpisodeClassifierResult | null;
  signalClass: string;
  proposedDisplaySummary: string;
  proposedLifecycleTarget: RecoveryEpisodeTargetAction;
  requestedLifecycleOverride: OperationalSignalLifecycle | null;
  supersededBySignalId: string | null;
};

export type RecoveryEpisodeValidationResult =
  | { decision: "allowed"; reason: string }
  | { decision: "refused"; reason: string };

export type RecoveryEpisodeUpdateMeta = {
  source_observation_id: string;
  source_observation_at: string;
  classifier_result: RecoveryEpisodeClassifierResult;
  recovery_evidence_kind: RecoveryEpisodeEvidenceKind;
  previous_display_summary: string | null;
  updated_display_summary: string;
  updated_at: string;
  actor: string;
  source: string;
  dry_run_fingerprint: string;
  target_action: RecoveryEpisodeTargetAction;
  lifecycle_before: OperationalSignalLifecycle | null;
  lifecycle_after: OperationalSignalLifecycle | null;
};

const APPROVED_TARGET_ACTIONS: ReadonlySet<RecoveryEpisodeTargetAction> = new Set([
  "display_refresh_only",
  "return_planned",
  "monitoring_after_return",
  "resolved_candidate",
]);

const RECOVERY_CLASSIFIER_RESULTS: ReadonlySet<RecoveryEpisodeClassifierResult> = new Set([
  "health_issue_improving",
  "health_issue_resolved",
  "resume_training",
]);

export function isRecoveryEpisodeClassifierResult(
  value: string | null
): value is RecoveryEpisodeClassifierResult {
  return value !== null && RECOVERY_CLASSIFIER_RESULTS.has(value as RecoveryEpisodeClassifierResult);
}

export function buildRecoveryEpisodeDisplaySummary(input: {
  observationText: string;
  classifierResult: RecoveryEpisodeClassifierResult;
}): string {
  const text = input.observationText.toLowerCase();

  if (input.classifierResult === "resume_training" || input.classifierResult === "health_issue_resolved") {
    if (/(?:^|[\s,.;:!?()«»""-])(?:я\s+)?в\s+строю(?:$|[\s,.;:!?()«»""-])/u.test(text) || /начинаем\s+тренировк/u.test(text)) {
      return "после болезни: в строю, возврат к тренировкам; наблюдать";
    }
    return "после болезни: самочувствие нормализовалось; наблюдать";
  }

  if (/врач\s+разрешил[а-яё]*/u.test(text) && /завтра/u.test(text)) {
    return "после болезни: врач разрешил бег, завтра лёгкий выход; наблюдать";
  }
  if (/врач\s+разрешил[а-яё]*/u.test(text)) {
    return "после болезни: врач разрешил бег; наблюдать";
  }
  if (/завтра\s+попробую\s+побег/u.test(text)) {
    return "после болезни: лучше, завтра пробный бег; наблюдать";
  }
  if (/завтра\s+побег/u.test(text)) {
    return "после болезни: лучше, завтра пробежка; наблюдать";
  }
  if (/вроде\s+лучше/u.test(text) || /лучше\s+намного/u.test(text) || /чувствую\s+себя\s+лучше/u.test(text)) {
    return "после болезни: лучше; наблюдать";
  }
  if (/получше/u.test(text) || /улучша/u.test(text) || /после\s+болезни/u.test(text)) {
    return "после болезни: улучшается; наблюдать";
  }

  return "после болезни: улучшается; наблюдать";
}

export function resolveDefaultRecoveryTargetAction(input: {
  classifierResult: RecoveryEpisodeClassifierResult;
  currentLifecycle: OperationalSignalLifecycle;
}): RecoveryEpisodeTargetAction {
  if (input.classifierResult === "resume_training" || input.classifierResult === "health_issue_resolved") {
    return "resolved_candidate";
  }
  if (
    input.currentLifecycle === "monitoring_after_return" ||
    input.currentLifecycle === "return_trial_completed"
  ) {
    return "display_refresh_only";
  }
  return "return_planned";
}

export function resolveRecoveryLifecycleAfterApply(input: {
  currentLifecycle: OperationalSignalLifecycle;
  targetAction: RecoveryEpisodeTargetAction;
  requestedLifecycleOverride: OperationalSignalLifecycle | null;
}): OperationalSignalLifecycle {
  if (input.requestedLifecycleOverride) {
    return input.requestedLifecycleOverride;
  }
  if (input.targetAction === "display_refresh_only") {
    return input.currentLifecycle;
  }
  if (input.targetAction === "return_planned") {
    return "return_planned";
  }
  if (input.targetAction === "monitoring_after_return") {
    return "monitoring_after_return";
  }
  if (input.targetAction === "resolved_candidate") {
    if (input.currentLifecycle === "active_problem") {
      return "return_planned";
    }
    return input.currentLifecycle;
  }
  return input.currentLifecycle;
}

export function buildRecoveryEpisodeDryRunFingerprint(
  input: RecoveryEpisodeDryRunFingerprintInput
): string {
  const canonicalPayload = {
    signal_id: input.signalId,
    observation_id: input.observationId,
    student_id: input.studentId,
    current_lifecycle: input.currentLifecycle,
    current_display_summary: input.currentDisplaySummary,
    observation_observed_at: input.observationObservedAt,
    observation_text_hash: input.observationTextHash,
    classifier_result: input.classifierResult,
    proposed_display_summary: input.proposedDisplaySummary,
    proposed_lifecycle_target: input.proposedLifecycleTarget,
    as_of: input.asOfDate,
  };
  return createHash("sha256").update(stableStringify(canonicalPayload)).digest("hex");
}

export function buildRecoveryEpisodeApplyToken(input: {
  signalId: string;
  observationId: string;
  targetAction: RecoveryEpisodeTargetAction;
  dryRunFingerprint: string;
}): string {
  return `RECOVERY_EPISODE_UPDATE:${input.signalId}:${input.observationId}:${input.targetAction}:${input.dryRunFingerprint}`;
}

export function parseRecoveryEpisodeApplyToken(
  token: string
): {
  signalId: string;
  observationId: string;
  targetAction: RecoveryEpisodeTargetAction;
  dryRunFingerprint: string;
} | null {
  const normalized = token.trim();
  const match = normalized.match(
    /^RECOVERY_EPISODE_UPDATE:([^:]+):([^:]+):(display_refresh_only|return_planned|monitoring_after_return|resolved_candidate):([a-f0-9]{64})$/u
  );
  if (!match) {
    return null;
  }
  return {
    signalId: match[1]!,
    observationId: match[2]!,
    targetAction: match[3]! as RecoveryEpisodeTargetAction,
    dryRunFingerprint: match[4]!,
  };
}

export function validateRecoveryEpisodeApplySafety(
  input: RecoveryEpisodeValidationInput
): RecoveryEpisodeValidationResult {
  const { signal } = input;

  if (!APPROVED_TARGET_ACTIONS.has(input.proposedLifecycleTarget)) {
    return { decision: "refused", reason: "Proposed target action is not in approved list." };
  }
  if (!input.proposedDisplaySummary.trim()) {
    return { decision: "refused", reason: "Proposed display summary is empty." };
  }
  if (signal.lifecycleState === "resolved") {
    return { decision: "refused", reason: "Signal is already resolved." };
  }
  if (input.supersededBySignalId) {
    return {
      decision: "refused",
      reason: `Signal is superseded by ${input.supersededBySignalId}.`,
    };
  }
  if (!input.observationStudentId || input.observationStudentId !== signal.studentId) {
    return {
      decision: "refused",
      reason: "Observation belongs to another student or has no student link.",
    };
  }
  if (!isRecoveryEpisodeClassifierResult(input.classifierResult)) {
    return {
      decision: "refused",
      reason: "Classifier result is not a recovery/return signal type.",
    };
  }

  const openMs = Date.parse(input.signalOpenTime);
  const openDayMs = Date.parse(`${input.signalOpenTime.slice(0, 10)}T00:00:00.000Z`);
  const observedMs = Date.parse(input.observationObservedAt);
  const thresholdMs = Number.isFinite(openMs) && Number.isFinite(openDayMs)
    ? Math.min(openMs, openDayMs)
    : openMs;
  if (!Number.isFinite(thresholdMs) || !Number.isFinite(observedMs) || observedMs < thresholdMs) {
    return {
      decision: "refused",
      reason: "Observation is older than signal open time.",
    };
  }

  if (input.signalClass === "injury_pain") {
    if (
      input.proposedLifecycleTarget === "resolved_candidate" ||
      input.requestedLifecycleOverride === "resolved"
    ) {
      return {
        decision: "refused",
        reason: "Pain/injury signals cannot receive terminal resolve via recovery episode update.",
      };
    }
  }

  if (
    input.proposedLifecycleTarget === "resolved_candidate" ||
    input.requestedLifecycleOverride === "resolved"
  ) {
    if (input.signalClass === "injury_pain") {
      return {
        decision: "refused",
        reason: "Pain/injury terminal resolve is blocked.",
      };
    }
    if (
      input.classifierResult !== "resume_training" &&
      input.classifierResult !== "health_issue_resolved"
    ) {
      return {
        decision: "refused",
        reason: "Terminal resolve requires explicit resume_training or health_issue_resolved evidence.",
      };
    }
  }

  const currentDisplay = resolveSignalDisplaySummary(signal);
  if (currentDisplay === input.proposedDisplaySummary && input.proposedLifecycleTarget === "display_refresh_only") {
    return {
      decision: "refused",
      reason: "Display summary already matches proposed update; no refresh needed.",
    };
  }

  return { decision: "allowed", reason: "Recovery episode update is allowed for guarded apply." };
}

export function buildRecoveryEpisodeUpdateMeta(input: {
  observationId: string;
  observationObservedAt: string;
  classifierResult: RecoveryEpisodeClassifierResult;
  evidenceKind: RecoveryEpisodeEvidenceKind;
  previousDisplaySummary: string | null;
  updatedDisplaySummary: string;
  appliedAt: string;
  dryRunFingerprint: string;
  targetAction: RecoveryEpisodeTargetAction;
  lifecycleBefore: OperationalSignalLifecycle | null;
  lifecycleAfter: OperationalSignalLifecycle | null;
  actor?: string;
  source?: string;
}): RecoveryEpisodeUpdateMeta {
  return {
    source_observation_id: input.observationId,
    source_observation_at: input.observationObservedAt,
    classifier_result: input.classifierResult,
    recovery_evidence_kind: input.evidenceKind,
    previous_display_summary: input.previousDisplaySummary,
    updated_display_summary: input.updatedDisplaySummary,
    updated_at: input.appliedAt,
    actor: input.actor ?? "coach",
    source: input.source ?? "guarded_recovery_episode_update_v1",
    dry_run_fingerprint: input.dryRunFingerprint,
    target_action: input.targetAction,
    lifecycle_before: input.lifecycleBefore,
    lifecycle_after: input.lifecycleAfter,
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
