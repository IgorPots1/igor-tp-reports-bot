import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDomCompatibleFingerprint,
  evaluateMoveWorkoutCandidate,
  matchMoveWorkoutCandidate,
  type LiveWorkoutCandidate,
  type MoveWorkoutDomCandidate,
} from "./move-workout-resolver.ts";

// Run: node --experimental-strip-types --test src/features/trainingpeaks/move-workout-resolver.test.ts

const STUDENT_ID = "11111111-1111-1111-1111-111111111111";
const DATE = "2026-12-05";

function domCandidate(overrides: Partial<MoveWorkoutDomCandidate> = {}): MoveWorkoutDomCandidate {
  return {
    fingerprint: buildDomCompatibleFingerprint({
      studentId: STUDENT_ID,
      dateIso: DATE,
      title: "Long run",
      type: "run",
      startTimeLocal: null,
      plannedDurationSec: 3600,
      plannedDistanceKm: 10,
    }),
    title: "Long run",
    type: "run",
    startTimeLocal: null,
    plannedDurationSec: 3600,
    plannedDistanceKm: 10,
    ...overrides,
  };
}

function liveWorkout(overrides: Partial<LiveWorkoutCandidate> = {}): LiveWorkoutCandidate {
  return {
    workoutId: 1001,
    title: "Long run",
    workoutTypeValueId: 3, // run, per workout-activity-classification.ts
    totalTimePlannedHours: 1,
    distancePlannedMeters: 10000,
    startTimePlanned: null,
    ...overrides,
  };
}

describe("buildDomCompatibleFingerprint", () => {
  test("is a stable sha1 hex digest", () => {
    const fp = buildDomCompatibleFingerprint({
      studentId: STUDENT_ID,
      dateIso: DATE,
      title: "Long run",
      type: "run",
      startTimeLocal: null,
      plannedDurationSec: 3600,
      plannedDistanceKm: 10,
    });
    assert.match(fp, /^[0-9a-f]{40}$/);
  });

  test("is case/whitespace-insensitive on title and type, matching tp-actions-once.ts's algorithm", () => {
    const a = buildDomCompatibleFingerprint({ studentId: STUDENT_ID, dateIso: DATE, title: "Long Run", type: "RUN", startTimeLocal: null, plannedDurationSec: 3600, plannedDistanceKm: 10 });
    const b = buildDomCompatibleFingerprint({ studentId: STUDENT_ID, dateIso: DATE, title: " long run ", type: "run", startTimeLocal: null, plannedDurationSec: 3600, plannedDistanceKm: 10 });
    assert.equal(a, b);
  });

  test("differs when any field differs", () => {
    const base = { studentId: STUDENT_ID, dateIso: DATE, title: "Long run", type: "run", startTimeLocal: null, plannedDurationSec: 3600, plannedDistanceKm: 10 };
    const fpBase = buildDomCompatibleFingerprint(base);
    assert.notEqual(buildDomCompatibleFingerprint({ ...base, plannedDurationSec: 3601 }), fpBase);
    assert.notEqual(buildDomCompatibleFingerprint({ ...base, plannedDistanceKm: 10.1 }), fpBase);
    assert.notEqual(buildDomCompatibleFingerprint({ ...base, title: "Short run" }), fpBase);
  });
});

describe("matchMoveWorkoutCandidate -- happy paths", () => {
  test("single live candidate, byte-exact fingerprint -> fingerprint_exact", () => {
    const dom = domCandidate();
    const live = [liveWorkout()];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "fingerprint_exact");
    assert.equal(result.resolvedWorkoutId, 1001);
    assert.equal(result.abstainReason, null);
  });

  test("single live candidate on the day, no other candidates -> resolves via fields_unique even with formatting differences", () => {
    // DOM title truncated by card-text slicing; API has the full title. Duration/distance both agree within tolerance.
    const dom = domCandidate({ title: "Long run to the", fingerprint: "deliberately-wrong-so-it-cannot-match-exactly" });
    const live = [liveWorkout({ title: "Long run to the reservoir and back" })];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "fields_unique");
    assert.equal(result.resolvedWorkoutId, 1001);
  });

  test("API vs DOM formatting differences (units, rounding) do not break resolution -- fingerprint mismatch is a diagnostic, not a failure", () => {
    const dom = domCandidate({
      // DOM scraped "60 min" as 3600s and "10 km"; live API returns 1.0 hours and 10000 m -- fingerprint bytes differ
      // because live's recomputed distance is toFixed(3) = "10" vs dom's raw "10" -- force an actual formatting skew:
      plannedDurationSec: 3597, // DOM's rounded-from-text value, 3s off from live's exact 3600
      fingerprint: "will-not-match-because-duration-differs-by-a-few-seconds",
    });
    const live = [liveWorkout()];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "fields_unique", "tolerance absorbs the 3-second skew, resolves via fields instead of fingerprint");
    assert.equal(result.resolvedWorkoutId, 1001);
    assert.equal(result.evaluations[0].fingerprintMatches, false, "fingerprint genuinely does not byte-match");
  });
});

