// Блок 2+3 — voice lexicon check for feedback drafts. A SOFT flag, never a gate: words in a draft that
// are outside Igor's voice vocabulary (or on the jargon blacklist) become a note in the coach «почему
// так» panel — the coach decides. Nothing is rejected or rewritten.
//
// Two channels feed the flag:
//   • WHITELIST-unknown — a content word whose stem isn't in the lexicon (bootstrapped from FEWSHOTS +
//     GLOSS + all sent_text, grown weekly from new sent_text). Catches genuine out-of-voice jargon
//     («аэробно», «декаплинг») and stray formal words.
//   • BLACKLIST-hit — a word Igor systematically CUTS from drafts (jargon that collides with a common
//     stem, e.g. «частил» → «част», so the whitelist can't catch it). Seeded in-code + grown from the
//     draft↔sent diff. Fires even if the word is technically "known".
//
// Sources are kept SEPARATE (base vs living, with dates) so the lexicon's provenance stays auditable.

import { FEWSHOTS, GLOSS } from "../feedback-corpus.ts";
import { stemRu, tokenizeRu } from "./stemmer.ts";
import baseLexicon from "./base-lexicon.json" with { type: "json" };
import livingLexicon from "./living-lexicon.json" with { type: "json" };
import blacklist from "./blacklist.json" with { type: "json" };

type BaseLexicon = { generatedAt: string | null; stems: string[] };
type LivingLexicon = { entries: Array<{ stem: string; addedAt: string; count: number }> };
type Blacklist = { seed: string[]; candidates: Array<{ stem: string; word: string; cutCount: number; addedAt: string }> };

// Function words / very common Russian that are always in-voice — never flag these. Keeps the unknown
// list to CONTENT words the coach might actually want to change.
const STOPWORDS = new Set<string>(
  [
    "и", "а", "но", "да", "или", "ли", "же", "бы", "не", "ни", "как", "так", "вот", "уж", "то", "это", "этот", "эта", "эти", "тот", "та", "те",
    "в", "во", "на", "по", "за", "из", "от", "до", "у", "о", "об", "обо", "к", "ко", "с", "со", "для", "про", "при", "над", "под", "без", "через", "между",
    "я", "ты", "вы", "мы", "он", "она", "оно", "они", "мне", "меня", "тебя", "тебе", "вас", "вам", "нас", "нам", "его", "ее", "их", "им", "ими", "себя", "себе",
    "мой", "моя", "твой", "твоя", "ваш", "ваша", "наш", "свой", "своя",
    "что", "чтобы", "который", "которая", "когда", "где", "куда", "чем", "тем", "всё", "все", "весь", "вся", "сам", "сама",
    "быть", "есть", "было", "были", "будет", "будешь", "буду",
    "уже", "еще", "ещё", "только", "тоже", "также", "очень", "почти", "чуть", "совсем", "просто", "здесь", "там", "потом", "теперь", "сейчас", "сегодня", "вчера", "завтра",
    "да", "нет", "ну", "вроде", "типа", "если", "хотя", "пока", "раз",
    // greetings / closers that are voice-neutral
    "привет", "здравствуй", "здравствуйте", "спасибо", "пожалуйста", "молодец", "молодцы", "давай", "ок",
  ].map((w) => stemRu(w))
);

function stemsFromCorpus(): Set<string> {
  const set = new Set<string>();
  const add = (text: string) => {
    for (const tok of tokenizeRu(text)) set.add(stemRu(tok));
  };
  for (const arr of Object.values(FEWSHOTS)) for (const s of arr) add(s);
  for (const g of Object.values(GLOSS)) if (g) add(g);
  return set;
}

// WHITELIST = in-code corpus (FEWSHOTS+GLOSS) ∪ base (sent_text bootstrap) ∪ living (weekly growth).
const CODE_STEMS = stemsFromCorpus();
const BASE_STEMS = new Set<string>((baseLexicon as BaseLexicon).stems ?? []);
const LIVING_STEMS = new Set<string>(((livingLexicon as LivingLexicon).entries ?? []).map((e) => e.stem));
const WHITELIST: Set<string> = new Set<string>([...CODE_STEMS, ...BASE_STEMS, ...LIVING_STEMS, ...STOPWORDS]);

// BLACKLIST = seed jargon ∪ diff-derived candidates. Matched on the EXACT word-form (normalised
// ё→е), NOT the stem: «частил» stems to «част», which collides with the common «часто/часть», so
// stem-matching would wrongly flag those. Exact-form matching flags «частил/частит» but not «часто».
const norm = (w: string) => w.toLowerCase().replace(/ё/g, "е");
const BL = blacklist as Blacklist;
const BLACKLIST_WORDS: Set<string> = new Set<string>([...(BL.seed ?? []), ...(BL.candidates ?? []).map((c) => c.word)].map(norm));

export type LexiconFinding = { word: string; stem: string; reason: "jargon" | "out_of_voice" };

export type LexiconCheck = {
  findings: LexiconFinding[]; // deduped by stem, in first-seen order
  totalTokens: number;
};

/** Flag draft words that are jargon (blacklist) or out of Igor's voice (not in the whitelist). Soft —
 *  the caller shows these in the coach panel; it never edits the draft. Dedups by stem. */
export function checkDraftVocabulary(draftText: string): LexiconCheck {
  const tokens = tokenizeRu(draftText);
  const seen = new Set<string>();
  const findings: LexiconFinding[] = [];
  for (const tok of tokens) {
    if (BLACKLIST_WORDS.has(norm(tok))) {
      const stem = stemRu(tok);
      if (seen.has(`bl:${norm(tok)}`)) continue;
      seen.add(`bl:${norm(tok)}`);
      findings.push({ word: tok, stem, reason: "jargon" });
      continue;
    }
    const stem = stemRu(tok);
    if (seen.has(stem)) continue;
    if (STOPWORDS.has(stem) || WHITELIST.has(stem)) continue;
    seen.add(stem);
    findings.push({ word: tok, stem, reason: "out_of_voice" });
  }
  return { findings, totalTokens: tokens.length };
}

/** Provenance, for the audit/report. */
export function lexiconStats(): { code: number; base: number; living: number; blacklist: number; baseGeneratedAt: string | null } {
  return {
    code: CODE_STEMS.size,
    base: BASE_STEMS.size,
    living: LIVING_STEMS.size,
    blacklist: BLACKLIST_WORDS.size,
    baseGeneratedAt: (baseLexicon as BaseLexicon).generatedAt ?? null,
  };
}
