import { STRENGTH_WORKOUT_TYPE_VALUE_ID } from "../../../../src/features/trainingpeaks/workout-activity-classification.ts";

export type TrainingPeaksWorkoutRaw = {
  workoutId?: unknown;
  workoutDay?: unknown;
  title?: unknown;
  workoutTypeValueId?: unknown;
  workoutSubTypeId?: unknown;
  code?: unknown;
  totalTimePlanned?: unknown;
  totalTime?: unknown;
  distancePlanned?: unknown;
  distance?: unknown;
  complianceDurationPercent?: unknown;
  complianceDistancePercent?: unknown;
  startTimePlanned?: unknown;
  startTime?: unknown;
  lastModifiedDate?: unknown;
  orderOnDay?: unknown;
  completed?: unknown;
  [key: string]: unknown;
};

export type NormalizedTrainingPeaksWorkout = {
  trainingPeaksAthleteId: number;
  trainingPeaksWorkoutId: number;
  workoutDate: string;
  title: string | null;
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  isPlanned: boolean;
  isCompleted: boolean;
  plannedTimeRaw: number | null;
  completedTimeRaw: number | null;
  plannedDistanceRaw: number | null;
  completedDistanceRaw: number | null;
  complianceDurationPercent: number | null;
  complianceDistancePercent: number | null;
  startTimePlanned: string | null;
  startTime: string | null;
  lastModifiedDate: string | null;
  orderOnDay: number | null;
  normalizationWarnings: string[];
};

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

function toPositiveInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

function toFiniteInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : null;
}

function toSafeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toIsoDatePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match?.[1] ?? null;
}

export function normalizeTrainingPeaksWorkoutItem(input: {
  athleteId: number;
  raw: TrainingPeaksWorkoutRaw;
}): NormalizedTrainingPeaksWorkout | null {
  const { athleteId, raw } = input;
  const workoutId = toPositiveInteger(raw.workoutId);
  const workoutDate = toIsoDatePart(raw.workoutDay);
  if (!workoutId || !workoutDate) {
    return null;
  }

  const plannedTimeRaw = toFiniteNumber(raw.totalTimePlanned);
  const completedTimeRaw = toFiniteNumber(raw.totalTime);
  const plannedDistanceRaw = toFiniteNumber(raw.distancePlanned);
  const completedDistanceRaw = toFiniteNumber(raw.distance);
  const workoutTypeValueId = toFiniteInteger(raw.workoutTypeValueId);
  const title = toSafeString(raw.title);

  const isPlannedByMetrics = Boolean((plannedTimeRaw ?? 0) > 0 || (plannedDistanceRaw ?? 0) > 0);
  const isCompleted = Boolean((completedTimeRaw ?? 0) > 0 || (completedDistanceRaw ?? 0) > 0);
  // A coach-planned STRENGTH session carries no metrics at all. Verified live against the
  // real API (2026-08-11, 112 athletes, 41 days): TrainingPeaks returns it with only
  // workoutId / athleteId / title / workoutTypeValueId / workoutDay (+ lastModifiedDate,
  // orderOnDay) — no totalTimePlanned, no distancePlanned, no tssPlanned, no structure.
  // So the metric rule above can never see it, and the plan sat in the cache flagged
  // neither planned nor completed, invisible to every consumer.
  //
  // SCOPED TO STRENGTH ON PURPOSE. Day off (type 7) and the club's Other (type 100)
  // markers also arrive metric-less, and both MUST stay planned=false/completed=false —
  // club marker и Day off не должны считаться тренировкой (docs/club-tp-exec-validation.md).
  // Требование непустого заголовка отсекает пустые огрызки удалённых записей.
  const isMetriclessStrengthPlan =
    workoutTypeValueId === STRENGTH_WORKOUT_TYPE_VALUE_ID &&
    !isPlannedByMetrics &&
    !isCompleted &&
    title !== null;
  const isPlanned = isPlannedByMetrics || isMetriclessStrengthPlan;

  const warnings: string[] = [];
  if (!title) {
    warnings.push("Missing title.");
  }
  if (!isPlanned && !isCompleted) {
    warnings.push("Neither planned nor completed metrics were detected.");
    warnings.push("Planned and completed are both false.");
  }

  const explicitCompleted = raw.completed;
  if (explicitCompleted !== undefined) {
    if (typeof explicitCompleted !== "boolean") {
      warnings.push("Completion looks ambiguous: `completed` is non-boolean.");
    } else if (explicitCompleted !== isCompleted) {
      warnings.push("Completion looks ambiguous: `completed` conflicts with metric-derived completion.");
    }
  } else if (!isCompleted && (completedTimeRaw !== null || completedDistanceRaw !== null)) {
    warnings.push("Completion looks ambiguous: completion metrics exist but do not indicate completion.");
  }

  return {
    trainingPeaksAthleteId: athleteId,
    trainingPeaksWorkoutId: workoutId,
    workoutDate,
    title,
    sportOrTypeCode: toSafeString(raw.code),
    workoutTypeValueId,
    workoutSubTypeId: toFiniteInteger(raw.workoutSubTypeId),
    isPlanned,
    isCompleted,
    plannedTimeRaw,
    completedTimeRaw,
    plannedDistanceRaw,
    completedDistanceRaw,
    complianceDurationPercent: toFiniteNumber(raw.complianceDurationPercent),
    complianceDistancePercent: toFiniteNumber(raw.complianceDistancePercent),
    startTimePlanned: toSafeString(raw.startTimePlanned),
    startTime: toSafeString(raw.startTime),
    lastModifiedDate: toSafeString(raw.lastModifiedDate),
    orderOnDay: toFiniteInteger(raw.orderOnDay),
    normalizationWarnings: warnings,
  };
}

