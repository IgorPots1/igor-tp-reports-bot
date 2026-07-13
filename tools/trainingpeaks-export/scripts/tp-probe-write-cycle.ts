import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as trainingPeaksRepositoryModule from "../../../src/features/trainingpeaks/repository.ts";
import type { TrainingPeaksActionType } from "../../../src/features/trainingpeaks/repository.ts";
import * as tpApiClientModule from "../../../src/features/trainingpeaks/tp-api-client.ts";
import * as supabaseServerModule from "../../../src/features/supabase/server.ts";
import * as batchPreviewModule from "../../../src/features/trainingpeaks/batch-preview.ts";
import * as batchPreviewContextModule from "../../../src/features/trainingpeaks/batch-preview-context.ts";
import * as actionWriteTelegramCopyModule from "../../../src/features/trainingpeaks/action-write-telegram-copy.ts";
import type { BatchChildSpec } from "../../../src/features/trainingpeaks/tp-write-action-types.ts";

// CJS/ESM boundary workaround (this package is "type":"module", src/ is CJS-default):
// a plain named import of a src/ file intermittently loses named exports across this
// boundary under Node's native TS stripping. Namespace import + .default fallback is
// the established pattern — see tp-actions-once.ts.
type NamespaceWithOptionalDefault<T> = T & { default?: T };
const trainingPeaksRepositoryModuleCompat =
  trainingPeaksRepositoryModule as NamespaceWithOptionalDefault<typeof trainingPeaksRepositoryModule>;
const tpApiClientModuleCompat = tpApiClientModule as NamespaceWithOptionalDefault<typeof tpApiClientModule>;
const supabaseServerModuleCompat = supabaseServerModule as NamespaceWithOptionalDefault<typeof supabaseServerModule>;
const batchPreviewModuleCompat = batchPreviewModule as NamespaceWithOptionalDefault<typeof batchPreviewModule>;
const batchPreviewContextModuleCompat =
  batchPreviewContextModule as NamespaceWithOptionalDefault<typeof batchPreviewContextModule>;
const actionWriteTelegramCopyModuleCompat =
  actionWriteTelegramCopyModule as NamespaceWithOptionalDefault<typeof actionWriteTelegramCopyModule>;

const approveTrainingPeaksAction =
  trainingPeaksRepositoryModuleCompat.approveTrainingPeaksAction ??
  trainingPeaksRepositoryModuleCompat.default?.approveTrainingPeaksAction;
const cancelTrainingPeaksActionExecution =
  trainingPeaksRepositoryModuleCompat.cancelTrainingPeaksActionExecution ??
  trainingPeaksRepositoryModuleCompat.default?.cancelTrainingPeaksActionExecution;
const createBatchTrainingPeaksAction =
  trainingPeaksRepositoryModuleCompat.createBatchTrainingPeaksAction ??
  trainingPeaksRepositoryModuleCompat.default?.createBatchTrainingPeaksAction;
const createRollbackTrainingPeaksAction =
  trainingPeaksRepositoryModuleCompat.createRollbackTrainingPeaksAction ??
  trainingPeaksRepositoryModuleCompat.default?.createRollbackTrainingPeaksAction;
const createTrainingPeaksAction =
  trainingPeaksRepositoryModuleCompat.createTrainingPeaksAction ??
  trainingPeaksRepositoryModuleCompat.default?.createTrainingPeaksAction;
const getTrainingPeaksActionById =
  trainingPeaksRepositoryModuleCompat.getTrainingPeaksActionById ??
  trainingPeaksRepositoryModuleCompat.default?.getTrainingPeaksActionById;
const getTrainingPeaksActionLatestRunContext =
  trainingPeaksRepositoryModuleCompat.getTrainingPeaksActionLatestRunContext ??
  trainingPeaksRepositoryModuleCompat.default?.getTrainingPeaksActionLatestRunContext;
const requestBatchTrainingPeaksActionExecution =
  trainingPeaksRepositoryModuleCompat.requestBatchTrainingPeaksActionExecution ??
  trainingPeaksRepositoryModuleCompat.default?.requestBatchTrainingPeaksActionExecution;
