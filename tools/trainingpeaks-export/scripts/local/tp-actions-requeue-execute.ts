/**
 * Guarded local helper to requeue failed TP action execution without mutating TrainingPeaks.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { formatTpActionsExecuteOnceCommand } from "../../../../src/features/trainingpeaks/action-runner-commands.ts";
import { requeueTrainingPeaksActionExecution } from "../../../../src/features/trainingpeaks/repository.ts";

const LOG_PREFIX = "[tp-actions-requeue-execute]";
const REQUIRED_CONFIRM = "REQUEUE EXECUTE";

const toolRoot = path.resolve(import.meta.dirname, "..", "..");
const repoRoot = path.resolve(toolRoot, "..", "..");

function loadDotEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  for (const envPath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ]) {
    loadDotEnvFile(envPath);
  }
}

function parseArgs(): { actionId: string; confirm: string | null } {
  const actionIdArg = process.argv.find((entry) => entry.startsWith("--action-id="));
  const confirmArg = process.argv.find((entry) => entry.startsWith("--confirm="));
  const actionId = actionIdArg?.slice("--action-id=".length).trim();
  if (!actionId) {
    throw new Error(
      `Usage: npm run tp-actions-requeue-execute -- --action-id=<uuid> --confirm="${REQUIRED_CONFIRM}"`
    );
  }
  return {
    actionId,
    confirm: confirmArg?.slice("--confirm=".length).trim() ?? null,
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const { actionId, confirm } = parseArgs();

  if (confirm !== REQUIRED_CONFIRM) {
    throw new Error(`Missing or invalid --confirm. Expected --confirm="${REQUIRED_CONFIRM}"`);
  }

  const result = await requeueTrainingPeaksActionExecution({ actionId });

  if (result.kind === "not_found") {
    throw new Error(`Action not found: ${actionId}`);
  }

  if (result.kind === "already_queued") {
    console.log(`${LOG_PREFIX} actionId=${actionId}`);
    console.log("status=already_queued");
    console.log(`execution_status=${result.action.executionStatus}`);
    console.log("");
    console.log("nextCommand:");
    console.log(`  ${formatTpActionsExecuteOnceCommand({ actionId })}`);
    return;
  }

  if (result.kind === "blocked") {
    throw new Error(`Requeue blocked: ${result.reason}`);
  }

  console.log(`${LOG_PREFIX} actionId=${actionId}`);
  console.log("status=requeued");
  console.log(`execution_status=${result.action.executionStatus}`);
  console.log(`execution_mode=${result.action.executionMode ?? "null"}`);
  console.log(`last_run_id=${result.dryRunRunId}`);
  console.log(`trustedSourceDate=${result.queuedDisplay.trustedSourceDate}`);
  console.log(`trustedTargetDate=${result.queuedDisplay.trustedTargetDate}`);
  console.log("");
  console.log("nextCommand:");
  console.log(`  ${formatTpActionsExecuteOnceCommand({ actionId })}`);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