describe("matchMoveWorkoutCandidate -- multi-workout-same-day disambiguation", () => {
  test("two workouts on the same day, only one plausibly matches -> fields_unique picks the right one", () => {
    const dom = domCandidate({ title: "Long run", type: "run", plannedDurationSec: 3600, plannedDistanceKm: 10, fingerprint: "irrelevant" });
    const live = [
      liveWorkout({ workoutId: 2001, title: "Long run", workoutTypeValueId: 3, totalTimePlannedHours: 1, distancePlannedMeters: 10000 }),
      // workoutTypeValueId is unconfirmed for swim (only 3=run, 9=strength are confirmed, see
      // workout-activity-classification.ts) -- the "swim" title keyword is what actually classifies this one.
      liveWorkout({ workoutId: 2002, title: "Easy swim", workoutTypeValueId: null, totalTimePlannedHours: 0.5, distancePlannedMeters: 1500 }),
    ];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "fields_unique");
    assert.equal(result.resolvedWorkoutId, 2001);
    assert.equal(result.candidatesOnDate, 2);
  });

  test("two workouts on the same day, BOTH plausible -> ambiguous, abstains rather than guessing", () => {
    // Same type+duration, only title differs slightly and title is sparse enough not to contradict either.
    const dom = domCandidate({ title: null, type: "run", plannedDurationSec: 3600, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = [
      liveWorkout({ workoutId: 3001, title: "Morning run", workoutTypeValueId: 3, totalTimePlannedHours: 1, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 3002, title: "Evening run", workoutTypeValueId: 3, totalTimePlannedHours: 1, distancePlannedMeters: null }),
    ];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "ambiguous");
    assert.equal(result.resolvedWorkoutId, null);
    assert.match(result.abstainReason ?? "", /plausible matches/);
  });

  test("a contradicting field disqualifies a candidate even if others agree", () => {
    const dom = domCandidate({ title: "Long run", type: "run", plannedDurationSec: 3600, plannedDistanceKm: 10, fingerprint: "irrelevant" });
    const live = [
      // Duration+distance agree, but title/type both flatly contradict (a pool
      // swim, not a run) -- must be disqualified outright, not down-weighted.
      liveWorkout({ workoutId: 4001, title: "Pool swim session", workoutTypeValueId: null, totalTimePlannedHours: 1, distancePlannedMeters: 10000 }),
    ];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "not_found");
    assert.equal(result.resolvedWorkoutId, null);
    assert.equal(result.evaluations[0].contradictionCount > 0, true);
  });
});

