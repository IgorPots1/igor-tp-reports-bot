import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { computeMoveShadowReport, type MoveShadowComparisonRow } from "./move-shadow-report.ts";

// Run: node --experimental-strip-types --test src/features/trainingpeaks/move-shadow-report.test.ts

let counter = 0;
function row(overrides: Partial<MoveShadowComparisonRow> = {}): MoveShadowComparisonRow {
  counter += 1;
  return {
    id: `row-${counter}`,
    actionId: `action-${counter}`,
    athleteId: 3102415,
    studentId: "student-1",
    sourceDate: "2026-01-01",
    targetDate: "2026-01-02",
    domWorkoutId: 1000 + counter,
    resolvedWorkoutId: 1000 + counter,
    matchKind: "exact_id",
    resolverMatchKind: "fingerprint_exact",
    candidatesOnDate: 1,
    domFingerprint: "fp",
    recomputedFingerprint: "fp",
    fingerprintMatch: true,
    sourcePolicy: "explicit_source_date",
    sourceKind: "date",
    origin: "live",
    diagnostics: {},
    cacheCrossCheck: {},
    createdAt: `2026-01-0${(counter % 9) + 1}T00:00:00Z`,
    ...overrides,
  };
}

describe("computeMoveShadowReport -- empty input", () => {
  test("zero rows -> not ready, explicit blocker, never throws", () => {
    const report = computeMoveShadowReport([]);
    assert.equal(report.totalComparisons, 0);
    assert.equal(report.switchCriterion.overallReady, false);
    assert.ok(report.switchCriterion.blockers.length > 0);
  });
});

describe("computeMoveShadowReport -- basic aggregates", () => {
  test("counts by match kind, computes match/abstention rates", () => {
    const rows = [
      row({ matchKind: "exact_id" }),
      row({ matchKind: "exact_id" }),
      row({ matchKind: "abstained_not_found", resolvedWorkoutId: null, resolverMatchKind: "not_found" }),
      row({ matchKind: "abstained_ambiguous", resolvedWorkoutId: null, resolverMatchKind: "ambiguous" }),
    ];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.totalComparisons, 4);
    assert.equal(report.byMatchKind.exact_id, 2);
    assert.equal(report.matchRate, 0.5);
    assert.equal(report.abstentionRate, 0.5);
  });

  test("idMismatches and abstentions are returned in full, not just counted", () => {
    const mismatch = row({ matchKind: "id_mismatch", resolvedWorkoutId: 9999 });
    const abstention = row({ matchKind: "abstained_ambiguous", resolvedWorkoutId: null });
    const report = computeMoveShadowReport([mismatch, abstention, row()]);
    assert.equal(report.idMismatches.length, 1);
    assert.equal(report.idMismatches[0].id, mismatch.id);
    assert.equal(report.abstentions.length, 1);
    assert.equal(report.abstentions[0].id, abstention.id);
  });
});

describe("computeMoveShadowReport -- switch criterion: volume/duration", () => {
  test("below minimum volume -> volumeMet false, blocker names the shortfall", () => {
    const rows = Array.from({ length: 5 }, () => row());
    const report = computeMoveShadowReport(rows);
    assert.equal(report.switchCriterion.volumeMet, false);
    assert.match(report.switchCriterion.blockers.join(" "), /Volume: 5\/30/);
  });

  test("duration measured across the actual createdAt span, not row count", () => {
    const rows = [
      row({ createdAt: "2026-01-01T00:00:00Z" }),
      row({ createdAt: "2026-01-05T00:00:00Z" }),
    ];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.daysSpanned, 4);
    assert.equal(report.switchCriterion.durationMet, false); // needs >= 21 days
  });
});

describe("computeMoveShadowReport -- zero-mismatch is absolute", () => {
  test("a single id_mismatch anywhere in history fails zeroMismatchMet, even with 1000 clean rows around it", () => {
    const rows = [...Array.from({ length: 50 }, () => row()), row({ matchKind: "id_mismatch", resolvedWorkoutId: 424242 })];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.switchCriterion.zeroMismatchMet, false);
    assert.match(report.switchCriterion.blockers.join(" "), /ZERO-MISMATCH VIOLATED/);
  });

  test("clean streak resets to the most recent mismatch's timestamp, not the first ever", () => {
    const rows = [
      row({ createdAt: "2026-01-01T00:00:00Z", matchKind: "id_mismatch", resolvedWorkoutId: 1 }),
      row({ createdAt: "2026-01-10T00:00:00Z", matchKind: "id_mismatch", resolvedWorkoutId: 2 }),
      row({ createdAt: "2026-01-20T00:00:00Z" }),
    ];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.cleanStreakSince, "2026-01-10T00:00:00Z"); // the LATER mismatch, not the first
    assert.equal(report.daysSinceLastMismatch, 10);
  });

  test("no mismatches ever -> clean streak dates back to the earliest comparison", () => {
    const rows = [row({ createdAt: "2026-01-01T00:00:00Z" }), row({ createdAt: "2026-01-15T00:00:00Z" })];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.cleanStreakSince, "2026-01-01T00:00:00Z");
    assert.equal(report.daysSinceLastMismatch, 14);
  });
});

describe("computeMoveShadowReport -- abstention rate", () => {
  test("exactly at the boundary (10%) does NOT satisfy a strict less-than threshold", () => {
    const rows = [...Array.from({ length: 9 }, () => row()), row({ matchKind: "abstained_not_found", resolvedWorkoutId: null })];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.abstentionRate, 0.1);
    assert.equal(report.switchCriterion.abstentionRateMet, false);
  });

  test("below the boundary satisfies it", () => {
    const rows = [...Array.from({ length: 20 }, () => row()), row({ matchKind: "abstained_not_found", resolvedWorkoutId: null })];
    const report = computeMoveShadowReport(rows);
    assert.ok(report.abstentionRate < 0.1);
    assert.equal(report.switchCriterion.abstentionRateMet, true);
  });
});

