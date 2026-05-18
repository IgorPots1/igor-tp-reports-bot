export type RecoverySummaryStatus = "ready" | "partial" | "insufficient_data";

export type RecoveryMetricWeeklyInput = {
  studentName: string;
  from: string;
  to: string;
  profile: {
    status: string;
    recovery_metrics_enabled: boolean;
  };
  metrics: Array<{
    metric_key: string;
    metric_date: string;
    value_numeric: number | null;
    value_avg_numeric: number | null;
  }>;
  baseline: {
    avg_hrv?: number | null;
    avg_pulse?: number | null;
  } | null;
};

export type RecoverySummarySignals = {
  low_sleep_multiple_nights: boolean;
  limited_sleep_coverage: boolean;
  hrv_available: boolean;
  pulse_available: boolean;
  body_battery_available: boolean;
  low_body_battery_if_avg_below_reasonable_threshold: boolean;
};

export type RecoverySummaryResult = {
  status: RecoverySummaryStatus;
  coverage: {
    sleep_days: number;
    hrv_days: number;
    pulse_days: number;
    body_battery_days: number;
    stress_days: number;
  };
  aggregates: {
    avg_sleep_hours: number | null;
    nights_sleep_lt_6h: number;
    nights_sleep_lt_7h: number;
    avg_hrv: number | null;
    avg_pulse: number | null;
    avg_body_battery: number | null;
    avg_stress_level: number | null;
  };
  signals: RecoverySummarySignals;
  text: string;
};

const THRESHOLDS = {
  readyCoverageDays: 4,
  sleepHoursLowAvg: 6.5,
  sleepHoursVeryLowNight: 6,
  sleepLowNightsSignalCount: 2,
  bodyBatteryLowAverage: 35,
} as const;

function pickNumericValue(input: {
  value_numeric: number | null;
  value_avg_numeric: number | null;
}): number | null {
  if (typeof input.value_avg_numeric === "number" && Number.isFinite(input.value_avg_numeric)) {
    return input.value_avg_numeric;
  }
  if (typeof input.value_numeric === "number" && Number.isFinite(input.value_numeric)) {
    return input.value_numeric;
  }
  return null;
}

function avg(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(3));
}

function buildCoverage(rows: RecoveryMetricWeeklyInput["metrics"]): RecoverySummaryResult["coverage"] {
  const sleepDays = new Set<string>();
  const hrvDays = new Set<string>();
  const pulseDays = new Set<string>();
  const bodyBatteryDays = new Set<string>();
  const stressDays = new Set<string>();

  for (const row of rows) {
    if (row.metric_key === "sleep_hours") {
      sleepDays.add(row.metric_date);
    } else if (row.metric_key === "hrv") {
      hrvDays.add(row.metric_date);
    } else if (row.metric_key === "pulse") {
      pulseDays.add(row.metric_date);
    } else if (row.metric_key === "body_battery") {
      bodyBatteryDays.add(row.metric_date);
    } else if (row.metric_key === "stress_level") {
      stressDays.add(row.metric_date);
    }
  }

  return {
    sleep_days: sleepDays.size,
    hrv_days: hrvDays.size,
    pulse_days: pulseDays.size,
    body_battery_days: bodyBatteryDays.size,
    stress_days: stressDays.size,
  };
}

function buildAggregates(
  rows: RecoveryMetricWeeklyInput["metrics"]
): RecoverySummaryResult["aggregates"] {
  const sleepValues: number[] = [];
  const sleepByDate = new Map<string, number[]>();
  const hrvValues: number[] = [];
  const pulseValues: number[] = [];
  const bodyBatteryValues: number[] = [];
  const stressValues: number[] = [];

  for (const row of rows) {
    const value = pickNumericValue(row);
    if (value === null) {
      continue;
    }
    if (row.metric_key === "sleep_hours") {
      sleepValues.push(value);
      const values = sleepByDate.get(row.metric_date) ?? [];
      values.push(value);
      sleepByDate.set(row.metric_date, values);
      continue;
    }
    if (row.metric_key === "hrv") {
      hrvValues.push(value);
      continue;
    }
    if (row.metric_key === "pulse") {
      pulseValues.push(value);
      continue;
    }
    if (row.metric_key === "body_battery") {
      bodyBatteryValues.push(value);
      continue;
    }
    if (row.metric_key === "stress_level") {
      stressValues.push(value);
    }
  }

  const nightlySleepAverages = [...sleepByDate.values()].map((values) => avg(values) ?? 0);
  const nightsSleepLt6h = nightlySleepAverages.filter(
    (value) => value < THRESHOLDS.sleepHoursVeryLowNight
  ).length;
  const nightsSleepLt7h = nightlySleepAverages.filter((value) => value < 7).length;

  return {
    avg_sleep_hours: avg(sleepValues),
    nights_sleep_lt_6h: nightsSleepLt6h,
    nights_sleep_lt_7h: nightsSleepLt7h,
    avg_hrv: avg(hrvValues),
    avg_pulse: avg(pulseValues),
    avg_body_battery: avg(bodyBatteryValues),
    avg_stress_level: avg(stressValues),
  };
}

