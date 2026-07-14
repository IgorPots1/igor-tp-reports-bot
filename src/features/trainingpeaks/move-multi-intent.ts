/**
 * Multi-move detection for TrainingPeaks reschedule requests.
 *
 * The parser can only ever produce ONE move per message (single `source`/`target`, not arrays).
 * When a student asks for two moves in one message ("перенеси лёгкую на завтра, а интервальную на
 * четверг"), the parser silently keeps the first and drops the rest — the action looks like a
 * complete success. This module detects that a message carries MORE than the one move that was
 * parsed, so the coach card and the coach case can say so out loud.
 *
 * The bar is deliberately low: a false "проверь вручную" is cheap, a silently halved request is not.
 *
 * Owns the shared move lexicon (`TP_STRICT_MOVE_VERBS`) so service.ts and this detector cannot drift.
 */

/** Explicit reschedule verbs — substring match on normalized text. Shared with the strict intent gate. */
export const TP_STRICT_MOVE_VERBS = [
  "перенеси",
  "перенести",
  "переставь",
  "переставить",
  "передвинь",
  "сдвинь",
  "перенесем",
  "сместим",
  "можно перенести",
  "перенесите",
  "поставьте",
  "поставить",
  "поставим",
  "сделаю",
  "отработаю",
  "поставь на",
];

/** Verb roots, for COUNTING occurrences (the list above overlaps: "перенеси" ⊂ "перенесите"). */
const MOVE_VERB_ROOT_PATTERN =
  /перенес|перенест|переставь|переставит|передвин|сдвин|смест|поставь|поставит/gu;

export function normalizeMoveDetectText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MOVE_PAIR_SIDE_TOKEN_PATTERN = /^[а-яa-z0-9_-]{2,}$/iu;
const MOVE_PAIR_SIDE_BLOCKED_WORDS = new Set([
  "можешь",
  "можно",
  "сдвинуть",
  "сдвинь",
  "перенести",
  "перенеси",
  "перенесите",
  "поставить",
  "поставь",
  "поставьте",
  "переставить",
  "переставь",
  "сместить",
  "тренировку",
  "тренировки",
]);

function isCompactMovePairSide(raw: string): boolean {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length < 1 || tokens.length > 2) {
    return false;
  }
  return tokens.every(
    (token) => MOVE_PAIR_SIDE_TOKEN_PATTERN.test(token) && !MOVE_PAIR_SIDE_BLOCKED_WORDS.has(token)
  );
}

export function detectMovePairsPreview(rawText: string): Array<{ source: string; target: string }> {
  const normalized = normalizeMoveDetectText(rawText);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const pairs: Array<{ source: string; target: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "на") {
      continue;
    }

    let extracted: { source: string; target: string } | null = null;
    for (const sourceLength of [1, 2]) {
      const sourceStart = index - sourceLength;
      if (sourceStart < 0) {
        continue;
      }
      const source = tokens.slice(sourceStart, index).join(" ").trim();
      if (!isCompactMovePairSide(source)) {
        continue;
      }

      for (const targetLength of [1, 2]) {
        const targetEnd = index + 1 + targetLength;
        if (targetEnd > tokens.length) {
          continue;
        }
        const target = tokens.slice(index + 1, targetEnd).join(" ").trim();
        if (!isCompactMovePairSide(target)) {
          continue;
        }
        extracted = { source, target };
        break;
      }

      if (extracted) {
        break;
      }
    }

    if (extracted) {
      pairs.push(extracted);
    }
  }

  return pairs.slice(0, 3);
}

/**
 * Group-probe multi-move label. Behaviour preserved verbatim from group-probe.ts — the group path
 * only labels a coach case, it never creates actions.
 */
