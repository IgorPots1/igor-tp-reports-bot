// Coach-memory items have no natural expiry: a fact the student mentioned once ("болею", "устала на
// работе") stays is_active=true forever and keeps getting injected into the reply-draft prompt as if
// it were current. That makes the draft talk about a cold from six weeks ago. The fix is a per-type
// freshness window keyed on last_seen_at (the last time the fact was actually observed/reconfirmed):
// short-lived states go stale fast, durable preferences and goals live long. This is DISPLAY-ONLY —
// nothing is deactivated in the DB; a stale item is simply not shown in the prompt block.
//
// Anchor = last_seen_at, not created_at: if the student keeps mentioning something, last_seen_at
// refreshes and the item stays. If they stop, it ages out. That is exactly the semantics we want.

import type {
  TrainingPeaksStudentMemoryItem,
  TrainingPeaksStudentMemoryType,
} from "@/features/trainingpeaks/repository";

// How long, in days, a fact of each type stays "current" after it was last seen. Short-lived states
// (health, mood, travel) expire quickly; durable preferences and goals live long. Values confirmed
// by the coach: health 14, emotional 14, injury 30, travel 21; everything else long-lived (90–365).
export const MEMORY_FRESHNESS_WINDOW_DAYS: Record<TrainingPeaksStudentMemoryType, number> = {
  health_status: 14,
  emotional_state: 14,
  travel_or_life_event: 21,
  pain_or_injury: 30,
  schedule_constraint: 90,
  load_tolerance: 90,
  race_or_goal: 120,
  availability_preference: 150,
  planning_preference: 180,
  equipment_or_device_note: 180,
  communication_style: 365,
};

/** Whole days between two ISO dates (date part only), non-negative, TZ-safe (both parsed as UTC midnight). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return 0;
  }
  return Math.abs(Math.round((to - from) / 86400000));
}

/**
 * Is this memory item still fresh enough to show as current context on the given reference date?
 *
 * - An explicit valid_until (a coach- or system-set expiry) is already enforced by the list query and
 *   is a deliberate intent, so items carrying one bypass the implicit window and are trusted as-is.
 * - Otherwise the item is fresh while last_seen_at is within the type's window; older → hidden (stale).
 */
export function isMemoryItemFresh(
  item: Pick<TrainingPeaksStudentMemoryItem, "memoryType" | "lastSeenAt" | "validUntil">,
  asOfDate: string
): boolean {
  if (item.validUntil) {
    return true; // explicit expiry governs; already gated upstream by the list query
  }
  const window = MEMORY_FRESHNESS_WINDOW_DAYS[item.memoryType];
  if (window === undefined) {
    return true; // unknown type → never hide (fail-open; new types must opt in explicitly)
  }
  if (!item.lastSeenAt) {
    return true; // no anchor → cannot judge staleness, keep it
  }
  return daysBetweenIso(item.lastSeenAt, asOfDate) <= window;
}