describe("computeMoveShadowReport -- diversity gate (per-bucket clean match)", () => {
  test("no hard-bucket variety at all -> diversity not met, explicit blocker", () => {
    // every row has candidatesOnDate=1 and the same sourceKind/sourcePolicy as the default fixture
    // -- still forms ONE bucket each for sourceKind/sourcePolicy, so this actually tests the "has data but not clean" path via a mismatch-only bucket:
    const rows = Array.from({ length: 5 }, () => row({ matchKind: "abstained_not_found", resolvedWorkoutId: null }));
    const report = computeMoveShadowReport(rows);
    assert.equal(report.switchCriterion.diversityMet, false);
  });

  test("multi-workout-day bucket needs its OWN clean match -- a clean match on a single-candidate day doesn't count for it", () => {
    const rows = [
      row({ candidatesOnDate: 1, matchKind: "exact_id" }), // clean, but NOT a multi-workout-day case
      row({ candidatesOnDate: 3, matchKind: "abstained_ambiguous", resolvedWorkoutId: null }), // multi-workout-day, but abstained
    ];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.multiWorkoutDayBucket.total, 1);
    assert.equal(report.multiWorkoutDayBucket.hasCleanMatch, false);
    assert.equal(report.switchCriterion.diversityMet, false);
    assert.match(report.switchCriterion.blockers.join(" "), /multi_workout_day/);
  });

  test("once every observed bucket has at least one exact_id, diversity is met", () => {
    const rows = [
      row({ candidatesOnDate: 3, matchKind: "exact_id", sourceKind: "date", sourcePolicy: "explicit_source_date" }),
      row({ candidatesOnDate: 1, matchKind: "exact_id", sourceKind: "weekday", sourcePolicy: "explicit_source_date" }),
      row({ candidatesOnDate: 1, matchKind: "exact_id", sourceKind: "relative_day", sourcePolicy: "coach_confirmed_source_date" }),
    ];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.switchCriterion.diversityMet, true);
  });

  test("a bucket that appears only in resolver_error rows is NOT considered clean", () => {
    const rows = [
      row({ sourceKind: "weekday", matchKind: "resolver_error", resolvedWorkoutId: null, resolverMatchKind: null }),
      row({ sourceKind: "date", matchKind: "exact_id" }),
    ];
    const report = computeMoveShadowReport(rows);
    const weekdayBucket = report.bySourceKind.find((b) => b.key === "source_kind=weekday");
    assert.equal(weekdayBucket?.hasCleanMatch, false);
    assert.equal(report.switchCriterion.diversityMet, false);
  });
});

describe("computeMoveShadowReport -- overallReady requires ALL gates simultaneously", () => {
  test("a report satisfying every threshold is ready", () => {
    const baseDate = new Date("2026-01-01T00:00:00Z");
    const rows = Array.from({ length: 32 }, (_, i) => {
      const createdAt = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000).toISOString();
      // sprinkle in one multi-workout-day clean match and vary source kinds for the diversity gate
      if (i === 0) return row({ createdAt, candidatesOnDate: 4, matchKind: "exact_id", sourceKind: "date", sourcePolicy: "explicit_source_date" });
      if (i === 1) return row({ createdAt, candidatesOnDate: 1, matchKind: "exact_id", sourceKind: "weekday", sourcePolicy: "explicit_source_date" });
      return row({ createdAt, candidatesOnDate: 1, matchKind: "exact_id", sourceKind: "date", sourcePolicy: "explicit_source_date" });
    });
    const report = computeMoveShadowReport(rows);
    assert.equal(report.switchCriterion.overallReady, true);
    assert.deepEqual(report.switchCriterion.blockers, []);
  });

  test("ready on every OTHER axis but with one mismatch is still not ready", () => {
    const baseDate = new Date("2026-01-01T00:00:00Z");
    const rows = Array.from({ length: 32 }, (_, i) => {
      const createdAt = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000).toISOString();
      if (i === 0) return row({ createdAt, candidatesOnDate: 4, matchKind: "id_mismatch", resolvedWorkoutId: 555, sourceKind: "date" });
      return row({ createdAt, candidatesOnDate: 1, matchKind: "exact_id", sourceKind: "date" });
    });
    const report = computeMoveShadowReport(rows);
    assert.equal(report.switchCriterion.overallReady, false);
    assert.equal(report.switchCriterion.zeroMismatchMet, false);
  });
});

describe("computeMoveShadowReport -- cache cross-check aggregation", () => {
  test("computes agreement rate only from rows that carry a usable cacheAgreesWithDomGroundTruth flag", () => {
    const rows = [
      row({ cacheCrossCheck: { cacheAgreesWithDomGroundTruth: true } }),
      row({ cacheCrossCheck: { cacheAgreesWithDomGroundTruth: true } }),
      row({ cacheCrossCheck: { cacheAgreesWithDomGroundTruth: false } }),
      row({ cacheCrossCheck: { skipped: "no studentId resolved" } }), // no usable flag -- excluded, not counted as disagreement
    ];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.cacheAgreementRate, 2 / 3);
  });

  test("no usable cross-check data anywhere -> null, not zero", () => {
    const rows = [row({ cacheCrossCheck: {} }), row({ cacheCrossCheck: { error: "boom" } })];
    const report = computeMoveShadowReport(rows);
    assert.equal(report.cacheAgreementRate, null);
  });
});
