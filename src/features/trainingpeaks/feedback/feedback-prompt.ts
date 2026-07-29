// Assembles the final generator prompt from a frozen FeedbackContextPacket.
// Pure and deterministic: given the same packet, the same prompt — so API and
// Cowork backends receive byte-identical input, and a stored packet reproduces
// exactly the prompt that produced its draft.

import { FEEDBACK_PROMPT_TEMPLATE, registerWord, sexRuleText } from "./feedback-corpus.ts";
import { bannedWordsForPrompt } from "./lexicon/draft-lexicon.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";

// Static across packets (from the lexicon files), computed once.
const BANNED_WORDS_LINE = bannedWordsForPrompt().join(", ");

// Render the verbatim student messages for the {{STUDENT_WORDS}} section. This is CONTEXT
// (tone + cause), not a number source — the prompt rules tell the model to translate any
// figures ("30°С", pace) into words, and the fact-check rejects a draft that quotes them.
function renderStudentWords(words: string[]): string {
  if (!words.length) return "Ученик про эту тренировку ничего не писал.";
  return words.map((w) => `- ${w}`).join("\n");
}

export function assembleFeedbackPrompt(packet: FeedbackContextPacket): string {
  return FEEDBACK_PROMPT_TEMPLATE
    .replaceAll("{{REGISTER}}", registerWord(packet.register))
    .replaceAll("{{SEX_RULE}}", sexRuleText(packet.sex))
    .replaceAll("{{FEWSHOTS}}", packet.fewshotsText)
    .replaceAll("{{WORKOUT}}", packet.workoutHeader)
    .replaceAll("{{OBSERVATIONS}}", packet.observationsBlock)
    .replaceAll("{{COMPARISON}}", packet.comparisonBlock)
    .replaceAll("{{BANNED_WORDS}}", BANNED_WORDS_LINE)
    .replaceAll("{{STUDENT_WORDS}}", renderStudentWords(packet.studentWords));
}