function resolveStatus(
  profile: RecoveryMetricWeeklyInput["profile"],
  coverage: RecoverySummaryResult["coverage"]
): RecoverySummaryStatus {
  if (!profile.recovery_metrics_enabled) {
    return "insufficient_data";
  }

  const ready =
    coverage.sleep_days >= THRESHOLDS.readyCoverageDays &&
    coverage.hrv_days >= THRESHOLDS.readyCoverageDays &&
    coverage.pulse_days >= THRESHOLDS.readyCoverageDays;
  if (ready) {
    return "ready";
  }

  const partial =
    coverage.sleep_days >= THRESHOLDS.readyCoverageDays ||
    coverage.hrv_days >= THRESHOLDS.readyCoverageDays ||
    coverage.pulse_days >= THRESHOLDS.readyCoverageDays;
  if (partial) {
    return "partial";
  }

  return "insufficient_data";
}

function buildSignals(
  coverage: RecoverySummaryResult["coverage"],
  aggregates: RecoverySummaryResult["aggregates"]
): RecoverySummarySignals {
  return {
    low_sleep_multiple_nights:
      (aggregates.avg_sleep_hours !== null && aggregates.avg_sleep_hours < THRESHOLDS.sleepHoursLowAvg) ||
      aggregates.nights_sleep_lt_6h >= THRESHOLDS.sleepLowNightsSignalCount,
    limited_sleep_coverage: coverage.sleep_days < THRESHOLDS.readyCoverageDays,
    hrv_available: coverage.hrv_days > 0,
    pulse_available: coverage.pulse_days > 0,
    body_battery_available: coverage.body_battery_days > 0,
    low_body_battery_if_avg_below_reasonable_threshold:
      aggregates.avg_body_battery !== null &&
      aggregates.avg_body_battery < THRESHOLDS.bodyBatteryLowAverage,
  };
}

function buildText(input: {
  status: RecoverySummaryStatus;
  signals: RecoverySummarySignals;
  aggregates: RecoverySummaryResult["aggregates"];
  profileEnabled: boolean;
}): string {
  if (!input.profileEnabled || input.status === "insufficient_data") {
    return [
      "По данным Garmin за неделю данных по восстановлению недостаточно для уверенного вывода.",
      "HRV и пульс лучше оценивать относительно личной базы; сейчас baseline ещё не подключён.",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("По данным Garmin за неделю видно динамику показателей восстановления.");

  if (input.signals.low_sleep_multiple_nights) {
    lines.push("Сон выглядит ограничивающим фактором для восстановления.");
  } else if (input.signals.limited_sleep_coverage) {
    lines.push("Покрытие сна ограничено, оценка сна менее надёжна.");
  }

  if (input.signals.low_body_battery_if_avg_below_reasonable_threshold) {
    lines.push("Body Battery выглядит сниженным и может служить только вспомогательным сигналом Garmin.");
  }

  lines.push(
    "HRV и пульс лучше оценивать относительно личной базы; сейчас baseline ещё не подключён."
  );

  return lines.slice(0, 5).join("\n");
}

export function buildTrainingPeaksRecoverySummary(
  input: RecoveryMetricWeeklyInput
): RecoverySummaryResult {
  const coverage = buildCoverage(input.metrics);
  const aggregates = buildAggregates(input.metrics);
  const status = resolveStatus(input.profile, coverage);
  const signals = buildSignals(coverage, aggregates);
  const text = buildText({
    status,
    signals,
    aggregates,
    profileEnabled: input.profile.recovery_metrics_enabled,
  });

  return {
    status,
    coverage,
    aggregates,
    signals,
    text,
  };
}
