import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeDraftEditDiff } from "./draft-edit-diff.ts";

describe("computeDraftEditDiff", () => {
  test("no edit → not changed", () => {
    assert.deepEqual(computeDraftEditDiff("Молодец, отлично вышло 👍", "Молодец, отлично вышло 👍"), { changed: false, added: [], removed: [] });
  });
  test("null draft → not changed", () => {
    assert.deepEqual(computeDraftEditDiff(null, "что-то"), { changed: false, added: [], removed: [] });
  });
  test("word replaced → captures removed + added (Igor's rewrite)", () => {
    const d = computeDraftEditDiff("пульс не частил к концу", "пульс не скакал к концу");
    assert.equal(d.changed, true);
    assert.deepEqual(d.removed, ["частил"]);
    assert.deepEqual(d.added, ["скакал"]);
  });
  test("word added only", () => {
    const d = computeDraftEditDiff("Молодец", "Молодец, отлично");
    assert.deepEqual(d.removed, []);
    assert.deepEqual(d.added, ["отлично"]);
  });
  test("word removed only", () => {
    const d = computeDraftEditDiff("заметно чище аэробно сегодня", "заметно чище сегодня");
    assert.deepEqual(d.removed, ["аэробно"]);
    assert.deepEqual(d.added, []);
  });
  test("punctuation/case only → not a change", () => {
    assert.equal(computeDraftEditDiff("Хорошо получилось", "хорошо получилось.").changed, false);
  });
});
