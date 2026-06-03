import process from "node:process";

import { classifyCoachOperationalSignal } from "@/features/trainingpeaks/coach-operational-signals";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksAction, TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-health-move]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeObservation(textPreview: string) {
  return {
    sourceType: "private_dm" as const,
    textPreview,
    labels: ["pain_or_health"],
    metadata: {},
    observedAt: "2026-06-03T10:00:00.000Z",
    studentId: "student-1",
  };
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  structuredPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sourceDate?: string | null;
  targetDate?: string | null;
  validUntil?: string | null;
  linkedActionId?: string | null;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    sourceType: "fixture",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: input.structuredPayload ?? {},
    confidence: null,
    validFrom: null,
    validUntil: input.validUntil ?? null,
    sourceDate: input.sourceDate ?? null,
    targetDate: input.targetDate ?? null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: input.linkedActionId ?? null,
    dedupeKey: `fixture:${input.signalId}`,
    consumedAt: null,
    metadata: input.metadata ?? {},
    createdAt: "2026-06-03T08:00:00.000Z",
    updatedAt: "2026-06-03T08:00:00.000Z",
  };
}

function makeMoveAction(input: {
  id: string;
  studentId: string;
  status: "pending_coach" | "approved" | "rejected";
  executionStatus: TrainingPeaksAction["executionStatus"];
  sourceDate: string;
  targetDate: string;
}): TrainingPeaksAction {
  return {
    id: input.id,
    studentId: input.studentId,
    actionType: "move_workout",
    status: input.status,
    sourceChatId: "chat-1",
    sourceMessageId: "msg-1",
    sourceUserId: null,
    rawText: "fixture",
    parsedPayload: {
      sourceDate: input.sourceDate,
      target: { kind: "date", value: input.targetDate },
    },
    confidence: null,
    coachChatId: null,
    approvedAt: null,
    rejectedAt: null,
    decidedByChatId: null,
    decidedByUserId: null,
    decisionMessageId: null,
    executionStatus: input.executionStatus,
    executionMode: null,
    claimedBy: null,
    claimedAt: null,
    lastRunId: null,
    executionRequestedAt: null,
    executionRequestedByChatId: null,
    executionRequestedByUserId: null,
    executionRequestMessageId: null,
    cancelledAt: null,
    cancelledByChatId: null,
    cancelledByUserId: null,
    cancelMessageId: null,
    createdAt: "2026-06-03T09:00:00.000Z",
    updatedAt: "2026-06-03T09:00:00.000Z",
  };
}

function run(): void {
  const fever = classifyCoachOperationalSignal(makeObservation("Нет, заболела. Температура с понедельника."));
  assert(fever.signal_type === "health_issue_started", "1 failed: fever message should classify as health_issue_started.");
  assert(fever.structured_payload.health_state === "sick", "1 failed: fever message should set health_state=sick.");
  assert(
    fever.structured_payload.training_recommendation === "pause",
    "1 failed: fever message should recommend pause."
  );
  assert(
    fever.structured_payload.latest_summary?.includes("температура"),
    "1 failed: fever message should produce useful summary."
  );

  const viktoria = classifyCoachOperationalSignal(
    makeObservation("Сегодня получше, но кашель всё ещё есть. Голос немного вернулся. Если завтра кашля не будет, хочу вечером выйти на пробежку.")
  );
  assert(
    viktoria.signal_type === "health_issue_improving",
    "2 failed: Viktoria-like message should classify as health_issue_improving."
  );
  assert(
    viktoria.structured_payload.health_state === "improving",
    "2 failed: Viktoria-like message should set health_state=improving."
  );
  assert(
    Array.isArray(viktoria.structured_payload.symptoms) &&
      viktoria.structured_payload.symptoms.includes("cough") &&
      viktoria.structured_payload.symptoms.includes("voice"),
    "2 failed: Viktoria-like message should capture cough and voice symptoms."
  );
  assert(
    viktoria.structured_payload.latest_summary?.includes("кашель ещё есть") &&
      viktoria.structured_payload.latest_summary?.includes("голос частично вернулся") &&
      viktoria.structured_payload.latest_summary?.includes("хочет пробежку завтра вечером"),
    "2 failed: Viktoria-like summary should keep practical coaching note."
  );

  const restTwoDays = classifyCoachOperationalSignal(
    makeObservation("Еще плюс-минус болею, но уже более менее. Думаю пару дней может отлежусь.")
  );
  assert(
    restTwoDays.signal_type === "health_issue_improving",
    "3 failed: still-sick-rest message should classify as health_issue_improving."
  );
  assert(
    restTwoDays.structured_payload.latest_summary?.includes("отлежаться пару дней"),
    "3 failed: still-sick-rest message should keep rest plan in summary."
  );

  const signals: TrainingPeaksStudentOperationalSignal[] = [
    makeSignal({
      signalId: "health-vika",
      studentId: "student-vika",
      signalType: "health_issue_improving",
      structuredPayload: {
        health_state: "improving",
        symptoms: ["cough", "voice"],
        training_recommendation: "easy_if_symptom_free",
        latest_summary:
          "восстанавливается, кашель ещё есть; голос частично вернулся; хочет пробежку завтра вечером, если кашля не будет",
      },
      metadata: {
        episode_key: "health-1",
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-04T09:00:00.000Z",
        follow_up_reason:
          "восстанавливается, кашель ещё есть; голос частично вернулся; хочет пробежку завтра вечером, если кашля не будет",
      },
      validUntil: "2026-06-06",
    }),
    makeSignal({
      signalId: "move-hidden",
      studentId: "student-ilya",
      signalType: "move_workout_candidate",
      sourceDate: "2026-06-05",
      targetDate: "2026-06-04",
      validUntil: "2026-06-06",
    }),
    makeSignal({
      signalId: "move-visible",
      studentId: "student-active-move",
      signalType: "move_workout_candidate",
      sourceDate: "2026-06-07",
      targetDate: "2026-06-06",
      validUntil: "2026-06-08",
    }),
  ];

  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById: new Map([
      ["student-vika", "Viktoria Sergeeva"],
      ["student-ilya", "Ilya Bogdanov"],
      ["student-active-move", "Active Move Athlete"],
    ]),
    asOfDate: "2026-06-03",
    limit: 20,
    activeMoveActions: [
      makeMoveAction({
        id: "action-1",
        studentId: "student-active-move",
        status: "pending_coach",
        executionStatus: "not_started",
        sourceDate: "2026-06-07",
        targetDate: "2026-06-06",
      }),
    ],
  });
  const text = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);

  assert(
    text.includes("Viktoria Sergeeva") &&
      text.includes("кашель ещё есть") &&
      text.includes("хочет пробежку завтра вечером"),
    "4 failed: health display should show useful Viktoria-style coaching summary."
  );
  assert(
    !text.includes("Ilya Bogdanov"),
    "5 failed: stale move signal without active action should be hidden from /tp_signals."
  );
  assert(
    text.includes("Active Move Athlete") && text.includes("07.06") && text.includes("06.06"),
    "6 failed: move signal with active related action should remain visible."
  );

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
