import type { BatchChildSpec } from "@/features/trainingpeaks/tp-write-action-types";

/**
 * PR4 step 4 -- batch confirm-card content, PURE half. computeBatchAggregate
 * and detectBatchAnomalies take only the batch's own children plus a
 * pre-fetched BatchAnomalyContext -- no DB/network dependency, so this file
 * can be unit-tested (and its unit tests run) under plain
 * `node --experimental-strip-types`, without touching Supabase.
 *
 * The impure half (the ONE function that actually calls the 4 existing data
 * sources to build a BatchAnomalyContext) lives in the SIBLING file
 * batch-preview-context.ts -- kept separate specifically so this file's
 * `import type` boundary is the only thing this file needs, matching the
 * same split already used for tp-write-action-types.ts vs repository.ts/
 * tp-api-client.ts.
 *
 * Per naryad: the aggregate + anomalies block is what the coach decides from
 * -- the per-item list is supplementary, never the primary confirm surface
 * ("простыня из 100 строк = кнопка ок вслепую = choke point обесценен").
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ─── aggregate ──────────────────────────────────────────────────────────────────

export type BatchAggregateStats = {
  totalActions: number;
  athleteCount: number;
  countByType: Partial<Record<Exclude<BatchChildSpec["actionType"], never>, number>>;
  totalPlannedMinutes: number;
  totalPlannedDistanceMeters: number;
};

/** Reads athleteId out of ANY of the 6 payload shapes without needing per-type imports. */
export function readChildAthleteId(payload: unknown): number | null {
  return asNumber(asRecord(payload)?.athleteId);
}

/** Reads the calendar date out of a create/strength payload (workoutDay / prescribedDate). */
export function readChildWorkoutDay(child: BatchChildSpec): string | null {
  const payload = asRecord(child.payload);
  if (!payload) return null;
  return asString(payload.workoutDay) ?? asString(payload.prescribedDate);
}

export function computeBatchAggregate(children: BatchChildSpec[]): BatchAggregateStats {
  const athleteIds = new Set<number>();
  const countByType: BatchAggregateStats["countByType"] = {};
  let totalPlannedMinutes = 0;
  let totalPlannedDistanceMeters = 0;

  for (const child of children) {
    const athleteId = readChildAthleteId(child.payload);
    if (athleteId !== null) athleteIds.add(athleteId);
    countByType[child.actionType] = (countByType[child.actionType] ?? 0) + 1;

    const payload = asRecord(child.payload);
    if (!payload) continue;
    if (child.actionType === "create_workout" || child.actionType === "strength_workout") {
      const totalTimePlanned = asNumber(payload.totalTimePlanned);
      if (totalTimePlanned) totalPlannedMinutes += totalTimePlanned * 60;
      const distancePlanned = asNumber(payload.distancePlanned);
      if (distancePlanned) totalPlannedDistanceMeters += distancePlanned;
    }
  }

  return {
    totalActions: children.length,
    athleteCount: athleteIds.size,
    countByType,
    totalPlannedMinutes: Math.round(totalPlannedMinutes),
    totalPlannedDistanceMeters: Math.round(totalPlannedDistanceMeters),
  };
}

// ─── anomaly detection (pure, given a pre-fetched context) ─────────────────────

export type BatchAnomalyKind = "race_proximity" | "existing_workout_collision" | "volume_spike" | "active_health_signal";

export type BatchAnomaly = {
  kind: BatchAnomalyKind;
  athleteId: number;
  studentName: string | null;
  detail: string;
};

export type BatchAnomalyContext = {
  studentNameByAthleteId: Map<number, string | null>;
  /** Upcoming race event ISO dates, per athlete. */
  raceDatesByAthleteId: Map<number, string[]>;
  /** Workout-cache dates that already have SOMETHING scheduled, per athlete. */
  existingWorkoutDatesByAthleteId: Map<number, Set<string>>;
  /**
   * weekly_minutes_cap (override wins if manually overridden) -- a CEILING
   * from the athlete's training-baseline report, not a "usual/average"
   * figure. Used as the closest available proxy; framed as "приближается к
   * лимиту" in the anomaly text, not "X% above usual", since that stat does
   * not exist in this codebase (see PR4 research: raw_stats_jsonb is
   * unparsed and no repository function exposes a mean).
   */
  weeklyMinutesCapByAthleteId: Map<number, number | null>;
  /** true if the athlete has at least one ACTIVE health-related signal. */
  hasActiveHealthSignalByAthleteId: Map<number, boolean>;
};

export const RACE_PROXIMITY_MAX_DAYS = 6;

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay);
}

export function detectBatchAnomalies(children: BatchChildSpec[], context: BatchAnomalyContext): BatchAnomaly[] {
  const anomalies: BatchAnomaly[] = [];

  for (const child of children) {
    const athleteId = readChildAthleteId(child.payload);
    const workoutDay = readChildWorkoutDay(child);
    if (athleteId === null) continue;
    const studentName = context.studentNameByAthleteId.get(athleteId) ?? null;

    if (workoutDay) {
      const raceDates = context.raceDatesByAthleteId.get(athleteId) ?? [];
      for (const raceDate of raceDates) {
        const gap = daysBetween(workoutDay, raceDate);
        // [0, 6] inclusive is intentionally broader than the naryad's literal
        // "3-6 days" -- a workout the day before/of a race is at LEAST as
        // worth flagging as one 3-6 days out, not less.
        if (gap >= 0 && gap <= RACE_PROXIMITY_MAX_DAYS) {
          anomalies.push({
            kind: "race_proximity",
            athleteId,
            studentName,
            detail: `тренировка ${workoutDay} — за ${gap} дн. до старта ${raceDate}`,
          });
        }
      }

      const existingDates = context.existingWorkoutDatesByAthleteId.get(athleteId);
      if (existingDates?.has(workoutDay)) {
        anomalies.push({
          kind: "existing_workout_collision",
          athleteId,
          studentName,
          detail: `на ${workoutDay} уже стоит тренировка`,
        });
      }
    }

    if (context.hasActiveHealthSignalByAthleteId.get(athleteId)) {
      anomalies.push({
        kind: "active_health_signal",
        athleteId,
        studentName,
        detail: "есть активный health-сигнал",
      });
    }
  }

  // Volume: compare this batch's per-athlete planned minutes against their cap (once per athlete, not per child).
  const plannedMinutesByAthlete = new Map<number, number>();
  for (const child of children) {
    const athleteId = readChildAthleteId(child.payload);
    if (athleteId === null) continue;
    const payload = asRecord(child.payload);
    const totalTimePlanned = payload ? asNumber(payload.totalTimePlanned) : null;
    if (totalTimePlanned) {
      plannedMinutesByAthlete.set(athleteId, (plannedMinutesByAthlete.get(athleteId) ?? 0) + totalTimePlanned * 60);
    }
  }
  for (const [athleteId, minutes] of plannedMinutesByAthlete) {
    const cap = context.weeklyMinutesCapByAthleteId.get(athleteId);
    if (cap && minutes > cap) {
      anomalies.push({
        kind: "volume_spike",
        athleteId,
        studentName: context.studentNameByAthleteId.get(athleteId) ?? null,
        detail: `в батче ${Math.round(minutes)} мин на этого атлета — выше лимита ${cap} мин/нед`,
      });
    }
  }

  return anomalies;
}
