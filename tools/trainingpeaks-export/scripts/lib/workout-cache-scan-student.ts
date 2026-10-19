// Per-student body of tp-workouts-cache-scan.ts, moved here VERBATIM (2026-10-19, наряд «силовые в
// кэш») so it can be unit-tested: the scan script runs main() on import and pulls repository.ts
// (supabase) into the graph, so nothing in it was importable from a check. This module imports only
// types from repository.ts — no supabase, no network of its own; every side effect is injected.
import type {
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheUpsertRow,
} from "../../../../src/features/trainingpeaks/repository.ts";
import type { ApiJsonResponse } from "./trainingpeaks-api-move.ts";
import {
  findOrderOnDayGaps,
  formatOrderOnDayGapWarning,
  normalizeTrainingPeaksWorkoutItems,
  type TrainingPeaksWorkoutRaw,
} from "./trainingpeaks-workout-normalization.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";

export type ResolvedTarget = {
  student: TrainingPeaksStudent;
  athleteId: number;
  athleteUrl: string;
};

export type StudentSummary = {
  studentId: string;
  athleteId: number | null;
  studentName: string;
  status: "ok" | "failed" | "skipped";
  rows: number;
  normalizedRows: number;
  planned: number;
  completed: number;
  plannedButNotCompleted: number;
  warnings: number;
  reason?: string;
  rawItemsReturned?: number;
  reconciledDeleted: number;
  /** Days with a hole in orderOnDay — possibly incomplete (see findOrderOnDayGaps). */
  incompleteDays?: string[];
};

export type ReconcilePlannedRowsFn = (input: {
  studentId: string;
  from: string;
  to: string;
  runStartedAt: string;
}) => Promise<number>;

function readPositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseOptionalIsoDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toCompactText(value: unknown, maxLength = 4000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function collectStructureSummaryMetrics(input: unknown): {
  nodeCount: number;
  stepCount: number;
  repetitionCount: number;
  targetMetrics: string[];
} {
  const targetMetrics = new Set<string>();
  let nodeCount = 0;
  let stepCount = 0;
  let repetitionCount = 0;

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 14 || nodeCount >= 400) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    nodeCount += 1;
    const typeValue = typeof value.type === "string" ? value.type.toLowerCase() : null;
    if (typeValue === "step") stepCount += 1;
    if (typeValue === "repetition") repetitionCount += 1;

    const maybeMetricKeys = ["metric", "targetType", "type", "field", "unit", "valueType", "name"];
    for (const key of maybeMetricKeys) {
      const rawMetric = value[key];
      if (typeof rawMetric === "string") {
        const normalized = rawMetric.trim().toLowerCase();
        if (normalized.length >= 2 && normalized.length <= 40) {
          targetMetrics.add(normalized);
        }
      }
    }

    for (const childValue of Object.values(value)) {
      if (Array.isArray(childValue) || isRecord(childValue)) {
        visit(childValue, depth + 1);
      }
    }
  };

  visit(input);
  return {
    nodeCount,
    stepCount,
    repetitionCount,
    targetMetrics: [...targetMetrics].sort().slice(0, 20),
  };
}

// Structure is stored verbatim up to this size so per-step target paces/zones
// survive intact; only pathologically large payloads fall back to a summary.
const STRUCTURE_INLINE_MAX_LENGTH = 100_000;

function buildCompactStructure(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const serialized = JSON.stringify(parsed);
      if (serialized.length <= STRUCTURE_INLINE_MAX_LENGTH) {
        return parsed;
      }
      const metrics = collectStructureSummaryMetrics(parsed);
      return {
        summaryOnly: true,
        serializedLength: serialized.length,
        ...metrics,
      };
    } catch {
      return {
        summaryOnly: true,
        parseableJson: false,
        rawLength: trimmed.length,
        preview: trimmed.slice(0, 320),
      };
    }
  }

  if (isRecord(value) || Array.isArray(value)) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length <= STRUCTURE_INLINE_MAX_LENGTH) {
        return value;
      }
      const metrics = collectStructureSummaryMetrics(value);
      return {
        summaryOnly: true,
        serializedLength: serialized.length,
        ...metrics,
      };
    } catch {
      const metrics = collectStructureSummaryMetrics(value);
      return {
        summaryOnly: true,
        serializationError: true,
        ...metrics,
      };
    }
  }

  return null;
}

