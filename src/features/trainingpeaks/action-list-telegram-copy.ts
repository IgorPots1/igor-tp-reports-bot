import {
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON,
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU,
} from "@/features/trainingpeaks/move-source-policy";
import type {
  TrainingPeaksActionExecutionStatus,
  TrainingPeaksActionStatus,
} from "@/features/trainingpeaks/repository";
import { formatCompactCoachDateShort } from "@/features/trainingpeaks/action-execute-telegram-copy";

export const COACH_REPLY_BUTTON_SIGNALS = "📍 Сигналы";

const STALE_NEEDS_REVIEW_HOURS = 72;
const RECENT_COMPLETED_HOURS = 168;

export type CoachActionListItem = {
  id: string;
  studentName: string | null;
  status: TrainingPeaksActionStatus | string;
  executionStatus: TrainingPeaksActionExecutionStatus | string;
  executionMode: string | null;
  actionType: string;
  parsedPayload: unknown;
  createdAt: string;
  updatedAt: string;
  latestRunContext?: {
    latestDryRun?: CoachActionRunSummaryInput | null;
    latestExecute?: CoachActionRunSummaryInput | null;
    latestRelevant?: CoachActionRunSummaryInput | null;
  } | null;
};

type CoachActionRunSummaryInput = {
  status?: string;
  dryRunResult?: string | null;
  blockedReason?: string | null;
  failureReason?: string | null;
  errorMessage?: string | null;
  canExecute?: boolean | null;
};

export type CoachActionListBucket =
  | "pending_decision"
  | "ready_to_execute"
  | "in_progress"
  | "needs_review"
  | "stale_review"
  | "completed"
  | "rejected";

const COACH_ACTION_STATUS_LABELS: Record<string, string> = {
  pending_coach: "ждёт решения тренера",
  approved: "одобрено",
  rejected: "отклонено",
  completed: "выполнено",
  failed: "ошибка",
  cancelled: "отменено",
};

const COACH_EXECUTION_STATUS_LABELS: Record<string, string> = {
  not_started: "ожидает запуска",
  dry_run_running: "проверка идёт",
  dry_run_completed: "проверка завершена",
  execute_pending: "ожидает выполнения",
  running_local: "выполнение идёт",
  completed: "выполнено",
  failed: "ошибка выполнения",
};

const COACH_DRY_RUN_RESULT_LABELS: Record<string, string> = {
  candidate_found: "тренировка найдена",
  not_found: "тренировка не найдена",
  ambiguous: "найдено несколько вариантов",
  needs_manual: "нужна ручная проверка",
  failed: "ошибка проверки",
};

const COACH_ACTION_REASON_TRANSLATIONS: Array<{ pattern: RegExp | string; label: string }> = [
  {
    pattern: /^confidence below threshold \d+(?:\.\d+)?$/i,
    label: "недостаточно уверенности, нужна проверка",
  },
  { pattern: /multiple candidates/i, label: "найдено несколько похожих тренировок" },
  {
    pattern: INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON,
    label: "исходный день не указан явно, выполнение заблокировано",
  },
  {
    pattern: INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU,
    label: "исходный день не указан явно, выполнение заблокировано",
  },
  { pattern: /candidate not found/i, label: "тренировка не найдена" },
  { pattern: /fingerprint mismatch/i, label: "тренировка изменилась, нужна повторная проверка" },
  { pattern: /source day is ambiguous/i, label: "исходный день указан неоднозначно" },
  { pattern: /ambiguous_target_day/i, label: "целевой день указан неоднозначно" },
];

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

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isWithinLookbackHours(isoTimestamp: string, hours: number): boolean {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= hours * 60 * 60 * 1000;
}

function isConfidenceThresholdReason(reason: string): boolean {
  return /^confidence below threshold \d+(?:\.\d+)?$/i.test(reason);
}

export function formatCoachActionStatusLabel(status: string): string {
  return COACH_ACTION_STATUS_LABELS[status] ?? "нужна ручная проверка";
}

export function formatCoachExecutionStatusLabel(executionStatus: string): string {
  return COACH_EXECUTION_STATUS_LABELS[executionStatus] ?? "нужна ручная проверка";
}

export function formatCoachDryRunResultLabel(dryRunResult: string | null | undefined): string | null {
  if (!dryRunResult) {
    return null;
  }
  return COACH_DRY_RUN_RESULT_LABELS[dryRunResult] ?? "нужна ручная проверка";
}

export function translateCoachActionTechnicalReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    return "нужна ручная проверка";
  }
  for (const entry of COACH_ACTION_REASON_TRANSLATIONS) {
    if (typeof entry.pattern === "string") {
      if (normalized === entry.pattern || normalized.includes(entry.pattern)) {
        return entry.label;
      }
      continue;
    }
    if (entry.pattern.test(normalized)) {
      return entry.label;
    }
  }
  return "нужна ручная проверка";
}

export function extractCoachActionLatestReason(latestRunContext: unknown): string | null {
  if (!latestRunContext || typeof latestRunContext !== "object") {
    return null;
  }
  const context = latestRunContext as {
    latestRelevant?: CoachActionRunSummaryInput | null;
    latestDryRun?: CoachActionRunSummaryInput | null;
    latestExecute?: CoachActionRunSummaryInput | null;
  };
  for (const run of [context.latestRelevant, context.latestExecute, context.latestDryRun]) {
    if (!run || typeof run !== "object") {
      continue;
    }
    const blocked = trimOrNull(run.blockedReason);
    if (blocked) {
      return blocked;
    }
    const failure = trimOrNull(run.failureReason);
    if (failure) {
      return failure;
    }
    const error = trimOrNull(run.errorMessage);
    if (error) {
      return error;
    }
  }
  return null;
}

export function formatCoachActionReasonForDisplay(latestRunContext: unknown): string {
  const rawReason = extractCoachActionLatestReason(latestRunContext);
  if (!rawReason) {
    return "нужна ручная проверка";
  }
  return translateCoachActionTechnicalReason(rawReason);
}

function extractReasonFromRun(run: CoachActionRunSummaryInput): string | null {
  return trimOrNull(run.blockedReason) ?? trimOrNull(run.failureReason) ?? trimOrNull(run.errorMessage);
}

export function formatCoachActionRunSummary(run: unknown, kind: "dry_run" | "execute"): string {
  if (!run || typeof run !== "object") {
    return kind === "dry_run" ? "не проводилась" : "не выполнялось";
  }

  const payload = run as CoachActionRunSummaryInput;
  const status = typeof payload.status === "string" ? payload.status : "unknown";

  if (kind === "dry_run") {
    if (status === "running") {
      return "проверка идёт";
    }
    if (status === "failed") {
      const reason = extractReasonFromRun(payload);
      return reason ? `ошибка проверки — ${translateCoachActionTechnicalReason(reason)}` : "ошибка проверки";
    }
    if (status !== "completed") {
      return "ожидает проверки";
    }

    const resultLabel = formatCoachDryRunResultLabel(payload.dryRunResult);
    const reason = extractReasonFromRun(payload);
    if (payload.dryRunResult === "candidate_found" && payload.canExecute === true && !reason) {
      return "проверка прошла, можно выполнить";
    }
    if (resultLabel && reason) {
      return `${resultLabel} — ${translateCoachActionTechnicalReason(reason)}`;
    }
    if (resultLabel) {
      return resultLabel;
    }
    return "проверка завершена";
  }

  if (status === "running") {
    return "выполнение идёт";
  }
  if (status === "completed") {
    return "выполнено";
  }
  if (status === "failed") {
    const reason = extractReasonFromRun(payload);
    return reason ? `ошибка выполнения — ${translateCoachActionTechnicalReason(reason)}` : "ошибка выполнения";
  }
  return "ожидает выполнения";
}

function isCoachActionWaitingDryRunRecheck(action: CoachActionListItem): boolean {
  if (action.executionStatus !== "not_started") {
    return false;
  }
  if (action.executionMode !== "dry_run") {
    return false;
  }
  return Boolean(action.latestRunContext?.latestDryRun);
}

function isCoachActionReadyToExecute(action: CoachActionListItem): boolean {
  if (action.actionType !== "move_workout" || action.status !== "approved") {
    return false;
  }
  if (action.executionStatus !== "dry_run_completed") {
    return false;
  }
  const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
  return (
    latestDryRun?.status === "completed" &&
    latestDryRun.dryRunResult === "candidate_found" &&
    latestDryRun.canExecute === true
  );
}

