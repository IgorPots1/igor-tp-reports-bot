import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildOperationalSignalSupersedeApplyToken,
  buildOperationalSignalSupersedeDryRunFingerprint,
  getSupersededBySignalIdFromSignal,
  normalizeSupersedeReason,
  parseOperationalSignalSupersedeApplyToken,
  resolveSignalDisplaySummary,
  validateOperationalSignalSupersedeSafety,
} from "@/features/trainingpeaks/operational-signal-supersede-apply";
import {
  getTrainingPeaksOperationalSignalById,
  supersedeTrainingPeaksOperationalSignal,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[supersede-operational-signal]";

type CliOptions = {
  sourceSignalId: string | null;
  targetSignalId: string | null;
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
    sourceSignalId: null,
    targetSignalId: null,
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
    if (arg.startsWith("--source-signal-id=")) {
      options.sourceSignalId = arg.slice("--source-signal-id=".length).trim();
      continue;
    }
    if (arg === "--source-signal-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --source-signal-id`);
      }
      options.sourceSignalId = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target-signal-id=")) {
      options.targetSignalId = arg.slice("--target-signal-id=".length).trim();
      continue;
    }
    if (arg === "--target-signal-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --target-signal-id`);
      }
      options.targetSignalId = next;
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
      throw new Error(`${LOG_PREFIX} FAIL: broad student supersede is not supported; use explicit signal ids`);
    }
  }

  if (!options.sourceSignalId) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --source-signal-id`);
  }
  if (!options.targetSignalId) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --target-signal-id`);
  }
  if (!options.reason) {
    throw new Error(`${LOG_PREFIX} FAIL: missing required --reason`);
  }
  if (options.apply && !options.confirm) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires exact --confirm token`);
  }
  return options;
}

function formatSignalDetails(signal: Awaited<ReturnType<typeof getTrainingPeaksOperationalSignalById>>): Record<string, unknown> {
  if (!signal) {
    return { found: false };
  }
  return {
    found: true,
    id: signal.id,
    student_id: signal.studentId,
    signal_type: signal.signalType,
    lifecycle_state: signal.lifecycleState ?? "active_problem",
    display_summary: resolveSignalDisplaySummary(signal),
    superseded_by_signal_id: getSupersededBySignalIdFromSignal(signal),
    resolved_at: signal.resolvedAt,
    resolved_reason: signal.resolvedReason,
  };
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const reason = normalizeSupersedeReason(options.reason!);

  const source = await getTrainingPeaksOperationalSignalById(options.sourceSignalId!);
  if (!source) {
    throw new Error(`${LOG_PREFIX} FAIL: source signal not found: ${options.sourceSignalId}`);
  }
  const target = await getTrainingPeaksOperationalSignalById(options.targetSignalId!);
  if (!target) {
    throw new Error(`${LOG_PREFIX} FAIL: target signal not found: ${options.targetSignalId}`);
  }

  const validation = validateOperationalSignalSupersedeSafety({
    source,
    target,
    reason,
  });
  const dryRunFingerprint = buildOperationalSignalSupersedeDryRunFingerprint({
    sourceSignalId: source.id,
    targetSignalId: target.id,
    sourceStudentId: source.studentId,
    targetStudentId: target.studentId,
    sourceLifecycle: source.lifecycleState,
    targetLifecycle: target.lifecycleState,
    sourceDisplaySummary: resolveSignalDisplaySummary(source),
    targetDisplaySummary: resolveSignalDisplaySummary(target),
    reason,
    asOfDate: options.asOfDate,
  });
  const applyToken = buildOperationalSignalSupersedeApplyToken({
    sourceSignalId: source.id,
    targetSignalId: target.id,
    dryRunFingerprint,
  });
  const applyCommand = `npm run supersede-operational-signal -- --source-signal-id ${source.id} --target-signal-id ${target.id} --reason "${reason}" --as-of ${options.asOfDate} --apply --confirm "${applyToken}"`;

  if (!options.apply) {
    console.log(`${LOG_PREFIX} mode=dry-run`);
    console.log(`source_signal: ${JSON.stringify(formatSignalDetails(source), null, 2)}`);
    console.log(`target_signal: ${JSON.stringify(formatSignalDetails(target), null, 2)}`);
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
    }
    if (validation.decision === "refused") {
      process.exitCode = 1;
    }
    return;
  }

  if (validation.decision !== "allowed") {
    throw new Error(`${LOG_PREFIX} FAIL: apply blocked (${validation.decision}): ${validation.reason}`);
  }

  const parsedToken = parseOperationalSignalSupersedeApplyToken(options.confirm ?? "");
  if (!parsedToken) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --confirm token format`);
  }
  if (parsedToken.sourceSignalId !== source.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token source signal id mismatch`);
  }
  if (parsedToken.targetSignalId !== target.id) {
    throw new Error(`${LOG_PREFIX} FAIL: token target signal id mismatch`);
  }
  if (parsedToken.dryRunFingerprint !== dryRunFingerprint) {
    throw new Error(`${LOG_PREFIX} FAIL: token fingerprint mismatch due to signal drift`);
  }
  if (options.confirm !== applyToken) {
    throw new Error(`${LOG_PREFIX} FAIL: --confirm must exactly match the generated apply token`);
  }

  const result = await supersedeTrainingPeaksOperationalSignal({
    sourceSignalId: source.id,
    targetSignalId: target.id,
    reason,
    dryRunFingerprint,
  });

  console.log(`${LOG_PREFIX} mode=apply`);
  console.log(`outcome: ${result.outcome}`);
  console.log(
    `before_after: ${JSON.stringify(
      {
        before: {
          lifecycle_state: result.before.lifecycleState ?? "active_problem",
          superseded_by_signal_id: getSupersededBySignalIdFromSignal(result.before),
          lifecycle_meta: result.before.lifecycleMeta,
        },
        after: {
          lifecycle_state: result.after.lifecycleState ?? "active_problem",
          superseded_by_signal_id: getSupersededBySignalIdFromSignal(result.after),
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

if (process.argv[1] && process.argv[1].endsWith("supersede-operational-signal.ts")) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
