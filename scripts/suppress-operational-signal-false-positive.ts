import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildFalsePositiveSuppressionApplyToken,
  buildFalsePositiveSuppressionDryRunFingerprint,
  buildFalsePositiveSuppressionMeta,
  classifySourceForFalsePositiveSuppression,
  hashSourceText,
  inferFalsePositiveSuppressionReason,
  normalizeFalsePositiveSuppressionReason,
  parseFalsePositiveSuppressionApplyToken,
  resolveClassifierAfterFixLabel,
  resolvePreviousDisplaySummary,
  validateFalsePositiveSuppressionSafety,
  type FalsePositiveSuppressionReason,
} from "@/features/trainingpeaks/operational-signal-false-positive-suppression";
import {
  applyTrainingPeaksOperationalSignalFalsePositiveSuppression,
  getTrainingPeaksOperationalSignalById,
  getTrainingPeaksTelegramContextObservationById,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[suppress-operational-signal-false-positive]";

type CliOptions = {
  signalId: string | null;
  sourceObservationId: string | null;
  reason: string | null;
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
    sourceObservationId: null,
    reason: null,
    asOfDate: new Date().toISOString().slice(0, 10),
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
    if (arg.startsWith("--source-observation-id=")) {
      options.sourceObservationId = arg.slice("--source-observation-id=".length).trim();
      continue;
    }
    if (arg === "--source-observation-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --source-observation-id`);
      }
      options.sourceObservationId = next;
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
      throw new Error(`${LOG_PREFIX} FAIL: broad student suppression is not supported; use explicit signal ids`);
    }
  }

  if (!options.signalId) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --signal-id`);
  }
  if (!options.sourceObservationId) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --source-observation-id`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires exact --confirm token`);
  }
  return options;
}

function resolveReason(options: CliOptions, sourceText: string | null): FalsePositiveSuppressionReason {
  if (options.reason) {
    const normalized = normalizeFalsePositiveSuppressionReason(options.reason);
    if (!normalized) {
      throw new Error(
        `${LOG_PREFIX} FAIL: invalid --reason; expected negated_pain_cue, figurative_idiom, quoted_idiom, completed_run_reflection_not_schedule, or manual_review`
      );
    }
    return normalized;
  }
  const inferred = inferFalsePositiveSuppressionReason(sourceText);
  if (!inferred) {
    throw new Error(
      `${LOG_PREFIX} FAIL: could not infer false-positive reason from source text; pass explicit --reason after manual review`
    );
  }
  return inferred;
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const signal = await getTrainingPeaksOperationalSignalById(options.signalId!);
  if (!signal) {
    throw new Error(`${LOG_PREFIX} FAIL: signal not found: ${options.signalId}`);
  }

  const observation = await getTrainingPeaksTelegramContextObservationById(options.sourceObservationId!);
  if (!observation) {
    throw new Error(`${LOG_PREFIX} FAIL: source observation not found: ${options.sourceObservationId}`);
  }

  const classification = classifySourceForFalsePositiveSuppression(observation);
  const reason = resolveReason(options, observation.textPreview);
  const previousDisplaySummary = resolvePreviousDisplaySummary(signal);
  const sourceTextHash = hashSourceText(observation.textPreview);
  const dryRunFingerprint = buildFalsePositiveSuppressionDryRunFingerprint({
    signalId: signal.id,
    sourceObservationId: observation.id,
    studentId: signal.studentId,
    signalType: signal.signalType,
    lifecycleState: signal.lifecycleState,
    displaySummary: previousDisplaySummary,
    sourceTextHash,
    reason,
    classifierPrimaryBucket: classification.primary_bucket,
    asOfDate: options.asOfDate,
  });
  const validation = validateFalsePositiveSuppressionSafety({
    signal,
    observation,
    sourceObservationId: options.sourceObservationId!,
    reason,
    classification,
    dryRunFingerprint,
  });
  const applyToken = buildFalsePositiveSuppressionApplyToken({
    signalId: signal.id,
    sourceObservationId: observation.id,
    dryRunFingerprint,
  });
  const applyCommand = `npm run suppress-operational-signal-false-positive -- --signal-id ${signal.id} --source-observation-id ${observation.id} --reason ${reason} --as-of ${options.asOfDate} --apply --confirm "${applyToken}"`;

  if (!options.apply) {
    console.log(`${LOG_PREFIX} mode=dry-run`);
    console.log(
      `signal: ${JSON.stringify(
        {
          id: signal.id,
          student_id: signal.studentId,
          signal_type: signal.signalType,
          lifecycle_state: signal.lifecycleState ?? "active_problem",
          display_summary: previousDisplaySummary,
          source_observation_id: signal.sourceObservationId,
          resolved_at: signal.resolvedAt,
          resolved_reason: signal.resolvedReason,
        },
        null,
        2
      )}`
    );
    console.log(
      `source_observation: ${JSON.stringify(
        {
          id: observation.id,
          student_id: observation.studentId,
          observed_at: observation.observedAt,
          text_preview: observation.textPreview,
          text_hash: sourceTextHash,
        },
        null,
        2
      )}`
    );
    console.log(
      `classifier: ${JSON.stringify(
        {
          primary_bucket: classification.primary_bucket,
          signal_type: classification.signal_type,
          reason: classification.reason,
          classifier_after_fix: resolveClassifierAfterFixLabel(classification),
        },
        null,
        2
      )}`
    );
    console.log(`false_positive_reason: ${reason}`);
    console.log(
      `proposed_update: ${JSON.stringify(
        {
          lifecycle_state: "resolved",
          resolved_reason: `false_positive:${reason}`,
          requires_coach_close: false,
          lifecycle_meta: {
            false_positive_suppression: buildFalsePositiveSuppressionMeta({
              sourceObservationId: observation.id,
              sourceObservationAt: observation.observedAt,
              sourceText: observation.textPreview,
              reason,
              previousDisplaySummary,
              classifierAfterFix: resolveClassifierAfterFixLabel(classification),
              dryRunFingerprint,
              suppressedAt: "(apply-time)",
            }),
          },
        },
        null,
        2
      )}`
    );
    console.log(`decision: ${validation.decision}`);
    console.log(`decision_reason: ${validation.reason}`);
    console.log(`would_write: false`);
    console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
    if (validation.decision === "allowed") {
      console.log(`apply_token: ${applyToken}`);
      console.log(`apply_command: ${applyCommand}`);
    } else {
      console.log(`apply_token: (not issued; decision=${validation.decision})`);
      console.log(`apply_command: (blocked)`);
      process.exitCode = 1;
    }
    return;
  }

  if (validation.decision !== "allowed") {
    throw new Error(`${LOG_PREFIX} FAIL: apply blocked (${validation.decision}): ${validation.reason}`);
  }

  const parsedToken = parseFalsePositiveSuppressionApplyToken(options.confirm ?? "");
  if (!parsedToken) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --confirm token format`);
  }
  if (parsedToken.signalId !== signal.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token signal id mismatch`);
  }
  if (parsedToken.sourceObservationId !== observation.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token source observation id mismatch`);
  }
  if (parsedToken.dryRunFingerprint !== dryRunFingerprint) {
    throw new Error(`${LOG_PREFIX} FAIL: token fingerprint mismatch due to signal/source drift`);
  }
  if (options.confirm !== applyToken) {
    throw new Error(`${LOG_PREFIX} FAIL: --confirm must exactly match the generated apply token`);
  }

  const appliedAt = new Date().toISOString();
  const falsePositiveSuppressionMeta = buildFalsePositiveSuppressionMeta({
    sourceObservationId: observation.id,
    sourceObservationAt: observation.observedAt,
    sourceText: observation.textPreview,
    reason,
    previousDisplaySummary,
    classifierAfterFix: resolveClassifierAfterFixLabel(classification),
    dryRunFingerprint,
    suppressedAt: appliedAt,
  });

  const result = await applyTrainingPeaksOperationalSignalFalsePositiveSuppression({
    signalId: signal.id,
    studentId: signal.studentId,
    fromLifecycleState: signal.lifecycleState ?? "active_problem",
    reason,
    dryRunFingerprint,
    falsePositiveSuppressionMeta,
    appliedAt,
  });

  console.log(`${LOG_PREFIX} mode=apply`);
  console.log(`outcome: ${result.outcome}`);
  console.log(
    `before_after: ${JSON.stringify(
      {
        before: {
          lifecycle_state: result.before.lifecycleState ?? "active_problem",
          requires_coach_close: result.before.requiresCoachClose,
          resolved_at: result.before.resolvedAt,
          resolved_reason: result.before.resolvedReason,
          lifecycle_meta: result.before.lifecycleMeta,
        },
        after: {
          lifecycle_state: result.after.lifecycleState ?? "active_problem",
          requires_coach_close: result.after.requiresCoachClose,
          resolved_at: result.after.resolvedAt,
          resolved_reason: result.after.resolvedReason,
          lifecycle_meta: result.after.lifecycleMeta,
        },
      },
      null,
      2
    )}`
  );
  console.log(`dry_run_fingerprint: ${dryRunFingerprint}`);
  console.log(`applied_token: ${applyToken}`);
}

if (process.argv[1] && process.argv[1].endsWith("suppress-operational-signal-false-positive.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
