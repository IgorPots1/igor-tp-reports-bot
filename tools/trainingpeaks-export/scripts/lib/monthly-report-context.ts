// Pure aggregation for the monthly student report. Takes the rows already read
// from Supabase (workout cache + FIT derived metrics + a pre-built recovery
// summary) and folds them into ONE MonthlyReportContext object — the structured
// input the report-writing step (Claude) reasons over. No I/O, no network: this
// is deterministic and unit-tested by check-monthly-report-context.ts so the
// numbers can never drift from the coach-tuned normalization in
// athlete-training-baseline-v2.ts, whose row extractors it reuses directly.

import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";
import {
  completedDistanceKmForRow,
  distanceKmForRow,
  durationMinutesForRow,
} from "./athlete-training-baseline-v2.ts";

// FIT derived-metrics subset the monthly rollup needs (camelCase mapped row).
export type MonthlyDerivedRow = {
  workoutCacheId: string;
  workoutDate: string;
  workoutType: string | null;
  hasFit: boolean;
  hrQuality: "good" | "degraded" | "unreliable" | null;
  hrTrusted: boolean | null;
  pctTimeHrTarget: number | null;
  pctTimePaceTarget: number | null;
  repsDetectedCount: number | null;
  repPaceFadePct: number | null;
  repPaceCv: number | null;
  hrDecouplingPct: number | null;
  decouplingValid: boolean;
  aerobicEf: number | null;
};

// Recovery is summarized upstream by buildTrainingPeaksRecoverySummary (the
// coach-tuned lib) so this module never reimplements sleep/HRV/pulse logic.
export type MonthlyRecoveryInput = {
  status: string;
  avgSleepHours: number | null;
  nightsSleepLt7h: number;
  avgRestingPulse: number | null;
  avgHrv: number | null;
  avgBodyBattery: number | null;
  coverageDays: { sleep: number; pulse: number; hrv: number };
} | null;

// Prior-month aggregates for month-over-month deltas (null on the first month).
export type MonthlyTrendBaseline = {
  totalDistanceKm: number | null;
  tssActualSum: number | null;
  completionRatePct: number | null;
  avgRestingPulse: number | null;
  avgHrDecouplingPct: number | null;
} | null;

export type MonthlyReportContext = {
  student: { studentId: string; studentName: string };
  period: { from: string; to: string; label: string };
  volume: {
    plannedSessions: number;
    completedSessions: number;
    totalDistanceKm: number | null;
    totalMovingMinutes: number | null;
    longestRunKm: number | null;
    bySport: Array<{ sport: string; sessions: number; distanceKm: number | null; minutes: number | null }>;
  };
  load: {
    tssActualSum: number | null;
    tssPlannedSum: number | null;
    ifAvg: number | null;
    weeks: Array<{ weekFrom: string; sessions: number; distanceKm: number | null; tssActual: number | null }>;
  };
  compliance: {
    plannedSessions: number;
    completedPlannedSessions: number;
    missedSessions: number;
    completionRatePct: number | null;
    durationCompliancePctAvg: number | null;
    distanceCompliancePctAvg: number | null;
  };
  keySessions: Array<{
    date: string;
    title: string | null;
    sport: string | null;
    distanceKm: number | null;
    tss: number | null;
    if: number | null;
  }>;
  deepFit: {
    runsWithFit: number;
    avgHrDecouplingPct: number | null;
    aerobicEfAvg: number | null;
    aerobicEfDeltaPct: number | null;
    intervalSessions: number;
    avgRepPaceFadePct: number | null;
    avgRepPaceCv: number | null;
    hrTargetAdherencePctAvg: number | null;
    hrQuality: { good: number; degraded: number; unreliable: number };
  };
  recovery: MonthlyRecoveryInput;
  trend: {
    distanceKmDeltaPct: number | null;
    tssActualDeltaPct: number | null;
    completionRateDeltaPct: number | null;
    restingPulseDelta: number | null;
    hrDecouplingDeltaPct: number | null;
  } | null;
  dataGaps: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value: number | null, digits = 1): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function avg(values: number[], digits = 1): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((acc, v) => acc + v, 0) / values.length, digits);
}

function sum(values: number[], digits = 1): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((acc, v) => acc + v, 0), digits);
}

function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

function snapshotNumber(row: TrainingPeaksWorkoutCacheRow, key: string): number | null {
  const snapshot = isRecord(row.sourceSnapshot) ? row.sourceSnapshot : null;
  return snapshot ? toFiniteNumber(snapshot[key]) : null;
}

