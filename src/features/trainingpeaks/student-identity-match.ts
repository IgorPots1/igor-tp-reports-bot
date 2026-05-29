export type StudentIdentityMatchStatus = "matched" | "ambiguous" | "unmatched";

export type StudentIdentityKind =
  | "trainingpeaks_name"
  | "trainingpeaks_id"
  | "telegram_username"
  | "telegram_display_name"
  | "billing_client_name"
  | "nickname"
  | "other";

type StudentIdentityInput = {
  value: string | null | undefined;
  kind: StudentIdentityKind;
  weight: number;
};

type StudentIdentityMatchCandidate<TStudent> = {
  student: TStudent;
  score: number;
  matchedBy: string;
  matchedValuePreview: string;
};

export type StudentIdentityMatchResult<TStudent> =
  | {
      status: "matched";
      student: TStudent;
      score: number;
      matchedBy: string;
      matchedValuePreview: string;
    }
  | {
      status: "ambiguous";
      candidates: StudentIdentityMatchCandidate<TStudent>[];
    }
  | {
      status: "unmatched";
      candidates: StudentIdentityMatchCandidate<TStudent>[];
    };

type MatchStrength =
  | "exact"
  | "token_set_exact"
  | "username_exact"
  | "nickname_exact"
  | "token_prefix"
  | "username_prefix"
  | "nickname_prefix"
  | "substring";

type QueryVariant = {
  normalized: string;
  usernameNormalized: string;
  tokens: string[];
  sortedTokenKey: string;
  nicknameExpanded: boolean;
  transliterated: boolean;
};

type NormalizedIdentity = {
  kind: StudentIdentityKind;
  weight: number;
  normalized: string;
  usernameNormalized: string;
  tokens: string[];
  sortedTokenKey: string;
  preview: string;
};

const MIN_MATCH_SCORE = 82;
const AMBIGUOUS_SCORE_MARGIN = 9;
const MEDIUM_CONFIDENCE_SCORE = 112;
const MAX_CANDIDATES = 5;

const RUSSIAN_NAME_VARIANT_MAP: Record<string, string[]> = {
  оля: ["ольга", "olga", "olya", "olha"],
  оле: ["ольга", "olga", "olya", "olha"],
  ольге: ["ольга", "olga", "olya", "olha"],
  ольга: ["ольга", "olga", "olya", "olha"],
  мария: ["мария", "maria", "mariya", "masha"],
  маша: ["мария", "maria", "mariya", "masha"],
  маше: ["мария", "maria", "mariya", "masha"],
  дмитрий: ["дмитрий", "dmitry", "dmitrii", "dimitry", "dima"],
  дима: ["дмитрий", "dmitry", "dmitrii", "dimitry", "dima"],
  диме: ["дмитрий", "dmitry", "dmitrii", "dimitry", "dima"],
  виктория: ["виктория", "victoria", "viktoria", "vika"],
  вика: ["виктория", "victoria", "viktoria", "vika"],
  вике: ["виктория", "victoria", "viktoria", "vika"],
  екатерина: ["екатерина", "ekaterina", "katerina", "katya"],
  катя: ["екатерина", "ekaterina", "katerina", "katya"],
  кате: ["екатерина", "ekaterina", "katerina", "katya"],
  елена: ["елена", "elena", "lena"],
  лена: ["елена", "elena", "lena"],
  лене: ["елена", "elena", "lena"],
  анастасия: ["анастасия", "anastasia", "nastya"],
  настя: ["анастасия", "anastasia", "nastya"],
  насте: ["анастасия", "anastasia", "nastya"],
  татьяна: ["татьяна", "tatiana", "tatyana", "tanya"],
  таня: ["татьяна", "tatiana", "tatyana", "tanya"],
  тане: ["татьяна", "tatiana", "tatyana", "tanya"],
  александр: ["александр", "alexander", "aleksandr", "sasha"],
  александра: ["александра", "alexandra", "aleksandra", "sasha"],
  саша: ["александр", "александра", "alexander", "aleksandr", "alexandra", "aleksandra", "sasha"],
  саше: ["александр", "александра", "alexander", "aleksandr", "alexandra", "aleksandra", "sasha"],
  алексей: ["алексей", "alexey", "alexei", "aleksei", "lesha", "alyosha"],
  леша: ["алексей", "alexey", "alexei", "aleksei", "lesha", "alyosha"],
  алеша: ["алексей", "alexey", "alexei", "aleksei", "lesha", "alyosha"],
  леше: ["алексей", "alexey", "alexei", "aleksei", "lesha", "alyosha"],
  алеше: ["алексей", "alexey", "alexei", "aleksei", "lesha", "alyosha"],
  евгений: ["евгений", "evgeny", "evgenii", "yevgeny", "zhenya"],
  евгения: ["евгения", "evgenia", "yevgenia", "zhenya"],
  женя: ["евгений", "евгения", "evgeny", "evgenii", "yevgeny", "evgenia", "yevgenia", "zhenya"],
  жене: ["евгений", "евгения", "evgeny", "evgenii", "yevgeny", "evgenia", "yevgenia", "zhenya"],
  наталья: ["наталья", "natalia", "natalya", "natasha"],
  наташа: ["наталья", "natalia", "natalya", "natasha"],
  наташе: ["наталья", "natalia", "natalya", "natasha"],
  юлия: ["юлия", "yulia", "julia", "yulya", "julya"],
  юля: ["юлия", "yulia", "julia", "yulya", "julya"],
  юле: ["юлия", "yulia", "julia", "yulya", "julya"],
  валентин: ["валентин", "valentin", "valya"],
  валентина: ["валентина", "valentina", "valya"],
  валя: ["валентин", "валентина", "valentin", "valentina", "valya"],
  вале: ["валентин", "валентина", "valentin", "valentina", "valya"],
  любовь: ["любовь", "lubov", "lyubov", "luba"],
  люба: ["любовь", "lubov", "lyubov", "luba"],
  любе: ["любовь", "lubov", "lyubov", "luba"],
};

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ы: "y",
  э: "e",
  ю: "yu",
  я: "ya",
  ь: "",
  ъ: "",
};

