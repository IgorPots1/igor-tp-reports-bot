import type { HealthSignalMemoryDoubt, HealthSignalMemoryDoubtPattern } from "@/features/trainingpeaks/health-signal-memory-reconcile";

// Решение A / Шаг 2 — auto-close ONLY the single strongest memory misfire, behind a default-OFF flag.
//
// Step 1 (health-signal-memory-reconcile.ts) MARKS health_issue_started signals that the same-message
// Haiku memory contradicts, but never closes anything — the coach decides. Step 2 is the narrow,
// opt-in follow-on: the one doubt safe to act on without a coach tap is `already_resolved` at the
// `strong` tier — the SAME message explicitly says the episode is over (resolved-cue memory ≥0.85,
// no "improving" cue). Everything else is NEVER auto-closed: `pain_not_illness` (medium) is a
// reclassification not a close, and `self_chosen_pause` / `no_health_corroboration` (weak) are
// absence-tier guesses a human must still confirm.
//
// Rollout is staged and reversible via COACH_HEALTH_SIGNAL_AUTOCLOSE_MODE:
//   unset / anything → "off"      Step-1 behaviour, nothing is closed (DEFAULT)
//            "dry_run" → "dry_run" compute + log the trace of what WOULD close, DO NOT mutate
//                 "on" → "on"     close eligible signals and write the audit trace
// Default OFF means merging this alone changes no production behaviour.

export type HealthSignalAutoCloseMode = "off" | "dry_run" | "on";

export const HEALTH_SIGNAL_AUTOCLOSE_MODE_ENV = "COACH_HEALTH_SIGNAL_AUTOCLOSE_MODE";

// The exact doubt Step 2 is allowed to act on. Kept as constants so the classifier, the check and the
// repository layer all agree on what "strong misfire" means.
export const AUTOCLOSE_PATTERN = "already_resolved" as const;
export const AUTOCLOSE_TIER = "strong" as const;

export const AUTOCLOSE_RETURN_PATTERN = "returned_to_training" as const;
// Both strong patterns Step 2 may auto-close: same-message "already over" OR "returned to training".
export const AUTOCLOSE_ELIGIBLE_PATTERNS = new Set<HealthSignalMemoryDoubtPattern>([
  AUTOCLOSE_PATTERN,
  AUTOCLOSE_RETURN_PATTERN,
]);
// resolved_reason per pattern for the audit trace.
export function autoCloseResolvedReasonForPattern(pattern: HealthSignalMemoryDoubtPattern): string {
  return pattern === AUTOCLOSE_RETURN_PATTERN
    ? "memory_autoclose_returned_to_training"
    : "memory_autoclose_already_resolved";
}

export function readHealthSignalAutoCloseMode(
  env: NodeJS.ProcessEnv = process.env
): HealthSignalAutoCloseMode {
  const raw = env[HEALTH_SIGNAL_AUTOCLOSE_MODE_ENV]?.trim().toLowerCase();
  if (raw === "on") {
    return "on";
  }
  if (raw === "dry_run") {
    return "dry_run";
  }
  return "off";
}

export type HealthSignalAutoCloseDecision =
  | {
      eligible: true;
      pattern: HealthSignalMemoryDoubtPattern;
      tier: typeof AUTOCLOSE_TIER;
      memoryItemId: string | null;
      memoryConfidence: number | null;
      reason: string;
      resolvedReason: string;
    }
  | { eligible: false; blockedReason: string };

/**
 * Decide whether one signal + its Step-1 memory doubt is eligible for Step-2 auto-close. Pure &
 * synchronous. Eligible ONLY for a `strong` `already_resolved` doubt on a health_issue_started signal;
 * every other pattern/tier is blocked (mark-only, human decides).
 */
export function decideHealthSignalAutoClose(input: {
  signalType: string;
  doubt: HealthSignalMemoryDoubt | null;
}): HealthSignalAutoCloseDecision {
  if (input.signalType !== "health_issue_started") {
    return { eligible: false, blockedReason: "not_health_issue_started" };
  }
  const doubt = input.doubt;
  if (!doubt) {
    return { eligible: false, blockedReason: "no_doubt" };
  }
  if (!AUTOCLOSE_ELIGIBLE_PATTERNS.has(doubt.pattern)) {
    return { eligible: false, blockedReason: `pattern_${doubt.pattern}_not_auto` };
  }
  if (doubt.tier !== AUTOCLOSE_TIER) {
    return { eligible: false, blockedReason: `tier_${doubt.tier}_not_auto` };
  }
  return {
    eligible: true,
    pattern: doubt.pattern,
    tier: AUTOCLOSE_TIER,
    memoryItemId: doubt.memoryItemId,
    memoryConfidence: doubt.memoryConfidence,
    reason: doubt.reason,
    resolvedReason: autoCloseResolvedReasonForPattern(doubt.pattern),
  };
}
