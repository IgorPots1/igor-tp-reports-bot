import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildRaceExclusionKeys, type RaceDayDistances, type RunForExclusion } from "./race-shift-gate.ts";

const S = "student-1";
// Median HR is built from the runs passed in; a spread of easy runs puts the median ~138,
// so races/hard runs read as "over median".
const easyRuns = (dates: string[]): RunForExclusion[] =>
  dates.map((d) => ({ studentId: S, date: d, distanceKm: 8, avgHr: 138, hrTrusted: true }));

const races = (entries: Array<[string, number | null]>): RaceDayDistances => {
  const m = new Map<string, number | null>();
  for (const [day, km] of entries) m.set(day, km);
  return new Map([[S, m]]);
};

describe("buildRaceExclusionKeys — exact day (mirrors fetchRaceKeys)", () => {
  test("a run ON the event date is always excluded", () => {
    const keys = buildRaceExclusionKeys(races([["2026-05-03", 10]]), [
      { studentId: S, date: "2026-05-03", distanceKm: 10, avgHr: 185, hrTrusted: true },
      ...easyRuns(["2026-05-01", "2026-05-02", "2026-05-06"]),
    ]);
    assert.ok(keys.has(`${S}|2026-05-03`));
  });
  test("the event-date key is present even when no run is logged that day", () => {
    const keys = buildRaceExclusionKeys(races([["2026-05-03", 10]]), easyRuns(["2026-05-10"]));
    assert.ok(keys.has(`${S}|2026-05-03`));
  });
});

describe("buildRaceExclusionKeys — ±1 smart gate", () => {
  const base = easyRuns(["2026-05-01", "2026-05-02", "2026-05-10", "2026-05-11", "2026-05-12"]); // median ~138

  test("shifted race caught: no run on E, adjacent hard + distance matches", () => {
    const keys = buildRaceExclusionKeys(races([["2026-05-03", 10]]), [
      ...base,
      { studentId: S, date: "2026-05-04", distanceKm: 10.2, avgHr: 185, hrTrusted: true },
    ]);
    assert.ok(keys.has(`${S}|2026-05-04`), "E+1 shifted race excluded");
  });

  test("easy run near a race is PROTECTED: adjacent HR not over median", () => {
    const keys = buildRaceExclusionKeys(races([["2026-05-03", 10]]), [
      ...base,
      { studentId: S, date: "2026-05-04", distanceKm: 10, avgHr: 139, hrTrusted: true },
    ]);
    assert.ok(!keys.has(`${S}|2026-05-04`), "easy adjacent run kept");
  });

  test("hard run with WRONG distance is protected (a 14.9km run is not a 5km race)", () => {
    const keys = buildRaceExclusionKeys(races([["2026-04-26", 5]]), [
      ...base,
      { studentId: S, date: "2026-04-25", distanceKm: 14.9, avgHr: 170, hrTrusted: true },
    ]);
    assert.ok(!keys.has(`${S}|2026-04-25`), "distance mismatch kept even though hard");
  });

  test("no ±1 when there IS a run on the exact event date", () => {
    const keys = buildRaceExclusionKeys(races([["2026-05-03", 10]]), [
      ...base,
      { studentId: S, date: "2026-05-03", distanceKm: 10, avgHr: 180, hrTrusted: true },
      { studentId: S, date: "2026-05-04", distanceKm: 10, avgHr: 180, hrTrusted: true },
    ]);
    assert.ok(!keys.has(`${S}|2026-05-04`), "adjacent kept because event date already has a run");
  });

  test("untrusted HR never triggers exclusion", () => {
    const keys = buildRaceExclusionKeys(races([["2026-05-03", 10]]), [
      ...base,
      { studentId: S, date: "2026-05-04", distanceKm: 10, avgHr: 185, hrTrusted: false },
    ]);
    assert.ok(!keys.has(`${S}|2026-05-04`), "untrusted HR ignored");
  });

  test("race distance unknown: caught only with the stronger HR margin (+10)", () => {
    const caught = buildRaceExclusionKeys(races([["2026-06-20", null]]), [
      ...base,
      { studentId: S, date: "2026-06-21", distanceKm: 6.2, avgHr: 155, hrTrusted: true }, // +17 over ~138
    ]);
    assert.ok(caught.has(`${S}|2026-06-21`), "night race (dist unknown) caught by strong HR");

    const spared = buildRaceExclusionKeys(races([["2026-06-20", null]]), [
      ...base,
      { studentId: S, date: "2026-06-21", distanceKm: 9.3, avgHr: 144, hrTrusted: true }, // +6, below +10
    ]);
    assert.ok(!spared.has(`${S}|2026-06-21`), "marginally elevated (dist unknown) kept");
  });
});
