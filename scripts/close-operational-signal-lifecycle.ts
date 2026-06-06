import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildCloseEvidenceSnapshot,
  buildOperationalSignalLifecycleCloseDryRunFingerprint,
  buildOperationalSignalLifecycleCloseToken,
  collectOperationalSignalLifecycleCloseReasonCodes,
  normalizeCoachCloseReason,
  parseOperationalSignalLifecycleCloseToken,
  validateOperationalSignalLifecycleCloseEligibility,
} from "@/features/trainingpeaks/operational-signal-lifecycle-close";
import {
  buildOperationalSignalLifecycleApplyToken,
  buildOperationalSignalLifecycleDryRunFingerprint,
  collectOperationalSignalLifecycleReasonCodes,
} from "@/features/trainingpeaks/operational-signal-lifecycle-apply";
import type { TrainingPeaksOperationalSignalLifecycleTransition } from "@/features/trainingpeaks/repository";
import {
  applyTrainingPeaksOperationalSignalLifecycleTransition,
  getLatestTrainingPeaksOperationalSignalLifecycleTransition,
  getTrainingPeaksOperationalSignalById,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
} from "@/features/trainingpeaks/repository";
import { evaluateLifecycleFromEvidence } from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[close-operational-signal-lifecycle]";

type CliOptions = {
  signalId: string | null;
  asOfDate: string;
  reason: string | null;
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
    reason: null,
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
    if (arg.startsWith("--reason=")) {
      options.reason = arg.slice("--reason=".length).trim();
      continue;
    }
    if (arg === "--reason") {
      const next = argv[index + 1];
      if (!next || next.trim().startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --reason`);
      }
      options.reason = next.trim();
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
      throw new Error(`${LOG_PREFIX} FAIL: broad student close is not supported; use exactly one --signal-id`);
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
  if (options.apply && !options.reason) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires --reason`);
  }
  return options;
}

async function loadLatestTransitionSafe(
  signalId: string
): Promise<TrainingPeaksOperationalSignalLifecycleTransition | null> {
  try {
    return await getLatestTrainingPeaksOperationalSignalLifecycleTransition(signalId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("lifecycle_transitions table is missing")) {
      return null;
    }
    throw error;
  }
}

