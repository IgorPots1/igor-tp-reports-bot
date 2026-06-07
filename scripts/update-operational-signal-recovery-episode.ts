import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { OperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  buildRecoveryEpisodeApplyToken,
  buildRecoveryEpisodeDisplaySummary,
  buildRecoveryEpisodeDryRunFingerprint,
  buildRecoveryEpisodeUpdateMeta,
  isRecoveryEpisodeClassifierResult,
  parseRecoveryEpisodeApplyToken,
  resolveDefaultRecoveryTargetAction,
  resolveRecoveryLifecycleAfterApply,
  validateRecoveryEpisodeApplySafety,
  type RecoveryEpisodeEvidenceKind,
  type RecoveryEpisodeTargetAction,
} from "@/features/trainingpeaks/operational-signal-recovery-episode-apply";
import {
  getSupersededBySignalIdFromSignal,
  resolveSignalDisplaySummary,
} from "@/features/trainingpeaks/operational-signal-supersede-apply";
import {
  applyTrainingPeaksOperationalSignalRecoveryEpisodeUpdate,
  getTrainingPeaksOperationalSignalById,
  getTrainingPeaksTelegramContextObservationById,
} from "@/features/trainingpeaks/repository";
import { classifyObservation } from "./diagnose-recovery-trigger-gaps";
import {
  classifyRecoveryEvidenceKind,
  classifySignal,
  getSignalLifecycle,
} from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[update-operational-signal-recovery-episode]";
const DEFAULT_AS_OF = "2026-06-07";

type CliOptions = {
  signalId: string | null;
  observationId: string | null;
  asOfDate: string;
  targetLifecycleOverride: OperationalSignalLifecycle | null;
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
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --as-of value: ${raw}`);
  }
  return normalized;
}

function parseTargetLifecycle(raw: string): OperationalSignalLifecycle {
  const normalized = raw.trim();
  if (
    normalized === "return_planned" ||
    normalized === "monitoring_after_return" ||
    normalized === "resolved" ||
    normalized === "active_problem" ||
    normalized === "return_trial_completed"
  ) {
    return normalized;
  }
  throw new Error(`${LOG_PREFIX} FAIL: invalid --target-lifecycle value: ${raw}`);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    signalId: null,
    observationId: null,
    asOfDate: DEFAULT_AS_OF,
    targetLifecycleOverride: null,
    apply: false,
    confirm: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg.startsWith("--signal-id=")) {
      options.signalId = arg.slice("--signal-id=".length).trim();
      continue;
    }
    if (arg === "--signal-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-id`);
      }
      options.signalId = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--observation-id=")) {
      options.observationId = arg.slice("--observation-id=".length).trim();
      continue;
    }
    if (arg === "--observation-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --observation-id`);
      }
      options.observationId = next;
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
    if (arg.startsWith("--target-lifecycle=")) {
      options.targetLifecycleOverride = parseTargetLifecycle(arg.slice("--target-lifecycle=".length));
      continue;
    }
    if (arg === "--target-lifecycle") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --target-lifecycle`);
      }
      options.targetLifecycleOverride = parseTargetLifecycle(next);
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
      throw new Error(`${LOG_PREFIX} FAIL: broad student apply is not supported; use explicit signal/observation ids`);
    }
  }

  if (!options.signalId) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --signal-id`);
  }
  if (!options.observationId) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --observation-id`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires exact --confirm token`);
  }
  return options;
}

function resolveSignalOpenTime(signal: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksOperationalSignalById>>>): string {
  return signal.validFrom ?? signal.createdAt;
}

