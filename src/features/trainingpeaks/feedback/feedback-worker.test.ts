import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { clampWorkerLimit, verifyFeedbackWorkerRequest, DEFAULT_WORKER_BATCH, MAX_WORKER_BATCH } from "./feedback-worker-auth.ts";

const SECRET = "test-worker-secret-abc123";

function req(authHeader?: string): Request {
  return new Request("http://localhost/api/feedback/worker/claim", {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("clampWorkerLimit", () => {
  test("undefined / NaN → default 5", () => {
    assert.equal(clampWorkerLimit(undefined), DEFAULT_WORKER_BATCH);
    assert.equal(clampWorkerLimit(Number.NaN), DEFAULT_WORKER_BATCH);
  });
  test("in-range passes, floored", () => {
    assert.equal(clampWorkerLimit(3), 3);
    assert.equal(clampWorkerLimit(7.9), 7);
  });
  test("caps at MAX and floors at 1", () => {
    assert.equal(clampWorkerLimit(20), MAX_WORKER_BATCH);
    assert.equal(clampWorkerLimit(0), 1);
    assert.equal(clampWorkerLimit(-5), 1);
  });
});

describe("verifyFeedbackWorkerRequest", () => {
  const prev = process.env.FEEDBACK_WORKER_SECRET;
  afterEach(() => {
    if (prev === undefined) delete process.env.FEEDBACK_WORKER_SECRET;
    else process.env.FEEDBACK_WORKER_SECRET = prev;
  });

  test("no secret configured → 500", () => {
    delete process.env.FEEDBACK_WORKER_SECRET;
    const r = verifyFeedbackWorkerRequest(req(`Bearer ${SECRET}`));
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 500);
  });

  test("missing Authorization header → 401", () => {
    process.env.FEEDBACK_WORKER_SECRET = SECRET;
    const r = verifyFeedbackWorkerRequest(req());
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 401);
  });

  test("wrong token → 401", () => {
    process.env.FEEDBACK_WORKER_SECRET = SECRET;
    const r = verifyFeedbackWorkerRequest(req("Bearer nope"));
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 401);
  });

  test("wrong scheme (lowercase bearer) → 401", () => {
    process.env.FEEDBACK_WORKER_SECRET = SECRET;
    const r = verifyFeedbackWorkerRequest(req(`bearer ${SECRET}`));
    assert.equal(r.ok, false);
  });

  test("correct Bearer token → ok", () => {
    process.env.FEEDBACK_WORKER_SECRET = SECRET;
    const r = verifyFeedbackWorkerRequest(req(`Bearer ${SECRET}`));
    assert.equal(r.ok, true);
  });
});