function buildMonitoringApplyCommand(input: {
  signalId: string;
  asOfDate: string;
  signalType: string;
  signalClass: string;
  currentLifecycle: string;
  proposedLifecycle: string;
  lifecycleInput: ReturnType<typeof evaluateLifecycleFromEvidence>["lifecycleInput"];
  proposal: ReturnType<typeof evaluateLifecycleFromEvidence>["proposal"];
  asOfDateForApply: string;
}): string {
  const reasonCodes = collectOperationalSignalLifecycleReasonCodes({
    proposal: input.proposal,
    lifecycleInput: input.lifecycleInput,
  });
  const dryRunFingerprint = buildOperationalSignalLifecycleDryRunFingerprint({
    signalId: input.signalId,
    signalType: input.signalType,
    signalClass: input.lifecycleInput.signalClass,
    currentLifecycle: input.lifecycleInput.currentLifecycle,
    proposedLifecycle: input.proposal.proposedLifecycle,
    latestTpCompletionAfterOpen: input.lifecycleInput.latestTpCompletionAfterOpen
      ? {
          workoutId: input.lifecycleInput.latestTpCompletionAfterOpen.workoutId,
          workoutDate: input.lifecycleInput.latestTpCompletionAfterOpen.workoutDate,
          title: input.lifecycleInput.latestTpCompletionAfterOpen.title ?? null,
          sportOrTypeCode: input.lifecycleInput.latestTpCompletionAfterOpen.sportOrTypeCode ?? null,
          runningCompletionClass: input.lifecycleInput.latestTpCompletionAfterOpen.runningCompletionClass,
          sportClass: input.lifecycleInput.latestTpCompletionAfterOpen.sportClass,
          evidenceFreshness: input.lifecycleInput.latestTpCompletionAfterOpen.evidenceFreshness,
          classificationConfidence: input.lifecycleInput.latestTpCompletionAfterOpen.classificationConfidence,
        }
      : null,
    hasNegativeAfterCompletion: Boolean(input.lifecycleInput.negativeMessageAfterCompletion),
    missedOrSkippedReturnWorkout: Boolean(input.lifecycleInput.missedOrSkippedReturnWorkout),
    reasonCodes,
    asOfDate: input.asOfDateForApply,
  });
  const applyToken = buildOperationalSignalLifecycleApplyToken({
    signalId: input.signalId,
    proposedLifecycle: input.proposal.proposedLifecycle,
    dryRunFingerprint,
  });
  return `npm run apply-operational-signal-lifecycle -- --signal-id ${input.signalId} --as-of ${input.asOfDate} --apply --confirm "${applyToken}"`;
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
  const latestTransition = await loadLatestTransitionSafe(signal.id);
  const coachReasonNormalized = normalizeCoachCloseReason(options.reason ?? "");
  const storedLifecycle = signal.lifecycleState ?? "active_problem";

  const eligibility = validateOperationalSignalLifecycleCloseEligibility({
    storedLifecycleState: signal.lifecycleState,
    requiresCoachClose: signal.requiresCoachClose,
    signalClass: lifecycleInput.signalClass,
    lifecycleInput,
    proposal,
    coachReason: coachReasonNormalized,
    applyMode: options.apply,
  });

  const dryRunFingerprint = buildOperationalSignalLifecycleCloseDryRunFingerprint({
    signalId: signal.id,
    signalType: signal.signalType,
    signalClass: lifecycleInput.signalClass,
    currentLifecycle: storedLifecycle === "resolved" ? "monitoring_after_return" : storedLifecycle,
    targetLifecycle: "resolved",
    latestTransitionId: latestTransition?.id ?? null,
    latestTransitionFingerprint: latestTransition?.dryRunFingerprint ?? null,
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
    coachReasonNormalized,
    asOfDate: options.asOfDate,
  });
  const closeToken = buildOperationalSignalLifecycleCloseToken({
    signalId: signal.id,
    dryRunFingerprint,
  });
  const closeCommand = `npm run close-operational-signal-lifecycle -- --signal-id ${signal.id} --as-of ${options.asOfDate} --reason "${coachReasonNormalized || "coach reviewed return after illness"}" --apply --confirm "${closeToken}"`;
  const monitoringApplyCommand =
    eligibility.ok === false && eligibility.suggestApplyMonitoring
      ? buildMonitoringApplyCommand({
          signalId: signal.id,
          asOfDate: options.asOfDate,
          signalType: signal.signalType,
          signalClass: lifecycleInput.signalClass,
          currentLifecycle: storedLifecycle,
          proposedLifecycle: proposal.proposedLifecycle,
          lifecycleInput,
          proposal,
          asOfDateForApply: options.asOfDate,
        })
      : null;

  if (!options.apply) {
    console.log(`${LOG_PREFIX} mode=dry-run`);
    console.log(`signal_id: ${signal.id}`);
    console.log(`current_lifecycle: ${storedLifecycle}`);
    console.log(`proposed_target_lifecycle: resolved`);
    console.log(
      `close_eligibility: ${
        eligibility.ok
          ? eligibility.kind === "already_resolved"
            ? "already_resolved_idempotent"
            : "eligible"
          : "refused"
      }`
    );
    if (!eligibility.ok) {
      console.log(`close_refusal_reason: ${eligibility.reason}`);
      if (monitoringApplyCommand) {
        console.log(`suggested_apply_monitoring_command: ${monitoringApplyCommand}`);
      }
    }
    console.log(`reason: ${coachReasonNormalized || "(not provided; required for apply)"}`);
    console.log(
      `evidence_snapshot: ${JSON.stringify(
        buildCloseEvidenceSnapshot({
          lifecycleInput,
          proposal,
          coachReasonNormalized,
          latestTransitionId: latestTransition?.id ?? null,
          latestTransitionFingerprint: latestTransition?.dryRunFingerprint ?? null,
        })
      )}`
    );
    console.log(`would_write: false`);
    console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
    console.log(`close_token: ${closeToken}`);
    console.log(`close_command: ${closeCommand}`);
    return;
  }

  if (!eligibility.ok) {
    if (eligibility.suggestApplyMonitoring && monitoringApplyCommand) {
      throw new Error(
        `${LOG_PREFIX} FAIL: ${eligibility.reason} Suggested command: ${monitoringApplyCommand}`
      );
    }
    throw new Error(`${LOG_PREFIX} FAIL: close eligibility refused: ${eligibility.reason}`);
  }

  if (eligibility.kind === "already_resolved") {
    const existingTransition = await loadLatestTransitionSafe(signal.id);
    if (
      existingTransition &&
      existingTransition.toLifecycleState === "resolved" &&
      existingTransition.dryRunFingerprint === dryRunFingerprint
    ) {
      console.log(`${LOG_PREFIX} mode=apply`);
      console.log(`signal_id: ${signal.id}`);
      console.log(`outcome: idempotent`);
      console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
      console.log(`close_token: ${closeToken}`);
      return;
    }
    throw new Error(`${LOG_PREFIX} FAIL: signal is already resolved with a different close fingerprint`);
  }

  const parsedToken = parseOperationalSignalLifecycleCloseToken(options.confirm ?? "");
  if (!parsedToken) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --confirm token format`);
  }
  if (parsedToken.signalId !== signal.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token signal id mismatch`);
  }
  if (parsedToken.dryRunFingerprint !== dryRunFingerprint) {
    throw new Error(`${LOG_PREFIX} FAIL: token fingerprint mismatch due to evidence drift`);
  }
  if (options.confirm !== closeToken) {
    throw new Error(`${LOG_PREFIX} FAIL: --confirm must exactly match the generated close token`);
  }

  const reasonCodes = collectOperationalSignalLifecycleCloseReasonCodes({
    signalClass: lifecycleInput.signalClass,
    lifecycleInput,
    coachReasonNormalized,
  });
  const evidenceSnapshot = buildCloseEvidenceSnapshot({
    lifecycleInput,
    proposal,
    coachReasonNormalized,
    latestTransitionId: latestTransition?.id ?? null,
    latestTransitionFingerprint: latestTransition?.dryRunFingerprint ?? null,
  });

  const result = await applyTrainingPeaksOperationalSignalLifecycleTransition({
    signalId: signal.id,
    studentId: signal.studentId,
    fromLifecycleState: "monitoring_after_return",
    toLifecycleState: "resolved",
    reason: "coach_reviewed_close",
    reasonCodes,
    actor: "coach",
    evidenceSnapshot,
    dryRunFingerprint,
    lifecycleMetaPatch: {
      dry_run_fingerprint: dryRunFingerprint,
      reason_codes: reasonCodes,
      close_script: "close-operational-signal-lifecycle",
      as_of: options.asOfDate,
      coach_reason: coachReasonNormalized,
    },
    requiresCoachClose: false,
    resolvedReason: coachReasonNormalized,
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
  console.log(`close_token: ${closeToken}`);
}

if (process.argv[1] && process.argv[1].endsWith("close-operational-signal-lifecycle.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
