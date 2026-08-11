import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeTrainingPeaksWorkoutItem, type TrainingPeaksWorkoutRaw } from "./trainingpeaks-workout-normalization.ts";

function normalize(raw: TrainingPeaksWorkoutRaw) {
  const result = normalizeTrainingPeaksWorkoutItem({ athleteId: 5475792, raw });
  assert.ok(result, "expected the item to normalize");
  return result;
}

const BASE: TrainingPeaksWorkoutRaw = { workoutId: 3831859359, workoutDay: "2026-07-11T00:00:00" };

describe("normalizeTrainingPeaksWorkoutItem — planned strength", () => {
  test("metric-less strength with a title IS a plan", () => {
    // Exact shape TrainingPeaks returns for a coach-planned strength session, captured
    // live on 2026-08-11 (Nadezhda Starostina, workoutId 3831859359): title + type + day
    // and nothing else. No totalTimePlanned, no distancePlanned, no tssPlanned.
    const row = normalize({ ...BASE, title: "Силовая", workoutTypeValueId: 9, orderOnDay: 1 });
    assert.equal(row.isPlanned, true);
    assert.equal(row.isCompleted, false);
    assert.equal(row.plannedTimeRaw, null);
    assert.equal(row.plannedDistanceRaw, null);
    assert.ok(
      !row.normalizationWarnings.includes("Neither planned nor completed metrics were detected."),
      "a recognised plan must not warn about missing metrics"
    );
  });

  test("strength WITH an actual time stays a completed device upload, not a plan", () => {
    const row = normalize({ ...BASE, title: "Strength", workoutTypeValueId: 9, totalTime: 1.2371156215667725 });
    assert.equal(row.isPlanned, false);
    assert.equal(row.isCompleted, true);
  });

  test("metric-less strength with NO title stays neither (empty husk of a deleted row)", () => {
    const row = normalize({ ...BASE, title: null, workoutTypeValueId: 9 });
    assert.equal(row.isPlanned, false);
    assert.equal(row.isCompleted, false);
  });
});

describe("normalizeTrainingPeaksWorkoutItem — the rule stays scoped to strength", () => {
  // Day off (7) and the club's Other (100) markers arrive metric-less too. Both MUST stay
  // planned=false/completed=false: docs/club-tp-exec-validation.md relies on a Day off not
  // counting as a planned workout, and a club marker is not training at all.
  test("Day off (type 7) does not become a plan", () => {
    const row = normalize({ ...BASE, title: "Отдых", workoutTypeValueId: 7 });
    assert.equal(row.isPlanned, false);
    assert.equal(row.isCompleted, false);
  });

  test("club marker (type 100) does not become a plan", () => {
    const row = normalize({ ...BASE, title: "Выходной [клуб]", workoutTypeValueId: 100 });
    assert.equal(row.isPlanned, false);
    assert.equal(row.isCompleted, false);
  });

  test("metric-less RUN does not become a plan", () => {
    const row = normalize({ ...BASE, title: "Лёгкий бег", workoutTypeValueId: 3 });
    assert.equal(row.isPlanned, false);
    assert.equal(row.isCompleted, false);
  });

  test("a normal planned run is unchanged", () => {
    const row = normalize({ ...BASE, title: "10 х 3 мин", workoutTypeValueId: 3, totalTimePlanned: 1.25 });
    assert.equal(row.isPlanned, true);
    assert.equal(row.isCompleted, false);
  });

  test("a planned-and-completed run is unchanged", () => {
    const row = normalize({
      ...BASE,
      title: "Длительный",
      workoutTypeValueId: 3,
      totalTimePlanned: 2,
      totalTime: 1.95,
      distancePlanned: 25000,
      distance: 24800,
    });
    assert.equal(row.isPlanned, true);
    assert.equal(row.isCompleted, true);
  });
});
