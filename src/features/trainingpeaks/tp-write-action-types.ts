import { isWorkoutGone } from "./tp-api-client.ts";
import type { TrainingPeaksActionType } from "./repository.ts";

/**
 * PR3 — pure, framework-agnostic logic for the generalized assisted-write
 * pipeline. Deliberately has NO Supabase / Playwright / network dependency
 * (except the type-only import of TrainingPeaksActionType, which TypeScript
 * erases entirely at runtime) so it can be unit-tested without a database or
 * live TP access, and reused from both repository.ts (src/) and the new
 * executor script (tools/).
 *
 * Covers:
 *  - Per-action-type payload shapes.
 *  - Rollback planning (create->delete, move->move-back, update->restore
 *    pre-image; delete->deliberately unsupported, see buildRollbackPlan).
 *  - Generic (non-move) trusted-dry-run revalidation: byte-for-byte payload
 *    match between what the coach approved and what is about to be sent.
 *    Move keeps its own existing DOM/fingerprint-based validator
 *    (validateDryRunLogReadiness in move-source-policy.ts) -- untouched.
 *  - Generic per-action-type verify (readback-outcome) functions, including
 *    delete verification via isWorkoutGone (tpapi returns 400 "Invalid
 *    workoutId", not 404 -- see tp-api-client.ts).
 *  - Batch fan-out planning (one parent action -> N child action specs).
 *  - The execution_status two-axis lifecycle transition table, as a pure,
 *    independently-testable statement of the state machine (the actual
 *    enforcement lives in Supabase compare-and-swap UPDATE...WHERE clauses in
 *    repository.ts; this is the single source of truth for what SHOULD be
 *    allowed, used by tests and available for defensive checks).
 */

// ─── small local helpers (mirrors the asRecord/toNumber house style already used elsewhere in this codebase) ──

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainRecord(value) ? value : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || !aKeys.every((key, index) => key === bKeys[index])) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Deterministic string form of a value: object keys sorted recursively, so key
 * order never affects the fingerprint. Not a cryptographic hash -- direct
 * string comparison is enough for the payload sizes involved here. */
