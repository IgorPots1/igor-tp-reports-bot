import { hasUntrustedMoveSourceInferencePreview } from "@/features/trainingpeaks/move-source-inference-preview";
import { hasIntervalDescriptorPattern } from "@/features/trainingpeaks/workout-reference";

export const TRUSTED_MOVE_SOURCE_POLICIES = new Set([
  "explicit_source_date",
  "explicit_source_ref",
  "coach_confirmed_source_date",
]);

export const STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY = "strong_future_descriptor_match";

export const STRONG_FUTURE_DESCRIPTOR_EXECUTION_CONFIDENCE_THRESHOLD = 0.7;

export const DEFAULT_DRY_RUN_EXECUTION_CONFIDENCE_THRESHOLD = 0.8;

export const EXECUTABLE_MOVE_SOURCE_POLICIES = new Set([
  ...TRUSTED_MOVE_SOURCE_POLICIES,
  STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY,
]);

export const INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON =
  "source date inferred; real execution blocked";

export const INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU =
  "Источник тренировки определён автоматически/неявно — выполнение заблокировано. Уточните исходную дату.";

export type StrongFutureSourceInferenceProvenance = {
  descriptorType?: unknown;
  sourceInferencePolicy?: unknown;
  selectedSourceDate?: unknown;
  targetDate?: unknown;
  candidate?: {
    title?: unknown;
    type?: unknown;
    date?: unknown;
    fingerprint?: unknown;
  } | null;
  candidateCount?: unknown;
  candidateAlternativesCount?: unknown;
  score?: unknown;
  margin?: unknown;
};

export type ValidateStrongFutureDescriptorMoveSourceInput = {
  selectedSourceDatePolicy: string | null | undefined;
  parsedPayload?: unknown;
  resolvedSourceDate: string | null | undefined;
  resolvedTargetDate: string | null | undefined;
  candidateFingerprint: string | null | undefined;
  candidateTitle: string | null | undefined;
  candidateType?: string | null | undefined;
  sourceInferenceProvenance: StrongFutureSourceInferenceProvenance | null | undefined;
  confidence: number | null | undefined;
  identityMatchedBy: string | null | undefined;
  candidateAlternativesCount?: number | null | undefined;
};

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumericConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractCoachConfirmedSourceDate(parsedPayload: unknown): string | null {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }
  const value = (parsedPayload as { coach_confirmed_source_date?: unknown }).coach_confirmed_source_date;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBlockedOnlyByInferredSourceReasons(canExecuteReasons: unknown): boolean {
  if (!Array.isArray(canExecuteReasons) || canExecuteReasons.length === 0) {
    return false;
  }
  const normalized = canExecuteReasons
    .map((item) => trimOrNull(item))
    .filter((item): item is string => Boolean(item));
  if (normalized.length === 0) {
    return false;
  }
  return normalized.every(
    (reason) =>
      reason === INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON ||
      reason === INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU
  );
}

function shouldAllowCoachConfirmedSourceDateReadinessBypass(
  logJson: unknown,
  parsedPayload: unknown
): boolean {
  if (!logJson || typeof logJson !== "object") {
    return false;
  }

  const confirmedSourceDate = extractCoachConfirmedSourceDate(parsedPayload);
  if (!confirmedSourceDate) {
    return false;
  }

  const payload = logJson as {
    dryRunResult?: unknown;
    canExecute?: unknown;
    canExecuteReasons?: unknown;
    selectedSourceDate?: unknown;
    resolvedDates?: { sourceDate?: unknown } | null;
  };
  if (payload.dryRunResult !== "candidate_found") {
    return false;
  }
  if (payload.canExecute !== false) {
    return false;
  }
  if (!isBlockedOnlyByInferredSourceReasons(payload.canExecuteReasons)) {
    return false;
  }

  const selectedSourceDate = trimOrNull(payload.selectedSourceDate);
  const resolvedSourceDate = trimOrNull(payload.resolvedDates?.sourceDate) ?? selectedSourceDate;
  if (!resolvedSourceDate || resolvedSourceDate !== confirmedSourceDate) {
    return false;
  }
  if (selectedSourceDate && selectedSourceDate !== confirmedSourceDate) {
    return false;
  }

  const policy = getSelectedSourceDatePolicyFromDryRunLog(logJson);
  if (!policy || isTrustedMoveSourcePolicy(policy)) {
    return false;
  }

  return true;
}