function normalizeGeneralValue(input: string): string {
  return input
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTelegramUsername(input: string): string {
  return input
    .trim()
    .replace(/^@+/, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9_]+/g, "");
}

function tokenize(normalized: string): string[] {
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter(Boolean);
}

function toSortedTokenKey(tokens: string[]): string {
  if (tokens.length === 0) {
    return "";
  }
  return [...tokens].sort((left, right) => left.localeCompare(right, "ru")).join(" ");
}

function formatMatchedValuePreview(rawValue: string): string {
  const compact = rawValue.replace(/\s+/g, " ").trim();
  if (compact.length <= 36) {
    return compact;
  }
  return `${compact.slice(0, 33)}...`;
}

function transliterateCyrillicToken(token: string): string {
  if (!/[а-я]/u.test(token)) {
    return token;
  }
  let result = "";
  for (const char of token) {
    result += CYRILLIC_TO_LATIN_MAP[char] ?? char;
  }
  return result;
}

function transliterateSequence(sequence: string[]): string[] {
  return sequence.map((token) => transliterateCyrillicToken(token));
}

function expandNameVariantTokenSequences(tokens: string[]): string[][] {
  if (tokens.length === 0) {
    return [];
  }

  const sequences: string[][] = [tokens];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const expansions = RUSSIAN_NAME_VARIANT_MAP[token];
    if (!expansions || expansions.length === 0) {
      continue;
    }
    const next = sequences.slice();
    for (const sequence of sequences) {
      for (const expansion of expansions) {
        const copy = [...sequence];
        copy[index] = expansion;
        next.push(copy);
      }
    }
    sequences.splice(0, sequences.length, ...next.slice(0, 28));
  }

  const unique = new Map<string, string[]>();
  for (const sequence of sequences) {
    const normalized = sequence.join(" ").trim();
    if (!normalized) {
      continue;
    }
    unique.set(normalized, sequence);
  }
  return [...unique.values()];
}

