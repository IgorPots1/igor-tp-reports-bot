import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeBatchAggregate, detectBatchAnomalies, type BatchAnomalyContext } from "./batch-preview.ts";
import type { BatchChildSpec } from "./tp-write-action-types.ts";

function emptyContext(overrides: Partial<BatchAnomalyContext> = {}): BatchAnomalyContext {
  return {
    studentNameByAthleteId: new Map(),
    raceDatesByAthleteId: new Map(),
    existingWorkoutDatesByAthleteId: new Map(),
    weeklyMinutesCapByAthleteId: new Map(),
    hasActiveHealthSignalByAthleteId: new Map(),
    ...overrides,
  };
}

describe("computeBatchAggregate", () => {
  test("counts athletes, actions by type, and planned volume", () => {
    const children: BatchChildSpec[] = [
      { actionType: "create_workout", payload: { athleteId: 1, workoutDay: "2026-12-05", totalTimePlanned: 1, distancePlanned: 10000 }, label: "a" },
      { actionType: "create_workout", payload: { athleteId: 1, workoutDay: "2026-12-06", totalTimePlanned: 0.5 }, label: "b" },
      { actionType: "strength_workout", payload: { athleteId: 2, prescribedDate: "2026-12-05", totalTimePlanned: 0.75 }, label: "c" },
      { actionType: "delete_workout", payload: { athleteId: 2, workoutId: 999 }, label: "d" },
    ];
    const stats = computeBatchAggregate(children);
    assert.equal(stats.totalActions, 4);
    assert.equal(stats.athleteCount, 2);
    assert.deepEqual(stats.countByType, { create_workout: 2, strength_workout: 1, delete_workout: 1 });
    assert.equal(stats.totalPlannedMinutes, 60 + 30 + 45); // 1h + 0.5h + 0.75h
    assert.equal(stats.totalPlannedDistanceMeters, 10000);
  });

  test("empty batch has zero everything, never throws", () => {
    const stats = computeBatchAggregate([]);
    assert.equal(stats.totalActions, 0);
    assert.equal(stats.athleteCount, 0);
    assert.deepEqual(stats.countByType, {});
  });

  test("ignores children with no athleteId rather than throwing", () => {
    const children: BatchChildSpec[] = [{ actionType: "create_workout", payload: {}, label: "malformed" }];
    assert.doesNotThrow(() => computeBatchAggregate(children));
    assert.equal(computeBatchAggregate(children).athleteCount, 0);
  });
});

describe("detectBatchAnomalies", () => {
  const child = (athleteId: number, workoutDay: string, totalTimePlanned?: number): BatchChildSpec => ({
    actionType: "create_workout",
    payload: { athleteId, workoutDay, ...(totalTimePlanned ? { totalTimePlanned } : {}) },
    label: `athlete ${athleteId} on ${workoutDay}`,
  });

  test("flags a workout 3-6 days before a race", () => {
    const context = emptyContext({ raceDatesByAthleteId: new Map([[1, ["2026-12-10"]]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05")], context); // 5 days before
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].kind, "race_proximity");
    assert.equal(anomalies[0].athleteId, 1);
  });

  test("does NOT flag a workout more than 6 days before a race", () => {
    const context = emptyContext({ raceDatesByAthleteId: new Map([[1, ["2026-12-20"]]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05")], context); // 15 days before
    assert.equal(anomalies.filter((a) => a.kind === "race_proximity").length, 0);
  });

  test("does NOT flag a workout AFTER the race date", () => {
    const context = emptyContext({ raceDatesByAthleteId: new Map([[1, ["2026-12-01"]]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05")], context);
    assert.equal(anomalies.filter((a) => a.kind === "race_proximity").length, 0);
  });

  test("flags a workout on a date that already has something in the cache", () => {
    const context = emptyContext({ existingWorkoutDatesByAthleteId: new Map([[1, new Set(["2026-12-05"])]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05")], context);
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].kind, "existing_workout_collision");
  });

  test("flags every proposed workout for an athlete with an active health signal", () => {
    const context = emptyContext({ hasActiveHealthSignalByAthleteId: new Map([[1, true]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05"), child(1, "2026-12-06")], context);
    const healthFlags = anomalies.filter((a) => a.kind === "active_health_signal");
    assert.equal(healthFlags.length, 2); // one per child touching that athlete -- each proposed workout on a flagged athlete is worth surfacing
  });

  test("flags planned batch volume for an athlete above their weekly cap", () => {
    const context = emptyContext({ weeklyMinutesCapByAthleteId: new Map([[1, 300]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05", 3), child(1, "2026-12-06", 3)], context); // 6h = 360min > 300 cap
    assert.equal(anomalies.filter((a) => a.kind === "volume_spike").length, 1);
  });

  test("does NOT flag volume when under the cap", () => {
    const context = emptyContext({ weeklyMinutesCapByAthleteId: new Map([[1, 600]]) });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05", 3)], context);
    assert.equal(anomalies.filter((a) => a.kind === "volume_spike").length, 0);
  });

  test("no context data at all -> no anomalies, never throws", () => {
    assert.doesNotThrow(() => detectBatchAnomalies([child(1, "2026-12-05", 1)], emptyContext()));
    assert.deepEqual(detectBatchAnomalies([child(1, "2026-12-05", 1)], emptyContext()), []);
  });

  test("a clean batch across multiple athletes surfaces nothing", () => {
    const context = emptyContext({
      raceDatesByAthleteId: new Map([[1, ["2027-06-01"]]]), // far future, no proximity
      weeklyMinutesCapByAthleteId: new Map([[1, 10000], [2, 10000]]),
    });
    const anomalies = detectBatchAnomalies([child(1, "2026-12-05", 1), child(2, "2026-12-06", 1)], context);
    assert.deepEqual(anomalies, []);
  });
});
