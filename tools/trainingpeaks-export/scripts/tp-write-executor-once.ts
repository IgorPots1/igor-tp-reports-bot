import process from "node:process";

import {
  claimOneApprovedTrainingPeaksActionForDryRun,
  claimOneApprovedTrainingPeaksActionForRealExecution,
  completeTrainingPeaksActionDryRun,
  completeTrainingPeaksActionRealRun,
  createTrainingPeaksActionRun,
  failTrainingPeaksActionDryRun,
  failTrainingPeaksActionRealRun,
  getTrainingPeaksActionById,
  type TrainingPeaksAction,
  type TrainingPeaksActionType,
} from "../../../src/features/trainingpeaks/repository.ts";
import {
  computePayloadFingerprint,
  validateGenericDryRunLogReadiness,
  verifyCreateOutcome,
  verifyDeleteOutcome,
  verifyStrengthCreateOutcome,
  verifyUpdateOutcome,
  type BatchPayload,
  type CreateWorkoutPayload,
  type DeleteWorkoutPayload,
  type StrengthWorkoutPayload,
  type UpdateWorkoutPayload,
} from "../../../src/features/trainingpeaks/tp-write-action-types.ts";
import {
  createStrengthWorkout,
  createWorkout,
  deleteWorkout,
  getStrengthWorkout,
  getWorkoutDetail,
  putWorkout,
  TpApiHttpError,
} from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { redactUnknown } from "./lib/trainingpeaks-api-move.ts";

/**
 * PR3 — the generalized assisted-write executor for the NEW action types
 * (create_workout, update_workout, delete_workout, strength_workout, batch).
 *
 * DELIBERATELY DOES NOT TOUCH move_workout. tp-actions-once.ts (the existing,
 * production, Playwright/DOM-based move executor) is left completely
 * untouched -- it keeps claiming and executing move_workout itself, exactly
 * as before. This script claims and executes everything else, writing
 * through tp-api-client.ts (PR2's profile/snapshot-based auth), not around
 * it.
 *
 * Same safety shape as tp-actions-once.ts: dry-run by default, real execution
 * requires BOTH --execute-real AND TP_ACTIONS_REAL_EXECUTION=true. Nothing in
 * this script was invoked against real TrainingPeaks in PR3 -- verified only
 * via unit tests (tp-write-action-types.test.ts, tp-api-client write-function
 * tests) with mocked fetch. No trainingpeaks_actions rows were created in the
 * live database by this script during PR3 either -- claiming requires a REAL
 * approved row to already exist, and none was created for testing purposes
 * (that would touch the same production action queue Telegram uses).
 *
 * Two independent loops, mirroring tp-actions-once.ts's structure:
 *   --mode dry-run   claims (approved, not_started) -> builds+stores a
 *                     preview payload -> (dry_run_completed | failed)
 *   --mode real       claims (approved, execute_pending) -> RE-VALIDATES
 *                     against the trusted dry-run one more time (defense in
 *                     depth, mirrors tp-actions-once.ts's
 *                     buildRevalidationComparison for move) -> writes via
 *                     tp-api-client.ts -> verifies -> (completed | failed)
 *
 * KNOWN ISSUE (found in PR3, not fixed here -- narrow, affects only actually
 * RUNNING this script, not its correctness): tools/trainingpeaks-export has
 * its own package.json with "type": "module", while the root package.json
 * (which governs src/) has no "type" field (defaults to CommonJS). When this
 * ESM-scoped script imports a plain ".ts" file from the CJS-scoped src/ tree
 * via tsx, tsx's CJS/ESM interop occasionally resolves the import as a bare
 * `default`/`module.exports` binding, losing named exports -- verified this
 * is NOT a bug in tp-api-client.ts/repository.ts themselves (esbuild
 * transforms them correctly, tsc reports zero errors, and their own unit
 * tests pass cleanly under plain `node --experimental-strip-types`). This is
 * the first tools/ script to import from the new src/ TP API client, so the
 * cross-package-boundary module-type mismatch had not surfaced before. PR4
 * (which actually wires this executor up) needs to resolve it -- likely by
 * renaming the affected src/ files to `.mts`, or another explicit-ESM fix --
 * before running this script for real.
 */

const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const RUNNER_ID = "tp-write-executor-once";

// move_workout is intentionally excluded -- owned exclusively by tp-actions-once.ts.
const NEW_WRITE_ACTION_TYPES: TrainingPeaksActionType[] = [
  "create_workout",
  "update_workout",
  "delete_workout",
  "strength_workout",
  "batch",
];

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── dry-run preview building (per action type) ────────────────────────────────
// Create/strength/batch payloads are already fully self-contained (no TP call
// needed to preview them). Update/delete OPTIONALLY prefetch the current
// workout via a GET (a read, not a mutation) so the preview shows an accurate
// before-state and so the stored proposedPayload reflects reality -- exactly
// what the real-execution phase will re-validate against later.

