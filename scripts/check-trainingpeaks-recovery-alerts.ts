import process from "node:process";

import { evaluateTrainingPeaksRecoveryAlert } from "@/features/trainingpeaks/recovery-alerts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const profile = {
    studentId: "student-1",
    studentName: "Test Athlete",
  };

  const shortSleepThreeDays = evaluateTrainingPeaksRecoveryAlert({
    profile,
    targetDate: "2026-05-18",
    lookbackDays: 3,
    metrics: [
      { metricDate: "2026-05-16", metricKey: "sleep_hours", valueNumeric: 6.4, valueAvgNumeric: null, metricTimestamp: "2026-05-16T06:00:00Z" },
      { metricDate: "2026-05-17", metricKey: "sleep_hours", valueNumeric: 6.2, valueAvgNumeric: null, metricTimestamp: "2026-05-17T06:00:00Z" },
      { metricDate: "2026-05-18", metricKey: "sleep_hours", valueNumeric: 6.3, valueAvgNumeric: null, metricTimestamp: "2026-05-18T06:00:00Z" },
    ],
  });
  assert(shortSleepThreeDays?.kind === "short_sleep_streak", "Expected short sleep streak alert for 3 short sleep days.");

  const oneShortSleepDay = evaluateTrainingPeaksRecoveryAlert({
    profile,
    targetDate: "2026-05-18",
    lookbackDays: 3,
    metrics: [
      { metricDate: "2026-05-16", metricKey: "sleep_hours", valueNumeric: 7.1, valueAvgNumeric: null, metricTimestamp: "2026-05-16T06:00:00Z" },
      { metricDate: "2026-05-17", metricKey: "sleep_hours", valueNumeric: 6.2, valueAvgNumeric: null, metricTimestamp: "2026-05-17T06:00:00Z" },
      { metricDate: "2026-05-18", metricKey: "sleep_hours", valueNumeric: 7.0, valueAvgNumeric: null, metricTimestamp: "2026-05-18T06:00:00Z" },
    ],
  });
  assert(oneShortSleepDay === null, "Expected no alert for one short sleep day.");

  const shortSleepWithLowBodyBattery = evaluateTrainingPeaksRecoveryAlert({
    profile,
    targetDate: "2026-05-18",
    lookbackDays: 3,
    metrics: [
      { metricDate: "2026-05-16", metricKey: "sleep_hours", valueNumeric: 6.4, valueAvgNumeric: null, metricTimestamp: "2026-05-16T06:00:00Z" },
      { metricDate: "2026-05-17", metricKey: "sleep_hours", valueNumeric: 6.2, valueAvgNumeric: null, metricTimestamp: "2026-05-17T06:00:00Z" },
      { metricDate: "2026-05-18", metricKey: "sleep_hours", valueNumeric: 6.3, valueAvgNumeric: null, metricTimestamp: "2026-05-18T06:00:00Z" },
      { metricDate: "2026-05-16", metricKey: "body_battery", valueNumeric: 33, valueAvgNumeric: null, metricTimestamp: "2026-05-16T06:00:00Z" },
      { metricDate: "2026-05-17", metricKey: "body_battery", valueNumeric: 34, valueAvgNumeric: null, metricTimestamp: "2026-05-17T06:00:00Z" },
      { metricDate: "2026-05-18", metricKey: "body_battery", valueNumeric: 38, valueAvgNumeric: null, metricTimestamp: "2026-05-18T06:00:00Z" },
    ],
  });
  assert(
    shortSleepWithLowBodyBattery?.kind === "short_sleep_plus_low_body_battery",
    "Expected stronger alert for short sleep + low body battery."
  );

  const insufficientCoverage = evaluateTrainingPeaksRecoveryAlert({
    profile,
    targetDate: "2026-05-18",
    lookbackDays: 3,
    metrics: [
      { metricDate: "2026-05-17", metricKey: "sleep_hours", valueNumeric: 6.2, valueAvgNumeric: null, metricTimestamp: "2026-05-17T06:00:00Z" },
      { metricDate: "2026-05-18", metricKey: "sleep_hours", valueNumeric: 6.1, valueAvgNumeric: null, metricTimestamp: "2026-05-18T06:00:00Z" },
    ],
  });
  assert(insufficientCoverage === null, "Expected no alert when fewer than 3 sleep days are available.");

  console.log("[check-trainingpeaks-recovery-alerts] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-recovery-alerts] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
