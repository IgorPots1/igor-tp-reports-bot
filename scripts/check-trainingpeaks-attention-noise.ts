import process from "node:process";

import { summarizeYesterdayScanAttention } from "@/features/trainingpeaks/service";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const activeStudents = [
    { id: "student-a", studentName: "Alex A" },
    { id: "student-b", studentName: "Alex B" },
    { id: "student-c", studentName: "Alex C" },
    { id: "student-d", studentName: "Alex D" },
    { id: "student-e", studentName: "Alex E" },
  ];

  const summary = summarizeYesterdayScanAttention({
    now: new Date("2026-06-02T12:00:00+02:00"),
    activeStudents,
    statuses: [
      {
        studentId: "student-a",
        status: "failed",
        scannedAt: "2026-06-01T07:00:00.000Z",
      },
      {
        studentId: "student-a",
        status: "ok",
        scannedAt: "2026-06-01T08:00:00.000Z",
      },
      {
        studentId: "student-b",
        status: "failed",
        scannedAt: "2026-06-01T08:00:00.000Z",
      },
      {
        studentId: "student-c",
        status: "failed",
        scannedAt: "2026-05-29T07:00:00.000Z",
      },
      {
        studentId: "student-d",
        status: "ok",
        scannedAt: "2026-06-01T09:00:00.000Z",
      },
    ],
  });

  assert(
    summary.actionableFailedCount === 1,
    `Expected only one actionable scan failure, got ${summary.actionableFailedCount}.`
  );
  assert(
    summary.actionableFailedNames.length === 1 && summary.actionableFailedNames[0] === "Alex B",
    `Expected Alex B as actionable failure, got ${summary.actionableFailedNames.join(", ") || "none"}.`
  );
  assert(
    summary.missingScanCount === 1,
    `Expected one missing scan status (student-e), got ${summary.missingScanCount}.`
  );
  assert(summary.shouldShowMissingScanAlert, "Missing scan alert should be enabled after scan window.");

  const preWindowSummary = summarizeYesterdayScanAttention({
    now: new Date("2026-06-02T08:30:00+02:00"),
    activeStudents: [{ id: "student-z", studentName: "Alex Z" }],
    statuses: [],
  });
  assert(
    !preWindowSummary.shouldShowMissingScanAlert,
    "Missing scan alert should stay hidden before the morning scan window."
  );

  console.log("[check-trainingpeaks-attention-noise] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-attention-noise] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