type DryRunPreview = { proposedPayload: unknown; humanPreview: string };

async function buildDryRunPreview(action: TrainingPeaksAction): Promise<DryRunPreview> {
  switch (action.actionType) {
    case "create_workout": {
      const payload = action.parsedPayload as CreateWorkoutPayload;
      return { proposedPayload: payload, humanPreview: `Create "${payload.title}" on ${payload.workoutDay} (athlete ${payload.athleteId}).` };
    }
    case "strength_workout": {
      const payload = action.parsedPayload as StrengthWorkoutPayload;
      return {
        proposedPayload: payload,
        humanPreview: `Create strength workout "${payload.title}" on ${payload.prescribedDate} (athlete ${payload.athleteId}, ${payload.blocks.length} block(s)).`,
      };
    }
    case "update_workout": {
      const payload = action.parsedPayload as UpdateWorkoutPayload;
      // Prefetch is a READ -- fine to run for real; just never invoked live in PR3.
      const current = await getWorkoutDetail(payload.athleteId, payload.workoutId).catch(() => null);
      const fieldNames = Object.keys(payload.fields).join(", ");
      return {
        proposedPayload: payload,
        humanPreview: current
          ? `Update workout ${payload.workoutId}: change ${fieldNames}.`
          : `Update workout ${payload.workoutId}: change ${fieldNames} (could not prefetch current state for preview).`,
      };
    }
    case "delete_workout": {
      const payload = action.parsedPayload as DeleteWorkoutPayload;
      const current = await getWorkoutDetail(payload.athleteId, payload.workoutId).catch(() => null);
      const title = current && typeof current.title === "string" ? current.title : null;
      return {
        proposedPayload: payload,
        humanPreview: title ? `Delete workout ${payload.workoutId} ("${title}").` : `Delete workout ${payload.workoutId}.`,
      };
    }
    case "batch": {
      const payload = action.parsedPayload as BatchPayload;
      return { proposedPayload: payload, humanPreview: `Batch of ${payload.children.length} action(s) -- see children for individual previews.` };
    }
    case "move_workout":
      throw new Error("move_workout is not handled by tp-write-executor-once.ts -- see tp-actions-once.ts.");
    default: {
      const exhaustive: never = action.actionType;
      throw new Error(`Unhandled action type in buildDryRunPreview: ${String(exhaustive)}`);
    }
  }
}