export function normalizeTrainingPeaksWorkoutItems(input: {
  athleteId: number;
  rawItems: TrainingPeaksWorkoutRaw[];
}): NormalizedTrainingPeaksWorkout[] {
  const output: NormalizedTrainingPeaksWorkout[] = [];
  for (const raw of input.rawItems) {
    const normalized = normalizeTrainingPeaksWorkoutItem({
      athleteId: input.athleteId,
      raw,
    });
    if (normalized) {
      output.push(normalized);
    }
  }
  return output;
}

export const ORDER_ON_DAY_GAP_WARNING_PREFIX = "order_on_day_gap";

export type OrderOnDayGap = {
  date: string;
  presentOrders: number[];
  missingOrders: number[];
};

/**
 * Days whose orderOnDay numbering has a hole: the feed holds #2 but not #1, or #1 and #3
 * but not #2. TP numbers EVERY calendar object of a day, including ones the
 * /workouts/{from}/{to} feed never returns — a structured strength built in TP's strength
 * builder lives on api.peakswaresb.com and is absent from the feed (Elena 2026-10-06: the
 * feed held only «Легкий бег» with orderOnDay=2). A hole therefore means «this day may be
 * incomplete», NOT «an object was lost»: a workout moved or deleted in TP can leave the
 * same hole without renumbering. It is a signal to look, never a verdict.
 * Items without orderOnDay (device-recorded completions) say nothing about the numbering
 * and are ignored.
 */
export function findOrderOnDayGaps(
  items: ReadonlyArray<{ workoutDate: string; orderOnDay: number | null }>,
): OrderOnDayGap[] {
  const ordersByDate = new Map<string, Set<number>>();
  for (const item of items) {
    if (item.orderOnDay === null || !Number.isInteger(item.orderOnDay) || item.orderOnDay < 1) {
      continue;
    }
    const orders = ordersByDate.get(item.workoutDate) ?? new Set<number>();
    orders.add(item.orderOnDay);
    ordersByDate.set(item.workoutDate, orders);
  }
  const gaps: OrderOnDayGap[] = [];
  for (const [date, orders] of ordersByDate) {
    const max = Math.max(...orders);
    const missingOrders: number[] = [];
    for (let order = 1; order < max; order += 1) {
      if (!orders.has(order)) {
        missingOrders.push(order);
      }
    }
    if (missingOrders.length > 0) {
      gaps.push({ date, presentOrders: [...orders].sort((a, b) => a - b), missingOrders });
    }
  }
  return gaps.sort((a, b) => a.date.localeCompare(b.date));
}

export function formatOrderOnDayGapWarning(gap: OrderOnDayGap): string {
  return (
    `${ORDER_ON_DAY_GAP_WARNING_PREFIX}: missing=${gap.missingOrders.join(",")} present=${gap.presentOrders.join(",")} ` +
    "(day may be incomplete: a TP calendar object is absent from the /workouts feed — e.g. a structured strength, " +
    "or a workout moved/deleted without renumbering)"
  );
}
