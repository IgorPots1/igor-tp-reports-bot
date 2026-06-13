import { isEligibleForCoachSourceWorkoutConfirmation } from "@/features/trainingpeaks/action-planned-completed-ambiguity";
import { validateDryRunLogReadiness } from "@/features/trainingpeaks/move-source-policy";
import type { TrainingPeaksActionRunContextSummary } from "@/features/trainingpeaks/repository";

export type ActionExecuteRetryEligibilityInput = {
  actionType: string;
  status: string;
  executionStatus: string;
  parsedPayload: unknown;
  latestRunContext?: {
    latestDryRun?: TrainingPeaksActionRunContextSummary | null;
    latestExecute?: TrainingPeaksActionRunContextSummary | null;
  } | null;
};

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isLatestDryRunExecutableForRetry(
  latestDryRun: TrainingPeaksActionRunContextSummary | null | undefined,
  parsedPayload: unknown
): boolean {
  if (!latestDryRun || latestDryRun.status !== "completed") {
    return false;
  }
  if (latestDryRun.dryRunResult !== "candidate_found") {
    return false;
  }
  if (latestDryRun.canExecute !== true) {
    return false;
  }
  if (!latestDryRun.logJson) {
    return false;
  }
  return validateDryRunLogReadiness(latestDryRun.logJson, parsedPayload).ok;
}

export function isLatestExecuteFailed(
  latestExecute: TrainingPeaksActionRunContextSummary | null | undefined,
  executionStatus: string
): boolean {
  if (executionStatus !== "failed") {
    return false;
  }
  if (!latestExecute) {
    return true;
  }
  return latestExecute.runType === "real" && latestExecute.status === "failed";
}

export function evaluateActionExecuteRetryEligibility(
  input: ActionExecuteRetryEligibilityInput
): {
  latestDryRunExecutable: boolean;
  latestExecuteFailed: boolean;
  safeToRetryExecute: boolean;
  reasonIfNo: string | null;
} {
  const latestDryRun = input.latestRunContext?.latestDryRun ?? null;
  const latestExecute = input.latestRunContext?.latestExecute ?? null;
  const latestDryRunExecutable = isLatestDryRunExecutableForRetry(latestDryRun, input.parsedPayload);
  const latestExecuteFailed = isLatestExecuteFailed(latestExecute, input.executionStatus);

  if (input.actionType !== "move_workout") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Поддерживается только для move-заявок.",
    };
  }

  if (input.status === "rejected" || input.status === "cancelled") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Заявка отменена или отклонена.",
    };
  }

  if (input.status !== "approved") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Заявка не одобрена.",
    };
  }

  if (input.executionStatus === "completed") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Заявка уже выполнена.",
    };
  }

  if (input.executionStatus === "running_local" || input.executionStatus === "execute_pending") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Заявка уже в очереди или выполняется.",
    };
  }

  if (input.executionStatus !== "failed") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Повтор доступен только после ошибки выполнения.",
    };
  }

  if (!latestDryRun || latestDryRun.status !== "completed") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Нет завершённой проверки для повторного выполнения.",
    };
  }

  if (latestDryRun.dryRunResult !== "candidate_found") {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Последняя проверка не нашла однозначную тренировку.",
    };
  }

  if (latestDryRun.canExecute !== true) {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Последняя проверка не разрешает выполнение.",
    };
  }

  if (isEligibleForCoachSourceWorkoutConfirmation(latestDryRun.logJson)) {
    return {
      latestDryRunExecutable,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: "Нужно подтвердить planned тренировку перед выполнением.",
    };
  }

  const dryRunValidation = validateDryRunLogReadiness(latestDryRun.logJson, input.parsedPayload);
  if (!dryRunValidation.ok) {
    return {
      latestDryRunExecutable: false,
      latestExecuteFailed,
      safeToRetryExecute: false,
      reasonIfNo: dryRunValidation.reason,
    };
  }

  return {
    latestDryRunExecutable: true,
    latestExecuteFailed,
    safeToRetryExecute: true,
    reasonIfNo: null,
  };
}

export function extractExecuteRunFailureDiagnostics(
  latestExecute: TrainingPeaksActionRunContextSummary | null | undefined
): {
  failureReason: string | null;
  tpMutationAttempted: boolean | null;
  verificationFailed: boolean | null;
} {
  if (!latestExecute || latestExecute.runType !== "real") {
    return {
      failureReason: null,
      tpMutationAttempted: null,
      verificationFailed: null,
    };
  }

  const failureReason =
    trimOrNull(latestExecute.failureReason) ??
    trimOrNull(latestExecute.errorMessage) ??
    trimOrNull(latestExecute.blockedReason);

  const log =
    latestExecute.logJson && typeof latestExecute.logJson === "object"
      ? (latestExecute.logJson as {
          revalidationPassed?: unknown;
          revalidationComparison?: { revalidationPassed?: unknown; mismatchReasons?: unknown } | null;
          apiMoveResult?: unknown;
          verification?: { passed?: unknown } | null;
          safety?: { mutationForbidden?: unknown } | null;
          note?: unknown;
        })
      : null;

  let tpMutationAttempted: boolean | null = null;
  let verificationFailed: boolean | null = null;

  if (log) {
    if (typeof log.revalidationPassed === "boolean") {
      tpMutationAttempted = log.revalidationPassed;
      verificationFailed = log.revalidationPassed === false && Boolean(log.apiMoveResult);
    }
    if (typeof log.revalidationComparison?.revalidationPassed === "boolean") {
      tpMutationAttempted = log.revalidationComparison.revalidationPassed ? true : false;
      if (log.revalidationComparison.revalidationPassed === false) {
        tpMutationAttempted = false;
      }
    }
    if (log.verification && typeof log.verification.passed === "boolean") {
      verificationFailed = log.verification.passed === false;
      if (log.verification.passed) {
        tpMutationAttempted = true;
      }
    }
    if (log.safety?.mutationForbidden === false && log.apiMoveResult) {
      tpMutationAttempted = true;
    }
    const note = trimOrNull(log.note);
    if (note && /не изменён|not changed/i.test(note)) {
      tpMutationAttempted = false;
    }
  }

  if (failureReason?.includes("Revalidation failed")) {
    tpMutationAttempted = false;
    verificationFailed = false;
  }

  return {
    failureReason,
    tpMutationAttempted,
    verificationFailed,
  };
}
