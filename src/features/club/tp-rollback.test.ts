import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isDeleteEffectivelyGone } from "./tp-rollback.ts";

describe("isDeleteEffectivelyGone", () => {
  test("2xx deletes count as gone", () => {
    assert.equal(isDeleteEffectivelyGone(200), true);
    assert.equal(isDeleteEffectivelyGone(204), true);
    assert.equal(isDeleteEffectivelyGone(299), true);
  });

  test("404 counts as gone (already deleted in TP by a human)", () => {
    assert.equal(isDeleteEffectivelyGone(404), true);
  });

  test("other statuses do NOT count as gone (row kept + retried)", () => {
    assert.equal(isDeleteEffectivelyGone(400), false);
    assert.equal(isDeleteEffectivelyGone(401), false);
    assert.equal(isDeleteEffectivelyGone(403), false);
    assert.equal(isDeleteEffectivelyGone(409), false);
    assert.equal(isDeleteEffectivelyGone(500), false);
    assert.equal(isDeleteEffectivelyGone(502), false);
  });
});
