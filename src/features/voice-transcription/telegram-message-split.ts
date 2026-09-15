// Telegram caps a single message at 4096 UTF-16 code units. A long voice note's transcript
// routinely exceeds that, so the worker must split it — this cuts on a paragraph or sentence
// boundary where one exists near the limit, instead of chopping mid-word.
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function splitForTelegram(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    // Cut point is AFTER the separator, so the separator itself stays attached to the chunk it
    // ends (a sentence keeps its "."). Getting this wrong drops the separator into the start of
    // the next chunk instead — caught by telegram-message-split.test.ts.
    let cut = -1;
    const paragraphBreak = remaining.lastIndexOf("\n\n", limit);
    if (paragraphBreak >= limit * 0.5) {
      cut = paragraphBreak + 2;
    } else {
      const sentenceBreak = remaining.lastIndexOf(". ", limit);
      if (sentenceBreak >= limit * 0.5) {
        cut = sentenceBreak + 1; // keep the period, drop only the following space
      }
    }
    if (cut < 0) {
      cut = limit;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}
