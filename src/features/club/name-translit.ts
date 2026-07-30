// Latin → Cyrillic name transliteration for probeg matching (Фаза 10.3, plan step 1). Our roster
// stores names in Latin (trainingpeaks_students.student_name); probeg is Cyrillic. This produces a
// best-guess Cyrillic spelling to query probeg's public /results/<surname>/<given>/ page.
//
// Reverse transliteration is INHERENTLY AMBIGUOUS (c → ц|к, y → ы|й, e → е|э, …). We pick the most
// common Russian mapping and lean on the caller's fallbacks (name-order swap, given-name-only) plus
// the decisive date+time match — a wrong guess just yields an empty page, never a wrong link.

// Digraphs first (longest match wins), then single letters. Lowercase in/out; caller capitalizes.
const DIGRAPHS: Array<[string, string]> = [
  ["shch", "щ"], ["sch", "щ"], ["tch", "ч"],
  ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"],
  ["yo", "е"], ["yu", "ю"], ["ya", "я"], ["ye", "е"], ["yi", "и"],
  ["ph", "ф"], ["ck", "к"], ["ei", "ей"], ["iy", "ий"],
];
const SINGLES: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж",
  k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т",
  u: "у", v: "в", w: "в", x: "кс", z: "з",
};
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

/** Best-guess Cyrillic for one Latin word. `y` is contextual: after a vowel it is a glide (й, so
 *  "ay"→"ай"), otherwise the vowel ы. */
export function translitWord(latin: string): string {
  const s = latin.toLowerCase().replace(/[^a-z]/g, "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const [lat, cyr] of DIGRAPHS) {
      if (s.startsWith(lat, i)) {
        out += cyr;
        i += lat.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = s[i];
    if (ch === "y") {
      const prev = i > 0 ? s[i - 1] : "";
      out += VOWELS.has(prev) ? "й" : "ы";
    } else {
      out += SINGLES[ch] ?? ch;
    }
    i += 1;
  }
  return out ? out[0].toUpperCase() + out.slice(1) : "";
}

/** Normalize a Cyrillic name for comparison: lowercase, ё→е, collapse spaces. */
export function normalizeCyrillicName(name: string): string {
  return name.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

export type NameGuess = { surname: string; given: string };

/**
 * Split a roster name into (surname, given) and transliterate both. The roster order is unknown, so
 * we return BOTH interpretations (token0=surname and token0=given); the caller tries each against
 * probeg. Already-Cyrillic input is passed through (only normalized). Multi-token names keep the
 * first two significant tokens.
 */
export function nameGuesses(rosterName: string): NameGuess[] {
  const isCyrillic = /[а-яё]/i.test(rosterName);
  const tokens = rosterName.trim().split(/\s+/u).filter((t) => t.replace(/[^a-zа-яё]/gi, "").length >= 2);
  if (tokens.length < 2) {
    const one = isCyrillic ? (tokens[0] ?? "") : translitWord(tokens[0] ?? "");
    return one ? [{ surname: one, given: "" }] : [];
  }
  const conv = (t: string) => (isCyrillic ? t[0].toUpperCase() + t.slice(1).toLowerCase() : translitWord(t));
  const a = conv(tokens[0]);
  const b = conv(tokens[1]);
  // Both orders — probeg's URL is /results/<surname>/<given>/ and rosters vary.
  return [
    { surname: a, given: b },
    { surname: b, given: a },
  ];
}
