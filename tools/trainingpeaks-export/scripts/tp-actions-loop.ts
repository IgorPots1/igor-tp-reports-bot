import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as moveSourcePolicyNamespace from "../../../src/features/trainingpeaks/move-source-policy.ts";

const moveSourcePolicy = moveSourcePolicyNamespace.default ?? moveSourcePolicyNamespace;

type LoopOptions = {
  intervalSeconds: number;
  once: boolean;
  executeReal: boolean;
  since: string | null;
};

type QueueCandidate = {
  id: string;
  execution_status: string;
  execution_mode: string | null;
  status: string;
  approved_at: string | null;
  created_at: string;
  last_run_id: string | null;
  parsed_payload: unknown;
};

type ActionSelectorRow = {
  id: string;
  status: string;
  execution_status: string;
  approved_at: string | null;
  created_at: string;
  execution_requested_at: string | null;
  last_run_id: string | null;
};

type RunningLocalCandidate = {
  id: string;
  status: string;
  execution_status: string;
  execution_mode: string | null;
  approved_at: string | null;
  created_at: string;
  claimed_at: string | null;
  execution_requested_at: string | null;
  last_run_id: string | null;
};

const DEFAULT_INTERVAL_SECONDS = 30;
const RUNNING_LOCAL_STALE_TIMEOUT_MINUTES = 15;

type TrustedDryRunInspection = {
  trusted: boolean;
  reason: string;
  dryRunResult: string | null;
  canExecute: boolean | null;
  confidence: number | null;
  fingerprintExists: boolean;
  sourceDateExists: boolean;
  targetDateExists: boolean;
  identityMatchedBy: string | null;
};

function getCliValueByPrefix(prefix: string): string | null {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!match) {
    return null;
  }
  const value = match.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`CLI argument ${prefix}<value> must not be empty.`);
  }
  return value;
}

function hasCliFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function parseOptions(): LoopOptions {
  const intervalRaw = getCliValueByPrefix("--interval-seconds=");
  const intervalSeconds = intervalRaw ? Number(intervalRaw) : DEFAULT_INTERVAL_SECONDS;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("--interval-seconds must be a positive number.");
  }

  const once = hasCliFlag("--once");
  const executeReal = hasCliFlag("--execute-real");
  const since = getCliValueByPrefix("--since=");
  if (since) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("--since must be a valid ISO timestamp.");
    }
  }

  return {
    intervalSeconds: Math.floor(intervalSeconds),
    once,
    executeReal,
    since,
  };
}

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
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
  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function isActionInsideCutoff(
  action: { created_at: string; approved_at: string | null },
  since: string | null
): boolean {
  if (!since) {
    return true;
  }
  const cutoffMs = new Date(since).getTime();
  const createdMs = new Date(action.created_at).getTime();
  const approvedMs = action.approved_at ? new Date(action.approved_at).getTime() : Number.NaN;
  return createdMs >= cutoffMs || (Number.isFinite(approvedMs) && approvedMs >= cutoffMs);
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function runCommand(
  args: string[],
  envOverrides?: Record<string, string | undefined>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", args, {
      stdio: "inherit",
      env: {
        ...process.env,
        ...envOverrides,
      },
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: npm ${args.join(" ")} (exit ${String(code)})`));
    });
  });
}

function hasTrustedDryRunLog(logJson: unknown, parsedPayload?: unknown): boolean {
  return moveSourcePolicy.validateDryRunLogReadiness(logJson, parsedPayload).ok;
}

function inspectTrustedDryRunLog(
  logJson: unknown,
  parsedPayload?: unknown
): TrustedDryRunInspection {
  if (!logJson || typeof logJson !== "object") {
    return {
      trusted: false,
      reason: "log_json_not_object",
      dryRunResult: null,
      canExecute: null,
      confidence: null,
      fingerprintExists: false,
      sourceDateExists: false,
      targetDateExists: false,
      identityMatchedBy: null,
    };
  }

  const payload = logJson as {
    dryRunResult?: unknown;
    canExecute?: unknown;
    confidence?: unknown;
    candidate?: { fingerprint?: unknown } | null;
    resolvedDates?: { sourceDate?: unknown; targetDate?: unknown } | null;
    identityCheck?: { matchedBy?: unknown } | null;
  };
  const confidence =
    typeof payload.confidence === "number"
      ? payload.confidence
      : typeof payload.confidence === "string"
        ? Number(payload.confidence)
        : Number.NaN;
  const dryRunResult = typeof payload.dryRunResult === "string" ? payload.dryRunResult : null;
  const canExecute = typeof payload.canExecute === "boolean" ? payload.canExecute : null;
  const fingerprint =
    typeof payload.candidate?.fingerprint === "string" ? payload.candidate.fingerprint.trim() : "";
  const sourceDate =
    typeof payload.resolvedDates?.sourceDate === "string" ? payload.resolvedDates.sourceDate.trim() : "";
  const targetDate =
    typeof payload.resolvedDates?.targetDate === "string" ? payload.resolvedDates.targetDate.trim() : "";
  const identityMatchedBy =
    typeof payload.identityCheck?.matchedBy === "string" ? payload.identityCheck.matchedBy : null;

  if (dryRunResult !== "candidate_found") {
    return {
      trusted: false,
      reason: `dry_run_result_${dryRunResult ?? "missing"}`,
      dryRunResult,
      canExecute,
      confidence: Number.isFinite(confidence) ? confidence : null,
      fingerprintExists: fingerprint.length > 0,
      sourceDateExists: sourceDate.length > 0,
      targetDateExists: targetDate.length > 0,
      identityMatchedBy,
    };
  }
  if (canExecute !== true) {
    return {
      trusted: false,
      reason: `can_execute_${String(canExecute)}`,
      dryRunResult,
      canExecute,
      confidence: Number.isFinite(confidence) ? confidence : null,
      fingerprintExists: fingerprint.length > 0,
      sourceDateExists: sourceDate.length > 0,
      targetDateExists: targetDate.length > 0,
      identityMatchedBy,
    };
  }

  const readiness = moveSourcePolicy.validateDryRunLogReadiness(logJson, parsedPayload);
  if (!readiness.ok) {
    return {
      trusted: false,
      reason: readiness.reason,
      dryRunResult,
      canExecute,
      confidence: Number.isFinite(confidence) ? confidence : null,
      fingerprintExists: fingerprint.length > 0,
      sourceDateExists: sourceDate.length > 0,
      targetDateExists: targetDate.length > 0,
      identityMatchedBy,
    };
  }

  return {
    trusted: true,
    reason: "trusted",
    dryRunResult,
    canExecute,
    confidence: Number.isFinite(confidence) ? confidence : null,
    fingerprintExists: fingerprint.length > 0,
    sourceDateExists: sourceDate.length > 0,
    targetDateExists: targetDate.length > 0,
    identityMatchedBy,
  };
}

function formatAutoQueueContext(
  row: QueueCandidate,
  input: {
    runStatus: string | null;
    runType: string | null;
    trustedInspection?: TrustedDryRunInspection;
  }
): string {
  return [
    `status=${row.status}`,
    `execution_status=${row.execution_status}`,
    `last_run_id=${row.last_run_id ?? "null"}`,
    `dryRunResult=${input.trustedInspection?.dryRunResult ?? "null"}`,
    `canExecute=${String(input.trustedInspection?.canExecute ?? null)}`,
    `confidence=${String(input.trustedInspection?.confidence ?? null)}`,
    `fingerprintExists=${input.trustedInspection?.fingerprintExists ? "yes" : "no"}`,
    `runRowExists=${input.runStatus || input.runType ? "yes" : "no"}`,
    `runRowStatus=${input.runStatus ?? "null"}`,
    `runRowType=${input.runType ?? "null"}`,
  ].join(" ");
}
async function autoQueueTrustedActions(since: string | null): Promise<number> {
  const supabase = getSupabase();
  let query = supabase
    .from("trainingpeaks_actions")
    .select("id,status,execution_status,execution_mode,approved_at,created_at,last_run_id,parsed_payload")
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .eq("execution_status", "dry_run_completed")
    .not("last_run_id", "is", null)
    .order("approved_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(50);

  if (since) {
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load dry-run completed actions: ${error.message}`);
  }

  let queued = 0;
  const retireUnsafeDryRunAction = async (
    row: QueueCandidate,
    reason: string
  ): Promise<void> => {
    const { data: retiredRow, error: retireError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "failed",
        execution_mode: "dry_run",
      })
      .eq("id", row.id)
      .eq("status", "approved")
      .eq("execution_status", "dry_run_completed")
      .eq("last_run_id", row.last_run_id)
      .select("id")
      .maybeSingle();
    if (retireError) {
      console.warn(
        `[tp-actions-loop] failed to retire unsafe dry-run action ${row.id}: ${retireError.message}`
      );
      return;
    }
    if (retiredRow) {
      console.log(`[tp-actions-loop] retired unsafe dry-run action ${row.id}: ${reason}`);
    }
  };

  for (const row of ((data as QueueCandidate[]) ?? [])) {
    if (!row.last_run_id) {
      const message = `[tp-actions-loop] skipped action ${row.id}: missing_last_run_id ${formatAutoQueueContext(
        row,
        {
          runStatus: null,
          runType: null,
        }
      )}`;
      console.log(message);
      continue;
    }

    const { data: runData, error: runError } = await supabase
      .from("trainingpeaks_action_runs")
      .select("id, log_json, status, run_type")
      .eq("id", row.last_run_id)
      .eq("action_id", row.id)
      .eq("status", "completed")
      .eq("run_type", "dry_run")
      .maybeSingle();
    if (runError) {
      const message = `[tp-actions-loop] skipped action ${row.id}: failed_to_load_trusted_run (${runError.message}) ${formatAutoQueueContext(
        row,
        {
          runStatus: null,
          runType: null,
        }
      )}`;
      console.warn(message);
      continue;
    }
    if (!runData) {
      const { data: anyRunData, error: anyRunError } = await supabase
        .from("trainingpeaks_action_runs")
        .select("id,status,run_type,log_json")
        .eq("id", row.last_run_id)
        .eq("action_id", row.id)
        .maybeSingle();
      if (anyRunError) {
        const message = `[tp-actions-loop] skipped action ${row.id}: trusted_run_lookup_failed (${anyRunError.message}) ${formatAutoQueueContext(
          row,
          {
            runStatus: null,
            runType: null,
          }
        )}`;
        console.warn(message);
        continue;
      }
      const runSnapshot = (anyRunData as { status: string; run_type: string } | null) ?? null;
      const rejectionReason = runSnapshot
        ? `run_row_mismatch_status=${runSnapshot.status}_type=${runSnapshot.run_type}`
        : "run_row_missing";
      await retireUnsafeDryRunAction(row, rejectionReason);
      continue;
    }

    const trustedInspection = inspectTrustedDryRunLog(
      (runData as { log_json?: unknown }).log_json,
      row.parsed_payload
    );
    if (
      !trustedInspection.trusted ||
      !hasTrustedDryRunLog((runData as { log_json?: unknown }).log_json, row.parsed_payload)
    ) {
      await retireUnsafeDryRunAction(row, trustedInspection.reason);
      continue;
    }

    const now = new Date().toISOString();
    const { data: queuedRow, error: queueError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "execute_pending",
        execution_requested_at: now,
        execution_requested_by_chat_id: "tp-actions-loop:auto",
        execution_requested_by_user_id: null,
        execution_request_message_id: null,
      })
      .eq("id", row.id)
      .eq("status", "approved")
      .eq("execution_status", "dry_run_completed")
      .eq("last_run_id", row.last_run_id)
      .select("id")
      .maybeSingle();
    if (queueError) {
      const runSnapshot = runData as { status: string; run_type: string };
      const message = `[tp-actions-loop] skipped action ${row.id}: queue_update_failed (${queueError.message}) ${formatAutoQueueContext(
        row,
        {
          runStatus: runSnapshot.status,
          runType: runSnapshot.run_type,
          trustedInspection,
        }
      )}`;
      console.warn(message);
      continue;
    }
    if (queuedRow) {
      queued += 1;
      console.log(`[tp-actions-loop] queued action ${row.id} for execute`);
    } else {
      const runSnapshot = runData as { status: string; run_type: string };
      const message = `[tp-actions-loop] skipped action ${row.id}: action_state_changed_before_queue ${formatAutoQueueContext(
        row,
        {
          runStatus: runSnapshot.status,
          runType: runSnapshot.run_type,
          trustedInspection,
        }
      )}`;
      console.log(message);
    }
  }

  return queued;
}

