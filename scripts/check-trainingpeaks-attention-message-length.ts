import process from "node:process";

import {
  TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
  buildTrainingPeaksAttentionDigestMessages,
} from "@/features/trainingpeaks/attention-telegram";
import { isTelegramMessageTooLongError } from "@/features/telegram/telegram-client";
import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildLargeSnapshot(): TrainingPeaksAttentionSnapshot {
  const makeSignals = (
    count: number,
    section: "urgent" | "today" | "observe" | "fyi",
    reasonPrefix: string
  ) =>
    Array.from({ length: count }, (_, index) => ({
      level: section === "urgent" ? ("urgent" as const) : ("today" as const),
      studentName: `${section.toUpperCase()} Athlete ${index + 1}`,
      reason: `${reasonPrefix} ${index + 1}: ${"детали ".repeat(30).trim()}`,
      studentId: `student-${section}-${index + 1}`,
      signalKind: "follow_up_due" as const,
    }));

  return {
    urgent: makeSignals(12, "urgent", "срочный сигнал"),
    today: makeSignals(15, "today", "решение сегодня"),
    observe: makeSignals(11, "observe", "наблюдение"),
    fyi: makeSignals(9, "fyi", "контекст"),
    followUpToday: Array.from({ length: 14 }, (_, index) => ({
      level: "today" as const,
      studentName: `FOLLOWUP Athlete ${index + 1}`,
      reason: `проверить сегодня ${index + 1}: ${"follow-up ".repeat(22).trim()}`,
      studentId: `student-follow-up-${index + 1}`,
      signalKind: "operational_follow_up" as const,
    })),
    followUpOverflowCount: 7,
    planConstraintsToday: Array.from({ length: 13 }, (_, index) => ({
      level: "today" as const,
      studentName: `PLAN Athlete ${index + 1}`,
      reason: `учесть в плане ${index + 1}: ${"расписание ".repeat(20).trim()}`,
      studentId: `student-plan-${index + 1}`,
      signalKind: "operational_schedule" as const,
    })),
    planConstraintsOverflowCount: 5,
    movesToday: Array.from({ length: 12 }, (_, index) => ({
      level: "today" as const,
      studentName: `MOVE Athlete ${index + 1}`,
      reason: `перенос ${index + 1}: ${"источник/цель ".repeat(20).trim()}`,
      studentId: `student-move-${index + 1}`,
      signalKind: "operational_move" as const,
    })),
    movesOverflowCount: 4,
    noContact5Days: Array.from({ length: 12 }, (_, index) => ({
      level: "fyi" as const,
      studentName: `SILENT Athlete ${index + 1}`,
      reason: "",
      studentId: `student-silent-${index + 1}`,
      signalKind: "no_contact" as const,
    })),
  };
}

function run(): void {
  const snapshot = buildLargeSnapshot();
  const messages = buildTrainingPeaksAttentionDigestMessages(snapshot, "🌅 Внимание на сегодня");

  assert(messages.length >= 1, "Expected at least one attention chunk.");
  assert(
    messages.every((message) => message.length <= TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT),
    `Every chunk must stay under ${TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT}.`
  );

  const joined = messages.join("\n");
  assert(joined.includes("🚨 Срочно"), "Urgent section should be present.");
  assert(joined.includes("📌 Сегодня"), "Today section should be present.");
  assert(joined.includes("Проверить сегодня"), "Follow-up section should be present.");
  assert(joined.includes("📅 Учесть в плане"), "Plan section should be present.");
  assert(joined.includes("🔁 Переносы"), "Moves section should be present.");
  assert(joined.includes("👀 Наблюдать"), "Observe section should be present.");
  assert(joined.includes("📭 Нет контакта 5+ дней"), "No-contact section should be present.");
  assert(joined.includes("ℹ️ Справочно"), "FYI/misc section should be present.");

  assert(joined.includes("URGENT Athlete 12"), "Urgent section should list athletes up to the section cap.");
  assert(joined.includes("TODAY Athlete 15"), "Today section should list athletes up to the section cap.");
  assert(joined.includes("SILENT Athlete 12"), "No-contact section should list silent students.");

  const overflowMentions = (joined.match(/\+\d+\sещё/g) ?? []).length;
  assert(overflowMentions >= 1, "Expected overflow lines only for sections above explicit caps.");

  assert(
    messages.length >= 2 || joined.length > 2500,
    "Large digest should split across messages or stay safely chunked."
  );

  if (messages.length > 1) {
    assert(
      messages[1]?.includes("продолжение"),
      "Continuation chunks should include a continuation header."
    );
  }

  const tooLongError = new Error(
    'Telegram sendMessage failed (400): {"ok":false,"error_code":400,"description":"Bad Request: message is too long"}'
  );
  assert(isTelegramMessageTooLongError(tooLongError), "message-too-long detector should match Telegram error.");
  assert(!isTelegramMessageTooLongError(new Error("Telegram sendMessage failed (400): chat not found")), "Only message-too-long should match.");

  console.log("[check-trainingpeaks-attention-message-length] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-trainingpeaks-attention-message-length] FAIL");
  console.error((error as Error).message);
  process.exit(1);
}
