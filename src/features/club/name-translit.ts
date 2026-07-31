// Latin → Cyrillic name transliteration for probeg matching (Фаза 10.3, plan step 1). Our roster is
// Latin (trainingpeaks_students.student_name); probeg is Cyrillic. Reverse transliteration is
// AMBIGUOUS (ai → ай|аи, ei → ей|еи, y → ы|й, c → к|ц, ia → ия|иа, iu → ю|иу, …), so instead of one
// best-guess we GENERATE VARIANTS and the caller tries each public /results/<surname>/<given>/ URL.
// A wrong variant just yields an empty page; the decisive check is always date+time, never the name.

// Unambiguous multi-letter mappings, longest first. (ia/iu ARE ambiguous → branched below.)
const MULTI: Array<[string, string[]]> = [
  ["shch", ["щ"]], ["sch", ["щ"]],
  ["zh", ["ж"]], ["kh", ["х"]], ["ts", ["ц"]], ["ch", ["ч"]], ["sh", ["ш"]], ["ph", ["ф"]],
  ["yo", ["е"]], ["yu", ["ю"]], ["ya", ["я"]], ["ye", ["е"]], ["yi", ["и"]],
  ["ia", ["ия", "иа"]], ["iu", ["ю", "иу"]],
];
const SINGLE: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж", k: "к",
  l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в",
  w: "в", x: "кс", z: "з",
};
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);
const MAX_VARIANTS = 8;

