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

/** All plausible Cyrillic spellings of one Latin word (bounded set). Branches on the ambiguous
 *  digraphs; `i`/`y` after a vowel are glides (ай/ей) OR separate vowels (аи/еи). PURE. */
export function translitVariants(latin: string): string[] {
  const s = latin.toLowerCase().replace(/[^a-z]/gu, "");
  let cands = [""];
  const branch = (opts: string[]): void => {
    const next: string[] = [];
    for (const c of cands) for (const o of opts) next.push(c + o);
    cands = next.length > MAX_VARIANTS ? next.slice(0, MAX_VARIANTS) : next;
  };
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const [lat, opts] of MULTI) {
      if (s.startsWith(lat, i)) { branch(opts); i += lat.length; matched = true; break; }
    }
    if (matched) continue;
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : "";
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

/** Normalize a Cyrillic name for comparison: lowercase, ё→е, collapse spaces. */
export function normalizeCyrillicName(name: string): string {
  return name.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
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
