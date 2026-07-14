export type WorkoutReferenceKind = "long_run" | "workout" | "intervals" | "tempo" | "unknown";

export type NormalizeWorkoutReferenceResult = {
  kind: WorkoutReferenceKind;
  matchedAlias: string | null;
  confidence: "high" | "medium" | "low";
};

type WorkoutAliasRule = {
  kind: WorkoutReferenceKind;
  alias: string;
  confidence: "high" | "medium" | "low";
  /** When true, alias is matched as a substring stem (Russian inflections). */
  stem?: boolean;
};

const WORKOUT_ALIAS_RULES: WorkoutAliasRule[] = [
  { kind: "long_run", alias: "длительная тренировка", confidence: "high" },
  { kind: "long_run", alias: "длительный бег", confidence: "high" },
  { kind: "long_run", alias: "long run", confidence: "high" },
  { kind: "long_run", alias: "лонгран", confidence: "high" },
  { kind: "long_run", alias: "длительн", confidence: "high", stem: true },
  { kind: "long_run", alias: "длинн", confidence: "high", stem: true },
  { kind: "long_run", alias: "долгая", confidence: "high" },
  { kind: "long_run", alias: "долгий", confidence: "high" },
  { kind: "long_run", alias: "долгую", confidence: "high" },
  { kind: "long_run", alias: "лонг", confidence: "high" },
  { kind: "long_run", alias: "long", confidence: "high" },
  { kind: "intervals", alias: "интервальн", confidence: "high", stem: true },
  { kind: "intervals", alias: "интервалы", confidence: "high" },
  { kind: "intervals", alias: "интервал", confidence: "high", stem: true },
  { kind: "tempo", alias: "темпов", confidence: "high", stem: true },
  { kind: "tempo", alias: "темп", confidence: "medium" },
  { kind: "workout", alias: "трениров", confidence: "medium", stem: true },
  { kind: "workout", alias: "workout", confidence: "medium" },
  { kind: "workout", alias: "пробежк", confidence: "medium", stem: true },
  { kind: "workout", alias: "бег", confidence: "low" },
];

/**
 * Verb forms of "to run", accepted as a workout object.
 *
 * Students who DICTATE speak in verbs, not nouns: «сегодня не ПОБЕГУ, переставьте на завтра» names
 * no workout noun at all, so the strict gate (verb AND object AND date) rejected it outright, while
 * the same student's «перенесите на завтра ТРЕНИРОВКУ» a month earlier went through. The difference
 * between working and not working was one noun.
 *
 * FUTURE AND INFINITIVE ONLY. Past tense — «пробежал», «побегал», «бегал» — is deliberately absent:
 * those are reports, not requests ("Пробежал Игорь 45 минут"), and accepting them as a move object
 * would manufacture false positives out of every training report.
 *
 * Deliberately NOT part of WORKOUT_ALIAS_RULES: these must not leak into the alias list handed to
 * the AI prompt, and they are a last-resort fallback — any real workout noun wins first.
 */
const WORKOUT_VERB_FORMS = [
  "побегу",
  "побегаю",
  "побегать",
  "побегаем",
  "побежать",
  "побежим",
  "пробегу",
  "пробегусь",
  "пробежать",
  "пробежаться",
  "бегать",
  "бежать",
  "бегу",
  "сбегаю",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasBoundaryPattern(alias: string): RegExp {
  const body = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[\\s,.])${body}(?:[\\s,.]|$)`, "iu");
}

function aliasStemPattern(stem: string): RegExp {
  return new RegExp(`${escapeRegExp(stem)}[а-яa-z]{0,8}`, "iu");
}

function matchesAlias(normalized: string, rule: WorkoutAliasRule): boolean {
  if (rule.stem) {
    return aliasStemPattern(rule.alias).test(normalized);
  }
  if (rule.alias === "long") {
    return aliasBoundaryPattern("long").test(normalized);
  }
  if (rule.alias === "лонг") {
    return aliasBoundaryPattern("лонг").test(normalized);
  }
  if (rule.alias.includes(" ")) {
    return aliasBoundaryPattern(rule.alias).test(normalized);
  }
  return aliasBoundaryPattern(rule.alias).test(normalized);
}

export function normalizeWorkoutReference(text: string): NormalizeWorkoutReferenceResult {
  const normalized = text
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return { kind: "unknown", matchedAlias: null, confidence: "low" };
  }

  for (const rule of WORKOUT_ALIAS_RULES) {
    if (matchesAlias(normalized, rule)) {
      return {
        kind: rule.kind,
        matchedAlias: rule.alias,
        confidence: rule.confidence,
      };
    }
  }

  if (/\b\d{1,2}\s*[xх×]\s*\d{1,2}\b/u.test(normalized) || /\b\d{1,2}\s+по\s+\d{1,2}\b/u.test(normalized)) {
    return { kind: "intervals", matchedAlias: "repeat_set", confidence: "high" };
  }
  if (/\bпо\s+\d{1,2}\s*мин\b/u.test(normalized)) {
    return { kind: "intervals", matchedAlias: "по_минутам", confidence: "medium" };
  }

  if (/(?:^|[\s,.])(?:легкий\s+|легк\w*\s+)?бег(?:[\s,.]|$)/u.test(normalized) || normalized.includes("легк")) {
    return { kind: "workout", matchedAlias: "бег", confidence: "medium" };
  }

  // Last resort: the student named the workout with a verb instead of a noun. `low` confidence is
  // load-bearing — hasStrictWorkoutObject only asks `kind !== "unknown"` (so the gate opens), while
  // message-intent-log's relevance check demands `confidence !== "low"` (so log triage is unchanged).
  for (const form of WORKOUT_VERB_FORMS) {
    if (aliasBoundaryPattern(form).test(normalized)) {
      return { kind: "workout", matchedAlias: form, confidence: "low" };
    }
  }

  return { kind: "unknown", matchedAlias: null, confidence: "low" };
}

export function hasRecognizedWorkoutReference(text: string): boolean {
  return normalizeWorkoutReference(text).kind !== "unknown";
}

export function hasIntervalDescriptorPattern(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("интервал") ||
    /\b\d{1,2}\s*[xх×]\s*\d{1,2}\b/u.test(normalized) ||
    /\b\d{1,2}\s+по\s+\d{1,2}\b/u.test(normalized) ||
    /\bпо\s+\d{1,2}\s*мин\b/u.test(normalized)
  );
}

export function listKnownWorkoutAliasesForAiPrompt(): string {
  const grouped = new Map<string, string[]>();

  for (const rule of WORKOUT_ALIAS_RULES) {
    const aliases = grouped.get(rule.kind) ?? [];
    aliases.push(rule.stem ? `${rule.alias}*` : rule.alias);
    grouped.set(rule.kind, aliases);
  }

  grouped.set("easy_run", ["легкий бег", "легко", "easy run"]);

  return [...grouped.entries()]
    .map(([kind, aliases]) => `${kind}: ${aliases.join(", ")}`)
    .join("; ");
}
