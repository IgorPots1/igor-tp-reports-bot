// Assembles the final generator prompt from a frozen FeedbackContextPacket.
// Pure and deterministic: given the same packet, the same prompt — so API and
// Cowork backends receive byte-identical input, and a stored packet reproduces
// exactly the prompt that produced its draft.

import { FEEDBACK_PROMPT_TEMPLATE, registerWord, sexRuleText } from "./feedback-corpus.ts";
import type { FeedbackContextPacket } from "./context-packet.ts";

export function assembleFeedbackPrompt(packet: FeedbackContextPacket): string {
  return FEEDBACK_PROMPT_TEMPLATE
    .replaceAll("{{REGISTER}}", registerWord(packet.register))
    .replaceAll("{{SEX_RULE}}", sexRuleText(packet.sex))
    .replaceAll("{{FEWSHOTS}}", packet.fewshotsText)
    .replaceAll("{{WORKOUT}}", packet.workoutHeader)
    .replaceAll("{{OBSERVATIONS}}", packet.observationsBlock)
    .replaceAll("{{COMPARISON}}", packet.comparisonBlock);
}
