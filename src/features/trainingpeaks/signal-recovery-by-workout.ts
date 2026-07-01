import { RECOVERY_CLOSABLE_SIGNAL_TYPES } from "@/features/trainingpeaks/signal-recovery-bridge";
import type { TrainingPeaksOperationalSignalType } from "@/features/trainingpeaks/repository";

// Recovery-by-workout (fact-driven exit): the message-path recovery bridge (Слой 3) listens to WORDS
// and only fires on the business-DM channel. This path listens to the FACT in the TrainingPeaks cache
// instead — a student who actually ran after falling ill is recovered ("побежал = здоров"), regardless
// of what channel they wrote in or whether they said anything at all. It runs in the attention-digest
// cron so a closed workout is picked up within a day, and reuses the Слой 3 card/callback/close/dedup.
// See ops-log 2026-07-01-1610-signals-3-gaps.

// Illness signals a completed-workout recovery may close. Mirrors the message-path scope on purpose:
// pain_injury is excluded — a clean run does not clear a standing injury, that stays on admin close.
export const RECOVERY_BY_WORKOUT_CLOSABLE_TYPES: readonly TrainingPeaksOperationalSignalType[] =
  RECOVERY_CLOSABLE_SIGNAL_TYPES;

// Igor's threshold: TWO clean completed running workouts after onset (not one) before we ask to close.
// One run can be a fluke ("побежал, но снова слёг"); two is confident evidence the athlete is back.
export const RECOVERY_BY_WORKOUT_MIN_CLEAN_RUNS = 2;

export type WorkoutRecoveryDecisionReason =
  | "threshold_met"
  | "below_threshold"
  | "blocked_by_negative"
  | "on_cooldown";

export type WorkoutRecoveryDecision = {
  shouldPrompt: boolean;
  reason: WorkoutRecoveryDecisionReason;
};

// Pure decision: should the cron offer a "снять сигнал?" card for this student?
// Order matters — a negative health message after the run ("побегал, но опять хуже") is a hard block
// even if the run count is met; then the count gate; then the shared recovery-prompt cooldown.
export function decideWorkoutRecoveryPrompt(input: {
  cleanRunCountAfterOnset: number;
  hasNegativeHealthMessageAfterCompletion: boolean;
  onRecoveryPromptCooldown: boolean;
}): WorkoutRecoveryDecision {
  if (input.hasNegativeHealthMessageAfterCompletion) {
    return { shouldPrompt: false, reason: "blocked_by_negative" };
  }
  if (input.cleanRunCountAfterOnset < RECOVERY_BY_WORKOUT_MIN_CLEAN_RUNS) {
    return { shouldPrompt: false, reason: "below_threshold" };
  }
  if (input.onRecoveryPromptCooldown) {
    return { shouldPrompt: false, reason: "on_cooldown" };
  }
  return { shouldPrompt: true, reason: "threshold_met" };
}

function pluralizeWorkouts(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return "тренировок";
  }
  if (mod10 === 1) {
    return "тренировку";
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return "тренировки";
  }
  return "тренировок";
}

function formatShortDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) {
    return null;
  }
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) {
    return null;
  }
  return `${match[3]}.${match[2]}`;
}

// Coach-facing card text. Fact-first ("выполнил(а) N тренировки после болезни"), no message quoting —
// this path has no message to quote, the evidence is the completed workouts themselves.
export function buildWorkoutRecoveryCardText(input: {
  studentName: string;
  cleanRunCount: number;
  lastRunDate: string | null;
}): string {
  const dateSuffix = formatShortDate(input.lastRunDate)
    ? ` (последняя ${formatShortDate(input.lastRunDate)})`
    : "";
  return (
    `🏃 ${input.studentName} выполнил(а) ${input.cleanRunCount} ${pluralizeWorkouts(input.cleanRunCount)} ` +
    `после болезни${dateSuffix}.\nСнять сигнал болезни?`
  );
}
