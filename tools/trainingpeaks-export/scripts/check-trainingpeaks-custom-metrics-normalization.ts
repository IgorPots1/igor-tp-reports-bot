import process from "node:process";

import { normalizeTrainingPeaksCustomMetricsPayload } from "./lib/trainingpeaks-custom-metrics-normalization.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const samplePayload = [
    {
      id: 1,
      athleteId: 5475677,
      timeStamp: "2026-05-02T00:00:00Z",
      details: [
        {
          parentId: 1,
          type: 60,
          value: 60,
          uploadClient: "garmin",
          label: "HRV",
          time: "2026-05-02T06:30:00Z",
        },
        {
          parentId: 1,
          type: 6,
          value: [5.7, 6.2, 5.9],
          uploadClient: "garmin",
          label: "Sleep Hours",
          time: "2026-05-02T06:31:00Z",
        },
      ],
    },
  ];

  const rows = normalizeTrainingPeaksCustomMetricsPayload(samplePayload);
  assert(rows.length === 2, "Expected 2 normalized rows.");

  const hrv = rows.find((row) => row.metricKey === "hrv");
  const sleep = rows.find((row) => row.metricKey === "sleep_hours");
  assert(Boolean(hrv), "Expected hrv metric row.");
  assert(Boolean(sleep), "Expected sleep_hours metric row.");
  assert(hrv?.valueNumeric === 60, "Expected HRV valueNumeric to be 60.");
  assert(sleep?.valueAvgNumeric !== null, "Expected aggregate avg value for sleep_hours.");
  assert(sleep?.unit === "hours", "Expected sleep_hours unit to be hours.");

  console.log("[check-trainingpeaks-custom-metrics-normalization] PASS");
  console.log(`rows=${rows.length}`);
  console.log(`keys=${[...new Set(rows.map((row) => row.metricKey))].join(",")}`);
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-custom-metrics-normalization] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
