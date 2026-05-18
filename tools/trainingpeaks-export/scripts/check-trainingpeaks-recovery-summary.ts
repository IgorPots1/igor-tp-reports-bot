import process from "node:process";

import { buildTrainingPeaksRecoverySummary } from "./lib/trainingpeaks-recovery-summary.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const readyCase = buildTrainingPeaksRecoverySummary({
    studentName: "Ready Athlete",
    from: "2026-05-12",
    to: "2026-05-18",
    profile: {
      status: "ready",
      recovery_metrics_enabled: true,
    },
    metrics: [
      { metric_key: "sleep_hours", metric_date: "2026-05-12", value_numeric: 7.2, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-13", value_numeric: 7.1, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-14", value_numeric: 6.9, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-15", value_numeric: 7.0, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-12", value_numeric: 58, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-13", value_numeric: 61, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-14", value_numeric: 59, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-15", value_numeric: 60, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-12", value_numeric: 52, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-13", value_numeric: 53, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-14", value_numeric: 51, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-15", value_numeric: 52, value_avg_numeric: null },
    ],
    baseline: null,
  });
  assert(readyCase.status === "ready", "Expected ready case status=ready.");

  const insufficientCase = buildTrainingPeaksRecoverySummary({
    studentName: "Insufficient Athlete",
    from: "2026-05-12",
    to: "2026-05-18",
    profile: {
      status: "partial",
      recovery_metrics_enabled: true,
    },
    metrics: [
      { metric_key: "sleep_hours", metric_date: "2026-05-12", value_numeric: 7.1, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-13", value_numeric: 6.8, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-13", value_numeric: 55, value_avg_numeric: null },
    ],
    baseline: null,
  });
  assert(
    insufficientCase.status === "insufficient_data",
    "Expected insufficient case status=insufficient_data."
  );

  const lowSleepCase = buildTrainingPeaksRecoverySummary({
    studentName: "Low Sleep Athlete",
    from: "2026-05-12",
    to: "2026-05-18",
    profile: {
      status: "ready",
      recovery_metrics_enabled: true,
    },
    metrics: [
      { metric_key: "sleep_hours", metric_date: "2026-05-12", value_numeric: 5.5, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-13", value_numeric: 5.8, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-14", value_numeric: 6.2, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-15", value_numeric: 6.0, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-12", value_numeric: 53, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-13", value_numeric: 52, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-14", value_numeric: 54, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-15", value_numeric: 51, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-12", value_numeric: 56, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-13", value_numeric: 55, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-14", value_numeric: 57, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-15", value_numeric: 58, value_avg_numeric: null },
    ],
    baseline: null,
  });
  assert(
    lowSleepCase.signals.low_sleep_multiple_nights,
    "Expected low sleep signal for low sleep case."
  );

  const disabledProfileCase = buildTrainingPeaksRecoverySummary({
    studentName: "Disabled Athlete",
    from: "2026-05-12",
    to: "2026-05-18",
    profile: {
      status: "ready",
      recovery_metrics_enabled: false,
    },
    metrics: [
      { metric_key: "sleep_hours", metric_date: "2026-05-12", value_numeric: 7.3, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-12", value_numeric: 60, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-12", value_numeric: 50, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-13", value_numeric: 7.1, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-13", value_numeric: 61, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-13", value_numeric: 51, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-14", value_numeric: 7.0, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-14", value_numeric: 62, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-14", value_numeric: 52, value_avg_numeric: null },
      { metric_key: "sleep_hours", metric_date: "2026-05-15", value_numeric: 7.2, value_avg_numeric: null },
      { metric_key: "hrv", metric_date: "2026-05-15", value_numeric: 59, value_avg_numeric: null },
      { metric_key: "pulse", metric_date: "2026-05-15", value_numeric: 50, value_avg_numeric: null },
    ],
    baseline: null,
  });
  assert(
    disabledProfileCase.status === "insufficient_data",
    "Expected disabled profile case status=insufficient_data."
  );

  console.log("[check-trainingpeaks-recovery-summary] PASS");
  console.log(
    `cases=${[
      readyCase.status,
      insufficientCase.status,
      lowSleepCase.status,
      disabledProfileCase.status,
    ].join(",")}`
  );
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-recovery-summary] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
