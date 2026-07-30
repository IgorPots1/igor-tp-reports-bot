// Shared, side-effect-free helper for the club → TP rollback drain (club-rollback-requested-once.ts).
// Kept in its own module so the invariant below can be unit-tested without importing the runner
// script (which touches the DB on import).

/**
 * True when a TP delete left the entity GONE and the calendar row can be removed:
 *   - 2xx      → we deleted it;
 *   - 404      → it was ALREADY gone (a human deleted it directly in TP — the manual-deletion case).
 * Both mean "no TP entity remains". Treating 404 as a FAILURE would strand a manually-deleted start
 * forever (row never removed, retried every run) — the exact bug this guards against.
 */
export function isDeleteEffectivelyGone(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404;
}