function buildCompactSourceSnapshot(raw: TrainingPeaksWorkoutRaw): Record<string, unknown> {
  const structure = buildCompactStructure(raw.structure);
  return {
    rawTitle: raw.title ?? null,
    rawWorkoutDay: raw.workoutDay ?? null,
    rawCode: raw.code ?? null,
    rawWorkoutTypeValueId: raw.workoutTypeValueId ?? null,
    rawWorkoutSubTypeId: raw.workoutSubTypeId ?? null,
    rawTotalTimePlanned: raw.totalTimePlanned ?? null,
    rawTotalTime: raw.totalTime ?? null,
    rawDistancePlanned: raw.distancePlanned ?? null,
    rawDistance: raw.distance ?? null,
    rawComplianceDurationPercent: raw.complianceDurationPercent ?? null,
    rawComplianceDistancePercent: raw.complianceDistancePercent ?? null,
    rawCompleted: raw.completed ?? null,
    description: toCompactText(raw.description),
    coachComments: toCompactText(raw.coachComments),
    structure,
    tssActual: toFiniteNumber(raw.tssActual),
    tssPlanned: toFiniteNumber(raw.tssPlanned),
    ifActual: toFiniteNumber(raw.ifActual ?? raw.if),
    ifPlanned: toFiniteNumber(raw.ifPlanned),
    totalTimePlanned: toFiniteNumber(raw.totalTimePlanned),
    totalDistancePlanned: toFiniteNumber(raw.distancePlanned),
    workoutTypeValueId: readPositiveInt(raw.workoutTypeValueId),
    isHidden: typeof raw.isHidden === "boolean" ? raw.isHidden : null,
    heartRateAverage: toFiniteNumber(raw.heartRateAverage),
    heartRateMinimum: toFiniteNumber(raw.heartRateMinimum),
    heartRateMaximum: toFiniteNumber(raw.heartRateMaximum),
    velocityAverage: toFiniteNumber(raw.velocityAverage),
    cadenceAverage: toFiniteNumber(raw.cadenceAverage),
    cadenceMaximum: toFiniteNumber(raw.cadenceMaximum),
    powerAverage: toFiniteNumber(raw.powerAverage),
    powerMaximum: toFiniteNumber(raw.powerMaximum),
    normalizedSpeedActual: toFiniteNumber(raw.normalizedSpeedActual),
    normalizedPowerActual: toFiniteNumber(raw.normalizedPowerActual),
    torqueAverage: toFiniteNumber(raw.torqueAverage),
    torqueMaximum: toFiniteNumber(raw.torqueMaximum),
    elevationGain: toFiniteNumber(raw.elevationGain),
    elevationLoss: toFiniteNumber(raw.elevationLoss),
    calories: toFiniteNumber(raw.calories),
    rpe: toFiniteNumber(raw.rpe),
    feeling: toFiniteNumber(raw.feeling),
    complianceTssPercent: toFiniteNumber(raw.complianceTssPercent),
  };
}

