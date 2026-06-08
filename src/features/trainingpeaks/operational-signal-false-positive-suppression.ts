import { createHash } from "node:crypto";

import {
  classifyCoachOperationalSignal,
  classifyCoachOperationalSignals,
  type ObservationLike,
  type OperationalClassification,
} from "@/features/trainingpeaks/coach-operational-signals";
import type {
  TrainingPeaksStudentOperationalSignal,
  TrainingPeaksTelegramContextObservation,
} from "@/features/trainingpeaks/repository";
import { resolveSignalDisplaySummary } from "@/features/trainingpeaks/operational-signal-supersede-apply";

export type FalsePositiveSuppressionReason =
  | "negated_pain_cue"
  | "figurative_idiom"
  | "quoted_idiom"
  | "manual_review";

export type FalsePositiveSuppressionDecision = "allowed" | "refused";

const FIGURATIVE_HEALTH_PHRASES = [
  "душа болит",
  "душа не болит",
  "душа просит",
  "минутка слабости",
  "момент слабости",
  "минутная слабость",
  "слабость была минутка",
] as const;

const QUOTED_IDIOM_PATTERNS = [/["«»][^"«»]*минут(?:ка|очк[ау])\s+слабости[^"«»]*["«»]/iu, /["«»][^"«»]*момент\s+слабости[^"«»]*["«»]/iu];

const NEGATED_PAIN_PATTERNS = [
  /(?:^|[^\p{L}])не\s+(?:\S+\s+){0,3}болел(?:а|о|и)?(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])ничего\s+не\s+(?:\S+\s+){0,2}болел(?:а|о|и)?(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])без\s+боли(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])боли\s+нет(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])боль\s+нет(?:\s|$|[^\p{L}])/iu,
] as const;

const ELIGIBLE_FALSE_POSITIVE_SIGNAL_TYPES = new Set(["health_issue_started"]);

export function normalizeFalsePositiveSuppressionReason(
  reason: string
): FalsePositiveSuppressionReason | null {
  const normalized = reason.trim().toLowerCase().replace(/\s+/gu, "_");
  if (normalized === "negated_pain_cue" || normalized.includes("negated_pain")) {
    return "negated_pain_cue";
  }
  if (normalized === "figurative_idiom" || normalized.includes("figurative")) {
    return "figurative_idiom";
  }
  if (normalized === "quoted_idiom" || normalized.includes("quoted")) {
    return "quoted_idiom";
  }
  if (normalized === "manual_review" || normalized.includes("manual")) {
    return "manual_review";
  }
  return null;
}

export function hashSourceText(text: string | null): string {
  return createHash("sha256").update((text ?? "").trim()).digest("hex");
}