function buildQueryVariants(query: string): QueryVariant[] {
  const normalized = normalizeGeneralValue(query);
  const usernameNormalized = normalizeTelegramUsername(query);
  const tokens = tokenize(normalized);
  const expandedSequences = expandNameVariantTokenSequences(tokens);
  const variants: QueryVariant[] = [];
  const seen = new Set<string>();

  const pushVariant = (sequence: string[], inputOptions?: { nicknameExpanded?: boolean; transliterated?: boolean }) => {
    const variantNormalized = sequence.join(" ").trim();
    const variantTokens = tokenize(variantNormalized);
    const variant: QueryVariant = {
      normalized: variantNormalized,
      usernameNormalized,
      tokens: variantTokens,
      sortedTokenKey: toSortedTokenKey(variantTokens),
      nicknameExpanded: inputOptions?.nicknameExpanded ?? variantNormalized !== normalized,
      transliterated: inputOptions?.transliterated ?? false,
    };
    const dedupeKey = `${variant.normalized}::${variant.usernameNormalized}`;
    if (variant.normalized && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      variants.push(variant);
    }
  };

  for (const sequence of expandedSequences) {
    pushVariant(sequence, { nicknameExpanded: sequence.join(" ").trim() !== normalized, transliterated: false });
    const transliteratedSequence = transliterateSequence(sequence);
    const transliterated = transliteratedSequence.join(" ").trim();
    if (transliterated && transliterated !== sequence.join(" ").trim()) {
      pushVariant(transliteratedSequence, {
        nicknameExpanded: sequence.join(" ").trim() !== normalized,
        transliterated: true,
      });
    }
  }

  if (variants.length === 0 && normalized) {
    variants.push({
      normalized,
      usernameNormalized,
      tokens,
      sortedTokenKey: toSortedTokenKey(tokens),
      nicknameExpanded: false,
      transliterated: false,
    });
  }

  return variants;
}

function normalizeIdentity(identity: StudentIdentityInput): NormalizedIdentity | null {
  const value = identity.value?.trim();
  if (!value) {
    return null;
  }

  const normalized = normalizeGeneralValue(value);
  const usernameNormalized =
    identity.kind === "telegram_username" ? normalizeTelegramUsername(value) : normalizeTelegramUsername(value);
  const tokens = tokenize(normalized);
  if (!normalized && !usernameNormalized) {
    return null;
  }

  return {
    kind: identity.kind,
    weight: Number.isFinite(identity.weight) ? identity.weight : 1,
    normalized,
    usernameNormalized,
    tokens,
    sortedTokenKey: toSortedTokenKey(tokens),
    preview: formatMatchedValuePreview(value),
  };
}

function scoreIdentityAgainstQuery(
  identity: NormalizedIdentity,
  variant: QueryVariant
): { score: number; strength: MatchStrength } | null {
  const weightFactor = Math.max(0.2, Math.min(identity.weight, 1.5));
  const variantPenalty = variant.transliterated ? 10 : 0;
  const applyWeight = (baseScore: number): number =>
    Math.round(Math.max(12, baseScore - variantPenalty) * weightFactor);
  const isNicknameKind = identity.kind === "nickname";

  if (
    identity.kind === "telegram_username" &&
    variant.usernameNormalized &&
    identity.usernameNormalized &&
    variant.usernameNormalized === identity.usernameNormalized
  ) {
    return { score: applyWeight(132), strength: "username_exact" };
  }

  if (variant.normalized && identity.normalized && variant.normalized === identity.normalized) {
    if (variant.nicknameExpanded || isNicknameKind) {
      return { score: applyWeight(118), strength: "nickname_exact" };
    }
    return { score: applyWeight(126), strength: "exact" };
  }

  if (
    variant.sortedTokenKey &&
    identity.sortedTokenKey &&
    variant.tokens.length >= 2 &&
    variant.sortedTokenKey === identity.sortedTokenKey
  ) {
    return { score: applyWeight(120), strength: "token_set_exact" };
  }

  if (
    identity.kind === "telegram_username" &&
    variant.usernameNormalized.length >= 3 &&
    identity.usernameNormalized.startsWith(variant.usernameNormalized)
  ) {
    return { score: applyWeight(100), strength: "username_prefix" };
  }

  if (variant.tokens.length > 0 && identity.tokens.length > 0) {
    const allPrefixesMatch = variant.tokens.every((queryToken) =>
      identity.tokens.some((identityToken) => identityToken.startsWith(queryToken))
    );
    if (allPrefixesMatch) {
      if (variant.nicknameExpanded || isNicknameKind) {
        return { score: applyWeight(96), strength: "nickname_prefix" };
      }
      return { score: applyWeight(92), strength: "token_prefix" };
    }
  }

  if (variant.normalized.length >= 3 && identity.normalized.includes(variant.normalized)) {
    return { score: applyWeight(72), strength: "substring" };
  }

  return null;
}