export function isTrustedMoveSourcePolicy(policy: string | null | undefined): boolean {
  return typeof policy === "string" && TRUSTED_MOVE_SOURCE_POLICIES.has(policy);
}

export function isExecutableMoveSourcePolicy(policy: string | null | undefined): boolean {
  return typeof policy === "string" && EXECUTABLE_MOVE_SOURCE_POLICIES.has(policy);
}

export function hasExplicitMoveSourceInParsedPayload(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }

  if (hasUntrustedMoveSourceInferencePreview(parsedPayload)) {
    return false;
  }

  const payload = parsedPayload as Record<string, unknown>;
  const sourceDateCandidates = [payload.sourceDate, payload.source_date];
  for (const candidate of sourceDateCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return true;
    }
  }

  const source = payload.source;
  if (!source || typeof source !== "object") {
    return false;
  }

  const sourceRecord = source as Record<string, unknown>;
  const kind = sourceRecord.kind;
  if (kind !== "date" && kind !== "relative_day" && kind !== "weekday") {
    return false;
  }

  const value = sourceRecord.value;
  return typeof value === "string" && value.trim().length > 0;
}

export function isMoveSourceExplicitEnough(input: {
  selectedSourceDatePolicy: string | null | undefined;
  parsedPayload: unknown;
}): boolean {
  return (
    isTrustedMoveSourcePolicy(input.selectedSourceDatePolicy) &&
    hasExplicitMoveSourceInParsedPayload(input.parsedPayload)
  );
}

export function getSelectedSourceDatePolicyFromDryRunLog(logJson: unknown): string | null {
  if (!logJson || typeof logJson !== "object") {
    return null;
  }
  const policy = (logJson as { selectedSourceDatePolicy?: unknown }).selectedSourceDatePolicy;
  return typeof policy === "string" && policy.trim() ? policy.trim() : null;
}

export function extractMoveSourceExecutionContextFromDryRunLog(logJson: unknown): Omit<
  ValidateStrongFutureDescriptorMoveSourceInput,
  "selectedSourceDatePolicy" | "parsedPayload"
> | null {
  if (!logJson || typeof logJson !== "object") {
    return null;
  }

  const payload = logJson as {
    resolvedDates?: { sourceDate?: unknown; targetDate?: unknown } | null;
    candidate?: { fingerprint?: unknown; title?: unknown; type?: unknown } | null;
    sourceInferenceProvenance?: StrongFutureSourceInferenceProvenance | null;
    confidence?: unknown;
    identityCheck?: { matchedBy?: unknown } | null;
    candidateAlternativesCount?: unknown;
  };

  return {
    resolvedSourceDate: trimOrNull(payload.resolvedDates?.sourceDate),
    resolvedTargetDate: trimOrNull(payload.resolvedDates?.targetDate),
    candidateFingerprint: trimOrNull(payload.candidate?.fingerprint),
    candidateTitle: trimOrNull(payload.candidate?.title),
    candidateType: trimOrNull(payload.candidate?.type),
    sourceInferenceProvenance: payload.sourceInferenceProvenance ?? null,
    confidence: toNumericConfidence(payload.confidence),
    identityMatchedBy:
      typeof payload.identityCheck?.matchedBy === "string" ? payload.identityCheck.matchedBy : null,
    candidateAlternativesCount:
      typeof payload.candidateAlternativesCount === "number" &&
      Number.isFinite(payload.candidateAlternativesCount)
        ? payload.candidateAlternativesCount
        : null,
  };
}

