import type {
  TrainingPeaksHealthMetricCacheRow,
  TrainingPeaksStudentHealthMetricProfile,
} from "@/features/trainingpeaks/repository";

const SHORT_SLEEP_THRESHOLD_HOURS = 6.5;
const LOW_BODY_BATTERY_THRESHOLD = 35;

const SHORT_SLEEP_ALERT_TEXT = "3 дня подряд короткий сон по Garmin. Лучше уточнить самочувствие.";
const STRONGER_RECOVERY_ALERT_TEXT =
  "3 дня короткий сон + невысокая оценка заряда Garmin. Стоит проверить восстановление перед нагрузкой.";

export type TrainingPeaksRecoveryAlert = {
  kind: "short_sleep_streak" | "short_sleep_plus_low_body_battery";
  message: string;
};

export function evaluateTrainingPeaksRecoveryAlert(input: {
  profile: Pick<TrainingPeaksStudentHealthMetricProfile, "studentId" | "studentName">;
  metrics: Array<
    Pick<
      TrainingPeaksHealthMetricCacheRow,
      "metricDate" | "metricKey" | "valueNumeric" | "valueAvgNumeric" | "metricTimestamp"
    >
  >;
  targetDate: string;
  lookbackDays?: number;
}): TrainingPeaksRecoveryAlert | null {
  const lookbackDays = Math.max(1, Math.floor(input.lookbackDays ?? 3));
  const windowDates = buildWindowDates(input.targetDate, lookbackDays);

  const sleepByDate = pickMetricValuesByDate(input.metrics, "sleep_hours", new Set(windowDates));
  if (sleepByDate.size < lookbackDays) {
    return null;
  }

  const allShortSleep = windowDates.every((date) => {
    const value = sleepByDate.get(date);
    return typeof value === "number" && value < SHORT_SLEEP_THRESHOLD_HOURS;
  });
  if (!allShortSleep) {
    return null;
  }

  const bodyBatteryByDate = pickMetricValuesByDate(input.metrics, "body_battery", new Set(windowDates));
  let lowBodyBatteryDays = 0;
  for (const date of windowDates) {
    const value = bodyBatteryByDate.get(date);
    if (typeof value === "number" && value < LOW_BODY_BATTERY_THRESHOLD) {
      lowBodyBatteryDays += 1;
    }
  }

  if (lowBodyBatteryDays >= 2) {
    return {
      kind: "short_sleep_plus_low_body_battery",
      message: STRONGER_RECOVERY_ALERT_TEXT,
    };
  }

  return {
    kind: "short_sleep_streak",
    message: SHORT_SLEEP_ALERT_TEXT,
  };
}

function pickMetricValuesByDate(
  metrics: Array<
    Pick<
      TrainingPeaksHealthMetricCacheRow,
      "metricDate" | "metricKey" | "valueNumeric" | "valueAvgNumeric" | "metricTimestamp"
    >
  >,
  metricKey: string,
  allowedDates: Set<string>
): Map<string, number> {
  const values = new Map<string, { value: number; timestamp: string }>();
  for (const metric of metrics) {
    if (metric.metricKey !== metricKey || !allowedDates.has(metric.metricDate)) {
      continue;
    }
    const numericValue = resolveMetricNumericValue(metric);
    if (numericValue === null) {
      continue;
    }

    const timestamp = metric.metricTimestamp ?? "";
    const previous = values.get(metric.metricDate);
    if (!previous || timestamp >= previous.timestamp) {
      values.set(metric.metricDate, { value: numericValue, timestamp });
    }
  }

  const result = new Map<string, number>();
  for (const [date, item] of values.entries()) {
    result.set(date, item.value);
  }
  return result;
}

function resolveMetricNumericValue(metric: {
  valueNumeric: number | null;
  valueAvgNumeric: number | null;
}): number | null {
  if (typeof metric.valueAvgNumeric === "number" && Number.isFinite(metric.valueAvgNumeric)) {
    return metric.valueAvgNumeric;
  }
  if (typeof metric.valueNumeric === "number" && Number.isFinite(metric.valueNumeric)) {
    return metric.valueNumeric;
  }
  return null;
}

function buildWindowDates(targetDate: string, lookbackDays: number): string[] {
  const dates: string[] = [];
  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    dates.push(shiftIsoDate(targetDate, -i));
  }
  return dates;
}

function shiftIsoDate(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
}
