/**
 * Read-only diagnostic for planned-vs-completed TP action hint and button eligibility.
 * Does not mutate DB, call TrainingPeaks mutation APIs, or send Telegram.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  buildPlannedCompletedAmbiguityCandidate,
  extractPlannedVsCompletedHintFromLogJson,
  inferMoveCandidateWorkoutStatus,
  isEligibleForCoachSourceWorkoutConfirmation,
  isNormalWorkoutTitle,
  resolvePlannedVsCompletedHintFromDryRunLog,
  truncateWorkoutTitleForButton,
  type MoveCandidateStatusInput,
} from "../../../../src/features/trainingpeaks/action-planned-completed-ambiguity.ts";

const LOG_PREFIX = "[check-tp-action-planned-completed-hint-debug]";
const TP_CALLBACK_ACTION_SELECT_WORKOUT_PREFIX = "tp:ta:sw:";

const toolRoot = path.resolve(import.meta.dirname, "..", "..");
const repoRoot = path.resolve(toolRoot, "..", "..");

type ActionRow = {
  id: string;
  status: string;
  execution_status: string;
  execution_mode: string | null;
  parsed_payload: unknown;
  last_run_id: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  action_id: string;
  run_type: string;
  status: string;
  dry_run: boolean | null;
  log_json: unknown;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type DryRunLogJson = {
  dryRunResult?: unknown;
  canExecute?: unknown;
  canExecuteReasons?: unknown;
  plannedVsCompletedHint?: unknown;
  debugCandidatesTopN?: unknown;
  identityCheck?: { matchedBy?: unknown } | null;
  sourceInferenceProvenance?: { warnings?: unknown } | null;
  selectedSourceDate?: unknown;
  selectedSourceDatePolicy?: unknown;
};

type DebugCandidate = MoveCandidateStatusInput & {
  workoutId?: number | string | null;
  score?: number | null;
  sourceDate?: string | null;
  reasons?: string[];
};

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
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];
  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }
  return value;
}

function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseActionIdArg(): string {
  const arg = process.argv.find((entry) => entry.startsWith("--action-id="));
  const actionId = arg?.slice("--action-id=".length).trim();
  if (!actionId) {
    throw new Error("Usage: npm run check:tp-action-planned-completed-hint-debug -- --action-id=<uuid>");
  }
  return actionId;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

function extractMoveDates(parsedPayload: unknown): { sourceDate: string | null; targetDate: string | null } {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return { sourceDate: null, targetDate: null };
  }
  const payload = parsedPayload as {
    sourceDate?: unknown;
    target?: { kind?: unknown; value?: unknown } | null;
  };
  const sourceDate = typeof payload.sourceDate === "string" ? payload.sourceDate : null;
  const targetDate =
    payload.target?.kind === "date" && typeof payload.target.value === "string"
      ? payload.target.value
      : null;
  return { sourceDate, targetDate };
}

function isCompletedLikeForDebug(candidate: MoveCandidateStatusInput): boolean {
  if (inferMoveCandidateWorkoutStatus(candidate) !== "completed") {
    return false;
  }
  const title = (candidate.title ?? "").trim().toLowerCase();
  if (title === "other" || title === "activity" || title === "workout") {
    return true;
  }
  const text = (candidate.rawTextSnippet ?? "").toLowerCase();
  return (
    (candidate.selectorHint ?? "").includes(".activity.workout") ||
    typeof candidate.plannedDistance === "number" ||
    /\bhr\s*tss\b/i.test(text)
  );
}

function explainMissingHint(input: {
  dryRunResult: string | null;
  canExecute: boolean | null;
  identityMatchedBy: string | null;
  canExecuteReasons: string[];
  provenanceWarnings: string[];
  payloadWarnings: string[];
  candidates: DebugCandidate[];
}): string[] {
  const reasons: string[] = [];

  if (input.dryRunResult !== "ambiguous") {
    reasons.push(`dryRunResult is "${input.dryRunResult ?? "null"}", not "ambiguous"`);
  }
  if (input.identityMatchedBy === "mismatch") {
    reasons.push("identityCheck.matchedBy is mismatch");
  }
  if (
    input.canExecuteReasons.some((reason) =>
      /target day already has workout|target.?conflict|конфликт/i.test(reason)
    ) ||
    input.provenanceWarnings.some((warning) => /target day already has workout/i.test(warning))
  ) {
    reasons.push("target conflict reason blocks hint");
  }
  if (input.payloadWarnings.some((warning) => /pain|injury|боль|травм/i.test(warning))) {
    reasons.push("blocking safety warning in parsed payload");
  }
  if (input.candidates.length < 2) {
    reasons.push(`candidate count ${input.candidates.length} < 2`);
  }

  const plannedCandidates = input.candidates.filter(
    (candidate) =>
      inferMoveCandidateWorkoutStatus(candidate) === "planned" && isNormalWorkoutTitle(candidate.title)
  );
  const completedCandidates = input.candidates.filter((candidate) => isCompletedLikeForDebug(candidate));

  reasons.push(`planned candidate count = ${plannedCandidates.length}`);
  reasons.push(`completed-like candidate count = ${completedCandidates.length}`);

  for (const candidate of input.candidates) {
    const status = inferMoveCandidateWorkoutStatus(candidate);
    const built = buildPlannedCompletedAmbiguityCandidate(candidate);
    reasons.push(
      `candidate "${candidate.title ?? "?"}" workoutId=${candidate.workoutId ?? "?"} inferred=${status} builtStatus=${built.status} normalTitle=${isNormalWorkoutTitle(candidate.title)} completedLike=${isCompletedLikeForDebug(candidate)}`
    );
  }

  if (plannedCandidates.length !== 1) {
    reasons.push("detector requires exactly 1 planned candidate with normal title");
  }
  if (completedCandidates.length < 1) {
    reasons.push("detector requires at least 1 completed-like candidate");
  }

  return reasons;
}

function explainButtonEligibility(input: {
  latestDryRun: RunRow | null;
  logJson: DryRunLogJson | null;
}): { wouldShow: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const run = input.latestDryRun;
  if (!run) {
    return { wouldShow: false, reasons: ["no dry_run run found"] };
  }
  if (run.run_type !== "dry_run") {
    reasons.push(`latest run type is ${run.run_type}, not dry_run`);
  }
  if (run.status !== "completed") {
    reasons.push(`latest dry_run status is ${run.status}, not completed`);
  }

  const hintPresent = Boolean(extractPlannedVsCompletedHintFromLogJson(input.logJson));
  if (!hintPresent) {
    reasons.push("plannedVsCompletedHint missing or invalid in latest dry_run log_json");
  }

  if (!isEligibleForCoachSourceWorkoutConfirmation(input.logJson)) {
    if (input.logJson?.dryRunResult !== "ambiguous") {
      reasons.push(`dryRunResult is "${String(input.logJson?.dryRunResult ?? "null")}", not ambiguous`);
    }
    if (input.logJson?.canExecute === true) {
      reasons.push("canExecute=true blocks confirm-source-workout button");
    }
    const identityMatchedBy =
      typeof input.logJson?.identityCheck?.matchedBy === "string"
        ? input.logJson.identityCheck.matchedBy
        : null;
    if (identityMatchedBy === "mismatch") {
      reasons.push("identityCheck.matchedBy is mismatch");
    }
  }

  const wouldShow =
    run.run_type === "dry_run" &&
    run.status === "completed" &&
    isEligibleForCoachSourceWorkoutConfirmation(input.logJson);

  if (wouldShow) {
    reasons.push("renderer would show confirm source workout button");
  }

  return { wouldShow, reasons };
}

function formatCandidateDebugLine(candidate: DebugCandidate): string {
  const status = inferMoveCandidateWorkoutStatus(candidate);
  const built = buildPlannedCompletedAmbiguityCandidate(candidate);
  const parts = [
    `title=${candidate.title ?? "?"}`,
    `workoutId=${candidate.workoutId ?? "?"}`,
    `score=${candidate.score ?? "?"}`,
    `inferred=${status}`,
    `built=${built.status}`,
  ];
  if (candidate.plannedDurationSec != null) {
    parts.push(`durationSec=${candidate.plannedDurationSec}`);
  }
  if (candidate.plannedDistance != null) {
    parts.push(`distance=${candidate.plannedDistance}`);
  }
  if (built.tssText) {
    parts.push(`tss=${built.tssText}`);
  }
  if (candidate.classHint) {
    parts.push(`classHint=${candidate.classHint}`);
  }
  if (candidate.selectorHint) {
    parts.push(`selectorHint=${candidate.selectorHint}`);
  }
  return parts.join(" | ");
}

async function main(): Promise<void> {
  loadLocalEnv();
  const actionId = parseActionIdArg();
  const supabase = getSupabase();

  const { data: actionRow, error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .select("id, status, execution_status, execution_mode, parsed_payload, last_run_id, created_at, updated_at")
    .eq("id", actionId)
    .maybeSingle();

  if (actionError) {
    throw new Error(`Failed to load action ${actionId}: ${actionError.message}`);
  }
  if (!actionRow) {
    throw new Error(`Action not found: ${actionId}`);
  }

  const action = actionRow as ActionRow;
  const { data: runRows, error: runsError } = await supabase
    .from("trainingpeaks_action_runs")
    .select("id, action_id, run_type, status, dry_run, log_json, created_at, started_at, finished_at")
    .eq("action_id", actionId)
    .order("created_at", { ascending: false });

  if (runsError) {
    throw new Error(`Failed to load runs for action ${actionId}: ${runsError.message}`);
  }

  const runs = (runRows as RunRow[] | null) ?? [];
  const latestDryRun = runs.find((run) => run.run_type === "dry_run") ?? null;
  const logJson = (latestDryRun?.log_json ?? null) as DryRunLogJson | null;
  const dates = extractMoveDates(action.parsed_payload);
  const storedHint = extractPlannedVsCompletedHintFromLogJson(logJson);
  const debugCandidates = Array.isArray(logJson?.debugCandidatesTopN)
    ? (logJson!.debugCandidatesTopN as DebugCandidate[])
    : [];

  const resolvedHint = resolvePlannedVsCompletedHintFromDryRunLog(logJson);
  const buttonEligibility = explainButtonEligibility({ latestDryRun, logJson });
  const hint = resolvedHint;
  const buttonLabel = hint
    ? `✅ Перенести ${truncateWorkoutTitleForButton(hint.suggestedSourceCandidate.title)}`
    : null;
  const callbackData = `${TP_CALLBACK_ACTION_SELECT_WORKOUT_PREFIX}${actionId}`;

  console.log(`${LOG_PREFIX} actionId=${action.id}`);
  console.log(`status=${action.status}`);
  console.log(`execution_status=${action.execution_status}`);
  console.log(`execution_mode=${action.execution_mode ?? "null"}`);
  console.log(`source/target=${dates.sourceDate ?? "?"} -> ${dates.targetDate ?? "?"}`);
  console.log(`last_run_id=${action.last_run_id ?? "null"}`);
  console.log(`run_count=${runs.length}`);

  console.log("");
  console.log("runs (newest first):");
  for (const run of runs.slice(0, 5)) {
    const runLog = (run.log_json ?? null) as DryRunLogJson | null;
    console.log(
      `- ${run.id} | ${run.run_type} | ${run.status} | created_at=${run.created_at} | dryRunResult=${String(runLog?.dryRunResult ?? "null")} | plannedHint=${Boolean(extractPlannedVsCompletedHintFromLogJson(runLog))}`
    );
  }

  console.log("");
  console.log("latest dry_run:");
  console.log(`run_id=${latestDryRun?.id ?? "null"}`);
  console.log(`created_at=${latestDryRun?.created_at ?? "null"}`);
  console.log(`mode/status=${latestDryRun?.run_type ?? "null"}/${latestDryRun?.status ?? "null"}`);
  console.log(`dryRunResult=${String(logJson?.dryRunResult ?? "null")}`);
  console.log(`canExecute=${String(logJson?.canExecute ?? "null")}`);
  console.log(`canExecuteReasons=${JSON.stringify(asStringArray(logJson?.canExecuteReasons))}`);
  console.log(
    `plannedVsCompletedHint: ${storedHint ? "present (stored in log_json)" : resolvedHint ? "missing in log_json, resolved from debugCandidatesTopN" : "missing"}`
  );

  if (hint) {
    console.log(`recommendedWorkoutId=${hint.suggestedSourceCandidate.workoutId}`);
    console.log(`recommendedTitle=${hint.suggestedSourceCandidate.title}`);
    console.log(`otherCandidates=${hint.otherSourceCandidates.map((c) => c.title).join(", ") || "none"}`);
    console.log(`buttonLabel=${buttonLabel}`);
    console.log(`callbackData=${callbackData} (len=${callbackData.length})`);
  } else {
    console.log("detectorRecomputeReasons:");
    for (const reason of explainMissingHint({
      dryRunResult: typeof logJson?.dryRunResult === "string" ? logJson.dryRunResult : null,
      canExecute: typeof logJson?.canExecute === "boolean" ? logJson.canExecute : null,
      identityMatchedBy:
        typeof logJson?.identityCheck?.matchedBy === "string" ? logJson.identityCheck.matchedBy : null,
      canExecuteReasons: asStringArray(logJson?.canExecuteReasons),
      provenanceWarnings: asStringArray(logJson?.sourceInferenceProvenance?.warnings),
      payloadWarnings: [],
      candidates: debugCandidates,
    })) {
      console.log(`- ${reason}`);
    }
  }

  console.log("");
  console.log("debugCandidatesTopN:");
  if (debugCandidates.length === 0) {
    console.log("- none in latest dry_run log_json");
  } else {
    for (const candidate of debugCandidates.slice(0, 10)) {
      console.log(`- ${formatCandidateDebugLine(candidate)}`);
    }
  }

  console.log("");
  console.log(`wouldShowConfirmSourceButton: ${buttonEligibility.wouldShow ? "yes" : "no"}`);
  for (const reason of buttonEligibility.reasons) {
    console.log(`- ${reason}`);
  }

  if (
    action.execution_status === "not_started" &&
    latestDryRun &&
    action.updated_at > latestDryRun.created_at
  ) {
    console.log("");
    console.log("queueHint: action updated after latest dry_run — repeat check may be pending.");
    console.log("localRunnerCommand: npm run tp-actions-once");
  }
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
