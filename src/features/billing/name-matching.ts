/**
 * Сопоставление имён billing-клиента (часто кириллицей: «Александр Иванов»)
 * и ученика TrainingPeaks (часто латиницей: «Alexander Ivanov»).
 *
 * Чистый модуль без побочных эффектов — легко тестируется.
 * Используется в подсказках привязки клиент↔ученик и в авто-привязке.
 *
 * Идея:
 *  1) кириллические токены раскрываем из уменьшительных в полную форму
 *     (Даша→Дарья, Аня→Анна), затем транслитерируем в латиницу;
 *  2) латиницу нормализуем; ё→е;
 *  3) сравниваем наборы токенов с допуском на мелкие расхождения
 *     транслитерации (Хмельникова/Khmelkova) через расстояние Левенштейна.
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

// Уменьшительные → полная форма (в кириллице). Только частые, расширяемо.
const DIMINUTIVE_TO_FULL: Record<string, string> = {
  саша: "александр", шура: "александр",
  аня: "анна", анюта: "анна",
  даша: "дарья",
  катя: "екатерина", катюша: "екатерина",
  лена: "елена",
  маша: "мария", маня: "мария",
  настя: "анастасия",
  надя: "надежда",
  оля: "ольга",
  таня: "татьяна",
  юля: "юлия",
  лиза: "елизавета",
  света: "светлана",
  ваня: "иван",
  дима: "дмитрий",
  гриша: "григорий",
  коля: "николай",
  варя: "варвара",
  поля: "полина",
  слава: "вячеслав",
  стас: "станислав",
  рита: "маргарита",
  вика: "виктория",
  ксюша: "ксения",
  женя: "евгения",
  леша: "алексей", лёша: "алексей", леха: "алексей",
  миша: "михаил",
  паша: "павел",
  серёжа: "сергей", сережа: "сергей",
  костя: "константин",
  тоня: "антонина",
  люба: "любовь",
  галя: "галина",
  валя: "валентина",
  зина: "зинаида",
  тася: "анастасия",
};

function transliterateToken(token: string): string {
  let out = "";
  for (const char of token) {
    out += CYRILLIC_TO_LATIN[char] ?? char;
  }
  return out;
}

function expandDiminutive(token: string): string {
  return DIMINUTIVE_TO_FULL[token] ?? token;
}

function cleanNameTokens(rawName: string): string[] {
  const cleaned = rawName
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  return cleaned
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Имя → нормализованные латинские токены (канонические, для отображения/тестов).
 * Кириллица: раскрытие уменьшительных → транслитерация. Латиница: как есть.
 */
export function normalizeNameToLatinTokens(rawName: string | null | undefined): string[] {
  if (!rawName) {
    return [];
  }
  return cleanNameTokens(rawName)
    .map((token) => transliterateToken(expandDiminutive(token)))
    .filter(Boolean);
}

/**
 * Для одного токена возвращает набор латинских вариантов: «как есть» и
 * «раскрытое уменьшительное». Это позволяет сопоставлять формы с обеих сторон
 * (Настя↔Nastya, Аня↔Anna, Даша↔Darya), даже если уменьшительное в данных.
 */
function buildTokenVariants(rawName: string | null | undefined): string[][] {
  if (!rawName) {
    return [];
  }
  return cleanNameTokens(rawName)
    .map((token) => {
      const variants = new Set<string>();
      const raw = transliterateToken(token);
      if (raw) {
        variants.add(raw);
      }
      const expanded = transliterateToken(expandDiminutive(token));
      if (expanded) {
        variants.add(expanded);
      }
      return [...variants];
    })
    .filter((variants) => variants.length > 0);
}

function variantTokensMatch(a: string[], b: string[]): "exact" | "fuzzy" | "none" {
  for (const left of a) {
    for (const right of b) {
      if (left === right) {
        return "exact";
      }
    }
  }
  for (const left of a) {
    for (const right of b) {
      if (tokensFuzzyEqual(left, right)) {
        return "fuzzy";
      }
    }
  }
  return "none";
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

// Порог нечёткого совпадения токена в зависимости от длины (транслитерация шумит).
function tokensFuzzyEqual(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4) {
    return false; // короткие токены сравниваем только точно
  }
  const allowed = maxLen >= 8 ? 2 : 1;
  return levenshtein(a, b) <= allowed;
}

export type BillingNameMatch = {
  score: number;
  reasons: string[];
  matchedTokens: number;
};

/**
 * Оценивает, насколько имя клиента и имя ученика — один человек.
 * score ~100 = уверенное полное совпадение; 0 = ничего общего.
 */
export function scoreBillingNameMatch(
  clientName: string | null | undefined,
  studentName: string | null | undefined
): BillingNameMatch {
  const clientTokens = buildTokenVariants(clientName);
  const studentTokens = buildTokenVariants(studentName);
  if (clientTokens.length === 0 || studentTokens.length === 0) {
    return { score: 0, reasons: [], matchedTokens: 0 };
  }

  // Жадно сопоставляем токены клиента с токенами ученика: сначала точные, потом близкие.
  const remainingStudent = [...studentTokens];
  let exactMatches = 0;
  let fuzzyMatches = 0;

  for (const clientToken of clientTokens) {
    const exactIndex = remainingStudent.findIndex(
      (studentToken) => variantTokensMatch(clientToken, studentToken) === "exact"
    );
    if (exactIndex >= 0) {
      remainingStudent.splice(exactIndex, 1);
      exactMatches += 1;
      continue;
    }
    const fuzzyIndex = remainingStudent.findIndex(
      (studentToken) => variantTokensMatch(clientToken, studentToken) === "fuzzy"
    );
    if (fuzzyIndex >= 0) {
      remainingStudent.splice(fuzzyIndex, 1);
      fuzzyMatches += 1;
    }
  }

  if (exactMatches === clientTokens.length && clientTokens.length === studentTokens.length) {
    return {
      score: 100,
      reasons: ["полное совпадение имени (с транслитерацией)"],
      matchedTokens: exactMatches,
    };
  }

  const matchedTokens = exactMatches + fuzzyMatches;
  if (matchedTokens === 0) {
    return { score: 0, reasons: [], matchedTokens: 0 };
  }

  const reasons: string[] = [];
  let score = exactMatches * 45 + fuzzyMatches * 25;

  if (exactMatches > 0) {
    reasons.push(`совпали части имени: ${exactMatches}`);
  }
  if (fuzzyMatches > 0) {
    reasons.push(`близкие части имени (транслитерация): ${fuzzyMatches}`);
  }

  // Бонус, если совпали почти все токены клиента — вероятно тот же человек.
  if (matchedTokens >= Math.min(clientTokens.length, studentTokens.length)) {
    score += 15;
    reasons.push("совпали почти все части имени");
  }

  return { score, reasons, matchedTokens };
}
