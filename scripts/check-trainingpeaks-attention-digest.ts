import process from "node:process";

import {
  ATTENTION_DIGEST_SECTION_LIMITS,
  MORNING_DIGEST_SECTION_TITLES,
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

function emptyMorningDigestSnapshot(
  overrides: Partial<TrainingPeaksAttentionSnapshot> = {}
): TrainingPeaksAttentionSnapshot {
  return {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    checkTodaySignals: [],
    painDiscomfort: [],
    missedWorkouts: [],
    noContact5Days: [],
    followUpToday: [],
    followUpOverflowCount: 0,
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
    ...overrides,
  };
}

function buildSnapshotWithMissedWorkouts(count: number): TrainingPeaksAttentionSnapshot {
  const missedWorkouts = Array.from({ length: count }, (_, index) => ({
    level: "today" as const,
    studentName: `Athlete ${index + 1}`,
    reason: "вчера была беговая тренировка, выполнения не найдено",
    signalKind: "missed_workout" as const,
  }));

  return emptyMorningDigestSnapshot({ missedWorkouts });
}

function buildCaseGroupingSnapshot(): TrainingPeaksAttentionSnapshot {
  return emptyMorningDigestSnapshot({
    painDiscomfort: [
      {
        level: "today",
        studentName: "Elena Titskaia",
        studentId: "student-elena",
        reason: "болит колено после вчерашней тренировки",
        signalKind: "pain_case",
      },
    ],
    planConstraintsToday: [
      {
        level: "today",
        studentName: "Ilya Bogdanov",
        studentId: "student-ilya",
        caseId: "12345678-1234-1234-1234-123456789abc",
        reason: "перенос тренировки требует проверки",
        signalKind: "move_needs_review_case",
      },
    ],
  });
}

function run(): void {
  const snapshot = buildSnapshotWithMissedWorkouts(8);
  const message = formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Утренний обзор TrainingPeaks");
  const missedLines = message
    .split("\n")
    .filter((line) => line.startsWith("• ") && line.includes("Athlete"));

  assert(
    missedLines.length === 8,
    `Expected all 8 missed-workout athletes listed (limit ${ATTENTION_DIGEST_SECTION_LIMITS.missed}), got ${missedLines.length}.`
  );
  assert(!message.includes("+"), 'Digest should not hide missed items behind "+N ещё" for 8 athletes.');
  assert(message.includes(MORNING_DIGEST_SECTION_TITLES.missed), "Missed workout section should be present.");
  assert(!message.split("\n").map((line) => line.trim()).includes("Проверить сегодня"), "Legacy follow-up title should be gone.");
  assert(!message.includes("• Нет"), 'Digest should not include placeholder "• Нет".');

  const chunks = buildTrainingPeaksAttentionDigestMessages(snapshot, "Утренний обзор TrainingPeaks");
  assert(chunks.length >= 1, "Expected at least one digest chunk.");
  assert(
    chunks.every((chunk) => chunk.length <= 3500),
    "Each digest chunk must stay within the 3500 character limit."
  );
  assert(chunks.join("\n").includes("Athlete 8"), "Chunked digest should include the last missed-workout athlete.");

  const groupedSnapshot = buildCaseGroupingSnapshot();
  const groupedMessage = formatTrainingPeaksAttentionSnapshotMessage(groupedSnapshot, "Утренний обзор TrainingPeaks");
  assert(groupedMessage.includes("болит колено"), "Pain case line should keep concrete reason.");
  assert(
    groupedMessage.includes("перенос тренировки требует проверки"),
    "Move-needs-review case should appear in plan section."
  );
  assert(
    !groupedMessage.includes("(case:"),
    "Main attention digest should not render raw case IDs."
  );
  assert(!groupedMessage.includes("вопросы тренеру"), "Question noise must stay out of morning digest.");
  assert(!groupedMessage.includes("самочувствие/боль"), "Generic pain noise must stay out of morning digest.");

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

  const noContactMessage = formatTrainingPeaksAttentionSnapshotMessage(
    emptyMorningDigestSnapshot({
      noContact5Days: [
        { level: "fyi", studentName: "Student A", reason: "", signalKind: "no_contact" },
        { level: "fyi", studentName: "Student B", reason: "", signalKind: "no_contact" },
      ],
    }),
    "Утренний обзор TrainingPeaks"
  );
  assert(noContactMessage.includes(MORNING_DIGEST_SECTION_TITLES.noContact), "No-contact section title should be coach-facing.");
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
