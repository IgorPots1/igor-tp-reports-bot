// Pure, dependency-free text normalization for coach drafts (no DB, no aliases) so it stays
// unit-testable under `node --test` and reusable across generator backends.

// Igor never uses the long dash «—»; the corpus rule tells the model so, but a model still
// slips one in now and then, so the ban cannot rest on obedience alone. This deterministic
// pass guarantees a dash never reaches a stored draft: a spaced clause-separator dash (em or
// en) becomes a comma, any remaining em/en dash a short hyphen "-", exactly the "запятой ...
// или коротким дефисом" the corpus asks for. The whitespace class is [ \t] only, so it never
// joins across newlines. Applied at the single submitFeedbackDraft seam, covering BOTH
// backends (API in-process + Cowork worker).
export function stripLongDash(text: string): string {
  return text
    .replace(/[ \t]+[—–][ \t]+/g, ", ")
    .replace(/[—–]/g, "-");
}

// Block 2 — greeting must match the student's register. The corpus rule ("«Привет!» на ты /
// «Здравствуйте!» на вы") is model-instructed, but the few-shots carry NO greeting and are mixed
// «ты»/«вы», so the model drifted (a «вы» student got «Привет!» over a «вы» body). Like the dash,
// the rule can't rest on obedience: this deterministic pass forces the first line's greeting to the
// register. Unknown register → «вы» (the lower-risk address, same default as registerWord). Applied
// at the submitFeedbackDraft seam alongside stripLongDash, so it covers both backends.
export function enforceGreeting(text: string, register: "ty" | "vy" | "unknown"): string {
  const desired = register === "ty" ? "Привет!" : "Здравствуйте!";
  const rightWord = register === "ty" ? "привет" : "здравствуй";
  const wrongWord = register === "ty" ? "здравствуй" : "привет";
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim().length > 0);
  if (idx === -1) return text;
  const first = lines[idx]!;
  const has = (word: string) => new RegExp(`(?<![а-яё])${word}[а-яё]*`, "iu").test(first);
  if (has(rightWord)) return text; // correct greeting already present → leave the draft untouched
  if (has(wrongWord)) {
    // Swap just the wrong greeting token (with its trailing !/,/space) for the right one, keeping any
    // rest of the line ("Привет, всё ровно" → "Здравствуйте! всё ровно").
    lines[idx] = first.replace(new RegExp(`(?<![а-яё])${wrongWord}[а-яё]*!?,?\\s*`, "iu"), `${desired} `).replace(/\s+$/u, "");
    return lines.join("\n");
  }
  return `${desired}\n${text}`; // no greeting at all → prepend it as the first line
}