describe("matchMoveWorkoutCandidate -- abstention is explicit, never a guess", () => {
  test("zero workouts on the date -> not_found, not a crash", () => {
    const result = matchMoveWorkoutCandidate(domCandidate(), STUDENT_ID, DATE, []);
    assert.equal(result.matchKind, "not_found");
    assert.equal(result.resolvedWorkoutId, null);
    assert.equal(result.candidatesOnDate, 0);
    assert.ok(result.abstainReason);
  });

  test("sparse DOM candidate (title/type both null) with a live candidate that has nothing to agree on -> not_found, never a blind pick", () => {
    const dom = domCandidate({ title: null, type: null, plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = [liveWorkout({ title: null, workoutTypeValueId: null, totalTimePlannedHours: null, distancePlannedMeters: null })];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "not_found");
    assert.equal(result.resolvedWorkoutId, null);
  });

  test("three-way tie of plausible candidates still abstains, does not pick the first one", () => {
    const dom = domCandidate({ title: null, type: "bike", plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = [
      // workoutTypeValueId is unconfirmed for bike -- the "bike" title keyword is what classifies these.
      liveWorkout({ workoutId: 5001, title: "Bike ride A", workoutTypeValueId: null, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 5002, title: "Bike ride B", workoutTypeValueId: null, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 5003, title: "Bike ride C", workoutTypeValueId: null, totalTimePlannedHours: null, distancePlannedMeters: null }),
    ];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "ambiguous");
    assert.equal(result.resolvedWorkoutId, null);
  });

  test("never throws on malformed/sparse input", () => {
    assert.doesNotThrow(() => matchMoveWorkoutCandidate(domCandidate({ title: "", type: "" }), null, DATE, [liveWorkout({ title: "" })]));
  });
});

describe("evaluateMoveWorkoutCandidate -- per-field diagnostics", () => {
  test("records agree/contradict/not_comparable per field, not just a pass/fail verdict", () => {
    const dom = domCandidate({ title: "Long run", type: "run", plannedDurationSec: 3600, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = liveWorkout({ title: "Long run", workoutTypeValueId: 3, totalTimePlannedHours: 1, distancePlannedMeters: null });
    const evaluation = evaluateMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    const byField = Object.fromEntries(evaluation.comparisons.map((c) => [c.field, c.verdict]));
    assert.equal(byField.type, "agree");
    assert.equal(byField.title, "agree");
    assert.equal(byField.duration, "agree");
    assert.equal(byField.distance, "not_comparable", "both sides null -- must not count as agreement OR contradiction");
  });

  test("title tolerates DOM truncation (dom title is a prefix of the full live title)", () => {
    const dom = domCandidate({ title: "Interval sess", type: null, plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = liveWorkout({ title: "Interval session with hill repeats", workoutTypeValueId: null, totalTimePlannedHours: null, distancePlannedMeters: null });
    const evaluation = evaluateMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    const titleComparison = evaluation.comparisons.find((c) => c.field === "title");
    assert.equal(titleComparison?.verdict, "agree");
  });

  test("duration tolerance absorbs a few seconds of DOM text-scrape rounding but not a genuinely different duration", () => {
    const dom = domCandidate({ title: null, type: null, plannedDurationSec: 3600, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const closeLive = liveWorkout({ title: null, workoutTypeValueId: null, totalTimePlannedHours: 3603 / 3600, distancePlannedMeters: null });
    const farLive = liveWorkout({ title: null, workoutTypeValueId: null, totalTimePlannedHours: 2, distancePlannedMeters: null });
    assert.equal(evaluateMoveWorkoutCandidate(dom, STUDENT_ID, DATE, closeLive).comparisons.find((c) => c.field === "duration")?.verdict, "agree");
    assert.equal(evaluateMoveWorkoutCandidate(dom, STUDENT_ID, DATE, farLive).comparisons.find((c) => c.field === "duration")?.verdict, "contradict");
  });

  // Regression: caught live against real data on athlete 3102415 -- a generic
  // "Running" candidate on a 4-workout day was falsely matching every
  // "Running"-titled live workout because the original compareTitles() used
  // BIDIRECTIONAL substring containment. A more specific dom title being a
  // superstring of a generic live title is evidence of a DIFFERENT workout,
  // not DOM truncation -- truncation only ever makes the DOM title SHORTER
  // than the true (live) title, never longer/more specific.
  test("a MORE SPECIFIC dom title does not falsely agree with a generic live title it happens to contain (real bug, live-data regression)", () => {
    const dom = domCandidate({ title: "Treadmill Running", type: "run", plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const genericLive = liveWorkout({ title: "Running", workoutTypeValueId: 3 });
    const comparison = evaluateMoveWorkoutCandidate(dom, STUDENT_ID, DATE, genericLive).comparisons.find((c) => c.field === "title");
    assert.equal(comparison?.verdict, "contradict");
  });

  test("a truncated dom title (genuine prefix of the fuller live title) still agrees", () => {
    const dom = domCandidate({ title: "Running", type: "run", plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const fullerLive = liveWorkout({ title: "Running intervals with strides", workoutTypeValueId: 3 });
    const comparison = evaluateMoveWorkoutCandidate(dom, STUDENT_ID, DATE, fullerLive).comparisons.find((c) => c.field === "title");
    assert.equal(comparison?.verdict, "agree");
  });

  test("on a real 4-workout-same-day shape (3x generic 'Running' + 1x distinct 'Treadmill Running'), a distinctly-titled dom candidate uniquely resolves", () => {
    const dom = domCandidate({ title: "Treadmill Running", type: "run", plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = [
      liveWorkout({ workoutId: 6001, title: "Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 6002, title: "Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 6003, title: "Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 6004, title: "Treadmill Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
    ];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "fields_unique");
    assert.equal(result.resolvedWorkoutId, 6004);
  });

  test("a GENERIC dom candidate on that same 4-workout shape correctly abstains -- title alone can't disambiguate 3 identical titles", () => {
    const dom = domCandidate({ title: "Running", type: "run", plannedDurationSec: null, plannedDistanceKm: null, fingerprint: "irrelevant" });
    const live = [
      liveWorkout({ workoutId: 6001, title: "Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 6002, title: "Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 6003, title: "Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
      liveWorkout({ workoutId: 6004, title: "Treadmill Running", workoutTypeValueId: 3, totalTimePlannedHours: null, distancePlannedMeters: null }),
    ];
    const result = matchMoveWorkoutCandidate(dom, STUDENT_ID, DATE, live);
    assert.equal(result.matchKind, "ambiguous");
    assert.equal(result.resolvedWorkoutId, null);
  });
});
