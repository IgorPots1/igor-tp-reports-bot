import process from "node:process";

import {
  buildWorkoutRecoveryCardText,
  decideWorkoutRecoveryPrompt,
  RECOVERY_BY_WORKOUT_MIN_CLEAN_RUNS,
} from "@/features/trainingpeaks/signal-recovery-by-workout";

const LOG_PREFIX = "[check-signal-recovery-by-workout]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  // Threshold is 2 (Igor's decision): one clean run is not enough.
  assert(RECOVERY_BY_WORKOUT_MIN_CLEAN_RUNS === 2, "threshold must be 2 clean runs");

  // 2 clean runs, no negative, no cooldown → prompt.
  const twoRuns = decideWorkoutRecoveryPrompt({
    cleanRunCountAfterOnset: 2,
    hasNegativeHealthMessageAfterCompletion: false,
    onRecoveryPromptCooldown: false,
  });
  assert(twoRuns.shouldPrompt && twoRuns.reason === "threshold_met", "2 clean runs → prompt");

  // 1 clean run → below threshold, no prompt.
  const oneRun = decideWorkoutRecoveryPrompt({
    cleanRunCountAfterOnset: 1,
    hasNegativeHealthMessageAfterCompletion: false,
    onRecoveryPromptCooldown: false,
  });
  assert(!oneRun.shouldPrompt && oneRun.reason === "below_threshold", "1 clean run → no prompt");

  // 0 clean runs → below threshold.
  assert(
    decideWorkoutRecoveryPrompt({
      cleanRunCountAfterOnset: 0,
      hasNegativeHealthMessageAfterCompletion: false,
      onRecoveryPromptCooldown: false,
    }).reason === "below_threshold",
    "0 clean runs → below_threshold"
  );

  // 2 clean runs BUT negative health message after the run ("побегал, потом опять слёг") → hard block.
  const ranThenSick = decideWorkoutRecoveryPrompt({
    cleanRunCountAfterOnset: 2,
    hasNegativeHealthMessageAfterCompletion: true,
    onRecoveryPromptCooldown: false,
  });
  assert(
    !ranThenSick.shouldPrompt && ranThenSick.reason === "blocked_by_negative",
    "ran then got worse → blocked_by_negative (even at threshold)"
  );

  // Negative guard beats even a 3+ run count.
  assert(
    decideWorkoutRecoveryPrompt({
      cleanRunCountAfterOnset: 5,
      hasNegativeHealthMessageAfterCompletion: true,
      onRecoveryPromptCooldown: false,
    }).reason === "blocked_by_negative",
    "negative wins over high run count"
  );

  // 2 clean runs but already prompted recently (dedup with the message path) → on cooldown, no prompt.
  const onCooldown = decideWorkoutRecoveryPrompt({
    cleanRunCountAfterOnset: 2,
    hasNegativeHealthMessageAfterCompletion: false,
    onRecoveryPromptCooldown: true,
  });
  assert(
    !onCooldown.shouldPrompt && onCooldown.reason === "on_cooldown",
    "already prompted → on_cooldown (no duplicate card vs message path)"
  );

  // Card text is fact-first, names the student, count, and asks to close.
  const card = buildWorkoutRecoveryCardText({
    studentName: "ILYA",
    cleanRunCount: 2,
    lastRunDate: "2026-06-30",
  });
  assert(card.includes("ILYA"), "card names the student");
  assert(card.includes("2 тренировки"), "card states the run count with correct plural");
  assert(card.includes("после болезни"), "card frames it as after-illness");
  assert(card.includes("30.06"), "card shows last run date DD.MM");
  assert(card.includes("Снять сигнал болезни?"), "card asks to close");

  // Plural edge: 5 → тренировок; no date → no suffix.
  const cardFive = buildWorkoutRecoveryCardText({ studentName: "Аня", cleanRunCount: 5, lastRunDate: null });
  assert(cardFive.includes("5 тренировок"), "5 → тренировок");
  assert(!cardFive.includes("последняя"), "no date → no last-run suffix");

  console.log(`${LOG_PREFIX} PASS`);
}

if (process.argv[1] && process.argv[1].endsWith("check-signal-recovery-by-workout.ts")) {
  try {
    run();
  } catch (error) {
    console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
