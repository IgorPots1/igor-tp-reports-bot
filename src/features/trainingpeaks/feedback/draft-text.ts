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
