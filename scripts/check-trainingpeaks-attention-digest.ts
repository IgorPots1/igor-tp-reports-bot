import process from "node:process";

import {
  buildTrainingPeaksAttentionDigestMessages,
  formatTrainingPeaksAttentionSnapshotMessage,
} from "@/features/trainingpeaks/attention-telegram";
import { summarizeYesterdayScanAttention } from "@/features/trainingpeaks/service";
import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildSnapshotWithTodayItems(count: number): TrainingPeaksAttentionSnapshot {
  const today = Array.from({ length: count }, (_, index) => ({
    level: "today" as const,
    studentName: `Athlete ${index + 1}`,
    reason: "вчера была беговая тренировка, выполнения не найдено",
  }));

  return {
    urgent: [],
    today,
    observe: [],
    fyi: [],
    followUpToday: [],
    followUpOverflowCount: 0,
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
  };
}

function run(): void {
  const snapshot = buildSnapshotWithTodayItems(8);
  const message = formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Утренний обзор TrainingPeaks");
  const todayLines = message
    .split("\n")
    .filter((line) => line.startsWith("• ") && line.includes("Athlete"));

  assert(todayLines.length <= 5, `Expected compact today section up to 5 lines, got ${todayLines.length}.`);
  assert(message.includes("+3 ещё"), 'Digest should include overflow line for truncated "today" items.');

  const chunks = buildTrainingPeaksAttentionDigestMessages(snapshot, "Утренний обзор TrainingPeaks");
  assert(chunks.length >= 1, "Expected at least one digest chunk.");
  assert(
    chunks.every((chunk) => chunk.length <= 3500),
    "Each digest chunk must stay within the 3500 character limit."
  );
  assert(
    chunks.join("\n").includes("+3 ещё"),
    "Chunked digest should include overflow marker for compacted today items."
  );

  const yesterdayScanSummary = summarizeYesterdayScanAttention({
    now: new Date("2026-06-02T12:00:00+02:00"),
    activeStudents: Array.from({ length: 100 }, (_, index) => ({
      id: `student-${index + 1}`,
      studentName: `Student ${index + 1}`,
    })),
    statuses: [
      ...Array.from({ length: 98 }, (_, index) => ({
        studentId: `student-${index + 3}`,
        status: "failed" as const,
        scannedAt: "2026-06-01T07:00:00.000Z",
      })),
      {
        studentId: "student-1",
        status: "failed" as const,
        scannedAt: "2026-06-01T07:00:00.000Z",
      },
      {
        studentId: "student-1",
        status: "ok" as const,
        scannedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        studentId: "student-2",
        status: "failed" as const,
        scannedAt: "2026-05-28T07:00:00.000Z",
      },
    ],
  });
  assert(
    yesterdayScanSummary.actionableFailedCount === 98,
    `Expected 98 actionable failures after success/TTL suppression, got ${yesterdayScanSummary.actionableFailedCount}.`
  );
  assert(
    yesterdayScanSummary.missingScanCount === 0,
    `Expected 0 missing scans when every active student has status, got ${yesterdayScanSummary.missingScanCount}.`
  );
  assert(
    yesterdayScanSummary.shouldShowMissingScanAlert,
    "Missing scan alert should be enabled during daytime checkpoint."
  );

  console.log("[check-trainingpeaks-attention-digest] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-attention-digest] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
