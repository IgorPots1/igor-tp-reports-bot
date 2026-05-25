export const TRUSTED_MOVE_SOURCE_POLICIES = new Set([
  "explicit_source_date",
  "explicit_source_ref",
]);

export const INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON =
  "source date inferred; real execution blocked";

export const INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU =
  "Источник тренировки определён автоматически/неявно — выполнение заблокировано. Уточните исходную дату.";

export function isTrustedMoveSourcePolicy(policy: string | null | undefined): boolean {
  return typeof policy === "string" && TRUSTED_MOVE_SOURCE_POLICIES.has(policy);
}

export function hasExplicitMoveSourceInParsedPayload(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
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

export function validateMoveSourceForExecution(input: {
  selectedSourceDatePolicy: string | null | undefined;
  parsedPayload: unknown;
}): { ok: true } | { ok: false; reason: string } {
  if (isMoveSourceExplicitEnough(input)) {
    return { ok: true };
  }

  if (!isTrustedMoveSourcePolicy(input.selectedSourceDatePolicy)) {
    return { ok: false, reason: INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU };
  }

  return {
    ok: false,
    reason: "Dry-run move source is not explicit enough in parsed payload.",
  };
}
