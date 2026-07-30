import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isEventGone, isEventPresent, reconcileCutoffIso } from "./tp-reconcile.ts";

describe("isEventGone", () => {
  test("only 404 counts as gone", () => {
    assert.equal(isEventGone(404), true);
  });
  test("2xx / other statuses are NOT gone (never reject a live race on a blip)", () => {
    assert.equal(isEventGone(200), false);
    assert.equal(isEventGone(403), false);
    assert.equal(isEventGone(429), false);
    assert.equal(isEventGone(500), false);
    assert.equal(isEventGone(502), false);
  });
});

describe("isEventPresent", () => {
  test("2xx present, everything else not", () => {
    assert.equal(isEventPresent(200), true);
    assert.equal(isEventPresent(204), true);
    assert.equal(isEventPresent(404), false);
    assert.equal(isEventPresent(500), false);
  });
});

describe("reconcileCutoffIso", () => {
  test("subtracts days and crosses month boundaries", () => {
    assert.equal(reconcileCutoffIso("2026-07-30", 31), "2026-06-29");
    assert.equal(reconcileCutoffIso("2026-03-05", 10), "2026-02-23");
    assert.equal(reconcileCutoffIso("2026-01-10", 31), "2025-12-10");
  });
  test("zero days is the same day", () => {
    assert.equal(reconcileCutoffIso("2026-07-30", 0), "2026-07-30");
  });
});
