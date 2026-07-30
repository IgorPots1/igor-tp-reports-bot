import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildWorkoutSeries, type NormalizedFitRecord } from "./fit-workout-normalization.ts";

function rec(timeS: number, hr: number | null, speedMps: number | null): NormalizedFitRecord {
  return { timeS, heartRate: hr, cadenceRpm: null, speedMps, distanceM: null, altitudeM: null, power: null };
}

describe("buildWorkoutSeries", () => {
  test("downsamples ~300 records to the target point count", () => {
    const records = Array.from({ length: 300 }, (_, i) => rec(i, 150, 3.3333));
    const series = buildWorkoutSeries(records, 120);
    assert.ok(series);
    assert.equal(series.length, 120);
    // constant HR 150, speed 3.3333 m/s → pace = 1000/3.3333 ≈ 300 s/km
    assert.equal(series[0].hr, 150);
    assert.equal(series[0].pace, 300);
    assert.ok(series.every((p) => p.hr === 150 && p.pace === 300));
  });

  test("averages HR within a bucket", () => {
    // 4 records, 2 buckets → bucket 0 avgs {140,160}=150, bucket 1 avgs {150,170}=160
    const records = [rec(0, 140, 3), rec(1, 160, 3), rec(2, 150, 3), rec(3, 170, 3)];
    const series = buildWorkoutSeries(records, 2);
    assert.ok(series);
    assert.equal(series.length, 2);
    assert.equal(series[0].hr, 150);
    assert.equal(series[1].hr, 160);
  });

  test("a stopped bucket (speed ~0) yields pace=null (gap), HR still present", () => {
    const moving = Array.from({ length: 60 }, (_, i) => rec(i, 150, 3));
    const stopped = Array.from({ length: 60 }, (_, i) => rec(60 + i, 120, 0));
    const series = buildWorkoutSeries([...moving, ...stopped], 2);
    assert.ok(series);
    assert.equal(series[0].pace, Math.round(1000 / 3));
    assert.equal(series[1].pace, null); // stopped → no pace
    assert.equal(series[1].hr, 120); // HR still recorded
  });

  test("returns null for < 2 records", () => {
    assert.equal(buildWorkoutSeries([rec(0, 150, 3)]), null);
    assert.equal(buildWorkoutSeries([]), null);
  });

  test("returns null when neither HR nor pace is present anywhere", () => {
    const records = [rec(0, null, null), rec(1, null, 0), rec(2, null, null)];
    assert.equal(buildWorkoutSeries(records), null);
  });
});
