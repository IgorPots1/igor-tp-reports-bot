/**
 * Two silent failure modes, one file.
 *
 * 1. TP_MOVE_RESOLVER_MODE used to degrade to "shadow" (the slow browser path) without a word when
 *    unset or misspelled. Igor: "молчаливый откат на медленный путь — это то, что я замечу через
 *    недели." The fallback stays; the silence does not.
 *
 * 2. The shadow comparator's ground truth must be INDEPENDENT of the resolver being measured. When
 *    it was the resolver's own answer, `id_mismatch` could not arise even in principle — the
 *    instrument could not fail, which is worse than no instrument, because this is the evidence the
 *    browser-safeguard decision rests on. These checks pin that it CAN fail.
 *
 * Offline: pure functions, no DB, no network, no browser.
 */
import {
  classifyMoveResolverMode,
  formatMoveResolverModeWarning,
  MOVE_RESOLVER_MODES,
} from "@/features/trainingpeaks/move-resolver-mode";
import { classifyMatchKind } from "@/features/trainingpeaks/move-shadow-comparator";

let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`ok: ${name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL: ${name}${detail ? `\n  ${detail}` : ""}`);
}

console.log("── resolver mode: every degraded value must announce itself ──");

const explicit = classifyMoveResolverMode("live_primary");
check("live_primary → explicit, no warning", explicit.mode === "live_primary" && explicit.status === "explicit");
check("explicit mode stays silent", formatMoveResolverModeWarning(explicit) === null);

for (const mode of MOVE_RESOLVER_MODES) {
  const resolution = classifyMoveResolverMode(mode);
  check(`«${mode}» is a recognised mode`, resolution.mode === mode && resolution.status === "explicit");
}

const unset = classifyMoveResolverMode(undefined);
check("unset → falls back to shadow", unset.mode === "shadow" && unset.status === "unset");
check(
  "unset SHOUTS (this is the mine: absence used to be indistinguishable from shadow)",
  (formatMoveResolverModeWarning(unset) ?? "").includes("не задан")
);

// The exact typo that would silently revert production to the browser path.
const typo = classifyMoveResolverMode("live-primary");
check("typo «live-primary» → falls back to shadow (unchanged, must never crash a move)", typo.mode === "shadow");
check("typo is flagged as unrecognized, not silently accepted", typo.status === "unrecognized");
const typoWarning = formatMoveResolverModeWarning(typo) ?? "";
check("typo warning names the offending value", typoWarning.includes("live-primary"));
check("typo warning states the consequence (slow browser path)", typoWarning.includes("МЕДЛЕННЫМ"));

check(
  "case and whitespace are tolerated — «  LIVE_PRIMARY  » is not a typo",
  classifyMoveResolverMode("  LIVE_PRIMARY  ").mode === "live_primary" &&
    classifyMoveResolverMode("  LIVE_PRIMARY  ").status === "explicit"
);
check("empty string is treated as unset, not as a typo", classifyMoveResolverMode("   ").status === "unset");

console.log("\n── shadow comparator: the instrument must be ABLE to fail ──");

// The whole point. DOM scraped 111; the HTTP resolver independently picked 222 → that is a mismatch,
// and it must be recorded as one. Under the old degenerate wiring both numbers were the resolver's
// own answer, so this row could never exist.
check(
  "DOM id ≠ resolver id → id_mismatch (the signal the M3 gate is watching for)",
  classifyMatchKind(222, "fields_unique", 111) === "id_mismatch",
  `got ${classifyMatchKind(222, "fields_unique", 111)}`
);
check(
  "DOM id === resolver id → exact_id",
  classifyMatchKind(111, "fields_unique", 111) === "exact_id",
  `got ${classifyMatchKind(111, "fields_unique", 111)}`
);
check(
  "resolver abstained → abstention, not a false agreement",
  classifyMatchKind(null, "not_found", 111).startsWith("abstained"),
  `got ${classifyMatchKind(null, "not_found", 111)}`
);

// Guard against a regression back to self-comparison: if ground truth were ever wired to the
// resolver's own answer again, EVERY row would read exact_id and this asymmetry would vanish.
const selfComparison = classifyMatchKind(999, "fields_unique", 999);
const genuineComparison = classifyMatchKind(999, "fields_unique", 888);
check(
  "self-comparison and genuine comparison are distinguishable (they were not, before the fix)",
  selfComparison === "exact_id" && genuineComparison === "id_mismatch"
);

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll move resolver mode + shadow ground-truth checks passed.");
