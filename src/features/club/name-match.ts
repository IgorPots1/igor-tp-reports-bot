// Shared name matching (Cyrillic→Latin transliteration + similarity) for the
// auto-bind cross-check and the admin access-request autosuggest. Pure, no I/O.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
};

export function translit(s: string): string {
  return s.toLowerCase().split("").map((c) => (c in CYR ? CYR[c] : c)).join("");
}

export function normName(s: string | null | undefined): string {
  return translit((s ?? "").toLowerCase()).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

/** Order-insensitive token similarity 0..1 (best bipartite match, averaged over smaller set). */
export function nameSim(a: string, b: string): number {
  const ta = normName(a).split(" ").filter(Boolean);
  const tb = normName(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let sum = 0;
  for (const t of small) sum += Math.max(...big.map((u) => ratio(t, u)));
  return sum / small.length;
}