function isCoachActionNeedsReview(action: CoachActionListItem): boolean {
  if (action.executionStatus === "failed") {
    return true;
  }
  if (action.executionStatus !== "dry_run_completed") {
    return false;
  }
  const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
  if (!latestDryRun || latestDryRun.status !== "completed") {
    return false;
  }
  if (
    latestDryRun.dryRunResult === "not_found" ||
    latestDryRun.dryRunResult === "failed" ||
    latestDryRun.dryRunResult === "ambiguous" ||
    latestDryRun.dryRunResult === "needs_manual"
  ) {
    return true;
  }
  if (latestDryRun.canExecute === false) {
    return true;
  }
  const reason = extractCoachActionLatestReason({ latestDryRun });
  return Boolean(reason);
}

export function isCoachActionStaleForList(action: CoachActionListItem): boolean {
  if (!isCoachActionNeedsReview(action)) {
    return false;
  }
  if (isWithinLookbackHours(action.updatedAt, STALE_NEEDS_REVIEW_HOURS)) {
    return false;
  }
  const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
  if (latestDryRun?.dryRunResult === "not_found") {
    return true;
  }
  const reason = extractCoachActionLatestReason(action.latestRunContext);
  return Boolean(reason && isConfidenceThresholdReason(reason));
}

export function classifyCoachActionListBucket(action: CoachActionListItem): CoachActionListBucket {
  if (action.status === "rejected") {
    return "rejected";
  }
  if (action.executionStatus === "completed") {
    return "completed";
  }
  if (action.status === "pending_coach") {
    return "pending_decision";
  }
  if (isCoachActionReadyToExecute(action)) {
    return "ready_to_execute";
  }
  if (isCoachActionNeedsReview(action)) {
    return isCoachActionStaleForList(action) ? "stale_review" : "needs_review";
  }
  return "in_progress";
}

export function formatCoachActionCompactStatus(action: CoachActionListItem): string {
  const bucket = classifyCoachActionListBucket(action);

  if (bucket === "pending_decision") {
    return "ждёт решения тренера";
  }
  if (bucket === "ready_to_execute") {
    return "готово к выполнению";
  }
  if (bucket === "needs_review" || bucket === "stale_review") {
    const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
    const dryRunResult = latestDryRun?.dryRunResult ?? null;
    if (dryRunResult === "not_found") {
      return "нужно проверить: тренировка не найдена";
    }
    if (dryRunResult === "ambiguous") {
      return "нужно уточнить: найдено несколько вариантов";
    }
    const reason = extractCoachActionLatestReason(action.latestRunContext);
    if (reason && isConfidenceThresholdReason(reason)) {
      return "нужно проверить: недостаточно уверенности";
    }
    if (action.executionStatus === "failed") {
      return "ошибка выполнения";
    }
    return "нужно проверить";
  }
  if (bucket === "completed") {
    return "выполнено";
  }
  if (isCoachActionWaitingDryRunRecheck(action)) {
    return "ожидает повторной проверки";
  }
  if (action.executionStatus === "dry_run_running") {
    return "проверка идёт";
  }
  if (action.executionStatus === "execute_pending" || action.executionStatus === "running_local") {
    return formatCoachExecutionStatusLabel(action.executionStatus);
  }
  if (action.status === "approved" && action.executionStatus === "dry_run_completed") {
    return "проверка завершена";
  }
  if (action.status === "approved") {
    return formatCoachExecutionStatusLabel(action.executionStatus);
  }
  return formatCoachActionStatusLabel(action.status);
}

function formatCoachActionListItemDetailLine(action: CoachActionListItem): string {
  const bucket = classifyCoachActionListBucket(action);

  if (bucket === "completed") {
    return "выполнено";
  }
  if (bucket === "ready_to_execute") {
    return "готово к выполнению";
  }
  if (bucket === "pending_decision") {
    return "ждёт решения тренера";
  }
  if (bucket === "needs_review" || bucket === "stale_review") {
    const latestDryRun = action.latestRunContext?.latestDryRun ?? null;
    const dryRunResult = latestDryRun?.dryRunResult ?? null;
    if (dryRunResult === "not_found") {
      return "причина: тренировка не найдена";
    }
    if (dryRunResult === "ambiguous") {
      return "причина: найдено несколько вариантов";
    }
    const reason = extractCoachActionLatestReason(action.latestRunContext);
    if (reason && isConfidenceThresholdReason(reason)) {
      return "причина: недостаточно уверенности";
    }
    if (action.executionStatus === "failed") {
      return "причина: ошибка выполнения";
    }
    return "причина: нужна проверка";
  }
  if (isCoachActionWaitingDryRunRecheck(action)) {
    return "ожидает повторной проверки";
  }
  if (action.executionStatus === "dry_run_running") {
    return "проверка идёт";
  }
  if (action.executionStatus === "execute_pending" || action.executionStatus === "running_local") {
    return formatCoachExecutionStatusLabel(action.executionStatus);
  }
  if (action.status === "approved" && action.executionStatus === "dry_run_completed") {
    return "проверка завершена";
  }
  return formatCoachActionCompactStatus(action);
}