function weekStartIso(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + mondayOffset);
  return monday.toISOString().slice(0, 10);
}

function normalizeSport(row: TrainingPeaksWorkoutCacheRow): string {
  const code = (row.sportOrTypeCode ?? "").trim();
  return code || "other";
}

export function buildMonthlyReportContext(input: {
  studentId: string;
  studentName: string;
  from: string;
  to: string;
  label: string;
  cacheRows: TrainingPeaksWorkoutCacheRow[];
  derivedRows: MonthlyDerivedRow[];
  recovery: MonthlyRecoveryInput;
  previous: MonthlyTrendBaseline;
}): MonthlyReportContext {
  const planned = input.cacheRows.filter((r) => r.isPlanned);
  const completed = input.cacheRows.filter((r) => r.isCompleted);
  const completedPlanned = input.cacheRows.filter((r) => r.isPlanned && r.isCompleted);

  // --- volume ---
  const completedDistances = completed
    .map((r) => completedDistanceKmForRow(r))
    .filter((v): v is number => v !== null);
  const completedMinutes = completed
    .map((r) => durationMinutesForRow(r, "completed"))
    .filter((v): v is number => v !== null);
  const runDistances = completed
    .filter((r) => /run|бег/i.test(normalizeSport(r)) || /run|бег/i.test(r.title ?? ""))
    .map((r) => completedDistanceKmForRow(r))
    .filter((v): v is number => v !== null);

  const bySportMap = new Map<string, { sessions: number; distances: number[]; minutes: number[] }>();
  for (const r of completed) {
    const sport = normalizeSport(r);
    const entry = bySportMap.get(sport) ?? { sessions: 0, distances: [], minutes: [] };
    entry.sessions += 1;
    const d = completedDistanceKmForRow(r);
    if (d !== null) entry.distances.push(d);
    const m = durationMinutesForRow(r, "completed");
    if (m !== null) entry.minutes.push(m);
    bySportMap.set(sport, entry);
  }
  const bySport = [...bySportMap.entries()]
    .map(([sport, e]) => ({
      sport,
      sessions: e.sessions,
      distanceKm: sum(e.distances, 1),
      minutes: sum(e.minutes, 0),
    }))
    .sort((a, b) => (b.distanceKm ?? 0) - (a.distanceKm ?? 0));

  // --- load (TSS / IF from cache snapshot) ---
  const tssActuals = completed.map((r) => snapshotNumber(r, "tssActual")).filter((v): v is number => v !== null);
  const tssPlanned = planned.map((r) => snapshotNumber(r, "tssPlanned")).filter((v): v is number => v !== null);
  const ifActuals = completed.map((r) => snapshotNumber(r, "ifActual")).filter((v): v is number => v !== null);

  const weekMap = new Map<string, { sessions: number; distances: number[]; tss: number[] }>();
  for (const r of completed) {
    const wk = weekStartIso(r.workoutDate);
    const entry = weekMap.get(wk) ?? { sessions: 0, distances: [], tss: [] };
    entry.sessions += 1;
    const d = completedDistanceKmForRow(r);
    if (d !== null) entry.distances.push(d);
    const t = snapshotNumber(r, "tssActual");
    if (t !== null) entry.tss.push(t);
    weekMap.set(wk, entry);
  }
  const weeks = [...weekMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekFrom, e]) => ({
      weekFrom,
      sessions: e.sessions,
      distanceKm: sum(e.distances, 1),
      tssActual: sum(e.tss, 0),
    }));

  // --- compliance ---
  const durationCompliance = completedPlanned
    .map((r) => toFiniteNumber(r.complianceDurationPercent))
    .filter((v): v is number => v !== null);
  const distanceCompliance = completedPlanned
    .map((r) => toFiniteNumber(r.complianceDistancePercent))
    .filter((v): v is number => v !== null);
  const completionRatePct = planned.length > 0 ? round((completedPlanned.length / planned.length) * 100, 0) : null;

  // --- key sessions (top 3 by TSS, fallback distance) ---
  const keySessions = completed
    .map((r) => ({
      date: r.workoutDate,
      title: r.title,
      sport: r.sportOrTypeCode,
      distanceKm: completedDistanceKmForRow(r),
      tss: snapshotNumber(r, "tssActual"),
      if: snapshotNumber(r, "ifActual"),
    }))
    .sort((a, b) => (b.tss ?? b.distanceKm ?? 0) - (a.tss ?? a.distanceKm ?? 0))
    .slice(0, 3);

  // --- deep FIT rollup ---
  const withFit = input.derivedRows.filter((d) => d.hasFit);
  const decouplings = input.derivedRows
    .filter((d) => d.decouplingValid && d.hrDecouplingPct !== null)
    .map((d) => d.hrDecouplingPct as number);
  const efRows = input.derivedRows
    .filter((d) => d.aerobicEf !== null)
    .sort((a, b) => a.workoutDate.localeCompare(b.workoutDate));
  const efValues = efRows.map((d) => d.aerobicEf as number);
  const efDeltaPct =
    efValues.length >= 2 ? deltaPct(efValues[efValues.length - 1]!, efValues[0]!) : null;
  const intervalRows = input.derivedRows.filter((d) => (d.repsDetectedCount ?? 0) > 0);
  const repFades = intervalRows.map((d) => d.repPaceFadePct).filter((v): v is number => v !== null);
  const repCvs = intervalRows.map((d) => d.repPaceCv).filter((v): v is number => v !== null);
  const hrTargets = input.derivedRows.map((d) => d.pctTimeHrTarget).filter((v): v is number => v !== null);
  const hrQuality = { good: 0, degraded: 0, unreliable: 0 };
  for (const d of input.derivedRows) {
    if (d.hrQuality === "good") hrQuality.good += 1;
    else if (d.hrQuality === "degraded") hrQuality.degraded += 1;
    else if (d.hrQuality === "unreliable") hrQuality.unreliable += 1;
  }

  const avgHrDecoupling = avg(decouplings, 1);
  const totalDistanceKm = sum(completedDistances, 1);
  const tssActualSum = sum(tssActuals, 0);

  // --- data gaps ---
  const dataGaps: string[] = [];
  if (completed.length === 0) dataGaps.push("no_completed_workouts");
  if (tssActuals.length === 0) dataGaps.push("no_tss_data");
  if (withFit.length === 0) dataGaps.push("no_fit_derived_metrics");
  if (input.recovery === null) dataGaps.push("no_recovery_data");

  // --- trend vs previous month ---
  const trend = input.previous
    ? {
        distanceKmDeltaPct: deltaPct(totalDistanceKm, input.previous.totalDistanceKm),
        tssActualDeltaPct: deltaPct(tssActualSum, input.previous.tssActualSum),
        completionRateDeltaPct: deltaPct(completionRatePct, input.previous.completionRatePct),
        restingPulseDelta:
          input.recovery?.avgRestingPulse != null && input.previous.avgRestingPulse != null
            ? round(input.recovery.avgRestingPulse - input.previous.avgRestingPulse, 1)
            : null,
        hrDecouplingDeltaPct: deltaPct(avgHrDecoupling, input.previous.avgHrDecouplingPct),
      }
    : null;

  return {
    student: { studentId: input.studentId, studentName: input.studentName },
    period: { from: input.from, to: input.to, label: input.label },
    volume: {
      plannedSessions: planned.length,
      completedSessions: completed.length,
      totalDistanceKm,
      totalMovingMinutes: sum(completedMinutes, 0),
      longestRunKm: runDistances.length > 0 ? round(Math.max(...runDistances), 1) : null,
      bySport,
    },
    load: {
      tssActualSum,
      tssPlannedSum: sum(tssPlanned, 0),
      ifAvg: avg(ifActuals, 2),
      weeks,
    },
    compliance: {
      plannedSessions: planned.length,
      completedPlannedSessions: completedPlanned.length,
      missedSessions: Math.max(0, planned.length - completedPlanned.length),
      completionRatePct,
      durationCompliancePctAvg: avg(durationCompliance, 0),
      distanceCompliancePctAvg: avg(distanceCompliance, 0),
    },
    keySessions,
    deepFit: {
      runsWithFit: withFit.length,
      avgHrDecouplingPct: avgHrDecoupling,
      aerobicEfAvg: avg(efValues, 3),
      aerobicEfDeltaPct: efDeltaPct,
      intervalSessions: intervalRows.length,
      avgRepPaceFadePct: avg(repFades, 1),
      avgRepPaceCv: avg(repCvs, 2),
      hrTargetAdherencePctAvg: avg(hrTargets, 0),
      hrQuality,
    },
    recovery: input.recovery,
    trend,
    dataGaps,
  };
}