function isLiveStrongFutureDescriptorProvenanceMissingOrIncomplete(
  input: ValidateStrongFutureDescriptorMoveSourceInput
): boolean {
  const provenance = input.sourceInferenceProvenance;
  if (!provenance || typeof provenance !== "object") {
    return true;
  }

  if (provenance.sourceInferencePolicy !== STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    return true;
  }
  if (provenance.descriptorType !== "interval") {
    return true;
  }
  if (provenance.candidateCount !== 1) {
    return true;
  }

  const provenanceAlternativesCount = provenance.candidateAlternativesCount;
  if (
    typeof provenanceAlternativesCount === "number" &&
    Number.isFinite(provenanceAlternativesCount) &&
    provenanceAlternativesCount !== 0
  ) {
    return true;
  }

  const sourceDate = trimOrNull(input.resolvedSourceDate);
  const fingerprint = trimOrNull(input.candidateFingerprint);
  const candidateTitle = trimOrNull(input.candidateTitle);
  const provenanceCandidate = provenance.candidate;
  if (!provenanceCandidate || typeof provenanceCandidate !== "object") {
    return true;
  }

  const provenanceCandidateDate = trimOrNull(provenanceCandidate.date);
  if (!sourceDate || provenanceCandidateDate !== sourceDate) {
    return true;
  }

  const provenanceCandidateTitle = trimOrNull(provenanceCandidate.title);
  const intervalTitle = provenanceCandidateTitle ?? candidateTitle;
  if (!intervalTitle || !hasIntervalDescriptorPattern(intervalTitle)) {
    return true;
  }

  const provenanceFingerprint = trimOrNull(provenanceCandidate.fingerprint);
  if (!provenanceFingerprint && !provenanceCandidateTitle) {
    return true;
  }
  if (provenanceFingerprint && fingerprint && provenanceFingerprint !== fingerprint) {
    return true;
  }

  return false;
}

export function getStrongFutureDescriptorExecutionConfidence(
  input: ValidateStrongFutureDescriptorMoveSourceInput
): number | null {
  const provenanceScore = toNumericConfidence(input.sourceInferenceProvenance?.score);
  if (provenanceScore !== null) {
    return provenanceScore;
  }
  return toNumericConfidence(input.confidence);
}

export function isStrongFutureDescriptorLiveProvenanceComplete(
  input: ValidateStrongFutureDescriptorMoveSourceInput
): boolean {
  if (input.selectedSourceDatePolicy !== STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    return false;
  }

  return validateStrongFutureDescriptorMoveSourceForExecution(input).ok;
}

