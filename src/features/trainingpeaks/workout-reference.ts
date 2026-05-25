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

  return { kind: "unknown", matchedAlias: null, confidence: "low" };
}

export function hasRecognizedWorkoutReference(text: string): boolean {
  return normalizeWorkoutReference(text).kind !== "unknown";
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