function getRunningLocalAnchorTimestamp(row: RunningLocalCandidate): string | null {
  return row.claimed_at ?? row.execution_requested_at ?? row.approved_at ?? row.created_at ?? null;
}

async function markStaleRunningLocalActions(): Promise<number> {
  const supabase = getSupabase();
  const cutoffMs = Date.now() - RUNNING_LOCAL_STALE_TIMEOUT_MINUTES * 60 * 1000;
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select(
      "id,status,execution_status,execution_mode,approved_at,created_at,claimed_at,execution_requested_at,last_run_id"
    )
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .eq("execution_status", "running_local")
    .order("claimed_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    throw new Error(`Failed to load running_local actions: ${error.message}`);
  }

  let markedFailed = 0;
  for (const row of (data as RunningLocalCandidate[]) ?? []) {
    const anchor = getRunningLocalAnchorTimestamp(row);
    const anchorMs = anchor ? new Date(anchor).getTime() : Number.NaN;
    if (!Number.isFinite(anchorMs) || anchorMs >= cutoffMs) {
      continue;
    }
    const { data: updatedRow, error: updateError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "failed",
        execution_mode: "real",
      })
      .eq("id", row.id)
      .eq("status", "approved")
      .eq("execution_status", "running_local")
      .select("id")
      .maybeSingle();
    if (updateError) {
      console.warn(
        `[tp-actions-loop] failed to mark stale running_local action ${row.id} as failed: ${updateError.message}`
      );
      continue;
    }
    if (!updatedRow) {
      continue;
    }
    markedFailed += 1;
    console.log(`[tp-actions-loop] marked stale running_local action ${row.id} as failed`);
  }
  return markedFailed;
}

