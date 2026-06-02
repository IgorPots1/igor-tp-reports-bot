import process from "node:process";

import {
  ATTENTION_DIGEST_SECTION_LIMITS,
  buildTrainingPeaksAttentionDigestMessages,
  formatTrainingPeaksAttentionSnapshotMessage,
} from "@/features/trainingpeaks/attention-telegram";
import { formatRussianCountedNoun, summarizeYesterdayScanAttention } from "@/features/trainingpeaks/service";
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
    noContact5Days: [],
    followUpToday: [],
    followUpOverflowCount: 0,
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
  };
}

function buildCaseGroupingSnapshot(): TrainingPeaksAttentionSnapshot {
  return {
    urgent: [
      {
        level: "urgent",
        studentName: "Elena Titskaia",
        studentId: "student-elena",
        reason: "самочувствие/боль: 2 сигнала за 48ч",
        signalKind: "pain_case",
      },
    ],
    today: [
      {
        level: "today",
        studentName: "Elena Titskaia",
        studentId: "student-elena",
        reason: "вопросы тренеру: 4 за 24ч",
        signalKind: "question_case",
      },
      {
        level: "today",
        studentName: "Ilya Bogdanov",
        studentId: "student-ilya",
        caseId: "12345678-1234-1234-1234-123456789abc",
        reason: "перенос тренировки требует проверки",
        signalKind: "move_needs_review_case",
      },
    ],
    observe: [],
    fyi: [],
    noContact5Days: [],
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

  assert(
    todayLines.length === 8,
    `Expected all 8 today athletes listed (limit ${ATTENTION_DIGEST_SECTION_LIMITS.today}), got ${todayLines.length}.`
  );
  assert(!message.includes("+"), 'Digest should not hide today items behind "+N ещё" for 8 athletes.');

  const chunks = buildTrainingPeaksAttentionDigestMessages(snapshot, "Утренний обзор TrainingPeaks");
  assert(chunks.length >= 1, "Expected at least one digest chunk.");
  assert(
    chunks.every((chunk) => chunk.length <= 3500),
    "Each digest chunk must stay within the 3500 character limit."
  );
  assert(chunks.join("\n").includes("Athlete 8"), "Chunked digest should include the last today athlete.");
  assert(!message.includes("Проверить сегодня"), "Empty follow-up section should be omitted.");
  assert(!message.includes("• Нет"), 'Digest should not include placeholder "• Нет".');

  const groupedSnapshot = buildCaseGroupingSnapshot();
  const groupedMessage = formatTrainingPeaksAttentionSnapshotMessage(groupedSnapshot, "Утренний обзор TrainingPeaks");
  assert(
    groupedMessage.includes("самочувствие/боль: 2 сигнала за 48ч"),
    "Grouped pain case line should be rendered."
  );
  assert(
    groupedMessage.includes("вопросы тренеру: 4 за 24ч"),
    "Grouped question case line should be rendered."
  );
  assert(
    !groupedMessage.includes("(case:"),
    "Main attention digest should not render raw case IDs."
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

  assert(
    formatRussianCountedNoun(1, ["ученик", "ученика", "учеников"]) === "ученик",
    "Russian student count noun: 1."
  );
  assert(
    formatRussianCountedNoun(2, ["ученик", "ученика", "учеников"]) === "ученика",
    "Russian student count noun: 2."
  );
  assert(
    formatRussianCountedNoun(5, ["ученик", "ученика", "учеников"]) === "учеников",
    "Russian student count noun: 5."
  );
  assert(
    formatRussianCountedNoun(103, ["ученик", "ученика", "учеников"]) === "ученика",
    "Russian student count noun: 103."
  );

  const noContactSnapshot: TrainingPeaksAttentionSnapshot = {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    noContact5Days: [
      { level: "fyi", studentName: "Student A", reason: "", signalKind: "no_contact" },
      { level: "fyi", studentName: "Student B", reason: "", signalKind: "no_contact" },
    ],
    followUpToday: [],
    followUpOverflowCount: 0,
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
  };
  const noContactMessage = formatTrainingPeaksAttentionSnapshotMessage(
    noContactSnapshot,
    "Утренний обзор TrainingPeaks"
  );
  assert(noContactMessage.includes("📭 Нет контакта 5+ дней"), "No-contact section title should be coach-facing.");
  assert(noContactMessage.includes("• Student A"), "No-contact section should list student names.");
  assert(noContactMessage.includes("• Student B"), "No-contact section should list all silent students.");
  assert(!noContactMessage.includes("Без активности"), "Legacy no-activity label should be gone.");

  console.log("[check-trainingpeaks-attention-digest] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-attention-digest] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
