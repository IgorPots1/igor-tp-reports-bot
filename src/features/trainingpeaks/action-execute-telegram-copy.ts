import {
  formatCoachActionReasonForDisplay,
  translateCoachActionTechnicalReason,
} from "@/features/trainingpeaks/action-list-telegram-copy";

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

export function formatTrainingPeaksExecuteQueuedMessage(input?: {
  studentName?: string | null;
  parsedPayload?: unknown;
  trustedSourceDate?: string | null;
  trustedTargetDate?: string | null;
}): string {
  const lines = [
    "✅ Выполнение поставлено в очередь.",
    "TrainingPeaks пока не изменён.",
    "",
    "Теперь запусти runner, чтобы перенести тренировку.",
  ];

  if (input?.studentName || input?.parsedPayload) {
    const route = formatActionMoveRouteForCoach(input.parsedPayload ?? {}, {
      sourceDate: input.trustedSourceDate,
      targetDate: input.trustedTargetDate,
    });
    const studentName = input.studentName?.trim();
    if (studentName) {
      lines.splice(1, 0, `${studentName}: ${route}.`);
    } else if (route !== "? → ?") {
      lines.splice(1, 0, `${route}.`);
    }
  }

  return lines.join("\n");
}

export function formatTrainingPeaksExecuteBlockedMessage(input: {
  reason?: string | null;
  latestRunContext?: unknown;
}): string {
  const reason = input.reason?.trim() ?? "";

  if (
    reason === "Trusted dry-run run is missing." ||
    reason === "Dry-run log not found." ||
    /dry-run run is missing/i.test(reason)
  ) {
    return "Перенос не поставлен на выполнение: последняя проверка не найдена.";
  }

  if (reason === "Dry-run is not completed yet.") {
    return "Перенос не поставлен на выполнение: проверка ещё не завершена.";
  }

  if (reason === "Action is not approved.") {
    return "Перенос не поставлен на выполнение: заявка не подтверждена.";
  }

  if (/state changed/i.test(reason)) {
    return "Перенос не поставлен на выполнение: заявка не перешла в execute_pending.";
  }

  if (reason) {
    const translated = translateCoachActionTechnicalReason(reason);
    if (translated !== "нужна ручная проверка") {
      return `Перенос не поставлен на выполнение: последняя проверка не разрешает выполнение (${translated}).`;
    }
    return "Перенос не поставлен на выполнение: последняя проверка не разрешает выполнение.";
  }

  const displayReason = formatCoachActionReasonForDisplay(input.latestRunContext);
  if (displayReason !== "нужна ручная проверка") {
    return `Перенос не поставлен на выполнение: ${displayReason}.`;
  }

  return "Перенос не поставлен на выполнение: последняя проверка не разрешает выполнение.";
}