export function validateStrongFutureDescriptorMoveSourceForExecution(
  input: ValidateStrongFutureDescriptorMoveSourceInput
): { ok: true } | { ok: false; reason: string } {
  if (input.selectedSourceDatePolicy !== STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    return { ok: false, reason: "Move source policy is not strong_future_descriptor_match." };
  }

  if (
    hasUntrustedMoveSourceInferencePreview(input.parsedPayload) &&
    isLiveStrongFutureDescriptorProvenanceMissingOrIncomplete(input)
  ) {
    return { ok: false, reason: "Cache preview alone cannot make execution trusted." };
  }

  const sourceDate = trimOrNull(input.resolvedSourceDate);
  const targetDate = trimOrNull(input.resolvedTargetDate);
  const fingerprint = trimOrNull(input.candidateFingerprint);
  const candidateTitle = trimOrNull(input.candidateTitle);

  if (!sourceDate) {
    return { ok: false, reason: "Resolved source date is missing." };
  }
  if (!targetDate) {
    return { ok: false, reason: "Resolved target date is missing." };
  }
  if (!fingerprint) {
    return { ok: false, reason: "Candidate fingerprint is missing." };
  }
  if (!candidateTitle) {
    return { ok: false, reason: "Candidate title is missing." };
  }

  const provenance = input.sourceInferenceProvenance;
  if (!provenance || typeof provenance !== "object") {
    return { ok: false, reason: "Source inference provenance is missing." };
  }

  if (provenance.sourceInferencePolicy !== STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    return { ok: false, reason: "Source inference provenance policy mismatch." };
  }
  if (provenance.descriptorType !== "interval") {
    return { ok: false, reason: "Strong move source requires interval descriptor." };
  }
  if (provenance.candidateCount !== 1) {
    return { ok: false, reason: "Strong move source requires exactly one interval candidate." };
  }

  const provenanceAlternativesCount = provenance.candidateAlternativesCount;
  if (
    typeof provenanceAlternativesCount === "number" &&
    Number.isFinite(provenanceAlternativesCount) &&
    provenanceAlternativesCount !== 0
  ) {
    return { ok: false, reason: "Strong move source requires zero candidate alternatives." };
  }

  const provenanceCandidate = provenance.candidate;
  if (!provenanceCandidate || typeof provenanceCandidate !== "object") {
    return { ok: false, reason: "Provenance candidate snapshot is missing." };
  }

  const provenanceCandidateDate = trimOrNull(provenanceCandidate.date);
  if (provenanceCandidateDate !== sourceDate) {
    return { ok: false, reason: "Provenance candidate date does not match resolved source date." };
  }

  const provenanceCandidateTitle = trimOrNull(provenanceCandidate.title);
  const intervalTitle = provenanceCandidateTitle ?? candidateTitle;
  if (!hasIntervalDescriptorPattern(intervalTitle)) {
    return { ok: false, reason: "Selected candidate does not match interval descriptor." };
  }

  const provenanceSourceDate = trimOrNull(provenance.selectedSourceDate);
  if (provenanceSourceDate && provenanceSourceDate !== sourceDate) {
    return { ok: false, reason: "Provenance source date mismatch." };
  }

  const provenanceTargetDate = trimOrNull(provenance.targetDate);
  if (provenanceTargetDate && provenanceTargetDate !== targetDate) {
    return { ok: false, reason: "Provenance target date mismatch." };
  }

  const provenanceFingerprint = trimOrNull(provenanceCandidate.fingerprint);
  if (provenanceFingerprint && provenanceFingerprint !== fingerprint) {
    return { ok: false, reason: "Provenance candidate fingerprint mismatch." };
  }

  const executionConfidence = getStrongFutureDescriptorExecutionConfidence(input);
  if (
    executionConfidence === null ||
    executionConfidence < STRONG_FUTURE_DESCRIPTOR_EXECUTION_CONFIDENCE_THRESHOLD
  ) {
    return {
      ok: false,
      reason: `Dry-run confidence is below ${STRONG_FUTURE_DESCRIPTOR_EXECUTION_CONFIDENCE_THRESHOLD}.`,
    };
  }

  if (input.identityMatchedBy === "mismatch") {
    return { ok: false, reason: "Athlete identity check mismatch." };
  }

  const candidateAlternativesCount = input.candidateAlternativesCount;
  if (
    typeof candidateAlternativesCount === "number" &&
    Number.isFinite(candidateAlternativesCount) &&
    candidateAlternativesCount > 0
  ) {
    return { ok: false, reason: "Dry-run has multiple candidate alternatives." };
  }

  return { ok: true };
}

