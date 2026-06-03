import process from "node:process";

import type {
  TrainingPeaksOperationalSignalType,
  UpsertTrainingPeaksOperationalSignalFromCandidateInput,
  UpsertTrainingPeaksOperationalSignalFromCandidateResult,
} from "@/features/trainingpeaks/repository";
import { persistOperationalSignalsForObservation } from "@/features/trainingpeaks/operational-signals-inline";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-inline]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type ConsumeInput = {
  studentId: string;
  signalTypes: TrainingPeaksOperationalSignalType[];
  excludeSignalId?: string | null;
  metadataPatch?: Record<string, unknown>;
};

function makeTestObservation(input: {
  observationId: string;
  studentId: string | null;
  sourceType?: string;
  textPreview: string;
  labels?: string[];
}): Parameters<typeof persistOperationalSignalsForObservation>[0] {
  return {
    observationId: input.observationId,
    studentId: input.studentId,
    sourceType: input.sourceType ?? "business_dm",
    textPreview: input.textPreview,
    labels: input.labels ?? ["pain_or_health"],
    metadata: {},
    observedAt: "2026-06-03T10:00:00.000Z",
    telegramChatId: "10001",
    telegramMessageId: "20001",
    telegramMessageThreadId: null,
  };
}

async function run(): Promise<void> {
  const upsertCalls: UpsertTrainingPeaksOperationalSignalFromCandidateInput[] = [];
  const consumeCalls: ConsumeInput[] = [];
  let nextSignalId = 1;

  const upsertMock = async (
    input: UpsertTrainingPeaksOperationalSignalFromCandidateInput
  ): Promise<UpsertTrainingPeaksOperationalSignalFromCandidateResult> => {
    upsertCalls.push(input);
    return {
      writeStatus: "inserted",
      signal: {
        id: `sig-${nextSignalId++}`,
        studentId: input.studentId,
        signalType: input.signalType,
        status: "active",
        sourceType: input.sourceType,
        sourceObservationId: input.sourceObservationId ?? null,
        telegramChatId: input.telegramChatId ?? null,
        telegramMessageId: input.telegramMessageId ?? null,
        telegramMessageThreadId: input.telegramMessageThreadId ?? null,
        structuredPayload: input.structuredPayload ?? {},
        confidence: input.confidence ?? null,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        sourceDate: input.sourceDate ?? null,
        targetDate: input.targetDate ?? null,
        sourceDay: input.sourceDay ?? null,
        targetDay: input.targetDay ?? null,
        linkedMemoryItemId: input.linkedMemoryItemId ?? null,
        linkedCaseId: input.linkedCaseId ?? null,
        linkedActionId: input.linkedActionId ?? null,
        dedupeKey: input.dedupeKey,
        consumedAt: null,
        metadata: input.metadata ?? {},
        createdAt: "2026-06-03T10:00:00.000Z",
        updatedAt: "2026-06-03T10:00:00.000Z",
      },
    };
  };

  const consumeMock = async (input: ConsumeInput): Promise<number> => {
    consumeCalls.push(input);
    return 1;
  };

  const deps = {
    upsert: upsertMock,
    consume: consumeMock,
  };

  const improvingResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-1",
      studentId: "student-v",
      textPreview: "Сегодня получше, но кашель всё ещё есть",
    }),
    deps
  );
  assert(improvingResult.status === "processed", "A failed: improving observation should be processed.");
  const improvingSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-1");
  assert(Boolean(improvingSignalCall), "A failed: missing upsert call for improving observation.");
  assert(
    improvingSignalCall?.signalType === "health_issue_improving",
    `A failed: expected health_issue_improving, got ${improvingSignalCall?.signalType ?? "null"}.`
  );
  assert(
    typeof improvingSignalCall?.validUntil === "string" && improvingSignalCall.validUntil.length > 0,
    "E failed: improving signal should have default valid_until."
  );
  const improvingConsumeCall = consumeCalls.find((call) => call.studentId === "student-v");
  assert(Boolean(improvingConsumeCall), "B failed: improving should supersede active started signal.");
  assert(
    improvingConsumeCall?.signalTypes.includes("health_issue_started") ?? false,
    "B failed: improving supersession must target health_issue_started."
  );

  const beforeResolveConsumeCalls = consumeCalls.length;
  const resolvedResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-2",
      studentId: "student-v",
      textPreview: "Кашель прошел, выздоровела, без боли",
    }),
    deps
  );
  assert(resolvedResult.status === "processed", "C failed: resolved observation should be processed.");
  const resolvedConsumeCall = consumeCalls[beforeResolveConsumeCalls];
  assert(Boolean(resolvedConsumeCall), "C failed: resolved should trigger health supersession.");
  assert(
    resolvedConsumeCall?.signalTypes.includes("health_issue_started") &&
      resolvedConsumeCall.signalTypes.includes("health_issue_improving"),
    "C failed: resolved supersession must target started+improving."
  );

  const moveResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-3",
      studentId: "student-m",
      textPreview: "Перенеси тренировку с вторника на четверг",
      labels: ["move_workout_candidate"],
    }),
    deps
  );
  assert(moveResult.status === "processed", "F failed: move observation should be processed.");
  const moveSignalCall = upsertCalls.find((call) => call.sourceObservationId === "obs-3");
  assert(Boolean(moveSignalCall), "F failed: missing move upsert call.");
  assert(
    moveSignalCall?.signalType === "move_workout_candidate",
    `F failed: expected move_workout_candidate, got ${moveSignalCall?.signalType ?? "null"}.`
  );
  assert(
    typeof moveSignalCall?.validUntil === "string" && moveSignalCall.validUntil.length > 0,
    "F failed: move signal should get default valid_until."
  );

  const noStudentResult = await persistOperationalSignalsForObservation(
    makeTestObservation({
      observationId: "obs-4",
      studentId: null,
      textPreview: "Сегодня получше, но кашель всё ещё есть",
    }),
    deps
  );
  assert(noStudentResult.status === "skipped", "D failed: missing student should skip processing.");

  const throwingDeps = {
    upsert: async (): Promise<UpsertTrainingPeaksOperationalSignalFromCandidateResult> => {
      throw new Error("synthetic-upsert-failure");
    },
    consume: consumeMock,
  };
  let didThrow = false;
  try {
    await persistOperationalSignalsForObservation(
      makeTestObservation({
        observationId: "obs-5",
        studentId: "student-fail",
        textPreview: "Сегодня получше, но кашель всё ещё есть",
      }),
      throwingDeps
    );
  } catch {
    didThrow = true;
  }
  assert(didThrow, "G failed: inline wrapper should allow caller-level catch on persistence failures.");

  const otherStudentTouches = consumeCalls.filter((call) => call.studentId === "student-other").length;
  assert(otherStudentTouches === 0, "D failed: no supersession should touch other students.");

  console.log(`${LOG_PREFIX} PASS`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(message);
  process.exit(1);
});
