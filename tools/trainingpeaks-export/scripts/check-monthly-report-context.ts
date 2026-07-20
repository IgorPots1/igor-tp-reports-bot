// Fixture check for buildMonthlyReportContext — verifies the pure monthly
// aggregation (volume / load / compliance / deep-FIT rollup / trend) against
// hand-computed expectations. Run: npm run check:monthly-report-context
import type { TrainingPeaksWorkoutCacheRow } from "../../../src/features/trainingpeaks/repository.ts";
import {
  buildMonthlyReportContext,
  type MonthlyDerivedRow,
} from "./lib/monthly-report-context.ts";

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}
function assertEq(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function cacheRow(overrides: Partial<TrainingPeaksWorkoutCacheRow>): TrainingPeaksWorkoutCacheRow {
  return {
    id: "row",
    studentId: "s1",
    studentName: "Test",
    trainingPeaksAthleteId: 1,
    trainingPeaksWorkoutId: 1,
    workoutDate: "2026-06-01",
    title: "Run",
    sportOrTypeCode: "Run",
    workoutTypeValueId: null,
    workoutSubTypeId: null,
    isPlanned: true,
    isCompleted: true,
    plannedTimeRaw: null,
    completedTimeRaw: null,
    plannedDistanceRaw: null,
    completedDistanceRaw: null,
    complianceDurationPercent: null,
    complianceDistancePercent: null,
    startTimePlanned: null,
    startTime: null,
    sourceUpdatedAt: null,
    orderOnDay: null,
    scannedAt: "2026-06-01T00:00:00Z",
    scanJobId: null,
    normalizationWarnings: [],
    sourceSnapshot: {},
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

const cacheRows: TrainingPeaksWorkoutCacheRow[] = [
  cacheRow({
    id: "w1", trainingPeaksWorkoutId: 1, workoutDate: "2026-06-02",
    completedDistanceRaw: 10000, completedTimeRaw: 3600,
    complianceDurationPercent: 100, complianceDistancePercent: 100,
    sourceSnapshot: { tssActual: 70, ifActual: 0.85, tssPlanned: 70 },
  }),
  cacheRow({
    id: "w2", trainingPeaksWorkoutId: 2, workoutDate: "2026-06-10",
    completedDistanceRaw: 15000, completedTimeRaw: 5400,
    complianceDurationPercent: 95, complianceDistancePercent: 98,
    sourceSnapshot: { tssActual: 110, ifActual: 0.8, tssPlanned: 100 },
  }),
  cacheRow({
    id: "w3", trainingPeaksWorkoutId: 3, workoutDate: "2026-06-20",
    completedDistanceRaw: 8000, completedTimeRaw: 2700,
    complianceDurationPercent: 90, complianceDistancePercent: 92,
    sourceSnapshot: { tssActual: 55, ifActual: 0.9, tssPlanned: 60 },
  }),
  // planned but not completed -> a missed session
  cacheRow({
    id: "w4", trainingPeaksWorkoutId: 4, workoutDate: "2026-06-25",
    isPlanned: true, isCompleted: false,
    plannedDistanceRaw: 12000,
    sourceSnapshot: { tssPlanned: 90 },
  }),
];

const derivedRows: MonthlyDerivedRow[] = [
  {
    workoutCacheId: "w1", workoutDate: "2026-06-02", workoutType: "run", hasFit: true,
    hrQuality: "good", hrTrusted: true, pctTimeHrTarget: 90, pctTimePaceTarget: 80,
    repsDetectedCount: 0, repPaceFadePct: null, repPaceCv: null,
    hrDecouplingPct: 4, decouplingValid: true, aerobicEf: 1.9,
  },
  {
    workoutCacheId: "w2", workoutDate: "2026-06-10", workoutType: "run", hasFit: true,
    hrQuality: "good", hrTrusted: true, pctTimeHrTarget: 85, pctTimePaceTarget: 82,
    repsDetectedCount: 6, repPaceFadePct: 3, repPaceCv: 0.04,
    hrDecouplingPct: 6, decouplingValid: true, aerobicEf: 2.0,
  },
  {
    workoutCacheId: "w3", workoutDate: "2026-06-20", workoutType: "run", hasFit: true,
    hrQuality: "good", hrTrusted: true, pctTimeHrTarget: 95, pctTimePaceTarget: 88,
    repsDetectedCount: 0, repPaceFadePct: null, repPaceCv: null,
    hrDecouplingPct: 5, decouplingValid: true, aerobicEf: 2.1,
  },
];

const ctx = buildMonthlyReportContext({
  studentId: "s1", studentName: "Test",
  from: "2026-06-01", to: "2026-06-30", label: "Июнь 2026",
  cacheRows, derivedRows,
  recovery: {
    status: "ready", avgSleepHours: 7.2, nightsSleepLt7h: 3,
    avgRestingPulse: 52, avgHrv: 65, avgBodyBattery: 60,
    coverageDays: { sleep: 28, pulse: 20, hrv: 18 },
  },
  previous: {
    totalDistanceKm: 28, tssActualSum: 200, completionRatePct: 70,
    avgRestingPulse: 54, avgHrDecouplingPct: 6,
  },
});

console.log("volume/compliance:");
assertEq(ctx.volume.completedSessions, 3, "completedSessions");
assertEq(ctx.volume.plannedSessions, 4, "plannedSessions");
assertEq(ctx.volume.totalDistanceKm, 33, "totalDistanceKm");
assertEq(ctx.volume.longestRunKm, 15, "longestRunKm");
assertEq(ctx.compliance.completionRatePct, 75, "completionRatePct");
assertEq(ctx.compliance.missedSessions, 1, "missedSessions");

console.log("load:");
assertEq(ctx.load.tssActualSum, 235, "tssActualSum");
assertEq(ctx.load.weeks.length, 3, "distinct weeks");

console.log("deep FIT:");
assertEq(ctx.deepFit.runsWithFit, 3, "runsWithFit");
assertEq(ctx.deepFit.avgHrDecouplingPct, 5, "avgHrDecouplingPct");
assertEq(ctx.deepFit.aerobicEfDeltaPct, 10.5, "aerobicEfDeltaPct");
assertEq(ctx.deepFit.intervalSessions, 1, "intervalSessions");
assertEq(ctx.deepFit.hrTargetAdherencePctAvg, 90, "hrTargetAdherencePctAvg");

console.log("trend vs previous month:");
assertEq(ctx.trend?.tssActualDeltaPct, 17.5, "tssActualDeltaPct");
assertEq(ctx.trend?.restingPulseDelta, -2, "restingPulseDelta");
assertEq(ctx.trend?.hrDecouplingDeltaPct, -16.7, "hrDecouplingDeltaPct");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll monthly-report-context assertions passed.");
