import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rejectedRaceReason } from "./rejected-reason.ts";

describe("rejectedRaceReason", () => {
  test("non-rejected → null (no reason shown)", () => {
    assert.equal(rejectedRaceReason("approved", null), null);
    assert.equal(rejectedRaceReason("applied", "СВЕРКА: что-то"), null);
  });

  test("rejected with a reconcile marker → снято в TP (сверка)", () => {
    assert.equal(rejectedRaceReason("rejected", "СВЕРКА: событие 123 удалено в TP вручную (сверка 2026-07-30)"), "снято в TP (сверка)");
  });

  test("rejected without a marker → отклонено тренером", () => {
    assert.equal(rejectedRaceReason("rejected", null), "отклонено тренером");
    assert.equal(rejectedRaceReason("rejected", ""), "отклонено тренером");
  });

  test("rejected with an unrelated send error (not a reconcile marker) → отклонено тренером", () => {
    assert.equal(rejectedRaceReason("rejected", "TP create failed: 500"), "отклонено тренером");
  });
});
