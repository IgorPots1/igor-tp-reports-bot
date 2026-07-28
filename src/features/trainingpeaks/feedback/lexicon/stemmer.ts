// Light Russian stemmer + tokenizer for the voice lexicon (Блок 2+3). NOT a full Snowball port — a
// whitelist only needs inflections of the SAME word to collapse to a shared stem so a known word isn't
// flagged in a new form. Over-stemming (shorter stems) just widens the whitelist → FEWER false flags,
// which is the safe direction here; the blacklist channel catches jargon that collides with a common
// stem (e.g. «частил» → «част», shared with «часто/часть»).

// Longest-first so «оборот» endings strip before their prefixes. Grouped roughly by part of speech.
const ENDINGS: string[] = [
  // reflexive (strip first, handled separately below): ся / сь
  // superlative / participle / adjective
  "ейшими", "ейшая", "ейшее", "ейшие", "ейший", "ейшую",
  "ими", "ыми", "его", "ого", "ему", "ому", "ая", "яя", "ое", "ее", "ые", "ие", "ый", "ий", "ой", "ым", "им", "ом", "ем", "ых", "их", "ую", "юю", "ою", "ею",
  // verb
  "ившись", "ывшись", "вшись", "ившие", "ывшие", "ующий", "ает", "яет", "уют", "ают", "яют", "ишь", "ешь", "ите", "ете", "ится", "ется", "ать", "ять", "еть", "ить", "уть", "ыть",
  // past tense with theme vowel (feminine/neuter/plural) — strip BEFORE the bare «ла/ло/ли»
  "ила", "ыла", "ела", "ала", "яла", "ула", "или", "ыли", "ели", "али", "яли", "ули", "ило", "ыло", "ело", "ало", "яло", "уло",
  "ла", "ло", "ли", "ил", "ыл", "ул", "ел", "ет", "ит", "ут", "ют", "ат", "ят", "ем", "им", "но", "на",
  // noun
  "ями", "ами", "иях", "иям", "ией", "иях", "ов", "ев", "ий", "ах", "ях", "ам", "ям", "ом", "ем", "ой", "ей", "ию", "ья", "ье", "ьи", "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й",
];

/** Reduce a Russian word to a crude stem. Idempotent-ish: strips one reflexive + one longest ending,
 *  never below 3 chars (so short words like «бег», «сон» survive whole). ASCII/short tokens returned
 *  lowercased unchanged. */
export function stemRu(word: string): string {
  let w = word.toLowerCase().replace(/ё/g, "е");
  if (w.length <= 3) return w;
  // reflexive
  if (w.endsWith("ся") && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith("сь") && w.length > 5) w = w.slice(0, -2);
  for (const e of ENDINGS) {
    if (e && w.length - e.length >= 3 && w.endsWith(e)) {
      return w.slice(0, w.length - e.length);
    }
  }
  return w;
}

/** Split text into lowercased word tokens worth checking against the lexicon. Keeps Cyrillic words
 *  (incl. hyphenated «когда-нибудь»); drops numbers, punctuation, emoji, URLs, and pure-Latin tokens
 *  (jargon like «EF»/«MAD» is handled by the blacklist, not flagged as unknown Russian). */
export function tokenizeRu(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || "").toLowerCase().split(/[^а-яёa-z-]+/u)) {
    const t = raw.replace(/^-+|-+$/g, "").trim();
    if (t.length < 2) continue;
    if (!/[а-яё]/u.test(t)) continue; // must contain a Cyrillic letter
    out.push(t);
  }
  return out;
}
