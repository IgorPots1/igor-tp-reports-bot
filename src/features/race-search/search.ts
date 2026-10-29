/* Поиск по календарю забегов — один для бота, сайта и мини-приложения (наряд 29.10.2026, фидбек
 * «нет ГРУТа»). Строка поиска старта = название, город, регион, субъект + то же транслитом + народные
 * названия из aliases.json («ГРУТ» → Golden Ring Ultra Trail). Без node:*: работает и в браузере.
 *
 * Слово запроса из 1–3 букв ищется только с начала слова («мм», «сим», «ива…»), длиннее — где угодно:
 * иначе «мм» находило бы любое название с «мм» внутри, а «сим» — Симферополь посреди слова. */

import aliasData from "./aliases.json";

export function normText(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„'’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Кириллица → латиница («грут» → «grut», «суздаль» → «suzdal»). */
export function toLatin(s: string): string {
  return [...s].map((c) => CYR[c] ?? c).join("");
}

// Латиница → кириллица: сначала сочетания, потом буквы («golden ring» → «голден ринг»).
const LAT_PAIRS: [string, string][] = [
  ["shch", "щ"], ["sch", "щ"], ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"], ["yu", "ю"],
  ["ya", "я"], ["yo", "е"], ["ye", "е"], ["oo", "у"], ["ee", "и"], ["th", "т"], ["ph", "ф"], ["ck", "к"],
  ["qu", "кв"], ["x", "кс"], ["w", "в"], ["q", "к"], ["c", "к"], ["j", "дж"], ["h", "х"],
  ["a", "а"], ["b", "б"], ["d", "д"], ["e", "е"], ["f", "ф"], ["g", "г"], ["i", "и"], ["k", "к"], ["l", "л"],
  ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"],
  ["y", "й"], ["z", "з"],
];

export function toCyrillic(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const hit = LAT_PAIRS.find(([l]) => s.startsWith(l, i));
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
}

export type AliasEntry = { aliases: string[]; targets: string[]; event: string; source: string };

export const ALIASES: AliasEntry[] = (aliasData as { entries: AliasEntry[] }).entries.map((e) => ({
  ...e,
  aliases: e.aliases.map(normText),
  targets: e.targets.map(normText),
}));

/** Тире любой длины с пробелами вокруг — одно «-»: «Пушкин — Петербург», «Пушкин–Санкт-Петербург». */
function dashes(s: string): string {
  return s.replace(/\s*[-–—]\s*/g, "-");
}

const TARGETS = ALIASES.map((e) => ({ aliases: e.aliases, targets: e.targets.map(dashes), lat: e.targets.map((t) => toLatin(dashes(t))) }));

/** Народные названия, подходящие к официальному названию старта (по любому из targets). */
export function aliasesFor(name: string): string[] {
  const n = dashes(normText(name));
  const lat = toLatin(n);
  const out: string[] = [];
  for (const e of TARGETS) if (e.targets.some((t) => n.includes(t)) || e.lat.some((t) => lat.includes(t))) out.push(...e.aliases);
  return out;
}

const cache = new Map<string, string>();

/** Строка, по которой ищется старт. Кэш по входу: список из ~2 тыс. стартов фильтруется на каждое нажатие. */
export function searchText(name: string, ...place: (string | null | undefined)[]): string {
  const key = [name, ...place].join("\u0001");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // Знаки препинания — в пробелы: «ЗаБег.РФ»(Уфа) → «забег рф уфа», иначе короткое слово не найти с начала.
  const base = normText([name, ...place].join(" ")).replace(/[^\p{L}\p{N}\- ]+/gu, " ").replace(/\s+/g, " ");
  const text = ` ${[base, toLatin(base), toCyrillic(base), ...aliasesFor(name)].join(" ")} `;
  if (cache.size > 20000) cache.clear();
  cache.set(key, text);
  return text;
}

/** Слова запроса: те же правила нормализации, что у строки поиска. */
export function queryWords(q: string): string[] {
  return normText(q)
    .split(/[\s,.;!?()]+/)
    .filter(Boolean);
}

function wordHit(text: string, w: string): boolean {
  if (w.length <= 3) return text.includes(` ${w}`) || text.includes(`-${w}`);
  return text.includes(w);
}

/** Все слова запроса нашлись: как написано, или тем же словом в другой раскладке алфавита. */
export function matchesQuery(text: string, words: string[]): boolean {
  return words.every((w) => wordHit(text, w) || wordHit(text, toLatin(w)) || wordHit(text, toCyrillic(w)));
}