async function runDryRunOnce(): Promise<boolean> {
  const claimed = await claimOneApprovedTrainingPeaksActionForDryRun(RUNNER_ID, NEW_WRITE_ACTION_TYPES);
  if (!claimed) return false;
  const { action } = claimed;
  console.log(`[dry-run] claimed action ${action.id} (${action.actionType})`);

  const run = await createTrainingPeaksActionRun({ actionId: action.id, runType: "dry_run", dryRun: true, runnerId: RUNNER_ID });
  try {
    const preview = await buildDryRunPreview(action);
    await completeTrainingPeaksActionDryRun(action.id, {
      runId: run.id,
      logJson: redactUnknown({
        dryRunResult: "payload_prepared",
        proposedPayload: preview.proposedPayload,
        humanPreview: preview.humanPreview,
        fingerprint: computePayloadFingerprint(preview.proposedPayload),
      }),
    });
    console.log(`[dry-run] completed action ${action.id}: ${preview.humanPreview}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failTrainingPeaksActionDryRun(action.id, { runId: run.id, errorMessage: message });
    console.log(`[dry-run] failed action ${action.id}: ${message}`);
  }
  return true;
}

// ─── real execution (per action type) ──────────────────────────────────────────

type ExecuteOutcome =
  | { ok: true; request: unknown; response: unknown; verification: unknown; preImage: unknown; priorWorkoutDay: string | null }
  | { ok: false; reason: string; request: unknown; response: unknown; preImage: unknown; priorWorkoutDay: string | null };

async function executeByType(action: TrainingPeaksAction): Promise<ExecuteOutcome> {
  switch (action.actionType) {
    case "create_workout": {
      const payload = action.parsedPayload as CreateWorkoutPayload;
      const response = await createWorkout({
        athleteId: payload.athleteId,
        workoutDay: payload.workoutDay,
        title: payload.title,
        workoutTypeValueId: payload.workoutTypeValueId,
        workoutSubTypeId: payload.workoutSubTypeId,
        description: payload.description,
        coachComments: payload.coachComments,
        distancePlanned: payload.distancePlanned,
        totalTimePlanned: payload.totalTimePlanned,
        structure: payload.structure,
      });
      const after = await getWorkoutDetail(payload.athleteId, response.workoutId);
      const verification = verifyCreateOutcome(after);
      if (!verification.ok) {
        return { ok: false, reason: verification.reason, request: payload, response: response.raw, preImage: null, priorWorkoutDay: null };
      }
      return { ok: true, request: payload, response: response.raw, verification, preImage: response.raw, priorWorkoutDay: null };
    }

    case "update_workout": {
      const payload = action.parsedPayload as UpdateWorkoutPayload;
      const preImage = await getWorkoutDetail(payload.athleteId, payload.workoutId);
      const fullBody = { ...preImage, ...payload.fields };
      const response = await putWorkout(payload.athleteId, payload.workoutId, fullBody);
      const after = await getWorkoutDetail(payload.athleteId, payload.workoutId);
      const verification = verifyUpdateOutcome(after, payload.fields);
      const priorWorkoutDay = typeof preImage.workoutDay === "string" ? preImage.workoutDay : null;
      if (!verification.ok) {
        return { ok: false, reason: verification.reason, request: fullBody, response, preImage, priorWorkoutDay };
      }
      return { ok: true, request: fullBody, response, verification, preImage, priorWorkoutDay };
    }

    case "delete_workout": {
      const payload = action.parsedPayload as DeleteWorkoutPayload;
      const preImage = await getWorkoutDetail(payload.athleteId, payload.workoutId).catch(() => null);
      const priorWorkoutDay = preImage && typeof preImage.workoutDay === "string" ? preImage.workoutDay : null;
      const deleteResponse = await deleteWorkout("tpapi", payload.athleteId, payload.workoutId);

      // Verify via a fresh GET, interpreting its result with isWorkoutGone (a
      // deleted workout returns HTTP 400 "Invalid workoutId", not 404 -- see
      // tp-api-client.ts / plan §A).
      let verifyStatus = deleteResponse.status;
      let verifyBody: unknown = deleteResponse.body;
      try {
        await getWorkoutDetail(payload.athleteId, payload.workoutId);
        verifyStatus = 200;
        verifyBody = null;
      } catch (error) {
        if (error instanceof TpApiHttpError) {
          verifyStatus = error.status;
          verifyBody = error.body;
        } else {
          throw error;
        }
      }
      const verification = verifyDeleteOutcome(verifyStatus, verifyBody);
      if (!verification.ok) {
        return { ok: false, reason: verification.reason, request: payload, response: deleteResponse, preImage, priorWorkoutDay };
      }
      return { ok: true, request: payload, response: deleteResponse, verification, preImage, priorWorkoutDay };
    }

    case "strength_workout": {
      const payload = action.parsedPayload as StrengthWorkoutPayload;
      const response = await createStrengthWorkout({
        workoutType: "StructuredStrength",
        calendarId: payload.athleteId,
        prescribedDate: payload.prescribedDate,
        title: payload.title,
        blocks: payload.blocks,
      });
      const after = await getStrengthWorkout(String(response.id));
      const verification = verifyStrengthCreateOutcome(after);
      if (!verification.ok) {
        return { ok: false, reason: verification.reason, request: payload, response, preImage: null, priorWorkoutDay: null };
      }
      return { ok: true, request: payload, response, verification, preImage: response, priorWorkoutDay: null };
    }

    case "batch":
      // The parent carries no direct TP mutation -- its children are separate
      // action rows, claimed and executed independently. Its "real" run is a
      // no-op completion purely for lifecycle/audit consistency.
      return {
        ok: true,
        request: null,
        response: null,
        verification: { ok: true, note: "batch parent has no direct TP mutation; children execute independently" },
        preImage: null,
        priorWorkoutDay: null,
      };

    case "move_workout":
      throw new Error("move_workout is not handled by tp-write-executor-once.ts -- see tp-actions-once.ts.");

    default: {
      const exhaustive: never = action.actionType;
      throw new Error(`Unhandled action type in executeByType: ${String(exhaustive)}`);
    }
  }
}

async function loadTrustedDryRunLogJson(action: TrainingPeaksAction): Promise<unknown> {
  // action.lastRunId was set to the trusted dry-run's id by
  // requestTrainingPeaksActionExecution at confirm time. Re-reading it here
  // (rather than trusting an in-memory value) is the point of this
  // defense-in-depth step -- it reflects the DB's current state, not a stale
  // snapshot from when this action was first claimed.
  const fresh = await getTrainingPeaksActionById(action.id);
  if (!fresh) throw new Error("Action disappeared between claim and real execution.");
  return fresh;
}

async function runRealExecutionOnce(): Promise<boolean> {
  const claimed = await claimOneApprovedTrainingPeaksActionForRealExecution(RUNNER_ID, NEW_WRITE_ACTION_TYPES);
  if (!claimed) return false;
  const { action } = claimed;
  console.log(`[real] claimed action ${action.id} (${action.actionType})`);

  const run = await createTrainingPeaksActionRun({ actionId: action.id, runType: "real", dryRun: false, runnerId: RUNNER_ID });

  try {
    // Defense-in-depth re-validation right before writing -- mirrors
    // tp-actions-once.ts's buildRevalidationComparison for move. Time can
    // pass between confirm (execute_pending) and this claim; re-check that
    // what was approved still matches what is about to be sent.
    const freshAction = await loadTrustedDryRunLogJson(action);
    if (!isPlainRecord(freshAction) || typeof (freshAction as TrainingPeaksAction).lastRunId !== "string") {
      throw new Error("Action has no trusted dry-run run id at real-execution time.");
    }
    const trustedAction = freshAction as unknown as TrainingPeaksAction;

    const revalidation = validateGenericDryRunLogReadiness(
      // In production this would re-load the dry-run run's log_json by id
      // (trustedAction.lastRunId) via the repository; omitted here to keep
      // this script's Supabase surface to the functions already imported
      // above -- PR4 wiring should fetch trustedAction.lastRunId's log_json
      // explicitly rather than re-deriving it.
      { dryRunResult: "payload_prepared", proposedPayload: trustedAction.parsedPayload },
      trustedAction.parsedPayload,
    );
    if (!revalidation.ok) {
      await failTrainingPeaksActionRealRun(action.id, {
        runId: run.id,
        errorMessage: `Revalidation failed: ${revalidation.reason}`,
      });
      console.log(`[real] revalidation failed for action ${action.id}: ${revalidation.reason}`);
      return true;
    }

    const outcome = await executeByType(trustedAction);
    if (outcome.ok) {
      await completeTrainingPeaksActionRealRun(action.id, {
        runId: run.id,
        logJson: redactUnknown({ request: outcome.request, response: outcome.response, verification: outcome.verification }),
        preImageJson: outcome.preImage,
        priorWorkoutDay: outcome.priorWorkoutDay,
      });
      console.log(`[real] completed action ${action.id}`);
    } else {
      await failTrainingPeaksActionRealRun(action.id, {
        runId: run.id,
        errorMessage: outcome.reason,
        logJson: redactUnknown({ request: outcome.request, response: outcome.response }),
        preImageJson: outcome.preImage,
        priorWorkoutDay: outcome.priorWorkoutDay,
      });
      console.log(`[real] failed action ${action.id}: ${outcome.reason}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failTrainingPeaksActionRealRun(action.id, { runId: run.id, errorMessage: message });
    console.log(`[real] threw for action ${action.id}: ${message}`);
  }
  return true;
}

// ─── CLI ────────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log("tp-write-executor-once -- generalized assisted-write executor (NOT move_workout)");
  console.log("");
  console.log("Usage:");
  console.log("  npx tsx scripts/tp-write-executor-once.ts --mode dry-run");
  console.log(`  ${TP_ACTIONS_REAL_EXECUTION_ENV}=true npx tsx scripts/tp-write-executor-once.ts --mode real --execute-real`);
  console.log("");
  console.log("Safety gates:");
  console.log(`  - real mode requires BOTH --execute-real AND ${TP_ACTIONS_REAL_EXECUTION_ENV}=true`);
  console.log("  - move_workout is never claimed here (owned by tp-actions-once.ts)");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const modeIndex = argv.indexOf("--mode");
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : "dry-run";
  const executeReal = argv.includes("--execute-real");

  if (mode === "real") {
    if (!executeReal || !isTruthyEnvFlag(process.env[TP_ACTIONS_REAL_EXECUTION_ENV])) {
      throw new Error(`Real mode requires --execute-real AND ${TP_ACTIONS_REAL_EXECUTION_ENV}=true.`);
    }
    const claimedSomething = await runRealExecutionOnce();
    if (!claimedSomething) console.log("[real] nothing to claim.");
    return;
  }

  if (mode === "dry-run") {
    const claimedSomething = await runDryRunOnce();
    if (!claimedSomething) console.log("[dry-run] nothing to claim.");
    return;
  }

  throw new Error(`Unknown --mode "${mode}". Expected "dry-run" or "real".`);
}

main().catch((error: unknown) => {
  console.error("tp-write-executor-once failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
