import {
  formatCoachActionReasonForDisplay,
  translateCoachActionTechnicalReason,
} from "@/features/trainingpeaks/action-list-telegram-copy";
import {
  formatTpActionsExecuteOnceCommand,
  TP_ACTIONS_USE_API_MOVE_ENV,
} from "@/features/trainingpeaks/action-runner-commands";

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
  const executeCommand = formatTpActionsExecuteOnceCommand();
  const lines = [
    "✅ Выполнение поставлено в очередь.",
    "TrainingPeaks пока не изменён.",
    "",
    "Теперь запусти:",
    executeCommand,
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

export function formatTrainingPeaksExecuteResultMessage(input: {
  studentName: string;
  route: string;
  errorMessage: string;
}): string {
  const message = input.errorMessage.trim();

  if (message.includes("verification passed")) {
    return `✅ Перенос выполнен. ${input.studentName}: ${input.route}. Проверка после переноса пройдена.`;
  }

  if (message.includes("verification failed") || message.includes("manual review required")) {
    return `⚠️ Перенос не подтверждён. ${input.studentName}: ${input.route}. Нужна ручная проверка.`;
  }

  if (message.startsWith("Revalidation failed:")) {
    return `⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}. Повторная проверка не совпала с dry-run. TrainingPeaks не изменён. Проверь заявку в /tp_actions.`;
  }

  if (
    message.includes("API move gate closed") ||
    message.includes(`${TP_ACTIONS_USE_API_MOVE_ENV}=true`) ||
    message.includes("API move gate is closed")
  ) {
    return `⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}. API move выключен. TrainingPeaks не изменён. Запусти: ${formatTpActionsExecuteOnceCommand()}`;
  }

  if (message.includes("Real move not implemented")) {
    return `⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}. Реальный перенос через UI отключён. TrainingPeaks не изменён. Проверь заявку в /tp_actions.`;
  }

  if (message.includes("API move PUT failed")) {
    return `⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}. TrainingPeaks API вернул ошибку. TrainingPeaks не изменён. Проверь заявку в /tp_actions.`;
  }

  if (message.includes("API move sent but verification failed")) {
    return `⚠️ Перенос не подтверждён. ${input.studentName}: ${input.route}. TrainingPeaks изменён, но проверка после переноса не прошла. Нужна ручная проверка.`;
  }

  if (message.includes("API move failed or could not be verified")) {
    return `⚠️ Перенос не подтверждён. ${input.studentName}: ${input.route}. Перенос не подтверждён автоматической проверкой. Нужна ручная проверка.`;
  }

  if (message) {
    return `⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}. ${message} TrainingPeaks не изменён. Проверь заявку в /tp_actions.`;
  }

  return `⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}. TrainingPeaks не изменён. Проверь заявку в /tp_actions.`;
}