export function detectGroupMoveMultiMove(rawText: string): {
  detected: boolean;
  possible: boolean;
  reason: string | null;
  movePairsPreview: Array<{ source: string; target: string }>;
} {
  const pairs = detectMovePairsPreview(rawText);
  if (pairs.length >= 2) {
    return {
      detected: true,
      possible: true,
      reason: "multiple source-target phrases",
      movePairsPreview: pairs,
    };
  }

  const normalized = normalizeMoveDetectText(rawText);
  const hasConjunctionSplit = /\b(а|и)\b/.test(normalized);
  const naMatches = normalized.match(/\bна\b/g)?.length ?? 0;
  if (hasConjunctionSplit && naMatches >= 2) {
    return {
      detected: false,
      possible: true,
      reason: "multiple source-target phrases",
      movePairsPreview: pairs,
    };
  }

  return {
    detected: false,
    possible: false,
    reason: null,
    movePairsPreview: pairs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unparsed-remainder detection (business DM path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Day references, self-contained on purpose: this module must stay a leaf (service.ts imports it),
 * and this is a warning heuristic, not the parser. Recall matters, precision does not.
 */
const RELATIVE_DAY_PATTERN = /(?:^|\s)(сегодня|завтра|послезавтра)(?=\s|$)/gu;
const WEEKDAY_PATTERN =
  /(?:^|\s)(понедельник\w*|вторник\w*|сред[ауые]\w*|четверг\w*|пятниц[ауые]\w*|суббот[ауые]\w*|воскресень\w*)(?=\s|$)/gu;
const MONTH_DAY_PATTERN =
  /(\d{1,2})\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\w*/gu;
const NUMERIC_DATE_PATTERN = /(?:^|\s)(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)(?=\s|$)/gu;
/** Bare day number, but only when it hangs off "с 30" / "на 29" — the shape of «с 30 на 29». */
const BARE_DAY_AFTER_PREPOSITION_PATTERN = /(?:^|\s)(?:с|на)\s+(\d{1,2})(?=\s|$)/gu;

/** Workout objects, matched as stems. Kept in sync with workout-reference.ts aliases by intent, not by import. */
const WORKOUT_OBJECT_PATTERN =
  /интервальн|интервал|длительн|темпов|восстановительн|легк|трениров|пробежк|заняти/u;

/**
 * A day hanging off «на …» / «с …» — the shape of an instruction («а интервальную НА ЧЕТВЕРГ»),
 * as opposed to a day merely mentioned in passing («а то я СЕГОДНЯ не успеваю», which is an excuse).
 * Without this distinction every trailing «а то…» would raise a false warning.
 */
const PREPOSITION_LED_DAY_PATTERN =
  /(?:^|\s)(?:на|с|со)\s+(?:сегодня|завтра|послезавтра|понедельник\w*|вторник\w*|сред[ауые]\w*|четверг\w*|пятниц[ауые]\w*|суббот[ауые]\w*|воскресень\w*|\d{1,2})(?=\s|$)/u;

function collectDayReferences(normalized: string): string[] {
  const found = new Set<string>();
  for (const pattern of [
    RELATIVE_DAY_PATTERN,
    WEEKDAY_PATTERN,
    MONTH_DAY_PATTERN,
    NUMERIC_DATE_PATTERN,
    BARE_DAY_AFTER_PREPOSITION_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).trim();
      if (value) {
        found.add(value);
      }
    }
  }
  return [...found];
}

function countMoveVerbs(normalized: string): number {
  MOVE_VERB_ROOT_PATTERN.lastIndex = 0;
  return normalized.match(MOVE_VERB_ROOT_PATTERN)?.length ?? 0;
}

export type MoveRemainderDetection = {
  suspected: boolean;
  /** Machine-readable signal that fired. */
  reason: string | null;
  /** The part of the message that looks like a second instruction — shown to the coach verbatim. */
  remainderPreview: string | null;
};

const NOT_SUSPECTED: MoveRemainderDetection = {
  suspected: false,
  reason: null,
  remainderPreview: null,
};

function previewOf(value: string, limit = 120): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

/**
 * Does this message ask for MORE than the single move we parsed?
 *
 * `parsed` is structural on purpose (no import from service.ts — that would be a cycle).
 */
export function detectUnparsedMoveRemainder(input: {
  rawText: string;
  parsed?: {
    source?: { sourceText?: string | null } | null;
    target?: { sourceText?: string | null } | null;
  } | null;
}): MoveRemainderDetection {
  const normalized = normalizeMoveDetectText(input.rawText);
  if (!normalized) {
    return NOT_SUSPECTED;
  }

  // A. Two or more explicit «X на Y» pairs — «с 30 на 29 и с 2 на 1».
  const pairs = detectMovePairsPreview(input.rawText);
  if (pairs.length >= 2) {
    return {
      suspected: true,
      reason: "multiple_move_pairs",
      remainderPreview: previewOf(pairs.map((pair) => `${pair.source} → ${pair.target}`).join("; ")),
    };
  }

  // B. Contrastive «а …», where BOTH halves read like instructions (each carries a day or an object).
  //    «…лёгкую тренировку сегодня на завтра, А ИНТЕРВАЛЬНУЮ НА ЧЕТВЕРГ» — the case that shipped half.
  //    Every «а» is tried, not just the first: the contrastive one is rarely the first («а можно…»).
  for (const split of normalized.matchAll(/(?:^|\s)а(?:\s+(?:еще|также))?\s+/gu)) {
    const splitIndex = split.index ?? 0;
    const head = normalized.slice(0, splitIndex);
    const tail = normalized.slice(splitIndex + split[0].length);
    if (!tail) {
      continue;
    }
    const headHasDay = collectDayReferences(head).length > 0;
    // The tail must read like an INSTRUCTION, not merely mention a day.
    const tailLooksLikeInstruction =
      WORKOUT_OBJECT_PATTERN.test(tail) || PREPOSITION_LED_DAY_PATTERN.test(tail);
    if (headHasDay && tailLooksLikeInstruction) {
      return {
        suspected: true,
        reason: "contrastive_second_instruction",
        remainderPreview: previewOf(tail),
      };
    }
  }

  // C. Two or more reschedule verbs — two instructions spelled out in full.
  if (countMoveVerbs(normalized) >= 2) {
    return {
      suspected: true,
      reason: "multiple_move_verbs",
      remainderPreview: previewOf(normalized),
    };
  }

  // D. More day references than one move can consume. A single move spends at most two (source+target).
  const dayReferences = collectDayReferences(normalized);
  const captured = [input.parsed?.source?.sourceText, input.parsed?.target?.sourceText]
    .filter((value): value is string => Boolean(value && value.trim()))
    .length;
  if (dayReferences.length >= 3 && dayReferences.length > captured) {
    return {
      suspected: true,
      reason: "too_many_day_references",
      remainderPreview: previewOf(dayReferences.join(", ")),
    };
  }

  return NOT_SUSPECTED;
}
