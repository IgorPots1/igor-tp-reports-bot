import process from "node:process";

import {
  MORNING_DIGEST_SECTION_TITLES,
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
    reasonPrefix: string,
    signalKind: TrainingPeaksAttentionSnapshot["checkTodaySignals"][number]["signalKind"]
  ) =>
    Array.from({ length: count }, (_, index) => ({
      level: "today" as const,
      studentName: `${reasonPrefix.toUpperCase()} Athlete ${index + 1}`,
      reason: `${reasonPrefix} ${index + 1}: ${"детали ".repeat(30).trim()}`,
      studentId: `student-${reasonPrefix}-${index + 1}`,
      signalKind,
    }));

  return {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    checkTodaySignals: makeSignals(12, "срочный", "move_failed_action"),
    painDiscomfort: makeSignals(9, "боль", "pain_case"),
    missedWorkouts: makeSignals(15, "пропуск", "missed_workout"),
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
  assert(joined.includes(MORNING_DIGEST_SECTION_TITLES.checkToday), "Check-today section should be present.");
  assert(joined.includes(MORNING_DIGEST_SECTION_TITLES.plan), "Plan section should be present.");
  assert(joined.includes(MORNING_DIGEST_SECTION_TITLES.pain), "Pain section should be present.");
  assert(joined.includes(MORNING_DIGEST_SECTION_TITLES.noContact), "No-contact section should be present.");
  assert(joined.includes(MORNING_DIGEST_SECTION_TITLES.missed), "Missed workout section should be present.");
  assert(!joined.includes("🚨 Срочно"), "Legacy urgent section should be gone.");
  assert(!joined.includes("📌 Сегодня"), "Legacy today section should be gone.");
  assert(!joined.includes("🔁 Переносы"), "Moves should be merged into plan section.");

  assert(joined.includes("FOLLOWUP Athlete 13"), "Check-today section should list follow-up athletes up to the section cap.");
  assert(joined.includes("ПРОПУСК Athlete 15"), "Missed section should list athletes up to the section cap.");
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