const requestTrainingPeaksActionExecution =
  trainingPeaksRepositoryModuleCompat.requestTrainingPeaksActionExecution ??
  trainingPeaksRepositoryModuleCompat.default?.requestTrainingPeaksActionExecution;
const getWorkoutDetail = tpApiClientModuleCompat.getWorkoutDetail ?? tpApiClientModuleCompat.default?.getWorkoutDetail;
const getStrengthWorkout =
  tpApiClientModuleCompat.getStrengthWorkout ?? tpApiClientModuleCompat.default?.getStrengthWorkout;
const TpApiHttpError = tpApiClientModuleCompat.TpApiHttpError ?? tpApiClientModuleCompat.default?.TpApiHttpError;
const createSupabaseServerClient =
  supabaseServerModuleCompat.createSupabaseServerClient ?? supabaseServerModuleCompat.default?.createSupabaseServerClient;
const computeBatchAggregate =
  batchPreviewModuleCompat.computeBatchAggregate ?? batchPreviewModuleCompat.default?.computeBatchAggregate;
const detectBatchAnomalies =
  batchPreviewModuleCompat.detectBatchAnomalies ?? batchPreviewModuleCompat.default?.detectBatchAnomalies;
const gatherBatchAnomalyContext =
  batchPreviewContextModuleCompat.gatherBatchAnomalyContext ??
  batchPreviewContextModuleCompat.default?.gatherBatchAnomalyContext;
const buildBatchPreviewCard =
  actionWriteTelegramCopyModuleCompat.buildBatchPreviewCard ?? actionWriteTelegramCopyModuleCompat.default?.buildBatchPreviewCard;

for (const [name, fn] of Object.entries({
  approveTrainingPeaksAction,
  cancelTrainingPeaksActionExecution,
  createBatchTrainingPeaksAction,
  createRollbackTrainingPeaksAction,
  createTrainingPeaksAction,
  getTrainingPeaksActionById,
  getTrainingPeaksActionLatestRunContext,
  requestBatchTrainingPeaksActionExecution,
  requestTrainingPeaksActionExecution,
  getWorkoutDetail,
  getStrengthWorkout,
  TpApiHttpError,
  createSupabaseServerClient,
  computeBatchAggregate,
  detectBatchAnomalies,
  gatherBatchAnomalyContext,
  buildBatchPreviewCard,
})) {
  if (typeof fn !== "function") {
    throw new Error(`TrainingPeaks write-cycle probe dependency "${name}" is unavailable.`);
  }
}

/**
 * PR4 step 2 -- manual, one-stage-at-a-time driver for the propose/approve/
 * confirm/verify/rollback-creation parts of the real-write cycle (the parts
 * this PR's naryad says the AGENT does directly). The actual dry-run and real
 * TP-mutating execution are performed by tp-write-executor-once.ts (the
 * "service/runner"), invoked separately -- this script never calls
 * tp-api-client.ts's WRITE functions itself, only propose/approve/confirm
 * (repository.ts, our own action-queue table) and read-only TP verification.
 *
 * ONLY the standing safe test athlete. Every date used by callers of this
 * script is expected to be far-future (this script does not enforce it --
 * tp-actions-once.ts's move flow and the payload builders in this PR's own
 * ad-hoc invocations do).
 */

const SAFE_ATHLETE_ID = 3102415;
const RUNNER_CHAT_ID = "pr4-manual-probe";

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) return;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
function loadLocalEnv(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const toolRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(envPath);
  }
}

function getFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function requireAthleteId(payload: Record<string, unknown>): void {
  const athleteId = payload.athleteId;
  if (athleteId !== SAFE_ATHLETE_ID) {
    throw new Error(`Safety gate: athleteId must be ${SAFE_ATHLETE_ID} (test athlete only), got ${String(athleteId)}.`);
  }
}

