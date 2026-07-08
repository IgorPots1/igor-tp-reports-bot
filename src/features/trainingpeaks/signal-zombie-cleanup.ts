// Zombie operational-signal cleanup — a general rule behind a default-OFF flag.
//
// Some operational signals are born with valid_until = NULL (e.g. duplicate rows from one message where
// only some siblings got a TTL). With no TTL they never expire on their own and hang on the coach desk
// as "zombies" long after they stopped being true (audit 2026-07-08: ILYA move candidate & Sofia
// unavailability from 01.06, still active 37 days later, memory no longer active).
//
// This module MARKS such rows for expiry via a deterministic, conservative predicate. It NEVER touches
// pain_injury (injuries close by hand — a coaching principle) or health signals; it only acts on the
// same plan-signal types the manual desk "Снять" already clears. A signal still confirmed by active
// memory, or younger than the grace window, is always spared.
//
// Rollout is staged and reversible via COACH_SIGNAL_ZOMBIE_CLEANUP_MODE:
//   unset / anything → "off"      nothing scanned or closed (DEFAULT — merging changes no behaviour)
//            "dry_run" → "dry_run" compute + log the trace of what WOULD close, DO NOT mutate
//                 "on" → "on"     expire eligible zombies (Supabase-only, status=expired, history kept)

export type SignalZombieCleanupMode = "off" | "dry_run" | "on";

export const SIGNAL_ZOMBIE_CLEANUP_MODE_ENV = "COACH_SIGNAL_ZOMBIE_CLEANUP_MODE";

// Grace window. Confirmed zombies are 37 days old; every live signal in the audit carried a TTL and was
// ≤6 days old. 14 sits in the empty gap: comfortably older than any legit fresh NULL signal, far below
// the real zombies. Conservative — a genuinely recent standing signal is never swept.
export const ZOMBIE_MIN_AGE_DAYS = 14;

// The ONLY signal types the zombie rule may expire — identical to the desk "Снять" plan set. This is
// what structurally excludes pain_injury (case C, manual only) and every health signal.
export const ZOMBIE_ELIGIBLE_SIGNAL_TYPES = new Set<string>([
  "move_workout_candidate",
  "schedule_availability_window",
  "schedule_unavailability_window",
  "plan_generation_constraint",
]);

export const ZOMBIE_CLEANUP_RESOLVED_REASON = "stale_zombie_cleanup";

export function readSignalZombieCleanupMode(
  env: NodeJS.ProcessEnv = process.env
): SignalZombieCleanupMode {
  const raw = env[SIGNAL_ZOMBIE_CLEANUP_MODE_ENV]?.trim().toLowerCase();
  if (raw === "on") {
    return "on";
  }
  if (raw === "dry_run") {
    return "dry_run";
  }
  return "off";
}

export type SignalZombieDecision =
  | { eligible: true; ageDays: number; reason: string }
  | { eligible: false; blockedReason: string };

function daysBetween(asOfDate: string, createdAtIso: string): number {
  const asOf = Date.parse(`${asOfDate}T00:00:00.000Z`);
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(asOf) || Number.isNaN(created)) {
    return 0;
  }
  return Math.floor((asOf - created) / 86_400_000);
}

/**
 * Decide whether one active operational signal is a stale zombie eligible for expiry. Pure &
 * synchronous. Conservative: any doubt → not eligible. A signal is a zombie ONLY when it is active,
 * of an eligible plan type, has NO TTL (valid_until = null), is older than the grace window, and is
 * NOT backed by active confirming memory.
 */
export function decideSignalZombieCleanup(input: {
  status: string;
  signalType: string;
  validUntil: string | null;
  createdAt: string;
  asOfDate: string;
  hasActiveConfirmingMemory: boolean;
  minAgeDays?: number;
}): SignalZombieDecision {
  const minAgeDays = input.minAgeDays ?? ZOMBIE_MIN_AGE_DAYS;

  // Idempotency: only active rows are ever touched. A re-run over already-expired rows is a no-op.
  if (input.status !== "active") {
    return { eligible: false, blockedReason: "not_active" };
  }
  // Structural exclusion of pain_injury (manual only) and health signals.
  if (!ZOMBIE_ELIGIBLE_SIGNAL_TYPES.has(input.signalType)) {
    return { eligible: false, blockedReason: `type_${input.signalType}_not_eligible` };
  }
  // A TTL means the signal expires on its own — not a zombie.
  if (input.validUntil !== null) {
    return { eligible: false, blockedReason: "has_valid_until" };
  }
  // Still corroborated by live memory → keep.
  if (input.hasActiveConfirmingMemory) {
    return { eligible: false, blockedReason: "active_memory" };
  }
  const ageDays = daysBetween(input.asOfDate, input.createdAt);
  if (ageDays < minAgeDays) {
    return { eligible: false, blockedReason: `too_fresh_${ageDays}d` };
  }
  return {
    eligible: true,
    ageDays,
    reason: `stale ${ageDays}d, no TTL, memory inactive`,
  };
}