async function selectNextDryRunActionIdSince(since: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("id,status,execution_status,approved_at,created_at,execution_requested_at,last_run_id")
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .in("execution_status", ["not_started", "execute_pending"])
    .order("approved_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(150);
  if (error) {
    throw new Error(`Failed to select dry-run candidate: ${error.message}`);
  }

  const rows = (data as ActionSelectorRow[]) ?? [];
  for (const row of rows) {
    if (!isActionInsideCutoff(row, since)) {
      continue;
    }
    if (row.execution_status === "not_started") {
      return row.id;
    }
    if (
      row.execution_status === "execute_pending" &&
      row.execution_requested_at === null &&
      row.last_run_id === null
    ) {
      return row.id;
    }
  }
  return null;
}

async function selectNextExecutePendingActionIdSince(since: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("id,status,execution_status,approved_at,created_at,execution_requested_at,last_run_id")
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .eq("execution_status", "execute_pending")
    .not("last_run_id", "is", null)
    .order("execution_requested_at", { ascending: true, nullsFirst: false })
    .order("approved_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(150);
  if (error) {
    throw new Error(`Failed to select execute candidate: ${error.message}`);
  }

  const rows = (data as ActionSelectorRow[]) ?? [];
  for (const row of rows) {
    if (!isActionInsideCutoff(row, since)) {
      continue;
    }
    return row.id;
  }
  return null;
}

async function runDryRunPass(options: LoopOptions): Promise<void> {
  const dryRunEnvOverrides = {
    TP_ACTIONS_REAL_EXECUTION: "false",
  };
  if (!options.since) {
    await runCommand(["run", "tp-actions-once"], dryRunEnvOverrides);
    return;
  }

  const actionId = await selectNextDryRunActionIdSince(options.since);
  if (!actionId) {
    console.log("[tp-actions-loop] no dry-run candidate inside --since cutoff");
    return;
  }
  await runCommand([
    "run",
    "tp-actions-once",
    "--",
    `--action-id=${actionId}`,
  ], dryRunEnvOverrides);
}

async function runRealPass(options: LoopOptions): Promise<void> {
  if (!options.since) {
    await runCommand([
      "run",
      "tp-actions-once",
      "--",
      "--execute-real",
    ]);
    return;
  }

  const actionId = await selectNextExecutePendingActionIdSince(options.since);
  if (!actionId) {
    console.log("[tp-actions-loop] no execute_pending candidate inside --since cutoff");
    return;
  }
  await runCommand([
    "run",
    "tp-actions-once",
    "--",
    "--execute-real",
    `--action-id=${actionId}`,
  ]);
}

function canExecuteRealInLoop(executeRealFlag: boolean): boolean {
  if (!executeRealFlag) {
    return false;
  }
  return isTruthy(process.env.TP_ACTIONS_REAL_EXECUTION) && isTruthy(process.env.TP_ACTIONS_USE_API_MOVE);
}

async function runTick(options: LoopOptions, tickNo: number): Promise<void> {
  console.log(`[tp-actions-loop] tick ${tickNo} started`);
  await markStaleRunningLocalActions();
  await runDryRunPass(options);
  const queuedCount = await autoQueueTrustedActions(options.since);
  if (queuedCount > 0) {
    console.log(`[tp-actions-loop] auto-queued ${queuedCount} trusted action(s)`);
  } else {
    console.log("[tp-actions-loop] no trusted actions to auto-queue");
  }

  if (canExecuteRealInLoop(options.executeReal)) {
    await runRealPass(options);
  } else if (options.executeReal) {
    console.log(
      "[tp-actions-loop] --execute-real ignored because TP_ACTIONS_REAL_EXECUTION=true and TP_ACTIONS_USE_API_MOVE=true are both required."
    );
  }
  console.log(`[tp-actions-loop] tick ${tickNo} finished`);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const options = parseOptions();
  console.log(
    `[tp-actions-loop] started interval=${options.intervalSeconds}s once=${options.once ? "yes" : "no"} executeReal=${options.executeReal ? "yes" : "no"} since=${options.since ?? "none"}`
  );

  let tickNo = 0;
  let isRunningTick = false;

  const runScheduledTick = async (): Promise<void> => {
    if (isRunningTick) {
      console.log("[tp-actions-loop] previous tick still running, skipping this interval.");
      return;
    }

    isRunningTick = true;
    tickNo += 1;
    try {
      await runTick(options, tickNo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tp-actions-loop] tick ${tickNo} failed: ${message}`);
    } finally {
      isRunningTick = false;
    }
  };

  if (!options.once) {
    setInterval(() => {
      void runScheduledTick();
    }, options.intervalSeconds * 1000);
  }

  await runScheduledTick();
  if (options.once) {
    return;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tp-actions-loop] fatal error: ${message}`);
  process.exitCode = 1;
});