async function cmdPropose(argv: string[]): Promise<void> {
  const payloadJson = getFlag(argv, "--payload");
  const payloadFile = getFlag(argv, "--payload-file");
  const actionType = getFlag(argv, "--type") as TrainingPeaksActionType;
  const rawText = getFlag(argv, "--label") ?? `PR4 probe: ${actionType}`;
  if ((!payloadJson && !payloadFile) || !actionType) {
    throw new Error("Usage: --propose --type <type> (--payload <json> | --payload-file <path>) [--label <text>]");
  }
  const payload = JSON.parse(payloadFile ? readFileSync(payloadFile, "utf8") : (payloadJson as string)) as Record<string, unknown>;
  requireAthleteId(payload);

  const action = await createTrainingPeaksAction({
    actionType,
    sourceChatId: RUNNER_CHAT_ID,
    sourceMessageId: `probe-${Date.now()}`,
    rawText,
    parsedPayload: payload,
    coachChatId: RUNNER_CHAT_ID,
  });
  console.log(JSON.stringify({ step: "propose", actionId: action.id, status: action.status, executionStatus: action.executionStatus }, null, 2));
}

async function cmdApprove(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  if (!actionId) throw new Error("Usage: --approve --action-id <id>");
  const result = await approveTrainingPeaksAction({ actionId, decidedByChatId: RUNNER_CHAT_ID });
  console.log(JSON.stringify({ step: "approve", result }, null, 2));
}

async function cmdConfirm(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  if (!actionId) throw new Error("Usage: --confirm --action-id <id>");
  const result = await requestTrainingPeaksActionExecution({ actionId, requestedByChatId: RUNNER_CHAT_ID });
  console.log(JSON.stringify({ step: "confirm", result }, null, 2));
}

async function cmdStatus(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  if (!actionId) throw new Error("Usage: --status --action-id <id>");
  const action = await getTrainingPeaksActionById(actionId);
  const context = await getTrainingPeaksActionLatestRunContext(actionId);
  console.log(JSON.stringify({ step: "status", action, latestRunContext: context }, null, 2));
}

async function cmdVerifyTp(argv: string[]): Promise<void> {
  const athleteId = Number(getFlag(argv, "--athlete-id"));
  const workoutId = getFlag(argv, "--workout-id");
  const strengthId = getFlag(argv, "--strength-id");
  if (athleteId !== SAFE_ATHLETE_ID) throw new Error(`Safety gate: athleteId must be ${SAFE_ATHLETE_ID}.`);

  if (strengthId) {
    try {
      const workout = await getStrengthWorkout(strengthId);
      console.log(JSON.stringify({ step: "verify-tp-strength", status: "found", workout }, null, 2));
    } catch (error) {
      if (error instanceof TpApiHttpError) {
        console.log(JSON.stringify({ step: "verify-tp-strength", status: "not_found", httpStatus: error.status, body: error.body }, null, 2));
        return;
      }
      throw error;
    }
    return;
  }

  if (!workoutId) throw new Error("Usage: --verify-tp --athlete-id 3102415 (--workout-id <id> | --strength-id <id>)");
  try {
    const workout = await getWorkoutDetail(athleteId, Number(workoutId));
    console.log(JSON.stringify({ step: "verify-tp", status: "found", workout }, null, 2));
  } catch (error) {
    if (error instanceof TpApiHttpError) {
      console.log(JSON.stringify({ step: "verify-tp", status: "not_found", httpStatus: error.status, body: error.body }, null, 2));
      return;
    }
    throw error;
  }
}

/**
 * TEST-ONLY. Directly overwrites parsed_payload on an action row, bypassing
 * every normal code path, to simulate a dry-run/current-payload desync (PR4
 * step 2f: prove requestTrainingPeaksActionExecution's revalidation refuses
 * to queue execution when they disagree). Nothing in the production app ever
 * calls this -- it exists only in this probe script.
 */
async function cmdTamperPayload(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  const payloadJson = getFlag(argv, "--payload");
  if (!actionId || !payloadJson) throw new Error("Usage: --tamper-payload --action-id <id> --payload <json>");
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  requireAthleteId(payload);
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("trainingpeaks_actions").update({ parsed_payload: payload }).eq("id", actionId);
  if (error) throw new Error(`Failed to tamper payload: ${error.message}`);
  console.log(JSON.stringify({ step: "tamper-payload", actionId, newPayload: payload }, null, 2));
}