function shortenText(text: string | null, maxLength = 96): string | null {
  if (!text) {
    return null;
  }
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function resolveTargetAction(input: {
  classifierResult: ReturnType<typeof classifyObservation>["classifierResult"];
  currentLifecycle: OperationalSignalLifecycle;
  targetLifecycleOverride: OperationalSignalLifecycle | null;
}): RecoveryEpisodeTargetAction {
  if (input.targetLifecycleOverride === "return_planned") {
    return "return_planned";
  }
  if (input.targetLifecycleOverride === "monitoring_after_return") {
    return "monitoring_after_return";
  }
  if (input.targetLifecycleOverride === "resolved") {
    return "resolved_candidate";
  }
  if (!isRecoveryEpisodeClassifierResult(input.classifierResult)) {
    return "display_refresh_only";
  }
  return resolveDefaultRecoveryTargetAction({
    classifierResult: input.classifierResult,
    currentLifecycle: input.currentLifecycle,
  });
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const signal = await getTrainingPeaksOperationalSignalById(options.signalId!);
  if (!signal) {
    console.log(`${LOG_PREFIX} refused: source signal does not exist`);
    process.exitCode = 1;
    return;
  }

  const observation = await getTrainingPeaksTelegramContextObservationById(options.observationId!);
  if (!observation) {
    console.log(`${LOG_PREFIX} refused: source observation is missing`);
    process.exitCode = 1;
    return;
  }

  const currentLifecycle = getSignalLifecycle(signal);
  const currentDisplay = resolveSignalDisplaySummary(signal);
  const signalClass = classifySignal(signal);
  const classified = classifyObservation({
    observation,
    studentId: signal.studentId,
  });
  const observationText = `${observation.textPreview ?? ""}`.trim();
  const classifierResult = classified.classifierResult;
  const evidenceKind: RecoveryEpisodeEvidenceKind = classifyRecoveryEvidenceKind({
    classifierSignalType: classifierResult,
    text: observationText,
    plannedAttemptDate: classified.plannedAttemptDate,
  });
  const targetAction = resolveTargetAction({
    classifierResult,
    currentLifecycle,
    targetLifecycleOverride: options.targetLifecycleOverride,
  });

  if (!isRecoveryEpisodeClassifierResult(classifierResult)) {
    console.log(`${LOG_PREFIX} refused: classifier result is not recovery/return (${classifierResult ?? "none"})`);
    process.exitCode = 1;
    return;
  }

  const proposedDisplaySummary = buildRecoveryEpisodeDisplaySummary({
    observationText,
    classifierResult,
  });
  const proposedLifecycle = resolveRecoveryLifecycleAfterApply({
    currentLifecycle,
    targetAction,
    requestedLifecycleOverride: options.targetLifecycleOverride,
  });
  const dryRunFingerprint = buildRecoveryEpisodeDryRunFingerprint({
    signalId: signal.id,
    observationId: observation.id,
    studentId: signal.studentId,
    currentLifecycle,
    currentDisplaySummary: currentDisplay,
    observationObservedAt: observation.observedAt,
    observationTextHash: observation.textSha256,
    classifierResult,
    proposedDisplaySummary,
    proposedLifecycleTarget: targetAction,
    asOfDate: options.asOfDate,
  });
  const applyToken = buildRecoveryEpisodeApplyToken({
    signalId: signal.id,
    observationId: observation.id,
    targetAction,
    dryRunFingerprint,
  });
  const applyCommand = `npm run update-operational-signal-recovery-episode -- --signal-id ${signal.id} --observation-id ${observation.id} --as-of ${options.asOfDate} --apply --confirm "${applyToken}"`;

  const safety = validateRecoveryEpisodeApplySafety({
    signal,
    observationStudentId: observation.studentId,
    observationObservedAt: observation.observedAt,
    signalOpenTime: resolveSignalOpenTime(signal),
    classifierResult,
    signalClass,
    proposedDisplaySummary,
    proposedLifecycleTarget: targetAction,
    requestedLifecycleOverride: options.targetLifecycleOverride,
    supersededBySignalId: getSupersededBySignalIdFromSignal(signal),
  });

  if (safety.decision === "refused") {
    console.log(`${LOG_PREFIX} refused: ${safety.reason}`);
    console.log(`signal_id: ${signal.id}`);
    console.log(`observation_id: ${observation.id}`);
    console.log(`current_display_summary: ${currentDisplay ?? "null"}`);
    console.log(`classifier_result: ${classifierResult}`);
    console.log(`proposed_display_summary: ${proposedDisplaySummary}`);
    console.log(`proposed_lifecycle_action: ${targetAction}`);
    process.exitCode = 1;
    return;
  }

  if (!options.apply) {
    console.log(`${LOG_PREFIX} mode=dry-run`);
    console.log(`signal_id: ${signal.id}`);
    console.log(`student_id: ${signal.studentId}`);
    console.log(`signal_type: ${signal.signalType}`);
    console.log(`signal_class: ${signalClass}`);
    console.log(`current_lifecycle: ${currentLifecycle}`);
    console.log(`current_display_summary: ${currentDisplay ?? "null"}`);
    console.log(`observation_id: ${observation.id}`);
    console.log(`observation_at: ${observation.observedAt}`);
    console.log(`observation_text_short: ${shortenText(observationText)}`);
    console.log(`classifier_result: ${classifierResult}`);
    console.log(`recovery_evidence_kind: ${evidenceKind}`);
    console.log(`proposed_display_summary: ${proposedDisplaySummary}`);
    console.log(`proposed_lifecycle_action: ${targetAction}`);
    console.log(`proposed_lifecycle_after_apply: ${proposedLifecycle}`);
    console.log(`safety: ${safety.reason}`);
    console.log(`would_write: false`);
    console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
    console.log(`apply_token: ${applyToken}`);
    console.log(`apply_command: ${applyCommand}`);
    return;
  }

  const parsedToken = parseRecoveryEpisodeApplyToken(options.confirm ?? "");
  if (!parsedToken) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --confirm token format`);
  }
  if (parsedToken.signalId !== signal.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token signal id mismatch`);
  }
  if (parsedToken.observationId !== observation.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token observation id mismatch`);
  }
  if (parsedToken.targetAction !== targetAction) {
    throw new Error(`${LOG_PREFIX} FAIL: token target action mismatch due to proposal drift`);
  }
  if (parsedToken.dryRunFingerprint !== dryRunFingerprint) {
    throw new Error(`${LOG_PREFIX} FAIL: token fingerprint mismatch due to evidence drift`);
  }
  if (options.confirm !== applyToken) {
    throw new Error(`${LOG_PREFIX} FAIL: --confirm must exactly match the generated apply token`);
  }

  const appliedAt = new Date().toISOString();
  const recoveryUpdateMeta = buildRecoveryEpisodeUpdateMeta({
    observationId: observation.id,
    observationObservedAt: observation.observedAt,
    classifierResult,
    evidenceKind,
    previousDisplaySummary: currentDisplay,
    updatedDisplaySummary: proposedDisplaySummary,
    appliedAt,
    dryRunFingerprint,
    targetAction,
    lifecycleBefore: currentLifecycle,
    lifecycleAfter: proposedLifecycle,
  });

  const result = await applyTrainingPeaksOperationalSignalRecoveryEpisodeUpdate({
    signalId: signal.id,
    studentId: signal.studentId,
    fromLifecycleState: currentLifecycle,
    toLifecycleState: proposedLifecycle,
    fromDisplaySummary: currentDisplay,
    updatedDisplaySummary: proposedDisplaySummary,
    dryRunFingerprint,
    recoveryUpdateMeta,
    appliedAt,
  });

  console.log(`${LOG_PREFIX} mode=apply`);
  console.log(`signal_id: ${signal.id}`);
  console.log(`outcome: ${result.outcome}`);
  console.log(
    `before_after: ${JSON.stringify(
      {
        before: {
          lifecycle_state: result.before.lifecycleState ?? "active_problem",
          display_summary: resolveSignalDisplaySummary(result.before),
        },
        after: {
          lifecycle_state: result.after.lifecycleState ?? "active_problem",
          display_summary: resolveSignalDisplaySummary(result.after),
        },
      },
      null,
      2
    )}`
  );
  console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
  console.log(`applied_token: ${applyToken}`);
}

if (process.argv[1] && process.argv[1].endsWith("update-operational-signal-recovery-episode.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
