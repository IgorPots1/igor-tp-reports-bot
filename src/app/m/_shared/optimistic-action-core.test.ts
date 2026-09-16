import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createKeyedGate, runOptimisticActionCore } from "./optimistic-action-core.ts";

// Run: node --experimental-strip-types --test src/app/m/_shared/optimistic-action-core.test.ts
//
// Test names mirror the наряд's Приёмка list 1:1 — this file IS that acceptance proof.

describe("runOptimisticActionCore", () => {
  test("подтверждение меняет состояние строки без навигации и без перезапроса всего маршрута", async () => {
    let row = { status: "pending" };
    const calledOutsideCallbacks: string[] = [];
    const outcome = await runOptimisticActionCore({
      optimisticUpdate: () => {
        row = { status: "done" };
      },
      request: async () => {
        // The row is already updated locally before the request even resolves — nothing waits
        // for a full-route refetch or a navigation to show the new state.
        assert.deepEqual(row, { status: "done" });
        calledOutsideCallbacks.push("request");
        return { ok: true };
      },
      isSuccess: (r) => r.ok,
    });
    assert.equal(outcome, "success");
    assert.deepEqual(row, { status: "done" });
    assert.deepEqual(calledOutsideCallbacks, ["request"]);
  });

  test("ошибка сервера откатывает оптимистичное состояние, экран не перезагружается", async () => {
    let row = { status: "pending" };
    let failureMessage: string | null = null;
    const outcome = await runOptimisticActionCore({
      optimisticUpdate: () => {
        row = { status: "done" };
      },
      rollback: () => {
        row = { status: "pending" };
      },
      request: async () => ({ ok: false, error: "не удалось" }),
      isSuccess: (r) => r.ok,
      onFailure: (r) => {
        failureMessage = r?.error ?? "сеть";
      },
    });
    assert.equal(outcome, "failure");
    assert.deepEqual(row, { status: "pending" }); // rolled back, not left half-applied
    assert.equal(failureMessage, "не удалось");
  });

  test("сетевая ошибка (request бросает) тоже откатывает, а не падает наружу", async () => {
    let row = { status: "pending" };
    const outcome = await runOptimisticActionCore({
      optimisticUpdate: () => {
        row = { status: "done" };
      },
      rollback: () => {
        row = { status: "pending" };
      },
      request: async () => {
        throw new Error("network down");
      },
      isSuccess: () => true,
    });
    assert.equal(outcome, "failure");
    assert.deepEqual(row, { status: "pending" });
  });

  test("a resolved-but-wrong outcome (isSuccess: false) rolls back same as an explicit error", async () => {
    // Mirrors send-report's "prepared" outcome: the request succeeds, but not with the outcome
    // the optimistic update assumed — the optimistic guess was wrong, so it must undo.
    let status: "review" | "sent" = "review";
    const outcome = await runOptimisticActionCore({
      optimisticUpdate: () => {
        status = "sent";
      },
      rollback: () => {
        status = "review";
      },
      request: async (): Promise<{ ok: true; outcome: "sent" | "prepared" }> => ({ ok: true, outcome: "prepared" }),
      isSuccess: (r) => r.outcome === "sent",
    });
    assert.equal(outcome, "failure");
    assert.equal(status, "review");
  });

  test("haptic fires impact on tap and error on failure, success on success — never both", async () => {
    const fired: string[] = [];
    await runOptimisticActionCore({
      request: async () => ({ ok: true }),
      isSuccess: (r) => r.ok,
      haptic: (kind) => fired.push(kind),
    });
    assert.deepEqual(fired, ["impact", "success"]);

    const firedOnError: string[] = [];
    await runOptimisticActionCore({
      request: async () => ({ ok: false }),
      isSuccess: (r) => r.ok,
      haptic: (kind) => firedOnError.push(kind),
    });
    assert.deepEqual(firedOnError, ["impact", "error"]);
  });
});

describe("createKeyedGate", () => {
  test("два подтверждения подряд по разным строкам не конфликтуют", () => {
    const gate = createKeyedGate();
    assert.equal(gate.tryEnter("student-a"), true);
    assert.equal(gate.tryEnter("student-b"), true); // different key — not blocked by "a" being active
    assert.equal(gate.has("student-a"), true);
    assert.equal(gate.has("student-b"), true);
  });

  test("повторное нажатие по той же строке игнорируется, пока действие в полёте", () => {
    const gate = createKeyedGate();
    assert.equal(gate.tryEnter("student-a"), true);
    assert.equal(gate.tryEnter("student-a"), false); // still in flight — rejected
    gate.leave("student-a");
    assert.equal(gate.tryEnter("student-a"), true); // free again after it settles
  });
});