export async function scanOneStudent(input: {
  upsertCacheFn: (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => Promise<void>;
  reconcileFn: ReconcilePlannedRowsFn;
  // Performs the GET with auth resilience (retry + token re-capture on 401/403).
  // Throws AuthDeadError if the session is dead; that escalates to a run abort.
  fetchFn: (endpoint: string) => Promise<ApiJsonResponse>;
  target: ResolvedTarget;
  from: string;
  to: string;
  scannedAt: string;
}): Promise<StudentSummary> {
  const { upsertCacheFn, reconcileFn, fetchFn, target, from, to, scannedAt } = input;
  const endpoint = `${TP_API_HOST}/fitness/v6/athletes/${target.athleteId}/workouts/${from}/${to}`;
  const result = await fetchFn(endpoint);

  if (result.status !== 200) {
    throw new Error(`TrainingPeaks workouts GET failed: status=${result.status}, ok=${result.ok}`);
  }
  if (!Array.isArray(result.body)) {
    throw new Error("TrainingPeaks workouts GET returned non-array JSON body.");
  }

  const rawItems = result.body.filter((item): item is TrainingPeaksWorkoutRaw => isRecord(item));
  const normalizedItems = normalizeTrainingPeaksWorkoutItems({
    athleteId: target.athleteId,
    rawItems,
  });
  const filteredItems = normalizedItems.filter((item) => item.workoutDate >= from && item.workoutDate <= to);

  // A hole in a day's orderOnDay (#2 present, #1 absent) = a calendar object the feed did not
  // return. Status stays ok — the fetch did succeed — but the day is marked on every one of its
  // rows and counted separately, so the plan reader and the run summary see it, instead of the
  // old silence (Elena 06.10: the coach's strength never arrived, the scan said ok).
  const orderGaps = findOrderOnDayGaps(filteredItems);
  const gapWarningByDate = new Map(orderGaps.map((gap) => [gap.date, formatOrderOnDayGapWarning(gap)]));

  const rawByWorkoutId = new Map<number, TrainingPeaksWorkoutRaw>();
  for (const rawItem of rawItems) {
    const workoutId = readPositiveInt(rawItem.workoutId);
    if (workoutId && !rawByWorkoutId.has(workoutId)) {
      rawByWorkoutId.set(workoutId, rawItem);
    }
  }

  const rows: TrainingPeaksWorkoutCacheUpsertRow[] = filteredItems.map((item) => {
    const rawItem = rawByWorkoutId.get(item.trainingPeaksWorkoutId);
    return {
      student_id: target.student.id,
      student_name: target.student.studentName,
      trainingpeaks_athlete_id: item.trainingPeaksAthleteId,
      trainingpeaks_workout_id: item.trainingPeaksWorkoutId,
      workout_date: item.workoutDate,
      title: item.title,
      sport_or_type_code: item.sportOrTypeCode,
      workout_type_value_id: item.workoutTypeValueId,
      workout_sub_type_id: item.workoutSubTypeId,
      is_planned: item.isPlanned,
      is_completed: item.isCompleted,
      planned_time_raw: item.plannedTimeRaw,
      completed_time_raw: item.completedTimeRaw,
      planned_distance_raw: item.plannedDistanceRaw,
      completed_distance_raw: item.completedDistanceRaw,
      compliance_duration_percent: item.complianceDurationPercent,
      compliance_distance_percent: item.complianceDistancePercent,
      start_time_planned: item.startTimePlanned,
      start_time: item.startTime,
      source_updated_at: parseOptionalIsoDateTime(item.lastModifiedDate),
      order_on_day: item.orderOnDay,
      scanned_at: scannedAt,
      normalization_warnings: gapWarningByDate.has(item.workoutDate)
        ? [...item.normalizationWarnings, gapWarningByDate.get(item.workoutDate)!]
        : item.normalizationWarnings,
      source_snapshot: rawItem ? buildCompactSourceSnapshot(rawItem) : {},
    };
  });

  await upsertCacheFn(rows);

  // Reconciliation: only reached after a successful scan (HTTP 200 + parsed
  // array) and a successful upsert above. Deletes stale phantom plans this run
  // did not refresh. runStartedAt === scannedAt (fixed once before the loop), so
  // the rows just upserted are never deleted.
  const reconciledDeleted = await reconcileFn({
    studentId: target.student.id,
    from,
    to,
    runStartedAt: scannedAt,
  });

  const planned = filteredItems.filter((item) => item.isPlanned).length;
  const completed = filteredItems.filter((item) => item.isCompleted).length;
  const plannedButNotCompleted = filteredItems.filter((item) => item.isPlanned && !item.isCompleted).length;
  const warnings = filteredItems.reduce((acc, item) => acc + item.normalizationWarnings.length, 0);

  return {
    studentId: target.student.id,
    athleteId: target.athleteId,
    studentName: target.student.studentName,
    status: "ok",
    rows: rows.length,
    normalizedRows: filteredItems.length,
    planned,
    completed,
    plannedButNotCompleted,
    warnings,
    rawItemsReturned: result.body.length,
    reconciledDeleted,
    incompleteDays: orderGaps.map((gap) => gap.date),
  };
}