// Common Russian given names, Latin → canonical Cyrillic. A DICTIONARY beats rules for names: rules
// give Александер/Татияна/Олга/Игор; real people are Александр/Татьяна/Ольга/Игорь. Several Latin
// spellings map to one Cyrillic. Applied to every roster token — it only fires for known given names,
// so passing a surname through is a no-op. Surnames are handled by the rules + softSignVariants instead.
const GIVEN_NAME_GROUPS: Array<[string, string[]]> = [
  ["Александр", ["alexander", "aleksandr", "alexandr", "aleksander", "sasha", "sanya"]],
  ["Александра", ["alexandra", "aleksandra"]],
  ["Алексей", ["alexey", "aleksey", "alexei", "aleksei", "aleksej", "alyosha"]],
  ["Алёна", ["alena", "alyona"]],
  ["Алина", ["alina"]],
  ["Алла", ["alla"]],
  ["Анастасия", ["anastasia", "anastasiya", "nastya", "nastia"]],
  ["Анатолий", ["anatoly", "anatoliy", "anatolii", "anatoli"]],
  ["Ангелина", ["angelina"]],
  ["Андрей", ["andrey", "andrei", "andrej"]],
  ["Анна", ["anna", "ania", "anya"]],
  ["Антон", ["anton"]],
  ["Антонина", ["antonina"]],
  ["Арина", ["arina"]],
  ["Артём", ["artem", "artyom", "artiom"]],
  ["Артур", ["artur", "arthur"]],
  ["Богдан", ["bogdan"]],
  ["Борис", ["boris"]],
  ["Вадим", ["vadim"]],
  ["Валентин", ["valentin"]],
  ["Валентина", ["valentina"]],
  ["Валерий", ["valery", "valeriy", "valerii"]],
  ["Валерия", ["valeria", "valeriya"]],
  ["Варвара", ["varvara"]],
  ["Василий", ["vasily", "vasiliy", "vasilii", "vasili"]],
  ["Вера", ["vera"]],
  ["Вероника", ["veronika", "veronica"]],
  ["Виктор", ["victor", "viktor"]],
  ["Виктория", ["victoria", "viktoria", "viktoriya"]],
  ["Виталий", ["vitaly", "vitaliy", "vitalii"]],
  ["Владимир", ["vladimir", "volodymyr"]],
  ["Владислав", ["vladislav", "vlad"]],
  ["Вячеслав", ["vyacheslav", "viacheslav"]],
  ["Галина", ["galina"]],
  ["Геннадий", ["gennady", "gennadiy", "gennadii"]],
  ["Георгий", ["georgy", "georgiy", "george", "georgii"]],
  ["Григорий", ["grigory", "grigoriy", "gregory", "grigorii"]],
  ["Дарья", ["daria", "darya", "dasha"]],
  ["Демьян", ["demyan", "demian", "damian"]],
  ["Денис", ["denis", "denys"]],
  ["Диана", ["diana"]],
  ["Дмитрий", ["dmitry", "dmitriy", "dmitrii", "dmitri", "dima"]],
  ["Евгений", ["evgeny", "evgeniy", "evgenii", "eugene", "yevgeny", "zhenya"]],
  ["Евгения", ["evgenia", "evgeniya"]],
  ["Екатерина", ["ekaterina", "katerina", "katya", "katia"]],
  ["Елена", ["elena", "yelena", "lena", "olena"]],
  ["Елизавета", ["elizaveta", "liza"]],
  ["Захар", ["zakhar", "zahar"]],
  ["Зоя", ["zoya", "zoia"]],
  ["Иван", ["ivan"]],
  ["Игорь", ["igor"]],
  ["Илья", ["ilya", "ilia", "ilja"]],
  ["Инна", ["inna"]],
  ["Ирина", ["irina", "ira"]],
  ["Карина", ["karina", "carina"]],
  ["Кирилл", ["kirill", "kiril", "cyril"]],
  ["Клавдия", ["klavdia", "klavdiya"]],
  ["Константин", ["konstantin", "constantine", "kostya"]],
  ["Кристина", ["kristina", "christina", "cristina"]],
  ["Ксения", ["ksenia", "kseniya", "xenia"]],
  ["Лариса", ["larisa", "larissa"]],
  ["Лев", ["lev"]],
  ["Леонид", ["leonid"]],
  ["Лидия", ["lidia", "lidiya", "lydia"]],
  ["Лилия", ["lilia", "liliya", "lily"]],
  ["Любовь", ["lyubov", "liubov"]],
  ["Людмила", ["lyudmila", "ludmila", "liudmila"]],
  ["Маргарита", ["margarita", "rita"]],
  ["Марина", ["marina"]],
  ["Мария", ["maria", "mariya", "masha"]],
  ["Марк", ["mark"]],
  ["Максим", ["maxim", "maksim", "max"]],
  ["Матвей", ["matvey", "matvei"]],
  ["Михаил", ["mikhail", "michael", "misha"]],
  ["Надежда", ["nadezhda", "nadia", "nadya"]],
  ["Наталья", ["natalia", "natalya", "nataliya", "natasha"]],
  ["Никита", ["nikita"]],
  ["Николай", ["nikolay", "nikolai", "nicolay", "kolya"]],
  ["Оксана", ["oksana", "oxana"]],
  ["Олег", ["oleg"]],
  ["Ольга", ["olga", "olha", "olya"]],
  ["Павел", ["pavel", "pasha", "paul"]],
  ["Пётр", ["petr", "pyotr", "peter"]],
  ["Полина", ["polina", "paulina"]],
  ["Раиса", ["raisa"]],
  ["Регина", ["regina"]],
  ["Римма", ["rimma"]],
  ["Роза", ["roza", "rosa"]],
  ["Роман", ["roman"]],
  ["Руслан", ["ruslan"]],
  ["Светлана", ["svetlana", "sveta"]],
  ["Семён", ["semyon", "semen"]],
  ["Сергей", ["sergey", "sergei", "sergej", "serguei"]],
  ["Софья", ["sofya", "sofia", "sophia", "sofiya"]],
  ["Станислав", ["stanislav", "stas"]],
  ["Степан", ["stepan", "stephan"]],
  ["Таисия", ["taisia", "taisiya"]],
  ["Тамара", ["tamara"]],
  ["Татьяна", ["tatiana", "tatyana", "tatjana", "tanya", "tania"]],
  ["Тимофей", ["timofey", "timofei"]],
  ["Тимур", ["timur"]],
  ["Ульяна", ["ulyana", "uliana"]],
  ["Фёдор", ["fedor", "fyodor", "feodor"]],
  ["Филипп", ["philipp", "filipp", "philip"]],
  ["Эдуард", ["eduard", "edward"]],
  ["Элла", ["ella"]],
  ["Эльвира", ["elvira"]],
  ["Юлия", ["yulia", "julia", "yuliya", "juliya"]],
  ["Юрий", ["yuri", "yuriy", "yury", "yurii"]],
  ["Яна", ["yana", "jana"]],
  ["Ярослав", ["yaroslav"]],
];
const GIVEN_NAMES = new Map<string, string>();
for (const [cyr, lats] of GIVEN_NAME_GROUPS) for (const l of lats) GIVEN_NAMES.set(l, cyr);

