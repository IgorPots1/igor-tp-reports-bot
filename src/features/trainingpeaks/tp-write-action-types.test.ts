import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildRollbackPlan,
  computePayloadFingerprint,
  isValidExecutionStatusTransition,
  planBatchFanOut,
  validateGenericDryRunLogReadiness,
  verifyCreateOutcome,
  verifyDeleteOutcome,
  verifyMoveOutcome,
  verifyStrengthCreateOutcome,
  verifyUpdateOutcome,
  type BatchPayload,
} from "./tp-write-action-types.ts";

// Run: node --experimental-strip-types --test src/features/trainingpeaks/tp-write-action-types.test.ts

// ─── rollback planning ──────────────────────────────────────────────────────────

describe("buildRollbackPlan", () => {
  test("create_workout -> delete_workout, using the create RESPONSE (pre-image) for the new workoutId", () => {
    const preImage = { athleteId: 42, workoutId: 999, title: "Test" };
    const plan = buildRollbackPlan("create_workout", preImage, { athleteId: 42 });
    assert.equal("error" in plan, false);
    if ("error" in plan) return;
    assert.equal(plan.actionType, "delete_workout");
    assert.deepEqual(plan.payload, { athleteId: 42, workoutId: 999 });
  });

  test("create_workout rollback fails loudly if pre-image is missing the assigned workoutId", () => {
    const plan = buildRollbackPlan("create_workout", { athleteId: 42 }, {});
    assert.equal("error" in plan, true);
  });

  test("move_workout -> move_workout back to the pre-image's ORIGINAL workoutDay", () => {
    const preImage = { athleteId: 42, workoutId: 123, workoutDay: "2026-06-01T00:00:00" };
    const plan = buildRollbackPlan("move_workout", preImage, { targetWorkoutDay: "2026-06-15T00:00:00" });
    assert.equal("error" in plan, false);
    if ("error" in plan) return;
    assert.equal(plan.actionType, "move_workout");
    assert.deepEqual(plan.payload, { athleteId: 42, workoutId: 123, targetWorkoutDay: "2026-06-01T00:00:00" });
  });

  test("update_workout -> update_workout restoring ONLY the fields that were originally changed", () => {
    const preImage = { athleteId: 42, workoutId: 123, title: "Old title", distancePlanned: 5000 };
    const originPayload = { fields: { title: "New title" } }; // only "title" was changed originally
    const plan = buildRollbackPlan("update_workout", preImage, originPayload);
    assert.equal("error" in plan, false);
    if ("error" in plan) return;
    assert.equal(plan.actionType, "update_workout");
    assert.deepEqual(plan.payload, { athleteId: 42, workoutId: 123, fields: { title: "Old title" } });
    // distancePlanned was never in the changed-field list -- rollback must not touch it.
    assert.equal("distancePlanned" in (plan.payload as { fields: Record<string, unknown> }).fields, false);
  });

  test("strength_workout -> delete_workout (mirrors create's rollback, proven to work in PR1)", () => {
    const preImage = { id: "22291958", calendarId: 3102415 };
    const plan = buildRollbackPlan("strength_workout", preImage, {});
    assert.equal("error" in plan, false);
    if ("error" in plan) return;
    assert.equal(plan.actionType, "delete_workout");
    assert.deepEqual(plan.payload, { athleteId: 3102415, workoutId: 22291958 });
  });

  test("delete_workout rollback is DELIBERATELY unsupported (cannot recreate the original id / recover completed data)", () => {
    const plan = buildRollbackPlan("delete_workout", { athleteId: 42, workoutId: 1 }, {});
    assert.equal("error" in plan, true);
    if (!("error" in plan)) return;
    assert.match(plan.error, /cannot be recreated/);
  });

  test("batch has no single rollback plan", () => {
    const plan = buildRollbackPlan("batch", {}, {});
    assert.equal("error" in plan, true);
  });
});

// ─── generic (non-move) dry-run revalidation ───────────────────────────────────

