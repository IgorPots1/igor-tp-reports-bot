import process from "node:process";

import {
  buildTrainingPeaksAttentionDigestMessages,
  formatTrainingPeaksAttentionSnapshotMessage,
} from "@/features/trainingpeaks/attention-telegram";
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

  console.log("[check-trainingpeaks-attention-digest] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-attention-digest] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
