function extractMoveDateRangeFromParsedPayload(
  parsedPayload: unknown
): { sourceDate: string | null; targetDate: string | null } {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return { sourceDate: null, targetDate: null };
  }
  const payload = parsedPayload as {
    source?: { kind?: string; value?: string };
    target?: { kind?: string; value?: string };
    sourceDate?: string;
    source_date?: string;
  };
  const sourceDate =
    payload.sourceDate ??
    payload.source_date ??
    (payload.source?.kind === "date" && typeof payload.source.value === "string" ? payload.source.value : null);
  const targetDate =
    payload.target?.kind === "date" && typeof payload.target.value === "string" ? payload.target.value : null;
  return {
    sourceDate: sourceDate ?? null,
    targetDate: targetDate ?? null,
  };
}

export function formatCompactCoachDateShort(value: string | null): string {
  if (!value) {
    return "?";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[3]}.${match[2]}`;
}

export function formatActionMoveRouteForCoach(
  parsedPayload: unknown,
  options?: { sourceDate?: string | null; targetDate?: string | null }
): string {
  const parsedDates = extractMoveDateRangeFromParsedPayload(parsedPayload);
  const sourceDate = options?.sourceDate ?? parsedDates.sourceDate;
  const targetDate = options?.targetDate ?? parsedDates.targetDate;
  return `${formatCompactCoachDateShort(sourceDate)} → ${formatCompactCoachDateShort(targetDate)}`;
}

export function formatTrainingPeaksExecuteQueuedMessage(input: {
  studentName?: string | null;
  parsedPayload: unknown;
  trustedSourceDate?: string | null;
  trustedTargetDate?: string | null;
}): string {
  const route = formatActionMoveRouteForCoach(input.parsedPayload, {
    sourceDate: input.trustedSourceDate,
    targetDate: input.trustedTargetDate,
  });
  const studentName = input.studentName?.trim();
  if (studentName) {
    return `✅ Перенос поставлен в очередь. ${studentName}: ${route}.`;
  }
  return `✅ Перенос поставлен в очередь. ${route}.`;
}
