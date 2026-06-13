export const TP_ACTIONS_EXECUTE_REAL_FLAG = "--execute-real";
export const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
export const TP_ACTIONS_USE_API_MOVE_ENV = "TP_ACTIONS_USE_API_MOVE";
export const TP_ACTIONS_EXECUTE_ONCE_SCRIPT = "tp-actions-execute-once";
export const TP_ACTIONS_DRY_RUN_ONCE_SCRIPT = "tp-actions-once";

export function formatTpActionsExecuteOnceCommand(options?: { actionId?: string | null }): string {
  const actionIdArg = options?.actionId?.trim()
    ? ` -- --action-id=${options.actionId.trim()}`
    : "";
  return `${TP_ACTIONS_REAL_EXECUTION_ENV}=true ${TP_ACTIONS_USE_API_MOVE_ENV}=true npm run ${TP_ACTIONS_EXECUTE_ONCE_SCRIPT}${actionIdArg}`;
}

export function formatTpActionsDryRunOnceCommand(): string {
  return `npm run ${TP_ACTIONS_DRY_RUN_ONCE_SCRIPT}`;
}

export function formatExecutePendingQueueHintLines(input: {
  pendingCount: number;
  actionId?: string | null;
}): string[] {
  if (input.pendingCount <= 0) {
    return [];
  }

  const noun = input.pendingCount === 1 ? "action" : "actions";
  return [
    `Execution queue has ${input.pendingCount} pending ${noun} in execute_pending.`,
    "Dry-run mode does not process execute_pending. Use real execution:",
    "nextCommand:",
    `  ${formatTpActionsExecuteOnceCommand({ actionId: input.actionId })}`,
  ];
}
