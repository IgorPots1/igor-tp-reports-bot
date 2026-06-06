import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildOperationalSignalLifecycleApplyToken,
  buildOperationalSignalLifecycleDryRunFingerprint,
  collectOperationalSignalLifecycleReasonCodes,
  parseOperationalSignalLifecycleApplyToken,
  validateOperationalSignalLifecycleApplySafety,
} from "@/features/trainingpeaks/operational-signal-lifecycle-apply";
import {
  applyTrainingPeaksOperationalSignalLifecycleTransition,
  getTrainingPeaksOperationalSignalById,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
} from "@/features/trainingpeaks/repository";
import {
  evaluateLifecycleFromEvidence,
} from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[apply-operational-signal-lifecycle]";

type CliOptions = {
  signalId: string | null;
  asOfDate: string;
  apply: boolean;
  confirm: string | null;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseAsOfDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --as-of value: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    signalId: null,
    asOfDate: new Date().toISOString().slice(0, 10),
    apply: false,
    confirm: null,
  };
  const signalIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg.startsWith("--signal-id=")) {
      signalIds.push(arg.slice("--signal-id=".length).trim());
      continue;
    }
    if (arg === "--signal-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-id`);
      }
      signalIds.push(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      options.asOfDate = parseAsOfDate(arg.slice("--as-of=".length));
      continue;
    }
    if (arg === "--as-of") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --as-of`);
      }
      options.asOfDate = parseAsOfDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      options.confirm = arg.slice("--confirm=".length).trim();
      continue;
    }
    if (arg === "--confirm") {
      const next = argv[index + 1];
      if (!next || next.trim().startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --confirm`);
      }
      options.confirm = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--student")) {
      throw new Error(`${LOG_PREFIX} FAIL: broad student apply is not supported; use exactly one --signal-id`);
    }
  }
  const normalizedSignalIds = signalIds.map((value) => value.trim()).filter(Boolean);
  if (normalizedSignalIds.length !== 1) {
    if (normalizedSignalIds.length === 0) {
      throw new Error(`${LOG_PREFIX} FAIL: missing required --signal-id`);
    }
    throw new Error(`${LOG_PREFIX} FAIL: multiple --signal-id values are not allowed`);
  }
  options.signalId = normalizedSignalIds[0]!;
  if (options.apply && !options.confirm) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires exact --confirm token`);
  }
  return options;
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const signal = await getTrainingPeaksOperationalSignalById(options.signalId!);
  if (!signal) {
    throw new Error(`${LOG_PREFIX} FAIL: signal not found: ${options.signalId}`);
  }
  const openedDate = signal.createdAt.slice(0, 10);
  const workouts = await listTrainingPeaksWorkoutCacheForStudentDateRange({
    studentId: signal.studentId,
    from: openedDate,
    to: options.asOfDate,
  });
  const observations = await listTrainingPeaksTelegramContextObservationsForStudent(signal.studentId, 250);
  const evaluation = evaluateLifecycleFromEvidence({
    signal,
    asOfDate: options.asOfDate,
    workouts,
    observations,
  });
  const lifecycleInput = evaluation.lifecycleInput;
  const proposal = evaluation.proposal;
  const reasonCodes = collectOperationalSignalLifecycleReasonCodes({
    proposal,
    lifecycleInput,
  });
  const dryRunFingerprint = buildOperationalSignalLifecycleDryRunFingerprint({
    signalId: signal.id,
    signalType: signal.signalType,
    signalClass: lifecycleInput.signalClass,
    currentLifecycle: lifecycleInput.currentLifecycle,
    proposedLifecycle: proposal.proposedLifecycle,
    latestTpCompletionAfterOpen: lifecycleInput.latestTpCompletionAfterOpen
      ? {
          workoutId: lifecycleInput.latestTpCompletionAfterOpen.workoutId,
          workoutDate: lifecycleInput.latestTpCompletionAfterOpen.workoutDate,
          title: lifecycleInput.latestTpCompletionAfterOpen.title ?? null,
          sportOrTypeCode: lifecycleInput.latestTpCompletionAfterOpen.sportOrTypeCode ?? null,
          runningCompletionClass: lifecycleInput.latestTpCompletionAfterOpen.runningCompletionClass,
          sportClass: lifecycleInput.latestTpCompletionAfterOpen.sportClass,
          evidenceFreshness: lifecycleInput.latestTpCompletionAfterOpen.evidenceFreshness,
          classificationConfidence: lifecycleInput.latestTpCompletionAfterOpen.classificationConfidence,
        }
      : null,
    hasNegativeAfterCompletion: Boolean(lifecycleInput.negativeMessageAfterCompletion),
    missedOrSkippedReturnWorkout: Boolean(lifecycleInput.missedOrSkippedReturnWorkout),
    reasonCodes,
    asOfDate: options.asOfDate,
  });
  const applyToken = buildOperationalSignalLifecycleApplyToken({
    signalId: signal.id,
    proposedLifecycle: proposal.proposedLifecycle,
    dryRunFingerprint,
  });
  const applyCommand = `npm run apply-operational-signal-lifecycle -- --signal-id ${signal.id} --as-of ${options.asOfDate} --apply --confirm "${applyToken}"`;

  if (!options.apply) {
    console.log(`${LOG_PREFIX} mode=dry-run`);
    console.log(`signal_id: ${signal.id}`);
    console.log(`current_lifecycle: ${lifecycleInput.currentLifecycle}`);
    console.log(`proposed_lifecycle: ${proposal.proposedLifecycle}`);
    console.log(`reason: ${proposal.reason}`);
    console.log(`evidence_snapshot: ${JSON.stringify(proposal.evidenceRefs)}`);
    console.log(`would_write: false`);
    console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
    console.log(`apply_token: ${applyToken}`);
    console.log(`apply_command: ${applyCommand}`);
    return;
  }

  const parsedToken = parseOperationalSignalLifecycleApplyToken(options.confirm ?? "");
  if (!parsedToken) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --confirm token format`);
  }
  if (parsedToken.signalId !== signal.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token signal id mismatch`);
  }
  if (parsedToken.proposedLifecycle !== proposal.proposedLifecycle) {
    throw new Error(`${LOG_PREFIX} FAIL: token proposed lifecycle mismatch due to proposal drift`);
  }
  if (parsedToken.dryRunFingerprint !== dryRunFingerprint) {
    throw new Error(`${LOG_PREFIX} FAIL: token fingerprint mismatch due to evidence drift`);
  }
  if (options.confirm !== applyToken) {
    throw new Error(`${LOG_PREFIX} FAIL: --confirm must exactly match the generated apply token`);
  }

  const safety = validateOperationalSignalLifecycleApplySafety({
    signalClass: lifecycleInput.signalClass,
    lifecycleInput,
    proposal,
  });
  if (!safety.ok) {
    throw new Error(`${LOG_PREFIX} FAIL: unsafe transition blocked: ${safety.reason}`);
  }

  const result = await applyTrainingPeaksOperationalSignalLifecycleTransition({
    signalId: signal.id,
    studentId: signal.studentId,
    fromLifecycleState: lifecycleInput.currentLifecycle,
    toLifecycleState: proposal.proposedLifecycle,
    reason: proposal.reason,
    reasonCodes,
    actor: "manual_apply_script_v1",
    evidenceSnapshot: proposal.evidenceRefs,
    dryRunFingerprint,
    lifecycleMetaPatch: {
      dry_run_fingerprint: dryRunFingerprint,
      reason_codes: reasonCodes,
      apply_script: "apply-operational-signal-lifecycle",
      as_of: options.asOfDate,
    },
    requiresCoachClose: Boolean(proposal.requiresCoachClose),
    resolvedReason: proposal.proposedLifecycle === "resolved" ? proposal.reason : null,
  });

  console.log(`${LOG_PREFIX} mode=apply`);
  console.log(`signal_id: ${signal.id}`);
  console.log(`outcome: ${result.outcome}`);
  console.log(
    `before_after: ${JSON.stringify(
      {
        before: {
          lifecycle_state: result.before.lifecycleState ?? "active_problem",
          requires_coach_close: result.before.requiresCoachClose,
          resolved_at: result.before.resolvedAt,
          resolved_reason: result.before.resolvedReason,
        },
        after: {
          lifecycle_state: result.after.lifecycleState ?? "active_problem",
          requires_coach_close: result.after.requiresCoachClose,
          resolved_at: result.after.resolvedAt,
          resolved_reason: result.after.resolvedReason,
        },
      },
      null,
      2
    )}`
  );
  console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
  console.log(`applied_token: ${applyToken}`);
}

if (process.argv[1] && process.argv[1].endsWith("apply-operational-signal-lifecycle.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