export function computePayloadFingerprint(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

// ─── action types + per-type payload shapes ────────────────────────────────────

/** Re-exported alias so callers only need to import from one place. Kept in
 * sync with repository.ts's TrainingPeaksActionType, which is the DB-mapped
 * source of truth (widened by this PR's migration + the matching TS edit). */
export type TrainingPeaksWriteActionType = TrainingPeaksActionType;

export type MoveWorkoutPayload = {
  athleteId: number;
  workoutId: number;
  targetWorkoutDay: string; // "YYYY-MM-DDTHH:mm:ss"
};

export type CreateWorkoutPayload = {
  athleteId: number;
  workoutDay: string; // "YYYY-MM-DD"
  title: string;
  workoutTypeValueId: number;
  workoutSubTypeId: number | null;
  description: string | null;
  coachComments: string | null;
  distancePlanned: number | null;
  totalTimePlanned: number | null;
  structure: unknown | null;
};

export type UpdateWorkoutPayload = {
  athleteId: number;
  workoutId: number;
  /** Sparse set of fields to override on the full-object PUT (the rest of the
   * object is carried forward from a fresh prefetch GET, same pattern as the
   * existing move's buildWorkoutMovePayload). */
  fields: Record<string, unknown>;
};

export type DeleteWorkoutPayload = {
  athleteId: number;
  workoutId: number;
};

export type StrengthWorkoutPayload = {
  athleteId: number;
  prescribedDate: string; // "YYYY-MM-DD"
  title: string;
  /** StructuredStrength blocks, shape confirmed live in PR1 (POST .../workouts/save). */
  blocks: unknown[];
};

export type BatchChildSpec = {
  actionType: Exclude<TrainingPeaksWriteActionType, "batch">;
  payload: unknown;
  /** Human-readable one-liner for the batch preview, e.g. "Move #123 -> 2026-08-01". */
  label: string;
};

export type BatchPayload = {
  children: BatchChildSpec[];
};

export type TrainingPeaksWriteActionPayload =
  | { actionType: "move_workout"; payload: MoveWorkoutPayload }
  | { actionType: "create_workout"; payload: CreateWorkoutPayload }
  | { actionType: "update_workout"; payload: UpdateWorkoutPayload }
  | { actionType: "delete_workout"; payload: DeleteWorkoutPayload }
  | { actionType: "strength_workout"; payload: StrengthWorkoutPayload }
  | { actionType: "batch"; payload: BatchPayload };

// ─── generic (non-move) trusted-dry-run revalidation ───────────────────────────

export type GenericDryRunReadiness = { ok: true } | { ok: false; reason: string };

/**
 * For move_workout, keep using the existing validateDryRunLogReadiness
 * (move-source-policy.ts) -- DOM/candidate-fingerprint based, untouched by
 * this PR. For every OTHER action type, the dry-run has no browser candidate
 * to re-locate: it simply computed and stored the exact payload it WOULD
 * send. Revalidation here is a strict structural comparison between that
 * stored payload and the payload about to be sent for real. Any mismatch
 * (payload edited, parsed_payload changed after approval, stale run, etc.)
 * is a REFUSAL, never a "close enough, send it anyway" -- matches the same
 * invariant the move path already enforces.
 */
export function validateGenericDryRunLogReadiness(
  logJson: unknown,
  currentPayload: unknown,
): GenericDryRunReadiness {
  const log = asRecord(logJson);
  if (!log) {
    return { ok: false, reason: "Dry-run log not found." };
  }
  if (log.dryRunResult !== "payload_prepared") {
    return { ok: false, reason: "Dry-run did not successfully prepare a payload." };
  }
  if (!("proposedPayload" in log)) {
    return { ok: false, reason: "Dry-run log is missing the proposed payload." };
  }
  const dryRunFingerprint = computePayloadFingerprint(log.proposedPayload);
  const currentFingerprint = computePayloadFingerprint(currentPayload);
  if (dryRunFingerprint !== currentFingerprint) {
    return {
      ok: false,
      reason: "Payload changed since the dry-run was approved -- refusing to execute a different action than what was confirmed.",
    };
  }
  return { ok: true };
}

// ─── rollback planning ──────────────────────────────────────────────────────────

export type RollbackPlan = {
  actionType: Exclude<TrainingPeaksWriteActionType, "batch">;
  payload: unknown;
  description: string;
};

export type RollbackPlanResult = RollbackPlan | { error: string };

/**
 * create -> delete; move -> move back to the pre-image's original day;
 * update -> restore the pre-image's original values for exactly the fields
 * that were changed; strength -> delete (create's mirror, proven to work in
 * PR1). delete -> deliberately NOT supported: recreating a deleted workout
 * cannot restore its original numeric id, and any completed/actual data on
 * it is unrecoverable -- silently fabricating a lossy "rollback" would be
 * worse than refusing. batch -> no single plan; roll back each completed
 * child individually (the caller iterates children).
 */
export function buildRollbackPlan(
  originActionType: TrainingPeaksWriteActionType,
  preImage: unknown,
  originPayload: unknown,
): RollbackPlanResult {
  switch (originActionType) {
    case "create_workout": {
      // pre-image for a create is the CREATE RESPONSE (contains the server-assigned workoutId).
      const created = asRecord(preImage);
      const athleteId = toNumber(created?.athleteId);
      const workoutId = toNumber(created?.workoutId);
      if (!athleteId || !workoutId) {
        return { error: "Cannot build rollback: pre-image is missing athleteId/workoutId." };
      }
      const payload: DeleteWorkoutPayload = { athleteId, workoutId };
      return { actionType: "delete_workout", payload, description: `Delete workout ${workoutId} (undo create).` };
    }

    case "move_workout": {
      const pre = asRecord(preImage);
      const athleteId = toNumber(pre?.athleteId);
      const workoutId = toNumber(pre?.workoutId);
      const priorDay = typeof pre?.workoutDay === "string" ? pre.workoutDay : null;
      if (!athleteId || !workoutId || !priorDay) {
        return { error: "Cannot build rollback: pre-image is missing athleteId/workoutId/workoutDay." };
      }
      const payload: MoveWorkoutPayload = { athleteId, workoutId, targetWorkoutDay: priorDay };
      return { actionType: "move_workout", payload, description: `Move workout ${workoutId} back to ${priorDay}.` };
    }

    case "update_workout": {
      const pre = asRecord(preImage);
      const athleteId = toNumber(pre?.athleteId);
      const workoutId = toNumber(pre?.workoutId);
      const changedFields = asRecord(originPayload)?.fields;
      if (!athleteId || !workoutId || !isPlainRecord(changedFields)) {
        return { error: "Cannot build rollback: missing pre-image or the original changed-field list." };
      }
      const restoreFields: Record<string, unknown> = {};
      for (const key of Object.keys(changedFields)) {
        restoreFields[key] = pre ? (pre[key] ?? null) : null;
      }
      const payload: UpdateWorkoutPayload = { athleteId, workoutId, fields: restoreFields };
      return {
        actionType: "update_workout",
        payload,
        description: `Restore ${Object.keys(restoreFields).length} field(s) on workout ${workoutId}.`,
      };
    }

    case "strength_workout": {
      const pre = asRecord(preImage);
      const rawId = pre?.id;
      const workoutId = typeof rawId === "string" || typeof rawId === "number" ? Number(rawId) : null;
      const athleteId = toNumber(pre?.calendarId);
      if (!workoutId || !Number.isFinite(workoutId) || !athleteId) {
        return { error: "Cannot build rollback: pre-image is missing calendarId/id." };
      }
      const payload: DeleteWorkoutPayload = { athleteId, workoutId };
      return { actionType: "delete_workout", payload, description: `Delete strength workout ${workoutId} (undo create).` };
    }

    case "delete_workout":
      return {
        error:
          "Rollback of a delete is not supported: the original workoutId cannot be recreated (TP assigns a new " +
          "id), and any completed/actual data on the deleted workout is unrecoverable. Restore manually from the " +
          "TP UI/backup if truly needed.",
      };

    case "batch":
      return { error: "A batch action has no single rollback plan -- roll back each completed child individually." };

    default: {
      const exhaustiveCheck: never = originActionType;
      return { error: `Unknown action type for rollback: ${String(exhaustiveCheck)}` };
    }
  }
}

// ─── batch fan-out planning ──────────────────────────────────────────────────────

export type BatchFanOutPlan = {
  parentPreview: string;
  children: BatchChildSpec[];
};

export type BatchFanOutResult = BatchFanOutPlan | { error: string };

export function planBatchFanOut(batchPayload: BatchPayload): BatchFanOutResult {
  if (!Array.isArray(batchPayload.children) || batchPayload.children.length === 0) {
    return { error: "Batch has no child items." };
  }
  const lines = batchPayload.children.map((child, index) => `${index + 1}. [${child.actionType}] ${child.label}`);
  return {
    parentPreview: `Batch of ${batchPayload.children.length} action(s):\n${lines.join("\n")}`,
    children: batchPayload.children,
  };
}

// ─── per-action-type verify (readback outcome) ─────────────────────────────────

export type VerifyOutcome = { ok: true } | { ok: false; reason: string };

export function verifyMoveOutcome(workoutAfter: Record<string, unknown> | null, targetDay: string): VerifyOutcome {
  const day = typeof workoutAfter?.workoutDay === "string" ? workoutAfter.workoutDay : null;
  if (day && day.startsWith(targetDay)) return { ok: true };
  return { ok: false, reason: `Expected workoutDay to start with "${targetDay}", got ${JSON.stringify(day)}.` };
}

export function verifyCreateOutcome(workoutAfter: Record<string, unknown> | null): VerifyOutcome {
  if (workoutAfter && toNumber(workoutAfter.workoutId) !== null) return { ok: true };
  return { ok: false, reason: "Workout not found (or missing workoutId) after create." };
}

export function verifyUpdateOutcome(
  workoutAfter: Record<string, unknown> | null,
  expectedFields: Record<string, unknown>,
): VerifyOutcome {
  if (!workoutAfter) return { ok: false, reason: "Workout not found after update." };
  const mismatches = Object.entries(expectedFields)
    .filter(([key, expected]) => !deepEqual(workoutAfter[key], expected))
    .map(([key]) => key);
  if (mismatches.length > 0) {
    return { ok: false, reason: `Field(s) did not match after update: ${mismatches.join(", ")}.` };
  }
  return { ok: true };
}

/**
 * Delete verification: tpapi returns HTTP 400 with body "Invalid workoutId
 * (<id>)" for a deleted workout, NOT 404/403 (PR1 finding, encoded in
 * isWorkoutGone). A verify step that only checks for 404 will false-negative
 * on a delete that actually succeeded and trigger a needless (and confusing)
 * rollback attempt against nothing.
 */
export function verifyDeleteOutcome(status: number, body: unknown): VerifyOutcome {
  if (isWorkoutGone(status, body)) return { ok: true };
  return { ok: false, reason: `Workout does not appear deleted (readback status ${status}).` };
}

export function verifyStrengthCreateOutcome(workoutAfter: Record<string, unknown> | null): VerifyOutcome {
  const id = workoutAfter?.id;
  if (typeof id === "string" && /^\d+$/.test(id)) return { ok: true };
  return { ok: false, reason: `Strength workout id is not numeric after create (still a draft): ${JSON.stringify(id)}.` };
}

// ─── execution_status two-axis lifecycle (pure state-machine reference) ───────

export type TrainingPeaksActionExecutionStatus =
  | "not_started"
  | "dry_run_running"
  | "dry_run_completed"
  | "execute_pending"
  | "running_local"
  | "completed"
  | "failed";

const ALLOWED_EXECUTION_STATUS_TRANSITIONS: Record<TrainingPeaksActionExecutionStatus, TrainingPeaksActionExecutionStatus[]> = {
  not_started: ["dry_run_running"],
  dry_run_running: ["dry_run_completed", "failed"],
  dry_run_completed: ["execute_pending"],
  execute_pending: ["running_local"],
  running_local: ["completed", "failed"],
  completed: [],
  failed: [],
};

/**
 * Pure statement of which execution_status transitions are legal. The actual
 * enforcement lives in Supabase compare-and-swap UPDATE...WHERE clauses
 * (repository.ts) -- this function is the single source of truth for what
 * SHOULD be allowed, used by tests and available as a defensive pre-check.
 */
export function isValidExecutionStatusTransition(
  from: TrainingPeaksActionExecutionStatus,
  to: TrainingPeaksActionExecutionStatus,
): boolean {
  return ALLOWED_EXECUTION_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
