// Block 1 — word-level diff between the GENERATED draft and what Igor actually sent, computed at
// edit-save and at send time and frozen on the job (edit_diff). The full texts live in draft_text /
// sent_text; this is the compact signal for "which phrasings does Igor rewrite?" — `removed` are the
// words he cut (future blacklist candidates, Block 3's reverse direction), `added` are his
// replacements (approved lexicon). Pure + deterministic; no model.

export type DraftEditDiff = {
  changed: boolean;
  added: string[]; // words present in the SENT text but not the draft (Igor added)
  removed: string[]; // words present in the DRAFT but not the sent text (Igor cut)
};

const EMPTY: DraftEditDiff = { changed: false, added: [], removed: [] };

function tokenize(s: string): string[] {
  return s.trim().split(/\s+/u).filter(Boolean);
}

// Compare tokens case-insensitively and without surrounding punctuation, so «частил.» vs «частил»
// isn't a spurious change; the ORIGINAL token is kept for display in added/removed.
function norm(t: string): string {
  return t.toLowerCase().replace(/[.,!?;:()«»"'`—–\-…]+/gu, "");
}

/** LCS word-diff. `a` = draft tokens, `b` = sent tokens. Anything in `a` off the common
 *  subsequence was removed; anything in `b` off it was added. O(n·m) — drafts are short. */
function lcsDiff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(a[i]) === norm(b[j])) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(a[i]);
      i++;
    } else {
      added.push(b[j]);
      j++;
    }
  }
  while (i < n) removed.push(a[i++]);
  while (j < m) added.push(b[j++]);
  return { added, removed };
}

export function computeDraftEditDiff(draft: string | null | undefined, sent: string): DraftEditDiff {
  const d = (draft ?? "").trim();
  const s = (sent ?? "").trim();
  if (!d || d === s) return { ...EMPTY };
  const { added, removed } = lcsDiff(tokenize(d), tokenize(s));
  return { changed: added.length > 0 || removed.length > 0, added, removed };
}
