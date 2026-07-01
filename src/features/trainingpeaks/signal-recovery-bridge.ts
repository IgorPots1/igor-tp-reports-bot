import type { CoachMemoryInsertedItem } from "@/features/trainingpeaks/coach-memory-extraction";
import type {
  TrainingPeaksOperationalSignalType,
  TrainingPeaksStudentMemoryType,
} from "@/features/trainingpeaks/repository";

// Слой 3: the RECOVERY bridge — mirror of the memory→signal (entry) bridge, but on the EXIT side.
// A positive health memory fact ("стало лучше", "побегал", "готов к нагрузке") → offer the coach a
// one-tap confirmation to CLOSE the student's active illness signals. Confirmation-gated on purpose:
// wrongly closing a still-sick athlete is worse than wrongly opening, so entry can be automatic but
// exit asks first (Igor's decision). See ops-log 2026-07-01-1340-signal-lifecycle-close-audit.

// Illness signals a recovery confirmation may close. pain_injury is intentionally excluded — a
// "побегала, стало легче" about illness must not silently clear a standing knee injury; injuries
// close via the Слой 1 admin path.
export const RECOVERY_CLOSABLE_SIGNAL_TYPES: readonly TrainingPeaksOperationalSignalType[] = [
  "health_issue_started",
  "health_issue_improving",
];

// Memory types whose positive polarity can indicate recovery. health_status only in v1 (matches the
// entry bridge's scope; pain/injury recovery is a separate, higher-bar decision).
const RECOVERY_MEMORY_TYPES: ReadonlySet<TrainingPeaksStudentMemoryType> = new Set(["health_status"]);

export type HealthPolarity = "recovery" | "onset" | "ambiguous";

// Recovery-leaning cues. The memory summary is written by Haiku, so it already paraphrases the athlete
// ("готовность к нагрузке восстановилась", "кашель уменьшился"); we only need a light polarity read.
const RECOVERY_CUES: readonly string[] = [
  "выздоров",
  "восстанов",
  "поправил",
  "полегчал",
  "полегче",
  "стало лучше",
  "уже лучше",
  "чувствую себя лучше",
  "самочувствие лучше",
  "самочувствие хорош",
  "прошло",
  "прошла",
  "прошли",
  "отпустило",
  "здоров",
  "в строю",
  "готов к нагруз",
  "готова к нагруз",
  "готовность к нагруз",
  "готов вернут",
  "готова вернут",
  "могу бегать",
  "могу трениров",
  "побегал",
  "сбегал",
  "пробежал",
  "вернулся к трениров",
  "вернулась к трениров",
  "без температур",
  "нет температур",
  "температуры нет",
];

// Symptom / illness cues. Presence of these alone (without a recovery cue) means onset/continuation.
const ONSET_CUES: readonly string[] = [
  "заболел",
  "болею",
  "болеет",
  "болезн",
  "болит",
  "прибол",
  "разбол",
  "температ",
  "слабост",
  "озноб",
  "хуже",
  "плохо себя",
  "недомога",
  "поднялась температ",
];

// Continued-illness / stalled-recovery cues. These OVERRIDE recovery cues: "выздоровление замедлено",
// "болезнь продолжается", "ещё долечиваюсь" all still mean sick even though they contain "выздоров".
const CONTINUED_ILLNESS_CUES: readonly string[] = [
  "замедл",
  "продолжа",
  "долечив",
  "не прош",
  "ещё болею",
  "еще болею",
  "все ещё болею",
  "все еще болею",
  "не лучше",
  "не наступ",
  "плато",
  "застой",
  "не улучша",
];