function isWeakStrength(strength: MatchStrength): boolean {
  return (
    strength === "token_prefix" ||
    strength === "nickname_prefix" ||
    strength === "username_prefix" ||
    strength === "substring"
  );
}

function buildMatchedBy(kind: StudentIdentityKind, strength: MatchStrength): string {
  return `${kind}:${strength}`;
}

function toResultCandidates<TStudent>(
  candidates: Array<{
    student: TStudent;
    score: number;
    matchedBy: string;
    matchedValuePreview: string;
  }>
): StudentIdentityMatchCandidate<TStudent>[] {
  return candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
    student: candidate.student,
    score: candidate.score,
    matchedBy: candidate.matchedBy,
    matchedValuePreview: candidate.matchedValuePreview,
  }));
}

export function matchStudentByIdentity<TStudent>(input: {
  query: string;
  students: TStudent[];
  buildIdentities: (student: TStudent) => StudentIdentityInput[];
}): StudentIdentityMatchResult<TStudent> {
  const variants = buildQueryVariants(input.query);
  if (variants.length === 0) {
    return { status: "unmatched", candidates: [] };
  }

  const ranked = input.students
    .map((student) => {
      const identities = input.buildIdentities(student)
        .map((identity) => normalizeIdentity(identity))
        .filter((identity): identity is NormalizedIdentity => identity !== null);

      let best:
        | {
            score: number;
            strength: MatchStrength;
            matchedBy: string;
            matchedValuePreview: string;
          }
        | null = null;

      for (const identity of identities) {
        for (const variant of variants) {
          const scored = scoreIdentityAgainstQuery(identity, variant);
          if (!scored) {
            continue;
          }
          const matchedBy = buildMatchedBy(identity.kind, scored.strength);
          if (!best || scored.score > best.score) {
            best = {
              score: scored.score,
              strength: scored.strength,
              matchedBy,
              matchedValuePreview: identity.preview,
            };
          }
        }
      }

      if (!best) {
        return null;
      }

      return {
        student,
        score: best.score,
        strength: best.strength,
        matchedBy: best.matchedBy,
        matchedValuePreview: best.matchedValuePreview,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        student: TStudent;
        score: number;
        strength: MatchStrength;
        matchedBy: string;
        matchedValuePreview: string;
      } => candidate !== null
    )
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return { status: "unmatched", candidates: [] };
  }

  const top = ranked[0]!;
  const second = ranked[1] ?? null;
  const visibleCandidates = toResultCandidates(ranked);

  if (top.score < MIN_MATCH_SCORE) {
    return {
      status: "unmatched",
      candidates: visibleCandidates,
    };
  }

  if (second) {
    const scoreGap = top.score - second.score;
    if (scoreGap <= AMBIGUOUS_SCORE_MARGIN) {
      return {
        status: "ambiguous",
        candidates: visibleCandidates,
      };
    }

    if (isWeakStrength(top.strength) && second.score >= MIN_MATCH_SCORE) {
      return {
        status: "ambiguous",
        candidates: visibleCandidates,
      };
    }

    if (top.score < MEDIUM_CONFIDENCE_SCORE && second.score >= top.score - 14) {
      return {
        status: "ambiguous",
        candidates: visibleCandidates,
      };
    }
  }

  return {
    status: "matched",
    student: top.student,
    score: top.score,
    matchedBy: top.matchedBy,
    matchedValuePreview: top.matchedValuePreview,
  };
}
