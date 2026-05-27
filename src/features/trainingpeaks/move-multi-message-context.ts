/**
 * Multi-message TrainingPeaks move-intent context assembly.
 *
 * Pure helper that supports the safety-critical case where an athlete sends a
 * reschedule request as a burst of separate Telegram bubbles (e.g. workout +
 * day context messages followed by a bare verb like "Перенеси пожалуйста").
 *
 * Safety contract:
 *  - This helper does NOT weaken or replace the existing strict move-workout
 *    intent gate.
 *  - It is only intended to be invoked when the single-message parse already
 *    failed with `not_explicit_move_request` and the trigger message still
 *    contains an explicit move verb.
 *  - The caller is responsible for re-running the strict parser on the
 *    assembled text. The helper itself never decides whether an action is
 *    safe to create.
 *  - The helper is pure: no DB access, no mutation, no I/O.
 */

export type TrainingPeaksMoveIntentContextMessageInput = {
  textPreview: string;
  messageId?: string | number | null;
  observedAt?: string | null;
  labels?: readonly string[] | null;
};

export type AssembleTrainingPeaksMoveIntentContextInput = {
  triggerText: string;
  triggerMessageId?: string | number | null;
  recentMessages: readonly TrainingPeaksMoveIntentContextMessageInput[];
};

export type AssembledTrainingPeaksMoveIntentContext = {
  assembledText: string;
  contextPreviews: string[];
  contextMessageIds: Array<string | number>;
};

const RELEVANT_LABELS = new Set<string>([
  "schedule_context",
  "report_like",
  "move_workout_candidate",
]);

/**
 * Substring needles for workout references that should be considered useful
 * when assembling a multi-message context. Kept intentionally narrow.
 */
const WORKOUT_KEYWORDS = [
  "интервал",
  "тренировк",
  "тренировку",
  "пробежк",
  "длительн",
  "длинн",
  "темпов",
  "лонг",
  " бег ",
  "забег",
  "разминк",
  "восстанов",
  "темп",
];

/**
 * Substring needles for time/day hints that often anchor a move request.
 */
const RELATIVE_DAY_HINTS = [
  "сегодня",
  "сегодняшн",
  "вчера",
  "вчерашн",
  "завтра",
  "завтрашн",
  "послезавтра",
];

/**
 * Strict move verbs — kept in sync with the service-level strict gate but
 * intentionally local so this module remains dependency-light.
 */
const STRICT_MOVE_VERBS = [
  "перенеси",
  "перенести",
  "перенесите",
  "переставь",
  "переставить",
  "передвинь",
  "сдвинь",
  "перенесем",
  "сместим",
];

/**
 * Noise/ack patterns that should never contribute to the assembled context
 * even when they appear in the same burst.
 */
const NOISE_ACK_PATTERNS: RegExp[] = [
  /^привет[!.?]*$/,
  /^здравствуй(?:те)?[!.?]*$/,
  /^добр(?:ое утро|ый день|ый вечер)[!.?]*$/,
  /^ок[!.?]*$/,
  /^окей[!.?]*$/,
  /^спасибо[!.?]*$/,
  /^спс[!.?]*$/,
  /^thanks[!.?]*$/i,
  /^thank you[!.?]*$/i,
  /^done[!.?]*$/i,
  /^понял[аи]?[!.?]*$/,
  /^принято[!.?]*$/,
  /^[👍👌🙏]+$/u,
];

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function hasStrictMoveVerbInternal(value: string): boolean {
  const normalized = normalize(value);
  if (!normalized) {
    return false;
  }
  return STRICT_MOVE_VERBS.some((verb) => normalized.includes(verb));
}

function isNoiseOrAck(normalized: string): boolean {
  if (!normalized) {
    return true;
  }
  return NOISE_ACK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasWorkoutOrDayHint(normalized: string): boolean {
  if (!normalized) {
    return false;
  }
  // Pad with spaces to allow word-boundary-ish needles like " бег ".
  const padded = ` ${normalized} `;
  if (WORKOUT_KEYWORDS.some((kw) => padded.includes(kw))) {
    return true;
  }
  return RELATIVE_DAY_HINTS.some((kw) => normalized.includes(kw));
}

function isRelevantContextMessage(
  message: TrainingPeaksMoveIntentContextMessageInput
): boolean {
  const raw = (message.textPreview ?? "").trim();
  if (!raw) {
    return false;
  }
  const normalized = normalize(raw);
  if (isNoiseOrAck(normalized)) {
    return false;
  }
  const labels = message.labels ?? [];
  if (labels.some((label) => RELEVANT_LABELS.has(label))) {
    return true;
  }
  return hasWorkoutOrDayHint(normalized);
}

/**
 * Returns true if the standalone text contains a strict move verb. Exported
 * for callers that need a lightweight precondition check before invoking the
 * full assembly path.
 */
export function triggerHasStrictMoveVerb(value: string): boolean {
  return hasStrictMoveVerbInternal(value);
}

export function assembleTrainingPeaksMoveIntentContext(
  input: AssembleTrainingPeaksMoveIntentContextInput
): AssembledTrainingPeaksMoveIntentContext | null {
  const triggerText = input.triggerText.trim();
  if (!triggerText) {
    return null;
  }
  if (!hasStrictMoveVerbInternal(triggerText)) {
    return null;
  }

  const recent = input.recentMessages ?? [];
  const seenPreviews = new Set<string>();
  const selected: TrainingPeaksMoveIntentContextMessageInput[] = [];

  for (const message of recent) {
    if (
      input.triggerMessageId !== undefined &&
      input.triggerMessageId !== null &&
      message.messageId !== undefined &&
      message.messageId !== null &&
      String(message.messageId) === String(input.triggerMessageId)
    ) {
      continue;
    }
    if (!isRelevantContextMessage(message)) {
      continue;
    }
    const previewKey = (message.textPreview ?? "").trim();
    if (!previewKey || seenPreviews.has(previewKey)) {
      continue;
    }
    seenPreviews.add(previewKey);
    selected.push(message);
  }

  if (selected.length === 0) {
    return null;
  }

  const ordered = [...selected].sort((a, b) => {
    const aT = a.observedAt ? Date.parse(a.observedAt) : 0;
    const bT = b.observedAt ? Date.parse(b.observedAt) : 0;
    if (Number.isNaN(aT) || Number.isNaN(bT)) {
      return 0;
    }
    return aT - bT;
  });

  const previews = ordered
    .map((m) => (m.textPreview ?? "").trim())
    .filter((preview) => preview.length > 0);

  if (previews.length === 0) {
    return null;
  }

  const assembledText = [...previews, triggerText].join("\n");
  const contextMessageIds = ordered
    .map((m) => m.messageId)
    .filter((id): id is string | number => id !== undefined && id !== null);

  return {
    assembledText,
    contextPreviews: previews,
    contextMessageIds,
  };
}