// Canonical Cyrillic given names, normalized (ё→е, ь removed) — the key the gate uses to decide whether
// a token is a first name. The one-letter surname tolerance must NOT apply to given names, or distinct
// people merge (Лилия/Лидия, Марина/Карина differ by one letter). Surnames aren't in this set.
const GIVEN_CYR_NORM = new Set(GIVEN_NAME_GROUPS.map(([cyr]) => cyr.toLowerCase().replace(/ё/gu, "е").replace(/ь/gu, "")));

/** Is this Cyrillic token a known Russian given name? Used to withhold the fuzzy (±1 letter) surname
 *  tolerance from first names, which would otherwise conflate Лилия/Лидия, Марина/Карина, Ирина/Арина. */
export function isKnownGivenName(cyr: string): boolean {
  return GIVEN_CYR_NORM.has(cyr.toLowerCase().replace(/ё/gu, "е").replace(/ь/gu, ""));
}

const CONSONANTS = new Set("бвгджзйклмнпрстфхцчшщ".split(""));
const CYR_VOWELS = new Set("аеёиоуыэюя".split(""));

/** Soft-sign (ь) spellings a Latin surname loses: rules give Мелникова/Василева, real people are
 *  Мельникова/Васильева. Inserts ь after «л» (before consonant or vowel), palatalises «и» between a
 *  consonant and a vowel (Дияченко→Дьяченко), and softens the -ев ending (Соловев→Соловьев). Bounded. */
function softSignVariants(cyr: string): string[] {
  const out = new Set<string>();
  const chars = [...cyr];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].toLowerCase() === "л" && chars[i + 1]?.toLowerCase() !== "ь") {
      out.add(chars.slice(0, i + 1).join("") + "ь" + chars.slice(i + 1).join(""));
    }
    if (i > 0 && i < chars.length - 1 && chars[i].toLowerCase() === "и" && CONSONANTS.has(chars[i - 1].toLowerCase()) && CYR_VOWELS.has(chars[i + 1].toLowerCase())) {
      out.add(chars.slice(0, i).join("") + "ь" + chars.slice(i + 1).join(""));
    }
  }
  if (/ев$/u.test(cyr)) out.add(cyr.replace(/ев$/u, "ьев"));
  if (/ева$/u.test(cyr)) out.add(cyr.replace(/ева$/u, "ьева"));
  return [...out];
}

/** Rule-based Cyrillic spellings of one Latin word (bounded). Branches on the ambiguous digraphs;
 *  `i`/`y` after a vowel are glides (ай/ей) OR separate vowels (аи/еи). PURE. */
function ruleVariants(key: string): string[] {
  let cands = [""];
  const branch = (opts: string[]): void => {
    const next: string[] = [];
    for (const c of cands) for (const o of opts) next.push(c + o);
    cands = next.length > MAX_VARIANTS ? next.slice(0, MAX_VARIANTS) : next;
  };
  let i = 0;
  while (i < key.length) {
    let matched = false;
    for (const [lat, opts] of MULTI) {
      if (key.startsWith(lat, i)) { branch(opts); i += lat.length; matched = true; break; }
    }
    if (matched) continue;
    const ch = key[i];
    const prev = i > 0 ? key[i - 1] : "";
    if (ch === "i" && VOWELS.has(prev)) branch(["й", "и"]); // ai/ei/oi/ui → ...й | ...и (Николай/Раиса)
    else if (ch === "y") branch(VOWELS.has(prev) ? ["й", "и"] : ["ы", "й"]);
    else if (ch === "c") branch(["к", "ц"]);
    else branch([SINGLE[ch] ?? ch]);
    i += 1;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cands) {
    const cap = c ? c[0].toUpperCase() + c.slice(1) : "";
    if (cap && !seen.has(cap)) { seen.add(cap); out.push(cap); }
  }
  return out;
}

