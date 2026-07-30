import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildCoachDeskStartsView, dedupeStartRows } from "./coach-desk-starts.ts";
import type { TrainingPeaksRaceEventRow } from "./repository.ts";

function row(over: Partial<TrainingPeaksRaceEventRow> = {}): TrainingPeaksRaceEventRow {
  return {
    id: over.id ?? "r1",
    studentId: over.studentId ?? "s1",
    studentName: over.studentName ?? "Иван",
    eventDate: over.eventDate ?? "2026-08-01",
    title: over.title ?? "Забег",
    distanceRaw: over.distanceRaw ?? "10 км",
    source: over.source ?? "scan",
  };
}

describe("dedupeStartRows", () => {
  test("declared race not in the scan is appended", () => {
    const scanned = [row({ id: "sc", studentId: "s1", eventDate: "2026-08-01" })];
    const declared = [row({ id: "de", studentId: "s2", eventDate: "2026-08-02", source: "club_declared" })];
    const merged = dedupeStartRows(scanned, declared);
    assert.equal(merged.length, 2);
    assert.deepEqual(
      merged.map((r) => r.id),
      ["sc", "de"]
    );
  });

  test("declared race with the same (student, date) as a scanned one is dropped (scan wins)", () => {
    const scanned = [row({ id: "sc", studentId: "s1", eventDate: "2026-08-01", title: "Белые ночи" })];
    const declared = [
      row({ id: "de", studentId: "s1", eventDate: "2026-08-01", title: "Забег 21", source: "club_declared" }),
    ];
    const merged = dedupeStartRows(scanned, declared);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "sc");
    assert.equal(merged[0].title, "Белые ночи");
  });

  test("same date but different students keeps both", () => {
    const scanned = [row({ id: "sc", studentId: "s1", eventDate: "2026-08-01" })];
    const declared = [row({ id: "de", studentId: "s2", eventDate: "2026-08-01", source: "club_declared" })];
    assert.equal(dedupeStartRows(scanned, declared).length, 2);
  });

  test("empty declared returns the scan unchanged", () => {
    const scanned = [row({ id: "sc" }), row({ id: "sc2", studentId: "s2" })];
    assert.deepEqual(dedupeStartRows(scanned, []), scanned);
  });
});

describe("buildCoachDeskStartsView pending flag", () => {
  test("a club_declared start marks its athlete pending; a scanned start does not", () => {
    const rows = [
      row({ studentId: "s1", studentName: "Иван", eventDate: "2026-08-01", title: "Марафон", source: "scan" }),
      row({ studentId: "s2", studentName: "Пётр", eventDate: "2026-08-01", title: "Марафон", source: "club_declared" }),
    ];
    const view = buildCoachDeskStartsView(rows, "2026-07-30");
    const all = [...view.thisWeek, ...view.later];
    const event = all.find((e) => e.athletes.length === 2);
    assert.ok(event, "both athletes collapse into one event");
    const ivan = event.athletes.find((a) => a.studentId === "s1");
    const petr = event.athletes.find((a) => a.studentId === "s2");
    assert.equal(ivan?.pending ?? false, false);
    assert.equal(petr?.pending, true);
  });
});