// Explicit improvement verbs — used to break ties when both recovery and onset cues appear in the same
// summary ("кашель уменьшился, самочувствие хорошее" → recovery; bare symptom mention → onset). Kept
// narrow: no bare "здоров" (it greedily matches the noun "выздоровление", handled by RECOVERY_CUES).
const IMPROVEMENT_TIE_BREAKERS: readonly string[] = [
  "уменьш",
  "меньше",
  "восстанов",
  "готов к нагруз",
  "готова к нагруз",
  "стало лучше",
  "уже лучше",
  "легче",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function hasAny(text: string, cues: readonly string[]): boolean {
  return cues.some((cue) => text.includes(cue));
}

export function detectHealthPolarity(summaryText: string): HealthPolarity {
  const text = normalize(summaryText);

  // Continued-illness phrasing wins outright: "выздоровление замедлено" / "болезнь продолжается" are
  // NOT recovery even though they contain recovery roots.
  if (hasAny(text, CONTINUED_ILLNESS_CUES)) {
    return "onset";
  }

  const recovery = hasAny(text, RECOVERY_CUES);
  const onset = hasAny(text, ONSET_CUES);

  if (recovery && !onset) {
    return "recovery";
  }
  if (recovery && onset) {
    // Both signals present: lean recovery only if an explicit improvement verb is there, else stay
    // ambiguous (the coach only ever sees a card on a clear recovery read).
    return hasAny(text, IMPROVEMENT_TIE_BREAKERS) ? "recovery" : "ambiguous";
  }
  if (onset) {
    return "onset";
  }
  return "ambiguous";
}

export function isRecoveryMemoryType(memoryType: TrainingPeaksStudentMemoryType): boolean {
  return RECOVERY_MEMORY_TYPES.has(memoryType);
}

// Secondary trigger (lightweight proxy for "completed a workout after onset" — the athlete reports
// having run). "Побежал = здоров" per the signal-pattern map. Guarded against negations so
// "не побегала", "так и не побежал" do NOT count. Message-path only; the digest cron remains the home
// for true completed-workout evidence.
const RAN_ACTION_CUES: readonly string[] = [
  "побегал",
  "побежал",
  "сбегал",
  "пробежал",
  "сбегала",
];
const RAN_NEGATION_CUES: readonly string[] = [
  "не побегал",
  "не побежал",
  "не сбегал",
  "не пробежал",
  "не смог",
  "не смогла",
  "так и не",
  "не получилось",
];

export function quoteSignalsResumedActivity(quote: string): boolean {
  const text = normalize(quote);
  if (hasAny(text, RAN_NEGATION_CUES)) {
    return false;
  }
  return hasAny(text, RAN_ACTION_CUES);
}

// Does this freshly-inserted memory item read as a recovery statement?
export function isRecoveryMemoryItem(
  item: Pick<CoachMemoryInsertedItem, "memoryType" | "summaryText">
): boolean {
  return (
    isRecoveryMemoryType(item.memoryType) && detectHealthPolarity(item.summaryText) === "recovery"
  );
}

export type RecoveryConfirmationPlan = {
  studentId: string;
  quote: string;
  recoverySummary: string;
  trigger: "memory_positive" | "resumed_activity";
  closableSignalTypes: TrainingPeaksOperationalSignalType[];
};

// Build a plan iff recovery is recognized AND the student has active closable illness signals.
// Recovery is recognized via (a) a positive health memory fact, or (b) the athlete reporting a run
// (guarded proxy for "trained after onset"). `quote` is the raw athlete message shown in the card.
export function planRecoveryConfirmation(input: {
  studentId: string;
  quote: string;
  insertedItems: Pick<CoachMemoryInsertedItem, "memoryType" | "summaryText">[];
  activeSignalTypes: readonly string[];
}): RecoveryConfirmationPlan | null {
  const recoveryItem = input.insertedItems.find((item) => isRecoveryMemoryItem(item));
  const resumedActivity = quoteSignalsResumedActivity(input.quote);
  if (!recoveryItem && !resumedActivity) {
    return null;
  }
  const closable = RECOVERY_CLOSABLE_SIGNAL_TYPES.filter((type) =>
    input.activeSignalTypes.includes(type)
  );
  if (closable.length === 0) {
    return null;
  }
  return {
    studentId: input.studentId,
    quote: input.quote,
    recoverySummary: recoveryItem?.summaryText ?? input.quote,
    trigger: recoveryItem ? "memory_positive" : "resumed_activity",
    closableSignalTypes: [...closable],
  };
}