export function inferFalsePositiveSuppressionReason(text: string | null): FalsePositiveSuppressionReason | null {
  const normalized = (text ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (QUOTED_IDIOM_PATTERNS.some((pattern) => pattern.test(text ?? ""))) {
    return "quoted_idiom";
  }
  if (FIGURATIVE_HEALTH_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return "figurative_idiom";
  }
  if (NEGATED_PAIN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "negated_pain_cue";
  }
  return null;
}

export function buildObservationLikeFromContextObservation(
  observation: TrainingPeaksTelegramContextObservation
): ObservationLike {
  return {
    studentId: observation.studentId,
    sourceType: observation.sourceType,
    textPreview: observation.textPreview,
    labels: observation.labels,
    metadata: observation.metadata,
    observedAt: observation.observedAt,
  };
}

export function classifySourceForFalsePositiveSuppression(
  observation: TrainingPeaksTelegramContextObservation
): OperationalClassification {
  return classifyCoachOperationalSignal(buildObservationLikeFromContextObservation(observation));
}

export function wouldCreateHealthIssueSignal(
  observation: TrainingPeaksTelegramContextObservation
): boolean {
  const input = buildObservationLikeFromContextObservation(observation);
  const candidates = classifyCoachOperationalSignals(input);
  return candidates.some((candidate) => candidate.signal_type === "health_issue_started");
}

export function isClassifierEligibleForFalsePositiveSuppression(
  observation: TrainingPeaksTelegramContextObservation
): boolean {
  return !wouldCreateHealthIssueSignal(observation);
}

export function getFalsePositiveSuppressionMetaFromSignal(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "lifecycleMeta">
): Record<string, unknown> | null {
  const meta = signal.lifecycleMeta.false_positive_suppression;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

export function isAlreadyFalsePositiveSuppressed(
  signal: TrainingPeaksStudentOperationalSignal,
  dryRunFingerprint: string
): boolean {
  if (signal.lifecycleState !== "resolved") {
    return false;
  }
  const suppressionMeta = getFalsePositiveSuppressionMetaFromSignal(signal);
  if (!suppressionMeta) {
    return false;
  }
  return suppressionMeta.dry_run_fingerprint === dryRunFingerprint;
}

export type FalsePositiveSuppressionDryRunFingerprintInput = {
  signalId: string;
  sourceObservationId: string;
  studentId: string;
  signalType: string;
  lifecycleState: string | null;
  displaySummary: string | null;
  sourceTextHash: string;
  reason: FalsePositiveSuppressionReason;
  classifierPrimaryBucket: string;
  asOfDate: string;
};

export function buildFalsePositiveSuppressionDryRunFingerprint(
  input: FalsePositiveSuppressionDryRunFingerprintInput
): string {
  const canonicalPayload = {
    signal_id: input.signalId,
    source_observation_id: input.sourceObservationId,
    student_id: input.studentId,
    signal_type: input.signalType,
    lifecycle_state: input.lifecycleState,
    display_summary: input.displaySummary,
    source_text_hash: input.sourceTextHash,
    reason: input.reason,
    classifier_primary_bucket: input.classifierPrimaryBucket,
    as_of: input.asOfDate,
  };
  return createHash("sha256").update(stableStringify(canonicalPayload)).digest("hex");
}

export function buildFalsePositiveSuppressionApplyToken(input: {
  signalId: string;
  sourceObservationId: string;
  dryRunFingerprint: string;
}): string {
  return `SUPPRESS_FALSE_POSITIVE_SIGNAL:${input.signalId}:${input.sourceObservationId}:${input.dryRunFingerprint}`;
}

export function parseFalsePositiveSuppressionApplyToken(
  token: string
): { signalId: string; sourceObservationId: string; dryRunFingerprint: string } | null {
  const normalized = token.trim();
  const match = normalized.match(/^SUPPRESS_FALSE_POSITIVE_SIGNAL:([^:]+):([^:]+):([a-f0-9]{64})$/u);
  if (!match) {
    return null;
  }
  return {
    signalId: match[1]!,
    sourceObservationId: match[2]!,
    dryRunFingerprint: match[3]!,
  };
}

export function buildFalsePositiveSuppressionMeta(input: {
  sourceObservationId: string;
  sourceObservationAt: string;
  sourceText: string | null;
  reason: FalsePositiveSuppressionReason;
  previousDisplaySummary: string | null;
  classifierAfterFix: string;
  dryRunFingerprint: string;
  suppressedAt: string;
}): Record<string, unknown> {
  return {
    source_observation_id: input.sourceObservationId,
    source_observation_at: input.sourceObservationAt,
    source_text_hash: hashSourceText(input.sourceText),
    reason: input.reason,
    previous_display_summary: input.previousDisplaySummary,
    classifier_after_fix: input.classifierAfterFix,
    actor: "coach",
    source: "guarded_false_positive_suppression_v1",
    dry_run_fingerprint: input.dryRunFingerprint,
    suppressed_at: input.suppressedAt,
  };
}

export function validateFalsePositiveSuppressionSafety(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  observation: TrainingPeaksTelegramContextObservation;
  sourceObservationId: string;
  reason: FalsePositiveSuppressionReason;
  classification: OperationalClassification;
  dryRunFingerprint: string;
}): { decision: FalsePositiveSuppressionDecision; reason: string } {
  const { signal, observation, sourceObservationId, reason, classification, dryRunFingerprint } = input;

  if (!ELIGIBLE_FALSE_POSITIVE_SIGNAL_TYPES.has(signal.signalType)) {
    return {
      decision: "refused",
      reason: `Signal type ${signal.signalType} is not eligible for false-positive health suppression.`,
    };
  }

  if (signal.sourceObservationId !== sourceObservationId) {
    return {
      decision: "refused",
      reason: `Signal source observation mismatch: signal=${signal.sourceObservationId ?? "null"} expected=${sourceObservationId}`,
    };
  }
  if (observation.id !== sourceObservationId) {
    return {
      decision: "refused",
      reason: "Loaded observation id does not match --source-observation-id.",
    };
  }
  if (observation.studentId && observation.studentId !== signal.studentId) {
    return {
      decision: "refused",
      reason: `Student mismatch between signal and observation: signal=${signal.studentId} observation=${observation.studentId}`,
    };
  }

  if (isAlreadyFalsePositiveSuppressed(signal, dryRunFingerprint)) {
    return {
      decision: "allowed",
      reason: "Signal already suppressed with matching dry-run fingerprint; apply may be idempotent.",
    };
  }

  if (signal.lifecycleState === "resolved") {
    const existingReason = signal.resolvedReason ?? "";
    if (existingReason.startsWith("false_positive:")) {
      return {
        decision: "refused",
        reason: "Signal is already resolved as false positive with a different fingerprint.",
      };
    }
    return {
      decision: "refused",
      reason: "Signal is already resolved for another reason; false-positive suppression is blocked.",
    };
  }

  if (!isClassifierEligibleForFalsePositiveSuppression(observation)) {
    return {
      decision: "refused",
      reason: `Current classifier would still create health_issue_started from this source text (bucket=${classification.primary_bucket}, signal_type=${classification.signal_type ?? "null"}).`,
    };
  }

  const inferredReason = inferFalsePositiveSuppressionReason(observation.textPreview);
  if (reason !== "manual_review") {
    if (!inferredReason) {
      return {
        decision: "refused",
        reason: "Could not infer a known false-positive reason from source text; use manual_review only after explicit review.",
      };
    }
    if (inferredReason !== reason) {
      return {
        decision: "refused",
        reason: `Requested reason ${reason} does not match inferred reason ${inferredReason}.`,
      };
    }
  }

  return {
    decision: "allowed",
    reason: "False-positive suppression is allowed for this health signal and source observation.",
  };
}

export function resolveClassifierAfterFixLabel(classification: OperationalClassification): string {
  if (classification.primary_bucket === "skip" && !classification.signal_type) {
    return "skip";
  }
  return `${classification.primary_bucket}:${classification.signal_type ?? "null"}`;
}

export function resolvePreviousDisplaySummary(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "structuredPayload" | "metadata">
): string | null {
  return resolveSignalDisplaySummary(signal);
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
