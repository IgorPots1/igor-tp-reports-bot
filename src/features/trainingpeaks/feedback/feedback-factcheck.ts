// Iron fact-check at the generation seam (мост, часть 1). A draft that names any
// number NOT in the packet's allowedNumbers, or uses the wrong grammatical gender
// for the student's sex, is REJECTED (job → failed, never done). Mirrors the
// nutrition validateNutritionDayProse pattern (build allow-set → any offending
// token fails). The voice rule (v2/v3) forbids absolute workout numbers entirely,
// so allowedNumbers holds ONLY comparison-base deltas; every pace token and every
// other number in the draft must trace to that set.

import type { FeedbackContextPacket } from "./context-packet.ts";

export type FeedbackFactCheckResult = { ok: true } | { ok: false; reason: string };

// Masculine/feminine past-tense + participle markers. A female draft must not
// use masculine forms and vice versa (word-boundary matched to avoid substrings).
const MASC_MARKERS = ["пробежал", "сделал", "справился", "выполнил", "начинал", "заканчивал", "разложил", "поднял", "держал", "отбегал", "просел", "разогнал", "устал", "восстанавливал", "отработал", "прошёл", "поплыл", "шёл"];
const FEM_MARKERS = ["пробежала", "сделала", "справилась", "выполнила", "начинала", "заканчивала", "разложила", "подняла", "держала", "отбегала", "просела", "разогналась", "устала", "восстанавливалась", "отработала", "прошла", "шла", "поплыла"];
const PULSE_WORDS = ["пульс", "чсс"];

function extractNumbers(text: string): { paces: string[]; nums: number[] } {
  const paces = [...text.matchAll(/\d+:\d\d/g)].map((m) => m[0]);
  const stripped = text.replace(/\d+:\d\d/g, " ").replace(/👍|🙌|🔥|😁/g, " ");
  const nums = [...stripped.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number.parseFloat(m[0].replace(",", ".")));
  return { paces, nums };
}

export function validateFeedbackDraft(input: { draft: string; packet: FeedbackContextPacket }): FeedbackFactCheckResult {
  const { draft, packet } = input;
  const low = draft.toLowerCase();
  const allowed = new Set(packet.allowedNumbers.map((n) => Math.round(Math.abs(n))));
  const { paces, nums } = extractNumbers(draft);

  // Absolute workout pace/HR are forbidden entirely (only comparison deltas ok).
  // A pace token (M:SS) is never a comparison delta (those read "на N сек"), so any
  // pace token is an absolute workout number → reject.
  if (paces.length > 0) {
    return { ok: false, reason: `абсолютный темп тренировки в тексте (${paces.join(", ")}) — должно быть словами` };
  }
  for (const n of nums) {
    if (![...allowed].some((a) => Math.abs(a - Math.abs(n)) <= 1)) {
      return { ok: false, reason: `число ${n} не из пакета (allowedNumbers=${[...allowed].join(", ") || "нет"}) — выдуманная/абсолютная метрика` };
    }
  }

  // Gender must match sex. null sex defaults to feminine (narrative-guardrails rule),
  // so a null-sex draft must also not use masculine forms. Boundaries use Cyrillic
  // lookarounds, NOT \b: JS \b is ASCII-only and never fires between a space and a
  // Cyrillic letter, so it silently misses "пробежал". The trailing lookaround also
  // separates the masculine "пробежал" from the feminine "пробежала" (the 'а' after).
  const wordMatch = (word: string) => new RegExp(`(?<![а-яё])${word}(?![а-яё])`, "u").test(low);
  if (packet.sex === "male") {
    const bad = FEM_MARKERS.filter(wordMatch);
    if (bad.length) return { ok: false, reason: `женский род при sex=male (${bad.join(", ")})` };
  } else {
    const bad = MASC_MARKERS.filter(wordMatch);
    if (bad.length) return { ok: false, reason: `мужской род при sex=${packet.sex ?? "null(→жен)"} (${bad.join(", ")})` };
  }

  // C7: untrusted HR → the draft must not discuss pulse at all.
  if (!packet.hrTrusted && PULSE_WORDS.some((w) => low.includes(w))) {
    return { ok: false, reason: "hr_trusted=false, но черновик про пульс (недостоверный датчик)" };
  }

  return { ok: true };
}