async function cmdCancel(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  if (!actionId) throw new Error("Usage: --cancel --action-id <id>");
  const result = await cancelTrainingPeaksActionExecution({ actionId, cancelledByChatId: RUNNER_CHAT_ID });
  console.log(JSON.stringify({ step: "cancel", result }, null, 2));
}

async function cmdProposeBatch(argv: string[]): Promise<void> {
  const payloadFile = getFlag(argv, "--payload-file");
  const label = getFlag(argv, "--label") ?? "PR4 probe batch";
  if (!payloadFile) throw new Error("Usage: --propose-batch --payload-file <path to JSON array of BatchChildSpec>");
  const children = JSON.parse(readFileSync(payloadFile, "utf8")) as BatchChildSpec[];
  for (const child of children) requireAthleteId(child.payload as Record<string, unknown>);

  const result = await createBatchTrainingPeaksAction({
    sourceChatId: RUNNER_CHAT_ID,
    sourceMessageId: `probe-batch-${Date.now()}`,
    rawText: label,
    coachChatId: RUNNER_CHAT_ID,
    children,
  });
  console.log(JSON.stringify({
    step: "propose-batch",
    parentActionId: result.parent.id,
    childActionIds: result.children.map((child) => child.id),
  }, null, 2));
}

async function cmdBatchPreview(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  if (!actionId) throw new Error("Usage: --batch-preview --action-id <parentActionId>");
  const parent = await getTrainingPeaksActionById(actionId);
  if (!parent || parent.actionType !== "batch") throw new Error("Not a batch parent action.");
  const payload = parent.parsedPayload as { children: BatchChildSpec[] };
  const aggregate = computeBatchAggregate(payload.children);
  const context = await gatherBatchAnomalyContext(payload.children);
  const anomalies = detectBatchAnomalies(payload.children, context);
  const card = buildBatchPreviewCard(aggregate, anomalies, payload.children);
  console.log(card);
}

async function cmdConfirmBatch(argv: string[]): Promise<void> {
  const actionId = getFlag(argv, "--action-id");
  if (!actionId) throw new Error("Usage: --confirm-batch --action-id <parentActionId>");
  const result = await requestBatchTrainingPeaksActionExecution({ actionId, requestedByChatId: RUNNER_CHAT_ID });
  console.log(JSON.stringify({ step: "confirm-batch", result }, null, 2));
}

async function cmdRollbackCreate(argv: string[]): Promise<void> {
  const runId = getFlag(argv, "--run-id");
  if (!runId) throw new Error("Usage: --rollback-create --run-id <realRunId>");
  const result = await createRollbackTrainingPeaksAction({
    originRunId: runId,
    sourceChatId: RUNNER_CHAT_ID,
    sourceMessageId: `probe-rollback-${Date.now()}`,
    coachChatId: RUNNER_CHAT_ID,
  });
  console.log(JSON.stringify({ step: "rollback-create", result }, null, 2));
}

async function main(): Promise<void> {
  loadLocalEnv();
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "--propose") return cmdPropose(argv);
  if (command === "--approve") return cmdApprove(argv);
  if (command === "--confirm") return cmdConfirm(argv);
  if (command === "--status") return cmdStatus(argv);
  if (command === "--verify-tp") return cmdVerifyTp(argv);
  if (command === "--rollback-create") return cmdRollbackCreate(argv);
  if (command === "--tamper-payload") return cmdTamperPayload(argv);
  if (command === "--cancel") return cmdCancel(argv);
  if (command === "--propose-batch") return cmdProposeBatch(argv);
  if (command === "--batch-preview") return cmdBatchPreview(argv);
  if (command === "--confirm-batch") return cmdConfirmBatch(argv);
  throw new Error(
    `Unknown command "${command}". Expected one of: --propose --approve --confirm --status --verify-tp --rollback-create --tamper-payload --cancel --propose-batch --batch-preview --confirm-batch`,
  );
}

main().catch((error: unknown) => {
  console.error("tp-probe-write-cycle failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
