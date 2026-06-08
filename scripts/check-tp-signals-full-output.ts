import process from "node:process";

import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
  formatTrainingPeaksOperationalSignalsForTelegramMultiMessage,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-tp-signals-full-output]";
const TELEGRAM_SAFE_LIMIT = 4000;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  metadata?: Record<string, unknown>;
  structuredPayload?: Record<string, unknown>;
  validFrom?: string | null;
  validUntil?: string | null;
  sourceDate?: string | null;
  targetDate?: string | null;
  episodeKey?: string | null;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  requiresCoachClose?: boolean;
  lifecycleMeta?: Record<string, unknown>;
}): TrainingPeaksStudentOperationalSignal {
  const metadata = { ...(input.metadata ?? {}) };
  if (input.episodeKey) {
    metadata.episode_key = input.episodeKey;
  }
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: input.lifecycleState ?? null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: input.lifecycleMeta ?? {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: input.requiresCoachClose ?? false,
    sourceType: "fixture",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: input.structuredPayload ?? {},
    confidence: null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceDate: input.sourceDate ?? null,
    targetDate: input.targetDate ?? null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `fixture:${input.signalId}`,
    consumedAt: null,
    metadata,
    createdAt: "2026-06-03T08:00:00.000Z",
    updatedAt: "2026-06-03T08:00:00.000Z",
  };
}

function run(): void {
  // --- Test A: Multi-message split when content exceeds limit ---
  const manySignals = Array.from({ length: 50 }, (_, index) =>
    makeSignal({
      signalId: `sig-large-${index + 1}`,
      studentId: `student-large-${index + 1}`,
      signalType: "health_issue_started",
      structuredPayload: {
        latest_summary: `Болеет, температура и слабость, ждём улучшения — наблюдаем ещё несколько дней подряд (пациент ${index + 1})`,
        health_state: "sick",
      },
    })
  );
  const largeSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: manySignals,
    studentNameById: new Map(
      manySignals.map((s) => [s.studentId, `Athlete ${s.studentId.replace("student-large-", "")} Long Name`])
    ),
    asOfDate: "2026-06-08",
    scope: "all",
    limit: 100,
    activeMoveActions: [],
  });
  const messages = formatTrainingPeaksOperationalSignalsForTelegramMultiMessage(largeSnapshot);

  assert(messages.length >= 2, "A1 failed: expected multiple messages for large signal set.");
  assert(
    messages.every((msg) => msg.length <= TELEGRAM_SAFE_LIMIT),
    "A2 failed: every chunk must stay under Telegram safe limit."
  );
  assert(
    !messages.some((msg) => msg.includes("ещё сигналов")),
    "A3 failed: no '+N ещё сигналов' should appear in multi-message output."
  );

  const allAthleteNames = manySignals.map((_, index) => `Athlete ${index + 1} Long Name`);
  const joinedMessages = messages.join("\n");
  const missingAthletes = allAthleteNames.filter((name) => !joinedMessages.includes(name));
  assert(
    missingAthletes.length === 0,
    `A4 failed: all signal items must be preserved across messages. Missing: ${missingAthletes.slice(0, 3).join(", ")}`
  );

  // --- Test B: Single message when content fits ---
  const smallSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: [
      makeSignal({
        signalId: "sig-small-1",
        studentId: "s-small",
        signalType: "health_issue_started",
        structuredPayload: {
          latest_summary: "болеет, температура",
          health_state: "sick",
        },
      }),
    ],
    studentNameById: new Map([["s-small", "Small Athlete"]]),
    asOfDate: "2026-06-08",
    scope: "all",
    limit: 100,
    activeMoveActions: [],
  });
  const smallMessages = formatTrainingPeaksOperationalSignalsForTelegramMultiMessage(smallSnapshot);
  assert(smallMessages.length === 1, "B1 failed: single item should produce single message.");
  assert(smallMessages[0]!.startsWith("📍 Сигналы"), "B2 failed: single message should start with header.");
  assert(!smallMessages[0]!.includes("1/"), "B3 failed: single message should not have numbering.");

  // --- Test C: Message numbering correct ---
  assert(messages[0]!.includes("📍 Сигналы 1/"), "C1 failed: first message should have 1/N numbering.");
  assert(
    messages[messages.length - 1]!.includes(`📍 Сигналы ${messages.length}/${messages.length}`),
    "C2 failed: last message should have N/N numbering."
  );

  // --- Test D: Schedule constraint text not uselessly truncated ---
  const restrictionSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: [
      makeSignal({
        signalId: "sig-restriction-long",
        studentId: "s-restr",
        signalType: "schedule_availability_window",
        validUntil: "2026-06-14",
        structuredPayload: {
          display_summary: "игорь, привет! по поводу тренировок: на следующей неделе во вторник и четверг смогу, в остальные дни занят",
          valid_until: "2026-06-14",
        },
      }),
    ],
    studentNameById: new Map([["s-restr", "Alexander Lavrentyev"]]),
    asOfDate: "2026-06-08",
    scope: "all",
    limit: 100,
    activeMoveActions: [],
  });
  const restrictionText = formatTrainingPeaksOperationalSignalsForTelegram(restrictionSnapshot);
  assert(
    !restrictionText.includes("по поводу трен…") && !restrictionText.includes("по поводу трен..."),
    "D1 failed: restriction text must not be truncated to useless ellipsis."
  );
  assert(
    restrictionText.includes("тренировок") || restrictionText.includes("тренировк"),
    "D2 failed: restriction text must preserve enough context to be useful."
  );

  // --- Test E: Long constraint with date range is readable ---
  const annaConstraintSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: [
      makeSignal({
        signalId: "sig-anna-constraint",
        studentId: "s-anna-c",
        signalType: "schedule_availability_window",
        validUntil: "2026-06-14",
        structuredPayload: {
          display_summary: "на следующей неделе: во вторник и четверг смогу бегать, в среду и пятницу точно нет",
          valid_until: "2026-06-14",
        },
      }),
    ],
    studentNameById: new Map([["s-anna-c", "Anna Denisova"]]),
    asOfDate: "2026-06-08",
    scope: "all",
    limit: 100,
    activeMoveActions: [],
  });
  const annaText = formatTrainingPeaksOperationalSignalsForTelegram(annaConstraintSnapshot);
  assert(
    annaText.includes("на следующей неделе") || annaText.includes("вторник") || annaText.includes("четверг"),
    "E1 failed: constraint must preserve schedule context, not truncate to useless fragment."
  );
  assert(
    !annaText.includes("на следующей неделе: во вторн…"),
    "E2 failed: must not produce useless ellipsis truncation."
  );

  // --- Test F: overflowCount is 0 when no limit is hit ---
  assert(
    largeSnapshot.overflowCount === 0,
    "F1 failed: with limit 100 and 30 signals, overflowCount should be 0."
  );

  console.log(`${LOG_PREFIX} PASS`);
  console.log(`  multi_message_count: ${messages.length}`);
  console.log(`  max_chunk_length: ${Math.max(...messages.map((m) => m.length))}`);
  console.log(`  all_items_preserved: true`);
  console.log(`  schedule_constraint_truncation: no useless ellipsis`);
  console.log(`  hidden_more_count: 0`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
