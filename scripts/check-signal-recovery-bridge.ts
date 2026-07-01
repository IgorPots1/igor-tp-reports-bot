import process from "node:process";

import {
  detectHealthPolarity,
  isRecoveryMemoryItem,
  planRecoveryConfirmation,
  quoteSignalsResumedActivity,
} from "@/features/trainingpeaks/signal-recovery-bridge";

const LOG_PREFIX = "[check-signal-recovery-bridge]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  // Polarity — real cases from the Anna / ILYA audit.
  assert(
    detectHealthPolarity("кашель значительно уменьшился после бега, готовность к нагрузке восстановилась") ===
      "recovery",
    "clear recovery memory should read as recovery"
  );
  assert(
    detectHealthPolarity("Вчера была температура 37,5, слабость") === "onset",
    "temperature/weakness should read as onset"
  );
  assert(
    detectHealthPolarity("болезнь продолжается, выздоровление замедлено") === "onset",
    "stalled recovery must NOT be treated as recovery (contains 'выздоров' but still sick)"
  );
  assert(
    detectHealthPolarity("Попыталась выполнить интервалы, ощутила тяжесть") === "ambiguous",
    "ran-but-hard should stay ambiguous (no clean recovery claim)"
  );

  // Recovery memory item gate — only health_status + recovery polarity qualifies.
  assert(
    isRecoveryMemoryItem({ memoryType: "health_status", summaryText: "уже здорова, в строю" }),
    "positive health_status is a recovery item"
  );
  assert(
    !isRecoveryMemoryItem({ memoryType: "emotional_state", summaryText: "готов вернуться" }),
    "non-health_status is not a recovery item"
  );
  assert(
    !isRecoveryMemoryItem({ memoryType: "health_status", summaryText: "температура, слабость" }),
    "onset health_status is not a recovery item"
  );

  // Resumed-activity quote proxy, with negation guard.
  assert(quoteSignalsResumedActivity("Игорь, сорри Но я побегала 🫣"), "'побегала' signals resumed activity");
  assert(!quoteSignalsResumedActivity("так и не побегала, всё ещё плохо"), "negated run must not count");
  assert(!quoteSignalsResumedActivity("не смогла побежать"), "negated run (не смогла) must not count");

  // Plan — memory-positive trigger with an active illness signal.
  const memoryPlan = planRecoveryConfirmation({
    studentId: "ilya",
    quote: "Сбегал сегодня, кашля меньше, всё прошло хорошо",
    insertedItems: [{ memoryType: "health_status", summaryText: "готовность к нагрузке восстановилась" }],
    activeSignalTypes: ["health_issue_started", "move_workout_candidate"],
  });
  assert(memoryPlan !== null, "memory-positive + active illness → plan");
  assert(memoryPlan?.trigger === "memory_positive", "trigger should be memory_positive");
  assert(
    memoryPlan?.closableSignalTypes.join(",") === "health_issue_started",
    "only illness signal types are closable (move_workout_candidate excluded)"
  );

  // Plan — resumed-activity trigger even when memory is ambiguous (Anna).
  const annaPlan = planRecoveryConfirmation({
    studentId: "anna",
    quote: "Игорь, сорри Но я побегала 🫣",
    insertedItems: [{ memoryType: "health_status", summaryText: "Попыталась интервалы, тяжесть" }],
    activeSignalTypes: ["health_issue_started"],
  });
  assert(annaPlan !== null, "resumed-activity + active illness → plan (Anna)");
  assert(annaPlan?.trigger === "resumed_activity", "Anna trigger should be resumed_activity");

  // No active illness signal → no plan.
  assert(
    planRecoveryConfirmation({
      studentId: "x",
      quote: "уже здорова",
      insertedItems: [{ memoryType: "health_status", summaryText: "уже здорова, в строю" }],
      activeSignalTypes: ["move_workout_candidate"],
    }) === null,
    "recovery with no active illness signal → no plan"
  );

  // Onset only → no plan.
  assert(
    planRecoveryConfirmation({
      studentId: "y",
      quote: "температура 37,5, не побегу",
      insertedItems: [{ memoryType: "health_status", summaryText: "температура, слабость" }],
      activeSignalTypes: ["health_issue_started"],
    }) === null,
    "onset message → no plan"
  );

  console.log(`${LOG_PREFIX} PASS`);
}

if (process.argv[1] && process.argv[1].endsWith("check-signal-recovery-bridge.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