export function validateMoveSourceForExecution(input: {
  selectedSourceDatePolicy: string | null | undefined;
  parsedPayload: unknown;
  dryRunLog?: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const policy =
    typeof input.selectedSourceDatePolicy === "string" && input.selectedSourceDatePolicy.trim()
      ? input.selectedSourceDatePolicy.trim()
      : null;

  if (isMoveSourceExplicitEnough({ selectedSourceDatePolicy: policy, parsedPayload: input.parsedPayload })) {
    return { ok: true };
  }

  if (policy === STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    const context = input.dryRunLog ? extractMoveSourceExecutionContextFromDryRunLog(input.dryRunLog) : null;
    if (!context) {
      if (hasUntrustedMoveSourceInferencePreview(input.parsedPayload)) {
        return { ok: false, reason: "Cache preview alone cannot make execution trusted." };
      }
      return { ok: false, reason: "Strong inferred move source dry-run provenance is incomplete." };
    }
    return validateStrongFutureDescriptorMoveSourceForExecution({
      selectedSourceDatePolicy: policy,
      parsedPayload: input.parsedPayload,
      ...context,
    });
  }

  if (policy === "coach_confirmed_source_date") {
    const parsedPayload =
      input.parsedPayload && typeof input.parsedPayload === "object" ? (input.parsedPayload as Record<string, unknown>) : null;
    const confirmedSourceDate =
      parsedPayload && typeof parsedPayload.coach_confirmed_source_date === "string"
        ? parsedPayload.coach_confirmed_source_date.trim()
        : "";
    if (!confirmedSourceDate) {
      return { ok: false, reason: "Coach-confirmed source date is missing in parsed payload." };
    }
    const context = input.dryRunLog ? extractMoveSourceExecutionContextFromDryRunLog(input.dryRunLog) : null;
    if (!context?.resolvedSourceDate) {
      return { ok: false, reason: "Dry-run source date is missing for coach-confirmed policy." };
    }
    if (context.resolvedSourceDate !== confirmedSourceDate) {
      return { ok: false, reason: "Coach-confirmed source date does not match dry-run source date." };
    }
    return { ok: true };
  }

  if (!isTrustedMoveSourcePolicy(policy)) {
    return { ok: false, reason: INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU };
  }

  return {
    ok: false,
    reason: "Dry-run move source is not explicit enough in parsed payload.",
  };
}

export function validateDryRunLogReadiness(
  logJson: unknown,
  parsedPayload?: unknown
): { ok: true } | { ok: false; reason: string } {
  if (!logJson || typeof logJson !== "object") {
    return { ok: false, reason: "Dry-run log not found." };
  }

  const payload = logJson as {
    dryRunResult?: unknown;
    canExecute?: unknown;
    candidate?: { fingerprint?: unknown } | null;
    confidence?: unknown;
    resolvedDates?: { sourceDate?: unknown; targetDate?: unknown } | null;
    identityCheck?: { matchedBy?: unknown } | null;
  };

  if (payload.dryRunResult !== "candidate_found") {
    return { ok: false, reason: "Dry-run did not find a unique candidate." };
  }
  const allowCoachConfirmedBypass = shouldAllowCoachConfirmedSourceDateReadinessBypass(
    logJson,
    parsedPayload ?? null
  );
  if (payload.canExecute !== true && !allowCoachConfirmedBypass) {
    return { ok: false, reason: "Dry-run marked action as unsafe for execution." };
  }

  const fingerprint = payload.candidate?.fingerprint;
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    return { ok: false, reason: "Dry-run candidate fingerprint is missing." };
  }

  const sourceDate = trimOrNull(payload.resolvedDates?.sourceDate);
  const targetDate = trimOrNull(payload.resolvedDates?.targetDate);
  if (!sourceDate || !targetDate) {
    return { ok: false, reason: "Resolved source or target date is missing." };
  }

  const identityMatchedBy =
    typeof payload.identityCheck?.matchedBy === "string" ? payload.identityCheck.matchedBy : null;
  if (!identityMatchedBy || identityMatchedBy === "mismatch") {
    return { ok: false, reason: "Athlete identity check is missing or mismatched." };
  }

  const policyFromLog = getSelectedSourceDatePolicyFromDryRunLog(logJson);
  const policy = allowCoachConfirmedBypass ? "coach_confirmed_source_date" : policyFromLog;
  const moveSourceValidation = validateMoveSourceForExecution({
    selectedSourceDatePolicy: policy,
    parsedPayload: parsedPayload ?? null,
    dryRunLog: logJson,
  });
  if (!moveSourceValidation.ok) {
    return { ok: false, reason: moveSourceValidation.reason };
  }

  if (policy !== STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    const confidence = toNumericConfidence(payload.confidence);
    if (confidence === null || confidence < DEFAULT_DRY_RUN_EXECUTION_CONFIDENCE_THRESHOLD) {
      return {
        ok: false,
        reason: `Dry-run confidence is below ${DEFAULT_DRY_RUN_EXECUTION_CONFIDENCE_THRESHOLD}.`,
      };
    }
  }

  return { ok: true };
}