describe("validateGenericDryRunLogReadiness", () => {
  test("passes when the dry-run's proposed payload EXACTLY matches the current payload", () => {
    const payload = { athleteId: 42, title: "Run", fields: { a: 1, b: 2 } };
    const log = { dryRunResult: "payload_prepared", proposedPayload: payload };
    const result = validateGenericDryRunLogReadiness(log, payload);
    assert.deepEqual(result, { ok: true });
  });

  test("passes regardless of object key ORDER (fingerprint is key-order independent)", () => {
    const log = { dryRunResult: "payload_prepared", proposedPayload: { b: 2, a: 1 } };
    const result = validateGenericDryRunLogReadiness(log, { a: 1, b: 2 });
    assert.deepEqual(result, { ok: true });
  });

  test("REFUSES when the current payload differs from what was approved -- never 'close enough'", () => {
    const log = { dryRunResult: "payload_prepared", proposedPayload: { athleteId: 42, title: "Run" } };
    const result = validateGenericDryRunLogReadiness(log, { athleteId: 42, title: "Different title" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /changed since the dry-run/);
  });

  test("refuses when the dry-run log is missing entirely", () => {
    const result = validateGenericDryRunLogReadiness(null, { athleteId: 42 });
    assert.equal(result.ok, false);
  });

  test("refuses when the dry-run did not successfully prepare a payload", () => {
    const result = validateGenericDryRunLogReadiness({ dryRunResult: "error" }, { athleteId: 42 });
    assert.equal(result.ok, false);
  });

  test("refuses when the dry-run log has no proposedPayload key at all", () => {
    const result = validateGenericDryRunLogReadiness({ dryRunResult: "payload_prepared" }, { athleteId: 42 });
    assert.equal(result.ok, false);
  });
});

describe("computePayloadFingerprint", () => {
  test("is stable across key order", () => {
    assert.equal(computePayloadFingerprint({ a: 1, b: 2 }), computePayloadFingerprint({ b: 2, a: 1 }));
  });
  test("is stable across NESTED key order", () => {
    assert.equal(
      computePayloadFingerprint({ outer: { a: 1, b: 2 } }),
      computePayloadFingerprint({ outer: { b: 2, a: 1 } }),
    );
  });
  test("differs when a value differs", () => {
    assert.notEqual(computePayloadFingerprint({ a: 1 }), computePayloadFingerprint({ a: 2 }));
  });
});

// ─── batch fan-out ───────────────────────────────────────────────────────────────

describe("planBatchFanOut", () => {
  test("builds a numbered human preview and passes the children through", () => {
    const batch: BatchPayload = {
      children: [
        { actionType: "move_workout", payload: {}, label: "Move #1 -> 2026-08-01" },
        { actionType: "create_workout", payload: {}, label: 'Create "Long run" on 2026-08-02' },
      ],
    };
    const result = planBatchFanOut(batch);
    assert.equal("error" in result, false);
    if ("error" in result) return;
    assert.equal(result.children.length, 2);
    assert.match(result.parentPreview, /Batch of 2 action\(s\)/);
    assert.match(result.parentPreview, /1\. \[move_workout\] Move #1 -> 2026-08-01/);
    assert.match(result.parentPreview, /2\. \[create_workout\] Create "Long run" on 2026-08-02/);
  });

  test("rejects an empty batch -- no silent zero-item confirm", () => {
    const result = planBatchFanOut({ children: [] });
    assert.equal("error" in result, true);
  });
});

// ─── per-action-type verify (readback outcome) ─────────────────────────────────

describe("verifyMoveOutcome", () => {
  test("passes when workoutDay starts with the target date", () => {
    assert.deepEqual(verifyMoveOutcome({ workoutDay: "2026-08-01T00:00:00" }, "2026-08-01"), { ok: true });
  });
  test("fails when workoutDay does not match", () => {
    const result = verifyMoveOutcome({ workoutDay: "2026-08-02T00:00:00" }, "2026-08-01");
    assert.equal(result.ok, false);
  });
  test("fails when the workout is missing entirely", () => {
    assert.equal(verifyMoveOutcome(null, "2026-08-01").ok, false);
  });
});

describe("verifyCreateOutcome", () => {
  test("passes when the created workout has a workoutId", () => {
    assert.deepEqual(verifyCreateOutcome({ workoutId: 123 }), { ok: true });
  });
  test("fails when the workout was not found after create", () => {
    assert.equal(verifyCreateOutcome(null).ok, false);
  });
});

describe("verifyUpdateOutcome", () => {
  test("passes when every expected field matches the readback", () => {
    const result = verifyUpdateOutcome({ title: "New", distancePlanned: 5000 }, { title: "New" });
    assert.deepEqual(result, { ok: true });
  });
  test("fails and NAMES the mismatched field(s) when the readback disagrees", () => {
    const result = verifyUpdateOutcome({ title: "Old" }, { title: "New" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /title/);
  });
  test("fails when the workout is missing after update", () => {
    assert.equal(verifyUpdateOutcome(null, { title: "New" }).ok, false);
  });
});

describe("verifyDeleteOutcome (PR1 finding: 400 'Invalid workoutId', NOT 404)", () => {
  test("passes on 400 + 'Invalid workoutId' body -- the REAL tpapi delete signature", () => {
    assert.deepEqual(verifyDeleteOutcome(400, "Invalid workoutId (123)"), { ok: true });
  });
  test("passes on a plain 404 too (the strength host's actual signature)", () => {
    assert.deepEqual(verifyDeleteOutcome(404, null), { ok: true });
  });
  test("fails if the workout still reads back as present (200)", () => {
    assert.equal(verifyDeleteOutcome(200, { workoutId: 123 }).ok, false);
  });
  test("fails on an UNRELATED 400 -- does not treat every 400 as 'deleted'", () => {
    assert.equal(verifyDeleteOutcome(400, "Some other bad request").ok, false);
  });
});

describe("verifyStrengthCreateOutcome", () => {
  test("passes when the id is numeric (persisted, per PR1)", () => {
    assert.deepEqual(verifyStrengthCreateOutcome({ id: "22291958" }), { ok: true });
  });
  test("fails when the id is still a UUID (draft, not persisted -- the OLD broken behavior PR1 fixed)", () => {
    const result = verifyStrengthCreateOutcome({ id: "52c8ca5a-a026-4a54-9834-7553702762f8" });
    assert.equal(result.ok, false);
  });
  test("fails when the workout is missing entirely", () => {
    assert.equal(verifyStrengthCreateOutcome(null).ok, false);
  });
});

// ─── execution_status lifecycle (pure state-machine reference) ────────────────

describe("isValidExecutionStatusTransition", () => {
  test("the full happy-path chain is valid, one hop at a time", () => {
    const chain: Array<Parameters<typeof isValidExecutionStatusTransition>[0]> = [
      "not_started",
      "dry_run_running",
      "dry_run_completed",
      "execute_pending",
      "running_local",
      "completed",
    ];
    for (let i = 0; i < chain.length - 1; i += 1) {
      assert.equal(isValidExecutionStatusTransition(chain[i], chain[i + 1]), true, `${chain[i]} -> ${chain[i + 1]}`);
    }
  });

  test("dry_run_running and running_local can both fail", () => {
    assert.equal(isValidExecutionStatusTransition("dry_run_running", "failed"), true);
    assert.equal(isValidExecutionStatusTransition("running_local", "failed"), true);
  });

  test("terminal states (completed, failed) have no outgoing transitions", () => {
    assert.equal(isValidExecutionStatusTransition("completed", "not_started"), false);
    assert.equal(isValidExecutionStatusTransition("failed", "not_started"), false);
    assert.equal(isValidExecutionStatusTransition("completed", "failed"), false);
  });

  test("cannot skip stages (e.g. not_started straight to execute_pending)", () => {
    assert.equal(isValidExecutionStatusTransition("not_started", "execute_pending"), false);
    assert.equal(isValidExecutionStatusTransition("not_started", "completed"), false);
  });

  test("cannot go backwards", () => {
    assert.equal(isValidExecutionStatusTransition("dry_run_completed", "dry_run_running"), false);
    assert.equal(isValidExecutionStatusTransition("execute_pending", "dry_run_completed"), false);
  });
});
