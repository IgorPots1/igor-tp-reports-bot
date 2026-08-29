import indexData from "../../../data/shoes/owned-index.demo.json";

/**
 * Поиск по индексу моделей для вопроса «в чём уже бегал».
 *
 * Индекс ШИРЕ базы подбора: в нём есть прошлые версии, которые донашивают.
 * Их нельзя посоветовать, но узнать их надо — на них держится критерий
 * анти-паттерна и бонус за знакомый бренд.
 *
 * Поиск обязан понимать кириллицу: люди пишут «пегас», «клифтон», «новабласт».
 * Оба конца сравнения приводятся к одной латинице, поэтому «клифтон» находит
 * Clifton (к и c сходятся в k), а «новабласт» — Novablast.
 */

export type IndexEntry = {
  id: string;
  brand: string;
  model: string;
  year: number;
  /** false — модель есть в индексе, но в подборе не участвует (старая версия). */
  in_catalog: boolean;
};

export const SHOE_INDEX: IndexEntry[] = (indexData as { entries: IndexEntry[] }).entries;

/** Русские написания брендов: «найк» не выводится транслитерацией из «nike». */
const BRAND_ALIASES: Record<string, string[]> = {
  Nike: ["найк", "найки"],
  ASICS: ["асикс", "асиксы"],
  HOKA: ["хока"],
  "New Balance": ["нью баланс", "нб"],
  Brooks: ["брукс"],
  Saucony: ["сокони", "саукони"],
  adidas: ["адидас", "адик"],
  Mizuno: ["мизуно"],
  PUMA: ["пума"],
  On: ["он раннинг", "он"],
  Salomon: ["саломон"],
  "Li-Ning": ["ли нинг", "лининг"],
  Xtep: ["сюйбу", "икстеп"],
  ANTA: ["анта"],
  Kiprun: ["кипран", "кипрун"],
  Decathlon: ["декатлон"],
};

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "k", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "u", я: "a",
};

/** Приводит строку к общему алфавиту: кириллица → латиница, c → k, без разделителей. */
export function normalize(input: string): string {
  const lower = input.toLowerCase();
  let out = "";
  for (const ch of lower) out += TRANSLIT[ch] ?? ch;
  return out.replace(/c/g, "k").replace(/[^a-z0-9]+/g, "");
}

function haystack(e: IndexEntry): string {
  const aliases = BRAND_ALIASES[e.brand] ?? [];
  return normalize([e.brand, e.model, String(e.year), ...aliases].join(" "));
}

const HAYSTACKS = new Map(SHOE_INDEX.map((e) => [e.id, haystack(e)]));

export function searchShoes(query: string, limit = 8): IndexEntry[] {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map(normalize)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  return SHOE_INDEX.filter((e) => {
    const h = HAYSTACKS.get(e.id) ?? "";
    return tokens.every((t) => h.includes(t));
  })
    // Свежие версии выше: в них чаще бегают прямо сейчас.
    .sort((a, b) => b.year - a.year || a.brand.localeCompare(b.brand))
    .slice(0, limit);
}

export function entryById(id: string): IndexEntry | undefined {
  return SHOE_INDEX.find((e) => e.id === id);
}

export function labelOf(e: IndexEntry): string {
  return `${e.brand} ${e.model}`;
}
