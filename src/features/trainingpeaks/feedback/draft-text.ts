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
// Greeting VARIANTS per register — punctuation/emoji variety on the two canonical greetings so the
// coach's «Привет!»/«Здравствуйте!» doesn't read identically on every card (Игорь: «звучит одинаково»).
// Register (ты/вы) is respected strictly. Time-of-day greetings («Доброе утро/вечер») are deliberately
// left out: a card is generated when the student reports but SENT later, so send-time is unknown here
// and «Доброе утро» could land at night — those need send-time gating, added separately if wanted.
const GREETINGS: Record<"ty" | "vy", string[]> = {
  ty: ["Привет!", "Привет)", "Привет!)", "Привет 👋", "Привет 🙌", "Привет 😊"],
  vy: ["Здравствуйте!", "Здравствуйте)", "Здравствуйте!)", "Здравствуйте 👋", "Здравствуйте 🙌"],
};
function seedIndex(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % n;
}
// A greeting at the START of the first line: the word (привет/здравствуй…) plus its trailing punctuation/
// emoji run, either register. Cyrillic-safe; `[^\p{L}\n]*` eats «! ) , 👋» but stops at the next word.
const LEADING_GREETING_RE = /^\s*(?:привет|здравствуй)[а-яё]*[^\p{L}\n]*/iu;

export function enforceGreeting(text: string, register: "ty" | "vy" | "unknown", seed?: string): string {
  const reg: "ty" | "vy" = register === "ty" ? "ty" : "vy"; // unknown → «вы» (lower-risk address)
  const pool = GREETINGS[reg];
  // With a seed (live: the job id) rotate deterministically — same card always gets the SAME greeting
  // (idempotent on regenerate), different cards vary. Without a seed (tests / targeted rebuilds) the
  // canonical first variant, so behavior is unchanged there.
  const desired = seed ? pool[seedIndex(seed, pool.length)]! : pool[0]!;
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim().length > 0);
  if (idx === -1) return text;
  const first = lines[idx]!;
  if (LEADING_GREETING_RE.test(first)) {
    // Replace whatever greeting the model wrote (right OR wrong register, any punctuation) with `desired`,
    // keeping the rest of the line ("Здравствуйте! молодец" → "Привет! молодец" for a ты student).
    lines[idx] = first.replace(LEADING_GREETING_RE, `${desired} `).replace(/\s+$/u, "");
    return lines.join("\n");
  }
  return `${desired}\n${text}`; // no greeting at all → prepend it as the first line
}

// Block 3 — formatting. Two rules, both deterministic (the prompt asks too, but the model drifts):
//   (a) NO trailing period. Igor never ends on a period (corpus: 0 of ~20 examples do — they end on
//       a word, emoji, «)», «!» or «?»). Strip a single final «.» (not «…», not «?»/«!»).
//   (b) Blank line BETWEEN blocks — but ONLY for a multi-block (rich) draft. The corpus voice is
//       "одно-два предложения, не абзацы", so a short one-liner stays compact (greeting inline). A
//       rich draft (a trailing question over a body, or ≥2 sentences / long body) is split into
//       greeting / body / question paragraphs — the wall of text Igor flagged.
function stripTrailingPeriod(t: string): string {
  return t.endsWith(".") && !t.endsWith("..") ? t.slice(0, -1) : t;
}

export function normalizeDraftFormat(text: string): string {
  const t = stripTrailingPeriod(text.replace(/[ \t]+$/gmu, "").replace(/\n{3,}/g, "\n\n").trim());
  // Anchor on the greeting incl. its trailing punctuation/emoji (a rotated «Привет 👋» / «Здравствуйте)»),
  // so reformatting a rich draft preserves the variant instead of stripping it back to the bare word.
  const gm = t.match(/^(привет|здравствуйте)([^\p{L}\n]*)/iu);
  if (!gm) return t; // no greeting to anchor on (shouldn't happen post-enforce) → leave structure alone
  const greeting = `${gm[1]!}${gm[2]!}`.replace(/[\s,]+$/u, "");
  const body = t.slice(gm[0]!.length).trim();
  if (!body) return greeting;

  // Peel a trailing question (a «…?» clause) off the end, if there's other content before it.
  let mainBody = body;
  let question = "";
  const qm = body.match(/([^.!?\n]+\?)\s*$/u);
  if (qm && body.slice(0, body.length - qm[1]!.length).trim().length > 0) {
    question = qm[1]!.trim();
    mainBody = stripTrailingPeriod(body.slice(0, body.length - qm[1]!.length).trim());
  }

  // Count sentence groups (so «..» or «?» is one, not many). Rich = a peeled question over a body,
  // OR ≥2 sentences in the body, OR a long body. A lone short clause/question stays compact.
  const sentenceGroups = (mainBody.match(/[.!?]+/gu) ?? []).length;
  const rich = question !== "" || sentenceGroups >= 2 || mainBody.length > 80;
  if (!rich) return `${greeting} ${body}`.trim(); // short → compact one-liner, greeting inline

  return [greeting, mainBody, question].filter(Boolean).join("\n\n");
}