/**
 * All plausible Cyrillic spellings of one Latin token (bounded). Dictionary canonical FIRST (names beat
 * rules), then the rule variants, then soft-sign (ь) surname variants of each — so both «Василева» and
 * «Васильева», both «Татияна» and the dictionary «Татьяна» are offered. The decisive check downstream
 * is always date+distance+time; a spurious variant just yields an empty page or is ignored. PURE.
 */
export function translitVariants(latin: string): string[] {
  const key = latin.toLowerCase().replace(/[^a-z]/gu, "");
  if (!key) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string): void => { if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
  const dict = GIVEN_NAMES.get(key);
  if (dict) push(dict); // known given name → canonical spelling first
  const base = ruleVariants(key);
  for (const v of base) push(v);
  for (const v of base) for (const sv of softSignVariants(v)) push(sv);
  return out.slice(0, 12);
}

/** Normalize a Cyrillic name for comparison: lowercase, ё→е, collapse spaces. */
export function normalizeCyrillicName(name: string): string {
  return name.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

/**
 * Per-token Cyrillic variant sets for the NAME GATE (probeg-parse.nameGate). One set per roster token
 * (lowercased, ё→е). A finisher must match the student on EVERY token (surname exact, given may be a
 * shortening) — the roster's surname/given order is unknown, so the gate matches by membership, not
 * position, and both tokens carry their translit variants. Latin → variants; Cyrillic → passed through.
 */
export function studentNameVariantSets(rosterName: string): string[][] {
  const isCyr = /[а-яё]/iu.test(rosterName);
  const tokens = rosterName.trim().split(/\s+/u).map((t) => t.replace(/[^a-zа-яё]/giu, "")).filter((t) => t.length >= 2);
  const norm = (s: string): string => s.toLowerCase().replace(/ё/gu, "е");
  return tokens.map((t) => {
    const vs = isCyr ? [t] : translitVariants(t);
    return [...new Set(vs.map(norm))];
  });
}

export type NameSpec = { surname: string; given: string };

/**
 * Ordered, deduped, bounded list of probeg /results/ path specs to try for a roster name. Includes
 * BOTH token orders (roster surname/given order is unknown), extra translit variants, AND surname-ONLY
 * specs — the latter catch a given-name mismatch (e.g. our «Хадижат» vs probeg «Хади»): search the
 * surname alone, then disambiguate by date+time. Already-Cyrillic input is passed through.
 */
export function nameSearchSpecs(rosterName: string): NameSpec[] {
  const isCyr = /[а-яё]/iu.test(rosterName);
  const tokens = rosterName.trim().split(/\s+/u).filter((t) => t.replace(/[^a-zа-яё]/giu, "").length >= 2).slice(0, 2);
  if (tokens.length === 0) return [];
  const variantsOf = (t: string): string[] => (isCyr ? [t[0].toUpperCase() + t.slice(1).toLowerCase()] : translitVariants(t).slice(0, 3));

  const specs: NameSpec[] = [];
  const seen = new Set<string>();
  const add = (surname: string, given: string): void => {
    const k = `${surname}|${given}`;
    if (surname && !seen.has(k)) { seen.add(k); specs.push({ surname, given }); }
  };

  if (tokens.length === 1) {
    for (const v of variantsOf(tokens[0])) add(v, "");
    return specs.slice(0, 6);
  }
  const t0 = variantsOf(tokens[0]);
  const t1 = variantsOf(tokens[1]);
  add(t0[0], t1[0]); // order A (token0=surname)
  add(t1[0], t0[0]); // order B (token1=surname)
  add(t0[0], ""); // surname-only A → catches given-name mismatch
  add(t1[0], ""); // surname-only B
  for (const s of t0.slice(1)) add(s, t1[0]); // extra surname variants, order A
  for (const s of t1.slice(1)) add(s, t0[0]); // extra surname variants, order B
  return specs.slice(0, 6);
}