function formatCoachActionCompactLine(action: CoachActionListItem, index: number): string {
  const dates = extractMoveDateRangeFromParsedPayload(action.parsedPayload);
  const route = `${formatCompactCoachDateShort(dates.sourceDate)} → ${formatCompactCoachDateShort(dates.targetDate)}`;
  const name = action.studentName?.trim() || "?";
  return [
    `${index + 1}. ${name}`,
    `   перенос: ${route}`,
    `   ${formatCoachActionListItemDetailLine(action)}`,
  ].join("\n");
}

function pushSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) {
    return;
  }
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push(title);
  lines.push("");
  lines.push(...items);
}

function listCoachActionsForCompactDisplay(actions: CoachActionListItem[]): CoachActionListItem[] {
  const grouped: Record<CoachActionListBucket, CoachActionListItem[]> = {
    pending_decision: [],
    ready_to_execute: [],
    in_progress: [],
    needs_review: [],
    stale_review: [],
    completed: [],
    rejected: [],
  };

  for (const action of actions) {
    grouped[classifyCoachActionListBucket(action)].push(action);
  }

  return [
    ...grouped.pending_decision,
    ...grouped.ready_to_execute,
    ...grouped.needs_review,
    ...grouped.in_progress,
  ];
}

export function buildCoachActionsListText(actions: CoachActionListItem[]): string {
  if (actions.length === 0) {
    return "📋 Заявки на перенос\n\nПока заявок на перенос нет.";
  }

  const grouped: Record<CoachActionListBucket, CoachActionListItem[]> = {
    pending_decision: [],
    ready_to_execute: [],
    in_progress: [],
    needs_review: [],
    stale_review: [],
    completed: [],
    rejected: [],
  };

  for (const action of actions) {
    grouped[classifyCoachActionListBucket(action)].push(action);
  }

  const activeActions = listCoachActionsForCompactDisplay(actions);

  const lines: string[] = ["📋 Заявки на перенос", ""];

  pushSection(
    lines,
    "⏳ Нужно решение",
    grouped.pending_decision.map((action) => formatCoachActionCompactLine(action, activeActions.indexOf(action)))
  );

  pushSection(
    lines,
    "✅ Готово к выполнению",
    grouped.ready_to_execute.map((action) => formatCoachActionCompactLine(action, activeActions.indexOf(action)))
  );

  pushSection(
    lines,
    "⚠️ Нужно проверить",
    grouped.needs_review.map((action) => formatCoachActionCompactLine(action, activeActions.indexOf(action)))
  );

  pushSection(
    lines,
    "🔄 В процессе",
    grouped.in_progress.map((action) => formatCoachActionCompactLine(action, activeActions.indexOf(action)))
  );

  if (activeActions.length === 0) {
    if (lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push("Нет активных заявок.");
  }

  if (grouped.stale_review.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(`🕰 Старые проблемы скрыты: ${grouped.stale_review.length}`);
    lines.push("Откройте заявку по номеру, если нужна детальная проверка.");
  }

  const recentCompleted = grouped.completed.filter((action) =>
    isWithinLookbackHours(action.updatedAt, RECENT_COMPLETED_HOURS)
  );
  if (recentCompleted.length > 0) {
    const completedLines = recentCompleted
      .slice(0, 3)
      .map((action, index) => formatCoachActionCompactLine(action, index));
    pushSection(lines, "✅ Недавние выполненные", completedLines);
    if (grouped.completed.length > recentCompleted.length) {
      lines.push(`… и ещё ${grouped.completed.length - Math.min(recentCompleted.length, 3)} выполненных`);
    }
  } else if (grouped.completed.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(`✅ Выполнено: ${grouped.completed.length}`);
  }

  if (grouped.rejected.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(`❌ Отклонено/отменено: ${grouped.rejected.length}`);
  }

  while (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

export function listCoachActionListActiveActions(actions: CoachActionListItem[]): CoachActionListItem[] {
  return listCoachActionsForCompactDisplay(actions);
}

export function listCoachActionListActiveIndices(actions: CoachActionListItem[]): number[] {
  return listCoachActionListActiveActions(actions).map((action) => actions.indexOf(action));
}
