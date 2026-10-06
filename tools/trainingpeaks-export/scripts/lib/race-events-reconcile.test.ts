import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planRaceEventReconcile, type ReconcileDbRow } from "./race-events-reconcile.ts";

const FROM = "2026-10-05";
const TO = "2027-02-02";

function row(id: string, studentId: string, eventDate: string, title: string, source = "scan"): ReconcileDbRow {
  return { id, studentId, studentName: studentId, eventDate, title, source };
}

describe("planRaceEventReconcile — deletes only what the scan proves is gone", () => {
  test("a start moved in TP: the old date goes, the new one stays (Kalakutok 10.10 → 18.10)", () => {
    const plan = planRaceEventReconcile({
      dbRows: [row("old", "kalakutok", "2026-10-10", "Магнит Город 233"), row("new", "kalakutok", "2026-10-18", "Магнит город 233")],
      scannedEvents: [{ studentId: "kalakutok", eventDate: "2026-10-18" }],
      athletes: [{ studentId: "kalakutok", studentName: "Mariyet Kalakutok", answered: true, rowsCount: 1 }],
      from: FROM,
      to: TO,
    });
    assert.deepEqual(plan.toDelete.map((r) => r.id), ["old"]);
    assert.deepEqual(plan.skipped, []);
  });

  test("403 / timeout / bad body: nothing of that athlete is deleted (Panina 10.10)", () => {
    const plan = planRaceEventReconcile({
      dbRows: [row("p", "panina", "2026-10-10", "Лесобег 11 Км")],
      scannedEvents: [],
      athletes: [{ studentId: "panina", studentName: "Olga Panina", answered: false, rowsCount: 0 }],
      from: FROM,
      to: TO,
    });
    assert.deepEqual(plan.toDelete, []);
    assert.deepEqual(plan.skipped, [{ studentId: "panina", studentName: "panina", reason: "no_answer", rowsKept: 1 }]);
  });

  test("an answered athlete with zero events while the table has some = a failure, not an empty calendar", () => {
    const plan = planRaceEventReconcile({
      dbRows: [row("a", "anna", "2026-10-24", "Арена марафон"), row("b", "anna", "2026-11-08", "Гатчина")],
      scannedEvents: [],
      athletes: [{ studentId: "anna", studentName: "Anna", answered: true, rowsCount: 0 }],
      from: FROM,
      to: TO,
    });
    assert.deepEqual(plan.toDelete, []);
    assert.equal(plan.skipped[0]?.reason, "zero_events_in_answer");
    assert.equal(plan.skipped[0]?.rowsKept, 2);
  });

  test("an athlete the run never reached keeps everything", () => {
    const plan = planRaceEventReconcile({
      dbRows: [row("x", "ghost", "2026-10-11", "Казань")],
      scannedEvents: [],
      athletes: [],
      from: FROM,
      to: TO,
    });
    assert.deepEqual(plan.toDelete, []);
    assert.equal(plan.skipped[0]?.reason, "not_scanned");
  });

  test("manual marks and rows outside the window are never candidates", () => {
    const plan = planRaceEventReconcile({
      dbRows: [
        row("manual", "lena", "2026-10-12", "Ручная отметка", "manual"),
        row("past", "lena", "2026-09-27", "Забег"),
        row("far", "lena", "2027-03-01", "Весенний"),
        row("gone", "lena", "2026-10-20", "Удалён в TP"),
      ],
      scannedEvents: [{ studentId: "lena", eventDate: "2026-10-10" }],
      athletes: [{ studentId: "lena", studentName: "ELENA", answered: true, rowsCount: 1 }],
      from: FROM,
      to: TO,
    });
    assert.deepEqual(plan.toDelete.map((r) => r.id), ["gone"]);
  });

  test("a student on two roster rows needs BOTH answers to count as answered", () => {
    const plan = planRaceEventReconcile({
      dbRows: [row("r", "dup", "2026-10-11", "Полумарафон")],
      scannedEvents: [],
      athletes: [
        { studentId: "dup", studentName: "Dup", answered: true, rowsCount: 2 },
        { studentId: "dup", studentName: "Dup", answered: false, rowsCount: 0 },
      ],
      from: FROM,
      to: TO,
    });
    assert.deepEqual(plan.toDelete, []);
    assert.equal(plan.skipped[0]?.reason, "no_answer");
  });
});
